import { AgentTool, ToolContext, ToolExecutionResult } from '../tool.interface';

export class CreateReminderTool implements AgentTool {
  public readonly name = 'create_reminder';
  public readonly description = 'Schedules an alert or reminder for the user. (Requires explicit user confirmation)';
  public readonly isSensitive = true; // High-risk / sensitive action
  public readonly parameters = {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'The title or topic of the reminder',
      },
      time: {
        type: 'string',
        description: 'When the reminder should trigger (e.g. tomorrow 10am, 2026-09-19 14:00)',
      },
    },
    required: ['title', 'time'],
  };

  public async execute(
    args: Record<string, any>,
    _context: ToolContext
  ): Promise<ToolExecutionResult> {
    const title = args.title || 'Untitled Reminder';
    const time = args.time || 'Soon';

    return {
      success: true,
      isSensitive: true,
      confirmationDescription: `هل تؤكد إنشاء تذكير بخصوص: "${title}" في موعد: ${time}؟`,
      output: {
        status: 'scheduled',
        title,
        time,
      },
    };
  }
}
