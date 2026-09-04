'use client';

import { humanBytes, percentSaved } from '@/lib/format';
import type { UploadProgress } from '@/lib/r2Upload';

interface Props {
  progress: UploadProgress;
  size: number;
  /** Size before optimization, when it differs. */
  originalSize?: number;
  /** Why this image was left alone, when it was. */
  note?: string;
  /** Object URL for a thumbnail, when one has been made. */
  thumbnail?: string;
  /** Flagged as unusually heavy for an email image. */
  heavy?: boolean;
}

/**
 * One image in the upload list: thumbnail, name, size, and where it got to.
 *
 * Deliberately a lighter cousin of FileRow — that component is wired to the PDF queue's Job
 * shape, and pulling both onto a shared abstraction would cost more than the duplication.
 */
export function UploadRow({ progress, size, originalSize, note, thumbnail, heavy }: Props) {
  const { state, fraction, publicUrl, error, path } = progress;
  const name = path.split('/').pop() ?? path;

  return (
    <li className="glass-card animate-in flex items-center gap-3 rounded-2xl px-3 py-3 sm:px-4">
      <span className="bg-fg/5 relative size-11 shrink-0 overflow-hidden rounded-xl">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="size-full object-cover" />
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium" title={path}>
            {name}
          </span>
          {heavy && (
            <span className="bg-sunshine/25 text-fg/80 shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold">
              heavy
            </span>
          )}
        </span>

        {state === 'error' ? (
          <span className="text-coral mt-0.5 block text-sm">{error}</span>
        ) : state === 'done' && publicUrl ? (
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted hover:text-accent-deep mt-0.5 block truncate text-xs underline decoration-transparent transition hover:decoration-current"
            title={publicUrl}
          >
            {publicUrl}
          </a>
        ) : (
          <span className="text-muted mt-0.5 block text-sm tabular-nums">
            {originalSize !== undefined && originalSize !== size ? (
              <>
                {humanBytes(originalSize)} → {humanBytes(size)}
                <span className="text-accent-deep font-semibold">
                  {' · '}
                  {percentSaved(originalSize, size)}% smaller
                </span>
              </>
            ) : (
              humanBytes(size)
            )}
            {note && <span className="text-muted/80"> · {note}</span>}
          </span>
        )}

        {state === 'uploading' && (
          <span className="bg-fg/10 mt-2 block h-1 overflow-hidden rounded-full">
            <span
              className="progress-live block h-full rounded-full transition-[width] duration-200"
              style={{ width: `${Math.max(4, Math.round(fraction * 100))}%` }}
            />
          </span>
        )}
      </span>

      <span className="shrink-0" aria-label={STATUS_LABEL[state]} title={STATUS_LABEL[state]}>
        {state === 'done' ? (
          <Icon className="text-accent-deep" paths={['M20 6 9 17l-5-5']} />
        ) : state === 'error' ? (
          <Icon className="text-coral" paths={['M18 6 6 18', 'm6 6 12 12']} />
        ) : state === 'uploading' ? (
          <span className="text-muted text-xs font-semibold tabular-nums">
            {Math.round(fraction * 100)}%
          </span>
        ) : (
          <Icon className="text-muted/50" paths={['M12 6v6l4 2']} circle />
        )}
      </span>
    </li>
  );
}

const STATUS_LABEL: Record<UploadProgress['state'], string> = {
  waiting: 'Waiting',
  uploading: 'Uploading',
  done: 'Uploaded',
  error: 'Failed',
};

function Icon({
  paths,
  className,
  circle,
}: {
  paths: string[];
  className: string;
  circle?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-5 ${className}`}
      aria-hidden
    >
      {circle && <circle cx="12" cy="12" r="9" strokeWidth="2" />}
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
