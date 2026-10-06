/**
 * Groq AI Provider Mapper (Phase 8.4)
 *
 * Handles bi-directional transformation between provider-neutral AIRequest/AIResponse
 * and Groq OpenAI-compatible Chat Completions payload formats.
 */

import {
  AIMessage,
  AIRequest,
  AIResponse,
  AIToolCall,
  AIFinishReason,
  AIUsage,
} from '../../types';
import { AIProviderError } from '../../provider_error';
import { redactSecrets } from '../../../tools/contracts/error.types';

export class GroqMapper {
  /**
   * Transforms provider-neutral AIRequest to Groq Chat Completions request payload.
   */
  public static toGroqPayload(request: AIRequest, defaultModel: string): Record<string, any> {
    const formattedMessages = request.messages.map((m) => {
      const msgObj: Record<string, any> = {
        role: m.role,
      };

      if (m.name) msgObj.name = m.name;
      if (m.toolCallId) msgObj.tool_call_id = m.toolCallId;

      if (m.content !== undefined) {
        msgObj.content = m.content;
      }

      if (m.toolCalls && m.toolCalls.length > 0) {
        msgObj.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.rawArguments || JSON.stringify(tc.function.arguments || {}),
          },
        }));
      }

      return msgObj;
    });

    const payload: Record<string, any> = {
      model: request.model || defaultModel,
      messages: formattedMessages,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.7,
    };

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools;
      if (request.toolChoice) {
        payload.tool_choice = request.toolChoice;
      } else {
        payload.tool_choice = 'auto';
      }
    }

    return payload;
  }

  /**
   * Normalizes raw Groq Chat API response to provider-neutral AIResponse.
   */
  public static fromGroqResponse(
    data: any,
    providerId: string,
    model: string,
    latencyMs: number
  ): AIResponse {
    const choice = data.choices?.[0];
    const assistantMsg = choice?.message;

    if (!assistantMsg) {
      throw new AIProviderError({
        providerId,
        category: 'malformed_response',
        message: 'Groq API response missing choices[0].message',
        retryable: true,
      });
    }

    // Extract tool calls
    const toolCalls: AIToolCall[] = [];
    if (assistantMsg.tool_calls && Array.isArray(assistantMsg.tool_calls)) {
      for (const tc of assistantMsg.tool_calls) {
        let parsedArgs: Record<string, any> = {};
        const rawArgs = tc.function?.arguments || '{}';
        try {
          parsedArgs = JSON.parse(rawArgs);
        } catch {
          parsedArgs = {};
        }

        toolCalls.push({
          id: tc.id || `tc_${Date.now()}`,
          type: 'function',
          function: {
            name: tc.function?.name || 'unknown_tool',
            arguments: parsedArgs,
            rawArguments: rawArgs,
          },
        });
      }
    }

    // Map finish reason
    let finishReason: AIFinishReason = 'stop';
    if (toolCalls.length > 0) {
      finishReason = 'tool_calls';
    } else if (choice.finish_reason === 'length') {
      finishReason = 'length';
    } else if (choice.finish_reason === 'content_filter') {
      finishReason = 'content_filter';
    } else if (choice.finish_reason === 'tool_calls') {
      finishReason = 'tool_calls';
    }

    // Map token usage
    let usage: AIUsage | undefined;
    if (data.usage) {
      const cached =
        data.usage.prompt_tokens_details?.cached_tokens ??
        data.usage.cached_tokens ??
        undefined;

      usage = {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        ...(cached !== undefined ? { cachedTokens: Number(cached) } : {}),
      };
    }

    const normalizedMessage: AIMessage = {
      role: 'assistant',
      content: assistantMsg.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };

    return {
      providerId,
      model,
      message: normalizedMessage,
      toolCalls,
      finishReason,
      usage,
      latencyMs,
      requestId: data.id,
      rawResponse: data,
    };
  }

  /**
   * Maps caught Groq error to typed AIProviderError with classified retryability.
   */
  public static toProviderError(err: any, providerId: string): AIProviderError {
    if (err instanceof AIProviderError) {
      return err;
    }

    return AIProviderError.classify(
      providerId,
      err,
      err.message || String(err)
    );
  }
}
