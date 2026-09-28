/**
 * Tool Input Validator (Phase 8.2)
 *
 * Enforces strict runtime input validation for tool calls:
 * - Real runtime schema validation with Zod (strict by default, rejects unknown fields)
 * - Fallback parameter schema checking for legacy tools
 * - Automatic URL & SSRF validation on URL fields
 * - Oversized string & payload bounding
 * - Structured, user-safe validation error production
 */

import { z } from 'zod';
import { AgentTool } from '../contracts/tool.types';
import { createToolError, ToolError } from '../contracts/error.types';
import { UrlSecurityValidator } from './url_validator';

const MAX_STRING_LENGTH = 25000;

export interface ValidationSuccess<T> {
  readonly success: true;
  readonly data: T;
}

export interface ValidationFailure {
  readonly success: false;
  readonly error: ToolError;
}

export type ToolValidationResult<T = Record<string, any>> =
  | ValidationSuccess<T>
  | ValidationFailure;

export class ToolInputValidator {
  /**
   * Validates raw arguments provided by the LLM against the tool's schema.
   */
  public static validate<T = Record<string, any>>(
    tool: AgentTool,
    rawArgs: unknown
  ): ToolValidationResult<T> {
    // 1. Ensure rawArgs is an object
    let parsedArgs: Record<string, any>;
    if (typeof rawArgs === 'string') {
      try {
        parsedArgs = JSON.parse(rawArgs);
      } catch {
        return {
          success: false,
          error: createToolError(
            'VALIDATION_ERROR',
            `Malformed JSON arguments provided for tool [${tool.name}]`,
            { userSafeMessage: `Invalid parameters received for tool ${tool.name}.` }
          ),
        };
      }
    } else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
      parsedArgs = { ...(rawArgs as Record<string, any>) };
    } else if (rawArgs === undefined || rawArgs === null) {
      parsedArgs = {};
    } else {
      return {
        success: false,
        error: createToolError(
          'VALIDATION_ERROR',
          `Tool arguments must be a structured object for tool [${tool.name}]`,
          { userSafeMessage: `Invalid parameter format for tool ${tool.name}.` }
        ),
      };
    }

    // 2. Guard against oversized string payloads
    for (const [key, value] of Object.entries(parsedArgs)) {
      if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
        return {
          success: false,
          error: createToolError(
            'VALIDATION_ERROR',
            `Field "${key}" exceeds maximum permitted length of ${MAX_STRING_LENGTH} characters for tool [${tool.name}]`,
            { userSafeMessage: `Input text for "${key}" is too long (maximum ${MAX_STRING_LENGTH} characters).` }
          ),
        };
      }
    }

    // 3. Primary Path: Zod Schema Validation
    if (tool.schema) {
      const parseResult = tool.schema.safeParse(parsedArgs);
      if (!parseResult.success) {
        const issues = parseResult.error.issues;
        const details = issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join(', ');
        return {
          success: false,
          error: createToolError(
            'VALIDATION_ERROR',
            `Schema validation failed for tool [${tool.name}]: ${details}`,
            {
              userSafeMessage: `Invalid parameters for tool ${tool.name}: ${details}`,
              details: { issues },
            }
          ),
        };
      }

      // 4. URL field security validation
      const urlCheck = this.validateUrlFields(tool.name, parseResult.data);
      if (!urlCheck.success) {
        return urlCheck;
      }

      return {
        success: true,
        data: parseResult.data as T,
      };
    }

    // 5. Fallback Path: JSON Parameters Schema Validation (for legacy/custom tools)
    const fallbackResult = this.validateParametersSchema(tool, parsedArgs);
    if (!fallbackResult.success) {
      return fallbackResult;
    }

    // 6. URL field security validation on fallback data
    const urlCheck = this.validateUrlFields(tool.name, fallbackResult.data);
    if (!urlCheck.success) {
      return urlCheck;
    }

    return {
      success: true,
      data: fallbackResult.data as T,
    };
  }

  /**
   * Scans arguments for URL keys or values and enforces SSRF protection.
   */
  private static validateUrlFields(
    toolName: string,
    args: Record<string, any>
  ): ToolValidationResult<Record<string, any>> {
    for (const [key, value] of Object.entries(args)) {
      const isUrlKey = /^(url|uri|link|endpoint|target_url|website)$/i.test(key);
      const isUrlString =
        typeof value === 'string' &&
        /^(https?:\/\/|localhost|127\.0\.0\.1|0\.0\.0\.0|169\.254\.)/i.test(value.trim());

      if ((isUrlKey || isUrlString) && typeof value === 'string') {
        const urlValidation = UrlSecurityValidator.validate(value);
        if (!urlValidation.isValid) {
          return {
            success: false,
            error: createToolError(
              'SSRF_BLOCKED',
              `SSRF policy blocked URL for tool [${toolName}] in field "${key}": ${urlValidation.error}`,
              {
                userSafeMessage: `The provided URL is not permitted for security reasons: ${urlValidation.error}`,
                details: { field: key, isSsrf: urlValidation.isSsrf },
              }
            ),
          };
        }
      }
    }

    return { success: true, data: args };
  }

  /**
   * Deterministic parameter schema validation when no Zod schema is provided.
   */
  private static validateParametersSchema(
    tool: AgentTool,
    args: Record<string, any>
  ): ToolValidationResult<Record<string, any>> {
    const properties = tool.parameters?.properties || {};
    const required = tool.parameters?.required || [];
    const normalized: Record<string, any> = {};

    // 1. Check for unknown fields (strict by default)
    for (const key of Object.keys(args)) {
      if (!properties[key]) {
        return {
          success: false,
          error: createToolError(
            'VALIDATION_ERROR',
            `Unknown field "${key}" provided to tool [${tool.name}]. Allowed fields: ${Object.keys(properties).join(', ') || 'none'}`,
            { userSafeMessage: `Unexpected parameter "${key}" for tool ${tool.name}.` }
          ),
        };
      }
    }

    // 2. Check required fields
    for (const reqKey of required) {
      if (args[reqKey] === undefined || args[reqKey] === null || args[reqKey] === '') {
        return {
          success: false,
          error: createToolError(
            'VALIDATION_ERROR',
            `Missing required parameter "${reqKey}" for tool [${tool.name}]`,
            { userSafeMessage: `Missing required parameter "${reqKey}" for tool ${tool.name}.` }
          ),
        };
      }
    }

    // 3. Check types & enum values
    for (const [key, prop] of Object.entries(properties)) {
      const val = args[key];
      if (val === undefined || val === null) {
        continue;
      }

      const expectedType = (prop.type || 'string').toLowerCase();
      const actualType = typeof val;

      if (expectedType === 'string' && actualType !== 'string') {
        return {
          success: false,
          error: createToolError(
            'VALIDATION_ERROR',
            `Parameter "${key}" must be a string, received ${actualType} for tool [${tool.name}]`
          ),
        };
      }
      if (expectedType === 'number' && actualType !== 'number') {
        return {
          success: false,
          error: createToolError(
            'VALIDATION_ERROR',
            `Parameter "${key}" must be a number, received ${actualType} for tool [${tool.name}]`
          ),
        };
      }
      if (expectedType === 'boolean' && actualType !== 'boolean') {
        return {
          success: false,
          error: createToolError(
            'VALIDATION_ERROR',
            `Parameter "${key}" must be a boolean, received ${actualType} for tool [${tool.name}]`
          ),
        };
      }

      if (prop.enum && Array.isArray(prop.enum)) {
        if (!prop.enum.includes(String(val))) {
          return {
            success: false,
            error: createToolError(
              'VALIDATION_ERROR',
              `Parameter "${key}" must be one of [${prop.enum.join(', ')}], received "${val}" for tool [${tool.name}]`
            ),
          };
        }
      }

      normalized[key] = val;
    }

    return { success: true, data: normalized };
  }
}
