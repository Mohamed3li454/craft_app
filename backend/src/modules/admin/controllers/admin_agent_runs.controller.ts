import { Request, Response } from 'express';
import { DatabaseManager } from '../../../database/connection';
import { sendAdminSuccess, sendAdminError, getCorrelationId } from '../admin.types';
import { parsePaginationQuery } from '../pagination';
import { sanitizeMetadata } from '../audit/admin_audit.service';
import { logger } from '../../../core/logger';

export interface AgentRunListItem {
  id: string;
  conversationId: string;
  status: string;
  userPrompt: string;
  iterationsCount: number;
  durationMs?: number;
  createdAt: string;
  completedAt?: string;
  errorDetails?: string;
}

export class AdminAgentRunsController {
  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  public getAgentRuns = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, offset } = parsePaginationQuery(req.query);
      const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId.trim() : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;
      const startDate = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : undefined;
      const endDate = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : undefined;

      const pool = this.db.getPool();
      if (!pool) {
        sendAdminSuccess(res, [], { nextCursor: null, total: 0 });
        return;
      }

      const whereClauses: string[] = ['1=1'];
      const params: any[] = [];
      let pIdx = 1;

      if (conversationId) {
        whereClauses.push(`r.conversation_id::text = $${pIdx}`);
        params.push(conversationId);
        pIdx++;
      }
      if (status) {
        whereClauses.push(`r.status = $${pIdx}`);
        params.push(status);
        pIdx++;
      }
      if (startDate) {
        whereClauses.push(`r.created_at >= $${pIdx}::timestamptz`);
        params.push(startDate);
        pIdx++;
      }
      if (endDate) {
        whereClauses.push(`r.created_at <= $${pIdx}::timestamptz`);
        params.push(endDate);
        pIdx++;
      }

      const whereSql = whereClauses.join(' AND ');

      const countRes = await pool.query(
        `SELECT COUNT(*) as total FROM agent_runs r WHERE ${whereSql}`,
        params
      );
      const total = parseInt(countRes.rows[0]?.total || '0', 10);

      const listQuery = `
        SELECT 
          r.id,
          r.conversation_id as "conversationId",
          r.status,
          r.user_prompt as "userPrompt",
          r.iterations_count as "iterationsCount",
          r.error_details as "errorDetails",
          r.created_at as "createdAt",
          r.completed_at as "completedAt",
          ROUND(EXTRACT(EPOCH FROM (COALESCE(r.completed_at, NOW()) - r.created_at)) * 1000) as "durationMs"
        FROM agent_runs r
        WHERE ${whereSql}
        ORDER BY r.created_at DESC
        LIMIT $${pIdx} OFFSET $${pIdx + 1}
      `;
      params.push(limit, offset);

      const listRes = await pool.query(listQuery, params);

      // Sanitize items (explicitly redact any secrets or potential reasoning leakage)
      const sanitizedRuns = listRes.rows.map((r: any) => ({
        id: r.id,
        conversationId: r.conversationId,
        status: r.status,
        userPrompt: r.userPrompt,
        iterationsCount: r.iterationsCount || 0,
        durationMs: r.durationMs ? Math.max(0, parseInt(r.durationMs, 10)) : 0,
        errorDetails: r.errorDetails || undefined,
        createdAt: new Date(r.createdAt).toISOString(),
        completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : undefined,
      }));

      sendAdminSuccess(res, sanitizedRuns, { nextCursor: null, total });
    } catch (err: any) {
      logger.error('[Admin Agent Runs] Failed to list agent runs', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve agent runs');
    }
  };

  public getAgentRunDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const runId = req.params.id;
      if (!runId || runId.trim().length === 0) {
        sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Agent Run ID is required');
        return;
      }

      const pool = this.db.getPool();
      if (!pool) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Agent run not found');
        return;
      }

      const runQuery = `
        SELECT 
          r.id,
          r.conversation_id as "conversationId",
          r.status,
          r.user_prompt as "userPrompt",
          r.iterations_count as "iterationsCount",
          r.error_details as "errorDetails",
          r.created_at as "createdAt",
          r.completed_at as "completedAt",
          ROUND(EXTRACT(EPOCH FROM (COALESCE(r.completed_at, NOW()) - r.created_at)) * 1000) as "durationMs"
        FROM agent_runs r
        WHERE r.id::text = $1
        LIMIT 1
      `;
      const runRes = await pool.query(runQuery, [runId]);
      if (runRes.rows.length === 0) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Agent run not found');
        return;
      }

      const r = runRes.rows[0];

      // Fetch child tool calls
      const toolsQuery = `
        SELECT 
          t.id,
          t.tool_name as "toolName",
          t.arguments,
          t.status,
          t.result,
          t.error_message as "errorMessage",
          t.created_at as "createdAt",
          t.completed_at as "completedAt",
          ROUND(EXTRACT(EPOCH FROM (COALESCE(t.completed_at, NOW()) - t.created_at)) * 1000) as "durationMs"
        FROM tool_calls t
        WHERE t.agent_run_id::text = $1
        ORDER BY t.created_at ASC
      `;
      const toolsRes = await pool.query(toolsQuery, [runId]);

      // STRICT OBSERVABILITY SANITIZATION:
      // Strip any internal reasoning or chain-of-thought from tool inputs/outputs
      const sanitizedTools = toolsRes.rows.map((t: any) => {
        const rawArgs = typeof t.arguments === 'string' ? JSON.parse(t.arguments || '{}') : (t.arguments || {});
        const rawResult = typeof t.result === 'string' ? JSON.parse(t.result || '{}') : (t.result || {});

        const sanitizedArgs = sanitizeMetadata(rawArgs);
        const sanitizedResult = sanitizeMetadata(rawResult);

        // Explicitly delete any reasoning properties
        delete sanitizedArgs.reasoning;
        delete sanitizedArgs.thought;
        delete sanitizedArgs.internal_reasoning;
        delete sanitizedResult.reasoning;
        delete sanitizedResult.thought;
        delete sanitizedResult.internal_reasoning;

        return {
          id: t.id,
          toolName: t.toolName,
          arguments: sanitizedArgs,
          status: t.status,
          result: sanitizedResult,
          errorMessage: t.errorMessage || undefined,
          durationMs: t.durationMs ? Math.max(0, parseInt(t.durationMs, 10)) : 0,
          createdAt: new Date(t.createdAt).toISOString(),
          completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : undefined,
        };
      });

      sendAdminSuccess(res, {
        id: r.id,
        conversationId: r.conversationId,
        status: r.status,
        userPrompt: r.userPrompt,
        iterationsCount: r.iterationsCount || 0,
        durationMs: r.durationMs ? Math.max(0, parseInt(r.durationMs, 10)) : 0,
        errorDetails: r.errorDetails || undefined,
        createdAt: new Date(r.createdAt).toISOString(),
        completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : undefined,
        toolCalls: sanitizedTools,
      });
    } catch (err: any) {
      logger.error('[Admin Agent Runs] Failed to get agent run details', { error: err.message, runId: req.params.id });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve agent run details');
    }
  };
}
