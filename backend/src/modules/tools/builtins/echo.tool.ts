import { AgentTool, ToolContext, ToolExecutionResult } from '../tool.interface';

export class EchoTool implements AgentTool {
  public readonly name = 'echo_message';
  public readonly description = 'Echoes back a given message for testing purposes.';
  public readonly isSensitive = false;
  public readonly parameters = {
    type: 'object' as const,
    properties: {
      message: {
        type: 'string',
        description: 'The message to echo back',
      },
    },
    required: ['message'],
  };

  public async execute(
    args: Record<string, any>,
    _context: ToolContext
  ): Promise<ToolExecutionResult> {
    return {
      success: true,
      output: {
        echo: args.message || '',
      },
    };
  }
}
