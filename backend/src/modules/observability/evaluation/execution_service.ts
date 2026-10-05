/**
 * Evaluation Execution Service (Phase 12.2)
 *
 * Coordinates execution of evaluation cases in isolated modes (mock, replay, live),
 * applies deterministic structural assertions, computes longitudinal regression signals,
 * sanitizes all trace metadata, and persists historical evaluation runs.
 *
 * Strictly enforces: Production Runtime != Evaluation Harness.
 * Zero writes to production business tables.
 */

import { GOLDEN_EVALUATION_DATASET } from './dataset';
import { EvaluationEvaluator } from './evaluator';
import { EvaluationCategory, EvaluationCase } from './types';
import {
  EvaluationRepository,
  EvaluationRunMode,
  EvaluationRunRecord,
  EvaluationCaseResultRecord,
  NewEvaluationCaseResult,
} from '../../../database/repositories/evaluation.repo';
import { redactObject, redactSecrets } from '../redaction';
import { logger } from '../../../core/logger';
import { extractReleaseMetadata, resolveDatasetProvenance } from './release_quality';

export const EVALUATION_HARD_LIMITS = {
  MAX_CASES: 56,
  MAX_CONCURRENCY: 5,
  MAX_TOKENS_PER_RUN: 50_000,
  MAX_TOKENS_PER_CASE: 2_500,
  MAX_EXECUTION_DURATION_MS: 120_000,
  MAX_CASE_DURATION_MS: 15_000,
  MAX_OUTPUT_SIZE_BYTES: 64 * 1024,
};

export class EvaluationValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'EvaluationValidationError';
  }
}

export interface ActiveRunState {
  runId: string;
  abortController: AbortController;
  isCancelled: boolean;
  totalCases: number;
  processedCases: number;
  passedCases: number;
  failedCases: number;
  status: 'running' | 'cancelled' | 'completed' | 'failed';
  startedAt: number;
}

export interface RunProgressInfo {
  runId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  totalCases: number;
  processedCases: number;
  passedCases: number;
  failedCases: number;
  progressPercent: number;
  durationMs: number;
  isCompleted: boolean;
  isCancelled: boolean;
}

export interface ExecuteRunOptions {
  datasetVersion?: string;
  mode?: EvaluationRunMode;
  category?: EvaluationCategory;
  tag?: string;
  caseIds?: string[];
  createdBy?: string;
  concurrency?: number;
  maxTokens?: number;
  timeoutMs?: number;
  idempotencyKey?: string;
  releaseMetadata?: Record<string, any>;
}

export interface RunExecutionResult {
  run: EvaluationRunRecord;
  results: EvaluationCaseResultRecord[];
  regressionSummary: {
    totalRegressions: number;
    regressedCaseIds: string[];
    baselineRunId?: string | null;
  };
  deduplicated?: boolean;
}

export class EvaluationExecutionService {
  private static instance: EvaluationExecutionService;
  private evaluator = EvaluationEvaluator.getInstance();
  private repo = EvaluationRepository.getInstance();
  private idempotencyCache = new Map<string, { result: RunExecutionResult; expiresAt: number }>();
  private activeRuns = new Map<string, ActiveRunState>();

  constructor(repo?: EvaluationRepository) {
    if (repo) {
      this.repo = repo;
    }
  }

  public static getInstance(): EvaluationExecutionService {
    if (!EvaluationExecutionService.instance) {
      EvaluationExecutionService.instance = new EvaluationExecutionService();
    }
    return EvaluationExecutionService.instance;
  }

  /**
   * Clears the idempotency cache (useful in tests).
   */
  public clearIdempotencyCache(): void {
    this.idempotencyCache.clear();
  }

  /**
   * Resets active runs tracking (useful in tests).
   */
  public resetActiveRuns(): void {
    this.activeRuns.clear();
  }

  /**
   * Cancels a currently running or queued evaluation run.
   */
  public async cancelRun(runId: string, actor: string): Promise<EvaluationRunRecord> {
    const run = await this.repo.getRunById(runId);
    if (!run) {
      throw new EvaluationValidationError(
        'EVALUATION_RUN_NOT_FOUND',
        `Evaluation run '${runId}' not found.`
      );
    }

    if (run.status !== 'running' && run.status !== 'queued') {
      throw new EvaluationValidationError(
        'EVALUATION_RUN_NOT_CANCELLABLE',
        `Evaluation run '${runId}' with status '${run.status}' cannot be cancelled. Only queued or running runs can be cancelled.`
      );
    }

    const activeState = this.activeRuns.get(runId);
    if (activeState) {
      activeState.isCancelled = true;
      activeState.status = 'cancelled';
      activeState.abortController.abort();
    }

    const updated = await this.repo.updateRun(runId, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    });

    logger.info('Evaluation run cancelled by actor', { runId, actor });
    return updated || { ...run, status: 'cancelled', completedAt: new Date().toISOString() };
  }

  /**
   * Retrieves deterministic real-time progress for an evaluation run.
   */
  public async getRunProgress(runId: string): Promise<RunProgressInfo> {
    const activeState = this.activeRuns.get(runId);
    if (activeState) {
      const percent = activeState.totalCases > 0
        ? Math.min(100, Math.round((activeState.processedCases / activeState.totalCases) * 100))
        : 0;

      return {
        runId,
        status: activeState.status,
        totalCases: activeState.totalCases,
        processedCases: activeState.processedCases,
        passedCases: activeState.passedCases,
        failedCases: activeState.failedCases,
        progressPercent: percent,
        durationMs: Date.now() - activeState.startedAt,
        isCompleted: activeState.status === 'completed',
        isCancelled: activeState.status === 'cancelled',
      };
    }

    const run = await this.repo.getRunById(runId);
    if (!run) {
      throw new EvaluationValidationError(
        'EVALUATION_RUN_NOT_FOUND',
        `Evaluation run '${runId}' not found.`
      );
    }

    const processed = run.passedCases + run.failedCases;
    const percent = run.totalCases > 0
      ? Math.min(100, Math.round((processed / run.totalCases) * 100))
      : (run.status === 'completed' ? 100 : 0);

    return {
      runId: run.id,
      status: run.status,
      totalCases: run.totalCases,
      processedCases: run.status === 'completed' ? run.totalCases : processed,
      passedCases: run.passedCases,
      failedCases: run.failedCases,
      progressPercent: run.status === 'completed' ? 100 : percent,
      durationMs: run.durationMs,
      isCompleted: run.status === 'completed',
      isCancelled: run.status === 'cancelled',
    };
  }

  /**
   * Executes an evaluation run, scoring every scenario deterministically,
   * detecting regressions against the latest completed baseline, and persisting results.
   */
  public async executeRun(options?: ExecuteRunOptions): Promise<RunExecutionResult> {
    const datasetVersion = options?.datasetVersion || 'Phase 8.5 Golden Benchmark Dataset';
    const mode = options?.mode || 'mock';
    const createdBy = options?.createdBy || 'admin';
    const startTime = Date.now();

    // 0. Hard Limit & Mode Validations (Reject if exceeded, no silent clamp)
    const validModes: EvaluationRunMode[] = ['mock', 'replay', 'live'];
    if (options?.mode && !validModes.includes(options.mode)) {
      throw new EvaluationValidationError(
        'INVALID_EVALUATION_MODE',
        `Evaluation mode '${options.mode}' is invalid. Allowed modes: ${validModes.join(', ')}.`
      );
    }

    if (mode === 'live' && process.env.ENABLE_LIVE_EVALUATION !== 'true') {
      throw new EvaluationValidationError(
        'LIVE_MODE_UNAVAILABLE',
        'Live evaluation mode is currently unavailable or disabled in this environment. Mock evaluation is the default runner.'
      );
    }

    if (options?.concurrency !== undefined) {
      if (options.concurrency > EVALUATION_HARD_LIMITS.MAX_CONCURRENCY) {
        throw new EvaluationValidationError(
          'CONCURRENCY_LIMIT_EXCEEDED',
          `Requested concurrency (${options.concurrency}) exceeds hard limit ceiling of ${EVALUATION_HARD_LIMITS.MAX_CONCURRENCY}.`
        );
      }
      if (options.concurrency < 1) {
        throw new EvaluationValidationError(
          'CONCURRENCY_LIMIT_EXCEEDED',
          'Requested concurrency must be greater than or equal to 1.'
        );
      }
    }

    if (options?.caseIds !== undefined) {
      if (options.caseIds.length > EVALUATION_HARD_LIMITS.MAX_CASES) {
        throw new EvaluationValidationError(
          'CASE_LIMIT_EXCEEDED',
          `Requested case count (${options.caseIds.length}) exceeds hard limit ceiling of ${EVALUATION_HARD_LIMITS.MAX_CASES}.`
        );
      }
      const validIds = new Set(GOLDEN_EVALUATION_DATASET.map((c) => c.id));
      const invalidIds = options.caseIds.filter((id) => !validIds.has(id));
      if (invalidIds.length > 0) {
        throw new EvaluationValidationError(
          'INVALID_CASE_IDS',
          `Invalid evaluation case ID(s): ${invalidIds.join(', ')}. All case IDs must exist in the Golden Benchmark Dataset.`
        );
      }
    }

    if (options?.maxTokens !== undefined && options.maxTokens > EVALUATION_HARD_LIMITS.MAX_TOKENS_PER_RUN) {
      throw new EvaluationValidationError(
        'TOKEN_LIMIT_EXCEEDED',
        `Requested token budget (${options.maxTokens}) exceeds hard limit ceiling of ${EVALUATION_HARD_LIMITS.MAX_TOKENS_PER_RUN}.`
      );
    }

    if (options?.timeoutMs !== undefined && options.timeoutMs > EVALUATION_HARD_LIMITS.MAX_EXECUTION_DURATION_MS) {
      throw new EvaluationValidationError(
        'DURATION_LIMIT_EXCEEDED',
        `Requested duration (${options.timeoutMs}ms) exceeds hard limit ceiling of ${EVALUATION_HARD_LIMITS.MAX_EXECUTION_DURATION_MS}ms.`
      );
    }

    // Check Idempotency Key
    if (options?.idempotencyKey) {
      const cached = this.idempotencyCache.get(options.idempotencyKey);
      if (cached && cached.expiresAt > Date.now()) {
        logger.info('Returning cached evaluation run for idempotency key', {
          idempotencyKey: options.idempotencyKey,
          runId: cached.result.run.id,
        });
        return {
          ...cached.result,
          deduplicated: true,
        };
      }
    }

    // 1. Filter evaluation cases
    let casesToRun: EvaluationCase[] = [...GOLDEN_EVALUATION_DATASET];
    if (options?.category) {
      casesToRun = casesToRun.filter((c) => c.category === options.category);
    }
    if (options?.tag) {
      casesToRun = casesToRun.filter((c) => c.tags?.includes(options.tag!));
    }
    if (options?.caseIds && options.caseIds.length > 0) {
      casesToRun = casesToRun.filter((c) => options.caseIds!.includes(c.id));
    }

    // 2. Fetch baseline run and previous case results for regression detection
    // Dataset Version Safety: Baseline is ONLY compared if dataset_version matches exactly.
    const baselineRun = await this.repo.getLatestCompletedRun(datasetVersion);
    const previousResultMap = new Map<string, EvaluationCaseResultRecord>();

    if (baselineRun && baselineRun.datasetVersion === datasetVersion) {
      const prevData = await this.repo.getCaseResultsByRunId(baselineRun.id, { limit: 200 });
      for (const res of prevData.results) {
        previousResultMap.set(res.caseId, res);
      }
    }

    // 3. Initialize Run Record in repository
    const releaseMeta = extractReleaseMetadata(options?.releaseMetadata);
    const datasetProv = resolveDatasetProvenance(datasetVersion);

    const initialRun = await this.repo.createRun({
      datasetVersion,
      mode,
      status: 'running',
      totalCases: casesToRun.length,
      passedCases: 0,
      failedCases: 0,
      skippedCases: GOLDEN_EVALUATION_DATASET.length - casesToRun.length,
      regressionCount: 0,
      overallScore: 0,
      durationMs: 0,
      createdBy,
      metadata: {
        release: releaseMeta,
        provenance: datasetProv,
      },
    });

    const abortController = new AbortController();
    const activeState: ActiveRunState = {
      runId: initialRun.id,
      abortController,
      isCancelled: false,
      totalCases: casesToRun.length,
      processedCases: 0,
      passedCases: 0,
      failedCases: 0,
      status: 'running',
      startedAt: startTime,
    };
    this.activeRuns.set(initialRun.id, activeState);

    const concurrency = Math.max(1, Math.min(10, options?.concurrency || 3));
    const caseResultsToInsert: NewEvaluationCaseResult[] = [];
    const regressedCaseIds: string[] = [];

    let passedCount = 0;
    let failedCount = 0;
    let regressionCount = 0;

    try {
      // 4. Concurrency pool execution
      for (let i = 0; i < casesToRun.length; i += concurrency) {
        if (activeState.isCancelled || abortController.signal.aborted) {
          logger.info('Aborting evaluation run batch loop due to cancellation', { runId: initialRun.id });
          break;
        }

        const batch = casesToRun.slice(i, i + concurrency);
        const batchEvaluations = await Promise.all(
          batch.map(async (evalCase) => {
            const caseStartTime = Date.now();
            let evalRes;

            try {
              evalRes = await this.evaluator.evaluate(evalCase);
            } catch (err: any) {
              evalRes = {
                caseId: evalCase.id,
                category: evalCase.category,
                passed: false,
                durationMs: Date.now() - caseStartTime,
                errors: [`Unhandled execution error: ${err.message}`],
                actual: { error: err.message, status: 'error' },
                replayBundle: {
                  correlationId: 'err',
                  caseId: evalCase.id,
                  category: evalCase.category,
                  provider: 'none',
                  steps: [],
                  toolCalls: [],
                  latencies: {},
                  errors: [err.message],
                },
              };
            }

            // Regression Check:
            // Regression is defined as: previous case status was 'passed', but current status is 'failed'.
            const prev = previousResultMap.get(evalCase.id);
            const isPassed = evalRes.passed;
            const isRegression = Boolean(prev && prev.status === 'passed' && !isPassed);

            const score = isPassed ? 100 : 0;
            const failureReason = evalRes.errors && evalRes.errors.length > 0
              ? redactSecrets(evalRes.errors.join('; '))
              : null;

            const actualObj = (evalRes.actual || {}) as Record<string, any>;
            const provider = (actualObj.provider as string) ||
              (actualObj.lastProviderUsed as string) ||
              (evalRes.replayBundle?.provider as string) ||
              'mock';

            const sanitizedActual = redactObject(actualObj);
            const sanitizedExpected = redactObject(evalCase.expected || {});

            return {
              caseId: evalCase.id,
              dimension: evalCase.category,
              status: isPassed ? ('passed' as const) : ('failed' as const),
              score,
              expected: sanitizedExpected,
              actual: sanitizedActual,
              failureReason,
              regression: isRegression,
              previousStatus: prev ? prev.status : null,
              previousScore: prev ? prev.score : null,
              model: (actualObj.model as string) || 'mock-eval-model',
              provider,
              durationMs: evalRes.durationMs,
              tokens: (actualObj.tokens as number) || 0,
            };
          })
        );

        for (const r of batchEvaluations) {
          if (r.status === 'passed') {
            passedCount++;
          } else {
            failedCount++;
          }

          if (r.regression) {
            regressionCount++;
            regressedCaseIds.push(r.caseId);
          }

          caseResultsToInsert.push({
            runId: initialRun.id,
            ...r,
          });
        }

        activeState.processedCases += batch.length;
        activeState.passedCases = passedCount;
        activeState.failedCases = failedCount;

        if (activeState.isCancelled || abortController.signal.aborted) {
          logger.info('Evaluation run detected cancellation after batch', { runId: initialRun.id });
          break;
        }
      }

      // Check if cancelled during batch iterations
      if (activeState.isCancelled || abortController.signal.aborted) {
        let persistedResults: EvaluationCaseResultRecord[] = [];
        if (caseResultsToInsert.length > 0) {
          persistedResults = await this.repo.createCaseResults(caseResultsToInsert);
        }

        const totalDurationMs = Date.now() - startTime;
        const cancelledRun = await this.repo.updateRun(initialRun.id, {
          status: 'cancelled',
          passedCases: passedCount,
          failedCases: failedCount,
          regressionCount,
          overallScore: casesToRun.length > 0
            ? Math.round((passedCount / casesToRun.length) * 1000) / 10
            : 0,
          durationMs: totalDurationMs,
          completedAt: new Date().toISOString(),
        });

        logger.info('Evaluation run cancelled and preserved partial results', {
          runId: initialRun.id,
          processedCases: activeState.processedCases,
          totalCases: casesToRun.length,
          persistedCount: persistedResults.length,
        });

        return {
          run: cancelledRun || {
            ...initialRun,
            status: 'cancelled',
            passedCases: passedCount,
            failedCases: failedCount,
            regressionCount,
            overallScore: casesToRun.length > 0
              ? Math.round((passedCount / casesToRun.length) * 1000) / 10
              : 0,
            durationMs: totalDurationMs,
            completedAt: new Date().toISOString(),
          },
          results: persistedResults,
          regressionSummary: {
            totalRegressions: regressionCount,
            regressedCaseIds,
            baselineRunId: baselineRun?.id || null,
          },
        };
      }

      // 5. Persist case results in repository
      const persistedResults = await this.repo.createCaseResults(caseResultsToInsert);

      const totalDurationMs = Date.now() - startTime;
      const overallScore = casesToRun.length > 0
        ? Math.round((passedCount / casesToRun.length) * 1000) / 10
        : 0;

      // 6. Complete the run
      const updatedRun = await this.repo.updateRun(initialRun.id, {
        status: 'completed',
        passedCases: passedCount,
        failedCases: failedCount,
        regressionCount,
        overallScore,
        durationMs: totalDurationMs,
        completedAt: new Date().toISOString(),
      });

      logger.info('Evaluation run completed successfully', {
        runId: initialRun.id,
        mode,
        totalCases: casesToRun.length,
        passedCases: passedCount,
        failedCases: failedCount,
        regressions: regressionCount,
        durationMs: totalDurationMs,
      });

      const executionResult: RunExecutionResult = {
        run: updatedRun || {
          ...initialRun,
          status: 'completed',
          passedCases: passedCount,
          failedCases: failedCount,
          regressionCount,
          overallScore,
          durationMs: totalDurationMs,
          completedAt: new Date().toISOString(),
        },
        results: persistedResults,
        regressionSummary: {
          totalRegressions: regressionCount,
          regressedCaseIds,
          baselineRunId: baselineRun?.id || null,
        },
      };

      if (options?.idempotencyKey) {
        this.idempotencyCache.set(options.idempotencyKey, {
          result: executionResult,
          expiresAt: Date.now() + 120_000,
        });
      }

      return executionResult;
    } catch (err: any) {
      logger.error('Evaluation run failed during execution', { error: err.message, runId: initialRun.id });

      const failedRun = await this.repo.updateRun(initialRun.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      });

      throw err;
    } finally {
      this.activeRuns.delete(initialRun.id);
    }
  }
}
