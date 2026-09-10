import { NextResponse } from 'next/server';
import type { CompileResponse } from '@/lib/presentations/types';
import { bad, requireCompileSecret } from '@/lib/server/presentations/auth';
import { PPTX_MIME } from '@/lib/server/presentations/brand';
import { compilePresentation, deckSlug } from '@/lib/server/presentations/compile';
import { loadAssets } from '@/lib/server/presentations/images';
import { readJob } from '@/lib/server/presentations/jobs';
import { isJobId, manifestKey, pptxKey } from '@/lib/server/presentations/keys';
import { parseManifest, parseResolvedAssets } from '@/lib/server/presentations/schema';
import { getR2Config, publicUrlFor, putJson, putObject } from '@/lib/server/r2';

/**
 * Build the PowerPoint file for a job.
 *
 * Called by n8n once the manifest is planned and every image is resolved. The body is small
 * — the manifest and a map of image URLs — and the result is written to the bucket rather
 * than returned, so neither direction meets the platform's body limit. The route does not
 * touch the job record; n8n reports the outcome through the PATCH route like every other
 * step, which keeps the record's history in one place.
 *
 * `maxDuration` is the ceiling on a Hobby plan. On Pro it can go to 300 by changing the
 * export; nothing else needs to move.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = requireCompileSecret(request);
  if (denied) return denied;

  const env = getR2Config();
  if (!env) return bad('Cloud storage is not configured yet.', 503);

  let raw: { jobId?: unknown; manifest?: unknown; assets?: unknown };
  try {
    raw = await request.json();
  } catch {
    return bad('Malformed request.');
  }

  if (!isJobId(raw.jobId)) return bad('That job id is not valid.');
  const job = await readJob(env, raw.jobId);
  if (!job) return bad('No such job.', 404);

  const parsed = parseManifest(raw.manifest);
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Manifest rejected', issues: parsed.issues }, { status: 400 });
  }
  const { manifest } = parsed;
  const { assets, warnings: assetWarnings } = parseResolvedAssets(raw.assets, manifest);

  const started = Date.now();
  try {
    const { loaded, warnings: loadWarnings } = await loadAssets(assets);
    const result = await compilePresentation(manifest, loaded, {
      warnings: [...parsed.warnings, ...assetWarnings, ...loadWarnings],
    });

    const key = pptxKey(job.id, deckSlug(manifest.presentation.title));
    await putObject(env, key, result.buffer, PPTX_MIME, 'private, max-age=0');
    await putJson(env, manifestKey(job.id), manifest);

    const payload: CompileResponse = {
      pptxKey: key,
      pptxUrl: publicUrlFor(env, key),
      slideCount: result.slideCount,
      warnings: result.warnings,
    };
    console.log(
      `[presentations] compiled ${job.id}: ${result.slideCount} slides, ${(result.buffer.byteLength / 1024 / 1024).toFixed(1)} MB in ${Date.now() - started} ms`,
    );
    return NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[presentations] compile failed for ${job.id}: ${detail}`);
    return bad(`The deck could not be built: ${detail}`, 500);
  }
}
