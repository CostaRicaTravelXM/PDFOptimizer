'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dropzone } from '@/components/Dropzone';
import { SiteHeader } from '@/components/SiteHeader';
import { UploadRow } from '@/components/UploadRow';
import {
  ArchiveError,
  contentTypeFor,
  parseArchive,
  rebuildZip,
  rewriteHtml,
  slugify,
  type ParsedArchive,
} from '@/lib/emailZip';
import { humanBytes, percentSaved } from '@/lib/format';
import {
  DEFAULT_OPTIONS,
  optimizeImages,
  supportsWebp,
  type OptimizedImage,
  type OptimizeOptions,
} from '@/lib/imageOptimize';
import {
  presign,
  uploadAll,
  UploadError,
  type UploadItem,
  type UploadProgress,
} from '@/lib/r2Upload';

/** Above this, an image is worth a second look before it goes into an email. */
const HEAVY_IMAGE_BYTES = 400 * 1024;

const MAX_EDGE_CHOICES = [
  { value: 800, label: '800px' },
  { value: 1200, label: '1200px' },
  { value: 1600, label: '1600px' },
  { value: 100000, label: 'Original' },
];

interface Finished {
  html: string;
  replaced: number;
  missed: string[];
  urls: { path: string; url: string }[];
  failed: number;
}

type Phase = 'idle' | 'parsed' | 'optimizing' | 'uploading' | 'done';

export default function EmailImages() {
  const [archive, setArchive] = useState<ParsedArchive | null>(null);
  const [zipName, setZipName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [options, setOptions] = useState<OptimizeOptions>(DEFAULT_OPTIONS);
  const [webpOk, setWebpOk] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [optimized, setOptimized] = useState<OptimizedImage[]>([]);
  const [optimizeCount, setOptimizeCount] = useState(0);
  const [progress, setProgress] = useState<UploadProgress[]>([]);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const abort = useRef<AbortController | null>(null);
  const thumbnails = useRef<Map<string, string>>(new Map());

  // A browser that cannot encode WebP hands back a PNG without complaining, so ask once and
  // take the choice away rather than shipping mislabelled files.
  useEffect(() => {
    supportsWebp().then((ok) => {
      setWebpOk(ok);
      if (!ok) setOptions((o) => ({ ...o, webp: false }));
    });
  }, []);

  // Thumbnails are object URLs; letting them accumulate across archives leaks the whole
  // image payload for the life of the tab.
  const releaseThumbnails = useCallback(() => {
    for (const url of thumbnails.current.values()) URL.revokeObjectURL(url);
    thumbnails.current.clear();
  }, []);
  useEffect(() => releaseThumbnails, [releaseThumbnails]);

  const reset = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    releaseThumbnails();
    setArchive(null);
    setZipName('');
    setPrefix('');
    setPhase('idle');
    setOptimized([]);
    setProgress([]);
    setFinished(null);
    setError(null);
    setShowSource(false);
  }, [releaseThumbnails]);

  const onFiles = useCallback(
    async (files: File[]) => {
      const file = files.find((f) => /\.zip$/i.test(f.name)) ?? files[0];
      if (!file) return;

      releaseThumbnails();
      setError(null);
      setFinished(null);
      setProgress([]);
      setOptimized([]);
      setShowSource(false);

      try {
        const parsed = parseArchive(new Uint8Array(await file.arrayBuffer()));
        if (parsed.images.length === 0) {
          throw new ArchiveError(
            'That .zip has an HTML file but no images, so there is nothing to host.',
          );
        }
        for (const image of parsed.images) {
          thumbnails.current.set(
            image.path,
            URL.createObjectURL(
              new Blob([image.bytes.slice() as BlobPart], { type: contentTypeFor(image.path)! }),
            ),
          );
        }
        setArchive(parsed);
        setZipName(file.name);
        setPrefix(slugify(file.name));
        setPhase('parsed');
      } catch (e) {
        setArchive(null);
        setPhase('idle');
        setError(
          e instanceof ArchiveError
            ? e.message
            : `That file could not be read: ${e instanceof Error ? e.message : 'unknown error'}`,
        );
      }
    },
    [releaseThumbnails],
  );

  const originalBytes = useMemo(
    () => archive?.images.reduce((sum, i) => sum + i.bytes.byteLength, 0) ?? 0,
    [archive],
  );
  const optimizedBytes = useMemo(
    () => optimized.reduce((sum, o) => sum + o.bytes.byteLength, 0),
    [optimized],
  );

  /** Keyed by upload path, which is not the archive path once the extension changes. */
  const byUploadPath = useMemo(
    () => new Map(optimized.map((o) => [o.path, o])),
    [optimized],
  );

  const run = async () => {
    if (!archive) return;
    const controller = new AbortController();
    abort.current = controller;
    setError(null);

    try {
      setPhase('optimizing');
      setOptimizeCount(0);
      const results = await optimizeImages(archive.images, options, (done) =>
        setOptimizeCount(done),
      );
      setOptimized(results);
      if (controller.signal.aborted) throw new UploadError('Cancelled.');

      const items: UploadItem[] = results.map((o) => ({
        path: o.path,
        bytes: o.bytes,
        contentType: o.contentType,
      }));

      setPhase('uploading');
      setProgress(items.map((i) => ({ path: i.path, state: 'waiting', fraction: 0 })));

      const urls = await presign(prefix.trim() || 'email', items, controller.signal);
      const uploaded = await uploadAll(items, urls, setProgress, controller.signal);

      // The HTML refers to images by their original names, so map back before rewriting.
      const byOriginal = new Map<string, string>();
      for (const o of results) {
        const url = uploaded.get(o.path);
        if (url) byOriginal.set(o.originalPath, url);
      }

      const result = rewriteHtml(archive.html, byOriginal, archive.htmlPath);
      setFinished({
        html: result.html,
        replaced: result.replaced,
        missed: result.missed,
        urls: [...byOriginal].map(([path, url]) => ({ path, url })),
        failed: results.length - byOriginal.size,
      });
      setPhase('done');
    } catch (e) {
      setPhase('parsed');
      setError(e instanceof Error ? e.message : 'The upload could not be completed.');
    } finally {
      abort.current = null;
    }
  };

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const downloadHtml = () => {
    if (!archive || !finished) return;
    download(
      new Blob([finished.html], { type: 'text/html;charset=utf-8' }),
      archive.htmlPath.split('/').pop() ?? 'email.html',
    );
  };

  const downloadZip = () => {
    if (!archive || !finished) return;
    // The archive keeps its original images: they are no longer referenced, and having the
    // untouched originals alongside the rewritten HTML is worth more than saving the bytes.
    const bytes = rebuildZip(archive.entries, archive.htmlPath, finished.html);
    download(
      new Blob([bytes.slice() as BlobPart], { type: 'application/zip' }),
      zipName.replace(/\.zip$/i, '') + ' (hosted).zip',
    );
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError('The browser would not let this page use the clipboard.');
    }
  };

  const busy = phase === 'optimizing' || phase === 'uploading';
  const uploadedCount = progress.filter((p) => p.state === 'done').length;
  const settingsLocked = busy || phase === 'done';

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 pb-20 sm:px-6">
      <SiteHeader current="email-images">
        {archive && (
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="btn-quiet px-4 py-2 text-sm"
          >
            Start over
          </button>
        )}
      </SiteHeader>

      {phase === 'idle' && (
        <section className="pt-8 pb-8 text-center sm:pt-14">
          <h1 className="font-display text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl">
            Put your email images
            <br className="hidden sm:block" /> on the cloud.
          </h1>
          <p className="text-muted mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
            Drop the .zip your email builder exported. The images are optimized, uploaded to
            Cloudflare, and the HTML comes back pointing at them — no images folder needed.
          </p>
        </section>
      )}

      <Dropzone
        onFiles={onFiles}
        compact={phase !== 'idle'}
        accept="application/zip,.zip"
        multiple={false}
        label="Choose an email export .zip"
        idleTitle="Drop your email .zip here"
        compactTitle="Use a different .zip"
        hint={
          <>
            or{' '}
            <span className="text-accent-deep decoration-accent/40 font-semibold underline underline-offset-4">
              browse your files
            </span>
            . One .html plus an images folder.
          </>
        }
      />

      {error && (
        <p
          role="alert"
          className="glass-card border-coral/40 text-coral animate-in mt-5 rounded-2xl px-4 py-3 text-sm"
        >
          {error}
        </p>
      )}

      {archive && (
        <section className="animate-in mt-6" aria-label="Archive contents">
          <div className="glass-card rounded-2xl px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="font-display text-xl font-semibold tracking-tight">
                {archive.htmlPath}
              </h2>
              <p className="text-muted text-sm tabular-nums">
                {archive.images.length} images · {humanBytes(originalBytes)}
              </p>
            </div>

            {archive.otherHtml.length > 0 && (
              <p className="text-muted mt-2 text-sm">
                Also in the archive but left untouched: {archive.otherHtml.join(', ')}.
              </p>
            )}

            <fieldset disabled={settingsLocked} className="mt-4 disabled:opacity-60">
              <legend className="text-muted text-xs font-semibold tracking-wide uppercase">
                Image optimization
              </legend>

              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={options.webp}
                    disabled={!webpOk}
                    onChange={(e) => setOptions((o) => ({ ...o, webp: e.target.checked }))}
                    className="accent-accent-deep size-4"
                  />
                  Convert to WebP
                </label>

                <label className="flex items-center gap-2 text-sm">
                  Max width
                  <select
                    value={options.maxEdge}
                    onChange={(e) =>
                      setOptions((o) => ({ ...o, maxEdge: Number(e.target.value) }))
                    }
                    className="border-fg/15 rounded-lg border bg-white/70 px-2 py-1 text-sm"
                  >
                    {MAX_EDGE_CHOICES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>

                {options.webp && (
                  <label className="flex items-center gap-2 text-sm">
                    Quality
                    <input
                      type="range"
                      min={0.5}
                      max={1}
                      step={0.02}
                      value={options.quality}
                      onChange={(e) =>
                        setOptions((o) => ({ ...o, quality: Number(e.target.value) }))
                      }
                      className="accent-accent-deep w-28"
                    />
                    <span className="text-muted w-8 tabular-nums">
                      {Math.round(options.quality * 100)}
                    </span>
                  </label>
                )}
              </div>

              {options.webp ? (
                <p className="text-muted mt-2.5 text-sm">
                  <strong className="text-fg font-semibold">Note:</strong> Outlook for Windows
                  cannot display WebP and will show a broken image. Gmail, Apple Mail and
                  Outlook.com are all fine. Turn this off to keep the original formats and
                  only resize.
                </p>
              ) : !webpOk ? (
                <p className="text-muted mt-2.5 text-sm">
                  This browser cannot write WebP, so the original formats are kept.
                </p>
              ) : null}
            </fieldset>

            <label className="mt-4 block">
              <span className="text-muted text-xs font-semibold tracking-wide uppercase">
                Destination folder in the bucket
              </span>
              <input
                type="text"
                value={prefix}
                disabled={settingsLocked}
                onChange={(e) => setPrefix(e.target.value)}
                spellCheck={false}
                className="border-fg/15 focus:border-accent mt-1.5 w-full rounded-xl border bg-white/70 px-3 py-2 font-mono text-sm outline-none disabled:opacity-60"
              />
              <span className="text-muted mt-1.5 block text-xs">
                Uploading again with the same name replaces the images already there.
              </span>
            </label>

            {phase === 'parsed' && (
              <button
                type="button"
                onClick={run}
                className="btn-primary mt-4 w-full px-5 py-3 text-sm sm:w-auto"
              >
                Optimize &amp; upload {archive.images.length} images
              </button>
            )}

            {phase === 'optimizing' && (
              <p className="text-muted mt-4 text-sm">
                Optimizing {optimizeCount} of {archive.images.length}…
              </p>
            )}
          </div>
        </section>
      )}

      {progress.length > 0 && (
        <section className="mt-5" aria-label="Images">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <h2 className="text-muted text-sm font-semibold tracking-wide uppercase">
              {phase === 'uploading' ? `Uploading ${uploadedCount} of ${progress.length}` : 'Images'}
            </h2>
            {busy && (
              <button
                type="button"
                onClick={() => abort.current?.abort()}
                className="text-muted hover:text-coral text-sm transition"
              >
                Cancel
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-2.5">
            {progress.map((p) => {
              const image = byUploadPath.get(p.path);
              return (
                <UploadRow
                  key={p.path}
                  progress={p}
                  size={image?.bytes.byteLength ?? 0}
                  originalSize={image?.originalSize}
                  note={image?.note}
                  thumbnail={image ? thumbnails.current.get(image.originalPath) : undefined}
                  heavy={(image?.bytes.byteLength ?? 0) > HEAVY_IMAGE_BYTES}
                />
              );
            })}
          </ul>
        </section>
      )}

      <p aria-live="polite" className="sr-only">
        {phase === 'optimizing'
          ? `Optimizing ${optimizeCount} of ${archive?.images.length ?? 0} images.`
          : phase === 'uploading'
            ? `Uploading. ${uploadedCount} of ${progress.length} images finished.`
            : finished
              ? `Done. ${finished.replaced} references rewritten.`
              : ''}
      </p>

      {finished && archive && (
        <section className="animate-in mt-6" aria-label="Result">
          <div className="glass-card-solid rounded-2xl px-4 py-4 sm:px-5">
            <p className="text-sm font-semibold">
              {progress.length - finished.failed} of {progress.length} images uploaded
              <span className="text-accent-deep">
                {' · '}
                {finished.replaced} {finished.replaced === 1 ? 'reference' : 'references'}{' '}
                rewritten
              </span>
            </p>
            <p className="text-muted mt-0.5 text-sm tabular-nums">
              {humanBytes(originalBytes)} → {humanBytes(optimizedBytes)}
              {optimizedBytes < originalBytes && (
                <span className="text-accent-deep font-semibold">
                  {' · '}
                  {percentSaved(originalBytes, optimizedBytes)}% smaller
                </span>
              )}
            </p>

            {finished.failed > 0 && (
              <p className="text-coral mt-2 text-sm">
                {finished.failed} {finished.failed === 1 ? 'image' : 'images'} did not upload.
                Those references still point at the local images folder — fix the errors above
                and run it again before sending this email.
              </p>
            )}

            {finished.missed.length > 0 && (
              <p className="text-coral mt-2 text-sm">
                Referenced but not found in the archive, so left as-is:{' '}
                {finished.missed.join(', ')}.
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={downloadHtml}
                className="btn-primary px-5 py-2.5 text-sm"
              >
                Download HTML only
              </button>
              <button type="button" onClick={downloadZip} className="btn-quiet px-5 py-2.5 text-sm">
                Download full .zip
              </button>
              <button
                type="button"
                onClick={() => copy(finished.urls.map((u) => u.url).join('\n'), 'urls')}
                className="btn-quiet px-5 py-2.5 text-sm"
              >
                {copied === 'urls' ? 'Copied' : 'Copy image URLs'}
              </button>
              <button
                type="button"
                onClick={() => setShowSource((v) => !v)}
                className="btn-quiet px-5 py-2.5 text-sm"
              >
                {showSource ? 'Hide source' : 'View source'}
              </button>
            </div>

            {showSource && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => copy(finished.html, 'html')}
                  className="btn-quiet mb-2 px-4 py-1.5 text-xs"
                >
                  {copied === 'html' ? 'Copied' : 'Copy HTML'}
                </button>
                <pre className="border-fg/10 max-h-80 overflow-auto rounded-xl border bg-white/70 p-3 text-xs leading-relaxed break-all whitespace-pre-wrap">
                  {finished.html}
                </pre>
              </div>
            )}
          </div>

          <div className="mt-5">
            <h2 className="text-muted mb-3 px-1 text-sm font-semibold tracking-wide uppercase">
              Preview
            </h2>
            {/*
              Sandboxed with no allow-scripts: this is someone else's HTML, and the preview
              only has to show that the hosted images load.
            */}
            <iframe
              title="Rewritten email preview"
              srcDoc={finished.html}
              sandbox=""
              className="border-fg/10 h-[36rem] w-full rounded-2xl border bg-white"
            />
          </div>
        </section>
      )}
    </div>
  );
}
