import { MARGIN, PALETTE, SLIDE } from '../brand';
import { addGradientOverlay, addRect } from '../overlays';
import { addFittedText, type Box } from '../text';
import {
  addDecorative,
  addLogo,
  addPageNumber,
  copyField,
  FULL,
  photoOrPlaceholder,
  type LayoutRenderer,
} from './shared';

/**
 * `full_bleed_hero_with_left_copy` — covers and destination intros.
 *
 * Immersive: the photograph is the slide, a scrim deepens toward the left, and the copy sits
 * in the left half over it. Minimal: a cream panel on the left carries the copy and the
 * photo is confined to the right, so the slide still opens with an image without giving up
 * the quiet, structured feel.
 */
export const fullBleedHero: LayoutRenderer = (ctx) => {
  const { slide, style, tokens, spec } = ctx;
  const isCover = spec.type === 'cover';
  const eyebrow = copyField(ctx, 'eyebrow');
  const title = copyField(ctx, 'title') ?? '';
  const subtitle = copyField(ctx, 'subtitle');

  if (tokens.fullBleed) {
    photoOrPlaceholder(ctx, 'background', FULL);
    addGradientOverlay(slide, FULL, 'left');
    addGradientOverlay(slide, { x: 0, y: SLIDE.h * 0.55, w: SLIDE.w, h: SLIDE.h * 0.45 }, 'down');

    const copyBox: Box = { x: MARGIN, y: 1.6, w: SLIDE.w * 0.52, h: SLIDE.h - 1.6 - MARGIN };
    stackCopy(ctx, copyBox, { eyebrow, title, subtitle }, PALETTE.white, tokens.onPhotoMuted, isCover);
    addDecorative(ctx, { onDark: true });
    addLogo(ctx, true);
    return;
  }

  const panelW = 5.9;
  addRect(slide, { x: 0, y: 0, w: panelW, h: SLIDE.h }, { color: tokens.surfaceAlt });
  photoOrPlaceholder(ctx, 'background', { x: panelW, y: 0, w: SLIDE.w - panelW, h: SLIDE.h });
  // A thin accent rule where panel meets photo, the one flourish minimal allows itself.
  addRect(slide, { x: panelW - 0.06, y: 0, w: 0.06, h: SLIDE.h }, { color: tokens.accent });

  const copyBox: Box = { x: MARGIN, y: 1.5, w: panelW - MARGIN - 0.5, h: SLIDE.h - 1.5 - MARGIN };
  stackCopy(ctx, copyBox, { eyebrow, title, subtitle }, tokens.ink, tokens.inkMuted, isCover);
  addLogo(ctx, true);
  addPageNumber(ctx, PALETTE.white);
};

function stackCopy(
  ctx: Parameters<LayoutRenderer>[0],
  box: Box,
  copy: { eyebrow?: string; title: string; subtitle?: string },
  ink: string,
  muted: string,
  isCover: boolean,
): void {
  const { slide, style } = ctx;
  let y = box.y;
  if (copy.eyebrow) {
    const fit = addFittedText(slide, copy.eyebrow.toUpperCase(), { x: box.x, y, w: box.w, h: 0.4 }, style, {
      role: 'eyebrow',
      color: ctx.tokens.fullBleed ? ctx.tokens.accent : ctx.tokens.accentDeep,
      warn: ctx.warn,
      label: `${ctx.spec.id} eyebrow`,
    });
    y += (fit.fontSize * 1.2) / 72 + 0.25;
  }
  const titleH = Math.min(3.2, box.h * 0.55);
  const titleFit = addFittedText(slide, copy.title, { x: box.x, y, w: box.w, h: titleH }, style, {
    role: isCover ? 'titleCover' : 'title',
    color: ink,
    warn: ctx.warn,
    label: `${ctx.spec.id} title`,
  });
  y += (titleFit.lines * titleFit.fontSize * 1.05) / 72 + 0.3;
  if (copy.subtitle && y < box.y + box.h - 0.6) {
    addFittedText(slide, copy.subtitle, { x: box.x, y, w: box.w * 0.9, h: box.y + box.h - y }, style, {
      role: 'subtitle',
      color: muted,
      warn: ctx.warn,
      label: `${ctx.spec.id} subtitle`,
    });
  }
}
