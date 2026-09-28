/**
 * Memory Candidate Extractor (Phase 4.5 & Phase 2.4)
 *
 * Decouples deterministic candidate detection and classification from storage.
 * Extracts structured memory candidates (Identity, Technical Context, Profession,
 * Stable Facts), isolates Language/Personality preferences, and attaches
 * Temporal Intelligence (historical, current, planned, temporary).
 */

import { MemoryCategory, MemorySource, TemporalState, TemporalMetadata } from './types';
import { LanguagePreference, PersonalityPreference } from './types';
import { parseTemporalIntent, ParsedTemporalIntent } from './temporal_parser';

export interface MemoryCandidate {
  readonly factText: string;
  readonly category: MemoryCategory;
  readonly source: MemorySource;
  readonly confidence: number;
  readonly factKey?: string;
  readonly candidateKey?: string;
  readonly validUntil?: Date | null;
  readonly validFrom?: Date | null;
  readonly temporalState?: TemporalState;
  readonly temporalMetadata?: TemporalMetadata;
  readonly isPreference?: boolean;
  readonly preferenceType?: 'language' | 'personality';
  readonly preferenceData?: LanguagePreference | PersonalityPreference;
  readonly isExplicit?: boolean;
}

export class MemoryCandidateExtractor {
  private static instance: MemoryCandidateExtractor;

  public static getInstance(): MemoryCandidateExtractor {
    if (!MemoryCandidateExtractor.instance) {
      MemoryCandidateExtractor.instance = new MemoryCandidateExtractor();
    }
    return MemoryCandidateExtractor.instance;
  }

  /**
   * Scans input text and returns structured candidate items with temporal state awareness.
   */
  public extractCandidates(text: string): MemoryCandidate[] {
    if (!text || typeof text !== 'string') return [];

    const lower = text.toLowerCase();
    const clean = text.trim();
    const candidates: MemoryCandidate[] = [];

    // Phase 2.4: Deterministic Temporal Intent Parsing
    const temporalInfo: ParsedTemporalIntent = parseTemporalIntent(clean);
    const baseTemporalMeta: TemporalMetadata = {
      temporalState: temporalInfo.temporalState,
      temporalSignal: temporalInfo.temporalSignal,
      rawTemporalPhrase: temporalInfo.rawTemporalPhrase,
      relativeExpression: temporalInfo.relativeExpression,
      validFrom: temporalInfo.validFrom,
      validUntil: temporalInfo.validUntil,
      temporalConfidence: temporalInfo.temporalConfidence,
      temporalAmbiguity: temporalInfo.temporalAmbiguity,
    };

    // 1. Profession / Skills / Technical Context (Explicit Declarations)
    if (
      lower.includes('flutter') &&
      (lower.includes('dev') ||
        lower.includes('developer') ||
        lower.includes('مطور') ||
        lower.includes('مبرمج') ||
        lower.includes('شغال'))
    ) {
      if (temporalInfo.temporalState === 'historical') {
        candidates.push({
          factText: 'المستخدم كان يعمل كمطور تطبيقات هواتف باستخدام فلاتر (Mobile Flutter Developer) سابقاً',
          category: 'profession',
          source: 'automatic_extraction',
          confidence: 0.95,
          factKey: 'profession.flutter.historical',
          candidateKey: 'profession.flutter.historical',
          temporalState: 'historical',
          validUntil: null,
          isExplicit: true,
          temporalMetadata: baseTemporalMeta,
        });
      } else {
        candidates.push({
          factText: 'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر (Mobile Flutter Developer)',
          category: 'profession',
          source: 'automatic_extraction',
          confidence: 0.95,
          factKey: 'profession.current',
          candidateKey: 'profession.current',
          temporalState: temporalInfo.temporalState,
          validUntil: temporalInfo.validUntil || null,
          validFrom: temporalInfo.validFrom || null,
          isExplicit: true,
          temporalMetadata: baseTemporalMeta,
        });
      }
    } else if (lower.includes('mobile dev') || lower.includes('مطور موبايل')) {
      if (temporalInfo.temporalState === 'historical') {
        candidates.push({
          factText: 'المستخدم كان يعمل كمطور تطبيقات هواتف (Mobile Developer) سابقاً',
          category: 'profession',
          source: 'automatic_extraction',
          confidence: 0.9,
          factKey: 'profession.historical',
          candidateKey: 'profession.historical',
          temporalState: 'historical',
          validUntil: null,
          isExplicit: true,
          temporalMetadata: baseTemporalMeta,
        });
      } else {
        candidates.push({
          factText: 'المستخدم يعمل كمطور تطبيقات هواتف (Mobile Developer)',
          category: 'profession',
          source: 'automatic_extraction',
          confidence: 0.9,
          factKey: 'profession.current',
          candidateKey: 'profession.current',
          temporalState: temporalInfo.temporalState,
          validUntil: temporalInfo.validUntil || null,
          validFrom: temporalInfo.validFrom || null,
          isExplicit: true,
          temporalMetadata: baseTemporalMeta,
        });
      }
    } else {
      // 1b. Workplace / Company Declaration or Transition
      const transitionMatch = clean.match(
        /(?:تركت|سيبت|سبت)\s+(?:شركة\s+)?([^\s,،.]+)\s+(?:و|وإني|وبقيت|وأعمل|وعملت|ودلوقتي)\s+(?:في|شغال\s+في|أعمل\s+في|مع)\s+(?:شركة\s+)?([^\s,،.]+)/i
      ) || clean.match(/\bleft\s+([^\s,]+)\s+and\s+(?:now\s+work\s+at|joined)\s+([^\s,]+)/i);

      if (transitionMatch && transitionMatch[1] && transitionMatch[2]) {
        const newCompany = transitionMatch[2].trim();
        candidates.push({
          factText: `المستخدم يعمل في شركة ${newCompany}`,
          category: 'profession',
          source: 'automatic_extraction',
          confidence: 0.95,
          factKey: 'profession.workplace',
          candidateKey: 'profession.workplace',
          temporalState: 'current',
          validUntil: null,
          isExplicit: true,
          temporalMetadata: baseTemporalMeta,
        });
      } else {
        const workplaceMatch = clean.match(
          /(?:أعمل|اعمل|أنا\s+شغال|انا\s+شغال|شغال|بشتغل)\s+في\s+شركة\s+([^\s,،.]+)/i
        ) || clean.match(/\b(?:work\s+at|working\s+at)\s+([A-Za-z0-9_-]+)/i);

        if (workplaceMatch && workplaceMatch[1]) {
          const company = workplaceMatch[1].trim();
          candidates.push({
            factText: `المستخدم يعمل في شركة ${company}`,
            category: 'profession',
            source: 'automatic_extraction',
            confidence: 0.90,
            factKey: 'profession.workplace',
            candidateKey: 'profession.workplace',
            temporalState: temporalInfo.temporalState,
            validUntil: null,
            isExplicit: true,
            temporalMetadata: baseTemporalMeta,
          });
        }
      }
    }

    // 2. Language & Dialect Preferences (ISOLATED from memory_items)
    if (
      lower.includes('كلمني مصري') ||
      lower.includes('اتكلم مصري') ||
      lower.includes('بالمصري') ||
      lower.includes('عربي مصري') ||
      lower.includes('فصحي كلمني مصري')
    ) {
      candidates.push({
        factText: 'المستخدم يفضل التحدث والتواصل باللهجة المصرية',
        category: 'language_preference',
        source: 'user_explicit',
        confidence: 0.95,
        isPreference: true,
        preferenceType: 'language',
        temporalState: 'current',
        preferenceData: {
          language: 'ar',
          dialect: 'egyptian',
          confidence: 0.95,
        },
      });
    } else if (
      lower.includes('اتكلم معايا بالإنجليزي') ||
      lower.includes('اتكلم انجليزي') ||
      lower.includes('كلمني إنجليزي') ||
      lower.includes('speak english') ||
      lower.includes('in english please') ||
      lower.includes('i prefer english') ||
      lower.includes('prefer english')
    ) {
      candidates.push({
        factText: 'User prefers communication in English',
        category: 'language_preference',
        source: 'user_explicit',
        confidence: 0.95,
        isPreference: true,
        preferenceType: 'language',
        temporalState: 'current',
        preferenceData: {
          language: 'en',
          confidence: 0.95,
        },
      });
    }

    // 3. Personality Preferences (ISOLATED from memory_items)
    if (
      lower.includes('خليك مختصر') ||
      lower.includes('جاوب باختصار') ||
      lower.includes('رد باختصار') ||
      lower.includes('be concise') ||
      lower.includes('short answers')
    ) {
      candidates.push({
        factText: 'User prefers concise responses',
        category: 'personality_preference',
        source: 'user_explicit',
        confidence: 0.95,
        isPreference: true,
        preferenceType: 'personality',
        temporalState: 'current',
        preferenceData: {
          verbosity: 'concise',
          confidence: 0.95,
        },
      });
    }

    // 4. User Identity: Name declaration
    const nameMatch = clean.match(/(?:اسمي|أنا اسمي)\s+([^\s,،.]+)/i);
    if (nameMatch && nameMatch[1]) {
      const extractedName = nameMatch[1].trim();
      const forbiddenNameTitles = ['مطور', 'مبرمج', 'مهندس', 'شغال', 'طالب', 'دكتور'];
      if (!forbiddenNameTitles.includes(extractedName)) {
        candidates.push({
          factText: `اسم المستخدم: ${extractedName}`,
          category: 'identity',
          source: 'user_explicit',
          confidence: 0.95,
          factKey: 'identity.name',
          candidateKey: 'identity.name',
          temporalState: 'current',
          isExplicit: true,
          temporalMetadata: {
            temporalState: 'current',
            temporalSignal: 'identity_declaration',
            temporalConfidence: 0.98,
            temporalAmbiguity: false,
          },
        });
      }
    }

    // 5. Explicit "Remember that..." / "احفظ أن..." commands
    const explicitMatch = clean.match(/(?:احفظ أن|تذكر أن|remember that)\s+(.+)/i);
    if (explicitMatch && explicitMatch[1]) {
      const explicitFact = explicitMatch[1].trim();
      if (explicitFact.length >= 5) {
        candidates.push({
          factText: explicitFact,
          category: 'stable_fact',
          source: 'user_explicit',
          confidence: 1.0,
          candidateKey: `stable_fact.${explicitFact.slice(0, 30)}`,
          temporalState: temporalInfo.temporalState,
          validUntil: temporalInfo.validUntil || null,
          validFrom: temporalInfo.validFrom || null,
          isExplicit: true,
          temporalMetadata: baseTemporalMeta,
        });
      }
    }

    // 6. Planned Intent (Future goals, new projects, learning intentions)
    if (temporalInfo.temporalState === 'planned') {
      if (lower.includes('rust') || lower.includes('رست')) {
        candidates.push({
          factText: 'المستخدم يخطط لتعلم رست (Rust)',
          category: 'technical_context',
          source: 'automatic_extraction',
          confidence: 0.90,
          factKey: 'planned.tech.rust',
          candidateKey: 'planned.tech.rust',
          temporalState: 'planned',
          validFrom: null,
          validUntil: null,
          isExplicit: true,
          temporalMetadata: baseTemporalMeta,
        });
      } else if (lower.includes('react') || lower.includes('رياكت')) {
        candidates.push({
          factText: 'المستخدم يخطط للعمل مع رياكت (React)',
          category: 'technical_context',
          source: 'automatic_extraction',
          confidence: 0.90,
          factKey: 'planned.tech.react',
          candidateKey: 'planned.tech.react',
          temporalState: 'planned',
          validFrom: null,
          validUntil: null,
          isExplicit: true,
          temporalMetadata: baseTemporalMeta,
        });
      } else if (lower.includes('flutter') || lower.includes('فلاتر')) {
        candidates.push({
          factText: 'المستخدم يخطط للعمل مع فلاتر (Flutter)',
          category: 'technical_context',
          source: 'automatic_extraction',
          confidence: 0.90,
          factKey: 'planned.tech.flutter',
          candidateKey: 'planned.tech.flutter',
          temporalState: 'planned',
          validFrom: null,
          validUntil: null,
          isExplicit: true,
          temporalMetadata: baseTemporalMeta,
        });
      } else if (lower.includes('مشروع جديد') || lower.includes('new project')) {
        candidates.push({
          factText: 'المستخدم يخطط لبدء مشروع جديد',
          category: 'stable_fact',
          source: 'automatic_extraction',
          confidence: 0.90,
          factKey: 'planned.new_project',
          candidateKey: 'planned.new_project',
          temporalState: 'planned',
          validFrom: null,
          validUntil: null,
          isExplicit: true,
          temporalMetadata: baseTemporalMeta,
        });
      }
    }

    // 7. Casual Technical Context Observations (Historical, Current, Temporary)
    const hasExplicitProfession = candidates.some((c) => c.category === 'profession');
    const hasPlannedCandidate = candidates.some((c) => c.temporalState === 'planned');

    if (!hasExplicitProfession && !hasPlannedCandidate) {
      const techList = [
        { name: 'flutter', arName: 'فلاتر', enLabel: 'فلاتر (Flutter)' },
        { name: 'react', arName: 'رياكت', enLabel: 'رياكت (React)' },
        { name: 'rust', arName: 'رست', enLabel: 'رست (Rust)' },
        { name: 'supabase', arName: 'سوبابيز', enLabel: 'سوبابيز (Supabase)' },
        { name: 'python', arName: 'بايثون', enLabel: 'بايثون (Python)' },
        { name: 'docker', arName: 'دوكر', enLabel: 'دوكر (Docker)' },
      ];

      for (const tech of techList) {
        if (lower.includes(tech.name) || lower.includes(tech.arName)) {
          let factText = `المستخدم يعمل مع ${tech.enLabel}`;
          let candidateKey = `tech.${tech.name}`;
          let validUntil: Date | null = null;
          let conf = 0.60;

          if (temporalInfo.temporalState === 'historical') {
            factText = `المستخدم كان يعمل مع ${tech.enLabel} سابقاً`;
            candidateKey = `tech.${tech.name}.historical`;
            conf = 0.85; // Explicit past statement yields higher certainty of historical fact
          } else if (temporalInfo.temporalState === 'temporary') {
            factText = `المستخدم يجرب ${tech.enLabel} بشكل مؤقت اليوم`;
            candidateKey = `tech.${tech.name}.temporary`;
            validUntil = temporalInfo.validUntil || new Date(Date.now() + 24 * 60 * 60 * 1000);
          }

          candidates.push({
            factText,
            category: 'technical_context',
            source: 'automatic_extraction',
            confidence: conf,
            candidateKey,
            factKey: candidateKey,
            temporalState: temporalInfo.temporalState,
            validFrom: temporalInfo.validFrom,
            validUntil,
            isExplicit: false,
            temporalMetadata: {
              ...baseTemporalMeta,
              validUntil,
            },
          });
          break;
        }
      }
    }

    return candidates;
  }
}
