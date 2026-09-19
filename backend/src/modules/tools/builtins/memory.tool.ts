import { AgentTool, ToolContext, ToolExecutionResult } from '../tool.interface';
import { MemoryRepository } from '../../../database/repositories/memory.repo';

export class SaveMemoryTool implements AgentTool {
  public readonly name = 'save_memory';
  public readonly description =
    'Saves an important fact, detail, or preference about the user into long-term memory (e.g. user profession/job, preferred language/dialect, name, interests).';
  public readonly isSensitive = false;
  public readonly parameters = {
    type: 'object' as const,
    properties: {
      fact: {
        type: 'string',
        description: 'The clear fact or preference to remember about the user (in Arabic or English)',
      },
      category: {
        type: 'string',
        description: 'Optional category: profession, preference, identity, general',
      },
    },
    required: ['fact'],
  };

  constructor(private memoryRepo: MemoryRepository = new MemoryRepository()) {}

  public async execute(
    args: Record<string, any>,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const fact = args.fact?.trim();
    if (!fact) {
      return { success: false, error: 'No fact provided to save' };
    }

    const category = args.category || 'general';
    await this.memoryRepo.saveFact(context.userId, fact, category);

    return {
      success: true,
      output: {
        status: 'saved',
        fact,
        category,
        message: 'تم حفظ هذه المعلومة في الذاكرة الدائمة بنجاح.',
      },
    };
  }
}
