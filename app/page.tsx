import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { TOOLS } from '@/lib/tools';

export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 pb-16 sm:px-6">
      <SiteHeader />

      <section className="pt-8 pb-10 text-center sm:pt-14">
        <h1 className="font-display text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl">
          TravelXM Tools Suite
        </h1>
        <p className="text-muted mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
          The small jobs that come up every day, done properly — pick one to get started.
        </p>
      </section>

      <ul className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map((tool, i) => (
          <li key={tool.slug}>
            <Link
              href={tool.href}
              className="glass-card animate-in group hover:border-accent/50 flex h-full flex-col rounded-3xl px-6 py-7 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_25px_50px_-12px_#14313f24]"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <span
                aria-hidden
                className="flex size-12 items-center justify-center rounded-full transition-transform duration-300 group-hover:scale-105"
                style={{ background: 'linear-gradient(135deg, #72c049, #4e9a33)' }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#14313f"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-6"
                >
                  {tool.icon.map((d) => (
                    <path key={d} d={d} />
                  ))}
                </svg>
              </span>

              <h2 className="font-display mt-4 text-2xl font-semibold tracking-tight">
                {tool.name}
              </h2>
              <p className="text-muted mt-1.5 text-[0.95rem] leading-relaxed">{tool.blurb}</p>

              <span className="mt-5 flex items-center justify-between gap-3 pt-1">
                <span className="text-muted/80 text-xs font-semibold tracking-wide uppercase">
                  {tool.note}
                </span>
                <span className="text-accent-deep inline-flex items-center gap-1 text-sm font-semibold">
                  Open
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
                    aria-hidden
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <footer className="text-muted mt-auto pt-14 pb-6 text-center text-sm">
        <p>Built for the TravelXM team.</p>
      </footer>
    </div>
  );
}
