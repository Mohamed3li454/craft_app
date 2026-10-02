import { z } from 'zod';
import { PaginationQuery } from './admin.types';

export const PaginationQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .refine((val) => !isNaN(val) && val >= 1 && val <= 100, {
      message: 'Limit must be an integer between 1 and 100',
    }),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0))
    .refine((val) => !isNaN(val) && val >= 0, {
      message: 'Offset must be a non-negative integer',
    }),
  cursor: z.string().optional(),
});

export function parsePaginationQuery(query: any): { limit: number; offset: number; cursor?: string } {
  const parsed = PaginationQuerySchema.safeParse(query);
  if (!parsed.success) {
    return { limit: 20, offset: 0 };
  }
  return {
    limit: parsed.data.limit,
    offset: parsed.data.offset !== undefined ? parsed.data.offset : 0,
    cursor: parsed.data.cursor,
  };
}

export function encodeCursor(payload: { id: string; createdAt: string }): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export function decodeCursor(cursor: string): { id?: string; createdAt?: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.createdAt || parsed.id)) {
      return parsed;
    }
  } catch {
    // If not base64 JSON, test if it's a valid date string
    const date = new Date(cursor);
    if (!isNaN(date.getTime())) {
      return { createdAt: date.toISOString() };
    }
  }
  return null;
}
