import { COPY_LIMITS } from '@/lib/presentations/manifest';
import { MARGIN, SLIDE } from '../brand';
import { addPill, addRect } from '../overlays';
import { addBulletList, addFittedText, type Box } from '../text';
import {
  addDecorative,
  addLogo,
  addPageNumber,
  copyField,
  LOGO_CLEARANCE,
  photoOrPlaceholder,
  type LayoutRenderer,
  type RenderContext,
} from './shared';

/**
 * `split_photo_text` — the workhorse for itinerary days and overviews.
 *
 * The photo side alternates with the slide index so consecutive days do not read as the same
 * slide with the words swapped. Immersive bleeds the photo to the edge across 58% of the
 * width; minimal keeps it inset and rounded at 40% so the copy column has room for detail.
 */
export const splitPhotoText: LayoutRenderer = (ctx) => {
  const { slide, tokens } = ctx;
  const photoLeft = ctx.index % 2 === 0;
  const photoW = tokens.fullBleed ? SLIDE.w * 0.58 : SLIDE.w * 0.4;

  slide.background = { color: tokens.surface };

  const photoBox: Box = tokens.fullBleed
    ? { x: photoLeft ? 0 : SLIDE.w - photoW, y: 0, w: photoW, h: SLIDE.h }
    : {
        x: photoLeft ? MARGIN : SLIDE.w - MARGIN - photoW,
        y: MARGIN + 0.2,
        w: photoW,
        h: SLIDE.h - 2 * MARGIN - 0.2,
      };
  photoOrPlaceholder(ctx, 'primary_photo', photoBox, { rounding: !tokens.fullBleed });

  const copyX = photoLeft ? (tokens.fullBleed ? photoW + MARGIN : MARGIN + photoW + 0.55) : MARGIN;
  const copyW = SLIDE.w - photoW - (tokens.fullBleed ? 2 * MARGIN : 2 * MARGIN + 0.55);
  const copyBox: Box = {
    x: copyX,
    y: photoLeft ? MARGIN + 0.3 : LOGO_CLEARANCE,
    w: copyW,
    h: SLIDE.h - MARGIN - (photoLeft ? MARGIN + 0.3 : LOGO_CLEARANCE),
  };
  renderCopyColumn(ctx, copyBox);

  addDecorative(ctx);
  // The logo corner is over the photo when the photo is on the right.
  addLogo(ctx, !photoLeft && tokens.fullBleed);
  addPageNumber(ctx, tokens.inkMuted);
};

/** Day label pill, title, body, meta bullets — stacked, each taking the height it uses. */
export function renderCopyColumn(ctx: RenderContext, box: Box): void {
  const { slide, style, tokens } = ctx;
  const dayLabel = copyField(ctx, 'day_label');
  const eyebrow = copyField(ctx, 'eyebrow');
  const title = copyField(ctx, 'title') ?? '';
  const body = copyField(ctx, 'body');
  const meta = (ctx.spec.copy.meta ?? []).slice(0, COPY_LIMITS.meta_items);

  let y = box.y;
  const label = dayLabel ?? eyebrow;
  if (label) {
    const text = label.toUpperCase();
    const pillW = Math.min(box.w, 0.32 + text.length * 0.105);
    addPill(slide, { x: box.x, y, w: pillW, h: 0.34 }, { color: dayLabel ? tokens.accent : tokens.cardFill });
    addFittedText(slide, text, { x: box.x + 0.16, y: y + 0.02, w: pillW - 0.32, h: 0.3 }, style, {
      role: 'dayLabel',
      color: dayLabel ? tokens.ink : tokens.accentDeep,
      valign: 'middle',
      align: 'center',
    });
    y += 0.34 + 0.3;
  }

  const titleFit = addFittedText(slide, title, { x: box.x, y, w: box.w, h: Math.min(2.2, box.h * 0.4) }, style, {
    role: 'title',
    color: tokens.ink,
    warn: ctx.warn,
    label: `${ctx.spec.id} title`,
  });
  y += (titleFit.lines * titleFit.fontSize * 1.05) / 72 + 0.28;

  const remaining = box.y + box.h - y;
  const metaH = meta.length ? Math.min(remaining * 0.45, 0.28 * meta.length + 0.2) : 0;
  const bodyH = Math.max(0.5, remaining - metaH - (meta.length ? 0.25 : 0));

  if (body) {
    const fit = addFittedText(slide, body, { x: box.x, y, w: box.w, h: bodyH }, style, {
      role: 'body',
      color: tokens.inkMuted,
      warn: ctx.warn,
      label: `${ctx.spec.id} body`,
    });
    y += Math.min(bodyH, (fit.lines * fit.fontSize * 1.4) / 72) + 0.25;
  }

  if (meta.length) {
    const h = Math.max(0.3, box.y + box.h - y);
    addRect(slide, { x: box.x, y: y - 0.05, w: 0.05, h: Math.min(h, 0.3 * meta.length) }, { color: tokens.accent });
    addBulletList(slide, meta, { x: box.x + 0.22, y, w: box.w - 0.22, h }, style, {
      role: 'meta',
      color: tokens.ink,
      warn: ctx.warn,
      label: `${ctx.spec.id} details`,
      maxItems: COPY_LIMITS.meta_items,
    });
  }
}
