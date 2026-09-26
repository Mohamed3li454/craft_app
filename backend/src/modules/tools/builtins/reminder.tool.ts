import { AgentTool, ToolContext, ToolExecutionResult } from '../tool.interface';
import { ReminderRepository } from '../../../database/repositories/reminder.repo';

export class CreateReminderTool implements AgentTool {
  public readonly name = 'create_reminder';
  public readonly description = 'Schedules an alert or reminder for the user. Supports one-time and recurring (daily/weekly/monthly) reminders. (Requires explicit user confirmation)';
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
        description: 'When the reminder should trigger (or initial occurrence if recurring, e.g. tomorrow 10am, 2026-09-19 14:00)',
      },
      recurrence: {
        type: 'string',
        description: 'Recurrence frequency for repeating reminders. Options: "none" (default: one-time), "daily" (every day), "weekly" (every week), "monthly" (every month).',
        enum: ['none', 'daily', 'weekly', 'monthly'],
      },
    },
    required: ['title', 'time'],
  };

  public async execute(
    args: Record<string, any>,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const title = args.title || 'Untitled Reminder';
    const time = args.time || 'Soon';
    const recurrence = args.recurrence || 'none';
    const isEnglish = context.languageContext?.targetLanguage === 'en';

    const recurrenceLabel = isEnglish
      ? (recurrence === 'daily' ? ' [repeats daily 🔄]' : recurrence === 'weekly' ? ' [repeats weekly 🔄]' : recurrence === 'monthly' ? ' [repeats monthly 🔄]' : '')
      : (recurrence === 'daily' ? ' [متكرر يومياً 🔄]' : recurrence === 'weekly' ? ' [متكرر أسبوعياً 🔄]' : recurrence === 'monthly' ? ' [متكرر شهرياً 🔄]' : '');

    const confirmationDescription = isEnglish
      ? `Do you confirm scheduling a reminder${recurrenceLabel} regarding: "${title}" at: ${time}?`
      : `هل تؤكد إنشاء تذكير${recurrenceLabel} بخصوص: "${title}" في موعد: ${time}؟`;

    return {
      success: true,
      isSensitive: true,
      confirmationDescription,
      output: {
        status: 'pending_confirmation',
        title,
        time,
        recurrence,
      },
    };
  }
}

export class ListRemindersTool implements AgentTool {
  public readonly name = 'list_reminders';
  public readonly description = 'Lists all active, uncompleted reminders and tasks for the current user.';
  public readonly isSensitive = false;
  public readonly parameters = {
    type: 'object' as const,
    properties: {
      includeCompleted: {
        type: 'boolean',
        description: 'Whether to include completed tasks (default false)',
      },
    },
    required: [],
  };

  constructor(private reminderRepo: ReminderRepository = new ReminderRepository()) {}

  public async execute(
    args: Record<string, any>,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const reminders = await this.reminderRepo.listByUser(
      context.userId,
      args.includeCompleted === true
    );

    const isEnglish = context.languageContext?.targetLanguage === 'en';
    const locale = context.languageContext?.locale || (isEnglish ? 'en-US' : 'ar-EG');

    if (reminders.length === 0) {
      return {
        success: true,
        output: {
          count: 0,
          reminders: [],
          summary: isEnglish ? 'No active reminders or tasks scheduled currently.' : 'لا توجد أي تذكيرات أو مهام مسجلة حالياً.',
        },
      };
    }

    const formatted = reminders
      .map((r, i) => {
        let recBadge = '';
        if (r.recurrence === 'daily') recBadge = isEnglish ? ' [daily 🔄]' : ' [يومي 🔄]';
        else if (r.recurrence === 'weekly') recBadge = isEnglish ? ' [weekly 🔄]' : ' [أسبوعي 🔄]';
        else if (r.recurrence === 'monthly') recBadge = isEnglish ? ' [monthly 🔄]' : ' [شهري 🔄]';

        const dueStr = r.dueAt
          ? ` (${isEnglish ? 'Due' : 'الموعد'}: ${new Date(r.dueAt).toLocaleString(locale, {
              timeZone: 'Africa/Cairo',
              hour12: true,
            })})`
          : '';
        const statusStr = r.isCompleted ? (isEnglish ? 'Completed ✅' : 'مكتمل ✅') : (isEnglish ? 'Pending ⏳' : 'قيد الانتظار ⏳');
        return `${i + 1}. ${r.title}${recBadge}${dueStr} - ${statusStr}`;
      })
      .join('\n');

    return {
      success: true,
      output: {
        count: reminders.length,
        reminders,
        summary: isEnglish ? `Active Reminders List:\n${formatted}` : `قائمة التذكيرات الحالية:\n${formatted}`,
      },
    };
  }
}

export class CompleteReminderTool implements AgentTool {
  public readonly name = 'complete_reminder';
  public readonly description = 'Marks an existing reminder or task as completed by title or ID.';
  public readonly isSensitive = false;
  public readonly parameters = {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'The title or search term of the reminder to complete',
      },
    },
    required: ['title'],
  };

  constructor(private reminderRepo: ReminderRepository = new ReminderRepository()) {}

  public async execute(
    args: Record<string, any>,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const title = args.title;
    if (!title) {
      return {
        success: false,
        error: 'يرجى تحديد عنوان التذكير المراد إتمامه.',
      };
    }

    const completed = await this.reminderRepo.complete(title, context.userId);
    if (!completed) {
      return {
        success: false,
        error: `لم يتم العثور على تذكير نشط بالعنوان "${title}".`,
      };
    }

    return {
      success: true,
      output: {
        status: 'completed',
        reminder: completed,
        message: `تم إتمام التذكير بنجاح: "${completed.title}" ✅`,
      },
    };
  }
}
