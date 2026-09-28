/**
 * Evaluation Harness Types (Phase 8.5)
 *
 * Defines contracts for behavioral architecture evaluation, structural assertions,
 * golden datasets, and deterministic replay bundles.
 */

export type EvaluationCategory =
  | 'memory'
  | 'conversation'
  | 'personalization'
  | 'adaptive_response'
  | 'agent'
  | 'provider'
  | 'proactive';

export interface EvaluationExpected {
  strategy?: string;
  toolCalls?: string[];
  forbiddenTools?: string[];
  memoryUsage?: 'none' | 'allowed' | 'required';
  clarification?: boolean;
  outcome?: string;
  status?: string;
  fallbackUsed?: boolean;
  maxSteps?: number;
  blockedReason?: string;
  expectedDepth?: string;
}

export interface EvaluationCase {
  id: string;
  name: string;
  category: EvaluationCategory;
  input: string;
  context?: Record<string, unknown>;
  expected: EvaluationExpected;
  tags?: string[];
}

export interface ReplayBundle {
  correlationId: string;
  caseId: string;
  category: EvaluationCategory;
  provider: string;
  steps: any[];
  toolCalls: string[];
  latencies: Record<string, number>;
  errors: string[];
}

export interface EvaluationResult {
  caseId: string;
  category: EvaluationCategory;
  passed: boolean;
  durationMs: number;
  errors: string[];
  actual: Record<string, unknown>;
  replayBundle: ReplayBundle;
}

export interface EvaluationReport {
  timestamp: string;
  totalCases: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  durationMs: number;
  categoryBreakdown: Record<
    EvaluationCategory,
    { total: number; passed: number; failed: number; passRate: number }
  >;
  failures: Array<{
    caseId: string;
    category: EvaluationCategory;
    errors: string[];
    replayBundle: ReplayBundle;
  }>;
}
