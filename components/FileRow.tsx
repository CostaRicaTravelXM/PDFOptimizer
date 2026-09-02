'use client';

import { useEffect, useState } from 'react';
import type { Job } from '@/lib/types';
import { humanBytes, optimizedName, percentSaved } from '@/lib/format';

interface Props {
  job: Job;
  onRemove: (id: string) => void;
  onCompare: (job: Job) => void;
}

export function FileRow({ job, onRemove, onCompare }: Props) {
  const saved = job.result ? percentSaved(job.originalSize, job.result.size) : 0;
  const done = job.status === 'done' && job.result;
  const failed = job.status === 'failed';

  return (
    <li className="glass-card animate-in rounded-2xl px-4 py-3.5 sm:px-5 sm:py-4">
      {/*
        Stacked on a phone, inline from `sm` up. Squeezing the filename, the two sizes, the
        saving and a button onto one 390px line leaves the filename unreadable, and the
        filename is how someone tells their files apart.
      */}
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 pr-9 sm:gap-4 sm:pr-0">
          <StatusIcon job={job} />

          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.94rem] font-medium" title={job.name}>
              {job.name}
            </p>

            {done ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="text-muted tabular-nums">
                  {humanBytes(job.originalSize)}
                </span>
                <span aria-hidden className="text-muted/60">
                  →
                </span>
                <span className="text-fg font-semibold tabular-nums">
                  {humanBytes(job.result!.size)}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg, #4e9a33, #396b1f)' }}
                >
                  {saved}% smaller
                </span>
                {job.result!.engine === 'flatten' && (
                  <span className="text-muted text-xs">Flattened to fit</span>
                )}
              </p>
            ) : failed ? (
              <p className="text-coral mt-0.5 text-sm">{job.error?.message}</p>
            ) : (
              <p className="text-muted mt-0.5 text-sm tabular-nums">
                {humanBytes(job.originalSize)} · {job.phase}
              </p>
            )}
          </div>

        </div>

        {/*
          Pinned to the corner on a phone, inline and last on wider screens. Either way it
          stays clear of Download: nobody should reach for one and hit the other.
        */}
        <button
          type="button"
          onClick={() => onRemove(job.id)}
          aria-label={`Remove ${job.name}`}
          className="text-muted/60 hover:text-coral hover:bg-coral/10 absolute top-0 right-0 shrink-0 rounded-full p-2 transition sm:static sm:order-last"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="size-4"
            aria-hidden
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        {done && (
          <div className="flex shrink-0 items-center gap-1.5 pl-12 sm:pl-0">
            <button
              type="button"
              onClick={() => onCompare(job)}
              className="text-muted hover:text-fg rounded-full px-3 py-1.5 text-sm underline decoration-transparent underline-offset-4 transition hover:decoration-current"
            >
              Compare
            </button>
            <DownloadButton job={job} />
          </div>
        )}
      </div>

      {(job.status === 'working' || job.status === 'queued') && (
        <div className="mt-3">
          <div
            className="bg-fg/10 h-1.5 overflow-hidden rounded-full"
            role="progressbar"
            aria-valuenow={Math.round(job.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${job.name}: ${job.phase}`}
          >
            <div
              className="progress-live h-full rounded-full transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(3, job.progress * 100)}%` }}
            />
          </div>
        </div>
      )}
    </li>
  );
}

function DownloadButton({ job }: { job: Job }) {
  const [href, setHref] = useState<string>();

  useEffect(() => {
    if (!job.result) return;
    const url = URL.createObjectURL(job.result.blob);
    setHref(url);
    return () => URL.revokeObjectURL(url);
  }, [job.result]);

  if (!href) return null;

  return (
    <a
      href={href}
      download={optimizedName(job.name)}
      className="btn-primary px-4 py-2 text-sm sm:px-5"
    >
      Download
    </a>
  );
}

function StatusIcon({ job }: { job: Job }) {
  const base = 'flex size-9 shrink-0 items-center justify-center rounded-xl sm:size-10';

  if (job.status === 'done') {
    return (
      <span className={`${base} bg-accent/20 text-accent-deep`} aria-hidden>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-5"
        >
          <path d="m20 6-11 11-5-5" />
        </svg>
      </span>
    );
  }

  if (job.status === 'failed') {
    return (
      <span className={`${base} bg-coral/15 text-coral`} aria-hidden>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="size-5"
        >
          <path d="M12 8v5M12 17h.01" />
          <circle cx="12" cy="12" r="9" strokeWidth="2" />
        </svg>
      </span>
    );
  }

  return (
    <span className={`${base} bg-sky/15 text-sky`} aria-hidden>
      <svg viewBox="0 0 24 24" className="size-5 animate-spin" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
