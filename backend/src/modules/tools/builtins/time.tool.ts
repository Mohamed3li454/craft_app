import { AgentTool, ToolContext, ToolExecutionResult } from '../tool.interface';

export class CurrentTimeTool implements AgentTool {
  public readonly name = 'get_current_time';
  public readonly description = 'Returns the current real-world date and time.';
  public readonly isSensitive = false;
  public readonly parameters = {
    type: 'object' as const,
    properties: {
      timeZone: {
        type: 'string',
        description: 'Optional timezone (e.g. Africa/Cairo, UTC). Defaults to Africa/Cairo.',
      },
    },
  };

  public async execute(
    args: Record<string, any>,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const timeZone = args.timeZone || 'Africa/Cairo';
    const now = new Date();
    const locale = context?.languageContext?.locale || 'ar-EG';
    try {
      const formatted = new Intl.DateTimeFormat(locale, {
        timeZone,
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(now);

      return {
        success: true,
        output: {
          iso: now.toISOString(),
          formatted,
          timeZone,
        },
      };
    } catch {
      return {
        success: true,
        output: {
          iso: now.toISOString(),
          formatted: now.toString(),
          timeZone: 'UTC',
        },
      };
    }
  }
}
