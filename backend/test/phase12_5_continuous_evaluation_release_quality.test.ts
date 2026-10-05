import { Request, Response } from 'express';
import {
  EvaluationExecutionService,
} from '../src/modules/observability/evaluation/execution_service';
import {
  EvaluationRepository,
  EvaluationRunRecord,
} from '../src/database/repositories/evaluation.repo';
import { AdminEvaluationController } from '../src/modules/admin/controllers/admin_evaluation.controller';
import {
  sanitizeProvenanceString,
  extractReleaseMetadata,
  resolveDatasetProvenance,
  deriveQualityDecision,
  buildReleaseQualitySignal,
} from '../src/modules/observability/evaluation/release_quality';
import {
  evaluateQualityGate,
  buildQualityReleaseSnapshot,
} from '../src/modules/observability/evaluation/quality_gate';
import { compareRuns } from '../src/modules/observability/evaluation/quality_intelligence';

describe('Phase 12.5 — Continuous Evaluation & Release Quality Integration Suite', () => {
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
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_DEPLOYMENT_ID;
    delete process.env.VERCEL_ENV;
  });

  // =========================================================================
  // 1. PROVENANCE SANITIZATION & SECRET SCREENING
  // =========================================================================
  describe('1. Provenance Sanitization & Non-Secret Guarantees', () => {
    it('redacts sensitive tokens, API keys, passwords, and bearer headers in provenance strings', () => {
      expect(sanitizeProvenanceString('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe('[REDACTED_CREDENTIAL]');
      expect(sanitizeProvenanceString('ghp_1234567890abcdefghijklmnopqrstuvwx')).toBe('[REDACTED_CREDENTIAL]');
      expect(sanitizeProvenanceString('my-secret-token-value')).toBe('[REDACTED_CREDENTIAL]');
      expect(sanitizeProvenanceString('api_key=sk_live_12345678')).toBe('[REDACTED_CREDENTIAL]');
      expect(sanitizeProvenanceString('user_password_hash')).toBe('[REDACTED_CREDENTIAL]');
    });

    it('bounds string lengths to 128 characters and trims whitespace', () => {
      const longCommit = 'a'.repeat(200);
      const sanitized = sanitizeProvenanceString(longCommit);
      expect(sanitized).toBeDefined();
      expect(sanitized!.length).toBe(128);

      expect(sanitizeProvenanceString('   v1.2.3   ')).toBe('v1.2.3');
      expect(sanitizeProvenanceString('')).toBeNull();
      expect(sanitizeProvenanceString(null as any)).toBeNull();
      expect(sanitizeProvenanceString(undefined as any)).toBeNull();
    });

    it('extracts release metadata from safe explicit payload without shell/command execution', () => {
      const meta = extractReleaseMetadata({
        commitSha: '6f8a92b',
        deploymentId: 'dpl_xyz123',
        deploymentVersion: '2.1.0',
        environment: 'staging',
        branch: 'feature/phase-12-5',
        buildId: 'build-994',
      });

      expect(meta.commitSha).toBe('6f8a92b');
      expect(meta.deploymentId).toBe('dpl_xyz123');
      expect(meta.deploymentVersion).toBe('2.1.0');
      expect(meta.environment).toBe('staging');
      expect(meta.branch).toBe('feature/phase-12-5');
      expect(meta.buildId).toBe('build-994');
    });

    it('defaults safely to null when release metadata is absent (Not Tracked)', () => {
      const meta = extractReleaseMetadata();
      expect(meta.commitSha).toBeNull();
      expect(meta.deploymentId).toBeNull();
      expect(meta.deploymentVersion).toBeNull();
      expect(meta.environment).toBeNull();
    });

    it('resolves authoritative dataset provenance for Golden Benchmark Dataset vs custom datasets', () => {
      const goldenProv = resolveDatasetProvenance('Phase 8.5 Golden Benchmark Dataset');
      expect(goldenProv.datasetVersion).toBe('Phase 8.5 Golden Benchmark Dataset');
      expect(goldenProv.caseCount).toBe(56);
      expect(goldenProv.dimensionsCount).toBe(7);
      expect(goldenProv.source).toBe('source-controlled');

      const customProv = resolveDatasetProvenance('Experimental-AdHoc-Suite-v1');
      expect(customProv.datasetVersion).toBe('Experimental-AdHoc-Suite-v1');
      expect(customProv.caseCount).toBe(0);
      expect(customProv.source).toBe('Not Tracked');
    });
  });

  // =========================================================================
  // 2. DETERMINISTIC QUALITY DECISIONS
  // =========================================================================
  describe('2. Quality Decision Derivation', () => {
    it('strictly maps gate outcomes to decisions without AI heuristics', () => {
      expect(deriveQualityDecision('passed')).toBe('approved');
      expect(deriveQualityDecision('failed')).toBe('rejected');
      expect(deriveQualityDecision('not_configured')).toBe('not_configured');
    });

    it('builds an authoritative ReleaseQualitySignal incorporating gate result and provenance', async () => {
      const run = await repo.createRun({
        status: 'completed',
        totalCases: 10,
        passedCases: 10,
        failedCases: 0,
        overallScore: 100,
        metadata: {
          release: {
            commitSha: 'c0ffee1',
            environment: 'production',
          },
        },
      });

      const signal = buildReleaseQualitySignal(run, {
        minimumPassRate: 90,
        minimumScore: 85,
        maximumFailures: 0,
      });

      expect(signal.runId).toBe(run.id);
      expect(signal.qualityGate.status).toBe('passed');
      expect(signal.qualityDecision).toBe('approved');
      expect(signal.releaseMetadata.commitSha).toBe('c0ffee1');
      expect(signal.releaseMetadata.environment).toBe('production');
      expect(signal.datasetProvenance.source).toBe('source-controlled');
      expect(signal.metrics.passRate).toBe(100);
    });

    it('rejects release decision when quality gate thresholds are breached', async () => {
      const run = await repo.createRun({
        status: 'completed',
        totalCases: 10,
        passedCases: 7,
        failedCases: 3,
        regressionCount: 1,
        overallScore: 70,
        metadata: {
          release: {
            commitSha: 'b4df00d',
            environment: 'staging',
          },
        },
      });

      const signal = buildReleaseQualitySignal(run, {
        minimumPassRate: 90,
        maximumRegressions: 0,
        maximumFailures: 0,
      });

      expect(signal.qualityGate.status).toBe('failed');
      expect(signal.qualityDecision).toBe('rejected');
      expect(signal.qualityGate.failureReasons.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 3. DATASET VERSION SAFETY IN RUN COMPARISONS
  // =========================================================================
  describe('3. Dataset Version Safety & Comparison Semantics', () => {
    it('enables regression comparison semantics between runs of the same dataset version', async () => {
      const runA = await repo.createRun({
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        status: 'completed',
        totalCases: 2,
        passedCases: 2,
        failedCases: 0,
        overallScore: 100,
      });

      const runB = await repo.createRun({
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        status: 'completed',
        totalCases: 2,
        passedCases: 1,
        failedCases: 1,
        overallScore: 50,
      });

      const resultsA = [
        { id: 'res-a1', runId: runA.id, caseId: 'mem_01', dimension: 'memory', status: 'passed', score: 100, durationMs: 50, tokens: 100, createdAt: new Date().toISOString() },
        { id: 'res-a2', runId: runA.id, caseId: 'mem_02', dimension: 'memory', status: 'passed', score: 100, durationMs: 50, tokens: 100, createdAt: new Date().toISOString() },
      ];

      const resultsB = [
        { id: 'res-b1', runId: runB.id, caseId: 'mem_01', dimension: 'memory', status: 'failed', score: 0, durationMs: 50, tokens: 100, createdAt: new Date().toISOString() },
        { id: 'res-b2', runId: runB.id, caseId: 'mem_02', dimension: 'memory', status: 'passed', score: 100, durationMs: 50, tokens: 100, createdAt: new Date().toISOString() },
      ];

      const comparison = compareRuns(runA, resultsA as any, runB, resultsB as any);

      expect(comparison.comparisonType).toBe('regression');
      expect(comparison.warning).toBeNull();
      expect(comparison.changedCases.length).toBe(1);
      expect(comparison.changedCases[0].caseId).toBe('mem_01');
      expect(comparison.changedCases[0].changeType).toBe('regression');
    });

    it('disables regression semantics (comparisonType = informational) when comparing different dataset versions', async () => {
      const runA = await repo.createRun({
        datasetVersion: 'Suite-v1.0',
        status: 'completed',
        totalCases: 2,
        passedCases: 2,
        failedCases: 0,
        overallScore: 100,
      });

      const runB = await repo.createRun({
        datasetVersion: 'Suite-v2.0-Expanded',
        status: 'completed',
        totalCases: 2,
        passedCases: 1,
        failedCases: 1,
        overallScore: 50,
      });

      const resultsA = [
        { id: 'res-a1', runId: runA.id, caseId: 'mem_01', dimension: 'memory', status: 'passed', score: 100, durationMs: 50, tokens: 100, createdAt: new Date().toISOString() },
      ];

      const resultsB = [
        { id: 'res-b1', runId: runB.id, caseId: 'mem_01', dimension: 'memory', status: 'failed', score: 0, durationMs: 50, tokens: 100, createdAt: new Date().toISOString() },
      ];

      const comparison = compareRuns(runA, resultsA as any, runB, resultsB as any);

      expect(comparison.comparisonType).toBe('informational');
      expect(comparison.warning).toBe('Dataset versions differ; regression semantics are disabled.');
      expect(comparison.changedCases[0].changeType).toBe('new_failure'); // NOT regression
    });
  });

  // =========================================================================
  // 4. EXECUTION SERVICE & PERSISTED RELEASE PROVENANCE
  // =========================================================================
  describe('4. Execution Service Provenance Integration', () => {
    it('persists release metadata and provenance into run metadata during executeRun', async () => {
      const executionResult = await executionService.executeRun({
        mode: 'mock',
        caseIds: ['mem_01'],
        createdBy: 'qa-engineer',
        releaseMetadata: {
          commitSha: 'e4d3c2b1',
          deploymentId: 'dpl_staging_1',
          environment: 'staging',
        },
      });

      expect(executionResult.run.id).toBeDefined();
      expect(executionResult.run.metadata).toBeDefined();
      expect(executionResult.run.metadata?.release?.commitSha).toBe('e4d3c2b1');
      expect(executionResult.run.metadata?.release?.environment).toBe('staging');
      expect(executionResult.run.metadata?.provenance?.source).toBe('source-controlled');

      // Verify repository retrieval
      const fetched = await repo.getRunById(executionResult.run.id);
      expect(fetched?.metadata?.release?.commitSha).toBe('e4d3c2b1');
    });

    it('filters historical runs by environment via repo.listRuns', async () => {
      await repo.createRun({
        status: 'completed',
        metadata: { release: { environment: 'production' } },
      });
      await repo.createRun({
        status: 'completed',
        metadata: { release: { environment: 'staging' } },
      });
      await repo.createRun({
        status: 'completed',
        metadata: { release: { environment: 'staging' } },
      });

      const prodRuns = await repo.listRuns({ environment: 'production' });
      expect(prodRuns.total).toBe(1);

      const stagingRuns = await repo.listRuns({ environment: 'staging' });
      expect(stagingRuns.total).toBe(2);
    });
  });

  // =========================================================================
  // 5. CI-READY MACHINE-READABLE API ENDPOINTS
  // =========================================================================
  describe('5. Controller Endpoints for CI / Release Integration', () => {
    it('GET /runs/:id/quality-gate returns HTTP 200 even when gate status is failed (evaluation finding, not crash)', async () => {
      const run = await repo.createRun({
        status: 'completed',
        totalCases: 10,
        passedCases: 5,
        failedCases: 5,
        overallScore: 50,
      });

      const req: any = {
        params: { id: run.id },
        query: { minimumPassRate: '90' },
      };
      const res = createMockRes();

      await controller.getRunQualityGate(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('failed');
      expect(res.body.data.decision).toBe('rejected');
      expect(res.body.data.releaseMetadata).toBeDefined();
      expect(res.body.data.datasetProvenance).toBeDefined();
    });

    it('GET /runs/:id/release-quality returns complete ReleaseQualitySignal', async () => {
      const run = await repo.createRun({
        status: 'completed',
        totalCases: 5,
        passedCases: 5,
        failedCases: 0,
        overallScore: 100,
        metadata: {
          release: { commitSha: 'abcde12', environment: 'production' },
        },
      });

      const req: any = {
        params: { id: run.id },
        query: {},
      };
      const res = createMockRes();

      await controller.getRunReleaseQuality(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.runId).toBe(run.id);
      expect(res.body.data.releaseMetadata.commitSha).toBe('abcde12');
      expect(res.body.data.datasetProvenance.source).toBe('source-controlled');
      expect(res.body.data.qualityDecision).toBe('not_configured');
    });

    it('GET /release-quality returns paginated list of release signals with filtering', async () => {
      const run1 = await repo.createRun({
        status: 'completed',
        totalCases: 5,
        passedCases: 5,
        overallScore: 100,
        metadata: { release: { environment: 'production' } },
      });
      const run2 = await repo.createRun({
        status: 'completed',
        totalCases: 5,
        passedCases: 2,
        failedCases: 3,
        overallScore: 40,
        metadata: { release: { environment: 'staging' } },
      });

      const req: any = {
        query: { environment: 'production' },
      };
      const res = createMockRes();

      await controller.getReleaseQualityHistory(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].runId).toBe(run1.id);
    });

    it('POST /runs accepts releaseMetadata payload securely', async () => {
      const req: any = {
        body: {
          mode: 'mock',
          caseIds: ['mem_01'],
          releaseMetadata: {
            commitSha: 'fedcba9',
            environment: 'ci-pipeline',
          },
        },
        headers: {},
      };
      const res = createMockRes();

      await controller.triggerRun(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.run.metadata?.release?.commitSha).toBe('fedcba9');
    });
  });

  // =========================================================================
  // 6. ENRICHED QUALITY RELEASE SNAPSHOT
  // =========================================================================
  describe('6. Enriched Quality Release Snapshot', () => {
    it('builds snapshot with releaseMetadata, qualityDecision, and datasetProvenance', async () => {
      const run = await repo.createRun({
        status: 'completed',
        totalCases: 1,
        passedCases: 1,
        overallScore: 100,
        metadata: {
          release: { commitSha: '778899a', environment: 'production' },
        },
      });

      const snapshot = buildQualityReleaseSnapshot(run, [], { minimumPassRate: 100 });

      expect(snapshot.runId).toBe(run.id);
      expect(snapshot.releaseMetadata?.commitSha).toBe('778899a');
      expect(snapshot.qualityDecision).toBe('approved');
      expect(snapshot.datasetProvenance?.source).toBe('source-controlled');
    });
  });
});
