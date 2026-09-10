import { MARGIN, PALETTE, SLIDE } from '../brand';
import { addRect } from '../overlays';
import { type Box } from '../text';
import {
  addDecorative,
  addLogo,
  addPageNumber,
  LOGO_CLEARANCE,
  photoOrPlaceholder,
  type LayoutRenderer,
} from './shared';
import { renderCopyColumn } from './splitPhotoText';

/**
 * `asymmetric_two_photo_editorial` — hotel and experience showcases.
 *
 * One large focal photograph on the left, the copy in a full-height column on the right,
 * and a smaller supporting photograph sitting on a white mat over the focal photo's lower
 * right corner. The mat reaches a little way into the gutter but stops short of the copy
 * column, so the overlap reads as editorial without anything colliding.
 */
export const asymmetricTwoPhoto: LayoutRenderer = (ctx) => {
  const { slide, tokens } = ctx;
  slide.background = { color: tokens.surface };

  const bleed = tokens.fullBleed;
  const primary: Box = bleed
    ? { x: 0, y: 0, w: SLIDE.w * 0.54, h: SLIDE.h }
    : { x: MARGIN, y: MARGIN + 0.2, w: SLIDE.w * 0.46, h: SLIDE.h - 2 * MARGIN - 0.2 };
  photoOrPlaceholder(ctx, 'primary_photo', primary, { rounding: !bleed });

  // How far the mat may cross the focal photo's right edge before the copy column starts.
  const intrusion = 0.45;
  const columnX = primary.x + primary.w + intrusion + 0.45;
  const columnW = SLIDE.w - MARGIN - columnX;

  const secW = 2.8;
  const secH = secW * 0.7;
  const secondary: Box = {
    x: primary.x + primary.w + intrusion - secW,
    y: SLIDE.h - MARGIN - secH - (bleed ? 0.35 : 0.15),
    w: secW,
    h: secH,
  };

  renderCopyColumn(ctx, {
    x: columnX,
    y: LOGO_CLEARANCE,
    w: columnW,
    h: SLIDE.h - LOGO_CLEARANCE - MARGIN,
  });

  addRect(
    slide,
    { x: secondary.x - 0.08, y: secondary.y - 0.08, w: secondary.w + 0.16, h: secondary.h + 0.16 },
    { color: PALETTE.white, radius: 0.1, shadow: true },
  );
  photoOrPlaceholder(ctx, 'secondary_photo', secondary, { rounding: true });

  addDecorative(ctx);
  addLogo(ctx, false);
  addPageNumber(ctx, tokens.inkMuted);
};
