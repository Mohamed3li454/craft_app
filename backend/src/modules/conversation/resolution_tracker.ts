/**
 * Resolution & Goal Tracker (Phase 5)
 *
 * Deterministically tracks conversation goals and resolves the lifecycle state
 * of troubleshooting issues (unresolved -> in_progress -> resolved).
 */

import { ConversationGoal, ResolutionState, ConversationMessage } from './types';

export interface GoalResolutionAnalysisResult {
  readonly goal: ConversationGoal;
  readonly resolutionState: ResolutionState;
  readonly unresolvedItems: readonly string[];
}

function normalize(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

export class ResolutionTracker {
  private static readonly RESOLUTION_PATTERNS = [
    /اشتغل\s+تمام/i,
    /اتحلت\s+المشكله/i,
    /اتحلت/i,
    /شكرا\s+اتحلت/i,
    /تسلم\s+اشتغلت/i,
    /كله\s+تمام/i,
    /تمام\s+كده/i,
    /\bit\s+worked\b/i,
    /\bfixed\s+now\b/i,
    /\bproblem\s+solved\b/i,
    /\bissue\s+resolved\b/i,
    /\bthat\s+solved\s+it\b/i,
    /\bworks\s+fine\s+now\b/i,
  ];

  private static readonly TROUBLESHOOTING_KEYWORDS = [
    'مشكله', 'ايرور', 'خطا', 'فشل', 'بيفشل', 'عطل', 'مش شغال',
    'مش بيشتغل', 'error', 'exception', 'crash', 'fail', 'failing', 'bug', 'issue', 'not working',
    '401', '403', '404', '500', 'status code', 'build failed', 'rejected',
  ];

  private static readonly PLANNING_KEYWORDS = [
    'خطه', 'تخطيط', 'معماريه', 'هيكله', 'تصميم نظام', 'تقسيم الكود', 'تنظيم الكود',
    'موديولات', 'موديول', 'architecture', 'plan', 'planning', 'roadmap', 'system design', 'modular',
  ];

  private static readonly IMPLEMENTATION_KEYWORDS = [
    'اكتب كود', 'كود كامل', 'عايز كود', 'implement', 'write code', 'build code',
    'داله', 'function', 'class', 'endpoint',
  ];

  private static readonly DECISION_KEYWORDS = [
    'مقارنه', 'افضل ولا', 'احسن ولا', 'ايهما افضل', 'ايه افضل', 'ايه احسن', 'ما هو افضل', 'ما هي افضل',
    'افضل', 'احسن', 'compare', 'versus', ' vs ', 'which is better', 'best',
  ];

  private static readonly TRANSACTIONAL_KEYWORDS = [
    'فكرني', 'ذكرني', 'تذكير', 'remind', 'reminder', 'طقس', 'الطقس', 'weather', 'الساعه', 'time',
  ];

  private static readonly CASUAL_KEYWORDS = [
    'مرحبا', 'مرحب', 'اهلا', 'صباح الخير', 'مساء الخير', 'ازيك', 'عامل ايه',
    'hello', 'hi', 'hey', 'good morning', 'good evening',
  ];

  public static analyze(
    query: string,
    recentMessages: readonly ConversationMessage[] = [],
    previousResolutionState: ResolutionState = 'not_applicable'
  ): GoalResolutionAnalysisResult {
    const trimmed = (query || '').trim();
    const norm = normalize(trimmed);

    // 1. Detect Resolution Marker
    const isExplicitlyResolved = this.RESOLUTION_PATTERNS.some((p) => p.test(norm));
    if (isExplicitlyResolved) {
      return {
        goal: 'troubleshooting',
        resolutionState: 'resolved',
        unresolvedItems: [],
      };
    }

    // 2. Classify Goal
    const isTroubleshooting = this.TROUBLESHOOTING_KEYWORDS.some((kw) => norm.includes(kw));
    const isPlanning = this.PLANNING_KEYWORDS.some((kw) => norm.includes(kw));
    const isImplementation = this.IMPLEMENTATION_KEYWORDS.some((kw) => norm.includes(kw));
    const isDecision = this.DECISION_KEYWORDS.some((kw) => norm.includes(kw));
    const isTransactional = this.TRANSACTIONAL_KEYWORDS.some((kw) => norm.includes(kw));
    const isCasual = this.CASUAL_KEYWORDS.some((kw) => norm.includes(kw));

    let goal: ConversationGoal = 'informational';
    if (isTroubleshooting) {
      goal = 'troubleshooting';
    } else if (isPlanning) {
      goal = 'planning';
    } else if (isImplementation) {
      goal = 'implementation';
    } else if (isDecision) {
      goal = 'decision_support';
    } else if (isTransactional) {
      goal = 'transactional';
    } else if (isCasual) {
      goal = 'casual';
    }

    // 3. Determine Resolution State
    let resolutionState: ResolutionState = 'not_applicable';
    const unresolvedItems: string[] = [];

    if (goal === 'troubleshooting') {
      const hasPriorAssistantTurn = recentMessages.some((m) => m.role === 'assistant');
      if (hasPriorAssistantTurn || previousResolutionState === 'in_progress') {
        resolutionState = 'in_progress';
      } else {
        resolutionState = 'unresolved';
      }
      unresolvedItems.push(trimmed);
    } else if (previousResolutionState === 'in_progress' || previousResolutionState === 'unresolved') {
      // Check if user is following up on previous unresolved issue
      const isStillFollowingUp = norm.includes('لسه') || norm.includes('still') || norm.includes('نفس');
      if (isStillFollowingUp) {
        goal = 'troubleshooting';
        resolutionState = 'in_progress';
        unresolvedItems.push(trimmed);
      }
    }

    return {
      goal,
      resolutionState,
      unresolvedItems: Object.freeze(unresolvedItems),
    };
  }
}
