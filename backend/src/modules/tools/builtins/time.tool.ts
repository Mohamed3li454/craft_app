import { z } from 'zod';
import { AgentTool, ToolContext, ToolExecutionResult, ToolMetadata } from '../tool.interface';

const currentTimeSchema = z
  .object({
    timeZone: z.string().optional(),
  })
  .strict();

export type CurrentTimeArgs = z.infer<typeof currentTimeSchema>;

export class CurrentTimeTool implements AgentTool<CurrentTimeArgs> {
  public readonly name = 'get_current_time';
  public readonly description = 'Returns the current real-world date and time.';
  public readonly isSensitive = false;
  public readonly schema = currentTimeSchema;
  public readonly metadata: ToolMetadata = {
    name: 'get_current_time',
    description: 'Returns the current real-world date and time.',
    category: 'public',
    riskLevel: 'low',
    requiresConfirmation: false,
    requiresNetwork: false,
    maxExecutionMs: 2000,
    maxOutputChars: 500,
  };
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
    args: CurrentTimeArgs,
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
