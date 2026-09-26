import {
  DEFAULT_CRAFT_PERSONALITY,
  PersonalityContext,
  PersonalityResolutionOptions,
  ToneAttribute,
} from './types';

/**
 * PersonalityEngine
 *
 * Responsible for determining HOW Craft responds (Tone, Formality, Verbosity,
 * Addressing, Emoji policy, Humor, Proactivity).
 *
 * Strict architectural boundaries:
 * - Pure, local, deterministic, provider-agnostic.
 * - ZERO AI calls, ZERO database, ZERO external network.
 * - Strictly decoupled from LanguageIntelligenceService (does not detect or alter language/dialect).
 * - Priority: Explicit preference -> Default Craft Personality.
 * - NO heuristic inference based on message length, dialect, or emoji presence.
 */
export class PersonalityEngine {
  private static instance: PersonalityEngine;

  public static getInstance(): PersonalityEngine {
    if (!PersonalityEngine.instance) {
      PersonalityEngine.instance = new PersonalityEngine();
    }
    return PersonalityEngine.instance;
  }

  /**
   * Returns the frozen, immutable default Craft personality baseline.
   */
  public getDefaultPersonality(): PersonalityContext {
    return DEFAULT_CRAFT_PERSONALITY;
  }

  /**
   * Resolves the PersonalityContext for a request.
   *
   * Overloads:
   * - resolve()
   * - resolve(options)
   * - resolve(text, options)
   *
   * Note: The input text is accepted purely for caller interface consistency;
   * it is deliberately NOT used to infer personality traits.
   */
  public resolve(options?: PersonalityResolutionOptions): PersonalityContext;
  public resolve(text?: string, options?: PersonalityResolutionOptions): PersonalityContext;
  public resolve(
    textOrOptions?: string | PersonalityResolutionOptions,
    maybeOptions?: PersonalityResolutionOptions
  ): PersonalityContext {
    let options: PersonalityResolutionOptions | undefined;

    if (typeof textOrOptions === 'string') {
      options = maybeOptions;
    } else if (textOrOptions && typeof textOrOptions === 'object') {
      options = textOrOptions;
    }

    const explicit = options?.explicitPreference;
    if (!explicit) {
      return DEFAULT_CRAFT_PERSONALITY;
    }

    // Check if any explicit property was actually provided
    const hasExplicitTone = explicit.tone !== undefined;
    const hasExplicitFormality = explicit.formality !== undefined;
    const hasExplicitVerbosity = explicit.verbosity !== undefined;
    const hasExplicitAddressing = explicit.addressingStyle !== undefined;
    const hasExplicitEmojiPolicy = explicit.emojiPolicy !== undefined;
    const hasExplicitHumor = explicit.humorLevel !== undefined;
    const hasExplicitProactivity = explicit.proactivity !== undefined;

    if (
      !hasExplicitTone &&
      !hasExplicitFormality &&
      !hasExplicitVerbosity &&
      !hasExplicitAddressing &&
      !hasExplicitEmojiPolicy &&
      !hasExplicitHumor &&
      !hasExplicitProactivity
    ) {
      return DEFAULT_CRAFT_PERSONALITY;
    }

    // Resolve Tone: support single attribute or array of attributes
    let resolvedTone: readonly ToneAttribute[] = DEFAULT_CRAFT_PERSONALITY.tone;
    if (hasExplicitTone && explicit.tone) {
      if (Array.isArray(explicit.tone)) {
        resolvedTone = Object.freeze([...explicit.tone]);
      } else {
        resolvedTone = Object.freeze([explicit.tone as ToneAttribute]);
      }
    }

    // Construct and freeze the resolved PersonalityContext
    const resolved: PersonalityContext = Object.freeze({
      tone: resolvedTone,
      formality: explicit.formality ?? DEFAULT_CRAFT_PERSONALITY.formality,
      verbosity: explicit.verbosity ?? DEFAULT_CRAFT_PERSONALITY.verbosity,
      addressingStyle: explicit.addressingStyle ?? DEFAULT_CRAFT_PERSONALITY.addressingStyle,
      emojiPolicy: explicit.emojiPolicy ?? DEFAULT_CRAFT_PERSONALITY.emojiPolicy,
      humorLevel: explicit.humorLevel ?? DEFAULT_CRAFT_PERSONALITY.humorLevel,
      proactivity: explicit.proactivity ?? DEFAULT_CRAFT_PERSONALITY.proactivity,
    });

    return resolved;
  }
}
