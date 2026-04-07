import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';

export function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

export function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

export const MAX_LIMIT = 200;

export function clampLimit(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(n, MAX_LIMIT);
}

export function clampOffset(raw: string | null): number {
  if (raw == null) return 0;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

export async function parseBody<T>(req: IncomingMessage, res: ServerResponse, schema: z.ZodType<T>): Promise<T | null> {
  let raw: string;
  try { raw = await readBody(req); } catch { return json(res, { error: 'Failed to read body' }, 400), null; }
  if (!raw) return json(res, { error: 'Missing request body' }, 400), null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return json(res, { error: 'Invalid JSON' }, 400), null; }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    return json(res, { error: 'Validation failed', issues }, 400), null;
  }
  return result.data;
}

export async function parseOptionalBody<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  try {
    const raw = await readBody(req);
    if (!raw) return schema.parse({});
    return schema.parse(JSON.parse(raw));
  } catch { return schema.parse({}); }
}

export function parseUrl(req: IncomingMessage): { pathname: string; params: URLSearchParams } {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  return { pathname: url.pathname, params: url.searchParams };
}

// --- POST body schemas ---
export const BulkSuggestionSchema = z.object({
  action: z.enum(['accept', 'dismiss', 'snooze']),
  ids: z.array(z.string()).min(1),
  category: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
  hours: z.number().positive().optional(),
});
export const OptionalCategorySchema = z.object({ category: z.string().max(100).optional() });
export const DismissCategorySchema = z.object({ note: z.string().max(500).optional(), category: z.string().max(100).optional() });
export const SnoozeSchema = z.object({ hours: z.number().min(0).default(72) });
export const OptionalNoteSchema = z.object({ note: z.string().max(500).optional() });
export const FocusSchema = z.object({ mode: z.string(), duration: z.string().optional() });
export const FeedbackSchema = z.object({ targetKind: z.string().min(1), targetId: z.string().min(1), action: z.string().min(1), note: z.string().max(500).optional() });
export const CorrectionSchema = z.object({ body: z.string().min(1), scope: z.string().min(1), title: z.string().max(200).optional(), entityType: z.enum(['repo', 'project', 'system']).optional(), entityId: z.string().optional() });
export const DigestTriggerSchema = z.object({ periodStart: z.string().optional() });
