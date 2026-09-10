import { MARGIN, PALETTE, SLIDE } from '../brand';
import { addGradientOverlay, addPill, addRect } from '../overlays';
import { addFittedText, type Box } from '../text';
import {
  addDecorative,
  addLogo,
  addPageNumber,
  copyField,
  FULL,
  photoOrPlaceholder,
  type LayoutRenderer,
  type RenderContext,
} from './shared';

/**
 * `closing_story` — the last slide: one image, a short send-off, and how to get in touch.
 *
 * Immersive keeps the photograph full-bleed with the copy low over a bottom scrim. Minimal
 * puts a photo band across the top and the contact block beneath it on the surface, where
 * an agent will actually read the phone number.
 */
export const closingStory: LayoutRenderer = (ctx) => {
  const { slide, style, tokens } = ctx;
  const title = copyField(ctx, 'title') ?? '';
  const body = copyField(ctx, 'body') ?? copyField(ctx, 'subtitle');
  const cta = copyField(ctx, 'cta');

  if (tokens.fullBleed) {
    photoOrPlaceholder(ctx, 'background', FULL);
    addGradientOverlay(slide, { x: 0, y: SLIDE.h * 0.3, w: SLIDE.w, h: SLIDE.h * 0.7 }, 'down');

    const box: Box = { x: MARGIN, y: 3.0, w: SLIDE.w * 0.62, h: SLIDE.h - 3.0 - MARGIN };
    let y = box.y;
    const titleFit = addFittedText(slide, title, { x: box.x, y, w: box.w, h: 1.8 }, style, {
      role: 'closingTitle',
      color: PALETTE.white,
      warn: ctx.warn,
      label: `${ctx.spec.id} title`,
    });
    y += (titleFit.lines * titleFit.fontSize) / 72 + 0.25;
    if (body) {
      const fit = addFittedText(slide, body, { x: box.x, y, w: box.w * 0.9, h: 1.0 }, style, {
        role: 'subtitle',
        color: tokens.onPhotoMuted,
        warn: ctx.warn,
        label: `${ctx.spec.id} body`,
      });
      y += Math.min(1.0, (fit.lines * fit.fontSize * 1.3) / 72) + 0.25;
    }
    renderContact(ctx, { x: box.x, y, w: box.w, h: SLIDE.h - MARGIN - y }, PALETTE.white, tokens.onPhotoMuted, cta);
    addDecorative(ctx, { onDark: true });
    addLogo(ctx, true);
    return;
  }

  slide.background = { color: tokens.surface };
  const bandH = 3.1;
  photoOrPlaceholder(ctx, 'background', { x: 0, y: 0, w: SLIDE.w, h: bandH });
  addRect(slide, { x: 0, y: bandH, w: SLIDE.w, h: 0.06 }, { color: tokens.accent });

  const box: Box = { x: MARGIN, y: bandH + 0.5, w: SLIDE.w - 2 * MARGIN, h: SLIDE.h - bandH - 0.5 - MARGIN };
  let y = box.y;
  const titleFit = addFittedText(slide, title, { x: box.x, y, w: box.w * 0.6, h: 1.2 }, style, {
    role: 'closingTitle',
    color: tokens.ink,
    warn: ctx.warn,
    label: `${ctx.spec.id} title`,
  });
  if (body) {
    addFittedText(slide, body, { x: box.x, y: y + (titleFit.lines * titleFit.fontSize) / 72 + 0.2, w: box.w * 0.55, h: 1.2 }, style, {
      role: 'body',
      color: tokens.inkMuted,
      warn: ctx.warn,
      label: `${ctx.spec.id} body`,
    });
  }
  renderContact(
    ctx,
    { x: box.x + box.w * 0.62, y, w: box.w * 0.38, h: box.h },
    tokens.ink,
    tokens.inkMuted,
    cta,
  );
  addLogo(ctx, true);
  addPageNumber(ctx, tokens.inkMuted);
};

function renderContact(
  ctx: RenderContext,
  box: Box,
  ink: string,
  muted: string,
  cta: string | undefined,
): void {
  const { slide, style, tokens } = ctx;
  const contact = ctx.spec.copy.contact ?? {};
  const lines = [contact.name, contact.email, contact.phone, contact.website].filter(Boolean) as string[];
  let y = box.y;

  if (cta) {
    const pillW = Math.min(box.w, 0.6 + cta.length * 0.12);
    addPill(slide, { x: box.x, y, w: pillW, h: 0.46 }, { color: tokens.accent });
    addFittedText(slide, cta, { x: box.x + 0.2, y, w: pillW - 0.4, h: 0.46 }, style, {
      role: 'stopLabel',
      color: tokens.ink,
      valign: 'middle',
      align: 'center',
    });
    y += 0.46 + 0.3;
  }

  if (lines.length) {
    slide.addText(
      lines.map((line, i) => ({
        text: line,
        options: {
          fontFace: 'DM Sans',
          fontSize: i === 0 ? 14 : 12,
          bold: i === 0,
          color: i === 0 ? ink : muted,
          breakLine: i < lines.length - 1,
        },
      })),
      {
        x: box.x,
        y,
        w: box.w,
        h: Math.max(0.4, box.y + box.h - y),
        margin: 0,
        lineSpacingMultiple: 1.35,
        valign: 'top',
        fit: 'none',
        wrap: true,
        isTextBox: true,
      },
    );
  }
}
