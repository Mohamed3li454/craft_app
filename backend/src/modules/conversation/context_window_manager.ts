/**
 * Context Window Manager (Phase 5)
 *
 * Implements two-tier conversation history formatting, strict character/token budgeting (2500 chars),
 * tool noise stripping, and deduplication with long-term memory.
 */

import { ConversationMessage, ContextWindowOptions } from './types';
import { GroqMessage } from '../groq/groq.provider';
import { ConversationContextCompactor } from './context_compactor';

export class ContextWindowManager {
  public static readonly DEFAULT_MAX_CHARACTERS = 2500;
  public static readonly DEFAULT_MAX_TURNS = 12;

  /**
   * Formats and intelligently compacts conversation history into clean GroqMessage turns
   * within the budget, preserving critical dependency chains, code blocks, and directives.
   */
  public static formatHistory(
    messages: readonly ConversationMessage[],
    currentInput: string,
    options?: ContextWindowOptions
  ): GroqMessage[] {
    return ConversationContextCompactor.compactHistory(messages, currentInput, options).formattedTurns;
  }

  /**
   * Gracefully truncates assistant responses without breaking code blocks or words mid-character.
   */
  private static gracefulTruncate(text: string, limit: number): string {
    if (text.length <= limit) return text;
    const slice = text.substring(0, limit);
    const lastNewline = slice.lastIndexOf('\n');
    if (lastNewline > limit * 0.7) {
      return slice.substring(0, lastNewline) + '\n...';
    }
    const lastSpace = slice.lastIndexOf(' ');
    if (lastSpace > limit * 0.7) {
      return slice.substring(0, lastSpace) + '...';
    }
    return slice + '...';
  }
}
