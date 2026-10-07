/**
 * Synthesis Prompt Builder (Phase 14.3)
 *
 * Dedicated prompt builder for final answer synthesis in ExecutionEngine.
 *
 * Quality-Preserving Optimization:
 * - Omission of planner-only rules (tool invocation mandates, search requirements,
 *   ambiguous action clarifications) saving ~1,300 tokens per synthesis step.
 * - 100% preservation of Craft identity, Egyptian dialect persistence,
 *   technical terminology preservation (Flutter, Dart, APIs in English),
 *   personality guidelines, WhatsApp formatting, and temporal context.
 * - Adds strict evidence grounding and anti-hallucination constraint against
 *   fabricating facts or tool results beyond verified observations.
 */

import crypto from 'crypto';
import { LanguageContext } from '../../language/types';
import { PersonalityContext, buildPersonalityInstructions, PersonalityEngine } from '../../personality';
import { PersonalizationPolicy } from '../../personalization';
import { AdaptiveResponsePolicy } from '../../response';
import { ProactivePolicy } from '../../proactive';
import { SystemPromptBuilder, TemporalContextOptions } from './system_prompt';
import { NaturalResponseGuard } from '../../factual';

export interface StructuredSynthesisPrompt {
  readonly staticPrefix: string;
  readonly dynamicContext: string;
  readonly fullInstruction: string;
  readonly prefixHash: string;
}

export class SynthesisPromptBuilder {
  /**
   * Builds the byte-stable static prefix for final synthesis:
   * Retains:
   * - Craft Identity
   * - Tone, Language & Egyptian Dialect persistence (NEVER revert to MSA)
   * - Technical Terminology Preservation (Flutter, Dart, API, etc. in English)
   * - Personality guidelines
   * - WhatsApp formatting rules
   * - Verified Evidence Grounding & Anti-Hallucination
   *
   * Omits:
   * - Planner tool invocation rules ("ALWAYS call create_reminder", "YOU MUST ALWAYS INVOKE web_search")
   * - Tool selection mandates
   * - Ambiguous action clarification prompts
   */
  public static buildStaticPrefix(
    languageContext?: LanguageContext,
    personalityContext?: PersonalityContext
  ): string {
    const toneAndLanguage = SystemPromptBuilder.buildToneAndLanguageDirectives(languageContext);
    const effectivePersonality = personalityContext || PersonalityEngine.getInstance().getDefaultPersonality();
    const personalityInstructions = buildPersonalityInstructions(effectivePersonality);
    const formattingRules = SystemPromptBuilder.buildFormattingRules();

    return `You are Craft, the personal AI assistant for the Craft ecosystem.
Identity: Always introduce and refer to yourself as Craft. Never say you are ChatGPT, OpenAI, Groq, or Google.
${toneAndLanguage}

${personalityInstructions}

### Verified Evidence Grounding & Anti-Hallucination:
- Ground your final response strictly and exclusively on the verified tool execution outcomes, observations, and facts provided in the prompt.
- NEVER fabricate tool results, fake actions, or invent information not present in the verified observations.
- NEVER fabricate character names, dates, release years, or historical settings. If not confirmed, state that honestly.
- NEVER start responses with robotic meta-preambles ("أنا Craft...", "إليك النسخة المصححة..."). Answer directly and naturally.
- If a tool succeeded, confirm the exact result clearly, helpfully, and conversationally in the user's language.
- If a tool failed or returned no results, state what happened honestly and transparently without making up details.
- Never list sources, URLs, or citations unless the user explicitly requested them in the conversation.

${formattingRules}`;
  }

  /**
   * Builds dynamic execution context (temporal anchor, personalization overrides,
   * adaptive response directives, in-turn proactive recommendations, and user profile memories).
   */
  public static buildDynamicContext(
    memories?: string[],
    personalizationPolicy?: PersonalizationPolicy,
    adaptiveResponsePolicy?: AdaptiveResponsePolicy,
    proactivePolicy?: ProactivePolicy,
    temporalOptions?: TemporalContextOptions | Date
  ): string {
    return SystemPromptBuilder.buildDynamicContext(
      memories,
      personalizationPolicy,
      adaptiveResponsePolicy,
      proactivePolicy,
      temporalOptions
    );
  }

  /**
   * Computes deterministic SHA-256 hash of the static synthesis prefix.
   */
  public static computePrefixHash(staticPrefix: string): string {
    return crypto.createHash('sha256').update(staticPrefix, 'utf8').digest('hex').substring(0, 16);
  }

  /**
   * Structured synthesis prompt factory.
   */
  public static buildStructuredSynthesisInstruction(
    memories?: string[],
    languageContext?: LanguageContext,
    personalityContext?: PersonalityContext,
    personalizationPolicy?: PersonalizationPolicy,
    adaptiveResponsePolicy?: AdaptiveResponsePolicy,
    proactivePolicy?: ProactivePolicy,
    temporalOptions?: TemporalContextOptions | Date
  ): StructuredSynthesisPrompt {
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
   * Primary lean synthesis instruction builder.
   */
  public static buildSynthesisInstruction(
    memories?: string[],
    languageContext?: LanguageContext,
    personalityContext?: PersonalityContext,
    personalizationPolicy?: PersonalizationPolicy,
    adaptiveResponsePolicy?: AdaptiveResponsePolicy,
    proactivePolicy?: ProactivePolicy,
    temporalOptions?: TemporalContextOptions | Date
  ): string {
    return this.buildStructuredSynthesisInstruction(
      memories,
      languageContext,
      personalityContext,
      personalizationPolicy,
      adaptiveResponsePolicy,
      proactivePolicy,
      temporalOptions
    ).fullInstruction;
  }
}
