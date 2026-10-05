import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { logger } from '../../core/logger';
import { redactObject } from '../../modules/observability/redaction';

export type EvaluationRunMode = 'mock' | 'replay' | 'live';
export type EvaluationRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type EvaluationCaseStatus = 'passed' | 'failed' | 'skipped' | 'error';

export interface EvaluationRunRecord {
  id: string;
  datasetVersion: string;
  mode: EvaluationRunMode;
  status: EvaluationRunStatus;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  skippedCases: number;
  regressionCount: number;
  overallScore: number;
  durationMs: number;
  startedAt: string;
  completedAt?: string | null;
  createdBy: string;
  createdAt: string;
  metadata?: Record<string, any>;
}

export interface EvaluationCaseResultRecord {
  id: string;
  runId: string;
  caseId: string;
  dimension: string;
  status: EvaluationCaseStatus;
  score: number;
  expected: Record<string, any>;
  actual: Record<string, any>;
  failureReason?: string | null;
  regression: boolean;
  previousStatus?: string | null;
  previousScore?: number | null;
  model?: string | null;
  provider?: string | null;
  durationMs: number;
  tokens: number;
  createdAt: string;
}

export interface NewEvaluationRun {
  id?: string;
  datasetVersion?: string;
  mode?: EvaluationRunMode;
  status?: EvaluationRunStatus;
  totalCases?: number;
  passedCases?: number;
  failedCases?: number;
  skippedCases?: number;
  regressionCount?: number;
  overallScore?: number;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string | null;
  createdBy?: string;
  metadata?: Record<string, any>;
}

export interface NewEvaluationCaseResult {
  id?: string;
  runId: string;
  caseId: string;
  dimension: string;
  status: EvaluationCaseStatus;
  score: number;
  expected?: Record<string, any>;
  actual?: Record<string, any>;
  failureReason?: string | null;
  regression?: boolean;
  previousStatus?: string | null;
  previousScore?: number | null;
  model?: string | null;
  provider?: string | null;
  durationMs?: number;
  tokens?: number;
}

export class EvaluationRepository {
  private static instance: EvaluationRepository;
  private inMemoryRuns: EvaluationRunRecord[] = [];
  private inMemoryResults: EvaluationCaseResultRecord[] = [];
  private schemaEnsured = false;
  private useMemoryFallback = false;

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  public static getInstance(): EvaluationRepository {
    if (!EvaluationRepository.instance) {
      EvaluationRepository.instance = new EvaluationRepository();
    }
    return EvaluationRepository.instance;
  }

  /**
   * Resets in-memory stores (used in test teardown for isolation).
   */
  public resetInMemoryStore(): void {
    this.inMemoryRuns = [];
    this.inMemoryResults = [];
  }

  private isTestOrFallback(): boolean {
    return Boolean(
      (process.env.JEST_WORKER_ID !== undefined && process.env.ALLOW_LIVE_DB_MUTATIONS !== 'true') ||
      this.useMemoryFallback ||
      !this.db.getPool()
    );
  }

  /**
   * Verifies that the required evaluation tables exist in PostgreSQL (read-only verification).
   * STRICTLY READ-ONLY: Never executes DDL (CREATE/ALTER/DROP/TRUNCATE). If tables are absent or query fails,
   * falls back safely to in-memory storage without mutating the database schema.
   */
  public async ensureSchema(): Promise<void> {
    if (this.schemaEnsured || this.isTestOrFallback()) return;
    const pool = this.db.getPool();
    if (!pool) {
      this.schemaEnsured = true;
      return;
    }

    try {
      const res = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name IN ('evaluation_runs', 'evaluation_case_results');
      `);

      const foundTables = new Set(res.rows.map((r: any) => r.table_name));
      if (!foundTables.has('evaluation_runs') || !foundTables.has('evaluation_case_results')) {
        logger.warn('Evaluation tables missing in PostgreSQL; falling back to in-memory store. Schema must be managed via migrations.', {
          foundTables: Array.from(foundTables),
        });
        this.useMemoryFallback = true;
      }
      this.schemaEnsured = true;
    } catch (err: any) {
      logger.warn('Failed to verify evaluation schema in PostgreSQL, using memory fallback', { error: err.message });
      this.useMemoryFallback = true;
      this.schemaEnsured = true;
    }
  }

  /**
   * Creates a new evaluation run.
   */
  public async createRun(data: NewEvaluationRun): Promise<EvaluationRunRecord> {
    const id = data.id || uuidv4();
    const now = new Date().toISOString();

    const record: EvaluationRunRecord = {
      id,
      datasetVersion: data.datasetVersion || 'Phase 8.5 Golden Benchmark Dataset',
      mode: data.mode || 'mock',
      status: data.status || 'queued',
      totalCases: data.totalCases ?? 0,
      passedCases: data.passedCases ?? 0,
      failedCases: data.failedCases ?? 0,
      skippedCases: data.skippedCases ?? 0,
      regressionCount: data.regressionCount ?? 0,
      overallScore: data.overallScore ?? 0,
      durationMs: data.durationMs ?? 0,
      startedAt: data.startedAt || now,
      completedAt: data.completedAt || null,
      createdBy: data.createdBy || 'admin',
      createdAt: now,
      metadata: data.metadata || {},
    };

    if (!this.isTestOrFallback()) {
      await this.ensureSchema();
      const pool = this.db.getPool();
      if (pool) {
        try {
          const query = `
            INSERT INTO evaluation_runs (
              id, dataset_version, mode, status, total_cases, passed_cases,
              failed_cases, skipped_cases, regression_count, overall_score,
              duration_ms, started_at, completed_at, created_by, created_at,
              metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING *;
          `;
          const res = await pool.query(query, [
            record.id,
            record.datasetVersion,
            record.mode,
            record.status,
            record.totalCases,
            record.passedCases,
            record.failedCases,
            record.skippedCases,
            record.regressionCount,
            record.overallScore,
            record.durationMs,
            record.startedAt,
            record.completedAt,
            record.createdBy,
            record.createdAt,
            JSON.stringify(record.metadata || {}),
          ]);
          if (res.rows.length > 0) {
            const persisted = this.mapRunRow(res.rows[0]);
            this.inMemoryRuns.unshift(persisted);
            return persisted;
          }
        } catch (err: any) {
          logger.warn('Failed to insert evaluation run into DB, using in-memory store', { error: err.message });
          this.useMemoryFallback = true;
        }
      }
    }

    this.inMemoryRuns.unshift(record);
    return record;
  }

  /**
   * Updates an existing evaluation run.
   */
  public async updateRun(id: string, updates: Partial<EvaluationRunRecord>): Promise<EvaluationRunRecord | null> {
    if (!this.isTestOrFallback()) {
      const pool = this.db.getPool();
      if (pool) {
        try {
          const setClauses: string[] = [];
          const values: any[] = [];
          let paramIdx = 1;

          if (updates.status !== undefined) {
            setClauses.push(`status = $${paramIdx++}`);
            values.push(updates.status);
          }
          if (updates.totalCases !== undefined) {
            setClauses.push(`total_cases = $${paramIdx++}`);
            values.push(updates.totalCases);
          }
          if (updates.passedCases !== undefined) {
            setClauses.push(`passed_cases = $${paramIdx++}`);
            values.push(updates.passedCases);
          }
          if (updates.failedCases !== undefined) {
            setClauses.push(`failed_cases = $${paramIdx++}`);
            values.push(updates.failedCases);
          }
          if (updates.skippedCases !== undefined) {
            setClauses.push(`skipped_cases = $${paramIdx++}`);
            values.push(updates.skippedCases);
          }
          if (updates.regressionCount !== undefined) {
            setClauses.push(`regression_count = $${paramIdx++}`);
            values.push(updates.regressionCount);
          }
          if (updates.overallScore !== undefined) {
            setClauses.push(`overall_score = $${paramIdx++}`);
            values.push(updates.overallScore);
          }
          if (updates.durationMs !== undefined) {
            setClauses.push(`duration_ms = $${paramIdx++}`);
            values.push(updates.durationMs);
          }
          if (updates.completedAt !== undefined) {
            setClauses.push(`completed_at = $${paramIdx++}`);
            values.push(updates.completedAt);
          }
          if (updates.metadata !== undefined) {
            setClauses.push(`metadata = $${paramIdx++}`);
            values.push(JSON.stringify(updates.metadata));
          }

          if (setClauses.length > 0) {
            values.push(id);
            const query = `
              UPDATE evaluation_runs
              SET ${setClauses.join(', ')}
              WHERE id = $${paramIdx}
              RETURNING *;
            `;
            const res = await pool.query(query, values);
            if (res.rows.length > 0) {
              const updated = this.mapRunRow(res.rows[0]);
              const memIdx = this.inMemoryRuns.findIndex((r) => r.id === id);
              if (memIdx >= 0) {
                this.inMemoryRuns[memIdx] = updated;
              } else {
                this.inMemoryRuns.unshift(updated);
              }
              return updated;
            }
          }
        } catch (err: any) {
          logger.warn('Failed to update evaluation run in DB, updating in-memory store', { error: err.message });
          this.useMemoryFallback = true;
        }
      }
    }

    const idx = this.inMemoryRuns.findIndex((r) => r.id === id);
    if (idx >= 0) {
      this.inMemoryRuns[idx] = { ...this.inMemoryRuns[idx], ...updates };
      return this.inMemoryRuns[idx];
    }
    return null;
  }

  /**
   * Retrieves an evaluation run by ID.
   */
  public async getRunById(id: string): Promise<EvaluationRunRecord | null> {
    if (!this.isTestOrFallback()) {
      const pool = this.db.getPool();
      if (pool) {
        try {
          const res = await pool.query('SELECT * FROM evaluation_runs WHERE id = $1', [id]);
          if (res.rows.length > 0) {
            return this.mapRunRow(res.rows[0]);
          }
        } catch (err: any) {
          logger.warn('Failed to query evaluation run from DB, checking in-memory store', { error: err.message });
        }
      }
    }

    return this.inMemoryRuns.find((r) => r.id === id) || null;
  }

  /**
   * Lists evaluation runs with pagination and optional filtering.
   */
  public async listRuns(options?: {
    limit?: number;
    offset?: number;
    status?: string;
    mode?: string;
    datasetVersion?: string;
    triggeredBy?: string;
    startDate?: string;
    endDate?: string;
    environment?: string;
  }): Promise<{ runs: EvaluationRunRecord[]; total: number }> {
    const limit = Math.max(1, Math.min(100, options?.limit ?? 20));
    const offset = Math.max(0, options?.offset ?? 0);

    if (!this.isTestOrFallback()) {
      const pool = this.db.getPool();
      if (pool) {
        try {
          const conditions: string[] = [];
          const values: any[] = [];
          let pIdx = 1;

          if (options?.status) {
            conditions.push(`status = $${pIdx++}`);
            values.push(options.status);
          }
          if (options?.mode) {
            conditions.push(`mode = $${pIdx++}`);
            values.push(options.mode);
          }
          if (options?.datasetVersion) {
            conditions.push(`dataset_version = $${pIdx++}`);
            values.push(options.datasetVersion);
          }
          if (options?.triggeredBy) {
            conditions.push(`created_by = $${pIdx++}`);
            values.push(options.triggeredBy);
          }
          if (options?.startDate) {
            conditions.push(`created_at >= $${pIdx++}`);
            values.push(options.startDate);
          }
          if (options?.endDate) {
            conditions.push(`created_at <= $${pIdx++}`);
            values.push(options.endDate);
          }
          if (options?.environment) {
            conditions.push(`(metadata->'release'->>'environment' = $${pIdx} OR metadata->>'environment' = $${pIdx})`);
            pIdx++;
            values.push(options.environment);
          }

          const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          const countRes = await pool.query(`SELECT COUNT(*)::int as total FROM evaluation_runs ${whereClause}`, values);
          const total = countRes.rows[0]?.total || 0;

          values.push(limit);
          values.push(offset);
          const runsRes = await pool.query(
            `SELECT * FROM evaluation_runs ${whereClause} ORDER BY created_at DESC LIMIT $${pIdx++} OFFSET $${pIdx}`,
            values
          );

          return {
            runs: runsRes.rows.map(this.mapRunRow),
            total,
          };
        } catch (err: any) {
          logger.warn('Failed to list evaluation runs from DB, falling back to memory', { error: err.message });
          this.useMemoryFallback = true;
        }
      }
    }

    let filtered = [...this.inMemoryRuns];
    if (options?.status) {
      filtered = filtered.filter((r) => r.status === options.status);
    }
    if (options?.mode) {
      filtered = filtered.filter((r) => r.mode === options.mode);
    }
    if (options?.datasetVersion) {
      filtered = filtered.filter((r) => r.datasetVersion === options.datasetVersion);
    }
    if (options?.triggeredBy) {
      filtered = filtered.filter((r) => r.createdBy.toLowerCase().includes(options.triggeredBy!.toLowerCase()));
    }
    if (options?.startDate) {
      const startMs = new Date(options.startDate).getTime();
      filtered = filtered.filter((r) => new Date(r.createdAt).getTime() >= startMs);
    }
    if (options?.endDate) {
      const endMs = new Date(options.endDate).getTime();
      filtered = filtered.filter((r) => new Date(r.createdAt).getTime() <= endMs);
    }
    if (options?.environment) {
      filtered = filtered.filter((r) => {
        const env = r.metadata?.release?.environment || r.metadata?.environment;
        return typeof env === 'string' && env.toLowerCase() === options.environment!.toLowerCase();
      });
    }

    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = filtered.length;
    const runs = filtered.slice(offset, offset + limit);

    return { runs, total };
  }

  /**
   * Retrieves operational signals for dashboard KPI strip.
   */
  public async getOperationalSignals(): Promise<{
    lastEvaluation: EvaluationRunRecord | null;
    lastSuccessfulEvaluation: EvaluationRunRecord | null;
    lastFailedEvaluation: EvaluationRunRecord | null;
    lastRegression: (EvaluationCaseResultRecord & { runDate?: string }) | null;
  }> {
    if (!this.isTestOrFallback()) {
      const pool = this.db.getPool();
      if (pool) {
        try {
          const [lastEvalRes, lastSuccessRes, lastFailedRes, lastRegRes] = await Promise.all([
            pool.query('SELECT * FROM evaluation_runs ORDER BY created_at DESC LIMIT 1'),
            pool.query("SELECT * FROM evaluation_runs WHERE status = 'completed' AND failed_cases = 0 ORDER BY completed_at DESC, created_at DESC LIMIT 1"),
            pool.query("SELECT * FROM evaluation_runs WHERE status = 'failed' OR (status = 'completed' AND failed_cases > 0) ORDER BY created_at DESC LIMIT 1"),
            pool.query(`
              SELECT r.*, run.created_at as run_created_at
              FROM evaluation_case_results r
              JOIN evaluation_runs run ON r.run_id = run.id
              WHERE r.regression = true
              ORDER BY r.created_at DESC
              LIMIT 1
            `),
          ]);

          const lastEval = lastEvalRes.rows.length > 0 ? this.mapRunRow(lastEvalRes.rows[0]) : null;
          let lastSuccess = lastSuccessRes.rows.length > 0 ? this.mapRunRow(lastSuccessRes.rows[0]) : null;

          // If no run with 0 failures found, fallback to completed with overallScore >= 80
          if (!lastSuccess) {
            const fallbackSuccessRes = await pool.query(
              "SELECT * FROM evaluation_runs WHERE status = 'completed' AND overall_score >= 80 ORDER BY completed_at DESC, created_at DESC LIMIT 1"
            );
            if (fallbackSuccessRes.rows.length > 0) {
              lastSuccess = this.mapRunRow(fallbackSuccessRes.rows[0]);
            }
          }

          const lastFailed = lastFailedRes.rows.length > 0 ? this.mapRunRow(lastFailedRes.rows[0]) : null;
          const lastRegression = lastRegRes.rows.length > 0
            ? { ...this.mapCaseResultRow(lastRegRes.rows[0]), runDate: lastRegRes.rows[0].run_created_at }
            : null;

          return {
            lastEvaluation: lastEval,
            lastSuccessfulEvaluation: lastSuccess,
            lastFailedEvaluation: lastFailed,
            lastRegression,
          };
        } catch (err: any) {
          logger.warn('Failed to query operational signals from DB, using in-memory store', { error: err.message });
          this.useMemoryFallback = true;
        }
      }
    }

    const sortedRuns = [...this.inMemoryRuns].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const lastEval = sortedRuns.length > 0 ? sortedRuns[0] : null;

    let lastSuccess = sortedRuns.find((r) => r.status === 'completed' && r.failedCases === 0) || null;
    if (!lastSuccess) {
      lastSuccess = sortedRuns.find((r) => r.status === 'completed' && r.overallScore >= 80) || null;
    }

    const lastFailed = sortedRuns.find(
      (r) => r.status === 'failed' || (r.status === 'completed' && r.failedCases > 0)
    ) || null;

    const regressedResults = [...this.inMemoryResults]
      .filter((r) => r.regression)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    let lastRegression = null;
    if (regressedResults.length > 0) {
      const topReg = regressedResults[0];
      const run = this.inMemoryRuns.find((rn) => rn.id === topReg.runId);
      lastRegression = {
        ...topReg,
        runDate: run?.createdAt,
      };
    }

    return {
      lastEvaluation: lastEval,
      lastSuccessfulEvaluation: lastSuccess,
      lastFailedEvaluation: lastFailed,
      lastRegression,
    };
  }

  /**
   * Gets the latest completed run for baseline comparison.
   */
  public async getLatestCompletedRun(datasetVersion?: string): Promise<EvaluationRunRecord | null> {
    if (!this.isTestOrFallback()) {
      const pool = this.db.getPool();
      if (pool) {
        try {
          let query = `
            SELECT * FROM evaluation_runs
            WHERE status = 'completed'
          `;
          const values: any[] = [];
          if (datasetVersion) {
            query += ` AND dataset_version = $1`;
            values.push(datasetVersion);
          }
          query += ` ORDER BY completed_at DESC, created_at DESC LIMIT 1`;

          const res = await pool.query(query, values);
          if (res.rows.length > 0) {
            return this.mapRunRow(res.rows[0]);
          }
        } catch (err: any) {
          logger.warn('Failed to get latest completed run from DB, checking in-memory store', { error: err.message });
        }
      }
    }

    const matches = this.inMemoryRuns.filter(
      (r) => r.status === 'completed' && (!datasetVersion || r.datasetVersion === datasetVersion)
    );
    matches.sort(
      (a, b) =>
        new Date(b.completedAt || b.createdAt).getTime() - new Date(a.completedAt || a.createdAt).getTime()
    );
    return matches[0] || null;
  }

  /**
   * Persists case results in batch.
   */
  public async createCaseResults(results: NewEvaluationCaseResult[]): Promise<EvaluationCaseResultRecord[]> {
    if (results.length === 0) return [];
    const now = new Date().toISOString();
    const records: EvaluationCaseResultRecord[] = results.map((r) => ({
      id: r.id || uuidv4(),
      runId: r.runId,
      caseId: r.caseId,
      dimension: r.dimension,
      status: r.status,
      score: r.score,
      expected: redactObject(r.expected || {}),
      actual: redactObject(r.actual || {}),
      failureReason: r.failureReason || null,
      regression: Boolean(r.regression),
      previousStatus: r.previousStatus || null,
      previousScore: r.previousScore !== undefined ? r.previousScore : null,
      model: r.model || null,
      provider: r.provider || null,
      durationMs: r.durationMs ?? 0,
      tokens: r.tokens ?? 0,
      createdAt: now,
    }));

    if (!this.isTestOrFallback()) {
      await this.ensureSchema();
      const pool = this.db.getPool();
      if (pool) {
        try {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            for (const item of records) {
              await client.query(
                `INSERT INTO evaluation_case_results (
                  id, run_id, case_id, dimension, status, score, expected, actual,
                  failure_reason, regression, previous_status, previous_score,
                  model, provider, duration_ms, tokens, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
                [
                  item.id,
                  item.runId,
                  item.caseId,
                  item.dimension,
                  item.status,
                  item.score,
                  JSON.stringify(item.expected),
                  JSON.stringify(item.actual),
                  item.failureReason,
                  item.regression,
                  item.previousStatus,
                  item.previousScore,
                  item.model,
                  item.provider,
                  item.durationMs,
                  item.tokens,
                  item.createdAt,
                ]
              );
            }
            await client.query('COMMIT');
          } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
          } finally {
            client.release();
          }

          this.inMemoryResults.push(...records);
          return records;
        } catch (err: any) {
          logger.warn('Failed to insert case results into DB, using in-memory store', { error: err.message });
          this.useMemoryFallback = true;
        }
      }
    }

    this.inMemoryResults.push(...records);
    return records;
  }

  /**
   * Retrieves case results for a specific run.
   */
  public async getCaseResultsByRunId(
    runId: string,
    filter?: {
      dimension?: string;
      status?: string;
      regressionOnly?: boolean;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ results: EvaluationCaseResultRecord[]; total: number }> {
    const limit = Math.max(1, Math.min(200, filter?.limit ?? 100));
    const offset = Math.max(0, filter?.offset ?? 0);

    if (!this.isTestOrFallback()) {
      const pool = this.db.getPool();
      if (pool) {
        try {
          const conditions: string[] = ['run_id = $1'];
          const values: any[] = [runId];
          let pIdx = 2;

          if (filter?.dimension) {
            conditions.push(`dimension = $${pIdx++}`);
            values.push(filter.dimension);
          }
          if (filter?.status) {
            conditions.push(`status = $${pIdx++}`);
            values.push(filter.status);
          }
          if (filter?.regressionOnly) {
            conditions.push(`regression = true`);
          }

          const whereClause = `WHERE ${conditions.join(' AND ')}`;
          const countRes = await pool.query(
            `SELECT COUNT(*)::int as total FROM evaluation_case_results ${whereClause}`,
            values
          );
          const total = countRes.rows[0]?.total || 0;

          values.push(limit);
          values.push(offset);
          const res = await pool.query(
            `SELECT * FROM evaluation_case_results ${whereClause} ORDER BY created_at ASC LIMIT $${pIdx++} OFFSET $${pIdx}`,
            values
          );

          return {
            results: res.rows.map(this.mapCaseResultRow),
            total,
          };
        } catch (err: any) {
          logger.warn('Failed to get case results from DB, checking in-memory store', { error: err.message });
          this.useMemoryFallback = true;
        }
      }
    }

    let list = this.inMemoryResults.filter((r) => r.runId === runId);
    if (filter?.dimension) {
      list = list.filter((r) => r.dimension === filter.dimension);
    }
    if (filter?.status) {
      list = list.filter((r) => r.status === filter.status);
    }
    if (filter?.regressionOnly) {
      list = list.filter((r) => r.regression === true);
    }

    const total = list.length;
    const results = list.slice(offset, offset + limit);
    return { results, total };
  }

  /**
   * Retrieves active regressions from the latest completed run or across recent runs.
   */
  public async getActiveRegressions(
    limit = 50,
    offset = 0
  ): Promise<{
    regressions: (EvaluationCaseResultRecord & { runDate?: string; mode?: string })[];
    total: number;
  }> {
    if (!this.isTestOrFallback()) {
      const pool = this.db.getPool();
      if (pool) {
        try {
          const query = `
            SELECT r.*, run.created_at as run_created_at, run.mode as run_mode
            FROM evaluation_case_results r
            JOIN evaluation_runs run ON r.run_id = run.id
            WHERE r.regression = true
            ORDER BY r.created_at DESC
            LIMIT $1 OFFSET $2;
          `;
          const countQuery = `
            SELECT COUNT(*)::int as total
            FROM evaluation_case_results
            WHERE regression = true;
          `;

          const [dataRes, countRes] = await Promise.all([
            pool.query(query, [limit, offset]),
            pool.query(countQuery),
          ]);

          const regressions = dataRes.rows.map((row) => ({
            ...this.mapCaseResultRow(row),
            runDate: row.run_created_at,
            mode: row.run_mode,
          }));

          return {
            regressions,
            total: countRes.rows[0]?.total || 0,
          };
        } catch (err: any) {
          logger.warn('Failed to get active regressions from DB, falling back to memory', { error: err.message });
          this.useMemoryFallback = true;
        }
      }
    }

    const regressionsList = this.inMemoryResults
      .filter((r) => r.regression)
      .map((r) => {
        const run = this.inMemoryRuns.find((run) => run.id === r.runId);
        return {
          ...r,
          runDate: run?.createdAt,
          mode: run?.mode,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = regressionsList.length;
    return {
      regressions: regressionsList.slice(offset, offset + limit),
      total,
    };
  }

  /**
   * Retrieves historical results for a specific case across runs.
   */
  public async getCaseHistory(
    caseId: string,
    limit = 20
  ): Promise<{ history: (EvaluationCaseResultRecord & { runMode?: string; runStartedAt?: string })[]; total: number }> {
    const boundLimit = Math.max(1, Math.min(100, limit));

    if (!this.isTestOrFallback()) {
      const pool = this.db.getPool();
      if (pool) {
        try {
          const query = `
            SELECT r.*, run.mode as run_mode, run.started_at as run_started_at
            FROM evaluation_case_results r
            JOIN evaluation_runs run ON r.run_id = run.id
            WHERE r.case_id = $1
            ORDER BY r.created_at DESC
            LIMIT $2;
          `;
          const countQuery = `
            SELECT COUNT(*)::int as total
            FROM evaluation_case_results
            WHERE case_id = $1;
          `;

          const [dataRes, countRes] = await Promise.all([
            pool.query(query, [caseId, boundLimit]),
            pool.query(countQuery, [caseId]),
          ]);

          const history = dataRes.rows.map((row) => ({
            ...this.mapCaseResultRow(row),
            runMode: row.run_mode,
            runStartedAt: row.run_started_at,
          }));

          return {
            history,
            total: countRes.rows[0]?.total || 0,
          };
        } catch (err: any) {
          logger.warn('Failed to get case history from DB, falling back to memory', { error: err.message });
          this.useMemoryFallback = true;
        }
      }
    }

    const matches = this.inMemoryResults
      .filter((r) => r.caseId === caseId)
      .map((r) => {
        const run = this.inMemoryRuns.find((run) => run.id === r.runId);
        return {
          ...r,
          runMode: run?.mode,
          runStartedAt: run?.startedAt,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      history: matches.slice(0, boundLimit),
      total: matches.length,
    };
  }

  /**
   * Retrieves recent case results for analytical calculations.
   */
  public async getRecentCaseResults(limit = 500): Promise<EvaluationCaseResultRecord[]> {
    const boundLimit = Math.max(1, Math.min(2000, limit));

    if (!this.isTestOrFallback()) {
      const pool = this.db.getPool();
      if (pool) {
        try {
          const query = `
            SELECT * FROM evaluation_case_results
            ORDER BY created_at DESC
            LIMIT $1;
          `;
          const res = await pool.query(query, [boundLimit]);
          return res.rows.map(this.mapCaseResultRow);
        } catch (err: any) {
          logger.warn('Failed to get recent case results from DB, checking in-memory store', { error: err.message });
          this.useMemoryFallback = true;
        }
      }
    }

    return [...this.inMemoryResults]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, boundLimit);
  }

  // Row mappers
  private mapRunRow(row: any): EvaluationRunRecord {
    return {
      id: row.id,
      datasetVersion: row.dataset_version,
      mode: row.mode,
      status: row.status,
      totalCases: Number(row.total_cases),
      passedCases: Number(row.passed_cases),
      failedCases: Number(row.failed_cases),
      skippedCases: Number(row.skipped_cases),
      regressionCount: Number(row.regression_count),
      overallScore: Number(row.overall_score),
      durationMs: Number(row.duration_ms),
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : new Date().toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      createdBy: row.created_by,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
    };
  }

  private mapCaseResultRow(row: any): EvaluationCaseResultRecord {
    return {
      id: row.id,
      runId: row.run_id,
      caseId: row.case_id,
      dimension: row.dimension,
      status: row.status,
      score: Number(row.score),
      expected: typeof row.expected === 'string' ? JSON.parse(row.expected) : row.expected || {},
      actual: typeof row.actual === 'string' ? JSON.parse(row.actual) : row.actual || {},
      failureReason: row.failure_reason,
      regression: Boolean(row.regression),
      previousStatus: row.previous_status,
      previousScore: row.previous_score !== null && row.previous_score !== undefined ? Number(row.previous_score) : null,
      model: row.model,
      provider: row.provider,
      durationMs: Number(row.duration_ms),
      tokens: Number(row.tokens),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    };
  }
}
