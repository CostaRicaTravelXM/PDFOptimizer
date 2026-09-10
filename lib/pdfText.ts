'use client';

import { LIMITS } from '@/lib/presentations/types';

/**
 * Pull the text out of an itinerary PDF in the browser.
 *
 * The planner only needs words, and the browser already has pdf.js loaded for the
 * optimizer's preview. Extracting here means the 120 MB brief never has to travel through a
 * server function (which could not accept it anyway — the platform caps request bodies at
 * 4.5 MB) and the page can tell the user immediately whether the PDF has text at all.
 *
 * Same worker discipline as `lib/preview.ts`: a dedicated worker per document, torn down in
 * `finally`, so a failed extraction cannot leave a worker behind or clash with the preview's.
 */

type PdfJs = typeof import('pdfjs-dist/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/build/pdf.mjs');
  return pdfjsPromise;
}

export interface PdfTextResult {
  text: string;
  pageCount: number;
  textChars: number;
  /** Too little text per page to be a real text PDF — probably a scan or a design export. */
  textLow: boolean;
  /** True when the brief hit the size ceiling and the tail was dropped. */
  truncated: boolean;
}

interface TextItemLike {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
  height?: number;
}

export class PdfTextError extends Error {}

export async function extractPdfText(
  file: File,
  opts: { onProgress?: (page: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<PdfTextResult> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());

  const port = new Worker(new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url), {
    type: 'module',
  });
  const worker = pdfjs.PDFWorker.fromPort({ port })!;

  let document_: Awaited<ReturnType<PdfJs['getDocument']>['promise']> | null = null;
  try {
    document_ = await pdfjs.getDocument({ data, worker, isEvalSupported: false }).promise;
    const total = document_.numPages;
    const parts: string[] = [];
    let chars = 0;
    let truncated = false;

    for (let n = 1; n <= total; n++) {
      if (opts.signal?.aborted) throw new PdfTextError('Cancelled.');
      const page = await document_.getPage(n);
      const content = await page.getTextContent();
      const pageText = joinItems(content.items as TextItemLike[]);
      page.cleanup();
      opts.onProgress?.(n, total);

      if (!pageText) continue;
      const block = `\n\n=== Page ${n} ===\n\n${pageText}`;
      if (chars + block.length > LIMITS.TEXT_MAX_CHARS) {
        truncated = true;
        break;
      }
      parts.push(block);
      chars += block.length;
    }

    const text = parts.join('').trim();
    const perPage = total > 0 ? text.length / total : 0;
    return {
      text,
      pageCount: total,
      textChars: text.length,
      textLow: perPage < LIMITS.LOW_TEXT_CHARS_PER_PAGE,
      truncated,
    };
  } catch (error) {
    if (error instanceof PdfTextError) throw error;
    throw new PdfTextError(
      `That PDF could not be read: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  } finally {
    void document_
      ?.destroy()
      .catch(() => {})
      .finally(() => {
        worker.destroy();
        port.terminate();
      });
    if (!document_) {
      worker.destroy();
      port.terminate();
    }
  }
}

/**
 * pdf.js hands back positioned runs, not lines. Two runs belong to the same line when their
 * baselines are within half a glyph height; otherwise a newline goes between them. Without
 * this a two-column itinerary comes out as one long sentence with the columns interleaved.
 */
function joinItems(items: TextItemLike[]): string {
  let out = '';
  let lastY: number | null = null;
  let lastHeight = 0;

  for (const item of items) {
    const str = item.str ?? '';
    const y = item.transform?.[5];
    const height = item.height ?? lastHeight ?? 0;

    if (lastY !== null && y !== undefined && Math.abs(y - lastY) > Math.max(2, height * 0.5)) {
      out += '\n';
    } else if (out && !out.endsWith('\n') && !out.endsWith(' ') && str && !str.startsWith(' ')) {
      out += ' ';
    }
    out += str;
    if (item.hasEOL) out += '\n';
    if (y !== undefined) lastY = y;
    if (height) lastHeight = height;
  }

  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
