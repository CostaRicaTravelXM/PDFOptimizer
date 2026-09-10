import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { JobPatch } from '@/lib/presentations/types';
import { bad, requireCompileSecret } from '@/lib/server/presentations/auth';
import { patchJob, readJob } from '@/lib/server/presentations/jobs';
import { isJobId } from '@/lib/server/presentations/keys';
import { getR2Config } from '@/lib/server/r2';

/**
 * One job: the page reads it (GET) while it polls, and n8n updates it (PATCH) as the
 * workflow moves along. The PATCH is the only way the record changes after creation.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!isJobId(id)) return bad('That job id is not valid.', 404);
  const env = getR2Config();
  if (!env) return bad('Cloud storage is not configured yet.', 503);
  const job = await readJob(env, id);
  if (!job) return bad('No such job.', 404);
  return NextResponse.json(job, { headers: NO_STORE });
}

const assetUsage = z.object({
  slideId: z.string().max(120),
  purpose: z.string().max(60),
  source: z.enum(['workdrive', 'pexels', 'unsplash', 'placeholder']),
  provider: z.string().max(60).optional(),
  providerImageId: z.string().max(120).optional(),
  sourceUrl: z.string().max(2000).optional(),
  downloadUrl: z.string().max(2000).optional(),
  photographer: z.string().max(200).optional(),
  licenseUrl: z.string().max(2000).optional(),
  query: z.string().max(300).optional(),
  retrievedAt: z.string().max(60),
});

const patchSchema = z.object({
  status: z.enum(['queued', 'planning', 'resolving_assets', 'compiling', 'importing', 'done', 'failed']).optional(),
  step: z.string().max(300).optional(),
  manifestKey: z.string().max(500).optional(),
  pptxKey: z.string().max(500).optional(),
  pptxUrl: z.string().max(2000).optional(),
  canva: z
    .object({
      designId: z.string().max(200),
      editUrl: z.string().url().max(2000),
      viewUrl: z.string().url().max(2000).optional(),
    })
    .optional(),
  warnings: z.array(z.string().max(500)).max(100).optional(),
  assets: z.array(assetUsage).max(200).optional(),
  meta: z
    .object({
      model: z.string().max(100).optional(),
      usage: z.record(z.unknown()).optional(),
      cacheRead: z.number().optional(),
    })
    .optional(),
  error: z.object({ message: z.string().max(1000), step: z.string().max(100) }).optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  const denied = requireCompileSecret(request);
  if (denied) return denied;

  const { id } = await params;
  if (!isJobId(id)) return bad('That job id is not valid.', 404);
  const env = getR2Config();
  if (!env) return bad('Cloud storage is not configured yet.', 503);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return bad('Malformed request.');
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return bad(`Invalid patch: ${issue?.path.join('.')} ${issue?.message}`);
  }

  try {
    const job = await patchJob(env, id, parsed.data as JobPatch);
    if (!job) return bad('No such job.', 404);
    return NextResponse.json(job, { headers: NO_STORE });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return bad(`Could not update the job: ${detail}`, 500);
  }
}
