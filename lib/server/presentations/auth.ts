import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * Who may call what.
 *
 * There is no user login in the suite. Two secrets and one optional gate stand in:
 *
 * - n8n proves itself with a bearer token on the routes that update a job or build a deck.
 * - The page can be asked for an access code once per browser, when `TOOLS_ACCESS_CODE` is
 *   set. That is the cheapest way to stop a stranger from spending Claude, Pexels and Canva
 *   quota, and the only one that actually holds — the rate limit below is a deterrent.
 */

function same(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function bad(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Bearer check for routes called by n8n. Null means "allowed". */
export function requireCompileSecret(request: Request): NextResponse | null {
  const expected = process.env.PRESENTATIONS_COMPILE_SECRET;
  if (!expected) {
    return bad('PRESENTATIONS_COMPILE_SECRET is not set on the server.', 503);
  }
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !same(token, expected)) return bad('Unauthorized.', 401);
  return null;
}

/** Optional access-code gate for the browser-facing routes that start work. */
export function requireAccessCode(request: Request): NextResponse | null {
  const expected = process.env.TOOLS_ACCESS_CODE;
  if (!expected) return null;
  const given = request.headers.get('x-tools-access') ?? '';
  if (!given || !same(given, expected)) {
    return bad('An access code is needed to start a presentation.', 401, { code: 'ACCESS_CODE' });
  }
  return null;
}

const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Best-effort, per-instance rate limit. Serverless instances come and go, so this is not a
 * guarantee; it stops a runaway loop or a casual script from firing dozens of jobs a minute.
 */
export function rateLimit(
  bucket: string,
  request: Request,
  opts: { limit: number; windowMs: number },
): NextResponse | null {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return null;
  }
  entry.count += 1;
  if (entry.count > opts.limit) {
    return bad('Too many requests from this connection. Give it a minute and try again.', 429);
  }
  return null;
}
