'use client';

import type { JobStatus, JobSummary } from '@/lib/presentations/types';

interface Props {
  jobs: JobSummary[];
  loading: boolean;
  onView: (id: string) => void;
}

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Queued',
  planning: 'Planning',
  resolving_assets: 'Finding photos',
  compiling: 'Building',
  importing: 'Sending to Canva',
  done: 'Ready',
  failed: 'Failed',
};

function relative(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/**
 * Recent presentations, newest first. Every row can be reopened — the page resumes polling
 * a job that is still running and shows the links for one that finished.
 */
export function PresentationHistory({ jobs, loading, onView }: Props) {
  if (!loading && jobs.length === 0) return null;

  return (
    <section className="mt-8" aria-label="Recent presentations">
      <h2 className="text-muted mb-3 px-1 text-sm font-semibold tracking-wide uppercase">
        Recent presentations
      </h2>
      {loading && jobs.length === 0 ? (
        <p className="text-muted px-1 text-sm">Loading…</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {jobs.map((job) => {
            const terminal = job.status === 'done' || job.status === 'failed';
            return (
              <li
                key={job.id}
                className="glass-card flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium" title={job.title}>
                    {job.title}
                  </span>
                  <span className="text-muted block text-xs">
                    {job.style === 'minimal' ? 'Minimal' : 'Immersive'} · {job.destination} ·{' '}
                    {relative(job.createdAt)}
                  </span>
                </span>
                <span
                  className={[
                    'rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold',
                    job.status === 'done'
                      ? 'bg-accent/25 text-accent-deep'
                      : job.status === 'failed'
                        ? 'bg-coral/20 text-coral'
                        : 'bg-sky/15 text-sky',
                  ].join(' ')}
                >
                  {STATUS_LABEL[job.status]}
                </span>
                <span className="flex items-center gap-2">
                  {job.canvaEditUrl && (
                    <a
                      href={job.canvaEditUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary px-3 py-1.5 text-xs"
                    >
                      Open in Canva
                    </a>
                  )}
                  {job.pptxUrl && (
                    <a href={job.pptxUrl} className="btn-quiet px-3 py-1.5 text-xs" download>
                      PowerPoint
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => onView(job.id)}
                    className="text-muted hover:text-accent-deep text-xs font-semibold underline decoration-transparent underline-offset-4 transition hover:decoration-current"
                  >
                    {terminal ? 'Details' : 'Watch'}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
