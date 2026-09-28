/**
 * Memory Architecture - Selective Retrieval Service (Phase 3 Retrieval Intelligence)
 *
 * Deterministic, zero-LLM, zero-network service that selectively retrieves
 * only relevant active user memories, ranking them by query intent, lexical overlap,
 * category intent, temporal alignment, importance, and confidence, with strict
 * redundancy control and deterministic tie-breaking.
 */

import { MemoryRepository } from '../../database/repositories/memory.repo';
import {
  MemoryCategory,
  MemoryItem,
  MemoryRetrievalQuery,
  RetrievedMemory,
  QueryIntentAnalysis,
  DEFAULT_MEMORY_RETRIEVAL_LIMIT,
  MIN_MEMORY_RELEVANCE_THRESHOLD,
  normalizeFactText,
  calculateTokenSimilarity,
} from './types';
import { MemoryItemEntity } from '../../database/repositories/types';
import { MemorySafetyGate } from './memory_safety_gate';
import { logger } from '../../core/logger';
import { MetricsCollector } from '../observability';

// Common stop words to exclude from lexical overlap calculation
const STOP_WORDS = new Set([
  // Arabic stop words
  'في', 'من', 'على', 'إلى', 'الي', 'عن', 'مع', 'هو', 'هي', 'أن', 'ان', 'إن', 'هل',
  'ما', 'ماذا', 'إيه', 'ايه', 'ازاي', 'ازاى', 'كيف', 'ليه', 'لماذا', 'كام', 'فين',
  'أين', 'اين', 'ده', 'دي', 'كده', 'كدة', 'هذا', 'هذه', 'ذلك', 'تلك', 'كل', 'بعض',
  'لو', 'إذا', 'اذا', 'عشان', 'علشان', 'بين', 'حول', 'فوق', 'تحت', 'أو', 'او', 'ثم',
  'يا', 'يا ترى', 'يعني', 'يعنى', 'ممكن', 'ياريت', 'يا ريت',
  // English stop words
  'the', 'is', 'are', 'was', 'were', 'a', 'an', 'and', 'or', 'of', 'to', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'up', 'about', 'into', 'over', 'after',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we',
  'they', 'what', 'which', 'who', 'whom', 'whose', 'how', 'why', 'where', 'when',
  'can', 'could', 'do', 'does', 'did', 'have', 'has', 'had', 'be', 'been', 'being',
  'my', 'your', 'his', 'her', 'their', 'our', 'me', 'him', 'us', 'them',
]);

// Tech and Programming keywords mapping
const TECH_KEYWORDS = [
  'flutter', 'dart', 'bloc', 'cubit', 'provider', 'riverpod', 'getx',
  'react', 'react native', 'vue', 'angular', 'svelte', 'next.js', 'nextjs',
  'node', 'nodejs', 'express', 'nest', 'nestjs', 'fastify',
  'python', 'django', 'fastapi', 'flask', 'pandas', 'numpy',
  'java', 'kotlin', 'swift', 'swiftui', 'objective-c', 'ios', 'android',
  'rust', 'golang', 'go', 'c++', 'c#', '.net', 'dotnet',
  'sql', 'postgresql', 'postgres', 'mysql', 'sqlite', 'mongodb', 'redis', 'supabase', 'firebase',
  'docker', 'kubernetes', 'k8s', 'aws', 'azure', 'gcp', 'ci/cd', 'git', 'github', 'gitlab',
  'api', 'rest', 'graphql', 'grpc', 'websocket', 'sdk', 'cli',
  'ui', 'ux', 'widget', 'state management', 'architecture',
  'optimize', 'optimization', 'performance', 'build', 'compile', 'debug', 'profiling',
  'code', 'coding', 'backend', 'frontend', 'fullstack', 'database',
  'authentication', 'auth', 'framework', 'frameworks', 'library', 'libraries',
  'tools', 'technology', 'technologies',
  // Arabic explicit tech anchors
  'فلاتر', 'دارت', 'بلوك', 'كيوبت', 'رياكت', 'رياكت نيتف', 'بايثون', 'كود', 'أكواد',
  'برمجة', 'برمجي', 'برمجية', 'مبرمج', 'مطور', 'تطوير برمجيات', 'تطوير البرمجيات',
  'قاعدة بيانات', 'سيرفر', 'باك إند', 'فرونت إند', 'أداء', 'تحسين أداء', 'ستيت مانجمنت',
  'أندرويد', 'آيفون', 'فريم ورك', 'إطار عمل', 'تقنية', 'تقنيات', 'أدوات',
];

// Career / Profession keywords mapping
const PROFESSION_KEYWORDS = [
  'شغلانتي', 'شغلي', 'وظيفتي', 'مهنتي', 'أنا شغال إيه', 'أنا بشتغل إيه',
  'أنا شغال على إيه', 'أنا شغال على ايه', 'شغال على إيه', 'شغال على ايه',
  'شغال إيه', 'شغال ايه', 'شغال بإيه', 'شغال بايه', 'بشتغل إيه', 'بشتغل ايه', 'بشتغل بإيه', 'بشتغل بايه',
  'شغال فيها', 'كنت شغال فيها', 'كنت شغال', 'شغال مع', 'بشتغل مع',
  'عملي', 'مجال عملي', 'مجال تخصصي', 'تخصصي', 'شركتي', 'شركة', 'الشركة', 'شركات', 'الشركات',
  'مهندس', 'مطور', 'مبرمج',
  'job', 'profession', 'career', 'my job', 'what is my job', 'what do i do',
  'my profession', 'my company', 'work as', 'working as', 'occupation', 'what am i working on',
  'company', 'companies', 'worked at',
];

// Identity keywords mapping
const IDENTITY_KEYWORDS = [
  'اسمي', 'أنا اسمي', 'اسمي إيه', 'مين أنا', 'تعرفني', 'اسم المستخدم',
  'who am i', 'what is my name', 'my name', 'do you know my name', 'my identity',
];

// Location keywords mapping
const LOCATION_KEYWORDS = [
  'عايش فين', 'ساكن فين', 'مدينتي', 'بلدي', 'عنواني', 'مكاني', 'أنا فين',
  'where do i live', 'my city', 'my country', 'my location', 'where am i located',
];

// Interests keywords mapping
const INTERESTS_KEYWORDS = [
  'هواياتي', 'بحب إيه', 'اهتماماتي', 'مهتم بإيه', 'وقت فراغي', 'قراءة', 'رياضة',
  'my hobbies', 'what do i like', 'my interests', 'what i enjoy', 'hobbies',
];

// Technical entity identification registry
const TECH_ENTITY_MAP: Array<{ id: string; keywords: string[] }> = [
  { id: 'flutter', keywords: ['flutter', 'فلاتر'] },
  { id: 'dart', keywords: ['dart', 'دارت'] },
  { id: 'react', keywords: ['react', 'رياكت'] },
  { id: 'react_native', keywords: ['react native', 'رياكت نيتف'] },
  { id: 'python', keywords: ['python', 'بايثون'] },
  { id: 'docker', keywords: ['docker', 'دوكر'] },
  { id: 'kubernetes', keywords: ['kubernetes', 'k8s'] },
  { id: 'supabase', keywords: ['supabase', 'سوبابيز'] },
  { id: 'postgresql', keywords: ['postgresql', 'postgres', 'بوستجرس'] },
  { id: 'mongodb', keywords: ['mongodb', 'مونجو'] },
  { id: 'redis', keywords: ['redis', 'ريديس'] },
  { id: 'nodejs', keywords: ['nodejs', 'node.js', 'node', 'نود'] },
  { id: 'typescript', keywords: ['typescript', 'تايب سكريبت'] },
  { id: 'javascript', keywords: ['javascript', 'جافا سكريبت'] },
  { id: 'rust', keywords: ['rust', 'رست'] },
  { id: 'golang', keywords: ['golang', 'go', 'جولانج'] },
  { id: 'bloc', keywords: ['bloc', 'بلوك'] },
  { id: 'cubit', keywords: ['cubit', 'كيوبت'] },
];

export class MemoryRetrievalService {
  private static instance: MemoryRetrievalService;

  constructor(private memoryRepo: MemoryRepository) {}

  public static getInstance(memoryRepo?: MemoryRepository): MemoryRetrievalService {
    if (!MemoryRetrievalService.instance) {
      MemoryRetrievalService.instance = new MemoryRetrievalService(
        memoryRepo || new MemoryRepository()
      );
    } else if (memoryRepo) {
      MemoryRetrievalService.instance.memoryRepo = memoryRepo;
    }
    return MemoryRetrievalService.instance;
  }

  /**
   * Deterministically analyzes query intent, topics, entities, temporal direction, and negative constraints.
   */
  public analyzeQueryIntent(message: string): QueryIntentAnalysis {
    const rawMessage = message || '';
    const lower = rawMessage.toLowerCase();
    const normalizedTokens = this.tokenize(rawMessage);
    const detectedCategories = this.detectQueryCategories(rawMessage, normalizedTokens);
    const technicalEntities = this.detectTechEntities(rawMessage);

    // 1. Identity intent
    const isIdentityIntent = IDENTITY_KEYWORDS.some((kw) => lower.includes(kw));

    // 2. Pure preference / language / personality directive
    const isPureLanguageDirective =
      /^(?:(?:تكلم|اتكلم|رد|اكتب|خليك)\s+(?:معايا\s+)?(?:عربي|بالعربي|إنجليزي|بالإنجليزي|انجليزي|بالانجليزي)|(?:speak|reply|respond|write)\s+in\s+(?:arabic|english))$/i.test(rawMessage.trim());

    const isPurePersonalityDirective =
      /^(?:(?:خليك|خلّيك|كن)\s+(?:مختصر|موجز|مفصل|ودود|رسمي|سريع)|(?:be\s+concise|be\s+brief|be\s+formal|be\s+friendly))$/i.test(rawMessage.trim());

    const isPurePreferenceDirective = isPureLanguageDirective || isPurePersonalityDirective;
    const isPreferenceIntent =
      isPurePreferenceDirective ||
      /(?:لغة|لهجة|أسلوب|اسلوب|مختصر|طويل|language|dialect|tone|style|personality)/i.test(lower);

    // 3. Project & Work Intent
    const isProjectIntent = /(?:مشروع|مشروعي|ابلكيشن|تطبيق|project|app|architecture|بناء)/i.test(lower);
    const isWorkIntent = /(?:شغل|شغلي|وظيفتي|مهنتي|مهندس|مطور|job|career|work|company|شركة)/i.test(lower);

    // 4. Temporal Intent
    const isAskingCurrent =
      /(?:دلوقتي|حاليًا|حاليا|الآن|الان|النهارده|النهاردة|اليوم|شغال\s+على\s+إيه|شغال\s+على\s+ايه|شغال\s+إيه|شغال\s+ايه|currently|right\s+now|at\s+the\s+moment|now|what\s+am\s+i\s+working\s+on|presently)/i.test(lower);

    const isAskingHistorical =
      /(?:زمان|سابقًا|سابقا|كنت|قبل\s+كده|قبل\s+كدة|في\s+الماضي|previously|used\s+to|in\s+the\s+past|formerly|what\s+did\s+i\s+use|what\s+technologies\s+have\s+i\s+used|past)/i.test(lower);

    const isAskingPlanned =
      /(?:مخطط|هبدأ|ناوي|مستقبلاً|مستقبلا|الأسبوع\s+الجاي|الاسبوع\s+الجاي|الشهر\s+الجاي|planning|plans|future|going\s+to|will\s+learn)/i.test(lower);

    const isGeneralTimeline =
      /(?:إيه\s+التقنيات\s+اللي\s+استخدمتها|ايه\s+التقنيات\s+اللي\s+استخدمتها|technologies\s+i\s+have\s+used|what\s+technologies\s+have\s+i\s+worked\s+with|إيه\s+كل\s+التقنيات|all\s+technologies)/i.test(lower);

    let temporalIntent: 'current' | 'historical' | 'planned' | 'both_historical_and_current' | 'neutral' = 'neutral';
    if (isGeneralTimeline || (isAskingCurrent && isAskingHistorical)) {
      temporalIntent = 'both_historical_and_current';
    } else if (isAskingCurrent) {
      temporalIntent = 'current';
    } else if (isAskingHistorical) {
      temporalIntent = 'historical';
    } else if (isAskingPlanned) {
      temporalIntent = 'planned';
    }

    // 5. Negated / Cessation entities extraction (Section 13: Runtime user signal vs stale memory)
    const negatedEntities: string[] = [];
    const cessationRegexes = [
      /(?:بطلت|سيبت|سبت|تركت|مش\s+شغال\s+بـ?|مش\s+شغال\s+على|مش\s+بستخدم|لم\s+أعد\s+أستخدم|لم\s+اعد\s+استخدم|وقفت\s+استخدام|ما\s+بقتش\s+بستخدم|مابقتش\s+بستخدم|عمري\s+ما\s+استخدمت|ما\s+استخدمتش)\s+([a-zA-Z0-9+#.\-_]+|فلاتر|دارت|رياكت|بايثون|دوكر|نود)/gi,
      /(?:stopped\s+using|quit|left|no\s+longer\s+use|don['’]?t\s+use|not\s+using|never\s+used)\s+([a-zA-Z0-9+#.\-_]+)/gi,
    ];

    for (const rx of cessationRegexes) {
      let match: RegExpExecArray | null;
      while ((match = rx.exec(rawMessage)) !== null) {
        if (match[1]) {
          const entity = match[1].toLowerCase().trim();
          if (entity.length > 1) {
            negatedEntities.push(entity);
            if (entity === 'فلاتر') negatedEntities.push('flutter');
            if (entity === 'رياكت') negatedEntities.push('react');
            if (entity === 'دارت') negatedEntities.push('dart');
            if (entity === 'بايثون') negatedEntities.push('python');
            if (entity === 'دوكر') negatedEntities.push('docker');
          }
        }
      }
    }

    return {
      rawMessage,
      normalizedTokens,
      detectedCategories,
      topics: technicalEntities,
      technicalEntities,
      temporalIntent,
      isIdentityIntent,
      isPreferenceIntent,
      isPurePreferenceDirective,
      isProjectIntent,
      isWorkIntent,
      negatedEntities,
    };
  }

  /**
   * Detects known technical entities mentioned within text.
   */
  public detectTechEntities(text: string): string[] {
    if (!text) return [];
    const lower = text.toLowerCase();
    const entities = new Set<string>();

    for (const entry of TECH_ENTITY_MAP) {
      if (entry.keywords.some((kw) => lower.includes(kw))) {
        entities.add(entry.id);
      }
    }

    return Array.from(entities);
  }

  /**
   * Checks whether a candidate memory is semantically redundant with an already-selected candidate.
   * Preserves distinct numbered entities, differing categories, and differing temporal states.
   */
  public isRedundant(
    candidate: RetrievedMemory,
    selected: readonly RetrievedMemory[]
  ): boolean {
    return selected.some((existing) => {
      // 1. Redundancy only applies when facts share the same temporal state
      if (existing.memory.temporalState !== candidate.memory.temporalState) {
        return false;
      }

      // 2. Differentiating numbers (e.g. "1" vs "2" or "رقم 1" vs "رقم 2") prevent redundancy
      const numMatchCand = candidate.memory.factText.match(/\b\d+\b/g);
      const numMatchExist = existing.memory.factText.match(/\b\d+\b/g);
      if (numMatchCand && numMatchExist) {
        const setCand = new Set(numMatchCand);
        const setExist = new Set(numMatchExist);
        const diffNum = [...setCand].some((n) => !setExist.has(n)) || [...setExist].some((n) => !setCand.has(n));
        if (diffNum) {
          return false;
        }
      }

      // 3. Same factKey in same category
      if (
        candidate.memory.factKey &&
        existing.memory.factKey &&
        candidate.memory.factKey === existing.memory.factKey &&
        candidate.memory.category === existing.memory.category
      ) {
        return true;
      }

      // 4. Same category redundancy
      if (existing.memory.category === candidate.memory.category) {
        // High token similarity
        const sim = calculateTokenSimilarity(existing.memory.factText, candidate.memory.factText);
        if (sim >= 0.55) {
          return true;
        }

        // Shared tech entities in same category:
        // If both share the exact same tech entities (e.g. both are about ['flutter'])
        // and neither introduces a distinct secondary tech entity, they represent the same core signal.
        const existingTech = this.detectTechEntities(existing.memory.factText);
        const candidateTech = this.detectTechEntities(candidate.memory.factText);
        if (
          existingTech.length > 0 &&
          candidateTech.length > 0 &&
          existingTech.length === candidateTech.length &&
          existingTech.every((t) => candidateTech.includes(t))
        ) {
          return true;
        }
      }

      return false;
    });
  }

  /**
   * Selectively retrieves relevant active memories for a given user query.
   * Implements strict candidate eligibility hard gates, deterministic scoring,
   * redundancy control, diversity preservation, and deterministic tie-breaking.
   */
  public async retrieve(query: MemoryRetrievalQuery): Promise<RetrievedMemory[]> {
    MetricsCollector.getInstance().increment('craft.memory.retrieval', 1);
    if (!query.userId) return [];

    const limit = query.limit ?? DEFAULT_MEMORY_RETRIEVAL_LIMIT;
    const message = query.message || '';

    // Stage 1: Deterministic Query Intent Analysis
    const queryAnalysis = this.analyzeQueryIntent(message);

    // Section 14: Preference Boundary
    // If the query is a pure language/personality directive, general memory retrieval
    // must immediately return empty [] to avoid cross-layer contamination.
    if (queryAnalysis.isPurePreferenceDirective) {
      logger.debug('Query is pure preference directive; returning empty general memory context', {
        userId: query.userId,
      });
      return [];
    }

    // Stage 2: Candidate Eligibility (Hard Gates)
    const rawMemories = await this.memoryRepo.getActiveMemories(query.userId, 50);
    const now = Date.now();

    const candidates = rawMemories.filter((item) => {
      // Gate 1: Strict preferences isolation: user_preferences must NEVER be retrieved as generic memories
      if (
        item.category === 'language_preference' ||
        item.category === 'personality_preference'
      ) {
        return false;
      }

      // Gate 2: Lifecycle status: active only (exclude superseded and expired)
      const status = item.status || 'active';
      if (status !== 'active') return false;

      // Gate 3: Temporal validity: active within validUntil window
      if (item.validUntil) {
        const validUntilMs = new Date(item.validUntil).getTime();
        if (!isNaN(validUntilMs) && validUntilMs <= now) {
          return false;
        }
      }

      // Gate 4: Optional query category filter
      if (query.categories && query.categories.length > 0) {
        if (!query.categories.includes(item.category as MemoryCategory)) {
          return false;
        }
      }

      // Gate 5: Phase 2.8: Defense-in-depth safety gate evaluation on active retrieved candidate
      const safety = MemorySafetyGate.getInstance().evaluate(item.factText, item.category);
      if (!safety.allowed) {
        return false;
      }

      // Gate 6: Section 13: Runtime Negation Gate (User statement vs Stale Memory)
      if (queryAnalysis.negatedEntities.length > 0) {
        const lowerFact = (item.factText || '').toLowerCase();
        const hasNegatedEntity = queryAnalysis.negatedEntities.some((ne) => lowerFact.includes(ne));
        if (hasNegatedEntity) {
          const tState = item.temporalState || (item.category === 'ephemeral_context' ? 'temporary' : 'unknown');
          if (tState === 'current' || tState === 'unknown') {
            // Memory asserts current usage of an entity user explicitly negated in the current message
            return false;
          }
        }
      }

      return true;
    });

    if (candidates.length === 0) {
      return [];
    }

    // Stage 3: Deterministic Relevance Matching & Scoring
    const scored: RetrievedMemory[] = [];

    for (const candidate of candidates) {
      const factText = candidate.factText || '';
      const factTokens = this.tokenize(factText);
      const category = candidate.category as MemoryCategory;

      const { score, reason } = this.calculateRelevanceScore(
        message,
        queryAnalysis.normalizedTokens,
        queryAnalysis.detectedCategories,
        factText,
        factTokens,
        category,
        candidate,
        queryAnalysis
      );

      if (score >= MIN_MEMORY_RELEVANCE_THRESHOLD) {
        // Convert to MemoryItem contract
        const memoryItem: MemoryItem = {
          id: candidate.id,
          userId: candidate.userId,
          factText: candidate.factText,
          category: candidate.category as MemoryCategory,
          status: (candidate.status as any) || 'active',
          factKey: candidate.factKey,
          source: (candidate.source as any) || 'automatic_extraction',
          confidence: candidate.confidence ?? 1.0,
          importance: (candidate.importance as any) || 'normal',
          temporalState: candidate.temporalState || (candidate.category === 'ephemeral_context' ? 'temporary' : 'unknown'),
          validFrom: candidate.validFrom ? new Date(candidate.validFrom) : null,
          validUntil: candidate.validUntil ? new Date(candidate.validUntil) : null,
          metadata: candidate.metadata || {},
          createdAt: candidate.createdAt ? new Date(candidate.createdAt) : new Date(),
          updatedAt: candidate.updatedAt ? new Date(candidate.updatedAt) : new Date(),
        };

        scored.push({
          memory: memoryItem,
          relevanceScore: Math.round(score * 1000) / 1000,
          retrievalReason: reason,
        });
      }
    }

    // Stage 4: Deterministic Ranking & Tie-breaking (Section 12)
    // Order: score DESC -> importance DESC -> confidence DESC -> updatedAt DESC -> id ASC
    scored.sort((a, b) => {
      // 1. Primary: Relevance score DESC
      const scoreDiff = b.relevanceScore - a.relevanceScore;
      if (Math.abs(scoreDiff) >= 0.001) {
        return scoreDiff;
      }
      // 2. Secondary: Importance level DESC (critical: 4, high: 3, normal: 2, low: 1)
      const impWeight: Record<string, number> = { critical: 4, high: 3, normal: 2, low: 1 };
      const impA = impWeight[a.memory.importance || 'normal'] || 2;
      const impB = impWeight[b.memory.importance || 'normal'] || 2;
      if (impB !== impA) {
        return impB - impA;
      }
      // 3. Tertiary: Confidence score DESC
      const confA = a.memory.confidence ?? 1.0;
      const confB = b.memory.confidence ?? 1.0;
      if (Math.abs(confB - confA) >= 0.001) {
        return confB - confA;
      }
      // 4. Quaternary: Recency (updatedAt DESC)
      const timeA = a.memory.updatedAt?.getTime() || 0;
      const timeB = b.memory.updatedAt?.getTime() || 0;
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      // 5. Final deterministic tie-breaker: id ASC
      return (a.memory.id || '').localeCompare(b.memory.id || '');
    });

    // Stage 5: Redundancy Control & Diversity (Sections 8 & 9)
    // Select best representations while avoiding redundant duplicate signals in context
    const nonRedundant: RetrievedMemory[] = [];
    for (const item of scored) {
      if (nonRedundant.length >= limit) break;

      const isRedundant = this.isRedundant(item, nonRedundant);
      if (!isRedundant) {
        nonRedundant.push(item);
      }
    }

    const selected = nonRedundant.slice(0, limit);
    MetricsCollector.getInstance().increment('craft.memory.selected', selected.length);
    MetricsCollector.getInstance().increment('craft.memory.blocked', Math.max(0, candidates.length - selected.length));

    logger.debug('Selective memory retrieval completed', {
      userId: query.userId,
      totalCandidates: candidates.length,
      scoredCount: scored.length,
      selectedCount: selected.length,
      reasons: selected.map((s) => `${s.memory.category}: ${s.retrievalReason} (${s.relevanceScore})`),
    });

    return selected;
  }

  /**
   * Deterministically calculates relevance score for a single candidate fact.
   */
  public calculateRelevanceScore(
    message: string,
    queryTokens: string[],
    queryCategories: Set<MemoryCategory>,
    factText: string,
    factTokens: string[],
    category: MemoryCategory,
    entity: MemoryItemEntity,
    queryAnalysis?: QueryIntentAnalysis
  ): { score: number; reason: string } {
    const lowerMessage = message.toLowerCase();
    const lowerFact = factText.toLowerCase();

    // Section 13: Runtime user negation rule
    if (queryAnalysis && queryAnalysis.negatedEntities.length > 0) {
      const isNegated = queryAnalysis.negatedEntities.some((ne) => lowerFact.includes(ne));
      if (isNegated) {
        const tState = entity.temporalState || (entity.category === 'ephemeral_context' ? 'temporary' : 'unknown');
        if (tState === 'current' || tState === 'unknown') {
          return {
            score: 0,
            reason: 'negated_by_current_statement: user stated cessation of entity in current message',
          };
        }
      }
    }

    // 1. Lexical Overlap Calculation
    const commonTokens: string[] = [];
    const factTokenSet = new Set(factTokens);
    for (const token of queryTokens) {
      if (factTokenSet.has(token) && !STOP_WORDS.has(token)) {
        commonTokens.push(token);
      }
    }

    let lexicalScore = 0;
    if (commonTokens.length > 0) {
      const minLen = Math.min(queryTokens.length, factTokens.length);
      lexicalScore = Math.min(0.65, (commonTokens.length / Math.max(1, minLen)) * 0.45 + commonTokens.length * 0.1);
    }

    // Direct tech/keyword substring containment boost
    let directSubstringMatch = false;
    for (const kw of TECH_KEYWORDS) {
      if (lowerMessage.includes(kw) && lowerFact.includes(kw)) {
        lexicalScore = Math.max(lexicalScore, 0.45);
        if (!commonTokens.includes(kw)) {
          commonTokens.push(kw);
        }
        directSubstringMatch = true;
      }
    }

    // 2. Category Relevance / Intent Boost
    let categoryBoost = 0;
    if (queryCategories.has(category)) {
      if (category === 'identity') {
        categoryBoost = 0.40;
      } else if (category === 'profession' || category === 'technical_context') {
        categoryBoost = 0.35;
      } else if (category === 'stable_fact') {
        categoryBoost = 0.30;
      } else {
        categoryBoost = 0.25;
      }
    }

    // Cross-link: tech message + Flutter/developer fact
    if (
      (queryCategories.has('technical_context') || queryCategories.has('profession')) &&
      (category === 'profession' || category === 'technical_context') &&
      (lowerFact.includes('flutter') || lowerFact.includes('مطور') || lowerFact.includes('dev'))
    ) {
      categoryBoost = Math.max(categoryBoost, 0.35);
    }

    // IMPORTANT NEGATIVE RULE:
    // If there is zero lexical overlap and zero category intent, the item MUST have score 0.
    // Importance, recency, and confidence CANNOT boost an irrelevant item into context!
    if (lexicalScore === 0 && categoryBoost === 0) {
      return { score: 0, reason: 'unrelated: no lexical or category match' };
    }

    let baseScore = lexicalScore + categoryBoost;

    // 3. Importance Boost (only applied if item already has topical relevance)
    const importance = entity.importance || 'normal';
    let importanceBoost = 0;
    if (importance === 'critical') importanceBoost = 0.10;
    else if (importance === 'high') importanceBoost = 0.05;
    else if (importance === 'low') importanceBoost = -0.05;

    // 4. Temporal Intent Awareness & Alignment
    const isAskingCurrent =
      queryAnalysis?.temporalIntent === 'current' ||
      queryAnalysis?.temporalIntent === 'both_historical_and_current' ||
      /(?:دلوقتي|حاليًا|حاليا|الآن|الان|النهارده|النهاردة|اليوم|شغال\s+على\s+إيه|شغال\s+على\s+ايه|currently|right\s+now|at\s+the\s+moment|now|what\s+am\s+i\s+working\s+on|presently)/i.test(lowerMessage);

    const isAskingHistorical =
      queryAnalysis?.temporalIntent === 'historical' ||
      queryAnalysis?.temporalIntent === 'both_historical_and_current' ||
      /(?:زمان|سابقًا|سابقا|كنت|قبل\s+كده|قبل\s+كدة|في\s+الماضي|previously|used\s+to|in\s+the\s+past|formerly|what\s+did\s+i\s+use|past)/i.test(lowerMessage);

    const isAskingPlanned =
      queryAnalysis?.temporalIntent === 'planned' ||
      /(?:مخطط|هبدأ|ناوي|مستقبلاً|مستقبلا|الأسبوع\s+الجاي|الاسبوع\s+الجاي|الشهر\s+الجاي|planning|plans|future|going\s+to)/i.test(lowerMessage);

    const entityTemporalState = entity.temporalState || (entity.category === 'ephemeral_context' ? 'temporary' : 'unknown');

    let temporalAdjustment = 0;
    const temporalReasons: string[] = [];

    if (isAskingCurrent && !isAskingHistorical) {
      if (entityTemporalState === 'historical') {
        // Severe penalty for historical facts when explicitly asked about current work
        temporalAdjustment -= 0.50;
        temporalReasons.push('temporal_penalty:historical');
      } else if (entityTemporalState === 'planned') {
        temporalAdjustment -= 0.25;
        temporalReasons.push('temporal_penalty:planned');
      } else if (entityTemporalState === 'current') {
        temporalAdjustment += 0.05;
        temporalReasons.push('temporal_match:current');
      }
      // 'unknown' temporal state remains strictly neutral (0.0 adjustment)
    } else if (isAskingHistorical && !isAskingCurrent) {
      if (entityTemporalState === 'historical') {
        temporalAdjustment += 0.35;
        temporalReasons.push('temporal_boost:historical');
      } else if (entityTemporalState === 'current') {
        temporalAdjustment -= 0.20;
        temporalReasons.push('temporal_penalty:current_not_historical');
      } else if (entityTemporalState === 'planned') {
        temporalAdjustment -= 0.30;
        temporalReasons.push('temporal_penalty:planned_not_historical');
      }
      // 'unknown' temporal state remains strictly neutral (0.0 adjustment)
    } else if (isAskingHistorical && isAskingCurrent) {
      // Query asks about entire timeline (past and present)
      if (entityTemporalState === 'historical') {
        temporalAdjustment += 0.15;
        temporalReasons.push('temporal_match:historical_and_current');
      } else if (entityTemporalState === 'current') {
        temporalAdjustment += 0.15;
        temporalReasons.push('temporal_match:historical_and_current');
      }
    } else if (isAskingPlanned) {
      if (entityTemporalState === 'planned') {
        temporalAdjustment += 0.35;
        temporalReasons.push('temporal_boost:planned');
      } else if (entityTemporalState === 'historical') {
        temporalAdjustment -= 0.20;
      }
    }

    // 5. Confidence Adjustment (multiplier)
    const confidence = entity.confidence ?? 1.0;
    const confidenceMultiplier = 0.8 + 0.2 * confidence;

    // 6. Recency Micro-Boost (tie-breaker: <= 0.01)
    const ageInHours = Math.max(0, (Date.now() - new Date(entity.updatedAt || entity.createdAt).getTime()) / (1000 * 3600));
    const recencyBoost = ageInHours < 48 ? 0.01 : 0.0;

    let finalScore = (baseScore + importanceBoost + temporalAdjustment) * confidenceMultiplier + recencyBoost;
    finalScore = Math.max(0, Math.min(1.0, finalScore));

    // Construct descriptive reason
    const reasons: string[] = [];
    if (commonTokens.length > 0) {
      reasons.push(`overlap:[${commonTokens.slice(0, 3).join(',')}]`);
    } else if (directSubstringMatch) {
      reasons.push('direct_keyword_match');
    }
    if (categoryBoost > 0) {
      reasons.push(`category:${category}`);
    }
    if (importanceBoost > 0) {
      reasons.push(`importance:${importance}`);
    }
    if (temporalReasons.length > 0) {
      reasons.push(...temporalReasons);
    }

    return {
      score: finalScore,
      reason: reasons.join(' + ') || 'general_relevance',
    };
  }

  /**
   * Detects probable memory categories matching the user message intent.
   */
  public detectQueryCategories(message: string, tokens: string[]): Set<MemoryCategory> {
    const detected = new Set<MemoryCategory>();
    const lower = message.toLowerCase();

    // 1. Tech & Programming Intent
    const hasTechWord = TECH_KEYWORDS.some((kw) => lower.includes(kw));
    if (hasTechWord) {
      detected.add('technical_context');
      detected.add('profession');
    }

    // 2. Profession / Job Intent
    const hasJobWord = PROFESSION_KEYWORDS.some((kw) => lower.includes(kw));
    if (hasJobWord) {
      detected.add('profession');
      detected.add('technical_context');
    }

    // 3. Identity Intent
    const hasIdentityWord = IDENTITY_KEYWORDS.some((kw) => lower.includes(kw));
    if (hasIdentityWord) {
      detected.add('identity');
    }

    // 4. Location Intent
    const hasLocationWord = LOCATION_KEYWORDS.some((kw) => lower.includes(kw));
    if (hasLocationWord) {
      detected.add('stable_fact');
    }

    // 5. Interests / Hobbies Intent
    const hasInterestsWord = INTERESTS_KEYWORDS.some((kw) => lower.includes(kw));
    if (hasInterestsWord) {
      detected.add('interests');
    }

    return detected;
  }

  /**
   * Tokenizes text into normalized lowercased word tokens.
   */
  public tokenize(text: string): string[] {
    if (!text) return [];
    const normalized = normalizeFactText(text).toLowerCase();
    return normalized
      .replace(/[^\p{L}\p{N}_\-]+/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  }
}
