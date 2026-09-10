import { COPY_LIMITS, type AssetPurpose } from '@/lib/presentations/manifest';
import { GUTTER, MARGIN, SLIDE } from '../brand';
import { addPill, addRect } from '../overlays';
import { addFittedText, type Box } from '../text';
import {
  addDecorative,
  addLogo,
  addPageNumber,
  copyField,
  LOGO_CLEARANCE,
  photoOrPlaceholder,
  type LayoutRenderer,
} from './shared';

/**
 * `hotel_comparison` — up to three accommodation options side by side.
 *
 * Each column takes its photo from the matching purpose (primary, secondary, tertiary); a
 * named hotel without an approved photo gets the branded placeholder, never a stock room.
 */
const COLUMN_PURPOSE: AssetPurpose[] = ['primary_photo', 'secondary_photo', 'tertiary_photo'];

export const hotelComparison: LayoutRenderer = (ctx) => {
  const { slide, style, tokens } = ctx;
  slide.background = { color: tokens.surface };

  const title = copyField(ctx, 'title') ?? '';
  const options = (ctx.spec.copy.options ?? []).slice(0, COPY_LIMITS.options);

  let y = LOGO_CLEARANCE - 0.2;
  const titleFit = addFittedText(slide, title, { x: MARGIN, y, w: SLIDE.w - 2 * MARGIN - 1.5, h: 1.0 }, style, {
    role: 'title',
    color: tokens.ink,
    warn: ctx.warn,
    label: `${ctx.spec.id} title`,
  });
  y += (titleFit.lines * titleFit.fontSize * 1.05) / 72 + 0.35;

  if (options.length === 0) {
    ctx.warn(`${ctx.spec.id}: an accommodation slide was planned without options.`);
    addLogo(ctx, false);
    return;
  }

  const cols = options.length;
  const gridW = SLIDE.w - 2 * MARGIN;
  const colW = (gridW - GUTTER * (cols - 1)) / cols;
  const colH = SLIDE.h - MARGIN - y;
  const photoH = Math.min(2.2, colH * 0.4);

  options.forEach((option, i) => {
    const box: Box = { x: MARGIN + i * (colW + GUTTER), y, w: colW, h: colH };
    addRect(slide, box, { color: tokens.cardFill, radius: tokens.radius, line: tokens.cardLine, shadow: style === 'immersive' });
    photoOrPlaceholder(ctx, COLUMN_PURPOSE[i], { x: box.x, y: box.y, w: box.w, h: photoH }, {
      rounding: true,
      caption: option.name,
    });

    const pad = 0.28;
    let cy = box.y + photoH + pad;
    const inner: Box = { x: box.x + pad, y: cy, w: box.w - 2 * pad, h: box.y + box.h - cy - pad };

    const nameFit = addFittedText(slide, option.name, { x: inner.x, y: cy, w: inner.w, h: 0.7 }, style, {
      role: 'cardTitle',
      color: tokens.ink,
      warn: ctx.warn,
      label: `${ctx.spec.id} option "${option.name}"`,
    });
    cy += (nameFit.lines * nameFit.fontSize * 1.1) / 72 + 0.08;

    if (option.location) {
      addFittedText(slide, option.location, { x: inner.x, y: cy, w: inner.w, h: 0.3 }, style, {
        role: 'caption',
        color: tokens.accentDeep,
        bold: true,
      });
      cy += 0.32;
    }

    const lines = [option.room, option.notes].filter(Boolean) as string[];
    const priceH = option.price ? 0.42 : 0;
    const detailH = Math.max(0.4, inner.y + inner.h - cy - priceH - (option.price ? 0.15 : 0));
    if (lines.length) {
      addFittedText(slide, lines.join('\n'), { x: inner.x, y: cy, w: inner.w, h: detailH }, style, {
        role: 'cardBody',
        color: tokens.inkMuted,
        warn: ctx.warn,
        label: `${ctx.spec.id} option "${option.name}"`,
      });
    }

    if (option.price) {
      const pillW = Math.min(inner.w, 0.5 + option.price.length * 0.11);
      const py = inner.y + inner.h - priceH;
      addPill(slide, { x: inner.x, y: py, w: pillW, h: priceH }, { color: tokens.accent });
      addFittedText(slide, option.price, { x: inner.x + 0.15, y: py, w: pillW - 0.3, h: priceH }, style, {
        role: 'stopLabel',
        color: tokens.ink,
        valign: 'middle',
        align: 'center',
      });
    }
  });

  addDecorative(ctx);
  addLogo(ctx, false);
  addPageNumber(ctx, tokens.inkMuted);
};
