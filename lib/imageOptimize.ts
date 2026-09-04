import { contentTypeFor, type ArchiveEntry } from './emailZip';

/**
 * Shrink email images before they are hosted.
 *
 * Two levers, and the second one usually matters more: re-encoding to WebP, and capping the
 * pixel dimensions. Email builders routinely embed a 2000px photo in a 271px slot, and no
 * codec recovers what resizing does.
 *
 * All of it runs on canvas in the browser — no upload, no library.
 */

export interface OptimizeOptions {
  /** Re-encode to WebP. Off keeps the original format and only resizes. */
  webp: boolean;
  /** WebP quality, 0–1. */
  quality: number;
  /**
   * Longest edge, in pixels. Email bodies are ~600px wide, so 1200 covers a retina display
   * with room to spare.
   */
  maxEdge: number;
}

export const DEFAULT_OPTIONS: OptimizeOptions = {
  webp: true,
  quality: 0.82,
  maxEdge: 1200,
};

export interface OptimizedImage {
  /** Path to upload under — the extension changes when the format does. */
  path: string;
  /** Path as the HTML refers to it. What the rewrite must be keyed on. */
  originalPath: string;
  bytes: Uint8Array;
  contentType: string;
  originalSize: number;
  originalType: string;
  /** Set when the bytes are not the archive's originals. */
  changed: boolean;
  /** Why nothing was changed, when nothing was. Shown to the user rather than hidden. */
  note?: string;
  width?: number;
  height?: number;
}

/**
 * Formats left alone on purpose.
 *
 * SVG is vector: rasterising it would make it bigger and blurrier. GIF may be animated, and
 * a canvas only ever sees the first frame — silently dropping the animation would be worse
 * than shipping the original bytes.
 */
const NEVER_CONVERT = new Set(['image/svg+xml', 'image/gif']);

export async function optimizeImages(
  images: ArchiveEntry[],
  options: OptimizeOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<OptimizedImage[]> {
  const out: OptimizedImage[] = [];
  for (const [i, image] of images.entries()) {
    out.push(await optimizeOne(image, options));
    onProgress?.(i + 1, images.length);
  }
  return out;
}

async function optimizeOne(
  image: ArchiveEntry,
  options: OptimizeOptions,
): Promise<OptimizedImage> {
  const originalType = contentTypeFor(image.path)!;
  const base: OptimizedImage = {
    path: image.path,
    originalPath: image.path,
    bytes: image.bytes,
    contentType: originalType,
    originalSize: image.bytes.byteLength,
    originalType,
    changed: false,
  };

  if (NEVER_CONVERT.has(originalType)) {
    return { ...base, note: originalType === 'image/gif' ? 'GIF left as-is' : 'vector, left as-is' };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(
      new Blob([image.bytes.slice() as BlobPart], { type: originalType }),
    );
  } catch {
    // A file the browser cannot decode still deserves to be hosted; it just cannot be
    // improved here.
    return { ...base, note: 'could not be read, uploaded unchanged' };
  }

  const scale = Math.min(1, options.maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const targetType = options.webp ? 'image/webp' : originalType;

  // Nothing to do: same format, no resize.
  if (scale === 1 && targetType === originalType) {
    bitmap.close();
    return { ...base, width, height, note: 'already the right size' };
  }

  let encoded: Blob;
  try {
    encoded = await draw(bitmap, width, height, targetType, options.quality);
  } catch {
    bitmap.close();
    return { ...base, note: 'could not be re-encoded, uploaded unchanged' };
  } finally {
    bitmap.close();
  }

  // Re-encoding does not always win — a small PNG of flat colour can grow as WebP. Keep
  // whichever is actually smaller, and say so.
  if (encoded.size >= image.bytes.byteLength) {
    return { ...base, width: bitmap.width, height: bitmap.height, note: 'original was smaller' };
  }

  return {
    path: swapExtension(image.path, targetType),
    originalPath: image.path,
    bytes: new Uint8Array(await encoded.arrayBuffer()),
    contentType: targetType,
    originalSize: image.bytes.byteLength,
    originalType,
    changed: true,
    width,
    height,
  };
}

/**
 * OffscreenCanvas where it exists, a detached <canvas> otherwise. Safari only gained
 * OffscreenCanvas.convertToBlob recently, and this has to work in whatever the office has.
 */
async function draw(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  type: string,
  quality: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type, quality });
    // A browser that cannot encode the requested type quietly hands back a PNG.
    if (blob.type !== type) throw new Error(`${type} not supported`);
    return blob;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('encode failed'));
        if (blob.type !== type) return reject(new Error(`${type} not supported`));
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

const EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

function swapExtension(path: string, type: string): string {
  const ext = EXTENSIONS[type];
  if (!ext) return path;
  return path.replace(/\.[^./]+$/, '') + '.' + ext;
}

/** True once the browser is known to produce real WebP, so the UI can warn rather than fail. */
export async function supportsWebp(): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(new ImageData(1, 1));
    const blob = await draw(bitmap, 1, 1, 'image/webp', 0.8);
    bitmap.close();
    return blob.type === 'image/webp';
  } catch {
    return false;
  }
}
