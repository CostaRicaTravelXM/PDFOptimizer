/**
 * Low-level image plumbing for the Smart engine.
 *
 * Everything here is pure byte/canvas work with no pdf-lib dependency, so it can be
 * reasoned about on its own. `smart.ts` owns all the PDF dictionary logic.
 */

/** Inflate a PDF FlateDecode stream. Tries zlib framing first, then raw deflate. */
export async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    return await pipeThrough(bytes, 'deflate', false);
  } catch {
    // Some producers emit headerless deflate despite the spec.
    return await pipeThrough(bytes, 'deflate-raw', false);
  }
}

/** Deflate bytes into zlib-framed output suitable for a FlateDecode stream. */
export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(bytes, 'deflate', true);
}

async function pipeThrough(
  bytes: Uint8Array,
  format: 'deflate' | 'deflate-raw',
  compress: boolean,
): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream();
  const transformed = compress
    ? stream.pipeThrough(new CompressionStream(format))
    : stream.pipeThrough(new DecompressionStream(format));
  const buf = await new Response(transformed).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Undo the row-wise predictor applied before Flate compression.
 *
 * Design-tool exports (Canva, Chrome print-to-PDF) routinely use PNG predictor 12
 * (`/Predictor 12 /Colors 3 /Columns w`). Decoding without reversing it yields garbage,
 * so this is not optional.
 */
export function undoPredictor(
  data: Uint8Array,
  predictor: number,
  colors: number,
  bitsPerComponent: number,
  columns: number,
): Uint8Array {
  if (predictor < 2) return data;

  const bpp = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
  const rowLen = Math.ceil((colors * bitsPerComponent * columns) / 8);

  if (predictor === 2) {
    // TIFF predictor: horizontal differencing. Only 8bpc is handled; others pass through.
    if (bitsPerComponent !== 8) return data;
    const rows = Math.floor(data.length / rowLen);
    for (let r = 0; r < rows; r++) {
      const off = r * rowLen;
      for (let i = bpp; i < rowLen; i++) {
        data[off + i] = (data[off + i] + data[off + i - bpp]) & 0xff;
      }
    }
    return data;
  }

  // PNG predictors (10-15): each row is prefixed with a filter-type byte.
  const stride = rowLen + 1;
  const rows = Math.floor(data.length / stride);
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);

  for (let r = 0; r < rows; r++) {
    const filter = data[r * stride];
    const src = data.subarray(r * stride + 1, r * stride + 1 + rowLen);
    const cur = out.subarray(r * rowLen, (r + 1) * rowLen);
    cur.set(src);

    switch (filter) {
      case 0: // None
        break;
      case 1: // Sub
        for (let i = bpp; i < rowLen; i++) cur[i] = (cur[i] + cur[i - bpp]) & 0xff;
        break;
      case 2: // Up
        for (let i = 0; i < rowLen; i++) cur[i] = (cur[i] + prev[i]) & 0xff;
        break;
      case 3: // Average
        for (let i = 0; i < rowLen; i++) {
          const left = i >= bpp ? cur[i - bpp] : 0;
          cur[i] = (cur[i] + ((left + prev[i]) >> 1)) & 0xff;
        }
        break;
      case 4: // Paeth
        for (let i = 0; i < rowLen; i++) {
          const a = i >= bpp ? cur[i - bpp] : 0;
          const b = prev[i];
          const c = i >= bpp ? prev[i - bpp] : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          cur[i] = (cur[i] + pred) & 0xff;
        }
        break;
      default:
        break; // Unknown filter byte: leave the row alone rather than corrupt it.
    }
    prev = cur;
  }
  return out;
}

/** Expand raw 8-bpc samples (1 or 3 components) into RGBA ImageData. */
export function samplesToImageData(
  samples: Uint8Array,
  width: number,
  height: number,
  components: 1 | 3,
): ImageData {
  const px = width * height;
  const rgba = new Uint8ClampedArray(px * 4);

  if (components === 3) {
    for (let i = 0, s = 0, d = 0; i < px; i++, s += 3, d += 4) {
      rgba[d] = samples[s];
      rgba[d + 1] = samples[s + 1];
      rgba[d + 2] = samples[s + 2];
      rgba[d + 3] = 255;
    }
  } else {
    for (let i = 0, d = 0; i < px; i++, d += 4) {
      const g = samples[i];
      rgba[d] = g;
      rgba[d + 1] = g;
      rgba[d + 2] = g;
      rgba[d + 3] = 255;
    }
  }
  return new ImageData(rgba, width, height);
}

export interface Fit {
  width: number;
  height: number;
  scaled: boolean;
}

/** Constrain the longest edge to `maxEdge`, preserving aspect ratio. Never upscales. */
export function fitWithin(width: number, height: number, maxEdge: number): Fit {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height, scaled: false };
  const k = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
    scaled: true,
  };
}

/**
 * Draw a source into a canvas at the target size.
 *
 * Reductions beyond 2x are done in successive halvings: a single large downscale step
 * aliases badly on detailed travel photography, which would defeat the whole
 * "keeps the quality" promise.
 */
export function resample(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): OffscreenCanvas {
  let curW = srcW;
  let curH = srcH;
  let current: CanvasImageSource = source;
  let scratch: OffscreenCanvas | null = null;

  while (curW / 2 > dstW && curH / 2 > dstH) {
    const halfW = Math.max(dstW, Math.floor(curW / 2));
    const halfH = Math.max(dstH, Math.floor(curH / 2));
    const next = new OffscreenCanvas(halfW, halfH);
    const nctx = next.getContext('2d')!;
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(current, 0, 0, curW, curH, 0, 0, halfW, halfH);
    release(scratch); // free the previous step before allocating the next
    scratch = next;
    current = next;
    curW = halfW;
    curH = halfH;
  }

  const out = new OffscreenCanvas(dstW, dstH);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, curW, curH, 0, 0, dstW, dstH);
  release(scratch);
  return out;
}

/** Put ImageData onto a canvas without any scaling. */
export function canvasFromImageData(img: ImageData): OffscreenCanvas {
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

export async function toJpeg(canvas: OffscreenCanvas, quality: number): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Pull a single 8-bit channel (R) out of a canvas, for grayscale soft-masks. */
export function extractGray(canvas: OffscreenCanvas): Uint8Array {
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height);
  const gray = new Uint8Array(width * height);
  for (let i = 0, s = 0; i < gray.length; i++, s += 4) gray[i] = data[s];
  return gray;
}

/** True when every sample is 255: such a soft-mask is fully opaque and can be dropped. */
export function isOpaque(gray: Uint8Array): boolean {
  for (let i = 0; i < gray.length; i++) if (gray[i] !== 255) return false;
  return true;
}

/** Free a canvas's backing store immediately rather than waiting for GC. */
export function release(canvas: OffscreenCanvas | null): void {
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes); // detach-safe copy for crypto.subtle
  const digest = await crypto.subtle.digest('SHA-256', view);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
