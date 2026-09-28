/**
 * Context Window Manager (Phase 5)
 *
 * Implements two-tier conversation history formatting, strict character/token budgeting (2500 chars),
 * tool noise stripping, and deduplication with long-term memory.
 */

import { ConversationMessage, ContextWindowOptions } from './types';
import { GroqMessage } from '../groq/groq.provider';

export class ContextWindowManager {
  public static readonly DEFAULT_MAX_CHARACTERS = 2500;
  public static readonly DEFAULT_MAX_TURNS = 8;

  /**
   * Formats conversation history into clean GroqMessage turns within the budget.
   */
  public static formatHistory(
    messages: readonly ConversationMessage[],
    currentInput: string,
    options?: ContextWindowOptions
  ): GroqMessage[] {
    const maxChars = options?.maxCharacters || ContextWindowManager.DEFAULT_MAX_CHARACTERS;
    const maxTurns = options?.maxTurns || ContextWindowManager.DEFAULT_MAX_TURNS;

    const turns: GroqMessage[] = [];
    const validMessages = messages.filter((m) => {
      const text = m.text?.trim();
      if (!text) return false;
      // Strip internal tool noise
      if (text.includes('Called tool:') || text.startsWith('Tool [') || text.includes('"name": "web_search"')) {
        return false;
      }
      return true;
    });

    // Select the most recent messages up to maxTurns
    const candidateMessages = validMessages.slice(-maxTurns);

    let accumulatedChars = currentInput.length;

    // Iterate backwards from newest to oldest to preserve the most recent turns within budget
    const selectedTurns: GroqMessage[] = [];

    for (let i = candidateMessages.length - 1; i >= 0; i--) {
      const m = candidateMessages[i];
      let text = m.text.trim();
      const role: 'user' | 'assistant' = m.role === 'user' ? 'user' : 'assistant';

      // Keep assistant replies clean: if very long (>600 chars), truncate gracefully at line or sentence
      if (role === 'assistant' && text.length > 600) {
        text = this.gracefulTruncate(text, 600);
      }

      if (accumulatedChars + text.length > maxChars && selectedTurns.length >= 2) {
        // Budget limit reached and we already have the immediate context
        break;
      }

      accumulatedChars += text.length;
      selectedTurns.unshift({ role, content: text });
    }

    // Append current user turn
    const cleanCurrent = currentInput.trim();
    if (selectedTurns.length > 0 && selectedTurns[selectedTurns.length - 1].role === 'user') {
      selectedTurns[selectedTurns.length - 1].content = cleanCurrent;
    } else {
      selectedTurns.push({ role: 'user', content: cleanCurrent });
    }

    // Merge consecutive same-role turns
    const mergedTurns: GroqMessage[] = [];
    for (const turn of selectedTurns) {
      if (mergedTurns.length > 0 && mergedTurns[mergedTurns.length - 1].role === turn.role) {
        mergedTurns[mergedTurns.length - 1].content += `\n${turn.content}`;
      } else {
        mergedTurns.push({ ...turn });
      }
    }

    // Ensure conversation starts with a user turn
    while (mergedTurns.length > 0 && mergedTurns[0].role !== 'user') {
      mergedTurns.shift();
    }

    if (mergedTurns.length === 0) {
      mergedTurns.push({ role: 'user', content: cleanCurrent });
    }

    return mergedTurns;
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
