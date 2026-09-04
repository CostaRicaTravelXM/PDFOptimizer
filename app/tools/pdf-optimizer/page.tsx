'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ComparePreview } from '@/components/ComparePreview';
import { Dropzone } from '@/components/Dropzone';
import { FileRow } from '@/components/FileRow';
import { QualityMenu } from '@/components/QualityMenu';
import { SiteHeader } from '@/components/SiteHeader';
import { humanBytes, percentSaved } from '@/lib/format';
import type { Job } from '@/lib/types';
import { usePdfQueue } from '@/lib/usePdfQueue';
import { zipFiles } from '@/lib/zip';

export default function PdfOptimizer() {
  const { jobs, add, remove, clear, rerun, preset, setPreset, target, setTarget, busy } =
    usePdfQueue();
  const [comparing, setComparing] = useState<Job | null>(null);
  const [zipping, setZipping] = useState(false);

  const done = jobs.filter((j) => j.status === 'done' && j.result);
  const totals = useMemo(
    () => ({
      before: done.reduce((s, j) => s + j.originalSize, 0),
      after: done.reduce((s, j) => s + (j.result?.size ?? 0), 0),
    }),
    [done],
  );

  // Changing the quality re-runs the queue, so the choice is felt immediately rather than
  // applying only to whatever is dropped next.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    rerun();
  }, [preset, target, rerun]);

  const downloadAll = async () => {
    setZipping(true);
    try {
      const blob = await zipFiles(done.map((j) => ({ name: j.name, blob: j.result!.blob })));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'optimized-pdfs.zip';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setZipping(false);
    }
  };

  const hasJobs = jobs.length > 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 pb-32 sm:px-6">
      <SiteHeader current="pdf-optimizer">
        {hasJobs && (
          <QualityMenu
            preset={preset}
            target={target}
            onPreset={setPreset}
            onTarget={setTarget}
            disabled={busy}
          />
        )}
      </SiteHeader>

      {!hasJobs && (
        <section className="pt-8 pb-8 text-center sm:pt-14">
          <h1 className="font-display text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl">
            Make your PDFs small
            <br className="hidden sm:block" /> enough to send.
          </h1>
          <p className="text-muted mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
            Drop your files below. They come back looking the same, just lighter — and
            nothing ever leaves your computer.
          </p>
        </section>
      )}

      <Dropzone onFiles={add} compact={hasJobs} />

      {hasJobs && (
        <section className="mt-6" aria-label="Your files">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <h2 className="text-muted text-sm font-semibold tracking-wide uppercase">
              {jobs.length} {jobs.length === 1 ? 'file' : 'files'}
            </h2>
            <button
              type="button"
              onClick={clear}
              className="text-muted hover:text-coral text-sm transition"
            >
              Clear all
            </button>
          </div>

          <ul className="flex flex-col gap-2.5">
            {jobs.map((job) => (
              <FileRow key={job.id} job={job} onRemove={remove} onCompare={setComparing} />
            ))}
          </ul>
        </section>
      )}

      {/* Progress narrated for screen readers, which cannot watch a bar move. */}
      <p aria-live="polite" className="sr-only">
        {busy
          ? `Working. ${done.length} of ${jobs.length} files finished.`
          : done.length > 0
            ? `All done. ${done.length} files ready to download.`
            : ''}
      </p>

      {!hasJobs && (
        <footer className="text-muted mt-auto pt-14 pb-6 text-center text-sm">
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-accent-deep size-4"
                aria-hidden
              >
                <rect width="18" height="11" x="3" y="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Everything happens on this device.
            </span>
            <span>No uploads, no accounts, no waiting.</span>
          </p>
        </footer>
      )}

      {done.length > 1 && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 sm:px-6 sm:pb-6">
          <div className="glass-card-solid animate-in mx-auto flex max-w-4xl items-center justify-between gap-4 rounded-2xl px-4 py-3 shadow-[0_25px_50px_-12px_#14313f38] sm:px-5">
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {done.length} files ready
                <span className="text-accent-deep">
                  {' · '}
                  {percentSaved(totals.before, totals.after)}% smaller
                </span>
              </p>
              <p className="text-muted truncate text-sm tabular-nums">
                {humanBytes(totals.before)} → {humanBytes(totals.after)}
              </p>
            </div>
            <button
              type="button"
              onClick={downloadAll}
              disabled={zipping}
              className="btn-primary shrink-0 px-5 py-2.5 text-sm"
            >
              {zipping ? 'Packing…' : 'Download all'}
            </button>
          </div>
        </div>
      )}

      {comparing && (
        <ComparePreview job={comparing} onClose={() => setComparing(null)} />
      )}
    </div>
  );
}
