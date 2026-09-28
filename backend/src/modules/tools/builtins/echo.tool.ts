import { z } from 'zod';
import { AgentTool, ToolContext, ToolExecutionResult, ToolMetadata } from '../tool.interface';

const echoSchema = z
  .object({
    message: z.string(),
  })
  .strict();

export type EchoArgs = z.infer<typeof echoSchema>;

export class EchoTool implements AgentTool<EchoArgs> {
  public readonly name = 'echo_message';
  public readonly description = 'Echoes back a given message for testing purposes.';
  public readonly isSensitive = false;
  public readonly schema = echoSchema;
  public readonly metadata: ToolMetadata = {
    name: 'echo_message',
    description: 'Echoes back a given message for testing purposes.',
    category: 'public',
    riskLevel: 'low',
    requiresConfirmation: false,
    requiresNetwork: false,
    maxExecutionMs: 1000,
    maxOutputChars: 1000,
  };
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
    args: EchoArgs,
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
