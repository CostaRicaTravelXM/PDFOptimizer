'use client';

import { isStale, STEPS, stepStateFor } from '@/lib/presentations/status';
import type { JobRecord } from '@/lib/presentations/types';

interface Props {
  job: JobRecord | null;
  /** Wall clock, passed in so the stale check re-evaluates on each poll rather than on render. */
  now: number;
}

/**
 * Where the job is. Six fixed rows so the user always sees how far there is to go; the
 * workflow's own one-line `step` message sits under the active row so a long wait still
 * reads as progress rather than silence.
 */
export function PresentationTimeline({ job, now }: Props) {
  const stale = job ? isStale(job, now) : false;

  return (
    <div className="glass-card rounded-2xl px-4 py-4 sm:px-5">
      <ol className="flex flex-col gap-3">
        {STEPS.map((step, i) => {
          const state = job ? stepStateFor(job, step.key) : i === 0 ? 'active' : 'upcoming';
          const active = state === 'active';
          const failed = state === 'failed';
          return (
            <li key={step.key} className="flex gap-3">
              <span className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={[
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold',
                    state === 'done'
                      ? 'bg-accent-deep text-white'
                      : active
                        ? 'bg-accent text-fg'
                        : failed
                          ? 'bg-coral text-white'
                          : 'bg-fg/10 text-muted',
                  ].join(' ')}
                >
                  {state === 'done' ? '✓' : failed ? '!' : i + 1}
                </span>
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className={`mt-1 w-px flex-1 ${state === 'done' ? 'bg-accent-deep/50' : 'bg-fg/10'}`}
                  />
                )}
              </span>

              <span className="min-w-0 flex-1 pb-1">
                <span
                  className={[
                    'block text-sm font-semibold',
                    active ? 'text-fg' : failed ? 'text-coral' : state === 'done' ? 'text-fg/80' : 'text-muted/70',
                  ].join(' ')}
                >
                  {step.label}
                  <span className="sr-only">
                    {state === 'done' ? ', done' : active ? ', in progress' : failed ? ', failed' : ''}
                  </span>
                </span>
                {active && (
                  <>
                    <span className="text-muted mt-0.5 block text-sm">{job?.step || step.hint}</span>
                    <span className="bg-fg/10 mt-2 block h-1 w-full max-w-xs overflow-hidden rounded-full">
                      <span className="progress-live block h-full w-full rounded-full" />
                    </span>
                  </>
                )}
                {failed && job?.error && (
                  <span className="text-coral mt-0.5 block text-sm">{job.error.message}</span>
                )}
                {state === 'upcoming' && !failed && (
                  <span className="text-muted/60 mt-0.5 block text-xs">{step.hint}</span>
                )}
                {job?.status === 'done' && step.key === 'done' && job.step && (
                  <span className="text-muted mt-0.5 block text-sm">{job.step}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {stale && (
        <p className="border-sunshine/60 bg-sunshine/15 mt-4 rounded-xl border px-3 py-2 text-sm">
          This is taking longer than usual.{' '}
          {job?.status === 'queued'
            ? 'The planner may not have picked the job up. It is safe to try again.'
            : 'The deck may still finish — it will appear in the history below when it does.'}
        </p>
      )}
    </div>
  );
}
