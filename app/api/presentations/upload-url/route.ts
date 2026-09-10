import { NextResponse } from 'next/server';
import { LIMITS, type UploadUrlResponse } from '@/lib/presentations/types';
import { bad, rateLimit, requireAccessCode } from '@/lib/server/presentations/auth';
import { newJobId, pdfKey } from '@/lib/server/presentations/keys';
import { getR2Config, presignPut, publicUrlFor, R2_ENV_NAMES } from '@/lib/server/r2';

/**
 * Mint a job id and a signed URL for the itinerary PDF.
 *
 * Same reasoning as the image presign route: the bytes go straight from the browser to the
 * bucket, because a 120 MB brief cannot pass through a serverless function. The key is
 * fixed by the job id; the caller chooses nothing about where the file lands.
 *
 * A signed PUT cannot enforce a size, so the ceiling here is a first check only — job
 * creation confirms the object's real size before anything is spent on it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const URL_TTL_SECONDS = 900;

export async function POST(request: Request) {
  const denied = requireAccessCode(request) ?? rateLimit('upload-url', request, { limit: 10, windowMs: 60_000 });
  if (denied) return denied;

  const env = getR2Config();
  if (!env) {
    return bad(`Cloud storage is not configured yet. The R2 environment variables (${R2_ENV_NAMES}) still need to be set.`, 503);
  }

  let body: { name?: unknown; size?: unknown; contentType?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad('Malformed request.');
  }

  if (body.contentType !== 'application/pdf') return bad('Only PDF files can be used as a brief.');
  if (typeof body.size !== 'number' || !Number.isFinite(body.size) || body.size <= 0) {
    return bad('That file looks empty.');
  }
  if (body.size > LIMITS.PDF_MAX_BYTES) {
    return bad(`That PDF is larger than the ${Math.round(LIMITS.PDF_MAX_BYTES / 1024 / 1024)} MB limit. Run it through the PDF Optimizer first.`);
  }

  const jobId = newJobId();
  const key = pdfKey(jobId);
  try {
    const uploadUrl = await presignPut(env, key, 'application/pdf', { ttlSeconds: URL_TTL_SECONDS });
    const payload: UploadUrlResponse = {
      jobId,
      pdfKey: key,
      pdfUrl: publicUrlFor(env, key),
      uploadUrl,
    };
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return bad(`Could not prepare the upload: ${detail}`, 500);
  }
}
