'use client';

/**
 * Page rendering for the before/after comparison.
 *
 * Seeing the two documents side by side is what makes the size claim believable — a number
 * alone asks people to trust that "keeps the quality" is true.
 *
 * A session holds the parsed document open across page and zoom changes. Reparsing on every
 * interaction would mean re-reading a 121 MB file to turn one page, which is the difference
 * between a viewer someone can explore and one they give up on.
 */

type PdfJs = typeof import('pdfjs-dist/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/build/pdf.mjs');
  return pdfjsPromise;
}

/** Canvases beyond this are refused by browsers; stay well inside the limit. */
const MAX_RENDER_EDGE = 4096;

export interface PageSize {
  /** Page width in CSS pixels at 100% zoom (PDF points are 1/72in, CSS px are 1/96in). */
  cssWidth: number;
  cssHeight: number;
}

export interface PreviewSession {
  numPages: number;
  size(pageNumber: number): Promise<PageSize>;
  /** Render a page to a data URL at the requested pixel width. */
  render(pageNumber: number, pixelWidth: number): Promise<string>;
  destroy(): void;
}

export async function openPreview(source: Blob): Promise<PreviewSession> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await source.arrayBuffer());

  /*
   * Each session gets a worker of its own rather than sharing one through
   * `GlobalWorkerOptions.workerPort`. pdf.js caches a single PDFWorker per port, so a shared
   * port means closing either document tears down the worker the other is still using —
   * which surfaces as "PDFWorker.fromPort - the worker is being destroyed" the moment the
   * comparison tries to hold both files open at once.
   *
   * Parsing also runs off the UI thread this way, so the interface stays responsive while
   * the optimizer's own workers are busy.
   */
  const port = new Worker(new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url), {
    type: 'module',
  });
  const worker = pdfjs.PDFWorker.fromPort({ port })!;

  type PdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

  let document_: PdfDocument;
  try {
    document_ = await pdfjs.getDocument({ data, worker, isEvalSupported: false }).promise;
  } catch (error) {
    worker.destroy();
    port.terminate();
    throw error;
  }

  let closed = false;

  return {
    numPages: document_.numPages,

    async size(pageNumber) {
      const page = await document_.getPage(clamp(pageNumber, document_.numPages));
      const view = page.getViewport({ scale: 1 });
      page.cleanup();
      return { cssWidth: (view.width * 4) / 3, cssHeight: (view.height * 4) / 3 };
    },

    async render(pageNumber, pixelWidth) {
      if (closed) throw new Error('preview session closed');

      const page = await document_.getPage(clamp(pageNumber, document_.numPages));
      const base = page.getViewport({ scale: 1 });
      const width = Math.max(200, Math.min(pixelWidth, MAX_RENDER_EDGE));
      const viewport = page.getViewport({ scale: width / base.width });

      const canvas = window.document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.min(MAX_RENDER_EDGE, Math.ceil(viewport.height));

      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;

      // JPEG rather than PNG: these are photographic pages, and a lossless data URL of a
      // 4000px render is tens of megabytes of string held in memory.
      const url = canvas.toDataURL('image/jpeg', 0.92);
      page.cleanup();
      canvas.width = canvas.height = 0;
      return url;
    },

    destroy() {
      if (closed) return;
      closed = true;
      void document_
        .destroy()
        .catch(() => {})
        .finally(() => {
          worker.destroy();
          port.terminate();
        });
    },
  };
}

function clamp(pageNumber: number, total: number): number {
  return Math.max(1, Math.min(total, pageNumber));
}
