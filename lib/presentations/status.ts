import type { JobRecord, JobStatus } from './types';

/**
 * The job's journey as the page shows it. Order matters: a row is "done" when the job's
 * status is further along than the row's, "active" when equal.
 */
export interface StepDef {
  key: Exclude<JobStatus, 'failed'>;
  label: string;
  hint: string;
}

export const STEPS: StepDef[] = [
  { key: 'queued', label: 'Received', hint: 'Handing the itinerary to the planner.' },
  { key: 'planning', label: 'Planning the slides', hint: 'Reading the brief and writing every slide.' },
  { key: 'resolving_assets', label: 'Finding photos', hint: 'Approved library first, stock only for generic scenes.' },
  { key: 'compiling', label: 'Building the deck', hint: 'Laying out text, photos and brand elements.' },
  { key: 'importing', label: 'Sending to Canva', hint: 'Creating an editable design.' },
  { key: 'done', label: 'Ready', hint: 'Open it in Canva and make any final edits.' },
];

const ORDER: Record<JobStatus, number> = {
  queued: 0,
  planning: 1,
  resolving_assets: 2,
  compiling: 3,
  importing: 4,
  done: 5,
  failed: -1,
};

export type StepState = 'done' | 'active' | 'upcoming' | 'failed';

export function stepStateFor(job: JobRecord, key: StepDef['key']): StepState {
  if (job.status === 'failed') {
    // The step that failed is the one named in the error when we know it; otherwise the
    // last one the workflow reported.
    const failedAt = job.error?.step && ORDER[job.error.step as JobStatus] !== undefined
      ? ORDER[job.error.step as JobStatus]
      : lastReportedOrder(job);
    const mine = ORDER[key];
    if (mine < failedAt) return 'done';
    if (mine === failedAt) return 'failed';
    return 'upcoming';
  }
  // A finished job has finished every step, including the last one.
  if (job.status === 'done') return 'done';
  const current = ORDER[job.status];
  const mine = ORDER[key];
  if (mine < current) return 'done';
  if (mine === current) return 'active';
  return 'upcoming';
}

function lastReportedOrder(job: JobRecord): number {
  if (job.pptxUrl) return ORDER.importing;
  if (job.assets.length > 0) return ORDER.compiling;
  if (job.manifestKey) return ORDER.resolving_assets;
  return ORDER.planning;
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'done' || status === 'failed';
}

/** Ten minutes without a status write is long enough to tell the user something is off. */
export const STALE_AFTER_MS = 10 * 60 * 1000;
/** A job that has not left "queued" in two minutes was probably never picked up. */
export const QUEUED_STALE_AFTER_MS = 2 * 60 * 1000;

export function isStale(job: JobRecord, now = Date.now()): boolean {
  if (isTerminal(job.status)) return false;
  const age = now - Date.parse(job.updatedAt);
  if (job.status === 'queued') return age > QUEUED_STALE_AFTER_MS;
  return age > STALE_AFTER_MS;
}
