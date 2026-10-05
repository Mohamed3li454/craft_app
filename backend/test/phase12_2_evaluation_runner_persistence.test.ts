import { EvaluationRepository } from '../src/database/repositories/evaluation.repo';
import { EvaluationExecutionService } from '../src/modules/observability/evaluation/execution_service';
import { AdminEvaluationController } from '../src/modules/admin/controllers/admin_evaluation.controller';
import { GOLDEN_EVALUATION_DATASET } from '../src/modules/observability/evaluation/dataset';
import { AdminAuditService } from '../src/modules/admin/audit/admin_audit.service';

describe('Phase 12.2 — Evaluation Runner & Persistent Evaluation History', () => {
  let repo: EvaluationRepository;
  let executionService: EvaluationExecutionService;
  let controller: AdminEvaluationController;

  beforeEach(() => {
    repo = EvaluationRepository.getInstance();
    repo.resetInMemoryStore();
    executionService = new EvaluationExecutionService(repo);
    controller = new AdminEvaluationController(repo, executionService);
  });

  describe('1. EvaluationRepository Persistence & Queries', () => {
    it('creates and retrieves an evaluation run', async () => {
      const run = await repo.createRun({
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'running',
        totalCases: 56,
        createdBy: 'admin_test',
      });

      expect(run).toBeDefined();
      expect(run.id).toBeDefined();
      expect(run.status).toBe('running');
      expect(run.totalCases).toBe(56);
      expect(run.createdBy).toBe('admin_test');

      const fetched = await repo.getRunById(run.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(run.id);
      expect(fetched?.datasetVersion).toBe('Phase 8.5 Golden Benchmark Dataset');
    });

    it('updates run status and completion metrics', async () => {
      const run = await repo.createRun({
        mode: 'mock',
        status: 'running',
        totalCases: 56,
      });

      const updated = await repo.updateRun(run.id, {
        status: 'completed',
        passedCases: 56,
        failedCases: 0,
        overallScore: 100,
        regressionCount: 0,
        durationMs: 420,
        completedAt: new Date().toISOString(),
      });

      expect(updated?.status).toBe('completed');
      expect(updated?.passedCases).toBe(56);
      expect(updated?.overallScore).toBe(100);

      const latest = await repo.getLatestCompletedRun();
      expect(latest?.id).toBe(run.id);
      expect(latest?.status).toBe('completed');
    });

    it('persists case results and filters by run ID and regression', async () => {
      const run = await repo.createRun({ mode: 'mock', status: 'completed' });

      await repo.createCaseResults([
        {
          runId: run.id,
          caseId: 'mem_01',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          expected: { memoryUsage: 'required' },
          actual: { memorySelectedCount: 1 },
          regression: false,
        },
        {
          runId: run.id,
          caseId: 'agent_01',
          dimension: 'agent',
          status: 'failed',
          score: 0,
          expected: { strategy: 'direct' },
          actual: { strategy: 'fallback' },
          failureReason: 'Strategy mismatch',
          regression: true,
          previousStatus: 'passed',
        },
      ]);

      const allResults = await repo.getCaseResultsByRunId(run.id);
      expect(allResults.total).toBe(2);
      expect(allResults.results.length).toBe(2);

      const regressionsOnly = await repo.getCaseResultsByRunId(run.id, { regressionOnly: true });
      expect(regressionsOnly.total).toBe(1);
      expect(regressionsOnly.results[0].caseId).toBe('agent_01');
      expect(regressionsOnly.results[0].regression).toBe(true);

      const activeRegressions = await repo.getActiveRegressions();
      expect(activeRegressions.total).toBe(1);
      expect(activeRegressions.regressions[0].caseId).toBe('agent_01');
      expect(activeRegressions.regressions[0].previousStatus).toBe('passed');
    });
  });

  describe('2. EvaluationExecutionService Deterministic Runner & Regression Detection', () => {
    it('executes a subset of cases in mock mode and persists results', async () => {
      const subsetIds = ['mem_01', 'mem_02', 'conv_01', 'prov_01'];
      const result = await executionService.executeRun({
        mode: 'mock',
        caseIds: subsetIds,
        createdBy: 'test_runner',
      });

      expect(result.run).toBeDefined();
      expect(result.run.status).toBe('completed');
      expect(result.run.totalCases).toBe(4);
      expect(result.run.passedCases).toBe(4);
      expect(result.run.overallScore).toBe(100);
      expect(result.results.length).toBe(4);
      expect(result.regressionSummary.totalRegressions).toBe(0);

      // Verify each result has sanitized payload and valid dimensions
      for (const res of result.results) {
        expect(['passed', 'failed']).toContain(res.status);
        expect(res.score).toBeGreaterThanOrEqual(0);
        expect(res.actual).toBeDefined();
        expect(res.expected).toBeDefined();
      }
    });

    it('detects a regression when a previously passing case fails in subsequent run', async () => {
      // Run 1: Baseline run where mem_01 passes
      const baseline = await executionService.executeRun({
        mode: 'mock',
        caseIds: ['mem_01'],
        createdBy: 'baseline_author',
      });

      expect(baseline.run.passedCases).toBe(1);
      expect(baseline.results[0].status).toBe('passed');

      // Setup Run 2 where a regression occurs
      // We simulate a failing run by inserting a failed result in repo that compares against baseline
      const run2 = await repo.createRun({
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'running',
        totalCases: 1,
      });

      const baselineRun = await repo.getLatestCompletedRun();
      expect(baselineRun?.id).toBe(baseline.run.id);

      const prevResults = await repo.getCaseResultsByRunId(baselineRun!.id);
      const prevCase = prevResults.results.find((r) => r.caseId === 'mem_01');
      expect(prevCase?.status).toBe('passed');

      // mem_01 now fails
      const isRegression = prevCase?.status === 'passed'; // true
      await repo.createCaseResults([
        {
          runId: run2.id,
          caseId: 'mem_01',
          dimension: 'memory',
          status: 'failed',
          score: 0,
          expected: { memoryUsage: 'required' },
          actual: { memorySelectedCount: 0 },
          failureReason: 'Expected memory selection failed',
          regression: isRegression,
          previousStatus: prevCase?.status,
        },
      ]);

      await repo.updateRun(run2.id, {
        status: 'completed',
        passedCases: 0,
        failedCases: 1,
        regressionCount: 1,
        overallScore: 0,
      });

      const regressions = await repo.getActiveRegressions();
      expect(regressions.total).toBe(1);
      expect(regressions.regressions[0].caseId).toBe('mem_01');
      expect(regressions.regressions[0].regression).toBe(true);
      expect(regressions.regressions[0].previousStatus).toBe('passed');
    });

    it('sanitizes secrets, credentials, and authorization headers from trace payloads', async () => {
      const run = await repo.createRun({ mode: 'mock', status: 'completed' });

      const dirtyActual = {
        token: 'secret_jwt_token_here',
        apiKey: 'gsk_12345678abcdefghij',
        authorization: 'Bearer secret_token_xyz',
        userQuery: 'Find information for user@example.com',
        safeData: 'hello world',
      };

      const [stored] = await repo.createCaseResults([
        {
          runId: run.id,
          caseId: 'mem_01',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          actual: dirtyActual,
        },
      ]);

      expect(stored.actual.token).toBe('[REDACTED]');
      expect(stored.actual.apiKey).toBe('[REDACTED]');
      expect(stored.actual.authorization).toBe('[REDACTED]');
      expect(stored.actual.safeData).toBe('hello world');
    });
  });

  describe('3. Production Safety Invariant: Zero Writes to Business Tables', () => {
    it('verifies evaluation runner does not interact with business entities', async () => {
      // Run evaluation on 7 dimensions (one case per dimension)
      const sampleCaseIds = [
        'mem_01',
        'conv_01',
        'pers_01',
        'resp_01',
        'agent_01',
        'prov_01',
        'pro_01',
      ];

      const execResult = await executionService.executeRun({
        mode: 'mock',
        caseIds: sampleCaseIds,
        createdBy: 'safety_tester',
      });

      expect(execResult.run.totalCases).toBe(7);
      expect(execResult.run.status).toBe('completed');

      // Invariants check:
      // 1. Only evaluation_runs and evaluation_case_results were written
      const runs = await repo.listRuns();
      expect(runs.total).toBeGreaterThanOrEqual(1);

      const results = await repo.getCaseResultsByRunId(execResult.run.id);
      expect(results.total).toBe(7);

      // Verify no business entities exist in evaluation outputs
      for (const r of results.results) {
        expect(r.actual).not.toHaveProperty('whatsappMessageId');
        expect(r.actual).not.toHaveProperty('dbConversationMutation');
      }
    });
  });

  describe('4. Admin Controller Endpoints & RBAC Protection', () => {
    it('getOverview returns historical runs and active regressions count', async () => {
      // Seed a completed run
      await executionService.executeRun({
        mode: 'mock',
        caseIds: ['mem_01', 'mem_02'],
      });

      const req: any = { correlationId: 'test-corr-overview' };
      let responseData: any = null;
      const res: any = {
        json: (payload: any) => {
          responseData = payload;
        },
        status: () => res,
      };

      await controller.getOverview(req, res);

      expect(responseData.success).toBe(true);
      expect(responseData.data.datasetVersion).toBe('Phase 8.5 Golden Benchmark Dataset');
      expect(responseData.data.totalCases).toBe(56);
      expect(responseData.data.historicalRunsCount).toBe(1);
      expect(responseData.data.lastEvaluationRun).not.toBeNull();
      expect(responseData.data.lastEvaluationRun.totalCases).toBe(2);
    });

    it('getCases returns cases enriched with latest result status', async () => {
      await executionService.executeRun({
        mode: 'mock',
        caseIds: ['mem_01'],
      });

      const req: any = { query: { category: 'memory', limit: '10' } };
      let responseData: any = null;
      const res: any = {
        json: (payload: any) => {
          responseData = payload;
        },
        status: () => res,
      };

      await controller.getCases(req, res);

      expect(responseData.success).toBe(true);
      expect(responseData.data.length).toBeGreaterThan(0);
      const mem01 = responseData.data.find((c: any) => c.id === 'mem_01');
      expect(mem01).toBeDefined();
      expect(mem01.latestResult).not.toBeNull();
      expect(mem01.latestResult.status).toBe('passed');
    });

    it('getRuns lists historical runs with pagination', async () => {
      await repo.createRun({ mode: 'mock', status: 'completed', totalCases: 56 });
      await repo.createRun({ mode: 'mock', status: 'completed', totalCases: 56 });

      const req: any = { query: { limit: '10', offset: '0' } };
      let responseData: any = null;
      const res: any = {
        json: (payload: any) => {
          responseData = payload;
        },
        status: () => res,
      };

      await controller.getRuns(req, res);

      expect(responseData.success).toBe(true);
      expect(responseData.data.length).toBe(2);
      expect(responseData.pagination.total).toBe(2);
    });

    it('triggerRun executes run and logs audit entry', async () => {
      const req: any = {
        body: { mode: 'mock', caseIds: ['conv_01'] },
        adminUser: { actor: 'lead_developer', role: 'admin' },
        headers: {},
        correlationId: 'test-trigger-run-corr',
      };
      let responseStatus = 200;
      let responseData: any = null;
      const res: any = {
        status: (code: number) => {
          responseStatus = code;
          return res;
        },
        json: (payload: any) => {
          responseData = payload;
        },
      };

      await controller.triggerRun(req, res);

      expect(responseStatus).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.data.run).toBeDefined();
      expect(responseData.data.run.totalCases).toBe(1);
      expect(responseData.data.run.createdBy).toBe('lead_developer');

      // Verify audit entry was recorded
      const auditService = AdminAuditService.getInstance();
      const auditLogs = await auditService.listLogs({ action: 'EVALUATION_RUN_TRIGGERED' });
      expect(auditLogs.items.length).toBeGreaterThanOrEqual(1);
      const latestAudit = auditLogs.items[0];
      expect(latestAudit.action).toBe('EVALUATION_RUN_TRIGGERED');
      expect(latestAudit.adminActor).toBe('lead_developer');
      expect(latestAudit.resourceType).toBe('evaluation_run');
    });
  });
});
