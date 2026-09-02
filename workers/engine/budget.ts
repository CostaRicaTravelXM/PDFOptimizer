/**
 * How many pixels a page's worth of image detail is actually worth.
 *
 * Shared by both engines so a flattened page and a recompressed image land on the same
 * resolution, and a file that falls back from one to the other does not visibly change.
 */

import type { PDFDocument } from 'pdf-lib';

/**
 * The largest physical page we will plan for, in inches (A4's long edge).
 *
 * Design tools declare enormous page boxes — the reference itinerary is a 20 inch wide
 * Canva slide. Budgeting resolution against that literal size is what a naive
 * implementation does, and it is wrong twice over: it reserves detail for a 20 inch print
 * nobody makes, and it leaves the file barely smaller than it started. Whatever the page
 * claims, it will be read on a screen or printed onto ordinary paper, so we size for that.
 *
 * Measured on the reference file: removing this clamp takes a 121 MB itinerary only down to
 * 41 MB. With it, the same file and settings reach 14 MB.
 */
export const MAX_ASSUMED_PAGE_INCHES = 11.7;

/** Longest page edge in inches, clamped to a realistic sheet of paper. */
export function assumedPageInches(pdf: PDFDocument): number {
  let longestPoints = 0;
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    longestPoints = Math.max(longestPoints, width, height);
  }
  if (!longestPoints) longestPoints = 792; // Letter height, as a sane floor
  return Math.min(longestPoints / 72, MAX_ASSUMED_PAGE_INCHES);
}

/**
 * Pixel budget for the longest edge of any image.
 *
 * Working out each image's true on-page scale would mean parsing every content stream's
 * transformation matrix. Instead we cap against the largest page: an image can never
 * usefully carry more detail than a full-bleed placement, so this captures nearly the whole
 * win for a fraction of the complexity. An inset photo keeps more pixels than it strictly
 * needs, which is a fair trade.
 */
export function maxEdgePixels(pdf: PDFDocument, dpi: number): number {
  return Math.round(assumedPageInches(pdf) * dpi);
}
