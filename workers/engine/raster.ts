/**
 * Flatten engine: render every page to an image and rebuild the document around it.
 *
 * This is the guaranteed floor, not the default. It throws away the text layer, so it only
 * runs when the Smart engine cannot get a file under the user's size target — typically a
 * scan encoded with CCITT or JPEG 2000, where there is no text to lose anyway.
 *
 * Peak memory is deliberately held to a single page: a 121 MB source with 20 megapixel
 * photographs will not survive holding thirteen rendered pages at once.
 */

import { PDFDocument } from 'pdf-lib';
import type { OptimizeOptions, OptimizeResult, OptimizeStats } from '@/lib/types';
import { PRESETS } from './presets';
import { assumedPageInches } from './budget';
import { release } from './images';
import type { ProgressFn } from './smart';

/** Minimum page-render width in pixels, so a tiny page is never rendered illegibly. */
const MIN_RENDER_EDGE = 900;

export async function optimizeFlatten(
  bytes: Uint8Array,
  options: OptimizeOptions,
  onProgress: ProgressFn,
): Promise<OptimizeResult> {
  const preset = PRESETS[options.preset];

  onProgress(0.02, 'Reading the file');
  const pdfjs = await loadPdfJs();

  // pdf.js takes ownership of the buffer it is given, so hand it a copy: the caller may
  // still need the original bytes to fall back to.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableAutoFetch: true,
  });
  const doc = await task.promise;

  const out = await PDFDocument.create();
  const stats: OptimizeStats = {
    pages: doc.numPages,
    imagesOptimized: 0,
    imagesSkipped: 0,
    imagesDeduped: 0,
    masksDropped: 0,
  };

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress(0.05 + 0.85 * ((n - 1) / doc.numPages), `Flattening page ${n} of ${doc.numPages}`);

      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });

      // Match the Smart engine's resolution budget so a fallback does not visibly change
      // the result: clamp the declared page size to a realistic sheet, then apply the DPI.
      const longestPoints = Math.max(base.width, base.height);
      const inches = Math.min(longestPoints / 72, 11.7);
      const targetLongest = Math.max(MIN_RENDER_EDGE, Math.round(inches * preset.dpi));
      const scale = targetLongest / longestPoints;
      const viewport = page.getViewport({ scale });

      const canvas = new OffscreenCanvas(
        Math.max(1, Math.ceil(viewport.width)),
        Math.max(1, Math.ceil(viewport.height)),
      );
      const ctx = canvas.getContext('2d')!;
      // Pages may be transparent; a JPEG has no alpha, so paint paper white underneath.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport })
        .promise;

      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: preset.quality });
      const jpeg = new Uint8Array(await blob.arrayBuffer());

      release(canvas);
      page.cleanup();

      const embedded = await out.embedJpg(jpeg);
      // Keep the original page box in points so print size and proportions are unchanged.
      const sheet = out.addPage([base.width, base.height]);
      sheet.drawImage(embedded, { x: 0, y: 0, width: base.width, height: base.height });
      stats.imagesOptimized++;
    }
  } finally {
    await doc.destroy().catch(() => {});
  }

  onProgress(0.95, 'Rebuilding the PDF');
  out.setProducer('TravelXM PDF Optimizer');
  const saved = await out.save({ useObjectStreams: true, addDefaultPage: false });
  onProgress(1, 'Done');

  return { bytes: saved, engine: 'flatten', stats };
}

type PdfJs = typeof import('pdfjs-dist/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * Load pdf.js with a worker of its own.
 *
 * We are already inside a Web Worker, so this is a nested one. That is deliberate: pdf.js 4
 * has no in-thread mode — leaving `workerSrc` empty throws
 * `No "GlobalWorkerOptions.workerSrc" specified` rather than falling back — and nested
 * dedicated workers are supported across current Chrome, Firefox and Safari.
 */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/build/pdf.mjs').then((mod) => {
    mod.GlobalWorkerOptions.workerPort = new Worker(
      new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url),
      { type: 'module' },
    );
    return mod;
  });
  return pdfjsPromise;
}
