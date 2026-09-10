import type PptxGenJS from 'pptxgenjs';
import type { AssetPurpose, PresentationStyle, SlideSpec } from '@/lib/presentations/manifest';
import type { Language } from '@/lib/presentations/types';
import { LOGO, MARGIN, PALETTE, SLIDE, type StyleTokens } from '../brand';
import { LOGO_ASPECT, LOGO_PNG, LOGO_WHITE_PNG } from '../brand/embedded';
import { addContainImage, addCoverImage, type LoadedImage } from '../images';
import { addPill } from '../overlays';
import { addPlaceholder } from '../placeholders';
import { applyMaxChars, type Box } from '../text';

/**
 * What every layout renderer receives, and the handful of things they all do.
 */
export interface RenderContext {
  pptx: PptxGenJS;
  slide: PptxGenJS.Slide;
  style: PresentationStyle;
  language: Language;
  tokens: StyleTokens;
  spec: SlideSpec;
  index: number;
  total: number;
  images: Map<string, LoadedImage>;
  warn: (message: string) => void;
}

export type LayoutRenderer = (ctx: RenderContext) => void;

/** The loaded photo for a purpose on this slide, if the resolver delivered one. */
export function photo(ctx: RenderContext, purpose: AssetPurpose): LoadedImage | null {
  return ctx.images.get(`${ctx.spec.id}:${purpose}`) ?? null;
}

/** Whether the plan asked for this purpose at all — decides between placeholder and nothing. */
export function wantsPhoto(ctx: RenderContext, purpose: AssetPurpose): boolean {
  return (ctx.spec.assets ?? []).some((a) => a.purpose === purpose);
}

/**
 * Fill a box with the photo for `purpose`, or the branded placeholder. Layouts that need an
 * image in a spot always get one; the placeholder is what the spec asks for when no safe
 * photo exists.
 */
export function photoOrPlaceholder(
  ctx: RenderContext,
  purpose: AssetPurpose,
  box: Box,
  opts: { rounding?: boolean; caption?: string } = {},
): 'photo' | 'placeholder' {
  const image = photo(ctx, purpose);
  if (image) {
    addCoverImage(ctx.slide, image, box, {
      rounding: opts.rounding,
      altText: `${ctx.spec.copy.title ?? ctx.spec.id} photo`,
    });
    return 'photo';
  }
  addPlaceholder(ctx.slide, box, `${ctx.spec.id}:${purpose}`, ctx.tokens, {
    caption: opts.caption,
    radius: opts.rounding ? ctx.tokens.radius : 0,
  });
  return 'placeholder';
}

/** A copy field with the manifest's per-slide character ceiling applied. */
export function copyField(ctx: RenderContext, key: keyof SlideSpec['copy'] & string): string | undefined {
  const value = ctx.spec.copy[key];
  if (typeof value !== 'string') return undefined;
  const max = ctx.spec.layout_constraints?.[`${key}_max_chars`];
  return applyMaxChars(value, max);
}

/**
 * The logo lives in the top-right corner of every slide. What changes is the variant: the
 * white one over photos and dark panels, the colour one on light surfaces. When there is no
 * white variant, the colour logo sits on a small white pill so it stays legible on a photo.
 */
export function addLogo(ctx: RenderContext, onDark: boolean): void {
  const w = LOGO.w;
  const h = w / LOGO_ASPECT;
  const box: Box = { x: SLIDE.w - LOGO.margin - w, y: LOGO.margin, w, h };
  if (onDark && LOGO_WHITE_PNG) {
    addContainImage(ctx.slide, `image/png;base64,${LOGO_WHITE_PNG}`, LOGO_ASPECT, box, {
      altText: 'TravelXM',
    });
    return;
  }
  if (onDark) {
    addPill(ctx.slide, { x: box.x - 0.12, y: box.y - 0.08, w: box.w + 0.24, h: box.h + 0.16 }, {
      color: PALETTE.white,
      transparency: 10,
    });
  }
  addContainImage(ctx.slide, `image/png;base64,${LOGO_PNG}`, LOGO_ASPECT, box, {
    altText: 'TravelXM',
  });
}

/** Minimal decks number their slides; a reader flipping through a printed pack wants that. */
export function addPageNumber(ctx: RenderContext, color: string): void {
  if (!ctx.tokens.pageNumbers || ctx.index === 0) return;
  ctx.slide.addText(String(ctx.index + 1), {
    x: SLIDE.w - MARGIN - 0.6,
    y: SLIDE.h - 0.45,
    w: 0.6,
    h: 0.3,
    margin: 0,
    fontFace: 'DM Sans',
    fontSize: 9,
    color,
    align: 'right',
    valign: 'bottom',
    isTextBox: true,
  });
}

/**
 * One wildlife or decorative illustration per slide, immersive only, anchored bottom-right
 * where it reads as an accent rather than competing with the photo.
 */
export function addDecorative(ctx: RenderContext, opts: { onDark?: boolean } = {}): void {
  if (!ctx.tokens.decorative) return;
  const image = photo(ctx, 'decorative_element');
  if (!image) return;
  const size = 1.5;
  addContainImage(
    ctx.slide,
    image.data,
    image.width / image.height,
    { x: SLIDE.w - MARGIN - size, y: SLIDE.h - MARGIN - size, w: size, h: size },
    { altText: 'Decorative illustration', transparency: opts.onDark ? 0 : 6 },
  );
}

/** The full slide as a box. */
export const FULL: Box = { x: 0, y: 0, w: SLIDE.w, h: SLIDE.h };

/** The safe area inside the margins. */
export const SAFE: Box = {
  x: MARGIN,
  y: MARGIN,
  w: SLIDE.w - 2 * MARGIN,
  h: SLIDE.h - 2 * MARGIN,
};

/** Space at the top kept clear for the logo. */
export const LOGO_CLEARANCE = LOGO.margin + LOGO.w / LOGO_ASPECT + 0.25;
