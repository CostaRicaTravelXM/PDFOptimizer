import { imageSize } from 'image-size';
import type PptxGenJS from 'pptxgenjs';
import type { ResolvedAssets } from '@/lib/presentations/manifest';
import type { Box } from './text';

/**
 * Fetching and placing photographs.
 *
 * The compiler fetches every image itself rather than handing URLs to PptxGenJS: that way
 * there are timeouts, size caps, a content-type check and one download per distinct URL,
 * and a bad image degrades to a placeholder with a warning instead of a broken-picture icon
 * in the deck. Bytes go in as base64 `data`, which is the path PptxGenJS supports fully in
 * Node.
 *
 * No resizing happens here — there is no image library in the app, and the resolver already
 * picks a sensibly sized variant. Cropping is done by PowerPoint's own source rectangle
 * (`sizing: cover`), so the full photo survives into Canva and can be re-framed there.
 */

export interface LoadedImage {
  /** `image/jpeg;base64,…` as PptxGenJS wants it. */
  data: string;
  width: number;
  height: number;
  bytes: number;
  mime: 'image/jpeg' | 'image/png';
}

export interface LoadLimits {
  perImageBytes: number;
  totalBytes: number;
  timeoutMs: number;
  concurrency: number;
}

export const DEFAULT_LOAD_LIMITS: LoadLimits = {
  perImageBytes: 12 * 1024 * 1024,
  totalBytes: 120 * 1024 * 1024,
  timeoutMs: 10_000,
  concurrency: 6,
};

const ACCEPTED: Record<string, LoadedImage['mime']> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
};

async function fetchImage(url: string, limits: LoadLimits): Promise<LoadedImage> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('only https URLs are fetched');

  const response = await fetch(url, {
    signal: AbortSignal.timeout(limits.timeoutMs),
    headers: { accept: 'image/jpeg,image/png' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const declared = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > limits.perImageBytes) throw new Error('larger than the per-image limit');

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > limits.perImageBytes) throw new Error('larger than the per-image limit');

  // Trust the bytes over the header: some CDNs answer `application/octet-stream`.
  const info = imageSize(buffer);
  const sniffed = info.type === 'jpg' ? 'image/jpeg' : info.type === 'png' ? 'image/png' : declared;
  const mime = ACCEPTED[sniffed];
  if (!mime) throw new Error(`unsupported image type (${sniffed || 'unknown'})`);
  if (!info.width || !info.height) throw new Error('could not read image dimensions');

  return {
    data: `${mime};base64,${buffer.toString('base64')}`,
    width: info.width,
    height: info.height,
    bytes: buffer.byteLength,
    mime,
  };
}

export interface LoadResult {
  loaded: Map<string, LoadedImage>;
  warnings: string[];
}

/**
 * Resolve every asset reference to bytes, or to a warning. Placeholders are skipped — the
 * layouts draw those. Distinct references that share a URL share one download.
 */
export async function loadAssets(
  assets: ResolvedAssets,
  limits: LoadLimits = DEFAULT_LOAD_LIMITS,
): Promise<LoadResult> {
  const warnings: string[] = [];
  const loaded = new Map<string, LoadedImage>();
  const byUrl = new Map<string, Promise<LoadedImage>>();
  let total = 0;

  const entries = Object.entries(assets).filter(([, a]) => a.source !== 'placeholder' && a.url);
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= entries.length) return;
      const [ref, asset] = entries[i];
      try {
        let promise = byUrl.get(asset.url);
        if (!promise) {
          promise = fetchImage(asset.url, limits);
          byUrl.set(asset.url, promise);
        }
        const image = await promise;
        if (!loaded.has(ref)) {
          // Count each distinct download once towards the total.
          const firstUse = ![...loaded.values()].includes(image);
          if (firstUse) {
            if (total + image.bytes > limits.totalBytes) {
              throw new Error('the deck would exceed the total image budget');
            }
            total += image.bytes;
          }
          loaded.set(ref, image);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        warnings.push(`${ref}: photo could not be used (${reason}); a placeholder was drawn instead.`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limits.concurrency, entries.length) }, worker));
  return { loaded, warnings };
}

/**
 * Place an image so it fills the box, cropping the overflow.
 *
 * PptxGenJS computes the crop from the `w`/`h` it is given (treated as the picture's own
 * proportions) against `sizing.w`/`sizing.h` (the box). So the outer size is the photo's
 * aspect scaled up until it covers the box, and the crop is whatever hangs outside.
 */
export function addCoverImage(
  slide: PptxGenJS.Slide,
  image: LoadedImage,
  box: Box,
  opts: { rounding?: boolean; altText?: string } = {},
): void {
  const aspect = image.width / image.height;
  const boxAspect = box.w / box.h;
  const outer =
    aspect > boxAspect ? { w: box.h * aspect, h: box.h } : { w: box.w, h: box.w / aspect };
  slide.addImage({
    data: image.data,
    x: box.x,
    y: box.y,
    w: outer.w,
    h: outer.h,
    sizing: { type: 'cover', w: box.w, h: box.h },
    rounding: opts.rounding,
    altText: opts.altText,
  });
}

/** Fit inside the box without cropping, centred; for logos and illustrations. */
export function addContainImage(
  slide: PptxGenJS.Slide,
  data: string,
  aspect: number,
  box: Box,
  opts: { altText?: string; transparency?: number } = {},
): void {
  const boxAspect = box.w / box.h;
  const size = aspect > boxAspect ? { w: box.w, h: box.w / aspect } : { w: box.h * aspect, h: box.h };
  slide.addImage({
    data,
    x: box.x + (box.w - size.w) / 2,
    y: box.y + (box.h - size.h) / 2,
    w: size.w,
    h: size.h,
    altText: opts.altText,
    transparency: opts.transparency,
  });
}
