/**
 * Conversation Context Compactor (Phase 14.4)
 *
 * Implements intelligent, deterministic conversation history compaction:
 * 1. Three-Tier Relevance Model:
 *    - CRITICAL: User corrections, active goals, code blocks, technical identifiers,
 *      task directives ("بكرة", "الساعة 10", "خليه 11"), follow-up pointers ("اعملها", "كمل"),
 *      and language/style preferences. NEVER lossy-truncated.
 *    - RELEVANT: Recent discussion context, explanations, and search topics.
 *    - LOW_VALUE: Redundant greetings, older acknowledgements, and conversational filler.
 * 2. Contextual Dependency Chain Preservation:
 *    - Prevents naive .slice(-N) blind truncation. Follow-up sequences ("reminder" -> "بكرة" -> "10")
 *      retain the complete chain.
 * 3. Exact Technical & Code Invariant:
 *    - Never summarizes or truncates code blocks, file paths, or framework identifiers.
 * 4. Zero LLM Cost & Zero Latency Overhead:
 *    - 100% deterministic, local, reversible in concept.
 */

import { ConversationMessage, ContextWindowOptions } from './types';
import { GroqMessage } from '../groq/groq.provider';
import { AdaptiveContextBudgetManager, ContextBudgetMode } from '../context';

export type MessageRelevanceTier = 'CRITICAL' | 'RELEVANT' | 'LOW_VALUE';

export interface ClassifiedMessage {
  readonly message: ConversationMessage;
  readonly tier: MessageRelevanceTier;
  readonly reason: string;
  readonly index: number;
}

export interface CompactedConversationContext {
  readonly criticalMessages: ConversationMessage[];
  readonly relevantMessages: ConversationMessage[];
  readonly formattedTurns: GroqMessage[];
  readonly summaryText?: string;
  readonly originalCount: number;
  readonly preservedCount: number;
  readonly omittedCount: number;
  readonly compressionReason: string;
  readonly tokensSavedEstimate: number;
  readonly budgetMode?: ContextBudgetMode;
}

export class ConversationContextCompactor {
  public static readonly DEFAULT_MAX_CHARACTERS = 2500;
  public static readonly DEFAULT_MAX_TURNS = 12;

  /**
   * Compiles and compacts conversation messages into bounded GroqMessage turns
   * with strict protection for critical context and zero loss of meaning.
   */
  public static compactHistory(
    messages: readonly ConversationMessage[],
    currentInput: string,
    options?: ContextWindowOptions
  ): CompactedConversationContext {
    const cleanCurrent = (currentInput || '').trim();
    const resolvedMode: ContextBudgetMode =
      options?.budgetMode || AdaptiveContextBudgetManager.resolveBudgetMode({ userQuery: cleanCurrent });
    const modeLimits = AdaptiveContextBudgetManager.getLimitsForMode(resolvedMode);
    const maxChars =
      options?.maxCharacters ||
      (options?.budgetMode ? modeLimits.maxHistoryChars : this.DEFAULT_MAX_CHARACTERS);

    // 1. Filter out internal tool trace noise
    const validMessages = messages.filter((m) => {
      const text = (m.text || '').trim();
      if (!text) return false;
      if (text.includes('Called tool:') || text.startsWith('Tool [') || text.includes('"name": "web_search"')) {
        return false;
      }
      return true;
    });

    const totalOriginal = validMessages.length;
    if (totalOriginal === 0) {
      return {
        criticalMessages: [],
        relevantMessages: [],
        formattedTurns: [{ role: 'user', content: cleanCurrent }],
        originalCount: 0,
        preservedCount: 1,
        omittedCount: 0,
        compressionReason: 'EMPTY_HISTORY_BASELINE',
        tokensSavedEstimate: 0,
        budgetMode: resolvedMode,
      };
    }

    // 2. Classify messages into CRITICAL, RELEVANT, LOW_VALUE
    const classified: ClassifiedMessage[] = validMessages.map((msg, idx) => {
      const isRecent = idx >= validMessages.length - 2;
      const tierResult = this.classifyMessage(msg, isRecent);
      return {
        message: msg,
        tier: tierResult.tier,
        reason: tierResult.reason,
        index: idx,
      };
    });

    // 3. Dependency Propagation: If a message is CRITICAL, protect its conversational partner
    const protectedIndices = new Set<number>();
    for (let i = 0; i < classified.length; i++) {
      if (classified[i].tier === 'CRITICAL') {
        protectedIndices.add(i);
        // If user message is critical, protect the immediately preceding or succeeding assistant turn
        if (classified[i].message.role === 'user' && i > 0 && classified[i - 1].message.role === 'assistant') {
          protectedIndices.add(i - 1);
        }
        if (classified[i].message.role === 'user' && i + 1 < classified.length && classified[i + 1].message.role === 'assistant') {
          protectedIndices.add(i + 1);
        }
      }
    }

    // 4. Candidate selection: Always include CRITICAL + protected turns; include RELEVANT within budget
    const criticalList: ConversationMessage[] = [];
    const relevantList: ConversationMessage[] = [];
    let omittedChars = 0;
    let omittedCount = 0;

    // Iterate backwards from newest to oldest
    const selectedTurns: Array<{ role: 'user' | 'assistant'; content: string; isCritical: boolean }> = [];
    let accumulatedChars = cleanCurrent.length;

    for (let i = classified.length - 1; i >= 0; i--) {
      const item = classified[i];
      const isCritical = protectedIndices.has(i);
      let text = item.message.text.trim();
      const role: 'user' | 'assistant' = item.message.role === 'user' ? 'user' : 'assistant';

      if (!isCritical && item.tier === 'LOW_VALUE') {
        omittedChars += text.length;
        omittedCount++;
        continue;
      }

      // Compact older assistant responses if long (>500 chars), but NEVER compact code or user messages
      if (role === 'assistant' && !isCritical && text.length > 500 && !text.includes('```')) {
        const originalLen = text.length;
        text = this.gracefulTruncate(text, 500);
        omittedChars += (originalLen - text.length);
      }

      // Budget check: If budget exceeded, only CRITICAL messages are allowed through
      if (accumulatedChars + text.length > maxChars && selectedTurns.length >= 2 && !isCritical) {
        omittedChars += text.length;
        omittedCount++;
        continue;
      }

      accumulatedChars += text.length;
      if (isCritical) {
        criticalList.unshift(item.message);
      } else {
        relevantList.unshift(item.message);
      }

      selectedTurns.unshift({ role, content: text, isCritical });
    }

    // 5. Append current user message
    if (selectedTurns.length > 0 && selectedTurns[selectedTurns.length - 1].role === 'user') {
      selectedTurns[selectedTurns.length - 1].content = cleanCurrent;
    } else {
      selectedTurns.push({ role: 'user', content: cleanCurrent, isCritical: true });
    }

    // 6. Merge consecutive same-role turns cleanly
    const mergedTurns: GroqMessage[] = [];
    for (const turn of selectedTurns) {
      if (mergedTurns.length > 0 && mergedTurns[mergedTurns.length - 1].role === turn.role) {
        mergedTurns[mergedTurns.length - 1].content += `\n${turn.content}`;
      } else {
        mergedTurns.push({ role: turn.role, content: turn.content });
      }
    }

    // Ensure conversation starts with a user turn
    while (mergedTurns.length > 0 && mergedTurns[0].role !== 'user') {
      mergedTurns.shift();
    }

    if (mergedTurns.length === 0) {
      mergedTurns.push({ role: 'user', content: cleanCurrent });
    }

    const tokensSavedEstimate = Math.max(0, Math.round(omittedChars / 3.8));

    return {
      criticalMessages: criticalList,
      relevantMessages: relevantList,
      formattedTurns: mergedTurns,
      originalCount: totalOriginal,
      preservedCount: selectedTurns.length,
      omittedCount,
      compressionReason: omittedCount > 0 ? 'LOW_VALUE_PRUNED_AND_CRITICAL_ANCHORED' : 'FULL_HISTORY_PRESERVED',
      tokensSavedEstimate,
      budgetMode: resolvedMode,
    };
  }

  /**
   * Deterministically classifies a message into a relevance tier.
   */
  public static classifyMessage(
    msg: ConversationMessage,
    isRecentTurn: boolean
  ): { tier: MessageRelevanceTier; reason: string } {
    const text = (msg.text || '').trim();
    if (!text) {
      return { tier: 'LOW_VALUE', reason: 'EMPTY_TEXT' };
    }

    // Immediate recent turns are always CRITICAL to maintain immediate conversational thread
    if (isRecentTurn) {
      return { tier: 'CRITICAL', reason: 'IMMEDIATE_RECENT_TURN' };
    }

    // 1. Explicit user corrections or refutations (CRITICAL)
    if (this.isExplicitCorrection(text)) {
      return { tier: 'CRITICAL', reason: 'USER_EXPLICIT_CORRECTION' };
    }

    // 2. Code blocks (CRITICAL - code must never be lost or hallucinated)
    if (text.includes('```')) {
      return { tier: 'CRITICAL', reason: 'CODE_BLOCK_INVARIANT' };
    }

    // 3. Technical file paths, identifiers, frameworks (CRITICAL)
    if (this.hasTechnicalIdentifiers(text)) {
      return { tier: 'CRITICAL', reason: 'TECHNICAL_IDENTIFIER_INVARIANT' };
    }

    // 4. Task, reminder, scheduling, or time directives (CRITICAL)
    if (this.hasActionOrSchedulingDirectives(text)) {
      return { tier: 'CRITICAL', reason: 'ACTION_SCHEDULING_DIRECTIVE' };
    }

    // 5. Follow-up execution commands (CRITICAL)
    if (this.isFollowUpCommand(text)) {
      return { tier: 'CRITICAL', reason: 'FOLLOW_UP_ACTION_COMMAND' };
    }

    // 6. Language or style preferences (CRITICAL)
    if (this.hasStyleOrLanguagePreferences(text)) {
      return { tier: 'CRITICAL', reason: 'STYLE_LANGUAGE_PREFERENCE' };
    }

    // 7. Low-value older greetings or pleasantries (LOW_VALUE)
    if (this.isPurePleasantry(text)) {
      return { tier: 'LOW_VALUE', reason: 'REDUNDANT_OLDER_PLEASANTRY' };
    }

    // 8. General conversation context (RELEVANT)
    return { tier: 'RELEVANT', reason: 'GENERAL_DISCUSSION_CONTEXT' };
  }

  private static isExplicitCorrection(text: string): boolean {
    const patterns = [
      /(^|\s)(لا|قصدي|مش كدا|مش كده|اقصد|أقصد|لا أقصد|لا اقصد|لا اعمل|ارجع كلمني|خليها|بدل)(\s|$)/i,
      /\b(no|not that|instead|i meant|actually|correction|do not|don't)\b/i,
    ];
    return patterns.some((p) => p.test(text));
  }

  private static hasTechnicalIdentifiers(text: string): boolean {
    const patterns = [
      /\b[\w\-./]+\.(ts|js|dart|json|yaml|sql|md|py|java|cpp|html|css)\b/i,
      /\b(flutter|dart|supabase|postgres|riverpod|provider|bloc|widget|statefulwidget|statelesswidget|clean architecture|api|sdk|cli)\b/i,
      /\b(error|exception|stacktrace|nullpointer|overflow|timeout|failed|failure)\b/i,
      /(خطأ|استثناء|كود|ملف|مكتبة|دالة|كلاس)/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private static hasActionOrSchedulingDirectives(text: string): boolean {
    const patterns = [
      /(فكرني|ذكرني|تذكير|remind|بكرة|بكره|الساعة|الساعه|خليه|خليه \d+|موعد|اجتماع|task|todo)/i,
      /\b(tomorrow|at \d+|pm|am|clock|meeting|reminder)\b/i,
      /\b(rem_[a-zA-Z0-9_-]+|task_[a-zA-Z0-9_-]+)\b/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private static isFollowUpCommand(text: string): boolean {
    const patterns = [
      /^(اعملها|نفذها|كمل|زي ما اتفقنا|هو ده|نفس الحاجه|نفس الشيء|تمام كده)$/i,
      /^(do it|execute|continue|proceed|as agreed)$/i,
    ];
    return patterns.some((p) => p.test(text.trim()));
  }

  private static hasStyleOrLanguagePreferences(text: string): boolean {
    const patterns = [
      /(بالمصري|فصحى|عربي|انجليزي|english|arabic)/i,
      /(مختصر|طويل|بالتفصيل|بدون كود|concise|detailed|brief|no code)/i,
    ];
    return patterns.some((p) => p.test(text));
  }

  private static isPurePleasantry(text: string): boolean {
    const pleasantryWords = [
      'السلام عليكم ورحمة الله', 'السلام عليكم', 'سلام عليكم', 'وعليكم السلام',
      'صباح الخير', 'مساء الخير', 'عامل ايه', 'عامل اي', 'اخبارك ايه', 'اخبارك',
      'ازيك', 'مرحبا', 'اهلا وسهلا', 'اهلين', 'اهلا', 'هاي', 'هالو', 'الو',
      'شكرا جزيلا', 'الف شكر', 'شكرا', 'شكراً', 'تسلم', 'الله يخليك', 'مشكور',
      'يعطيك العافيه', 'تمام', 'ماشي', 'اوك', 'اوكي', 'حلو', 'كويس', 'فهمتك',
      'عظيم', 'يا هلا', 'كيفك', 'جزيلا',
      'good morning', 'good evening', 'how are you', 'thank you', 'thanks',
      'hello', 'cool', 'great', 'okay', 'fine', 'hey', 'hi', 'ok'
    ];
    let stripped = text.trim();
    for (const w of pleasantryWords) {
      stripped = stripped.replace(new RegExp(w, 'gi'), ' ');
    }
    stripped = stripped.replace(/[\s!؟?.,،\-~]+/g, '').trim();
    return stripped.length === 0;
  }

  private static gracefulTruncate(text: string, limit: number): string {
    if (text.length <= limit) return text;
    const slice = text.substring(0, limit);
    const lastNewline = slice.lastIndexOf('\n');
    if (lastNewline > limit * 0.7) {
      return `${slice.substring(0, lastNewline)}\n...`;
    }
    const lastSpace = slice.lastIndexOf(' ');
    if (lastSpace > limit * 0.7) {
      return `${slice.substring(0, lastSpace)}...`;
    }
    return `${slice}...`;
  }
}
