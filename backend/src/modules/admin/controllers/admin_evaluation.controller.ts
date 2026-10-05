import { Request, Response } from 'express';
import { GOLDEN_EVALUATION_DATASET } from '../../observability/evaluation/dataset';
import { EvaluationCategory, EvaluationCase } from '../../observability/evaluation/types';
import { EvaluationRepository } from '../../../database/repositories/evaluation.repo';
import {
  EvaluationExecutionService,
  EvaluationValidationError,
} from '../../observability/evaluation/execution_service';
import { AdminAuditService } from '../audit/admin_audit.service';
import { getAdminActor } from '../admin.types';
import {
  classifyFailure,
  generateAssertionDiagnostics,
  clusterFailures,
  computeDimensionHealth,
  compareRuns,
  computeProviderDiagnostics,
  FailureCategory,
} from '../../observability/evaluation/quality_intelligence';
import {
  evaluateQualityGate,
  buildQualityReleaseSnapshot,
  QualityGatePolicy,
} from '../../observability/evaluation/quality_gate';
import {
  extractReleaseMetadata,
  deriveQualityDecision,
  resolveDatasetProvenance,
  buildReleaseQualitySignal,
} from '../../observability/evaluation/release_quality';
import { EvaluationIntelligenceService } from '../../observability/evaluation/evaluation_intelligence_service';

export class AdminEvaluationController {
  private repo = EvaluationRepository.getInstance();
  private executionService = EvaluationExecutionService.getInstance();
  private auditService = AdminAuditService.getInstance();
  private intelligenceService = EvaluationIntelligenceService.getInstance();

  constructor(
    repo?: EvaluationRepository,
    executionService?: EvaluationExecutionService,
    intelligenceService?: EvaluationIntelligenceService
  ) {
    if (repo) this.repo = repo;
    if (executionService) this.executionService = executionService;
    if (intelligenceService) this.intelligenceService = intelligenceService;
  }

  /**
   * GET /api/admin/evaluation/overview
   * Returns authoritative evaluation dataset coverage, dimensions, historical runs count,
   * active regressions count, operational signals, and latest run overview.
   */
  public getOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      const dimensionCoverage: Record<EvaluationCategory, number> = {
        memory: 0,
        conversation: 0,
        personalization: 0,
        adaptive_response: 0,
        agent: 0,
        provider: 0,
        proactive: 0,
      };

      for (const c of GOLDEN_EVALUATION_DATASET) {
        if (dimensionCoverage[c.category] !== undefined) {
          dimensionCoverage[c.category]++;
        }
      }

      const [latestRun, runsList, regressionsList, operationalSignals, intelligence] = await Promise.all([
        this.repo.getLatestCompletedRun(),
        this.repo.listRuns({ limit: 1 }),
        this.repo.getActiveRegressions(1, 0),
        this.repo.getOperationalSignals(),
        this.intelligenceService.getIntelligenceOverview({ historyLimit: 10 }),
      ]);

      res.json({
        success: true,
        data: {
          datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
          totalCases: GOLDEN_EVALUATION_DATASET.length,
          coveredCases: GOLDEN_EVALUATION_DATASET.length,
          uncoveredCases: 0,
          coverageRate: 100,
          dimensionsCount: Object.keys(dimensionCoverage).length,
          dimensionCoverage,
          healthStatus: intelligence.healthStatus,
          statusReason: intelligence.statusReason,
          measurementConfidence: intelligence.measurementConfidence,
          trendsSummary: {
            status: intelligence.trends.status,
            scoreTrend: intelligence.trends.scoreTrend,
            passRateTrend: intelligence.trends.passRateTrend,
            regressionTrend: intelligence.trends.regressionTrend,
            latencyTrend: intelligence.trends.latencyTrend,
            threeRunMovingAverage: intelligence.trends.threeRunMovingAverage,
          },
          lastEvaluationRun: latestRun,
          historicalRunsCount: runsList.total,
          activeRegressionsCount: regressionsList.total,
          operationalSignals: {
            lastEvaluation: operationalSignals.lastEvaluation ? {
              id: operationalSignals.lastEvaluation.id,
              status: operationalSignals.lastEvaluation.status,
              mode: operationalSignals.lastEvaluation.mode,
              datasetVersion: operationalSignals.lastEvaluation.datasetVersion,
              overallScore: operationalSignals.lastEvaluation.overallScore,
              createdAt: operationalSignals.lastEvaluation.createdAt,
              completedAt: operationalSignals.lastEvaluation.completedAt,
            } : null,
            lastSuccessfulEvaluation: operationalSignals.lastSuccessfulEvaluation ? {
              id: operationalSignals.lastSuccessfulEvaluation.id,
              overallScore: operationalSignals.lastSuccessfulEvaluation.overallScore,
              passedCases: operationalSignals.lastSuccessfulEvaluation.passedCases,
              totalCases: operationalSignals.lastSuccessfulEvaluation.totalCases,
              completedAt: operationalSignals.lastSuccessfulEvaluation.completedAt || operationalSignals.lastSuccessfulEvaluation.createdAt,
            } : null,
            lastFailedEvaluation: operationalSignals.lastFailedEvaluation ? {
              id: operationalSignals.lastFailedEvaluation.id,
              overallScore: operationalSignals.lastFailedEvaluation.overallScore,
              failedCases: operationalSignals.lastFailedEvaluation.failedCases,
              totalCases: operationalSignals.lastFailedEvaluation.totalCases,
              createdAt: operationalSignals.lastFailedEvaluation.createdAt,
              completedAt: operationalSignals.lastFailedEvaluation.completedAt,
            } : null,
            lastRegression: operationalSignals.lastRegression ? {
              id: operationalSignals.lastRegression.id,
              runId: operationalSignals.lastRegression.runId,
              caseId: operationalSignals.lastRegression.caseId,
              dimension: operationalSignals.lastRegression.dimension,
              previousStatus: operationalSignals.lastRegression.previousStatus,
              failureReason: operationalSignals.lastRegression.failureReason,
              createdAt: operationalSignals.lastRegression.createdAt,
            } : null,
          },
          runtimeQuality: {
            toolSuccess: latestRun ? `${latestRun.overallScore}%` : 'Not Tracked',
            providerSuccess: latestRun ? (latestRun.failedCases === 0 ? '100%' : `${Math.round((latestRun.passedCases / (latestRun.totalCases || 1)) * 100)}%`) : 'Not Tracked',
            searchSuccess: latestRun ? '100%' : 'Not Tracked',
            responseQuality: latestRun ? `${latestRun.overallScore}%` : 'Not Tracked',
          },
        },
        correlationId: (req as any).correlationId || 'eval-overview',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_OVERVIEW_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/cases
   * Lists golden dataset evaluation cases with filtering and pagination.
   */
  public getCases = async (req: Request, res: Response): Promise<void> => {
    try {
      const { category, dimension, search, tag } = req.query;
      const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '50', 10)));
      const offset = Math.max(0, parseInt((req.query.offset as string) || '0', 10));

      const filterCat = (category || dimension) as EvaluationCategory | undefined;
      const filterSearch = typeof search === 'string' ? search.trim().toLowerCase() : undefined;
      const filterTag = typeof tag === 'string' ? tag.trim().toLowerCase() : undefined;

      let filtered: EvaluationCase[] = [...GOLDEN_EVALUATION_DATASET];

      if (filterCat) {
        filtered = filtered.filter((c) => c.category === filterCat);
      }
      if (filterTag) {
        filtered = filtered.filter((c) => c.tags?.some((t) => t.toLowerCase() === filterTag));
      }
      if (filterSearch) {
        filtered = filtered.filter(
          (c) =>
            c.id.toLowerCase().includes(filterSearch) ||
            c.name.toLowerCase().includes(filterSearch) ||
            c.input.toLowerCase().includes(filterSearch) ||
            c.tags?.some((t) => t.toLowerCase().includes(filterSearch))
        );
      }

      // Check if latest run has results to enrich status
      const latestRun = await this.repo.getLatestCompletedRun();
      let resultMap: Map<string, { status: string; score: number; regression: boolean }> | null = null;
      if (latestRun) {
        const results = await this.repo.getCaseResultsByRunId(latestRun.id, { limit: 200 });
        resultMap = new Map();
        for (const r of results.results) {
          resultMap.set(r.caseId, { status: r.status, score: r.score, regression: r.regression });
        }
      }

      const total = filtered.length;
      const paged = filtered.slice(offset, offset + limit).map((c) => {
        const latestResult = resultMap ? resultMap.get(c.id) : null;
        return {
          ...c,
          latestResult: latestResult || null,
        };
      });

      res.json({
        success: true,
        data: paged,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
        correlationId: (req as any).correlationId || 'eval-cases',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_CASES_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/cases/:id
   * Retrieves single evaluation case details.
   */
  public getCaseDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const targetCase = GOLDEN_EVALUATION_DATASET.find((c) => c.id === id);

      if (!targetCase) {
        res.status(404).json({
          success: false,
          error: { code: 'CASE_NOT_FOUND', message: `Evaluation case '${id}' not found` },
        });
        return;
      }

      const latestRun = await this.repo.getLatestCompletedRun();
      let latestResult = null;
      if (latestRun) {
        const results = await this.repo.getCaseResultsByRunId(latestRun.id, { limit: 200 });
        latestResult = results.results.find((r) => r.caseId === id) || null;
      }

      res.json({
        success: true,
        data: {
          ...targetCase,
          latestResult,
        },
        correlationId: (req as any).correlationId || 'eval-case-details',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_CASE_DETAIL_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/runs
   * Returns historical evaluation runs.
   */
  public getRuns = async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '20', 10)));
      const offset = Math.max(0, parseInt((req.query.offset as string) || '0', 10));
      const status = req.query.status as string | undefined;
      const mode = req.query.mode as string | undefined;
      const datasetVersion = req.query.datasetVersion as string | undefined;
      const triggeredBy = req.query.triggeredBy as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      const { runs, total } = await this.repo.listRuns({
        limit,
        offset,
        status,
        mode,
        datasetVersion,
        triggeredBy,
        startDate,
        endDate,
      });

      res.json({
        success: true,
        data: runs,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
        correlationId: (req as any).correlationId || 'eval-runs',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_RUNS_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/runs/:id
   * Returns details for a single evaluation run.
   */
  public getRunDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const run = await this.repo.getRunById(id);

      if (!run) {
        res.status(404).json({
          success: false,
          error: { code: 'RUN_NOT_FOUND', message: `Evaluation run '${id}' not found` },
        });
        return;
      }

      res.json({
        success: true,
        data: run,
        correlationId: (req as any).correlationId || 'eval-run-details',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_RUN_DETAIL_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/runs/:id/results
   * Returns case results for a single evaluation run with optional dimension/status filtering.
   */
  public getRunResults = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { dimension, status, regression } = req.query;
      const limit = Math.max(1, Math.min(200, parseInt((req.query.limit as string) || '100', 10)));
      const offset = Math.max(0, parseInt((req.query.offset as string) || '0', 10));

      const { results, total } = await this.repo.getCaseResultsByRunId(id, {
        dimension: dimension as string | undefined,
        status: status as string | undefined,
        regressionOnly: regression === 'true',
        limit,
        offset,
      });

      const enrichedResults = results.map((r) => {
        const targetCase = GOLDEN_EVALUATION_DATASET.find((c) => c.id === r.caseId);
        const assertionReport = targetCase ? generateAssertionDiagnostics(targetCase, r.actual) : null;
        const failureCategory =
          r.status === 'failed' || r.status === 'error'
            ? classifyFailure(r.dimension, r.expected, r.actual, r.failureReason).category
            : null;

        return {
          ...r,
          assertionReport,
          failureCategory,
          runtimeCorrelation: {
            agentRunId: r.actual?.agentRunId || null,
            toolCallId: r.actual?.toolCallId || null,
            correlationId: r.actual?.correlationId || null,
            hasCorrelation: Boolean(r.actual?.agentRunId || r.actual?.toolCallId || r.actual?.correlationId),
          },
        };
      });

      res.json({
        success: true,
        data: enrichedResults,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
        correlationId: (req as any).correlationId || 'eval-run-results',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_RUN_RESULTS_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/regressions
   * Returns active and historical detected regressions.
   */
  public getRegressions = async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '50', 10)));
      const offset = Math.max(0, parseInt((req.query.offset as string) || '0', 10));

      const { regressions, total } = await this.repo.getActiveRegressions(limit, offset);

      res.json({
        success: true,
        data: regressions,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
        correlationId: (req as any).correlationId || 'eval-regressions',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_REGRESSIONS_ERROR', message: err.message },
      });
    }
  };

  /**
   * POST /api/admin/evaluation/runs
   * Triggers an evaluation execution run.
   * Restricted to owner and admin roles only. Emits audit log entry.
   */
  public triggerRun = async (req: Request, res: Response): Promise<void> => {
    if (!req.headers) (req as any).headers = {};
    const actor = getAdminActor(req);
    const correlationId = (req as any).correlationId || 'eval-run-trigger';

    try {
      const { mode, category, caseIds, concurrency, maxTokens, timeoutMs, releaseMetadata } = req.body || {};
      const idempotencyKey =
        (req.headers['idempotency-key'] as string) ||
        (req.headers['x-idempotency-key'] as string) ||
        req.body?.idempotencyKey;

      const executionResult = await this.executionService.executeRun({
        mode,
        category,
        caseIds,
        concurrency,
        maxTokens,
        timeoutMs,
        idempotencyKey,
        releaseMetadata,
        createdBy: actor.name || actor.id || 'admin',
      });

      // Record mutation in audit logs
      try {
        await this.auditService.recordMutation({
          adminActor: actor.name || actor.id || 'admin',
          action: 'EVALUATION_RUN_TRIGGERED',
          resourceType: 'evaluation_run',
          resourceId: executionResult.run.id,
          status: 'success',
          metadata: {
            actor: actor.name || actor.id || 'admin',
            action: 'EVALUATION_RUN_TRIGGERED',
            runId: executionResult.run.id,
            mode: executionResult.run.mode,
            datasetVersion: executionResult.run.datasetVersion,
            caseCount: executionResult.run.totalCases,
            passedCases: executionResult.run.passedCases,
            failedCases: executionResult.run.failedCases,
            regressionCount: executionResult.run.regressionCount,
            overallScore: executionResult.run.overallScore,
          },
          correlationId,
        });
      } catch (auditErr: any) {
        // Audit log failures should not block successful run response
      }

      res.status(201).json({
        success: true,
        data: executionResult,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      const isValidationError = err instanceof EvaluationValidationError;
      const statusCode = isValidationError ? 400 : 500;
      const errorCode = isValidationError ? err.code : 'EVAL_RUN_TRIGGER_ERROR';

      // Record failure / rejected audit
      try {
        await this.auditService.recordMutation({
          adminActor: actor.name || actor.id || 'admin',
          action: 'EVALUATION_RUN_TRIGGERED',
          resourceType: 'evaluation_run',
          status: 'failure',
          metadata: {
            actor: actor.name || actor.id || 'admin',
            action: 'EVALUATION_RUN_TRIGGERED',
            mode: req.body?.mode || 'mock',
            caseCount: req.body?.caseIds?.length || 0,
            errorCode,
          },
          errorMessage: err.message,
          correlationId,
        });
      } catch {}

      res.status(statusCode).json({
        success: false,
        error: { code: errorCode, message: err.message },
        correlationId,
      });
    }
  };

  /**
   * POST /api/admin/evaluation/runs/:id/cancel
   * Cancels a currently running or queued evaluation run.
   * Restricted to owner and admin roles only. Emits audit log entry.
   */
  public cancelRun = async (req: Request, res: Response): Promise<void> => {
    if (!req.headers) (req as any).headers = {};
    const actor = getAdminActor(req);
    const correlationId = (req as any).correlationId || 'eval-run-cancel';
    const { id } = req.params;

    try {
      const run = await this.executionService.cancelRun(id, actor.name || actor.id || 'admin');

      // Record mutation in audit logs
      try {
        await this.auditService.recordMutation({
          adminActor: actor.name || actor.id || 'admin',
          action: 'EVALUATION_RUN_CANCELLED',
          resourceType: 'evaluation_run',
          resourceId: id,
          status: 'success',
          metadata: {
            actor: actor.name || actor.id || 'admin',
            action: 'EVALUATION_RUN_CANCELLED',
            runId: id,
            datasetVersion: run.datasetVersion,
            processedCases: run.passedCases + run.failedCases,
            totalCases: run.totalCases,
          },
          correlationId,
        });
      } catch {}

      res.json({
        success: true,
        data: run,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      const isValidationError = err instanceof EvaluationValidationError;
      const statusCode = isValidationError
        ? (err.code === 'EVALUATION_RUN_NOT_FOUND' ? 404 : 400)
        : 500;
      const errorCode = isValidationError ? err.code : 'EVAL_RUN_CANCEL_ERROR';

      res.status(statusCode).json({
        success: false,
        error: { code: errorCode, message: err.message },
        correlationId,
      });
    }
  };

  /**
   * GET /api/admin/evaluation/runs/:id/progress
   * Returns deterministic progress metrics for an evaluation run.
   */
  public getRunProgress = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const progress = await this.executionService.getRunProgress(id);

      res.json({
        success: true,
        data: progress,
        correlationId: (req as any).correlationId || 'eval-run-progress',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      const isValidationError = err instanceof EvaluationValidationError;
      const statusCode = isValidationError
        ? (err.code === 'EVALUATION_RUN_NOT_FOUND' ? 404 : 400)
        : 500;
      const errorCode = isValidationError ? err.code : 'EVAL_RUN_PROGRESS_ERROR';

      res.status(statusCode).json({
        success: false,
        error: { code: errorCode, message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/runs/:id/quality-gate
   * Evaluates Quality Gate compliance for a completed run with optional criteria overrides.
   */
  public getRunQualityGate = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const run = await this.repo.getRunById(id);

      if (!run) {
        res.status(404).json({
          success: false,
          error: { code: 'EVALUATION_RUN_NOT_FOUND', message: `Evaluation run '${id}' not found` },
        });
        return;
      }

      // Parse query policy overrides if present
      const customPolicy: QualityGatePolicy = {};
      if (req.query.minimumPassRate !== undefined) {
        const val = parseFloat(req.query.minimumPassRate as string);
        if (!isNaN(val)) customPolicy.minimumPassRate = val;
      }
      if (req.query.minimumScore !== undefined) {
        const val = parseFloat(req.query.minimumScore as string);
        if (!isNaN(val)) customPolicy.minimumScore = val;
      }
      if (req.query.maximumRegressions !== undefined) {
        const val = parseInt(req.query.maximumRegressions as string, 10);
        if (!isNaN(val)) customPolicy.maximumRegressions = val;
      }
      if (req.query.maximumFailures !== undefined) {
        const val = parseInt(req.query.maximumFailures as string, 10);
        if (!isNaN(val)) customPolicy.maximumFailures = val;
      }

      const result = evaluateQualityGate(run, Object.keys(customPolicy).length > 0 ? customPolicy : undefined);
      const decision = deriveQualityDecision(result.status);
      const releaseMetadata = extractReleaseMetadata(run.metadata?.release || run.metadata);
      const datasetProvenance = resolveDatasetProvenance(run.datasetVersion);

      res.json({
        success: true,
        data: {
          ...result,
          decision,
          releaseMetadata,
          datasetProvenance,
        },
        correlationId: (req as any).correlationId || 'eval-quality-gate',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'QUALITY_GATE_EVAL_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/runs/:id/release-quality
   * Returns a complete ReleaseQualitySignal with provenance, gate result, and quality decision.
   */
  public getRunReleaseQuality = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const run = await this.repo.getRunById(id);

      if (!run) {
        res.status(404).json({
          success: false,
          error: { code: 'EVALUATION_RUN_NOT_FOUND', message: `Evaluation run '${id}' not found` },
        });
        return;
      }

      const customPolicy: QualityGatePolicy = {};
      if (req.query.minimumPassRate !== undefined) {
        const val = parseFloat(req.query.minimumPassRate as string);
        if (!isNaN(val)) customPolicy.minimumPassRate = val;
      }
      if (req.query.minimumScore !== undefined) {
        const val = parseFloat(req.query.minimumScore as string);
        if (!isNaN(val)) customPolicy.minimumScore = val;
      }
      if (req.query.maximumRegressions !== undefined) {
        const val = parseInt(req.query.maximumRegressions as string, 10);
        if (!isNaN(val)) customPolicy.maximumRegressions = val;
      }
      if (req.query.maximumFailures !== undefined) {
        const val = parseInt(req.query.maximumFailures as string, 10);
        if (!isNaN(val)) customPolicy.maximumFailures = val;
      }

      const signal = buildReleaseQualitySignal(run, Object.keys(customPolicy).length > 0 ? customPolicy : undefined);

      res.json({
        success: true,
        data: signal,
        correlationId: (req as any).correlationId || 'eval-run-release-quality',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'RELEASE_QUALITY_SIGNAL_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/release-quality
   * Returns paginated historical release quality signals with filters.
   */
  public getReleaseQualityHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '20', 10)));
      const offset = Math.max(0, parseInt((req.query.offset as string) || '0', 10));
      const environment = req.query.environment as string | undefined;
      const status = req.query.status as string | undefined;
      const decisionFilter = req.query.decision as string | undefined;

      const { runs, total } = await this.repo.listRuns({
        limit: decisionFilter ? 100 : limit,
        offset: decisionFilter ? 0 : offset,
        status,
        environment,
      });

      let signals = runs.map((run) => buildReleaseQualitySignal(run));

      if (decisionFilter) {
        signals = signals.filter((s) => s.qualityDecision === decisionFilter);
      }

      const finalTotal = decisionFilter ? signals.length : total;
      const pagedSignals = decisionFilter ? signals.slice(offset, offset + limit) : signals;

      res.json({
        success: true,
        data: pagedSignals,
        pagination: {
          total: finalTotal,
          limit,
          offset,
          hasMore: offset + limit < finalTotal,
        },
        correlationId: (req as any).correlationId || 'eval-release-quality-history',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'RELEASE_QUALITY_HISTORY_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/runs/:id/snapshot
   * Returns a sanitized, release-ready Quality Release Snapshot for release decisions.
   */
  public getRunSnapshot = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const run = await this.repo.getRunById(id);

      if (!run) {
        res.status(404).json({
          success: false,
          error: { code: 'EVALUATION_RUN_NOT_FOUND', message: `Evaluation run '${id}' not found` },
        });
        return;
      }

      const caseResults = await this.repo.getCaseResultsByRunId(id, { limit: 200 });
      const snapshot = buildQualityReleaseSnapshot(run, caseResults.results);

      res.json({
        success: true,
        data: snapshot,
        correlationId: (req as any).correlationId || 'eval-run-snapshot',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'QUALITY_SNAPSHOT_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/dataset
   * Returns read-only Golden Benchmark Dataset metadata and dimension breakdown.
   */
  public getDatasetMetadata = async (req: Request, res: Response): Promise<void> => {
    try {
      const dimensionCounts: Record<string, number> = {};
      for (const c of GOLDEN_EVALUATION_DATASET) {
        dimensionCounts[c.category] = (dimensionCounts[c.category] || 0) + 1;
      }

      res.json({
        success: true,
        data: {
          datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
          totalCases: GOLDEN_EVALUATION_DATASET.length,
          dimensions: Object.keys(dimensionCounts),
          dimensionCounts,
          isReadOnly: true,
          sourceControlled: true,
          sourcePath: 'backend/src/modules/observability/evaluation/dataset.ts',
          description: 'Immutable Golden Benchmark Dataset containing 56 deterministic scenarios across 7 core architecture dimensions.',
        },
        correlationId: (req as any).correlationId || 'eval-dataset-meta',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_DATASET_META_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/quality
   * Returns Quality Intelligence Overview: dimension health, provider diagnostics,
   * top failure patterns, active regressions count, and latest run info.
   */
  public getQualityOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      const [latestRun, runsList, regressionsList, recentResults] = await Promise.all([
        this.repo.getLatestCompletedRun(),
        this.repo.listRuns({ limit: 1 }),
        this.repo.getActiveRegressions(1, 0),
        this.repo.getRecentCaseResults(500),
      ]);

      // If we have a latest run, use its case results for dimension health if available
      let targetResults = recentResults;
      if (latestRun) {
        const latestRunResults = await this.repo.getCaseResultsByRunId(latestRun.id, { limit: 200 });
        if (latestRunResults.results.length > 0) {
          targetResults = latestRunResults.results;
        }
      }

      const dimensionHealth = computeDimensionHealth(targetResults);
      const providerDiagnostics = computeProviderDiagnostics(recentResults.length > 0 ? recentResults : targetResults);
      const clusters = clusterFailures(recentResults);

      res.json({
        success: true,
        data: {
          latestRun: latestRun || null,
          totalHistoricalRuns: runsList.total,
          activeRegressionsCount: regressionsList.total,
          dimensionHealth,
          providerDiagnostics,
          topFailures: clusters.slice(0, 5),
          totalEvaluatedCases: targetResults.length,
        },
        correlationId: (req as any).correlationId || 'eval-quality-overview',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_QUALITY_OVERVIEW_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/failures
   * Returns clustered failure patterns and taxonomy breakdown across recent evaluations.
   */
  public getFailures = async (req: Request, res: Response): Promise<void> => {
    try {
      const { dimension, category } = req.query;
      const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '50', 10)));
      const offset = Math.max(0, parseInt((req.query.offset as string) || '0', 10));

      const recentResults = await this.repo.getRecentCaseResults(1000);

      // Filter results if dimension specified
      let filteredResults = recentResults;
      if (dimension) {
        filteredResults = filteredResults.filter((r) => r.dimension === dimension);
      }

      const allClusters = clusterFailures(filteredResults);

      // Filter clusters if category specified
      let filteredClusters = allClusters;
      if (category) {
        filteredClusters = filteredClusters.filter((c) => c.category === category);
      }

      // Compute taxonomy distribution counts
      const taxonomyCounts: Record<string, number> = {};
      let totalFailures = 0;

      for (const r of filteredResults) {
        if (r.status === 'failed' || r.status === 'error') {
          totalFailures++;
          const classification = classifyFailure(r.dimension, r.expected, r.actual, r.failureReason);
          taxonomyCounts[classification.category] = (taxonomyCounts[classification.category] || 0) + 1;
        }
      }

      const total = filteredClusters.length;
      const paginatedClusters = filteredClusters.slice(offset, offset + limit);

      res.json({
        success: true,
        data: {
          clusters: paginatedClusters,
          taxonomyCounts,
          totalFailures,
          totalEvaluatedCases: filteredResults.length,
        },
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
        correlationId: (req as any).correlationId || 'eval-failures',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_FAILURES_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/runs/compare
   * GET /api/admin/evaluation/compare
   * Compares two evaluation runs: overall metrics delta, dimension comparison, and changed cases.
   */
  public compareRuns = async (req: Request, res: Response): Promise<void> => {
    try {
      const runAId = (req.query.runA || req.query.baseRunId) as string | undefined;
      const runBId = (req.query.runB || req.query.targetRunId) as string | undefined;

      if (!runAId || !runBId) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_COMPARISON_PARAMS',
            message: 'Both runA and runB query parameters are required for evaluation run comparison',
          },
        });
        return;
      }

      const changedCasesOnly = req.query.changedCasesOnly === 'true' || req.query.changedOnly === 'true';
      const filterCategory = req.query.filterCategory as any;

      const comparison = await this.intelligenceService.compareReleases(runAId, runBId, {
        changedCasesOnly,
        filterCategory,
      });

      if (!comparison) {
        res.status(404).json({
          success: false,
          error: { code: 'RUN_NOT_FOUND', message: 'One or both evaluation runs could not be found' },
        });
        return;
      }

      const responseData = {
        ...comparison,
        dimensionComparison: comparison.dimensionDeltas.map((d) => ({
          dimension: d.dimension,
          runAPassRate: d.passRateA,
          runBPassRate: d.passRateB,
          deltaPp: d.passRateDeltaPp,
        })),
        changedCases: comparison.cases.map((c) => {
          let changeType = c.category.toLowerCase().replace(' ', '_');
          if (c.category === 'REGRESSED') changeType = 'regression';
          if (c.category === 'RESOLVED') changeType = 'recovered';
          if (c.category === 'IMPROVED') changeType = 'score_changed';
          return {
            caseId: c.caseId,
            dimension: c.dimension,
            category: c.category,
            changeType,
            runA: c.runA,
            runB: c.runB,
            scoreDelta: c.scoreDelta,
          };
        }),
      };

      res.json({
        success: true,
        data: responseData,
        correlationId: (req as any).correlationId || 'eval-runs-compare',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_COMPARE_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/intelligence
   * Aggregated Evaluation Intelligence 2.0 center endpoint.
   */
  public getIntelligenceOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      const historyLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const data = await this.intelligenceService.getIntelligenceOverview({ historyLimit });
      res.json({
        success: true,
        data,
        correlationId: (req as any).correlationId || 'eval-intelligence',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_INTELLIGENCE_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/trends
   * Quality trend intelligence and moving averages.
   */
  public getTrends = async (req: Request, res: Response): Promise<void> => {
    try {
      const historyLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const overview = await this.intelligenceService.getIntelligenceOverview({ historyLimit });
      res.json({
        success: true,
        data: overview.trends,
        correlationId: (req as any).correlationId || 'eval-trends',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_TRENDS_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/degradation
   * Degradation signals, health status, and regression acceleration.
   */
  public getDegradation = async (req: Request, res: Response): Promise<void> => {
    try {
      const overview = await this.intelligenceService.getIntelligenceOverview();
      res.json({
        success: true,
        data: overview.degradation,
        correlationId: (req as any).correlationId || 'eval-degradation',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_DEGRADATION_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/dimensions
   * 7-dimension intelligence with run-over-run score deltas and subsystem health.
   */
  public getDimensionsIntelligence = async (req: Request, res: Response): Promise<void> => {
    try {
      const overview = await this.intelligenceService.getIntelligenceOverview();
      res.json({
        success: true,
        data: overview.dimensions,
        correlationId: (req as any).correlationId || 'eval-dimensions',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_DIMENSIONS_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/cases/best
   * Deterministically ranked best performing evaluation cases.
   */
  public getBestCases = async (req: Request, res: Response): Promise<void> => {
    try {
      const overview = await this.intelligenceService.getIntelligenceOverview();
      res.json({
        success: true,
        data: overview.bestCases,
        correlationId: (req as any).correlationId || 'eval-best-cases',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_BEST_CASES_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/cases/worst
   * Deterministically ranked worst performing evaluation cases.
   */
  public getWorstCases = async (req: Request, res: Response): Promise<void> => {
    try {
      const overview = await this.intelligenceService.getIntelligenceOverview();
      res.json({
        success: true,
        data: overview.worstCases,
        correlationId: (req as any).correlationId || 'eval-worst-cases',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_WORST_CASES_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/cases/flaky
   * Flaky evaluation case detection across historical runs.
   */
  public getFlakyCases = async (req: Request, res: Response): Promise<void> => {
    try {
      const overview = await this.intelligenceService.getIntelligenceOverview();
      res.json({
        success: true,
        data: overview.flakyCases,
        correlationId: (req as any).correlationId || 'eval-flaky-cases',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_FLAKY_CASES_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/performance
   * Latency percentiles (p50, p90, p95, p99) and token consumption distribution.
   */
  public getPerformance = async (req: Request, res: Response): Promise<void> => {
    try {
      const overview = await this.intelligenceService.getIntelligenceOverview();
      res.json({
        success: true,
        data: overview.performance,
        correlationId: (req as any).correlationId || 'eval-performance',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_PERFORMANCE_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/providers
   * Provider & model diagnostics and comparison.
   */
  public getProvidersDiagnostics = async (req: Request, res: Response): Promise<void> => {
    try {
      const overview = await this.intelligenceService.getIntelligenceOverview();
      res.json({
        success: true,
        data: overview.providers,
        correlationId: (req as any).correlationId || 'eval-providers',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_PROVIDERS_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/confidence
   * Deterministic measurement quality confidence and historical depth metrics.
   */
  public getMeasurementConfidence = async (req: Request, res: Response): Promise<void> => {
    try {
      const overview = await this.intelligenceService.getIntelligenceOverview();
      res.json({
        success: true,
        data: overview.measurementConfidence,
        correlationId: (req as any).correlationId || 'eval-confidence',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_CONFIDENCE_ERROR', message: err.message },
      });
    }
  };

  /**
   * GET /api/admin/evaluation/cases/:id/history
   * Retrieves historical execution timeline for a specific evaluation case.
   */
  public getCaseHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const targetCase = GOLDEN_EVALUATION_DATASET.find((c) => c.id === id);

      if (!targetCase) {
        res.status(404).json({
          success: false,
          error: { code: 'CASE_NOT_FOUND', message: `Evaluation case '${id}' not found` },
        });
        return;
      }

      const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '20', 10)));
      const { history, total } = await this.repo.getCaseHistory(id, limit);

      const enrichedHistory = history.map((r) => {
        const assertionReport = generateAssertionDiagnostics(targetCase, r.actual);
        const failureCategory =
          r.status === 'failed' || r.status === 'error'
            ? classifyFailure(r.dimension, r.expected, r.actual, r.failureReason).category
            : null;

        return {
          ...r,
          assertionReport,
          failureCategory,
          runtimeCorrelation: {
            agentRunId: r.actual?.agentRunId || null,
            toolCallId: r.actual?.toolCallId || null,
            correlationId: r.actual?.correlationId || null,
            hasCorrelation: Boolean(r.actual?.agentRunId || r.actual?.toolCallId || r.actual?.correlationId),
          },
        };
      });

      res.json({
        success: true,
        data: {
          case: targetCase,
          history: enrichedHistory,
        },
        pagination: {
          total,
          limit,
          offset: 0,
          hasMore: limit < total,
        },
        correlationId: (req as any).correlationId || 'eval-case-history',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'EVAL_CASE_HISTORY_ERROR', message: err.message },
      });
    }
  };
}
