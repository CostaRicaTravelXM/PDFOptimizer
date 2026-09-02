/**
 * Smart engine: recompress the embedded image streams, leave everything else alone.
 *
 * Text, fonts, vectors, links and page structure survive untouched, which is what makes an
 * optimized itinerary still searchable and selectable for the client who receives it.
 *
 * The bet this engine makes is simple: design-tool exports embed photos at camera resolution
 * (the reference file carries 348 megapixels across 13 pages, most of it stored uncompressed).
 * Nobody can see more pixels than the page can print, so capping resolution and re-encoding
 * as JPEG is nearly free visually and enormous in bytes.
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from 'pdf-lib';
import type { OptimizeOptions, OptimizeResult, OptimizeStats } from '@/lib/types';
import { PRESETS } from './presets';
import { maxEdgePixels } from './budget';
import {
  canvasFromImageData,
  deflate,
  extractGray,
  fitWithin,
  inflate,
  isOpaque,
  release,
  resample,
  samplesToImageData,
  sha256,
  toJpeg,
  undoPredictor,
} from './images';

export type ProgressFn = (fraction: number, phase: string) => void;

/** What we learned about one image XObject before deciding whether to touch it. */
interface ImageInfo {
  ref: PDFRef;
  stream: PDFRawStream;
  dict: PDFDict;
  width: number;
  height: number;
  bpc: number;
  filter: string | null;
  /** Component count once the colorspace is resolved: 1 (gray) or 3 (rgb). */
  components: 1 | 3 | null;
  isSoftMask: boolean;
}

const N = (name: string) => PDFName.of(name);

export async function optimizeSmart(
  bytes: Uint8Array,
  options: OptimizeOptions,
  onProgress: ProgressFn,
): Promise<OptimizeResult> {
  const preset = PRESETS[options.preset];

  onProgress(0.02, 'Reading the file');
  const pdf = await PDFDocument.load(bytes, {
    updateMetadata: false,
    ignoreEncryption: false,
  });

  const stats: OptimizeStats = {
    pages: pdf.getPageCount(),
    imagesOptimized: 0,
    imagesSkipped: 0,
    imagesDeduped: 0,
    masksDropped: 0,
  };

  const maxEdge = maxEdgePixels(pdf, preset.dpi);

  // Soft-masks are referenced from their parent image; note them so they get grayscale
  // treatment rather than being written back as a 3-channel JPEG.
  const softMaskRefs = new Set<string>();
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const sm = obj.dict.get(N('SMask'));
      if (sm instanceof PDFRef) softMaskRefs.add(sm.toString());
    }
  }

  onProgress(0.06, 'Finding images');
  const images: ImageInfo[] = [];
  for (const [ref, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(N('Subtype'))?.toString() !== '/Image') continue;

    const width = numberOf(pdf, dict.get(N('Width')));
    const height = numberOf(pdf, dict.get(N('Height')));
    if (!width || !height) continue;

    images.push({
      ref,
      stream: obj,
      dict,
      width,
      height,
      bpc: numberOf(pdf, dict.get(N('BitsPerComponent'))) ?? 8,
      filter: filterName(pdf, dict),
      components: resolveComponents(pdf, dict),
      isSoftMask: softMaskRefs.has(ref.toString()),
    });
  }

  // Identical streams are common: exports repeat logos, dividers and page furniture on
  // every page. Encode each distinct stream once and point the rest at the same object.
  const encoded = new Map<string, { bytes: Uint8Array; dict: PDFDict } | 'skip'>();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    onProgress(0.08 + 0.84 * (i / Math.max(1, images.length)), 'Shrinking images');

    const original = img.stream.getContents();
    const key = await sha256(original);

    const cached = encoded.get(key);
    if (cached) {
      if (cached === 'skip') {
        stats.imagesSkipped++;
      } else {
        pdf.context.assign(img.ref, PDFRawStream.of(cached.dict.clone(pdf.context), cached.bytes));
        stats.imagesOptimized++;
        stats.imagesDeduped++;
      }
      continue;
    }

    let outcome: { bytes: Uint8Array; dict: PDFDict } | 'skip';
    try {
      outcome = await recompress(pdf, img, original, maxEdge, preset.quality, stats);
    } catch {
      // A single awkward image must never cost the user the whole file.
      outcome = 'skip';
    }

    encoded.set(key, outcome);
    if (outcome === 'skip') {
      stats.imagesSkipped++;
    } else {
      pdf.context.assign(img.ref, PDFRawStream.of(outcome.dict, outcome.bytes));
      stats.imagesOptimized++;
    }
  }

  onProgress(0.94, 'Rebuilding the PDF');
  pdf.setProducer('TravelXM PDF Optimizer');

  const out = await pdf.save({ useObjectStreams: true, addDefaultPage: false });
  onProgress(1, 'Done');

  return { bytes: out, engine: 'smart', stats };
}

/**
 * Recompress one image, or report that it should be left untouched.
 *
 * Anything whose encoding cannot be converted with confidence is skipped rather than
 * guessed at — a slightly larger file beats a corrupted one.
 */
async function recompress(
  pdf: PDFDocument,
  img: ImageInfo,
  original: Uint8Array,
  maxEdge: number,
  quality: number,
  stats: OptimizeStats,
): Promise<{ bytes: Uint8Array; dict: PDFDict } | 'skip'> {
  // Colour-key masking matches exact pixel values; lossy re-encoding would break it.
  if (img.dict.get(N('Mask')) instanceof PDFArray) return 'skip';
  // A /Decode array remaps samples. Rare, and not worth reproducing through a JPEG.
  if (img.dict.has(N('Decode'))) return 'skip';
  if (img.bpc !== 8) return 'skip';
  if (img.components === null) return 'skip';

  // Soft-masks get the same pixel budget as the images they cut out. Giving them less was
  // measurably worse: an alpha edge sits on the silhouette of a photograph, and coarsening
  // it stair-steps that outline where the eye is most likely to be looking. It saved about
  // a megabyte in fourteen and cost 0.6 dB, which is the wrong side of that trade.
  const fit = fitWithin(img.width, img.height, maxEdge);

  let source: OffscreenCanvas | null = null;
  let bitmap: ImageBitmap | null = null;

  try {
    if (img.filter === 'DCTDecode') {
      // Already JPEG. Only worth reprocessing if we can actually shrink the pixel count.
      if (!fit.scaled) return 'skip';
      bitmap = await createImageBitmap(
        new Blob([new Uint8Array(original) as BlobPart], { type: 'image/jpeg' }),
      );
      source = resample(bitmap, bitmap.width, bitmap.height, fit.width, fit.height);
    } else if (img.filter === 'FlateDecode') {
      const raw = await inflate(original);
      const { predictor, colors, columns } = decodeParms(pdf, img);
      const samples = undoPredictor(
        raw,
        predictor,
        colors || img.components,
        img.bpc,
        columns || img.width,
      );

      const expected = img.width * img.height * img.components;
      if (samples.length < expected) return 'skip'; // truncated or misread; do not risk it

      const full = canvasFromImageData(
        samplesToImageData(samples, img.width, img.height, img.components),
      );
      source = fit.scaled ? resample(full, img.width, img.height, fit.width, fit.height) : full;
      if (source !== full) release(full);
    } else {
      // JPXDecode, CCITTFaxDecode, JBIG2Decode, LZW, filter chains: out of scope by design.
      return 'skip';
    }

    if (img.isSoftMask) {
      // Alpha channels must stay single-component DeviceGray, so they go back as Flate
      // rather than JPEG. The win here is the pixel reduction, not the codec.
      const gray = extractGray(source);

      if (isOpaque(gray)) {
        // A mask that is opaque everywhere does nothing. Drop the payload to a 1x1 stub;
        // the parent's /SMask reference stays valid and costs nothing.
        stats.masksDropped++;
        const stub = await deflate(new Uint8Array([255]));
        return { bytes: stub, dict: grayDict(pdf, img, 1, 1) };
      }

      const packed = await deflate(gray);
      if (packed.length >= original.length) return 'skip';
      return { bytes: packed, dict: grayDict(pdf, img, source.width, source.height) };
    }

    const jpeg = await toJpeg(source, quality);
    if (jpeg.length >= original.length) return 'skip'; // no win; keep the original bytes
    return { bytes: jpeg, dict: jpegDict(pdf, img, source.width, source.height) };
  } finally {
    release(source);
    bitmap?.close();
  }
}

/** Build the replacement dict for a JPEG-encoded colour image. */
function jpegDict(pdf: PDFDocument, img: ImageInfo, width: number, height: number): PDFDict {
  const dict = img.dict.clone(pdf.context);
  dict.set(N('Width'), PDFNumber.of(width));
  dict.set(N('Height'), PDFNumber.of(height));
  dict.set(N('BitsPerComponent'), PDFNumber.of(8));
  dict.set(N('ColorSpace'), N('DeviceRGB'));
  dict.set(N('Filter'), N('DCTDecode'));
  dict.delete(N('DecodeParms'));
  dict.delete(N('Length'));
  return dict;
}

/** Build the replacement dict for a Flate-encoded grayscale soft-mask. */
function grayDict(pdf: PDFDocument, img: ImageInfo, width: number, height: number): PDFDict {
  const dict = img.dict.clone(pdf.context);
  dict.set(N('Width'), PDFNumber.of(width));
  dict.set(N('Height'), PDFNumber.of(height));
  dict.set(N('BitsPerComponent'), PDFNumber.of(8));
  dict.set(N('ColorSpace'), N('DeviceGray'));
  dict.set(N('Filter'), N('FlateDecode'));
  dict.delete(N('DecodeParms'));
  dict.delete(N('Length'));
  return dict;
}

function numberOf(pdf: PDFDocument, value: unknown): number | null {
  const resolved = value instanceof PDFRef ? pdf.context.lookup(value) : value;
  return resolved instanceof PDFNumber ? resolved.asNumber() : null;
}

function filterName(pdf: PDFDocument, dict: PDFDict): string | null {
  const filter = pdf.context.lookup(dict.get(N('Filter')));
  if (filter instanceof PDFName) return filter.asString().slice(1);
  if (filter instanceof PDFArray) {
    // Only single-filter chains are safe to reinterpret.
    if (filter.size() !== 1) return null;
    const only = pdf.context.lookup(filter.get(0));
    return only instanceof PDFName ? only.asString().slice(1) : null;
  }
  return null;
}

function decodeParms(
  pdf: PDFDocument,
  img: ImageInfo,
): { predictor: number; colors: number; columns: number } {
  let parms = pdf.context.lookup(img.dict.get(N('DecodeParms')));
  if (parms instanceof PDFArray) parms = pdf.context.lookup(parms.get(0));
  if (!(parms instanceof PDFDict)) return { predictor: 1, colors: 0, columns: 0 };

  return {
    predictor: numberOf(pdf, parms.get(N('Predictor'))) ?? 1,
    colors: numberOf(pdf, parms.get(N('Colors'))) ?? 0,
    columns: numberOf(pdf, parms.get(N('Columns'))) ?? 0,
  };
}

/**
 * Resolve a colourspace down to a component count we can render.
 *
 * Returns null for anything we will not touch: Indexed palettes, CMYK, Separation and
 * DeviceN all need colour conversion that a canvas cannot do faithfully.
 */
function resolveComponents(pdf: PDFDocument, dict: PDFDict): 1 | 3 | null {
  const cs = pdf.context.lookup(dict.get(N('ColorSpace')));

  if (cs instanceof PDFName) {
    const name = cs.asString();
    if (name === '/DeviceRGB' || name === '/CalRGB') return 3;
    if (name === '/DeviceGray' || name === '/CalGray' || name === '/G') return 1;
    return null;
  }

  if (cs instanceof PDFArray && cs.size() >= 2) {
    const family = pdf.context.lookup(cs.get(0));
    if (!(family instanceof PDFName)) return null;

    // The overwhelmingly common case in design-tool exports: [/ICCBased <stream>].
    if (family.asString() === '/ICCBased') {
      const profile = pdf.context.lookup(cs.get(1));
      const n = profile instanceof PDFRawStream ? numberOf(pdf, profile.dict.get(N('N'))) : null;
      if (n === 3) return 3;
      if (n === 1) return 1;
      return null; // N === 4 is CMYK
    }

    if (family.asString() === '/CalRGB') return 3;
    if (family.asString() === '/CalGray') return 1;
    return null;
  }

  // Absent colourspace on an image is only legal for image masks, which we skip anyway.
  return null;
}
