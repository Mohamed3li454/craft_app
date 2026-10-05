import { z } from 'zod';

/**
 * Canonical Runtime Configuration & Policy Contract (Phase 13.5)
 *
 * Provides a Single Source of Truth for mutable runtime control plane settings.
 * Ensures strict typing, deterministic validation, zero shadow state, and unified
 * resolution across all runtime consumers (Pipeline, Tools, Search, Proactive, Observability).
 */
export interface RuntimePolicy {
  maintenanceMode: boolean;
  debugLogging: boolean;
  searchEnabled: boolean;
  proactiveEnabled: boolean;
  defaultMemoryRetentionDays: number;
}

export type SafeRuntimeSettings = RuntimePolicy;

/**
 * Strict update schema rejecting unknown fields with a 400 validation error.
 */
export const UpdateRuntimePolicySchema = z
  .object({
    maintenanceMode: z.boolean().optional(),
    debugLogging: z.boolean().optional(),
    searchEnabled: z.boolean().optional(),
    proactiveEnabled: z.boolean().optional(),
    defaultMemoryRetentionDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

export type UpdateRuntimePolicyInput = z.infer<typeof UpdateRuntimePolicySchema>;

const DEFAULT_RUNTIME_POLICY: RuntimePolicy = {
  maintenanceMode: false,
  debugLogging: false,
  searchEnabled: true,
  proactiveEnabled: true,
  defaultMemoryRetentionDays: 365,
};

export class RuntimePolicyResolver {
  private static policy: RuntimePolicy = { ...DEFAULT_RUNTIME_POLICY };

  /**
   * Retrieves the current effective runtime policy.
   */
  public static getPolicy(): RuntimePolicy {
    return { ...this.policy };
  }

  /**
   * Mutates runtime policy in-memory and returns the updated state.
   */
  public static updatePolicy(updates: UpdateRuntimePolicyInput): RuntimePolicy {
    this.policy = {
      ...this.policy,
      ...updates,
    };
    return { ...this.policy };
  }

  /**
   * Resets policy to platform defaults (primarily for test isolation).
   */
  public static resetToDefault(): void {
    this.policy = { ...DEFAULT_RUNTIME_POLICY };
  }
}
