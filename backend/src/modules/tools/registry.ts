import { AgentTool, ToolContext, ToolExecutionResult } from './tool.interface';
import { CurrentTimeTool } from './builtins/time.tool';
import { EchoTool } from './builtins/echo.tool';
import { WeatherTool } from './builtins/weather.tool';
import { WebSearchTool } from './builtins/search.tool';
import { CreateReminderTool, ListRemindersTool, CompleteReminderTool } from './builtins/reminder.tool';
import { SaveMemoryTool } from './builtins/memory.tool';
import { logger } from '../../core/logger';
import { config } from '../../config/env';

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, AgentTool> = new Map();

  private constructor() {
    this.registerDefaultTools();
  }

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  private registerDefaultTools(): void {
    this.registerTool(new CurrentTimeTool());
    this.registerTool(new EchoTool());
    this.registerTool(new WeatherTool());
    this.registerTool(new WebSearchTool());
    this.registerTool(new CreateReminderTool());
    this.registerTool(new ListRemindersTool());
    this.registerTool(new CompleteReminderTool());
    this.registerTool(new SaveMemoryTool());
  }

  public registerTool(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
    logger.debug(`Registered tool: [${tool.name}]`);
  }

  public getTool(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  public getAllTools(): AgentTool[] {
    return Array.from(this.tools.values());
  }


  /**
   * Transforms registered tools into OpenAI / Groq standard Tool format
   */
  public getOpenAITools(): any[] {
    return this.getAllTools().map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: Object.entries(tool.parameters.properties).reduce(
            (acc, [key, prop]) => {
              acc[key] = {
                type: (prop.type || 'string').toLowerCase(),
                description: prop.description,
              };
              return acc;
            },
            {} as Record<string, any>
          ),
          required: tool.parameters.required || [],
        },
      },
    }));
  }

  /**
   * Executes a tool by name with timeout safety
   */
  public async executeTool(
    name: string,
    args: Record<string, any>,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool [${name}] not found in registry.`,
      };
    }

    const timeoutPromise = new Promise<ToolExecutionResult>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Tool [${name}] execution timed out after ${config.security.toolTimeoutMs}ms`)),
        config.security.toolTimeoutMs
      )
    );

    try {
      return await Promise.race([tool.execute(args, context), timeoutPromise]);
    } catch (err: any) {
      logger.error(`Error executing tool [${name}]`, { error: err.message, args });
      return {
        success: false,
        error: err.message || 'Unknown tool execution failure',
      };
    }
  }
}
