/**
 * Instruction Matcher for Current User Request
 *
 * Deterministically detects runtime directives in the current message
 * (Tier 2 in Precedence Hierarchy), overriding any persistent stored preferences.
 */

import { VerbosityLevel, FormalityLevel } from '../personality/types';
import { CodeSnippetPolicy, ExplanationStyle } from './types';

export interface ExtractedRuntimeDirectives {
  readonly verbosityOverride?: VerbosityLevel;
  readonly formalityOverride?: FormalityLevel;
  readonly codeSnippetPolicy?: CodeSnippetPolicy;
  readonly explanationStyle?: ExplanationStyle;
}

function normalize(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove diacritics
    .replace(/\u0640/g, '') // remove tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'؟،]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesAny(norm: string, phrases: (string | RegExp)[]): boolean {
  return phrases.some((p) => {
    if (typeof p === 'string') {
      const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'i');
      return regex.test(norm) || norm.includes(p);
    }
    return p.test(norm);
  });
}

export function extractRuntimeDirectives(query: string): ExtractedRuntimeDirectives {
  const norm = normalize(query);
  const directives: {
    verbosityOverride?: VerbosityLevel;
    formalityOverride?: FormalityLevel;
    codeSnippetPolicy?: CodeSnippetPolicy;
    explanationStyle?: ExplanationStyle;
  } = {};

  // 1. Verbosity Directives
  // Concise / brief
  const concisePhrases = [
    'باختصار',
    'مختصر',
    'لخص',
    'ملخص',
    'في نقطتين',
    'في جمله',
    'كلمتين وبس',
    /\bbrief\b/i,
    /\bconcise\b/i,
    /\bshort summary\b/i,
    /\bin short\b/i,
    /\bquick answer\b/i,
    /\bkeep it short\b/i,
  ];

  // Comprehensive / detailed
  const detailedPhrases = [
    'بالتفصيل',
    'بالتفصيل الممل',
    'مفصل',
    'خطوه بخطوه',
    'اشرح كل حاجه',
    'باستفاضه',
    'مع الشرح الكامل',
    /\bin detail\b/i,
    /\bdetailed\b/i,
    /\bstep by step\b/i,
    /\bthoroughly\b/i,
    /\bcomprehensive\b/i,
    /\bdeep dive\b/i,
    /\bexplain in detail\b/i,
  ];

  if (matchesAny(norm, detailedPhrases)) {
    directives.verbosityOverride = 'comprehensive';
  } else if (matchesAny(norm, concisePhrases)) {
    directives.verbosityOverride = 'concise';
  }

  // 2. Code Snippet Directives
  const noCodePhrases = [
    'بدون كود',
    'من غير كود',
    'لا تكتب كود',
    'بلاش كود',
    /\bno code\b/i,
    /\bwithout code\b/i,
    /\bdon'?t write code\b/i,
  ];

  const fullCodePhrases = [
    'كود كامل',
    'الكود كامل',
    'مع الكود كامل',
    /\bfull code\b/i,
    /\bcomplete code\b/i,
    /\bready to run code\b/i,
  ];

  if (matchesAny(norm, noCodePhrases)) {
    directives.codeSnippetPolicy = 'none';
  } else if (matchesAny(norm, fullCodePhrases)) {
    directives.codeSnippetPolicy = 'complete';
  }

  // 3. Explanation Style Directives
  const directPhrases = [
    'بدون مقدمات',
    'من غير لف ودوران',
    'جاوب علطول',
    'بشكل مباشر',
    /\bdirect answer\b/i,
    /\bget straight to the point\b/i,
    /\bno fluff\b/i,
  ];

  const stepPhrases = [
    'خطوه بخطوه',
    'خطوات',
    /\bstep by step\b/i,
    /\bsteps\b/i,
  ];

  if (matchesAny(norm, directPhrases)) {
    directives.explanationStyle = 'direct';
  } else if (matchesAny(norm, stepPhrases)) {
    directives.explanationStyle = 'step_by_step';
  }

  // 4. Formality Directives
  const casualPhrases = [
    'خليك عادي',
    'اتكلم عادي',
    'بشكل ودي',
    'اسلوب عادي',
    'تكلم بشكل ودي',
    /\bspeak casually\b/i,
    /\bcasual tone\b/i,
  ];

  const formalPhrases = [
    'بشكل رسمي',
    'اتكلم رسمي',
    'تكلم رسمي',
    'جاوب رسمي',
    'اسلوب رسمي',
    'خليك رسمي',
    'تحدث برسمية',
    /\bspeak formally\b/i,
    /\bformal tone\b/i,
    /\bformal style\b/i,
  ];

  if (matchesAny(norm, casualPhrases)) {
    directives.formalityOverride = 'casual';
  } else if (matchesAny(norm, formalPhrases)) {
    directives.formalityOverride = 'formal';
  }

  return directives;
}
