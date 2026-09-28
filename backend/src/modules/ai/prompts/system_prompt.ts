/**
 * System Prompt Builder (Phase 8.4)
 *
 * Vendor-neutral prompt synthesis module extracting prompt generation logic
 * out of specific provider implementations into a reusable service.
 */

import { LanguageContext } from '../../language/types';
import { PersonalityContext, buildPersonalityInstructions, PersonalityEngine } from '../../personality';
import { PersonalizationPolicy, buildPersonalizationPrompt } from '../../personalization';
import { AdaptiveResponsePolicy, buildAdaptiveResponsePrompt } from '../../response';
import { ProactivePolicy, buildProactivePrompt } from '../../proactive';

export class SystemPromptBuilder {
  public static buildSystemInstruction(
    memories?: string[],
    languageContext?: LanguageContext,
    personalityContext?: PersonalityContext,
    personalizationPolicy?: PersonalizationPolicy,
    adaptiveResponsePolicy?: AdaptiveResponsePolicy,
    proactivePolicy?: ProactivePolicy
  ): string {
    const now = new Date();
    const cairoFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = cairoFormatter.formatToParts(now);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';
    const cairoNow = `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}+03:00`;
    const today = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;

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
        if (languageContext.dialect === 'egyptian') {
          toneAndLanguage = `Response Language & Style:
- Language: Arabic
- Dialect: Natural, friendly, and professional Egyptian Arabic (اللهجة المصرية العامية الراقية والمهنية).
- Avoid excessive colloquial fillers like "يا باشا" or "يا هندسة".`;
        } else if (languageContext.dialect === 'gulf') {
          toneAndLanguage = `Response Language & Style:
- Language: Arabic
- Dialect: Gulf Arabic (اللهجة الخليجية البيضاء والمهنية).`;
        } else if (languageContext.dialect === 'levantine') {
          toneAndLanguage = `Response Language & Style:
- Language: Arabic
- Dialect: Levantine Arabic (اللهجة الشامية المهنية).`;
        } else {
          // Modern Standard Arabic
          toneAndLanguage = `Response Language & Style:
- Language: Modern Standard Arabic (العربية الفصحى المعاصرة السلسة والواضحة).`;
        }
      }
    } else {
      toneAndLanguage = `Response Language & Style:
- Language: Arabic (Modern Standard Arabic or match the user's input language).`;
    }

    const effectivePersonality = personalityContext || PersonalityEngine.getInstance().getDefaultPersonality();
    const personalityInstructions = buildPersonalityInstructions(effectivePersonality);

    let instruction = `You are Craft, the personal AI assistant for the Craft ecosystem.
User Timezone: Africa/Cairo (Egypt, UTC+3). Local Time: ${cairoNow} (Date: ${today}).
Identity: Always introduce and refer to yourself as Craft. Never say you are ChatGPT, OpenAI, Groq, or Google.
${toneAndLanguage}

${personalityInstructions}`;

    if (personalizationPolicy) {
      const tailoredSection = buildPersonalizationPrompt(personalizationPolicy);
      if (tailoredSection) {
        instruction += `\n\n${tailoredSection}`;
      }
    }

    if (adaptiveResponsePolicy) {
      const adaptiveSection = buildAdaptiveResponsePrompt(adaptiveResponsePolicy);
      if (adaptiveSection) {
        instruction += `\n\n${adaptiveSection}`;
      }
    }

    if (proactivePolicy && proactivePolicy.shouldSuggest) {
      const proactiveSection = buildProactivePrompt(proactivePolicy);
      if (proactiveSection) {
        instruction += `\n\n${proactiveSection}`;
      }
    }

    instruction += `\n\n### Reminders & Tasks (CRITICAL RULES):
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

Formatting Rules:
- STRICT PROHIBITION: NEVER use Markdown tables (| col |). WhatsApp renders tables poorly.
- Use clean bullet points (•) and *bold* for headings and key terms.
- NEVER output raw HTML (<br>, <div>). Use standard clean line breaks.`;

    if (memories && memories.length > 0) {
      instruction += `\n\n### Stored User Profile:\n${memories.map((m) => `- ${m}`).join('\n')}`;
      instruction += `\n*Priority Rule*: The active "Response Language & Style" specified above is authoritative for the current request and MUST strictly take precedence over any stored language or dialect preferences in the user profile.`;
    }

    return instruction;
  }
}
