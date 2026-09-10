import type {
  JobInput,
  JobPatch,
  JobRecord,
  JobSummary,
} from '@/lib/presentations/types';
import {
  getJson,
  getObject,
  listCommonPrefixes,
  putJson,
  putObject,
  type R2Config,
} from '@/lib/server/r2';
import { isJobId, jobKey, PRESENTATIONS_PREFIX, textKey } from './keys';

/**
 * The job record, and the rule that only this app writes it.
 *
 * n8n reports progress by calling the PATCH route rather than writing to the bucket
 * itself. That keeps one writer, one merge policy and one place to set `updatedAt`, and it
 * means the workflow never needs bucket credentials at all.
 */

export async function createJob(
  config: R2Config,
  id: string,
  input: JobInput,
  text: string,
): Promise<JobRecord> {
  const now = new Date().toISOString();
  const record: JobRecord = {
    id,
    createdAt: now,
    updatedAt: now,
    status: 'queued',
    step: 'Waiting for the planner to pick this up.',
    input,
    textKey: textKey(id),
    warnings: [],
    assets: [],
  };
  await putObject(config, textKey(id), text, 'text/plain; charset=utf-8');
  await putJson(config, jobKey(id), record);
  return record;
}

export function readJob(config: R2Config, id: string): Promise<JobRecord | null> {
  return getJson<JobRecord>(config, jobKey(id));
}

export async function readJobText(config: R2Config, id: string): Promise<string | null> {
  const bytes = await getObject(config, textKey(id));
  return bytes ? bytes.toString('utf8') : null;
}

/**
 * Apply a patch from the workflow. Warnings accumulate; assets and canva replace; the
 * identity fields and the original input never change; an error is cleared the moment the
 * job moves to any status other than failed.
 */
export function mergePatch(current: JobRecord, patch: JobPatch): JobRecord {
  const next: JobRecord = {
    ...current,
    updatedAt: new Date().toISOString(),
  };
  if (patch.status) next.status = patch.status;
  if (patch.step !== undefined) next.step = patch.step;
  if (patch.manifestKey) next.manifestKey = patch.manifestKey;
  if (patch.pptxKey) next.pptxKey = patch.pptxKey;
  if (patch.pptxUrl) next.pptxUrl = patch.pptxUrl;
  if (patch.canva) next.canva = patch.canva;
  if (patch.assets) next.assets = patch.assets;
  if (patch.meta) next.meta = { ...current.meta, ...patch.meta };
  if (patch.warnings?.length) {
    next.warnings = [...new Set([...current.warnings, ...patch.warnings])];
  }
  if (patch.status === 'failed') {
    next.error = patch.error ?? current.error ?? { message: 'The job failed.', step: current.status };
  } else if (patch.status) {
    delete next.error;
  } else if (patch.error) {
    next.error = patch.error;
  }
  return next;
}

export async function patchJob(
  config: R2Config,
  id: string,
  patch: JobPatch,
): Promise<JobRecord | null> {
  const current = await readJob(config, id);
  if (!current) return null;
  const next = mergePatch(current, patch);
  await putJson(config, jobKey(id), next);
  return next;
}

export function summarize(job: JobRecord): JobSummary {
  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    status: job.status,
    title: job.input.title,
    style: job.input.style,
    destination: job.input.destination,
    canvaEditUrl: job.canva?.editUrl,
    pptxUrl: job.pptxUrl,
  };
}

/**
 * The most recent jobs. One listing of the prefix gives the ids in chronological order;
 * only the newest `limit` records are then read. A record that fails to read is skipped
 * rather than failing the whole list.
 */
export async function listJobs(config: R2Config, limit: number): Promise<JobSummary[]> {
  const prefixes = await listCommonPrefixes(config, PRESENTATIONS_PREFIX);
  const ids = prefixes
    .map((p) => p.slice(PRESENTATIONS_PREFIX.length).replace(/\/$/, ''))
    .filter(isJobId)
    .sort()
    .reverse()
    .slice(0, limit);
  const results = await Promise.allSettled(ids.map((id) => readJob(config, id)));
  const out: JobSummary[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) out.push(summarize(r.value));
  }
  return out;
}

export interface N8nEnv {
  webhookUrl: string;
  sharedSecret: string;
}

export function getN8nEnv(): N8nEnv | null {
  const webhookUrl = process.env.N8N_PRESENTATION_WEBHOOK_URL;
  const sharedSecret = process.env.N8N_SHARED_SECRET;
  if (!webhookUrl || !sharedSecret) return null;
  return { webhookUrl, sharedSecret };
}

/**
 * Hand the job to n8n. The webhook answers 202 as soon as it has the payload and does the
 * work afterwards, so this call is short. If it fails, the record is marked failed right
 * away — a job that nobody picked up must not sit in "queued" while the page polls.
 */
export async function notifyN8n(
  config: R2Config,
  env: N8nEnv,
  job: JobRecord,
  text: string,
): Promise<JobRecord> {
  try {
    const response = await fetch(env.webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tools-secret': env.sharedSecret,
      },
      body: JSON.stringify({
        jobId: job.id,
        ...job.input,
        textKey: job.textKey,
        text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`the workflow answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    return job;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    console.error(`[presentations] could not start job ${job.id}: ${reason}`);
    const failed = mergePatch(job, {
      status: 'failed',
      step: 'Could not hand the job to the planner.',
      error: {
        message: 'The planning workflow could not be reached. Nothing was generated — try again in a moment.',
        step: 'queued',
      },
    });
    await putJson(config, jobKey(job.id), failed);
    return failed;
  }
}
