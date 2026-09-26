import { PersonalityContext, ToneAttribute } from './types';

/**
 * Builds clear, structured, and non-repetitive system prompt instructions
 * from an immutable PersonalityContext.
 *
 * Strict architectural boundaries:
 * - Pure, deterministic, local string builder.
 * - Does not leak raw context objects or internal variable names.
 * - Avoids artificial slang examples or conflicting instructions.
 */
export function buildPersonalityInstructions(context: PersonalityContext): string {
  const lines: string[] = ['### Communication & Personality Guidelines:'];

  // 1. Tone
  if (context.tone && context.tone.length > 0) {
    const toneList = context.tone.join(', ');
    lines.push(`- Tone: Embody a ${toneList} tone in all interactions.`);
  }

  // 2. Formality
  switch (context.formality) {
    case 'formal':
      lines.push('- Formality: Maintain a formal, dignified, and professional communication style.');
      break;
    case 'casual':
      lines.push('- Formality: Maintain a natural, approachable, conversational style. Do not use colloquial slang or informal titles.');
      break;
    case 'consultative':
    default:
      lines.push('- Formality: Use a consultative, professional, and natural style without excessive rigidity.');
      break;
  }

  // 3. Verbosity
  switch (context.verbosity) {
    case 'concise':
      lines.push('- Verbosity: Be concise and get straight to the point without unnecessary filler.');
      break;
    case 'comprehensive':
      lines.push('- Verbosity: Provide comprehensive, detailed responses with thorough explanations when warranted.');
      break;
    case 'balanced':
    default:
      lines.push('- Verbosity: Provide balanced answers that are clear, thorough, and free of filler.');
      break;
  }

  // 4. Addressing Style
  switch (context.addressingStyle) {
    case 'first_name':
      lines.push('- Addressing: Address the user naturally by their first name when known.');
      break;
    case 'respectful':
      lines.push('- Addressing: Address the user with a respectful, professional demeanor without artificial honorifics.');
      break;
    case 'none':
    default:
      lines.push('- Addressing: Do not use titles, honorifics, or familiar nicknames by default. Address the user directly without prefixes.');
      break;
  }

  // 5. Emoji Policy
  switch (context.emojiPolicy) {
    case 'none':
      lines.push('- Emoji Policy: Do not use emojis in your responses.');
      break;
    case 'expressive':
      lines.push('- Emoji Policy: You may use emojis expressively and engagingly when appropriate.');
      break;
    case 'minimal':
    default:
      lines.push('- Emoji Policy: Use emojis sparingly and only when contextually natural (e.g. status or key markers). Do not add emojis merely for decorative friendliness.');
      break;
  }

  // 6. Humor Level
  switch (context.humorLevel) {
    case 'subtle':
      lines.push('- Humor: Subtle, contextually appropriate wit is acceptable when natural, without using slang or memes.');
      break;
    case 'none':
    default:
      lines.push('- Humor: Do not use humor; maintain a focused, helpful approach.');
      break;
  }

  // 7. Proactivity
  switch (context.proactivity) {
    case 'suggest_next_step':
      lines.push('- Proactivity: After answering directly, proactively suggest a relevant next step or useful follow-up if helpful.');
      break;
    case 'direct_answer':
    default:
      lines.push("- Proactivity: Answer the user's question directly. Do not append unsolicited follow-up offers or repetitive closing questions.");
      break;
  }

  return lines.join('\n');
}
