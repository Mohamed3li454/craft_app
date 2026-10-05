import { Request, Response } from 'express';
import {
  classifyFailure,
  generateAssertionDiagnostics,
  buildFailureFingerprint,
  clusterFailures,
  computeDimensionHealth,
  compareRuns,
  computeProviderDiagnostics,
  FailureCategory,
} from '../src/modules/observability/evaluation/quality_intelligence';
import { GOLDEN_EVALUATION_DATASET } from '../src/modules/observability/evaluation/dataset';
import { EvaluationCase } from '../src/modules/observability/evaluation/types';
import {
  EvaluationRepository,
  EvaluationCaseResultRecord,
  EvaluationRunRecord,
} from '../src/database/repositories/evaluation.repo';
import { AdminEvaluationController } from '../src/modules/admin/controllers/admin_evaluation.controller';
import { EvaluationExecutionService } from '../src/modules/observability/evaluation/execution_service';

describe('Phase 12.3 Quality Intelligence Suite', () => {
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
    controller = new AdminEvaluationController(repo, executionService);
  });

  // =========================================================================
  // 1. DETERMINISTIC FAILURE TAXONOMY
  // =========================================================================
  describe('1. Failure Taxonomy Classification', () => {
    it('classifies security violations correctly', () => {
      const res1 = classifyFailure('agent', {}, { blockedReason: 'side_effect_tool_blocked' });
      expect(res1.category).toBe('security_violation');

      const res2 = classifyFailure('agent', {}, {}, 'SSRF attempt detected on metadata service');
      expect(res2.category).toBe('security_violation');
    });

    it('classifies timeouts correctly', () => {
      const res1 = classifyFailure('agent', {}, { blockedReason: 'timeout' });
      expect(res1.category).toBe('timeout');

      const res2 = classifyFailure('agent', {}, {}, 'Execution timed out after 10000ms');
      expect(res2.category).toBe('timeout');
    });

    it('classifies budget exceeded / context overflow correctly', () => {
      const res1 = classifyFailure('agent', {}, { blockedReason: 'context_overflow' });
      expect(res1.category).toBe('budget_exceeded');

      const res2 = classifyFailure('agent', {}, {}, 'Exceeded token limit 4096');
      expect(res2.category).toBe('budget_exceeded');
    });

    it('classifies provider errors correctly', () => {
      const res = classifyFailure('provider', {}, { status: 'error' }, 'Groq provider 503 service unavailable');
      expect(res.category).toBe('provider_error');
    });

    it('classifies forbidden tool usage and missing required tool correctly', () => {
      const res1 = classifyFailure('agent', {}, {}, 'Expected tool [web_search] not to be used, but it was executed');
      expect(res1.category).toBe('forbidden_tool_used');

      const res2 = classifyFailure('agent', {}, {}, 'Expected tool [calculator] to be used, but missing');
      expect(res2.category).toBe('required_tool_missing');
    });

    it('classifies subsystem mismatches accurately based on dimension', () => {
      const memRes = classifyFailure('memory', {}, {}, 'Expected memory update to contain preferences');
      expect(memRes.category).toBe('memory_mismatch');

      const convRes = classifyFailure('conversation', {}, {}, 'Expected conversation strategy [direct_answer]');
      expect(convRes.category).toBe('conversation_mismatch');

      const persRes = classifyFailure('personalization', {}, {}, 'Expected dialect [gulf]');
      expect(persRes.category).toBe('personalization_mismatch');

      const adaptRes = classifyFailure('adaptive_response', {}, {}, 'Expected clarification prompt');
      expect(adaptRes.category).toBe('adaptive_response_mismatch');
    });

    it('classifies generic assertion failures and unknown gracefully', () => {
      const assertRes = classifyFailure('agent', {}, {}, 'Expected score >= 90 but got 70');
      expect(assertRes.category).toBe('assertion_failure');

      const unkRes = classifyFailure('agent', {}, {}, 'Unspecified system quirk');
      expect(unkRes.category).toBe('unknown');
    });
  });

  // =========================================================================
  // 2. ASSERTION-LEVEL DIAGNOSTICS
  // =========================================================================
  describe('2. Assertion-Level Diagnostics', () => {
    it('evaluates multi-assertion test case with detailed expected vs observed reporting', () => {
      const mockCase: EvaluationCase = {
        id: 'eval_sample_multi',
        name: 'Multi Assertion Case',
        category: 'agent',
        input: 'Test input',
        expected: {
          toolCalls: ['calculator', 'database_query'],
          forbiddenTools: ['execute_raw_sql'],
          strategy: 'tool_call',
          maxSteps: 3,
          fallbackUsed: false,
          clarification: false,
          status: 'success',
        },
      };

      const actualPassing = {
        toolCalls: ['calculator', 'database_query'],
        strategy: 'tool_call',
        stepsCount: 2,
        fallbackUsed: false,
        clarificationNeeded: false,
        status: 'success',
      };

      const reportPassing = generateAssertionDiagnostics(mockCase, actualPassing);
      expect(reportPassing.totalCount).toBe(8); // 2 required tools + 1 forbidden + strategy + maxSteps + fallback + clarification + status
      expect(reportPassing.passedCount).toBe(8);
      expect(reportPassing.assertions.every((a) => a.status === 'passed')).toBe(true);

      // Now partial failure: forbidden tool used, max steps exceeded
      const actualFailing = {
        toolCalls: ['calculator', 'execute_raw_sql'],
        strategy: 'tool_call',
        stepsCount: 5,
        fallbackUsed: false,
        clarificationNeeded: false,
        status: 'success',
      };

      const reportFailing = generateAssertionDiagnostics(mockCase, actualFailing);
      expect(reportFailing.totalCount).toBe(8);
      expect(reportFailing.passedCount).toBe(5); // 5 passed, 3 failed: database_query missing, execute_raw_sql used, max steps exceeded

      const forbiddenAssertion = reportFailing.assertions.find((a) => a.type === 'forbidden_tool');
      expect(forbiddenAssertion?.status).toBe('failed');
      expect(forbiddenAssertion?.observed).toBe('execute_raw_sql');

      const maxStepsAssertion = reportFailing.assertions.find((a) => a.type === 'max_steps');
      expect(maxStepsAssertion?.status).toBe('failed');
      expect(maxStepsAssertion?.observed).toBe('5 steps');
    });

    it('redacts internal CoT and secrets from actual observations', () => {
      const mockCase: EvaluationCase = {
        id: 'eval_cot_test',
        name: 'CoT Redaction Test',
        category: 'agent',
        input: 'Secret token test',
        expected: {
          strategy: 'direct_answer',
        },
      };

      const actualWithCoT = {
        strategy: 'direct_answer',
        chain_of_thought: 'Thinking step by step: sk-ant-api03-secret-key-1234567890',
        thought: 'Internal reasoning here',
      };

      const report = generateAssertionDiagnostics(mockCase, actualWithCoT);
      expect(report.passedCount).toBe(1);
      // Ensure no raw secret or reasoning is present in assertions
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain('sk-ant-api03-secret-key-1234567890');
    });
  });

  // =========================================================================
  // 3. FAILURE FINGERPRINTING & CLUSTERING
  // =========================================================================
  describe('3. Failure Fingerprinting & Clustering', () => {
    it('creates deterministic fingerprints with dimension, category, and detail', () => {
      const fp1 = buildFailureFingerprint(
        'agent',
        'forbidden_tool_used',
        'Expected tool [system_command] not to be used'
      );
      expect(fp1).toBe('agent:forbidden_tool_used:system_command');

      const fp2 = buildFailureFingerprint('agent', 'security_violation', 'Blocked by side_effect_tool_blocked');
      expect(fp2).toBe('agent:security_violation:side_effect_tool_blocked');
    });

    it('clusters multiple failure occurrences across runs and cases', () => {
      const baseResult: EvaluationCaseResultRecord = {
        id: 'res-1',
        runId: 'run-1',
        caseId: 'case_01',
        dimension: 'agent',
        status: 'failed',
        score: 0,
        expected: { toolCalls: ['calculator'] },
        actual: { toolCalls: [] },
        failureReason: 'Expected tool [calculator] to be used, but missing',
        regression: false,
        previousStatus: null,
        previousScore: null,
        model: 'llama-3.3-70b-versatile',
        provider: 'groq',
        durationMs: 120,
        tokens: 300,
        createdAt: '2026-10-04T05:00:00.000Z',
      };

      const results: EvaluationCaseResultRecord[] = [
        baseResult,
        {
          ...baseResult,
          id: 'res-2',
          runId: 'run-2',
          caseId: 'case_02',
          createdAt: '2026-10-04T06:00:00.000Z',
        },
        {
          ...baseResult,
          id: 'res-3',
          runId: 'run-2',
          caseId: 'case_03',
          createdAt: '2026-10-04T07:00:00.000Z',
        },
      ];

      const clusters = clusterFailures(results);
      expect(clusters.length).toBe(1);
      expect(clusters[0].pattern).toBe('agent:required_tool_missing:calculator');
      expect(clusters[0].occurrences).toBe(3);
      expect(clusters[0].affectedCases).toEqual(['case_01', 'case_02', 'case_03']);
      expect(clusters[0].affectedRuns).toEqual(['run-1', 'run-2']);
      expect(clusters[0].firstSeen).toBe('2026-10-04T05:00:00.000Z');
      expect(clusters[0].lastSeen).toBe('2026-10-04T07:00:00.000Z');
    });
  });

  // =========================================================================
  // 4. DIMENSION HEALTH
  // =========================================================================
  describe('4. Dimension Health Calculation', () => {
    it('computes factual dimension health across all 7 dimensions', () => {
      const mockResults: EvaluationCaseResultRecord[] = [
        {
          id: 'res-mem-1',
          runId: 'run-1',
          caseId: 'mem_01',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          failureReason: null,
          regression: false,
          previousStatus: null,
          previousScore: null,
          model: 'llama-3.3-70b-versatile',
          provider: 'groq',
          durationMs: 100,
          tokens: 150,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'res-mem-2',
          runId: 'run-1',
          caseId: 'mem_02',
          dimension: 'memory',
          status: 'failed',
          score: 0,
          expected: {},
          actual: {},
          failureReason: 'Memory mismatch',
          regression: true,
          previousStatus: 'passed',
          previousScore: 100,
          model: 'llama-3.3-70b-versatile',
          provider: 'groq',
          durationMs: 120,
          tokens: 180,
          createdAt: new Date().toISOString(),
        },
      ];

      const health = computeDimensionHealth(mockResults);
      expect(Object.keys(health)).toHaveLength(7);

      const memHealth = health.memory;
      expect(memHealth.evaluatedCases).toBe(2);
      expect(memHealth.passedCases).toBe(1);
      expect(memHealth.failedCases).toBe(1);
      expect(memHealth.passRate).toBe(50);
      expect(memHealth.averageScore).toBe(50);
      expect(memHealth.regressionsCount).toBe(1);
      expect(memHealth.topFailurePattern).toContain('memory');

      // Untested dimension returns default neutral state
      const provHealth = health.provider;
      expect(provHealth.evaluatedCases).toBe(0);
      expect(provHealth.passRate).toBe(100);
      expect(provHealth.topFailurePattern).toBeNull();
    });
  });

  // =========================================================================
  // 5. DEEP RUN COMPARISON
  // =========================================================================
  describe('5. Deep Run Comparison Engine', () => {
    it('calculates exact metric deltas (in pp) and isolates changed cases only', () => {
      const runA: EvaluationRunRecord = {
        id: 'run-A',
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'completed',
        totalCases: 2,
        passedCases: 1,
        failedCases: 1,
        skippedCases: 0,
        regressionCount: 0,
        overallScore: 50,
        durationMs: 1000,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        createdBy: 'admin',
        createdAt: new Date().toISOString(),
      };

      const runB: EvaluationRunRecord = {
        ...runA,
        id: 'run-B',
        passedCases: 2,
        failedCases: 0,
        regressionCount: 0,
        overallScore: 100,
        durationMs: 1200,
      };

      const resultsA: EvaluationCaseResultRecord[] = [
        {
          id: 'res-A1',
          runId: 'run-A',
          caseId: 'case_unchanged',
          dimension: 'agent',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          failureReason: null,
          regression: false,
          previousStatus: null,
          previousScore: null,
          model: 'mock-model',
          provider: 'mock',
          durationMs: 500,
          tokens: 200,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'res-A2',
          runId: 'run-A',
          caseId: 'case_improved',
          dimension: 'memory',
          status: 'failed',
          score: 0,
          expected: {},
          actual: {},
          failureReason: 'Memory lookup failed',
          regression: false,
          previousStatus: null,
          previousScore: null,
          model: 'mock-model',
          provider: 'mock',
          durationMs: 500,
          tokens: 200,
          createdAt: new Date().toISOString(),
        },
      ];

      const resultsB: EvaluationCaseResultRecord[] = [
        {
          ...resultsA[0],
          id: 'res-B1',
          runId: 'run-B',
        },
        {
          ...resultsA[1],
          id: 'res-B2',
          runId: 'run-B',
          status: 'passed',
          score: 100,
          failureReason: null,
        },
      ];

      const comparison = compareRuns(runA, resultsA, runB, resultsB);

      // Pass rate went from 50% to 100% (+50 pp)
      expect(comparison.metrics.passRateDeltaPp).toBe(50);
      expect(comparison.metrics.averageScoreDelta).toBe(50);
      expect(comparison.metrics.failuresDelta).toBe(-1);

      // Unchanged cases MUST be omitted from changedCases diff
      expect(comparison.changedCases).toHaveLength(1);
      expect(comparison.changedCases[0].caseId).toBe('case_improved');
      expect(comparison.changedCases[0].changeType).toBe('recovered');
      expect(comparison.changedCases[0].scoreDelta).toBe(100);
    });
  });

  // =========================================================================
  // 6. PROVIDER DIAGNOSTICS
  // =========================================================================
  describe('6. Provider Diagnostics Calculation', () => {
    it('aggregates performance breakdown per provider and model descriptively', () => {
      const results: EvaluationCaseResultRecord[] = [
        {
          id: 'r1',
          runId: 'run-1',
          caseId: 'c1',
          dimension: 'provider',
          status: 'passed',
          score: 100,
          expected: {},
          actual: {},
          failureReason: null,
          regression: false,
          previousStatus: null,
          previousScore: null,
          model: 'llama-3.3-70b-versatile',
          provider: 'groq',
          durationMs: 250,
          tokens: 400,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'r2',
          runId: 'run-1',
          caseId: 'c2',
          dimension: 'provider',
          status: 'failed',
          score: 50,
          expected: {},
          actual: {},
          failureReason: 'Rate limit',
          regression: false,
          previousStatus: null,
          previousScore: null,
          model: 'llama-3.3-70b-versatile',
          provider: 'groq',
          durationMs: 350,
          tokens: 200,
          createdAt: new Date().toISOString(),
        },
      ];

      const diagnostics = computeProviderDiagnostics(results);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].provider).toBe('groq');
      expect(diagnostics[0].model).toBe('llama-3.3-70b-versatile');
      expect(diagnostics[0].evaluatedCases).toBe(2);
      expect(diagnostics[0].passedCases).toBe(1);
      expect(diagnostics[0].failedCases).toBe(1);
      expect(diagnostics[0].passRate).toBe(50);
      expect(diagnostics[0].averageScore).toBe(75);
      expect(diagnostics[0].totalTokens).toBe(600);
      expect(diagnostics[0].averageDurationMs).toBe(300);
    });
  });

  // =========================================================================
  // 7. CONTROLLER & ENDPOINTS INTEGRATION
  // =========================================================================
  describe('7. Controller & Endpoints Integration', () => {
    it('GET /api/admin/evaluation/quality returns dimension health, provider diagnostics, and top failures', async () => {
      const req: any = { query: {} };
      const res = createMockRes();

      await controller.getQualityOverview(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dimensionHealth).toBeDefined();
      expect(res.body.data.providerDiagnostics).toBeDefined();
      expect(Array.isArray(res.body.data.topFailures)).toBe(true);
    });

    it('GET /api/admin/evaluation/failures returns clustered patterns and taxonomy breakdown', async () => {
      // Seed a failed case result
      const run = await repo.createRun({
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'completed',
        totalCases: 1,
        passedCases: 0,
        failedCases: 1,
        skippedCases: 0,
        regressionCount: 0,
        overallScore: 0,
        durationMs: 100,
        createdBy: 'admin',
      });
      await repo.createCaseResults([
        {
          runId: run.id,
          caseId: 'agent_01',
          dimension: 'agent',
          status: 'failed',
          score: 0,
          failureReason: 'Expected tool [calculator] to be used, but missing',
        },
      ]);

      const req: any = { query: {} };
      const res = createMockRes();

      await controller.getFailures(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalFailures).toBe(1);
      expect(res.body.data.taxonomyCounts['required_tool_missing']).toBe(1);
      expect(res.body.data.clusters).toHaveLength(1);
      expect(res.body.data.clusters[0].pattern).toBe('agent:required_tool_missing:calculator');
    });

    it('GET /api/admin/evaluation/compare validates params and returns comparison diff', async () => {
      // Missing params -> 400
      const reqBad: any = { query: { runA: 'r1' } };
      const resBad = createMockRes();
      await controller.compareRuns(reqBad, resBad);
      expect(resBad.statusCode).toBe(400);

      // Create two runs
      const run1 = await repo.createRun({
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'completed',
        totalCases: 1,
        passedCases: 1,
        failedCases: 0,
        skippedCases: 0,
        regressionCount: 0,
        overallScore: 100,
        durationMs: 100,
        createdBy: 'admin',
      });
      const run2 = await repo.createRun({
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'completed',
        totalCases: 1,
        passedCases: 0,
        failedCases: 1,
        skippedCases: 0,
        regressionCount: 1,
        overallScore: 0,
        durationMs: 150,
        createdBy: 'admin',
      });

      await repo.createCaseResults([
        {
          runId: run1.id,
          caseId: 'agent_01',
          dimension: 'agent',
          status: 'passed',
          score: 100,
        },
      ]);
      await repo.createCaseResults([
        {
          runId: run2.id,
          caseId: 'agent_01',
          dimension: 'agent',
          status: 'failed',
          score: 0,
          regression: true,
          previousStatus: 'passed',
          previousScore: 100,
        },
      ]);

      const reqGood: any = { query: { runA: run1.id, runB: run2.id } };
      const resGood = createMockRes();
      await controller.compareRuns(reqGood, resGood);

      expect(resGood.statusCode).toBe(200);
      expect(resGood.body.success).toBe(true);
      expect(resGood.body.data.metrics.passRateDeltaPp).toBe(-100);
      expect(resGood.body.data.changedCases).toHaveLength(1);
      expect(resGood.body.data.changedCases[0].changeType).toBe('regression');
    });

    it('GET /api/admin/evaluation/cases/:id/history returns chronological history and diagnostics', async () => {
      const validCase = GOLDEN_EVALUATION_DATASET[0];
      const run = await repo.createRun({
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'completed',
        totalCases: 1,
        passedCases: 1,
        failedCases: 0,
        skippedCases: 0,
        regressionCount: 0,
        overallScore: 100,
        durationMs: 50,
        createdBy: 'admin',
      });

      await repo.createCaseResults([
        {
          runId: run.id,
          caseId: validCase.id,
          dimension: validCase.category,
          status: 'passed',
          score: 100,
          actual: { toolCalls: validCase.expected.toolCalls || [] },
        },
      ]);

      const req: any = { params: { id: validCase.id }, query: {} };
      const res = createMockRes();

      await controller.getCaseHistory(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.case.id).toBe(validCase.id);
      expect(res.body.data.history).toHaveLength(1);
      expect(res.body.data.history[0].assertionReport).toBeDefined();

      // 404 for unknown case
      const reqNotFound: any = { params: { id: 'unknown_non_existent_case' }, query: {} };
      const resNotFound = createMockRes();
      await controller.getCaseHistory(reqNotFound, resNotFound);
      expect(resNotFound.statusCode).toBe(404);
    });

    it('GET /api/admin/evaluation/runs/:id/results enriches cases with assertionReport and runtimeCorrelation', async () => {
      const validCase = GOLDEN_EVALUATION_DATASET[0];
      const run = await repo.createRun({
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'completed',
        totalCases: 1,
        passedCases: 1,
        failedCases: 0,
        skippedCases: 0,
        regressionCount: 0,
        overallScore: 100,
        durationMs: 50,
        createdBy: 'admin',
      });

      await repo.createCaseResults([
        {
          runId: run.id,
          caseId: validCase.id,
          dimension: validCase.category,
          status: 'passed',
          score: 100,
          actual: {
            toolCalls: validCase.expected.toolCalls || [],
            agentRunId: 'agent-run-xyz-123',
            toolCallId: 'tool-call-abc-789',
          },
        },
      ]);

      const req: any = { params: { id: run.id }, query: {} };
      const res = createMockRes();

      await controller.getRunResults(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);

      const result = res.body.data[0];
      expect(result.assertionReport).toBeDefined();
      expect(result.runtimeCorrelation.hasCorrelation).toBe(true);
      expect(result.runtimeCorrelation.agentRunId).toBe('agent-run-xyz-123');
      expect(result.runtimeCorrelation.toolCallId).toBe('tool-call-abc-789');
    });
  });
});
