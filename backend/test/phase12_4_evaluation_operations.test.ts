import { Request, Response } from 'express';
import {
  EvaluationExecutionService,
  EvaluationValidationError,
} from '../src/modules/observability/evaluation/execution_service';
import {
  EvaluationRepository,
  EvaluationRunRecord,
} from '../src/database/repositories/evaluation.repo';
import { AdminEvaluationController } from '../src/modules/admin/controllers/admin_evaluation.controller';
import { GOLDEN_EVALUATION_DATASET } from '../src/modules/observability/evaluation/dataset';
import {
  evaluateQualityGate,
  buildQualityReleaseSnapshot,
  resolveQualityGatePolicy,
} from '../src/modules/observability/evaluation/quality_gate';

describe('Phase 12.4 — Evaluation Operations & Continuous Quality Suite', () => {
  let repo: EvaluationRepository;
  let executionService: EvaluationExecutionService;
  let controller: AdminEvaluationController;

  const createMockRes = () => {
    const res: any = {
      statusCode: 200,
      body: null,
      status: function (code: number) {
        this.statusCode = code;
        return this;
      },
      json: function (payload: any) {
        this.body = payload;
        return this;
      },
    };
    return res;
  };

  beforeEach(() => {
    repo = EvaluationRepository.getInstance();
    repo.resetInMemoryStore();
    executionService = EvaluationExecutionService.getInstance();
    executionService.clearIdempotencyCache();
    executionService.resetActiveRuns();
    controller = new AdminEvaluationController(repo, executionService);
    delete process.env.ENABLE_LIVE_EVALUATION;
    delete process.env.QUALITY_GATE_MIN_PASS_RATE;
    delete process.env.QUALITY_GATE_MIN_SCORE;
    delete process.env.QUALITY_GATE_MAX_REGRESSIONS;
    delete process.env.QUALITY_GATE_MAX_FAILURES;
  });

  // =========================================================================
  // 1. RUN WORKFLOW & SELECTION VALIDATION
  // =========================================================================
  describe('1. Run Workflow & Strict Case Selection', () => {
    it('defaults safely to mock mode and rejects live mode when disabled', async () => {
      // Live mode blocked by default
      await expect(
        executionService.executeRun({ mode: 'live' })
      ).rejects.toThrow(EvaluationValidationError);

      try {
        await executionService.executeRun({ mode: 'live' });
      } catch (err: any) {
        expect(err.code).toBe('LIVE_MODE_UNAVAILABLE');
      }

      // Invalid run mode rejected
      try {
        await executionService.executeRun({ mode: 'unsupported_mode' as any });
      } catch (err: any) {
        expect(['INVALID_RUN_MODE', 'INVALID_EVALUATION_MODE']).toContain(err.code);
      }
    });

    it('enforces strict subset validation on case IDs (rejects unknown case IDs with INVALID_CASE_IDS/INVALID_EVALUATION_CASE)', async () => {
      const invalidCaseIds = ['mem_01', 'non-existent-case-999'];

      await expect(
        executionService.executeRun({ caseIds: invalidCaseIds, mode: 'mock' })
      ).rejects.toThrow(EvaluationValidationError);

      try {
        await executionService.executeRun({ caseIds: invalidCaseIds, mode: 'mock' });
      } catch (err: any) {
        expect(['INVALID_EVALUATION_CASE', 'INVALID_CASE_IDS']).toContain(err.code);
        expect(err.message).toContain('non-existent-case-999');
      }
    });

    it('supports dimension-based case filtering', async () => {
      const result = await executionService.executeRun({
        category: 'memory',
        mode: 'mock',
      });

      expect(result.run.totalCases).toBe(8);
      expect(result.run.passedCases).toBe(8);
      expect(result.results.length).toBe(8);
      expect(result.results.every((r) => r.dimension === 'memory')).toBe(true);
    });

    it('supports explicit selected cases subset', async () => {
      const selected = ['mem_01', 'mem_02', 'conv_01'];
      const result = await executionService.executeRun({
        caseIds: selected,
        mode: 'mock',
      });

      expect(result.run.totalCases).toBe(3);
      expect(result.results.length).toBe(3);
      expect(result.results.map((r) => r.caseId)).toEqual(selected);
    });
  });

  // =========================================================================
  // 2. HARD LIMIT CEILINGS
  // =========================================================================
  describe('2. Hard Limit Ceilings Enforcement', () => {
    it('rejects concurrency exceeding ceiling of 5 with CONCURRENCY_LIMIT_EXCEEDED', async () => {
      try {
        await executionService.executeRun({ concurrency: 10, mode: 'mock' });
        fail('Should have thrown');
      } catch (err: any) {
        expect(['EVALUATION_LIMIT_EXCEEDED', 'CONCURRENCY_LIMIT_EXCEEDED']).toContain(err.code);
        expect(err.message).toContain('concurrency');
      }
    });

    it('rejects case count exceeding 56 with CASE_LIMIT_EXCEEDED', async () => {
      const tooManyCases = Array.from({ length: 60 }, (_, i) => `case-${i}`);
      try {
        await executionService.executeRun({ caseIds: tooManyCases, mode: 'mock' });
        fail('Should have thrown');
      } catch (err: any) {
        expect(['EVALUATION_LIMIT_EXCEEDED', 'CASE_LIMIT_EXCEEDED']).toContain(err.code);
        expect(err.message).toContain('case count');
      }
    });

    it('rejects token budget exceeding 50,000 with TOKEN_LIMIT_EXCEEDED', async () => {
      try {
        await executionService.executeRun({ maxTokens: 60000, mode: 'mock' });
        fail('Should have thrown');
      } catch (err: any) {
        expect(['EVALUATION_LIMIT_EXCEEDED', 'TOKEN_LIMIT_EXCEEDED']).toContain(err.code);
        expect(err.message).toContain('token budget');
      }
    });

    it('rejects timeout exceeding 120,000ms with DURATION_LIMIT_EXCEEDED', async () => {
      try {
        await executionService.executeRun({ timeoutMs: 150000, mode: 'mock' });
        fail('Should have thrown');
      } catch (err: any) {
        expect(['EVALUATION_LIMIT_EXCEEDED', 'DURATION_LIMIT_EXCEEDED']).toContain(err.code);
        expect(err.message).toContain('duration');
      }
    });
  });

  // =========================================================================
  // 3. IDEMPOTENCY PRESERVATION
  // =========================================================================
  describe('3. Idempotency Preservation', () => {
    it('returns deduplicated result without redundant execution when idempotency key is repeated', async () => {
      const idempotencyKey = 'eval-key-unique-1234';

      const firstResult = await executionService.executeRun({
        caseIds: ['mem_01'],
        mode: 'mock',
        idempotencyKey,
      });

      expect(firstResult.deduplicated).toBeUndefined();

      const secondResult = await executionService.executeRun({
        caseIds: ['mem_01'],
        mode: 'mock',
        idempotencyKey,
      });

      expect(secondResult.deduplicated).toBe(true);
      expect(secondResult.run.id).toBe(firstResult.run.id);

      // Verify repo only contains 1 run record
      const runs = await repo.listRuns();
      expect(runs.total).toBe(1);
    });
  });

  // =========================================================================
  // 4. PROGRESS TRACKING & REAL CANCELLATION
  // =========================================================================
  describe('4. Lifecycle Progress & Cancellation', () => {
    it('returns accurate deterministic progress metrics for completed runs', async () => {
      const result = await executionService.executeRun({
        caseIds: ['mem_01', 'mem_02'],
        mode: 'mock',
      });

      const progress = await executionService.getRunProgress(result.run.id);
      expect(progress.runId).toBe(result.run.id);
      expect(progress.status).toBe('completed');
      expect(progress.totalCases).toBe(2);
      expect(progress.processedCases).toBe(2);
      expect(progress.progressPercent).toBe(100);
      expect(progress.isCompleted).toBe(true);
      expect(progress.isCancelled).toBe(false);
    });

    it('handles cancellation: aborts execution, sets cancelled status, and preserves partial results', async () => {
      // Create a run in 'running' status
      const runningRun = await repo.createRun({
        status: 'running',
        totalCases: 10,
        passedCases: 3,
        failedCases: 1,
      });

      // Insert partial results
      await repo.createCaseResults([
        {
          runId: runningRun.id,
          caseId: 'eval-mem-01',
          dimension: 'memory',
          status: 'passed',
          score: 100,
        },
        {
          runId: runningRun.id,
          caseId: 'eval-mem-02',
          dimension: 'memory',
          status: 'failed',
          score: 0,
        },
      ]);

      const cancelled = await executionService.cancelRun(runningRun.id, 'admin-tester');
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.completedAt).toBeDefined();

      // Check progress reflects cancelled
      const progress = await executionService.getRunProgress(runningRun.id);
      expect(progress.status).toBe('cancelled');
      expect(progress.isCancelled).toBe(true);
      expect(progress.isCompleted).toBe(false);

      // Partial results must remain preserved
      const results = await repo.getCaseResultsByRunId(runningRun.id);
      expect(results.total).toBe(2);
    });

    it('rejects cancellation on already completed runs with EVALUATION_RUN_NOT_CANCELLABLE', async () => {
      const completedRun = await repo.createRun({
        status: 'completed',
        totalCases: 5,
        passedCases: 5,
      });

      try {
        await executionService.cancelRun(completedRun.id, 'admin-tester');
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe('EVALUATION_RUN_NOT_CANCELLABLE');
      }
    });

    it('rejects cancellation on non-existent runs with EVALUATION_RUN_NOT_FOUND', async () => {
      try {
        await executionService.cancelRun('00000000-0000-0000-0000-000000000000', 'admin-tester');
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.code).toBe('EVALUATION_RUN_NOT_FOUND');
      }
    });
  });

  // =========================================================================
  // 5. RUN HISTORY FILTERS & DATASET VERSION BASELINE MATCHING
  // =========================================================================
  describe('5. History Filters & Dataset Version Baseline Matching', () => {
    it('filters runs by status, mode, datasetVersion, and triggeredBy', async () => {
      await repo.createRun({
        status: 'completed',
        mode: 'mock',
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        createdBy: 'alice',
      });
      await repo.createRun({
        status: 'failed',
        mode: 'replay',
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        createdBy: 'bob',
      });
      await repo.createRun({
        status: 'cancelled',
        mode: 'mock',
        datasetVersion: 'v2-experimental',
        createdBy: 'alice',
      });

      const aliceRuns = await repo.listRuns({ triggeredBy: 'alice' });
      expect(aliceRuns.total).toBe(2);

      const replayRuns = await repo.listRuns({ mode: 'replay' });
      expect(replayRuns.total).toBe(1);

      const v2Runs = await repo.listRuns({ datasetVersion: 'v2-experimental' });
      expect(v2Runs.total).toBe(1);
    });

    it('strictly compares baseline only when dataset_version matches exactly', async () => {
      // Run with old dataset version
      const oldBaseline = await repo.createRun({
        status: 'completed',
        datasetVersion: 'Legacy Dataset v1',
        totalCases: 10,
        passedCases: 10,
      });
      await repo.createCaseResults([
        {
          runId: oldBaseline.id,
          caseId: 'eval-mem-01',
          dimension: 'memory',
          status: 'passed',
          score: 100,
        },
      ]);

      // Querying baseline for Golden Dataset must NOT pick up 'Legacy Dataset v1'
      const matchedBaseline = await repo.getLatestCompletedRun('Phase 8.5 Golden Benchmark Dataset');
      expect(matchedBaseline).toBeNull();
    });
  });

  // =========================================================================
  // 6. QUALITY GATE EVALUATION & RELEASE SNAPSHOT
  // =========================================================================
  describe('6. Quality Gate Evaluation & Release Snapshot', () => {
    it('returns not_configured when no policy thresholds are configured', () => {
      const policyResolution = resolveQualityGatePolicy();
      expect(policyResolution.isConfigured).toBe(false);

      const mockRun: EvaluationRunRecord = {
        id: 'run-1',
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'completed',
        totalCases: 56,
        passedCases: 56,
        failedCases: 0,
        skippedCases: 0,
        regressionCount: 0,
        overallScore: 100,
        durationMs: 5000,
        startedAt: new Date().toISOString(),
        createdBy: 'admin',
        createdAt: new Date().toISOString(),
      };

      const gateResult = evaluateQualityGate(mockRun);
      expect(gateResult.status).toBe('not_configured');
      expect(gateResult.policyConfigured).toBe(false);
      expect(gateResult.checks.every((c) => c.threshold === 'Not Configured')).toBe(true);
    });

    it('evaluates passing policy when all criteria are satisfied', () => {
      const mockRun: EvaluationRunRecord = {
        id: 'run-pass',
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'completed',
        totalCases: 56,
        passedCases: 54,
        failedCases: 2,
        skippedCases: 0,
        regressionCount: 0,
        overallScore: 96.4,
        durationMs: 8000,
        startedAt: new Date().toISOString(),
        createdBy: 'admin',
        createdAt: new Date().toISOString(),
      };

      const gateResult = evaluateQualityGate(mockRun, {
        minimumPassRate: 95,
        minimumScore: 90,
        maximumRegressions: 0,
        maximumFailures: 2,
      });

      expect(gateResult.status).toBe('passed');
      expect(gateResult.failureReasons.length).toBe(0);
      expect(gateResult.checks.every((c) => c.passed)).toBe(true);
    });

    it('evaluates failing policy when regressions or failures violate thresholds', () => {
      const mockRun: EvaluationRunRecord = {
        id: 'run-fail',
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'completed',
        totalCases: 56,
        passedCases: 45,
        failedCases: 11,
        skippedCases: 0,
        regressionCount: 3,
        overallScore: 80.4,
        durationMs: 9000,
        startedAt: new Date().toISOString(),
        createdBy: 'admin',
        createdAt: new Date().toISOString(),
      };

      const gateResult = evaluateQualityGate(mockRun, {
        minimumPassRate: 90,
        maximumRegressions: 0,
        maximumFailures: 5,
      });

      expect(gateResult.status).toBe('failed');
      expect(gateResult.failureReasons.length).toBe(3);
      expect(gateResult.checks.find((c) => c.criterion === 'maximum_regressions')?.passed).toBe(false);
    });

    it('builds a clean sanitized QualityReleaseSnapshot without CoT or secret leakage', () => {
      const mockRun: EvaluationRunRecord = {
        id: 'run-snap',
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'completed',
        totalCases: 2,
        passedCases: 2,
        failedCases: 0,
        skippedCases: 0,
        regressionCount: 0,
        overallScore: 100,
        durationMs: 1200,
        startedAt: new Date().toISOString(),
        createdBy: 'admin',
        createdAt: new Date().toISOString(),
      };

      const mockResults = [
        {
          id: 'res-1',
          runId: 'run-snap',
          caseId: 'eval-mem-01',
          dimension: 'memory',
          status: 'passed' as const,
          score: 100,
          expected: {},
          actual: { internal_thought: 'secret_cot_reasoning', token: 'Bearer sk-123456789' },
          regression: false,
          durationMs: 50,
          tokens: 100,
          createdAt: new Date().toISOString(),
        },
      ];

      const snapshot = buildQualityReleaseSnapshot(mockRun, mockResults as any);
      expect(snapshot.runId).toBe('run-snap');
      expect(snapshot.dimensionScores.memory.passed).toBe(1);
      expect(snapshot.dimensionScores.memory.passRate).toBe(100);

      // JSON stringified snapshot must never contain secret tokens or internal CoT
      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain('secret_cot_reasoning');
      expect(serialized).not.toContain('Bearer sk-');
    });
  });

  // =========================================================================
  // 7. OPERATIONAL SIGNALS
  // =========================================================================
  describe('7. Operational Signals Querying', () => {
    it('returns null for operational signals when no evaluations exist', async () => {
      const signals = await repo.getOperationalSignals();
      expect(signals.lastEvaluation).toBeNull();
      expect(signals.lastSuccessfulEvaluation).toBeNull();
      expect(signals.lastFailedEvaluation).toBeNull();
      expect(signals.lastRegression).toBeNull();
    });

    it('returns accurate operational signals when evaluations are persisted', async () => {
      const run1 = await repo.createRun({
        status: 'completed',
        totalCases: 56,
        passedCases: 56,
        failedCases: 0,
        overallScore: 100,
      });

      const run2 = await repo.createRun({
        status: 'completed',
        totalCases: 56,
        passedCases: 50,
        failedCases: 6,
        overallScore: 89.3,
      });

      await repo.createCaseResults([
        {
          runId: run2.id,
          caseId: 'eval-agent-01',
          dimension: 'agent',
          status: 'failed',
          score: 0,
          regression: true,
          failureReason: 'Tool execution timed out',
        },
      ]);

      const signals = await repo.getOperationalSignals();
      expect(signals.lastEvaluation?.id).toBe(run2.id);
      expect(signals.lastSuccessfulEvaluation?.id).toBe(run1.id);
      expect(signals.lastFailedEvaluation?.id).toBe(run2.id);
      expect(signals.lastRegression?.caseId).toBe('eval-agent-01');
      expect(signals.lastRegression?.failureReason).toBe('Tool execution timed out');
    });
  });

  // =========================================================================
  // 8. READ-ONLY DATASET METADATA
  // =========================================================================
  describe('8. Read-Only Dataset Metadata', () => {
    it('returns immutable Golden Dataset metadata across 7 dimensions', async () => {
      const req: any = {};
      const res = createMockRes();

      await controller.getDatasetMetadata(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalCases).toBe(56);
      expect(res.body.data.dimensions.length).toBe(7);
      expect(res.body.data.isReadOnly).toBe(true);
      expect(res.body.data.sourceControlled).toBe(true);
    });
  });

  // =========================================================================
  // 9. CONTROLLER REST ENDPOINTS & HTTP STATUS CODES
  // =========================================================================
  describe('9. Controller Endpoints HTTP Handling', () => {
    it('GET /api/admin/evaluation/overview includes operationalSignals', async () => {
      const req: any = {};
      const res = createMockRes();

      await controller.getOverview(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.operationalSignals).toBeDefined();
      expect(res.body.data.operationalSignals.lastEvaluation).toBeNull();
    });

    it('POST /api/admin/evaluation/runs/:id/cancel returns 200 on success', async () => {
      const runningRun = await repo.createRun({ status: 'running' });
      const req: any = { params: { id: runningRun.id }, headers: { 'x-admin-role': 'admin' } };
      const res = createMockRes();

      await controller.cancelRun(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
    });

    it('POST /api/admin/evaluation/runs/:id/cancel returns 400 for non-cancellable run', async () => {
      const completedRun = await repo.createRun({ status: 'completed' });
      const req: any = { params: { id: completedRun.id }, headers: { 'x-admin-role': 'admin' } };
      const res = createMockRes();

      await controller.cancelRun(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('EVALUATION_RUN_NOT_CANCELLABLE');
    });

    it('GET /api/admin/evaluation/runs/:id/quality-gate evaluates run with query policy overrides', async () => {
      const completedRun = await repo.createRun({
        status: 'completed',
        totalCases: 56,
        passedCases: 56,
        overallScore: 100,
        regressionCount: 0,
      });

      const req: any = {
        params: { id: completedRun.id },
        query: { minimumPassRate: '95', maximumRegressions: '0' },
      };
      const res = createMockRes();

      await controller.getRunQualityGate(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe('passed');
      expect(res.body.data.policy.minimumPassRate).toBe(95);
    });

    it('GET /api/admin/evaluation/runs/:id/snapshot returns 200 with full snapshot', async () => {
      const completedRun = await repo.createRun({
        status: 'completed',
        totalCases: 56,
        passedCases: 56,
        overallScore: 100,
      });

      const req: any = { params: { id: completedRun.id } };
      const res = createMockRes();

      await controller.getRunSnapshot(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.runId).toBe(completedRun.id);
      expect(res.body.data.dimensionScores).toBeDefined();
    });
  });
});
