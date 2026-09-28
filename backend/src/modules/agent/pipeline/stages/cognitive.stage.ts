/**
 * Cognitive Stage (Phase 8.1)
 *
 * Coordinates intelligence sub-systems:
 * - Conversation Intelligence & State tracking (Phase 5)
 * - Memory extraction & selective context retrieval (Phases 1-3)
 * - Language & Personality refinement
 * - True Personalization synthesis (Phase 4)
 * - Adaptive Response policy (Phase 6)
 * - In-Turn Proactive recommendations (Phase 7.1)
 * - Centralized Token Budget Allocation (Phase 8.1)
 */

import { logger } from '../../../../core/logger';
import { config } from '../../../../config/env';
import { ConversationIntelligenceEngine } from '../../../conversation';
import { MemoryRetrievalService, MemoryContextAssembler } from '../../../memory';
import { LanguageIntelligenceService } from '../../../language';
import { PersonalityEngine } from '../../../personality';
import { PersonalizationEngine } from '../../../personalization';
import { AdaptiveResponseEngine } from '../../../response';
import { ProactiveEngine } from '../../../proactive';
import { TokenCounter } from '../../../context';
import { SystemPromptBuilder } from '../../../ai';
import { AgentPipelineContext, AgentPipelineDependencies, PipelineStage } from '../types';

export class CognitiveStage implements PipelineStage {
  public readonly name = 'cognitive';

  public async execute(ctx: AgentPipelineContext, deps: AgentPipelineDependencies): Promise<void> {
    // 1. Concurrently load recent messages & persist user turn in DB
    const [recentMessages] = await Promise.all([
      deps.chatRepo.getRecentMessages(ctx.conversationId, 8),
      deps.chatRepo.saveMessage(
        ctx.conversationId,
        'user',
        ctx.input.channel === 'whatsapp' ? 'WhatsApp User' : 'User',
        ctx.historyRecordText || ctx.effectivePrompt,
        ctx.input.mediaUrl,
        { mediaType: ctx.mediaType }
      ),
    ]);
    ctx.recentMessages = recentMessages;

    // 2. Conversation Intelligence Engine
    const conversationEngine = ConversationIntelligenceEngine.getInstance();
    ctx.conversationState = conversationEngine.analyze({
      query: ctx.textToProcess || ctx.cleanUserText || ctx.effectivePrompt,
      recentMessages: ctx.recentMessages.map((m) => ({
        role: m.senderRole,
        text: m.text,
        createdAt: m.createdAt,
      })),
    });

    // 3. Memory facts extraction & selective retrieval
    if (ctx.textToProcess && ctx.conversationState.goal !== 'troubleshooting') {
      try {
        await deps.memoryRepo.extractAndSaveFacts(
          ctx.input.userId,
          ctx.textToProcess,
          ctx.conversationId
        );
      } catch (err: any) {
        logger.debug('Memory fact extraction error', { error: err.message });
      }
    }

    const retrievalService = MemoryRetrievalService.getInstance(deps.memoryRepo);
    const queryText = ctx.conversationState.contextualizedQuery || ctx.textToProcess || ctx.effectivePrompt;
    const retrievedMemories = await retrievalService.retrieve({
      userId: ctx.input.userId,
      message: queryText,
      language: ctx.languageContext?.targetLanguage,
    });

    const contextAssembler = MemoryContextAssembler.getInstance();
    ctx.memoryContext = contextAssembler.assemble(retrievedMemories, {
      language: ctx.languageContext?.targetLanguage,
    });

    // 4. Refine Language & Personality context with full dialogue context
    const storedLangPref = await deps.userPreferenceRepo.getLanguagePreference(ctx.input.userId).catch(() => null);
    ctx.languageContext = LanguageIntelligenceService.getInstance().resolveContext(
      ctx.textToProcess || ctx.cleanUserText,
      {
        recentMessages: ctx.recentMessages.map((m) => ({
          role: m.senderRole,
          text: m.text,
        })),
        storedPreference: storedLangPref
          ? { language: storedLangPref.language, dialect: storedLangPref.dialect }
          : undefined,
      }
    );

    const storedPersPref = await deps.userPreferenceRepo.getPersonalityPreference(ctx.input.userId).catch(() => null);
    if (storedPersPref && !ctx.input.explicitPersonalityPreference) {
      ctx.personalityContext = PersonalityEngine.getInstance().resolve({
        explicitPreference: storedPersPref,
      });
    }

    // 5. True Personalization Engine
    const personalizationEngine = PersonalizationEngine.getInstance();
    ctx.personalizationPolicy = personalizationEngine.synthesizePolicy({
      query: ctx.textToProcess || ctx.cleanUserText || ctx.effectivePrompt,
      recentContext: ctx.recentMessages.map((m) => ({ role: m.senderRole, content: m.text })),
      storedPreferences: {
        language: storedLangPref ? { language: storedLangPref.language, dialect: storedLangPref.dialect } : undefined,
        personality: ctx.input.explicitPersonalityPreference || (storedPersPref ?? undefined),
      },
      retrievedMemories: ctx.memoryContext.memories.map((m) => ({
        factText: m.memory.factText,
        category: m.memory.category,
        factKey: m.memory.factKey,
        status: m.memory.status,
        lifecycleStatus: m.memory.status,
        confidence: m.memory.confidence,
        importance: m.memory.importance,
        temporalState: m.memory.temporalState,
      })),
    });

    if (ctx.personalizationPolicy.verbosityOverride || ctx.personalizationPolicy.formalityOverride) {
      ctx.personalityContext = PersonalityEngine.getInstance().resolve({
        explicitPreference: {
          ...(ctx.input.explicitPersonalityPreference || storedPersPref || {}),
          ...(ctx.personalizationPolicy.verbosityOverride && !ctx.input.explicitPersonalityPreference?.verbosity
            ? { verbosity: ctx.personalizationPolicy.verbosityOverride }
            : {}),
          ...(ctx.personalizationPolicy.formalityOverride && !ctx.input.explicitPersonalityPreference?.formality
            ? { formality: ctx.personalizationPolicy.formalityOverride }
            : {}),
        },
      });
    }

    // 6. Adaptive Response Intelligence Engine
    const previousAssistantMessage = ctx.recentMessages
      .filter((m) => m.senderRole === 'assistant')
      .pop()?.text;

    const adaptiveResponseEngine = AdaptiveResponseEngine.getInstance();
    ctx.adaptiveResponsePolicy = adaptiveResponseEngine.analyze({
      query: ctx.textToProcess || ctx.cleanUserText || ctx.effectivePrompt,
      conversationState: ctx.conversationState,
      personalizationPolicy: ctx.personalizationPolicy,
      personalityContext: ctx.personalityContext,
      languageContext: ctx.languageContext,
      recentMessages: ctx.recentMessages.map((m) => ({
        role: m.senderRole,
        text: m.text,
        createdAt: m.createdAt,
      })),
      retrievedMemories: ctx.memoryContext.memories.map((m) => ({
        factText: m.memory.factText,
        category: m.memory.category,
        status: m.memory.status,
      })),
      previousAssistantMessage,
    });

    // 7. In-Turn Proactive Intelligence Engine
    const proactiveEngine = ProactiveEngine.getInstance();
    ctx.proactivePolicy = proactiveEngine.analyze({
      query: ctx.textToProcess || ctx.cleanUserText || ctx.effectivePrompt,
      conversationState: ctx.conversationState,
      recentMessages: ctx.recentMessages.map((m) => ({
        role: m.senderRole,
        text: m.text,
        createdAt: m.createdAt,
      })),
    });

    // 8. Centralized Token Budget Allocation
    const candidateMemoryTokens = ctx.memoryContext.memories.reduce(
      (sum, m) => sum + TokenCounter.countTokens(m.memory.factText),
      0
    );
    const candidateHistoryChars = ctx.recentMessages.reduce(
      (sum, m) => sum + (m.text?.length || 0),
      0
    );

    const systemInstruction = SystemPromptBuilder.buildSystemInstruction(
      ctx.memoryContext.memories.map((m) => m.memory.factText),
      ctx.languageContext,
      ctx.personalityContext,
      ctx.personalizationPolicy,
      ctx.adaptiveResponsePolicy,
      ctx.proactivePolicy
    );

    const activeModelId = deps.aiRouter
      ? deps.aiRouter.resolveActiveModelId()
      : (deps.aiProvider?.getDefaultModel() || config.groq.primaryModel);

    ctx.tokenBudgetResult = deps.tokenBudgetManager.allocate({
      modelId: activeModelId,
      systemInstructionText: systemInstruction,
      userQueryText: ctx.effectivePrompt,
      mediaText: ctx.input.media ? ctx.effectivePrompt : undefined,
      candidateMemoryTokens,
      candidateHistoryTurns: ctx.recentMessages.length,
      candidateHistoryChars,
    });
  }
}
