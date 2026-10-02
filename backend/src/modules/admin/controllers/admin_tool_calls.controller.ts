import { Request, Response } from 'express';
import { DatabaseManager } from '../../../database/connection';
import { sendAdminSuccess, sendAdminError, getCorrelationId } from '../admin.types';
import { parsePaginationQuery } from '../pagination';
import { sanitizeMetadata } from '../audit/admin_audit.service';
import { logger } from '../../../core/logger';

export class AdminToolCallsController {
  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  public getToolCalls = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, offset } = parsePaginationQuery(req.query);
      const toolName = typeof req.query.toolName === 'string' ? req.query.toolName.trim() : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;
      const agentRunId = typeof req.query.agentRunId === 'string' ? req.query.agentRunId.trim() : undefined;
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

      if (toolName) {
        whereClauses.push(`t.tool_name = $${pIdx}`);
        params.push(toolName);
        pIdx++;
      }
      if (status) {
        whereClauses.push(`t.status = $${pIdx}`);
        params.push(status);
        pIdx++;
      }
      if (agentRunId) {
        whereClauses.push(`t.agent_run_id::text = $${pIdx}`);
        params.push(agentRunId);
        pIdx++;
      }
      if (startDate) {
        whereClauses.push(`t.created_at >= $${pIdx}::timestamptz`);
        params.push(startDate);
        pIdx++;
      }
      if (endDate) {
        whereClauses.push(`t.created_at <= $${pIdx}::timestamptz`);
        params.push(endDate);
        pIdx++;
      }

      const whereSql = whereClauses.join(' AND ');

      const countRes = await pool.query(
        `SELECT COUNT(*) as total FROM tool_calls t WHERE ${whereSql}`,
        params
      );
      const total = parseInt(countRes.rows[0]?.total || '0', 10);

      const listQuery = `
        SELECT 
          t.id,
          t.agent_run_id as "agentRunId",
          t.tool_name as "toolName",
          t.arguments,
          t.status,
          t.result,
          t.error_message as "errorMessage",
          t.created_at as "createdAt",
          t.completed_at as "completedAt",
          ROUND(EXTRACT(EPOCH FROM (COALESCE(t.completed_at, NOW()) - t.created_at)) * 1000) as "durationMs"
        FROM tool_calls t
        WHERE ${whereSql}
        ORDER BY t.created_at DESC
        LIMIT $${pIdx} OFFSET $${pIdx + 1}
      `;
      params.push(limit, offset);

      const listRes = await pool.query(listQuery, params);

      const sanitizedTools = listRes.rows.map((t: any) => {
        const rawArgs = typeof t.arguments === 'string' ? JSON.parse(t.arguments || '{}') : (t.arguments || {});
        const rawResult = typeof t.result === 'string' ? JSON.parse(t.result || '{}') : (t.result || {});

        const sanitizedArgs = sanitizeMetadata(rawArgs);
        const sanitizedResult = sanitizeMetadata(rawResult);

        delete sanitizedArgs.reasoning;
        delete sanitizedArgs.thought;
        delete sanitizedResult.reasoning;
        delete sanitizedResult.thought;

        return {
          id: t.id,
          runId: t.agentRunId,
          agentRunId: t.agentRunId,
          toolName: t.toolName,
          arguments: sanitizedArgs,
          argumentsSanitized: sanitizedArgs,
          status: t.status,
          result: sanitizedResult,
          resultSanitized: sanitizedResult,
          errorMessage: t.errorMessage || undefined,
          durationMs: t.durationMs ? Math.max(0, parseInt(t.durationMs, 10)) : 0,
          createdAt: new Date(t.createdAt).toISOString(),
          completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : undefined,
        };
      });

      sendAdminSuccess(res, sanitizedTools, { nextCursor: null, total });
    } catch (err: any) {
      logger.error('[Admin Tool Calls] Failed to list tool calls', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve tool calls');
    }
  };

  public getToolCallDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const toolId = req.params.id;
      if (!toolId || toolId.trim().length === 0) {
        sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Tool Call ID is required');
        return;
      }

      const pool = this.db.getPool();
      if (!pool) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Tool call not found');
        return;
      }

      const toolQuery = `
        SELECT 
          t.id,
          t.agent_run_id as "agentRunId",
          t.tool_name as "toolName",
          t.arguments,
          t.status,
          t.result,
          t.error_message as "errorMessage",
          t.created_at as "createdAt",
          t.completed_at as "completedAt",
          ROUND(EXTRACT(EPOCH FROM (COALESCE(t.completed_at, NOW()) - t.created_at)) * 1000) as "durationMs"
        FROM tool_calls t
        WHERE t.id::text = $1
        LIMIT 1
      `;
      const toolRes = await pool.query(toolQuery, [toolId]);
      if (toolRes.rows.length === 0) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'Tool call not found');
        return;
      }

      const t = toolRes.rows[0];
      const rawArgs = typeof t.arguments === 'string' ? JSON.parse(t.arguments || '{}') : (t.arguments || {});
      const rawResult = typeof t.result === 'string' ? JSON.parse(t.result || '{}') : (t.result || {});

      const sanitizedArgs = sanitizeMetadata(rawArgs);
      const sanitizedResult = sanitizeMetadata(rawResult);

      delete sanitizedArgs.reasoning;
      delete sanitizedArgs.thought;
      delete sanitizedResult.reasoning;
      delete sanitizedResult.thought;

      sendAdminSuccess(res, {
        id: t.id,
        runId: t.agentRunId,
        agentRunId: t.agentRunId,
        toolName: t.toolName,
        arguments: sanitizedArgs,
        argumentsSanitized: sanitizedArgs,
        status: t.status,
        result: sanitizedResult,
        resultSanitized: sanitizedResult,
        errorMessage: t.errorMessage || undefined,
        durationMs: t.durationMs ? Math.max(0, parseInt(t.durationMs, 10)) : 0,
        createdAt: new Date(t.createdAt).toISOString(),
        completedAt: t.completedAt ? new Date(t.completedAt).toISOString() : undefined,
      });
    } catch (err: any) {
      logger.error('[Admin Tool Calls] Failed to get tool call details', { error: err.message, toolId: req.params.id });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve tool call details');
    }
  };
}
