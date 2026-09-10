import { COPY_LIMITS } from '@/lib/presentations/manifest';
import { MARGIN, PALETTE, SLIDE } from '../brand';
import { addCircle, addGradientOverlay, addLine } from '../overlays';
import { addFittedText, type Box } from '../text';
import {
  addDecorative,
  addLogo,
  addPageNumber,
  copyField,
  FULL,
  LOGO_CLEARANCE,
  photo,
  photoOrPlaceholder,
  wantsPhoto,
  type LayoutRenderer,
} from './shared';

/**
 * `timeline_route` — the trip at a glance: up to seven stops on one line.
 *
 * Immersive may sit the timeline over a scrimmed destination photo when the plan supplied a
 * background; otherwise both styles draw it on the surface colour. Labels alternate above
 * and below the line when there are many stops so neighbours do not collide.
 */
export const timelineRoute: LayoutRenderer = (ctx) => {
  const { slide, style, tokens } = ctx;
  const stops = (ctx.spec.copy.stops ?? []).slice(0, COPY_LIMITS.stops);
  const onPhoto = tokens.fullBleed && (wantsPhoto(ctx, 'background') || !!photo(ctx, 'background'));

  if (onPhoto) {
    photoOrPlaceholder(ctx, 'background', FULL);
    addGradientOverlay(slide, FULL, 'down');
    addGradientOverlay(slide, { x: 0, y: 0, w: SLIDE.w, h: SLIDE.h * 0.5 }, 'up');
  } else {
    slide.background = { color: tokens.surface };
  }

  const ink = onPhoto ? PALETTE.white : tokens.ink;
  const muted = onPhoto ? tokens.onPhotoMuted : tokens.inkMuted;
  const accent = onPhoto ? tokens.accent : tokens.accentDeep;

  const eyebrow = copyField(ctx, 'eyebrow');
  const title = copyField(ctx, 'title') ?? '';
  const subtitle = copyField(ctx, 'subtitle') ?? copyField(ctx, 'body');

  let y = LOGO_CLEARANCE - 0.2;
  if (eyebrow) {
    addFittedText(slide, eyebrow.toUpperCase(), { x: MARGIN, y, w: 8, h: 0.35 }, style, { role: 'eyebrow', color: accent });
    y += 0.45;
  }
  const titleFit = addFittedText(slide, title, { x: MARGIN, y, w: SLIDE.w - 2 * MARGIN - 1.5, h: 1.3 }, style, {
    role: 'title',
    color: ink,
    warn: ctx.warn,
    label: `${ctx.spec.id} title`,
  });
  y += (titleFit.lines * titleFit.fontSize * 1.05) / 72 + 0.2;
  if (subtitle) {
    addFittedText(slide, subtitle, { x: MARGIN, y, w: SLIDE.w * 0.6, h: 0.8 }, style, {
      role: 'subtitle',
      color: muted,
      warn: ctx.warn,
      label: `${ctx.spec.id} subtitle`,
    });
  }

  if (stops.length === 0) {
    ctx.warn(`${ctx.spec.id}: a route slide was planned without stops.`);
    addLogo(ctx, onPhoto);
    return;
  }

  const lineY = 4.75;
  const x0 = MARGIN + 0.5;
  const x1 = SLIDE.w - MARGIN - 0.5;
  addLine(slide, { x: x0, y: lineY }, { x: x1, y: lineY }, { color: onPhoto ? PALETTE.white : tokens.cardLine, width: 2 });

  const step = stops.length > 1 ? (x1 - x0) / (stops.length - 1) : 0;
  const labelW = Math.min(2.4, stops.length > 1 ? step * 0.95 : 4);
  const alternate = stops.length > 4;

  stops.forEach((stop, i) => {
    const cx = stops.length > 1 ? x0 + step * i : (x0 + x1) / 2;
    addCircle(slide, cx, lineY, 0.2, { color: accent, line: onPhoto ? PALETTE.white : tokens.surface });
    slide.addText(String(i + 1), {
      x: cx - 0.2,
      y: lineY - 0.2,
      w: 0.4,
      h: 0.4,
      margin: 0,
      fontFace: 'DM Sans',
      fontSize: 10,
      bold: true,
      color: onPhoto ? tokens.ink : PALETTE.white,
      align: 'center',
      valign: 'middle',
      isTextBox: true,
    });

    const above = alternate && i % 2 === 1;
    const labelBox: Box = above
      ? { x: cx - labelW / 2, y: lineY - 0.45 - 0.9, w: labelW, h: 0.9 }
      : { x: cx - labelW / 2, y: lineY + 0.4, w: labelW, h: 0.95 };
    const parts = [stop.label, stop.sublabel, stop.date].filter(Boolean) as string[];
    slide.addText(
      parts.map((p, j) => ({
        text: p,
        options: {
          fontFace: 'DM Sans',
          fontSize: j === 0 ? 13 : 10,
          bold: j === 0,
          color: j === 0 ? ink : muted,
          breakLine: j < parts.length - 1,
        },
      })),
      {
        x: labelBox.x,
        y: labelBox.y,
        w: labelBox.w,
        h: labelBox.h,
        margin: 0,
        align: 'center',
        valign: above ? 'bottom' : 'top',
        lineSpacingMultiple: 1.15,
        fit: 'none',
        wrap: true,
        isTextBox: true,
      },
    );
  });

  addDecorative(ctx, { onDark: onPhoto });
  addLogo(ctx, onPhoto);
  addPageNumber(ctx, muted);
};
