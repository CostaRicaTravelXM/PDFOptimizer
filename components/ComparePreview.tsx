'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Job } from '@/lib/types';
import { humanBytes, percentSaved } from '@/lib/format';
import { openPreview, type PreviewSession } from '@/lib/preview';

interface Props {
  job: Job;
  onClose: () => void;
}

type Zoom = 'fit' | 1 | 2 | 4;
const ZOOMS: { value: Zoom; label: string }[] = [
  { value: 'fit', label: 'Fit' },
  { value: 1, label: '100%' },
  { value: 2, label: '200%' },
  { value: 4, label: '400%' },
];

/**
 * Before and after, at the same size, on the same screen.
 *
 * The whole promise of the tool is "smaller but it still looks right", and that is a claim
 * people should be able to check for themselves rather than take on faith. Checking it
 * properly means every page, not just the first, and close enough to see the pixels — so
 * this fills the screen, pages through the document, zooms, and scrolls both sides together.
 */
export function ComparePreview({ job, onClose }: Props) {
  const [sessions, setSessions] = useState<{ before: PreviewSession; after: PreviewSession }>();
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [images, setImages] = useState<{ before?: string; after?: string }>({});
  const [cssWidth, setCssWidth] = useState(0);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);

  const paneA = useRef<HTMLDivElement>(null);
  const paneB = useRef<HTMLDivElement>(null);
  const paneWidth = useRef(0);
  const syncing = useRef(false);

  /* ---- open both documents once ---- */
  useEffect(() => {
    let live = true;
    let opened: { before: PreviewSession; after: PreviewSession } | undefined;

    (async () => {
      try {
        const before = await openPreview(job.file);
        if (!live) return void before.destroy();
        const after = await openPreview(job.result!.blob);
        if (!live) return void (before.destroy(), after.destroy());

        opened = { before, after };
        setSessions(opened);
        setPageCount(Math.min(before.numPages, after.numPages));
      } catch {
        if (live) {
          setFailed(true);
          setBusy(false);
        }
      }
    })();

    return () => {
      live = false;
      opened?.before.destroy();
      opened?.after.destroy();
    };
  }, [job]);

  /* ---- measure the pane so "Fit" means something ---- */
  useLayoutEffect(() => {
    const measure = () => {
      const width = paneA.current?.clientWidth ?? 0;
      if (width > 0) paneWidth.current = width;
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [sessions]);

  /* ---- render the current page at the current zoom ---- */
  useEffect(() => {
    if (!sessions) return;
    let live = true;
    setBusy(true);

    (async () => {
      try {
        const { cssWidth: naturalWidth } = await sessions.before.size(page);
        const target =
          zoom === 'fit' ? Math.max(320, paneWidth.current || 640) : naturalWidth * zoom;
        // Render at device resolution so a 200% view shows real pixels rather than a
        // stretched thumbnail — the artifacts being judged live at that scale.
        const pixels = Math.round(target * Math.min(2, window.devicePixelRatio || 1));

        const before = await sessions.before.render(page, pixels);
        if (!live) return;
        setImages({ before, after: undefined });

        const after = await sessions.after.render(page, pixels);
        if (!live) return;

        setCssWidth(target);
        setImages({ before, after });
      } catch {
        if (live) setFailed(true);
      } finally {
        if (live) setBusy(false);
      }
    })();

    return () => {
      live = false;
    };
  }, [sessions, page, zoom]);

  /* ---- keep both panes looking at the same place ---- */
  const mirror = useCallback((from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollTop = from.scrollTop;
    to.scrollLeft = from.scrollLeft;
    // Released on the next frame so the scroll event this caused does not bounce back.
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }, []);

  const step = useCallback(
    (delta: number) => setPage((p) => Math.max(1, Math.min(pageCount || 1, p + delta))),
    [pageCount],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key === 'ArrowRight' || e.key === 'PageDown') return step(1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') return step(-1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, step]);

  const saved = job.result ? percentSaved(job.originalSize, job.result.size) : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Before and after comparison for ${job.name}`}
      className="fixed inset-0 z-50 flex flex-col p-2 sm:p-4"
      style={{ background: '#14313fd9', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="glass-card-solid flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---- toolbar ---- */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#14313f1a] px-3 py-2.5 sm:px-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display truncate text-lg font-semibold" title={job.name}>
              {job.name}
            </h2>
            <p className="text-muted truncate text-xs tabular-nums">
              {humanBytes(job.originalSize)} → {humanBytes(job.result!.size)} · {saved}% smaller
            </p>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center gap-1">
              <IconButton label="Previous page" onClick={() => step(-1)} disabled={page <= 1}>
                <path d="m15 18-6-6 6-6" />
              </IconButton>
              <span className="text-muted min-w-16 text-center text-sm tabular-nums">
                {page} / {pageCount}
              </span>
              <IconButton label="Next page" onClick={() => step(1)} disabled={page >= pageCount}>
                <path d="m9 18 6-6-6-6" />
              </IconButton>
            </div>
          )}

          <div
            className="flex items-center gap-0.5 rounded-full bg-[#14313f0d] p-0.5"
            role="group"
            aria-label="Zoom"
          >
            {ZOOMS.map((option) => (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => setZoom(option.value)}
                aria-pressed={zoom === option.value}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                  zoom === option.value
                    ? 'bg-white text-fg shadow-sm'
                    : 'text-muted hover:text-fg'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button type="button" onClick={onClose} className="btn-quiet px-4 py-1.5 text-sm">
            Close
          </button>
        </div>

        {/* ---- the two panes ---- */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-[#14313f1a] sm:grid-cols-2">
          <Pane
            ref={paneA}
            label="Before"
            size={humanBytes(job.originalSize)}
            src={images.before}
            cssWidth={cssWidth}
            zoom={zoom}
            failed={failed}
            busy={busy}
            page={page}
            onScroll={() => mirror(paneA.current, paneB.current)}
          />
          <Pane
            ref={paneB}
            label="After"
            size={humanBytes(job.result!.size)}
            src={images.after}
            cssWidth={cssWidth}
            zoom={zoom}
            failed={failed}
            busy={busy}
            page={page}
            highlight
            onScroll={() => mirror(paneB.current, paneA.current)}
          />
        </div>

        <p className="text-muted border-t border-[#14313f1a] px-4 py-1.5 text-center text-xs">
          Both sides scroll together. Arrow keys change page, Esc closes.
        </p>
      </div>
    </div>
  );
}

interface PaneProps {
  label: string;
  size: string;
  src?: string;
  cssWidth: number;
  zoom: Zoom;
  failed: boolean;
  busy: boolean;
  page: number;
  highlight?: boolean;
  onScroll: () => void;
}

function Pane({
  ref,
  label,
  size,
  src,
  cssWidth,
  zoom,
  failed,
  busy,
  page,
  highlight,
  onScroll,
}: PaneProps & { ref: React.RefObject<HTMLDivElement | null> }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-[#f7fcfe]">
      <div className="flex shrink-0 items-baseline justify-between gap-2 px-3 py-1.5">
        <span className="text-sm font-semibold">{label}</span>
        <span
          className={`text-sm tabular-nums ${highlight ? 'text-accent-deep font-semibold' : 'text-muted'}`}
        >
          {size}
        </span>
      </div>

      <div
        ref={ref}
        onScroll={onScroll}
        data-compare-pane={label.toLowerCase()}
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-[#e8f1f6] p-3"
      >
        {failed ? (
          <p className="text-muted p-6 text-center text-sm">Preview unavailable</p>
        ) : src ? (
          <img
            src={src}
            alt={`${label}: page ${page}`}
            className="mx-auto block bg-white shadow-[0_8px_24px_-12px_#14313f66]"
            style={zoom === 'fit' ? { width: '100%' } : { width: cssWidth, maxWidth: 'none' }}
          />
        ) : (
          <p className="text-muted p-6 text-center text-sm">
            {busy ? 'Rendering…' : 'Nothing to show'}
          </p>
        )}
      </div>
    </section>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="text-fg hover:bg-fg/8 rounded-full p-1.5 transition disabled:opacity-30"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}
