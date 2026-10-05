import { EvaluationRepository, NewEvaluationRun, NewEvaluationCaseResult } from '../src/database/repositories/evaluation.repo';
import { EvaluationExecutionService } from '../src/modules/observability/evaluation/execution_service';
import { DatabaseManager } from '../src/database/connection';

describe('Phase 12.5 Runtime DDL Remediation & Read-Only Contract Tests', () => {
  let executedQueries: string[] = [];
  let mockPool: any;
  let mockDb: any;
  let repo: EvaluationRepository;

  beforeEach(() => {
    executedQueries = [];

    mockPool = {
      query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push(sql);
        const trimmed = sql.trim().toLowerCase();

        // Simulate information_schema read-only verification
        if (trimmed.includes('information_schema.tables')) {
          return {
            rows: [
              { table_name: 'evaluation_runs' },
              { table_name: 'evaluation_case_results' },
            ],
          };
        }

        // Simulate INSERT into evaluation_runs
        if (trimmed.startsWith('insert into evaluation_runs')) {
          return {
            rows: [
              {
                id: params?.[0] || 'test-run-id',
                dataset_version: params?.[1] || 'Phase 8.5 Golden Benchmark Dataset',
                mode: params?.[2] || 'mock',
                status: params?.[3] || 'queued',
                total_cases: params?.[4] || 0,
                passed_cases: params?.[5] || 0,
                failed_cases: params?.[6] || 0,
                skipped_cases: params?.[7] || 0,
                regression_count: params?.[8] || 0,
                overall_score: params?.[9] || 0,
                duration_ms: params?.[10] || 0,
                started_at: params?.[11] || new Date().toISOString(),
                completed_at: params?.[12] || null,
                created_by: params?.[13] || 'admin',
                created_at: params?.[14] || new Date().toISOString(),
                metadata: params?.[15] ? JSON.parse(params[15]) : {},
              },
            ],
          };
        }

        // Simulate UPDATE evaluation_runs
        if (trimmed.startsWith('update evaluation_runs')) {
          return {
            rows: [
              {
                id: params?.[params.length - 1] || 'test-run-id',
                dataset_version: 'Phase 8.5 Golden Benchmark Dataset',
                mode: 'mock',
                status: 'completed',
                total_cases: 2,
                passed_cases: 2,
                failed_cases: 0,
                skipped_cases: 0,
                regression_count: 0,
                overall_score: 100,
                duration_ms: 50,
                started_at: new Date().toISOString(),
                completed_at: new Date().toISOString(),
                created_by: 'admin',
                created_at: new Date().toISOString(),
                metadata: {},
              },
            ],
          };
        }

        // Default query return
        return { rows: [] };
      }),
      connect: jest.fn().mockImplementation(async () => {
        return {
          query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
            executedQueries.push(sql);
            return { rows: [] };
          }),
          release: jest.fn(),
        };
      }),
    };

    mockDb = {
      getPool: jest.fn().mockReturnValue(mockPool),
      getSupabase: jest.fn().mockReturnValue(null),
    };

    repo = new EvaluationRepository(mockDb as unknown as DatabaseManager);
    repo.resetInMemoryStore();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const assertZeroDDL = (queries: string[]) => {
    const ddlKeywords = ['create table', 'alter table', 'create index', 'drop table', 'drop index', 'truncate'];
    for (const q of queries) {
      const lower = q.toLowerCase();
      for (const kw of ddlKeywords) {
        expect(lower).not.toContain(kw);
      }
    }
  };

  describe('1. Read-Only Schema Verification Contract', () => {
    it('executes only read-only information_schema query and ZERO DDL in ensureSchema()', async () => {
      // Temporarily override isTestOrFallback to verify real execution path
      (repo as any).isTestOrFallback = () => false;

      await repo.ensureSchema();

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const querySql = executedQueries[0].toLowerCase();

      // Must be a SELECT from information_schema.tables
      expect(querySql).toContain('select table_name');
      expect(querySql).toContain('information_schema.tables');
      expect(querySql).toContain('evaluation_runs');
      expect(querySql).toContain('evaluation_case_results');

      // Must NOT contain any DDL
      assertZeroDDL(executedQueries);
    });

    it('falls back safely to in-memory store if tables are absent without attempting DDL', async () => {
      // Mock missing tables response
      mockPool.query.mockImplementationOnce(async (sql: string) => {
        executedQueries.push(sql);
        return { rows: [] }; // No tables found
      });

      (repo as any).isTestOrFallback = () => false;

      await repo.ensureSchema();

      // Should be in memory fallback mode
      expect((repo as any).useMemoryFallback).toBe(true);

      // Verify zero DDL was attempted
      assertZeroDDL(executedQueries);
    });

    it('handles database errors during verification by falling back to memory without crashing or attempting DDL', async () => {
      mockPool.query.mockImplementationOnce(async (sql: string) => {
        executedQueries.push(sql);
        throw new Error('Connection refused to database');
      });

      (repo as any).isTestOrFallback = () => false;

      await repo.ensureSchema();

      expect((repo as any).useMemoryFallback).toBe(true);
      assertZeroDDL(executedQueries);
    });
  });

  describe('2. Repository Operations DML Contract (Zero Runtime DDL)', () => {
    it('createRun() executes INSERT and read-only check with ZERO DDL statements', async () => {
      (repo as any).isTestOrFallback = () => false;

      const run = await repo.createRun({
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        status: 'running',
        totalCases: 5,
        metadata: { releaseDecision: 'PROCEED' },
      });

      expect(run).toBeDefined();
      expect(run.id).toBeDefined();

      // Ensure queries were captured
      expect(executedQueries.length).toBeGreaterThan(0);

      // Verify zero DDL executed
      assertZeroDDL(executedQueries);

      // Verify first query was read-only verification and second was INSERT
      expect(executedQueries[0].toLowerCase()).toContain('information_schema.tables');
      expect(executedQueries[1].toLowerCase()).toContain('insert into evaluation_runs');
    });

    it('updateRun() executes strictly UPDATE with ZERO DDL statements', async () => {
      (repo as any).isTestOrFallback = () => false;

      const updated = await repo.updateRun('test-run-id', {
        status: 'completed',
        passedCases: 5,
        overallScore: 100,
      });

      expect(updated).toBeDefined();
      assertZeroDDL(executedQueries);
      expect(executedQueries.some((q) => q.toLowerCase().includes('update evaluation_runs'))).toBe(true);
    });

    it('createCaseResults() executes strictly INSERT/TRANSACTION with ZERO DDL statements', async () => {
      (repo as any).isTestOrFallback = () => false;

      const results = await repo.createCaseResults([
        {
          runId: 'test-run-id',
          caseId: 'case_mem_1',
          dimension: 'memory',
          status: 'passed',
          score: 100,
          expected: { status: 'success' },
          actual: { status: 'success' },
        },
      ]);

      expect(results).toHaveLength(1);
      assertZeroDDL(executedQueries);
      expect(executedQueries.some((q) => q.toLowerCase().includes('insert into evaluation_case_results'))).toBe(true);
    });
  });

  describe('3. Execution Service End-to-End DDL Absence Verification', () => {
    it('running full evaluation execution performs operations with zero runtime DDL', async () => {
      (repo as any).isTestOrFallback = () => false;

      const service = new EvaluationExecutionService(repo);

      const result = await service.executeRun({
        datasetVersion: 'Phase 8.5 Golden Benchmark Dataset',
        mode: 'mock',
        caseIds: ['mem_01', 'mem_02'],
        createdBy: 'audit-admin',
      });

      expect(result.run.status).toBe('completed');
      expect(result.run.totalCases).toBe(2);

      // Verify all queries throughout the execution cycle
      assertZeroDDL(executedQueries);
    });
  });
});
