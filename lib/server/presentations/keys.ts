import { randomBytes } from 'node:crypto';
import { JOB_ID_RE } from '@/lib/presentations/types';

/**
 * Where a job's files live in the bucket.
 *
 * Every key derives from the job id and a fixed name — never from anything a user typed —
 * so there is no path to sanitise and no way for one job to reach into another's folder.
 * The id itself starts with a UTC timestamp so a plain listing of the prefix comes back in
 * chronological order without reading a single record.
 */

export const PRESENTATIONS_PREFIX = 'presentations/jobs/';

export function newJobId(now = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

export function isJobId(value: unknown): value is string {
  return typeof value === 'string' && JOB_ID_RE.test(value);
}

export const jobPrefix = (id: string) => `${PRESENTATIONS_PREFIX}${id}/`;
export const jobKey = (id: string) => `${jobPrefix(id)}job.json`;
export const pdfKey = (id: string) => `${jobPrefix(id)}source.pdf`;
export const textKey = (id: string) => `${jobPrefix(id)}text.txt`;
export const manifestKey = (id: string) => `${jobPrefix(id)}manifest.json`;
export const pptxKey = (id: string, slug: string) => `${jobPrefix(id)}${slug}.pptx`;
