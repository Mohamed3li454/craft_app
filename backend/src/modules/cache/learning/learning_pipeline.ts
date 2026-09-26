import { SemanticCandidateRepository } from '../../../database/repositories/semantic_candidate.repo';
import { SemanticCacheRepository } from '../../../database/repositories/semantic_cache.repo';
import { LearningEligibilityFilter } from './learning_eligibility';
import { DeduplicationEngine, extractSubstantiveTokens } from './deduplication_engine';
import { ExampleSanitizer } from './example_sanitizer';
import { CandidateValidator } from './candidate_validator';
import { PromotionEvaluator } from './promotion_evaluator';
import { SemanticCacheCandidate } from '../../../database/repositories/semantic_candidate.types';
import { LocalLanguageDetector } from '../language_detector';
import { TextNormalizer } from '../text_normalizer';
import { EmbeddingProvider } from '../embedding/embedding.interface';
import { EmbeddingFactory } from '../embedding/embedding.factory';
import { LearningMetrics } from './learning_metrics';
import { logger } from '../../../core/logger';

export interface LearningRunInput {
  runId: string;
  userInput: string;
  replyText: string;
  toolCalls?: Array<{ toolName: string; arguments?: any; result?: any }>;
  modelUsed?: string;
  provider?: string;
  channel?: string;
}

export class LearningPipeline {
  private static instance: LearningPipeline;

  constructor(
    private candidateRepo: SemanticCandidateRepository = new SemanticCandidateRepository(),
    private semanticCacheRepo: SemanticCacheRepository = new SemanticCacheRepository(),
    private embeddingProvider?: EmbeddingProvider
  ) {
    if (!this.embeddingProvider) {
      this.embeddingProvider = EmbeddingFactory.createProvider();
    }
  }

  public static getInstance(): LearningPipeline {
    if (!LearningPipeline.instance) {
      LearningPipeline.instance = new LearningPipeline();
    }
    return LearningPipeline.instance;
  }

  /**
   * Observer hook called after AI response generation.
   * STRICT GUARANTEE: Non-blocking, failure-isolated.
   * If any step fails or crashes, it never affects the user response or WhatsApp delivery.
   */
  public async observeRun(input: LearningRunInput): Promise<void> {
    const startTime = Date.now();

    try {
      const userText = (input.userInput || '').trim();
      const replyText = (input.replyText || '').trim();

      if (!userText || !replyText) return;

      // 1. Eligibility Check (zero-LLM, ultra-fast deterministic filtering)
      const eligibility = LearningEligibilityFilter.evaluate({
        userInput: userText,
        replyText,
        toolCallsExecuted: input.toolCalls,
        modelUsed: input.modelUsed,
      });

      if (!eligibility.eligible) {
        LearningMetrics.record({
          eventName: 'learning_candidate_rejected',
          reason: eligibility.reason,
          details: eligibility.details,
          sourceModel: input.modelUsed,
          sourceProvider: input.provider,
          latencyMs: Date.now() - startTime,
        });
        return;
      }

      // 2. Language Detection
      const langResult = LocalLanguageDetector.detect(userText);
      const language = langResult.language || 'default';

      // 3. Example Sanitization & Generalization (Zero PII, Strip Conversational Noise)
      const sanitizeResult = ExampleSanitizer.sanitize(userText);
      if (!sanitizeResult.isValid || !sanitizeResult.sanitized) {
        LearningMetrics.record({
          eventName: 'learning_candidate_rejected',
          reason: 'unsupported',
          details: 'User query cannot be generalized into a valid anonymous FAQ example',
          sourceModel: input.modelUsed,
          sourceProvider: input.provider,
          latencyMs: Date.now() - startTime,
        });
        return;
      }
      const canonicalExample = sanitizeResult.sanitized;

      // 4. Formulate Deterministic Intent from substantive keywords
      const tokens = TextNormalizer.tokenize(canonicalExample);
      const substantive = extractSubstantiveTokens(tokens);
      const intentTokens = (substantive.length > 0 ? substantive : tokens).slice(0, 4);
      const cleanIntent = `faq_${intentTokens.join('_') || 'candidate'}`;

      // 5. Deduplication Check
      const dedupEngine = new DeduplicationEngine(
        this.semanticCacheRepo,
        this.candidateRepo,
        this.embeddingProvider
      );
      const dedupResult = await dedupEngine.check(canonicalExample, cleanIntent);

      if (dedupResult.isDuplicate) {
        if (
          dedupResult.matchedId &&
          (dedupResult.duplicateOf === 'candidate_exact' || dedupResult.duplicateOf === 'candidate_intent')
        ) {
          // Phase 6: Accumulate evidence on existing candidate rather than dropping it
          await this.accumulateEvidence(dedupResult.matchedId, canonicalExample, replyText, startTime);
          return;
        }

        LearningMetrics.record({
          eventName: 'learning_candidate_duplicate',
          reason: dedupResult.reason,
          duplicateOf: dedupResult.duplicateOf,
          intent: cleanIntent,
          latencyMs: Date.now() - startTime,
        });
        return;
      }

      // 6. Create Candidate Entry (strictly with 'pending' status, NEVER promoted)
      const candidate = await this.candidateRepo.create({
        intent: cleanIntent,
        category: 'learning_candidate',
        inputExamples: [canonicalExample],
        response: replyText,
        responseStrategy: 'static',
        responseTemplates: { default: [replyText] },
        language,
        sourceModel: input.modelUsed,
        sourceProvider: input.provider,
        sourceRunId: input.runId, // Opaque run ID only, NO user ID, NO phone number, NO conversation history
        confidence: 0.50,
        eligibilityReason: eligibility.reason,
        status: 'pending',
        observationCount: 1,
        uniqueExampleCount: 1,
        promotionEligible: false,
        rejectionReason: dedupResult.isUncertain ? 'needs_review: uncertain similarity' : undefined,
      });

      // Phase 6: Initial Promotion Evaluation (identifies initial blockers like insufficient observations)
      const allCandidates = await this.candidateRepo.list({ limit: 100 });
      const initialEval = await PromotionEvaluator.evaluate(
        candidate,
        allCandidates,
        undefined,
        this.embeddingProvider
      );

      await this.candidateRepo.updateEvidence(candidate.id, {
        confidence: initialEval.score,
        promotionEligible: initialEval.eligible,
        promotionReasons: initialEval.reasons,
        promotionBlockers: initialEval.blockers,
        semanticConsistency: initialEval.evidence.semanticConsistency,
      });

      LearningMetrics.record({
        eventName: 'learning_candidate_created',
        candidateId: candidate.id,
        intent: candidate.intent,
        language: candidate.language,
        strategy: candidate.responseStrategy,
        sourceModel: input.modelUsed,
        sourceProvider: input.provider,
        latencyMs: Date.now() - startTime,
      });
    } catch (err: any) {
      // Complete failure isolation: log warning and swallow exception
      logger.warn('Error in LearningPipeline.observeRun (swallowed safely)', { error: err.message });
      LearningMetrics.record({
        eventName: 'learning_candidate_failed',
        reason: 'pipeline_exception',
        details: err.message,
        latencyMs: Date.now() - startTime,
      });
    }
  }

  /**
   * Accumulates observation evidence on an existing candidate.
   * Updates observation count, unique example diversity, and triggers deterministic promotion evaluation.
   */
  private async accumulateEvidence(
    candidateId: string,
    canonicalExample: string,
    replyText: string,
    startTime: number
  ): Promise<void> {
    const existing = await this.candidateRepo.findById(candidateId);
    if (!existing) return;

    // Check if canonicalExample is already in candidate.inputExamples
    const normNewEx = TextNormalizer.normalize(canonicalExample);
    const alreadyExists = existing.inputExamples.some(
      (ex) => TextNormalizer.normalize(ex) === normNewEx
    );

    let updatedExamples = existing.inputExamples;
    let duplicateCount = existing.duplicateCount;

    if (alreadyExists) {
      duplicateCount += 1;
    } else {
      updatedExamples = [...existing.inputExamples, canonicalExample].slice(0, 10);
    }

    const observationCount = existing.observationCount + 1;
    const uniqueExampleCount = updatedExamples.length;

    const tempCandidate: SemanticCacheCandidate = {
      ...existing,
      observationCount,
      uniqueExampleCount,
      inputExamples: updatedExamples,
      duplicateCount,
      lastObservedAt: new Date().toISOString(),
    };

    const allCandidates = await this.candidateRepo.list({ limit: 100 });
    const evalResult = await PromotionEvaluator.evaluate(
      tempCandidate,
      allCandidates,
      undefined,
      this.embeddingProvider
    );

    await this.candidateRepo.updateEvidence(candidateId, {
      observationCount,
      uniqueExampleCount,
      inputExamples: updatedExamples,
      duplicateCount,
      confidence: evalResult.score,
      semanticConsistency: evalResult.evidence.semanticConsistency,
      promotionEligible: evalResult.eligible,
      promotionReasons: evalResult.reasons,
      promotionBlockers: evalResult.blockers,
    });

    LearningMetrics.record({
      eventName: 'learning_evidence_observed',
      candidateId,
      intent: existing.intent,
      observationCount,
      uniqueExampleCount,
      duplicateCount,
      confidence: evalResult.score,
      latencyMs: Date.now() - startTime,
    });

    if (evalResult.eligible && !existing.promotionEligible) {
      LearningMetrics.record({
        eventName: 'learning_candidate_promotion_eligible',
        candidateId,
        intent: existing.intent,
        score: evalResult.score,
      });
    }

    if (evalResult.blockers.length > 0) {
      LearningMetrics.record({
        eventName: 'learning_candidate_blocked',
        candidateId,
        intent: existing.intent,
        blockers: evalResult.blockers,
      });
    }
  }
}
