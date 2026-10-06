/**
 * System Prompt Builder (Phase 8.4 / 14.2)
 *
 * Vendor-neutral prompt synthesis module extracting prompt generation logic
 * out of specific provider implementations into a reusable service.
 *
 * Phase 14.2 Hardening:
 * - Separates byte-stable static prefix from dynamic runtime context (timestamps, memories, dynamic policies).
 * - Normalizes Cairo UTC+3 temporal anchors as a dynamic suffix, preserving prefix cache compatibility on Groq LPUs.
 * - Provides deterministic SHA-256 prefix hashing for low-cardinality observability.
 * - Retains 100% backwards compatibility and semantic equivalence across all linguistic registers.
 */

import crypto from 'crypto';
import { LanguageContext } from '../../language/types';
import { PersonalityContext, buildPersonalityInstructions, PersonalityEngine } from '../../personality';
import { PersonalizationPolicy, buildPersonalizationPrompt } from '../../personalization';
import { AdaptiveResponsePolicy, buildAdaptiveResponsePrompt } from '../../response';
import { ProactivePolicy, buildProactivePrompt } from '../../proactive';
import { GlobalContextDeduplicator } from '../../context';

export interface TemporalContextOptions {
  referenceTime?: Date;
  timeZone?: string;
  resolution?: 'second' | 'minute' | 'hour' | 'day';
}

export interface StructuredSystemPrompt {
  readonly staticPrefix: string;
  readonly dynamicContext: string;
  readonly fullInstruction: string;
  readonly prefixHash: string;
}

export class SystemPromptBuilder {
  /**
   * Builds the byte-stable static prefix containing all invariant directives:
   * Identity, Language & Dialect persistence, Technical terminology rules,
   * Personality guidelines, Reminders/Search policies, Anti-Hallucination, and Formatting.
   *
   * Guaranteed ZERO dynamic values (no timestamps, request IDs, memories, or random seeds).
   */
  /**
   * Builds tone, language, register, verbosity, and technical terminology preservation rules.
   * Shared between Planner System Prompt and Final Synthesis Prompt.
   */
  public static buildToneAndLanguageDirectives(languageContext?: LanguageContext): string {
    let toneAndLanguage = '';
    if (languageContext) {
      if (languageContext.targetLanguage === 'en') {
        toneAndLanguage = `Response Language & Style:
- Language: English (US)
- Rule: You MUST formulate your entire response in natural, fluent English. Do NOT switch to Arabic unless explicitly requested.`;
      } else if (languageContext.targetLanguage === 'fr') {
        toneAndLanguage = `Response Language & Style:
- Language: French
- Rule: You MUST formulate your response in natural, fluent French.`;
      } else if (languageContext.targetLanguage === 'de') {
        toneAndLanguage = `Response Language & Style:
- Language: German
- Rule: You MUST formulate your response in natural, fluent German.`;
      } else if (languageContext.targetLanguage === 'es') {
        toneAndLanguage = `Response Language & Style:
- Language: Spanish
- Rule: You MUST formulate your response in natural, fluent Spanish.`;
      } else {
        // Arabic
        const cleanDialect = languageContext.dialect ? languageContext.dialect.replace(/_ar$/, '') : undefined;
        if (cleanDialect === 'egyptian') {
          toneAndLanguage = `Response Language & Style:
- Language: Arabic
- Dialect: Natural, friendly, and professional Egyptian Arabic (اللهجة المصرية العامية الطبيعية والمهنية).
- STRICT DIALECT PERSISTENCE:
  * Formulate your entire response naturally in genuine Egyptian Arabic.
  * NEVER revert or switch back to Modern Standard Arabic (MSA / الفصحى), even when answering deeply technical questions, code discussions, or architectural comparisons.
  * Maintain natural Egyptian phrasing for explanations, transitions, and comparisons (e.g. استخدام كلمات وتراكيب مصرية: "بص", "كده", "علشان", "دلوقتي", "الفرق بينهم", "لو محتاج", "تقدر تستخدم").
  * Avoid excessive colloquial fillers like "يا باشا" or "يا هندسة". Do NOT use artificial or cheesy colloquial slang (NEVER say "يا باشا", "يا معلم", "يا صاحبي", "يا سيدي الفاضل", "يا هندسة"). Keep it smart, refined, and authentic.`;
        } else if (cleanDialect === 'gulf') {
          toneAndLanguage = `Response Language & Style:
- Language: Arabic
- Dialect: Gulf Arabic (اللهجة الخليجية البيضاء والمهنية).`;
        } else if (cleanDialect === 'levantine') {
          toneAndLanguage = `Response Language & Style:
- Language: Arabic
- Dialect: Levantine Arabic (اللهجة الشامية المهنية).`;
        } else if (cleanDialect === 'maghrebi') {
          toneAndLanguage = `Response Language & Style:
- Language: Arabic
- Dialect: Maghrebi Arabic (اللهجة المغاربية المهنية السلسة).`;
        } else if (cleanDialect === 'iraqi') {
          toneAndLanguage = `Response Language & Style:
- Language: Arabic
- Dialect: Iraqi Arabic (اللهجة العراقية المهنية السلسة).`;
        } else if (cleanDialect === 'sudanese') {
          toneAndLanguage = `Response Language & Style:
- Language: Arabic
- Dialect: Sudanese Arabic (اللهجة السودانية المهنية السلسة).`;
        } else {
          // Modern Standard Arabic
          toneAndLanguage = `Response Language & Style:
- Language: Modern Standard Arabic (العربية الفصحى المعاصرة السلسة والواضحة).`;
        }
      }

      // Adaptive Register
      if (languageContext.register) {
        if (languageContext.register === 'casual') {
          toneAndLanguage += `\n- Register: Casual & Conversational (عامي سلس ومريح وغير متكلف).`;
        } else if (languageContext.register === 'formal') {
          toneAndLanguage += `\n- Register: Formal & Authoritative (أسلوب فصيح رسمي ووقور).`;
        } else if (languageContext.register === 'professional') {
          toneAndLanguage += `\n- Register: Professional & Courteous (أسلوب مهني احترافي واضح ومحترم).`;
        }
      }

      // Adaptive Verbosity
      if (languageContext.verbosity) {
        if (languageContext.verbosity === 'concise') {
          toneAndLanguage += `\n- Verbosity: Concise & Direct. Keep answers brief, crisp, and to the point without filler or long preamble.`;
        } else if (languageContext.verbosity === 'detailed') {
          toneAndLanguage += `\n- Verbosity: Detailed & Comprehensive. Provide thorough explanations, step-by-step guidance, and edge cases.`;
        }
      }

      // Adaptive Response Tone
      if (languageContext.tone) {
        if (languageContext.tone === 'direct') {
          toneAndLanguage += `\n- Tone: Direct & Focused. Deliver answers straight to the point.`;
        } else if (languageContext.tone === 'warm') {
          toneAndLanguage += `\n- Tone: Warm, cordial, and encouraging.`;
        } else if (languageContext.tone === 'supportive') {
          toneAndLanguage += `\n- Tone: Supportive, empathetic, and patient. Help the user calmly troubleshoot.`;
        } else if (languageContext.tone === 'technical') {
          toneAndLanguage += `\n- Tone: Deeply technical, rigorous, and precise.`;
        }
      }

      // Technical Terminology Preservation (CRITICAL CLAUSE)
      if (languageContext.targetLanguage === 'ar' || languageContext.codeSwitching?.preserveTechnicalTerms) {
        const termsList = languageContext.codeSwitching?.preservedTerms?.length
          ? languageContext.codeSwitching.preservedTerms.join(', ')
          : undefined;

        toneAndLanguage += `\n- Technical Terminology Preservation (STRICT):
  * NEVER translate core technical identifiers, framework constructs, package names, programming languages, CLI commands, or file names into Arabic.
  * Always preserve technical terms, frameworks, libraries, APIs, and tools in English${termsList ? ` (including: ${termsList})` : ''}.
  * Keep all code blocks, class names, function names, and CLI commands strictly untranslated.`;
      }
    } else {
      toneAndLanguage = `Response Language & Style:
- Language: Arabic (Modern Standard Arabic or match the user's input language).
- Technical Terminology Preservation: Keep all programming terms, frameworks, and identifiers in English.`;
    }
    return toneAndLanguage;
  }

  /**
   * Standard WhatsApp formatting rules.
   */
  public static buildFormattingRules(): string {
    return `Formatting Rules:
- STRICT PROHIBITION: NEVER use Markdown tables (| col |). WhatsApp renders tables poorly.
- Use clean bullet points (•) and *bold* for headings and key terms.
- NEVER output raw HTML (<br>, <div>). Use standard clean line breaks.`;
  }

  /**
   * Builds the byte-stable static prefix containing all invariant directives:
   * Identity, Language & Dialect persistence, Technical terminology rules,
   * Personality guidelines, Reminders/Search policies, Anti-Hallucination, and Formatting.
   *
   * Guaranteed ZERO dynamic values (no timestamps, request IDs, memories, or random seeds).
   */
  public static buildStaticPrefix(
    languageContext?: LanguageContext,
    personalityContext?: PersonalityContext
  ): string {
    const toneAndLanguage = this.buildToneAndLanguageDirectives(languageContext);
    const effectivePersonality = personalityContext || PersonalityEngine.getInstance().getDefaultPersonality();
    const personalityInstructions = buildPersonalityInstructions(effectivePersonality);
    const formattingRules = this.buildFormattingRules();

    return `You are Craft, the personal AI assistant for the Craft ecosystem.
Identity: Always introduce and refer to yourself as Craft. Never say you are ChatGPT, OpenAI, Groq, or Google.
${toneAndLanguage}

${personalityInstructions}

### Reminders & Tasks (CRITICAL RULES):
- ALWAYS call 'create_reminder' when the user asks to be reminded of ANYTHING — even casually worded requests like: "فكرني", "ذكرني", "اعمل لي تذكير", "ابعتلي رسالة بعد X", "remind me", "set a reminder", "alert me".
- Extract the title from what they want to be reminded about, and the time from their message (e.g. "بعد دقيقة", "الساعة 10", "بكرة", "tomorrow 3pm").
- ALWAYS call 'list_reminders' when the user asks about their tasks, to-dos, or reminder list.
- NEVER answer reminder requests conversationally without calling the tool first.

### Live Web Search & Knowledge Rules:
- STRICT REQUIREMENT: Whenever the user asks about ANY tech products (e.g. iPhone, Samsung, Xiaomi), device prices (in Egypt, Arab countries, or globally/USD), hardware specifications, leaks, future/upcoming devices (e.g. iPhone Duo, iPhone 18, Foldables, etc.), exchange rates, gold prices, movies, songs, or recent news:
  YOU MUST ALWAYS INVOKE THE 'web_search' TOOL! NEVER assume a device does not exist or answer from stale memory without searching!
- Follow-up Context: When the user asks a follow-up (e.g. "سعرو كام بره مصر", "مواصفاته ايه", "بكام بالدولار"), ALWAYS look at recent conversation turns to identify the referenced product, synthesize a complete and targeted search query (e.g. "iPhone Duo global price USD" or "سعر ايفون duo بالدولار عالميا"), and call 'web_search'!
- Egypt Currency Reality: The official bank exchange rate in Egypt is approximately ~48 to 50+ EGP per USD. NEVER state or calculate with obsolete rates like 30 or 31 EGP!
- Anti-leak & Professionalism: NEVER mention internal technical terms like "RSS", "محرك البحث", "الـ API", "نتائج البحث لم تذكر". Speak naturally and authoritatively as Craft with concrete numbers, storage variants, and distributor quotes (e.g. Tradeline/تريدلاين، بي تك، موبايل مصر).
- Strict Separation of Internal Research vs. Source Presentation:
  * Web search is strictly an INTERNAL research and verification mechanism.
  * Use retrieved search results as factual evidence to synthesize a natural, direct, conversational answer in your own words.
  * NEVER dump raw search snippets, numbered lists of search items, search engine headers (e.g. "Here are the search results", "إليك أهم النتائج"), or URLs.
  * NEVER list sources, citations, references, or links unless the user explicitly requests them (e.g. "هات المصادر", "المراجع؟", "جبت الكلام ده منين؟", "show sources", "give me the links").
  * Crucial rule: A user saying "ابحثلي عن..." or "search for..." means perform internal research and synthesize an answer; it does NOT mean display sources!
  * If and only if the user explicitly asks for sources/links, provide the answer first and append the authoritative sources cleanly at the end.

### Intent Integrity & Anti-Hallucination on Ambiguous Actions:
- STRICT PROHIBITION: When the user gives an underspecified or bare command (e.g. "اعملها", "نفذها", "كمل", "اعمل كده", "نفذ ده", "do it", "execute it") without an explicit, unambiguous pending task or artifact agreed upon in context:
  * NEVER invent, guess, or hallucinate an extensive unrequested architecture, project, code repository, or multi-step execution plan!
  * Ask a brief, direct clarification question to determine their precise intent (e.g. "تقصد أعمل إيه بالظبط؟ تحب مثلاً أكتبلك كود عملي، ولا أعمل جدول مقارنة، ولا توضيح خطوة بخطوة؟").

${formattingRules}`;
  }

  /**
   * Builds dynamic execution context (temporal anchor, personalization overrides,
   * adaptive response directives, in-turn proactive recommendations, and user profile memories).
   * Appended at the end of the system prompt to avoid invalidating the static prefix.
   */
  public static buildDynamicContext(
    memories?: string[],
    personalizationPolicy?: PersonalizationPolicy,
    adaptiveResponsePolicy?: AdaptiveResponsePolicy,
    proactivePolicy?: ProactivePolicy,
    temporalOptions?: TemporalContextOptions | Date
  ): string {
    const options: TemporalContextOptions =
      temporalOptions instanceof Date
        ? { referenceTime: temporalOptions }
        : temporalOptions || {};

    const referenceTime = options.referenceTime || new Date();
    const timeZone = options.timeZone || 'Africa/Cairo';
    const resolution = options.resolution || 'second';

    const cairoFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = cairoFormatter.formatToParts(referenceTime);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';

    const secondVal = resolution === 'minute' || resolution === 'hour' || resolution === 'day' ? '00' : getPart('second');
    const minuteVal = resolution === 'hour' || resolution === 'day' ? '00' : getPart('minute');
    const cairoNow = `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${minuteVal}:${secondVal}+03:00`;
    const today = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;

    const sections: string[] = [];

    // 1. Real-time temporal context (dynamic anchor placed safely at end of static instructions)
    sections.push(
      `### Real-Time Temporal Context (${timeZone}):\nUser Timezone: ${timeZone} (Egypt, UTC+3). Local Time: ${cairoNow} (Date: ${today}).`
    );

    // 2. Dynamic Personalization
    if (personalizationPolicy) {
      const tailoredSection = buildPersonalizationPrompt(personalizationPolicy);
      if (tailoredSection) {
        sections.push(tailoredSection);
      }
    }

    // 3. Dynamic Adaptive Response
    if (adaptiveResponsePolicy) {
      const adaptiveSection = buildAdaptiveResponsePrompt(adaptiveResponsePolicy);
      if (adaptiveSection) {
        sections.push(adaptiveSection);
      }
    }

    // 4. In-Turn Proactive Suggestions
    if (proactivePolicy && proactivePolicy.shouldSuggest) {
      const proactiveSection = buildProactivePrompt(proactivePolicy);
      if (proactiveSection) {
        sections.push(proactiveSection);
      }
    }

    // 5. Stored User Profile (Memories with Phase 14.5 cross-source deduplication)
    if (memories && memories.length > 0) {
      const { preserved } = GlobalContextDeduplicator.deduplicateMemories(memories, personalizationPolicy);
      if (preserved.length > 0) {
        let memSection = `### Stored User Profile:\n${preserved.map((m) => `- ${m}`).join('\n')}`;
        memSection += `\n*Priority Rule*: The active "Response Language & Style" specified above is authoritative for the current request and MUST strictly take precedence over any stored language or dialect preferences in the user profile.`;
        sections.push(memSection);
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Computes a deterministic, non-secret, low-cardinality SHA-256 hash
   * of the static system prompt prefix for cache-compatibility observability.
   */
  public static computePrefixHash(staticPrefix: string): string {
    return crypto.createHash('sha256').update(staticPrefix, 'utf8').digest('hex').substring(0, 16);
  }

  /**
   * Structured system prompt factory separating the invariant prefix from dynamic suffix.
   */
  public static buildStructuredSystemInstruction(
    memories?: string[],
    languageContext?: LanguageContext,
    personalityContext?: PersonalityContext,
    personalizationPolicy?: PersonalizationPolicy,
    adaptiveResponsePolicy?: AdaptiveResponsePolicy,
    proactivePolicy?: ProactivePolicy,
    temporalOptions?: TemporalContextOptions | Date
  ): StructuredSystemPrompt {
    const staticPrefix = this.buildStaticPrefix(languageContext, personalityContext);
    const dynamicContext = this.buildDynamicContext(
      memories,
      personalizationPolicy,
      adaptiveResponsePolicy,
      proactivePolicy,
      temporalOptions
    );
    const fullInstruction = dynamicContext.length > 0
      ? `${staticPrefix}\n\n${dynamicContext}`
      : staticPrefix;
    const prefixHash = this.computePrefixHash(staticPrefix);

    return {
      staticPrefix,
      dynamicContext,
      fullInstruction,
      prefixHash,
    };
  }

  /**
   * Primary vendor-neutral system instruction builder (100% backwards-compatible API).
   */
  public static buildSystemInstruction(
    memories?: string[],
    languageContext?: LanguageContext,
    personalityContext?: PersonalityContext,
    personalizationPolicy?: PersonalizationPolicy,
    adaptiveResponsePolicy?: AdaptiveResponsePolicy,
    proactivePolicy?: ProactivePolicy,
    temporalOptions?: TemporalContextOptions | Date
  ): string {
    const structured = this.buildStructuredSystemInstruction(
      memories,
      languageContext,
      personalityContext,
      personalizationPolicy,
      adaptiveResponsePolicy,
      proactivePolicy,
      temporalOptions
    );
    return structured.fullInstruction;
  }
}
