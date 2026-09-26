import { SemanticCacheRepository } from '../../../database/repositories/semantic_cache.repo';
import { SemanticCandidateRepository } from '../../../database/repositories/semantic_candidate.repo';
import { TextNormalizer } from '../text_normalizer';
import { EmbeddingProvider } from '../embedding/embedding.interface';
import { logger } from '../../../core/logger';

export interface DeduplicationCheckResult {
  isDuplicate: boolean;
  isUncertain: boolean;
  needsReview: boolean;
  duplicateOf?: 'production_exact' | 'production_semantic' | 'candidate_exact' | 'candidate_intent';
  matchedId?: string;
  similarity?: number;
  reason?: string;
}

const COMMON_FUNCTION_STOPWORDS = new Set([
  // Arabic function words
  'ما', 'ماذا', 'من', 'هو', 'هي', 'هم', 'هن', 'ازاي', 'كيف', 'كيفية', 'طريقة', 'طريقه',
  'خطوات', 'في', 'على', 'عن', 'إلى', 'الي', 'هذا', 'هذه', 'تم', 'كان', 'يكون', 'عايز',
  'بدي', 'اريد', 'أريد', 'لو', 'ان', 'أن', 'هل', 'مع', 'بيا', 'لي', 'لنا', 'يا', 'ال',
  'لو', 'سمحت', 'ممكن', 'تقدر', 'اقدر', 'أقدر', 'بتاع', 'بتاعي', 'بتاعتي', 'خاص',
  // English function words
  'what', 'how', 'is', 'are', 'the', 'a', 'an', 'to', 'in', 'for', 'of', 'and', 'my',
  'your', 'do', 'can', 'i', 'you', 'we', 'it', 'on', 'at', 'be', 'this', 'that', 'with',
]);

export function extractSubstantiveTokens(tokens: string[]): string[] {
  return tokens.filter((t) => !COMMON_FUNCTION_STOPWORDS.has(t) && t.length > 1);
}

/**
 * Checks whether two token sets possess mutually distinct, substantive keywords
 * that distinguish their core intent/entity (e.g. "باسورد" vs "ايميل", "استرجاع" vs "استبدال").
 */
export function haveDistinctSubstantiveKeywords(tokensA: string[], tokensB: string[]): boolean {
  const substantiveA = extractSubstantiveTokens(tokensA);
  const substantiveB = extractSubstantiveTokens(tokensB);

  const setB = new Set(substantiveB);
  const setA = new Set(substantiveA);

  const uniqueToA = substantiveA.filter((t) => !setB.has(t));
  const uniqueToB = substantiveB.filter((t) => !setA.has(t));

  // If both sides have unique substantive keywords, they represent distinct concepts
  return uniqueToA.length > 0 && uniqueToB.length > 0;
}

function calculateJaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export class DeduplicationEngine {
  constructor(
    private semanticCacheRepo: SemanticCacheRepository = new SemanticCacheRepository(),
    private candidateRepo: SemanticCandidateRepository = new SemanticCandidateRepository(),
    private embeddingProvider?: EmbeddingProvider
  ) {}

  public async check(
    userText: string,
    intent: string
  ): Promise<DeduplicationCheckResult> {
    const normalizedInput = TextNormalizer.normalize(userText);
    const inputTokens = TextNormalizer.tokenize(userText);

    // 1. Check exact/normalized match in Production Semantic Cache (faq_items)
    const productionItems = await this.semanticCacheRepo.getAll({ activeOnly: true });
    for (const item of productionItems) {
      const examples = [...(item.examples || []), ...(item.patterns || [])];
      for (const ex of examples) {
        const normEx = TextNormalizer.normalize(ex);
        if (normEx === normalizedInput && normEx.length > 0) {
          return {
            isDuplicate: true,
            isUncertain: false,
            needsReview: false,
            duplicateOf: 'production_exact',
            matchedId: item.id,
            similarity: 1.0,
            reason: `Exact match with production cache example: "${ex}"`,
          };
        }

        // Token Jaccard check with Intent Entity Collision Guard
        const exTokens = TextNormalizer.tokenize(ex);
        const jaccard = calculateJaccardSimilarity(inputTokens, exTokens);
        if (jaccard >= 0.80) {
          // Verify that they don't have conflicting substantive keywords
          if (!haveDistinctSubstantiveKeywords(inputTokens, exTokens)) {
            return {
              isDuplicate: true,
              isUncertain: false,
              needsReview: false,
              duplicateOf: 'production_exact',
              matchedId: item.id,
              similarity: jaccard,
              reason: `High token overlap (${(jaccard * 100).toFixed(1)}%) with production item "${item.title}"`,
            };
          }
        }
      }
    }

    // 2. Check exact/normalized match in Existing Candidates (pending or validated)
    const pendingCandidates = await this.candidateRepo.list({ status: 'pending', limit: 100 });
    const validatedCandidates = await this.candidateRepo.list({ status: 'validated', limit: 100 });
    const candidates = [...pendingCandidates, ...validatedCandidates];

    for (const cand of candidates) {
      for (const ex of cand.inputExamples) {
        const normEx = TextNormalizer.normalize(ex);
        if (normEx === normalizedInput && normEx.length > 0) {
          return {
            isDuplicate: true,
            isUncertain: false,
            needsReview: false,
            duplicateOf: 'candidate_exact',
            matchedId: cand.id,
            similarity: 1.0,
            reason: `Exact match with existing candidate: "${cand.intent}"`,
          };
        }

        const exTokens = TextNormalizer.tokenize(ex);
        const jaccard = calculateJaccardSimilarity(inputTokens, exTokens);
        if (jaccard >= 0.80) {
          if (!haveDistinctSubstantiveKeywords(inputTokens, exTokens)) {
            return {
              isDuplicate: true,
              isUncertain: false,
              needsReview: false,
              duplicateOf: 'candidate_exact',
              matchedId: cand.id,
              similarity: jaccard,
              reason: `High token overlap with existing candidate: "${cand.intent}"`,
            };
          }
        }
      }

      // Check intent matching
      if (cand.intent.toLowerCase() === intent.toLowerCase()) {
        return {
          isDuplicate: true,
          isUncertain: false,
          needsReview: false,
          duplicateOf: 'candidate_intent',
          matchedId: cand.id,
          similarity: 0.9,
          reason: `Identical intent with existing candidate: "${cand.intent}"`,
        };
      }
    }

    // 3. Semantic Embedding Similarity check (if embedding provider is available)
    if (this.embeddingProvider) {
      try {
        const vector = await this.embeddingProvider.embed(userText);
        const matches = await this.semanticCacheRepo.findSimilar(vector, {
          limit: 1,
          threshold: 0.82,
        });

        if (matches.length > 0) {
          const topMatch = matches[0];
          const matchedTargetTokens = TextNormalizer.tokenize(
            `${topMatch.item.intent} ${topMatch.item.title} ${(topMatch.item.examples && topMatch.item.examples[0]) || ''}`
          );

          // Intent Collision Guard: Check if key entities differ (e.g. password vs email)
          const hasKeywordConflict = haveDistinctSubstantiveKeywords(inputTokens, matchedTargetTokens);

          // Near identical semantic match: check for keyword conflict first
          if (topMatch.similarity >= 0.93) {
            if (hasKeywordConflict) {
              // Different target entity despite high cosine similarity: PRESERVE as separate candidate marked for review
              return {
                isDuplicate: false,
                isUncertain: true,
                needsReview: true,
                matchedId: topMatch.item.id,
                similarity: topMatch.similarity,
                reason: `High similarity (${topMatch.similarity.toFixed(3)}) with production FAQ "${topMatch.item.title}", but distinct target keywords detected`,
              };
            }

            return {
              isDuplicate: true,
              isUncertain: false,
              needsReview: false,
              duplicateOf: 'production_semantic',
              matchedId: topMatch.item.id,
              similarity: topMatch.similarity,
              reason: `High semantic cosine similarity (${topMatch.similarity.toFixed(3)}) with production FAQ "${topMatch.item.title}"`,
            };
          }

          // Borderline semantic match (0.82 - 0.93): ALWAYS treat as review, NEVER auto-merge
          if (topMatch.similarity >= 0.82) {
            return {
              isDuplicate: false,
              isUncertain: true,
              needsReview: true,
              matchedId: topMatch.item.id,
              similarity: topMatch.similarity,
              reason: `Uncertain similarity (${topMatch.similarity.toFixed(3)}) with production FAQ "${topMatch.item.title}"`,
            };
          }
        }
      } catch (err: any) {
        logger.debug('Semantic deduplication vector search skipped', { error: err.message });
      }
    }

    // 4. Unique, safe candidate
    return {
      isDuplicate: false,
      isUncertain: false,
      needsReview: false,
    };
  }
}
