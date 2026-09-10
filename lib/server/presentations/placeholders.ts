import type PptxGenJS from 'pptxgenjs';
import { FONTS, PALETTE, type StyleTokens } from './brand';
import { addCircle, addRect } from './overlays';
import type { Box } from './text';

/**
 * What goes where a photo should be when no safe photo exists.
 *
 * The spec is explicit: a named hotel with no approved photo gets a branded composition,
 * never a stock picture of some other hotel. The composition is deterministic per slide id
 * so a re-run of the same brief looks the same, and it is built from native shapes so an
 * editor in Canva can recolour or delete it in one click.
 */

const TINTS = [PALETTE.sky, PALETTE.accentDeep, PALETTE.navy, PALETTE.sand, PALETTE.coral];

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function addPlaceholder(
  slide: PptxGenJS.Slide,
  box: Box,
  seed: string,
  tokens: StyleTokens,
  opts: { caption?: string; radius?: number } = {},
): void {
  const h = hashSeed(seed);
  const tint = TINTS[h % TINTS.length];
  const tint2 = TINTS[((h >>> 3) % TINTS.length + 1) % TINTS.length];

  addRect(slide, box, { color: tint, radius: opts.radius ?? (tokens.fullBleed ? 0 : tokens.radius) });

  // Two soft circles, offset by the hash so no two placeholders in a deck sit identically.
  // Shapes are not clipped to the box, so each circle is kept inside it outright.
  const inside = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const r1 = Math.min(box.w, box.h) * (0.3 + ((h >>> 6) % 15) / 100);
  const cx1 = inside(box.x + box.w * (0.55 + ((h >>> 9) % 35) / 100), box.x + r1, box.x + box.w - r1);
  const cy1 = inside(box.y + box.h * (0.3 + ((h >>> 12) % 40) / 100), box.y + r1, box.y + box.h - r1);
  addCircle(slide, cx1, cy1, r1, { color: PALETTE.white, transparency: 82 });

  const r2 = Math.min(box.w, box.h) * (0.16 + ((h >>> 15) % 12) / 100);
  const cx2 = inside(box.x + box.w * (0.15 + ((h >>> 18) % 30) / 100), box.x + r2, box.x + box.w - r2);
  const cy2 = inside(box.y + box.h * (0.6 + ((h >>> 21) % 30) / 100), box.y + r2, box.y + box.h - r2);
  addCircle(slide, cx2, cy2, r2, { color: tint2, transparency: 55 });

  if (opts.caption && box.w > 1.6 && box.h > 0.9) {
    slide.addText(opts.caption, {
      x: box.x + 0.25,
      y: box.y + box.h - 0.55,
      w: Math.max(1, box.w - 0.5),
      h: 0.35,
      margin: 0,
      fontFace: FONTS.body,
      fontSize: 10,
      color: PALETTE.white,
      transparency: 20,
      align: 'left',
      valign: 'bottom',
      isTextBox: true,
    });
  }
}
