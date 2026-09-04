'use client';

import Link from 'next/link';
import { TOOLS } from '@/lib/tools';

interface Props {
  /** Slug of the tool being used, or undefined on the landing page. */
  current?: string;
  /** Tool-specific controls mounted on the right — the quality menu, for instance. */
  children?: React.ReactNode;
}

/**
 * One header for the whole suite. On a tool page the wordmark gains a breadcrumb back to
 * the index, so there is always a way out that is not the browser's back button.
 */
export function SiteHeader({ current, children }: Props) {
  const tool = TOOLS.find((t) => t.slug === current);

  return (
    <header className="flex items-center justify-between gap-4 py-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5"
          aria-label="TravelXM Tools Suite home"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logotxm.png" alt="TravelXM" className="size-9 object-contain" />
          <span className="font-display text-lg font-semibold tracking-tight">TravelXM</span>
        </Link>
        {tool && (
          <>
            <span aria-hidden className="text-fg/25">
              /
            </span>
            <span className="text-muted truncate text-sm font-medium">{tool.name}</span>
          </>
        )}
      </div>
      {children}
    </header>
  );
}
