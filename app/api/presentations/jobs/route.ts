import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  LIMITS,
  type CreateJobResponse,
  type JobInput,
  type JobListResponse,
} from '@/lib/presentations/types';
import { bad, rateLimit, requireAccessCode } from '@/lib/server/presentations/auth';
import {
  createJob,
  getN8nEnv,
  listJobs,
  notifyN8n,
  readJob,
  readJobText,
} from '@/lib/server/presentations/jobs';
import { isJobId, newJobId, pdfKey } from '@/lib/server/presentations/keys';
import { getR2Config, headObject, publicUrlFor, R2_ENV_NAMES } from '@/lib/server/r2';

/**
 * Create a job (POST) or list recent ones (GET).
 *
 * Creating a job is the moment money starts being spent, so it is where the checks live:
 * the PDF must really be in the bucket under this job's key and inside the size limit, the
 * brief must have enough text to plan from, and the fields are validated with the same
 * limits the form shows. Then the record is written and handed to n8n.
 *
 * A retry reuses the previous job's PDF and extracted text under a fresh id, so a 120 MB
 * upload never has to happen twice.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const short = z.string().trim().max(LIMITS.SHORT_FIELD_MAX);
const fields = z.object({
  title: z.string().trim().min(1, 'A title is needed.').max(LIMITS.TITLE_MAX),
  style: z.enum(['minimal', 'immersive']),
  audience: z.enum(['agent', 'internal', 'client', 'mixed']),
  language: z.enum(['en', 'es']),
  clientName: short.optional(),
  travelDates: short.optional(),
  travelers: short.optional(),
  destination: z.string().trim().min(1, 'A destination is needed.').max(LIMITS.SHORT_FIELD_MAX),
  notes: z.string().trim().max(LIMITS.NOTES_MAX).optional(),
});

const createSchema = fields.extend({
  jobId: z.string(),
  pdfKey: z.string(),
  pageCount: z.number().int().nonnegative(),
  textChars: z.number().int().nonnegative(),
  textLow: z.boolean(),
  text: z.string().max(LIMITS.TEXT_MAX_CHARS),
});

const retrySchema = fields.partial().extend({ retryOf: z.string() });

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || 'request'}: ${issue.message}` : 'Malformed request.';
}

export async function POST(request: Request) {
  const denied = requireAccessCode(request) ?? rateLimit('jobs', request, { limit: 6, windowMs: 60_000 });
  if (denied) return denied;

  const env = getR2Config();
  if (!env) {
    return bad(`Cloud storage is not configured yet. The R2 environment variables (${R2_ENV_NAMES}) still need to be set.`, 503);
  }
  const n8n = getN8nEnv();
  if (!n8n) {
    return bad('The planning workflow is not configured yet (N8N_PRESENTATION_WEBHOOK_URL and N8N_SHARED_SECRET).', 503);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return bad('Malformed request.');
  }

  let input: JobInput;
  let text: string;
  let jobId: string;

  if (typeof raw === 'object' && raw !== null && 'retryOf' in raw) {
    const parsed = retrySchema.safeParse(raw);
    if (!parsed.success) return bad(firstIssue(parsed.error));
    if (!isJobId(parsed.data.retryOf)) return bad('That job id is not valid.');
    const previous = await readJob(env, parsed.data.retryOf);
    if (!previous) return bad('The job to retry could not be found.', 404);
    const previousText = await readJobText(env, previous.id);
    if (previousText === null) return bad('The brief text for that job is no longer available. Upload the PDF again.', 410);
    const { retryOf: _ignored, ...overrides } = parsed.data;
    void _ignored;
    const defined = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
    input = { ...previous.input, ...defined };
    text = previousText;
    jobId = newJobId();
  } else {
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) return bad(firstIssue(parsed.error));
    const d = parsed.data;
    if (!isJobId(d.jobId)) return bad('That job id is not valid.');
    if (d.pdfKey !== pdfKey(d.jobId)) return bad('The PDF key does not belong to this job.');
    if (d.text.trim().length < LIMITS.TEXT_MIN_CHARS) {
      return bad('The PDF did not contain enough readable text to plan from. If it is a scanned document, a text version is needed.');
    }

    const head = await headObject(env, d.pdfKey);
    if (!head) return bad('The PDF upload has not arrived in storage yet. Wait for it to finish and try again.', 409);
    if (head.size > LIMITS.PDF_MAX_BYTES) return bad('The uploaded PDF is over the size limit.', 413);

    input = {
      title: d.title,
      style: d.style,
      audience: d.audience,
      language: d.language,
      clientName: d.clientName || undefined,
      travelDates: d.travelDates || undefined,
      travelers: d.travelers || undefined,
      destination: d.destination,
      notes: d.notes || undefined,
      pdfKey: d.pdfKey,
      pdfUrl: publicUrlFor(env, d.pdfKey),
      pageCount: d.pageCount,
      textChars: d.textChars,
      textLow: d.textLow,
    };
    text = d.text;
    jobId = d.jobId;
  }

  try {
    const created = await createJob(env, jobId, input, text);
    const job = await notifyN8n(env, n8n, created, text);
    const payload: CreateJobResponse = { job };
    return NextResponse.json(payload, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return bad(`Could not create the job: ${detail}`, 500);
  }
}

export async function GET(request: Request) {
  const env = getR2Config();
  if (!env) return bad('Cloud storage is not configured yet.', 503);
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 12));
  try {
    const jobs = await listJobs(env, limit);
    const payload: JobListResponse = { jobs };
    return NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return bad(`Could not list jobs: ${detail}`, 500);
  }
}
