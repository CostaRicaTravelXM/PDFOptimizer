'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Dropzone } from '@/components/Dropzone';
import { PresentationHistory } from '@/components/PresentationHistory';
import { PresentationTimeline } from '@/components/PresentationTimeline';
import { SiteHeader } from '@/components/SiteHeader';
import { StylePicker } from '@/components/StylePicker';
import { humanBytes } from '@/lib/format';
import { extractPdfText, PdfTextError, type PdfTextResult } from '@/lib/pdfText';
import {
  ApiError,
  createJob,
  fetchJob,
  listJobs,
  requestUploadUrl,
  setAccessCode,
  uploadPdf,
} from '@/lib/presentations/client';
import { isTerminal } from '@/lib/presentations/status';
import {
  AUDIENCES,
  LANGUAGES,
  LIMITS,
  type JobFormFields,
  type JobRecord,
  type JobSummary,
} from '@/lib/presentations/types';

/**
 * Upload an itinerary brief, choose a style, get an editable Canva deck.
 *
 * Reading the PDF and uploading it start together the moment a file lands: the text is what
 * the form needs, the upload is what the job needs, and neither should wait for the other.
 * Once a job exists the page only polls — the work happens in n8n and the compile route —
 * and the job id lives in the URL so a reload, or a link sent to a colleague, picks up where
 * it left off.
 */

type Phase = 'idle' | 'reading' | 'form' | 'submitting' | 'running' | 'done' | 'failed';

interface UploadState {
  state: 'waiting' | 'uploading' | 'done' | 'error';
  fraction: number;
  jobId?: string;
  pdfKey?: string;
  error?: string;
}

const EMPTY_FORM: JobFormFields = {
  title: '',
  style: 'immersive',
  audience: 'client',
  language: 'en',
  clientName: '',
  travelDates: '',
  travelers: '',
  destination: '',
  notes: '',
};

/** A filename is usually a fine first guess at a title. */
function titleFromFilename(name: string): string {
  return name
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, LIMITS.TITLE_MAX);
}

function jobIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('job');
  return id && /^\d{8}-\d{6}-[0-9a-f]{6}$/.test(id) ? id : null;
}

function setJobInUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('job', id);
  else url.searchParams.delete('job');
  window.history.replaceState(null, '', url.toString());
}

const fieldClass =
  'border-fg/15 focus:border-accent mt-1.5 w-full rounded-xl border bg-white/70 px-3 py-2 text-sm outline-none disabled:opacity-60';
const labelClass = 'text-muted text-xs font-semibold tracking-wide uppercase';

export default function ItineraryPresentation() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [extraction, setExtraction] = useState<PdfTextResult | null>(null);
  const [readProgress, setReadProgress] = useState<{ page: number; total: number } | null>(null);
  const [upload, setUpload] = useState<UploadState>({ state: 'waiting', fraction: 0 });
  const [form, setForm] = useState<JobFormFields>(EMPTY_FORM);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<JobSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [needsAccess, setNeedsAccess] = useState(false);
  const [accessInput, setAccessInput] = useState('');
  const [pollFailures, setPollFailures] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<File | null>(null);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listJobs());
    } catch {
      // The list is a convenience; a failure here should not disturb the main flow.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // A job id in the URL means "show me this job", whether it is still running or long done.
  useEffect(() => {
    const id = jobIdFromUrl();
    if (id) {
      setPhase('running');
      setJob(null);
    }
    void refreshHistory();
  }, [refreshHistory]);

  const watch = useCallback((id: string) => {
    abort.current?.abort();
    setError(null);
    setJob(null);
    setPollFailures(0);
    setJobInUrl(id);
    setPhase('running');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Polling: a timeout chain rather than an interval so a slow response never overlaps the
  // next request, paused while the tab is hidden, and a little slower after two minutes.
  useEffect(() => {
    if (phase !== 'running') return;
    const id = job?.id ?? jobIdFromUrl();
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    // The first read always happens, even in a background tab, so a resumed page shows the
    // job's state at once; only the follow-up polls wait for the tab to be visible.
    let first = true;

    const tick = async () => {
      if (cancelled) return;
      if (document.hidden && !first) {
        timer = setTimeout(tick, 3000);
        return;
      }
      first = false;
      try {
        const fresh = await fetchJob(id);
        if (cancelled) return;
        setJob(fresh);
        setPollFailures(0);
        setNow(Date.now());
        if (isTerminal(fresh.status)) {
          setPhase(fresh.status === 'done' ? 'done' : 'failed');
          void refreshHistory();
          return;
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setError('That job could not be found.');
          setPhase('idle');
          setJobInUrl(null);
          return;
        }
        setPollFailures((n) => n + 1);
      }
      const delay = Date.now() - startedAt > 120_000 ? 5000 : 3000;
      timer = setTimeout(tick, delay);
    };

    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [phase, job?.id, refreshHistory]);

  const reset = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    fileRef.current = null;
    setFile(null);
    setExtraction(null);
    setReadProgress(null);
    setUpload({ state: 'waiting', fraction: 0 });
    setForm(EMPTY_FORM);
    setJob(null);
    setError(null);
    setPollFailures(0);
    setJobInUrl(null);
    setPhase('idle');
  }, []);

  const startUpload = useCallback(async (f: File, signal: AbortSignal) => {
    setUpload({ state: 'uploading', fraction: 0 });
    try {
      const target = await requestUploadUrl(f, signal);
      await uploadPdf(
        target.uploadUrl,
        f,
        (fraction) => setUpload((u) => ({ ...u, fraction })),
        signal,
      );
      setUpload({ state: 'done', fraction: 1, jobId: target.jobId, pdfKey: target.pdfKey });
    } catch (e) {
      if (signal.aborted) return;
      if (e instanceof ApiError && e.status === 401) {
        setNeedsAccess(true);
        setUpload({ state: 'error', fraction: 0, error: 'An access code is needed before the PDF can be uploaded.' });
        return;
      }
      setUpload({
        state: 'error',
        fraction: 0,
        error: e instanceof Error ? e.message : 'The upload could not be completed.',
      });
    }
  }, []);

  const onFiles = useCallback(
    async (files: File[]) => {
      const f = files.find((x) => /\.pdf$/i.test(x.name)) ?? files[0];
      if (!f) return;
      if (!/\.pdf$/i.test(f.name)) {
        setError('The brief needs to be a PDF.');
        return;
      }
      if (f.size > LIMITS.PDF_MAX_BYTES) {
        setError(
          `That PDF is ${humanBytes(f.size)}, over the ${humanBytes(LIMITS.PDF_MAX_BYTES)} limit. Run it through the PDF Optimizer first.`,
        );
        return;
      }

      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      fileRef.current = f;
      setFile(f);
      setError(null);
      setJob(null);
      setExtraction(null);
      setReadProgress(null);
      setJobInUrl(null);
      setForm((prev) => ({ ...prev, title: prev.title || titleFromFilename(f.name) }));
      setPhase('reading');

      void startUpload(f, controller.signal);

      try {
        const result = await extractPdfText(f, {
          onProgress: (page, total) => setReadProgress({ page, total }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setExtraction(result);
        setPhase('form');
      } catch (e) {
        if (controller.signal.aborted) return;
        controller.abort();
        setPhase('idle');
        setFile(null);
        setError(e instanceof PdfTextError ? e.message : 'That PDF could not be read.');
      }
    },
    [startUpload],
  );

  const update = <K extends keyof JobFormFields>(key: K, value: JobFormFields[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const canGenerate =
    phase === 'form' &&
    !!extraction &&
    upload.state === 'done' &&
    form.title.trim().length > 0 &&
    form.destination.trim().length > 0;

  const generate = async () => {
    if (!extraction || upload.state !== 'done' || !upload.jobId || !upload.pdfKey) return;
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setPhase('submitting');
    try {
      const created = await createJob(
        {
          ...form,
          jobId: upload.jobId,
          pdfKey: upload.pdfKey,
          pageCount: extraction.pageCount,
          textChars: extraction.textChars,
          textLow: extraction.textLow,
          text: extraction.text,
        },
        controller.signal,
      );
      setJob(created);
      setJobInUrl(created.id);
      setPhase(isTerminal(created.status) ? (created.status === 'done' ? 'done' : 'failed') : 'running');
      void refreshHistory();
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof ApiError && e.status === 401) setNeedsAccess(true);
      setError(e instanceof Error ? e.message : 'The presentation could not be started.');
      setPhase('form');
    }
  };

  const retry = async () => {
    if (!job) return;
    setError(null);
    setPhase('submitting');
    try {
      const created = await createJob({ retryOf: job.id });
      setJob(created);
      setJobInUrl(created.id);
      setPollFailures(0);
      setPhase(isTerminal(created.status) ? (created.status === 'done' ? 'done' : 'failed') : 'running');
      void refreshHistory();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedsAccess(true);
      setError(e instanceof Error ? e.message : 'The presentation could not be restarted.');
      setPhase('failed');
    }
  };

  const saveAccessCode = () => {
    const code = accessInput.trim();
    if (!code) return;
    setAccessCode(code);
    setNeedsAccess(false);
    setAccessInput('');
    if (upload.state === 'error' && fileRef.current && abort.current) {
      void startUpload(fileRef.current, abort.current.signal);
    }
  };

  const busy = phase === 'reading' || phase === 'submitting';
  const settingsLocked = phase !== 'form';
  const showForm = phase === 'form' || phase === 'submitting' || (phase === 'reading' && !!extraction);
  const showJob = phase === 'running' || phase === 'done' || phase === 'failed';

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 pb-20 sm:px-6">
      <SiteHeader current="itinerary-presentation">
        {phase !== 'idle' && (
          <button
            type="button"
            onClick={reset}
            disabled={phase === 'submitting'}
            className="btn-quiet px-4 py-2 text-sm"
          >
            {showJob ? 'Start another' : 'Start over'}
          </button>
        )}
      </SiteHeader>

      {phase === 'idle' && (
        <section className="pt-8 pb-8 text-center sm:pt-14">
          <h1 className="font-display text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl">
            From itinerary PDF
            <br className="hidden sm:block" /> to Canva deck.
          </h1>
          <p className="text-muted mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
            Drop the brief, pick a style, and get an editable presentation with the slides
            written and the photos already in place. Finish it in Canva.
          </p>
        </section>
      )}

      {!showJob && (
        <Dropzone
          onFiles={onFiles}
          compact={phase !== 'idle'}
          accept="application/pdf,.pdf"
          multiple={false}
          label="Choose an itinerary PDF"
          idleTitle="Drop the itinerary PDF here"
          compactTitle="Use a different PDF"
          hint={
            <>
              or{' '}
              <span className="text-accent-deep decoration-accent/40 font-semibold underline underline-offset-4">
                browse your files
              </span>
              . One PDF: the itinerary, hotels, inclusions and pricing as you have them.
            </>
          }
        />
      )}

      {error && (
        <p
          role="alert"
          className="glass-card border-coral/40 text-coral animate-in mt-5 rounded-2xl px-4 py-3 text-sm"
        >
          {error}
        </p>
      )}

      {needsAccess && (
        <section className="glass-card-solid animate-in mt-5 rounded-2xl px-4 py-4 sm:px-5" aria-label="Access code">
          <p className="text-sm font-semibold">This tool needs an access code.</p>
          <p className="text-muted mt-0.5 text-sm">
            Ask the team for it. It is remembered in this browser.
          </p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveAccessCode();
            }}
          >
            <input
              type="password"
              value={accessInput}
              onChange={(e) => setAccessInput(e.target.value)}
              autoComplete="off"
              aria-label="Access code"
              className="border-fg/15 focus:border-accent w-full max-w-xs rounded-xl border bg-white/70 px-3 py-2 text-sm outline-none"
            />
            <button type="submit" className="btn-primary px-4 py-2 text-sm">
              Save
            </button>
          </form>
        </section>
      )}

      {file && !showJob && (
        <section className="animate-in mt-6" aria-label="Brief">
          <div className="glass-card rounded-2xl px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="font-display truncate text-xl font-semibold tracking-tight" title={file.name}>
                {file.name}
              </h2>
              <p className="text-muted text-sm tabular-nums">
                {humanBytes(file.size)}
                {extraction ? ` · ${extraction.pageCount} pages · ${extraction.textChars.toLocaleString()} characters` : ''}
              </p>
            </div>

            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              <li className="flex items-center gap-2">
                <StatusDot state={extraction ? 'done' : 'active'} />
                {extraction
                  ? 'Text read from the PDF.'
                  : readProgress
                    ? `Reading page ${readProgress.page} of ${readProgress.total}…`
                    : 'Reading the PDF…'}
              </li>
              <li className="flex items-center gap-2">
                <StatusDot state={upload.state === 'done' ? 'done' : upload.state === 'error' ? 'error' : 'active'} />
                {upload.state === 'done'
                  ? 'PDF stored.'
                  : upload.state === 'error'
                    ? upload.error
                    : `Uploading the PDF · ${Math.round(upload.fraction * 100)}%`}
                {upload.state === 'error' && !needsAccess && fileRef.current && (
                  <button
                    type="button"
                    className="text-accent-deep ml-1 text-xs font-semibold underline underline-offset-4"
                    onClick={() => {
                      const controller = new AbortController();
                      abort.current = controller;
                      void startUpload(fileRef.current!, controller.signal);
                    }}
                  >
                    Retry upload
                  </button>
                )}
              </li>
            </ul>

            {extraction?.textLow && (
              <p className="border-sunshine/60 bg-sunshine/15 mt-3 rounded-xl border px-3 py-2 text-sm">
                <strong className="font-semibold">Very little text was found.</strong> This looks like a
                scanned or design-tool PDF. The planner will do its best with what it can read, so
                check the deck carefully — or use a version of the brief with real text.
              </p>
            )}
            {extraction?.truncated && (
              <p className="text-muted mt-2 text-sm">
                The brief is very long; only the first {LIMITS.TEXT_MAX_CHARS.toLocaleString()} characters
                will be used.
              </p>
            )}
          </div>
        </section>
      )}

      {showForm && (
        <section className="animate-in mt-5" aria-label="Presentation details">
          <div className="glass-card rounded-2xl px-4 py-4 sm:px-5">
            <fieldset disabled={settingsLocked} className="disabled:opacity-60">
              <legend className={labelClass}>Style</legend>
              <div className="mt-2">
                <StylePicker value={form.style} onChange={(v) => update('style', v)} disabled={settingsLocked} />
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className={labelClass}>Presentation title</span>
                  <input
                    type="text"
                    value={form.title}
                    maxLength={LIMITS.TITLE_MAX}
                    onChange={(e) => update('title', e.target.value)}
                    className={fieldClass}
                    required
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Destination</span>
                  <input
                    type="text"
                    value={form.destination}
                    maxLength={LIMITS.SHORT_FIELD_MAX}
                    onChange={(e) => update('destination', e.target.value)}
                    placeholder="e.g. Caribbean Coast, Guanacaste"
                    className={fieldClass}
                    required
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Audience</span>
                  <select
                    value={form.audience}
                    onChange={(e) => update('audience', e.target.value as JobFormFields['audience'])}
                    className={fieldClass}
                  >
                    {AUDIENCES.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={labelClass}>Language</span>
                  <select
                    value={form.language}
                    onChange={(e) => update('language', e.target.value as JobFormFields['language'])}
                    className={fieldClass}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={labelClass}>Client name (optional)</span>
                  <input
                    type="text"
                    value={form.clientName}
                    maxLength={LIMITS.SHORT_FIELD_MAX}
                    onChange={(e) => update('clientName', e.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Travel dates (optional)</span>
                  <input
                    type="text"
                    value={form.travelDates}
                    maxLength={LIMITS.SHORT_FIELD_MAX}
                    onChange={(e) => update('travelDates', e.target.value)}
                    placeholder="e.g. 18–21 September 2026"
                    className={fieldClass}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Travelers (optional)</span>
                  <input
                    type="text"
                    value={form.travelers}
                    maxLength={LIMITS.SHORT_FIELD_MAX}
                    onChange={(e) => update('travelers', e.target.value)}
                    placeholder="e.g. 2 adults, 1 child"
                    className={fieldClass}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className={labelClass}>Special instructions (optional)</span>
                  <textarea
                    value={form.notes}
                    maxLength={LIMITS.NOTES_MAX}
                    onChange={(e) => update('notes', e.target.value)}
                    rows={3}
                    placeholder="e.g. focus on family travel, highlight the luxury hotels, use formal English"
                    className={fieldClass}
                  />
                </label>
              </div>
            </fieldset>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={generate}
                disabled={!canGenerate || busy}
                className="btn-primary px-5 py-3 text-sm"
              >
                {phase === 'submitting' ? 'Starting…' : 'Generate presentation'}
              </button>
              {phase === 'form' && upload.state === 'uploading' && (
                <span className="text-muted text-sm">
                  Still uploading the PDF · {Math.round(upload.fraction * 100)}%
                </span>
              )}
              {phase === 'form' && upload.state === 'done' && extraction && (
                <span className="text-muted text-sm">Usually ready in a few minutes.</span>
              )}
            </div>
          </div>
        </section>
      )}

      {showJob && (
        <section className="animate-in mt-6" aria-label="Progress">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
            <h2 className="font-display text-xl font-semibold tracking-tight">
              {job?.input.title ?? 'Loading…'}
            </h2>
            {job && (
              <p className="text-muted text-sm">
                {job.input.style === 'minimal' ? 'Minimal' : 'Immersive'} · {job.input.destination}
              </p>
            )}
          </div>

          <PresentationTimeline job={job} now={now} />

          {pollFailures >= 5 && phase === 'running' && (
            <p className="text-muted mt-2 px-1 text-sm">
              Having trouble reaching the server; still trying.
            </p>
          )}

          {phase === 'running' && (
            <p className="mt-3 px-1">
              <button
                type="button"
                onClick={reset}
                className="text-muted hover:text-coral text-sm transition"
              >
                Stop watching
              </button>
              <span className="text-muted/70 ml-2 text-xs">
                The deck will still finish and show up in the history below.
              </span>
            </p>
          )}

          {job && phase === 'done' && (
            <div className="glass-card-solid animate-in mt-5 rounded-2xl px-4 py-4 sm:px-5">
              <p className="text-sm font-semibold">
                Your presentation is ready.
                {job.warnings.length > 0 && (
                  <span className="text-muted font-normal"> A few things to look at are listed below.</span>
                )}
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                {job.canva?.editUrl && (
                  <a href={job.canva.editUrl} target="_blank" rel="noreferrer" className="btn-primary px-5 py-2.5 text-sm">
                    Open in Canva
                  </a>
                )}
                {job.pptxUrl && (
                  <a
                    href={job.pptxUrl}
                    download
                    className={`${job.canva?.editUrl ? 'btn-quiet' : 'btn-primary'} px-5 py-2.5 text-sm`}
                  >
                    Download PowerPoint
                  </a>
                )}
                <button type="button" onClick={retry} className="btn-quiet px-5 py-2.5 text-sm">
                  Make another version
                </button>
              </div>
              {!job.canva?.editUrl && job.pptxUrl && (
                <p className="text-muted mt-3 text-sm">
                  Canva could not import this one, so the PowerPoint is here to download and import by hand.
                </p>
              )}
              <Warnings warnings={job.warnings} />
              <Credits job={job} />
            </div>
          )}

          {job && phase === 'failed' && (
            <div className="glass-card-solid animate-in mt-5 rounded-2xl px-4 py-4 sm:px-5">
              <p className="text-coral text-sm font-semibold">This one did not finish.</p>
              <p className="text-muted mt-1 text-sm">{job.error?.message ?? 'Something went wrong along the way.'}</p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <button type="button" onClick={retry} className="btn-primary px-5 py-2.5 text-sm">
                  Try again
                </button>
                {job.pptxUrl && (
                  <a href={job.pptxUrl} download className="btn-quiet px-5 py-2.5 text-sm">
                    Download PowerPoint
                  </a>
                )}
              </div>
              <Warnings warnings={job.warnings} />
            </div>
          )}
        </section>
      )}

      <p aria-live="polite" className="sr-only">
        {phase === 'reading'
          ? 'Reading and uploading the PDF.'
          : phase === 'form'
            ? 'The brief is ready. Fill in the details and generate the presentation.'
            : phase === 'running'
              ? `Working: ${job?.step ?? 'in progress'}.`
              : phase === 'done'
                ? 'The presentation is ready.'
                : phase === 'failed'
                  ? 'The presentation could not be finished.'
                  : ''}
      </p>

      <PresentationHistory jobs={history} loading={historyLoading} onView={watch} />
    </div>
  );
}

function StatusDot({ state }: { state: 'active' | 'done' | 'error' }) {
  return (
    <span
      aria-hidden
      className={[
        'inline-block size-2.5 shrink-0 rounded-full',
        state === 'done' ? 'bg-accent-deep' : state === 'error' ? 'bg-coral' : 'progress-live',
      ].join(' ')}
    />
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <details className="mt-4">
      <summary className="text-muted cursor-pointer text-sm font-semibold">
        {warnings.length} {warnings.length === 1 ? 'note' : 'notes'} from the build
      </summary>
      <ul className="text-muted mt-2 list-disc space-y-1 pl-5 text-sm">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </details>
  );
}

function Credits({ job }: { job: JobRecord }) {
  const credits = job.assets.filter((a) => a.source === 'pexels' || a.source === 'unsplash');
  if (credits.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="text-muted cursor-pointer text-sm font-semibold">
        Stock photo credits ({credits.length})
      </summary>
      <ul className="text-muted mt-2 list-disc space-y-1 pl-5 text-sm">
        {credits.map((a, i) => (
          <li key={i}>
            {a.slideId}: {a.photographer ? `Photo by ${a.photographer}` : 'Photo'} on{' '}
            {a.provider ?? a.source}
            {a.sourceUrl && (
              <>
                {' · '}
                <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  source
                </a>
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
