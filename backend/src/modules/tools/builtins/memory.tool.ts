import { z } from 'zod';
import { AgentTool, ToolContext, ToolExecutionResult, ToolMetadata } from '../tool.interface';
import { MemoryRepository } from '../../../database/repositories/memory.repo';
import { MemorySafetyGate } from '../../memory/memory_safety_gate';
import { logger } from '../../../core/logger';

const saveMemorySchema = z
  .object({
    fact: z.string().min(1).max(1000),
    category: z.string().max(100).optional(),
  })
  .strict();

export type SaveMemoryArgs = z.infer<typeof saveMemorySchema>;

export class SaveMemoryTool implements AgentTool<SaveMemoryArgs> {
  public readonly name = 'save_memory';
  public readonly description =
    'Saves an important fact, detail, or preference about the user into long-term memory (e.g. user profession/job, preferred language/dialect, name, interests).';
  public readonly isSensitive = false;
  public readonly schema = saveMemorySchema;
  public readonly metadata: ToolMetadata = {
    name: 'save_memory',
    description: 'Saves an important fact or preference about the user into long-term memory.',
    category: 'memory',
    riskLevel: 'medium',
    requiresConfirmation: false,
    requiresNetwork: false,
    maxExecutionMs: 4000,
    maxOutputChars: 1000,
  };
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
    args: SaveMemoryArgs,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const fact = args.fact?.trim();
    if (!fact) {
      return { success: false, error: 'No fact provided to save' };
    }

    const category = args.category || 'general';

    // Phase 4.5: Run candidate through MemorySafetyGate (defense-in-depth)
    const safetyDecision = MemorySafetyGate.getInstance().evaluate(fact, category);
    if (!safetyDecision.allowed) {
      logger.warn('SaveMemoryTool candidate blocked by safety gate', {
        reason: safetyDecision.reason,
        category,
      });

      const isEnglish = context.languageContext?.targetLanguage === 'en';
      return {
        success: false,
        error: isEnglish
          ? `Memory candidate rejected by safety gate (${safetyDecision.reason}).`
          : `تم رفض حفظ المعلومة بواسطة بوابة الأمان والخصوصية (${safetyDecision.reason}).`,
      };
    }

    await this.memoryRepo.saveFact(context.userId, fact, category, { source: 'agent_tool' });

    const isEnglish = context.languageContext?.targetLanguage === 'en';
    return {
      success: true,
      metadata: {
        trustLevel: 'user_provided',
      },
      output: {
        status: 'saved',
        fact,
        category,
        message: isEnglish
          ? 'Fact saved to long-term memory successfully.'
          : 'تم حفظ هذه المعلومة في الذاكرة الدائمة بنجاح.',
      },
    };
  }
}
