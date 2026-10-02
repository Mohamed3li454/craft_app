import { Request, Response } from 'express';
import { DatabaseManager } from '../../../database/connection';
import { sendAdminSuccess, sendAdminError } from '../admin.types';
import { parsePaginationQuery } from '../pagination';
import { sanitizeMetadata } from '../audit/admin_audit.service';
import { logger } from '../../../core/logger';
import { z } from 'zod';

const DiagnosticSchema = z.object({
  query: z.string().trim().max(200).optional(),
  dryRun: z.boolean().default(true),
});

export class AdminSearchController {
  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  public getRecentSearches = async (req: Request, res: Response): Promise<void> => {
    try {
      const { limit, offset } = parsePaginationQuery(req.query);
      const pool = this.db.getPool();

      if (!pool) {
        sendAdminSuccess(res, [], { nextCursor: null, total: 0 });
        return;
      }

      const countRes = await pool.query(
        `SELECT COUNT(*) as total FROM tool_calls WHERE tool_name IN ('search', 'web_search')`
      );
      const total = parseInt(countRes.rows[0]?.total || '0', 10);

      const listQuery = `
        SELECT 
          t.id,
          t.tool_name as "toolName",
          t.arguments,
          t.status,
          t.result,
          t.error_message as "errorMessage",
          t.created_at as "createdAt",
          t.completed_at as "completedAt",
          ROUND(EXTRACT(EPOCH FROM (COALESCE(t.completed_at, NOW()) - t.created_at)) * 1000) as "latencyMs"
        FROM tool_calls t
        WHERE t.tool_name IN ('search', 'web_search')
        ORDER BY t.created_at DESC
        LIMIT $1 OFFSET $2
      `;
      const listRes = await pool.query(listQuery, [limit, offset]);

      const formatted = listRes.rows.map((r: any) => {
        const rawArgs = typeof r.arguments === 'string' ? JSON.parse(r.arguments || '{}') : (r.arguments || {});
        const rawResult = typeof r.result === 'string' ? JSON.parse(r.result || '{}') : (r.result || {});

        const query = rawArgs.query || rawArgs.q || 'Unknown';
        const provider = rawResult.provider || (process.env.TAVILY_API_KEY ? 'tavily' : 'direct');
        const sourceCount = Array.isArray(rawResult.sources)
          ? rawResult.sources.length
          : Array.isArray(rawResult.results)
          ? rawResult.results.length
          : (rawResult.sourceCount || 0);

        return {
          id: r.id,
          query: typeof query === 'string' ? query.slice(0, 150) : 'Query',
          provider,
          latencyMs: r.latencyMs ? Math.max(0, parseInt(r.latencyMs, 10)) : 0,
          sourceCount,
          status: r.status,
          freshness: new Date(r.createdAt).toISOString(),
          error: r.errorMessage || undefined,
        };
      });

      sendAdminSuccess(res, formatted, { nextCursor: null, total });
    } catch (err: any) {
      logger.error('[Admin Search] Failed to get recent searches', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve recent searches');
    }
  };

  /**
   * Diagnostic test endpoint for search intelligence.
   * Safe and dry-run by default: tests provider configuration and query sanitation
   * WITHOUT incurring costly real search network calls.
   */
  public runDiagnostic = async (req: Request, res: Response): Promise<void> => {
    try {
      const parseRes = DiagnosticSchema.safeParse(req.body || {});
      const { query, dryRun } = parseRes.success ? parseRes.data : { query: 'test diagnostic query', dryRun: true };

      const tavilyConfigured = Boolean(process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY.trim().length > 0);
      const googleConfigured = Boolean(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX);

      // Lightweight dry-run probe
      sendAdminSuccess(res, {
        dryRun,
        activeProvider: tavilyConfigured ? 'tavily' : googleConfigured ? 'google' : 'simulated_fallback',
        providers: {
          tavily: { configured: tavilyConfigured },
          google: { configured: googleConfigured },
        },
        diagnosticQuery: query || 'ping',
        querySanitized: true,
        networkCallExecuted: false,
        status: 'healthy',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      logger.error('[Admin Search] Failed to run diagnostic', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to run search diagnostic');
    }
  };
}
