import type PptxGenJS from 'pptxgenjs';
import { GRADIENTS } from './brand/embedded';
import type { Box } from './text';

/**
 * Shapes and scrims that sit between a photo and its text.
 *
 * A gradient scrim is one transparent PNG stretched over the box. It arrives in Canva as a
 * single movable layer, which is what an editor expects; a stack of stepped semi-transparent
 * rectangles would be "native" but adds a dozen layers per slide to the layer list. Solid
 * panels, pills and cards are native shapes so their colour stays editable.
 */

export type GradientDirection = keyof typeof GRADIENTS;

export function addGradientOverlay(
  slide: PptxGenJS.Slide,
  box: Box,
  direction: GradientDirection,
): void {
  slide.addImage({
    data: `image/png;base64,${GRADIENTS[direction]}`,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    altText: 'Gradient overlay',
  });
}

export function addRect(
  slide: PptxGenJS.Slide,
  box: Box,
  opts: { color: string; transparency?: number; radius?: number; line?: string; shadow?: boolean },
): void {
  slide.addShape(opts.radius ? 'roundRect' : 'rect', {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    fill: { color: opts.color, transparency: opts.transparency ?? 0 },
    // A zero line width is treated as "default" (1pt) by PptxGenJS, so "no border" has to be
    // said explicitly.
    line: opts.line ? { color: opts.line, width: 0.75 } : { type: 'none' },
    // Inches; PptxGenJS converts against the shorter side itself.
    rectRadius: opts.radius ? Math.min(opts.radius, Math.min(box.w, box.h) / 2) : undefined,
    shadow: opts.shadow
      ? { type: 'outer', color: '14313F', opacity: 0.14, blur: 8, offset: 3, angle: 90 }
      : undefined,
  });
}

/** A fully rounded label background, sized to the text it will carry. */
export function addPill(
  slide: PptxGenJS.Slide,
  box: Box,
  opts: { color: string; transparency?: number },
): void {
  slide.addShape('roundRect', {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    fill: { color: opts.color, transparency: opts.transparency ?? 0 },
    line: { type: 'none' },
    rectRadius: Math.min(box.w, box.h) / 2,
  });
}

export function addLine(
  slide: PptxGenJS.Slide,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { color: string; width?: number; dash?: 'solid' | 'dash' },
): void {
  slide.addShape('line', {
    x: from.x,
    y: from.y,
    w: to.x - from.x,
    h: to.y - from.y,
    line: { color: opts.color, width: opts.width ?? 1.5, dashType: opts.dash ?? 'solid' },
  });
}

export function addCircle(
  slide: PptxGenJS.Slide,
  cx: number,
  cy: number,
  r: number,
  opts: { color: string; line?: string; transparency?: number },
): void {
  slide.addShape('ellipse', {
    x: cx - r,
    y: cy - r,
    w: 2 * r,
    h: 2 * r,
    fill: { color: opts.color, transparency: opts.transparency ?? 0 },
    line: opts.line ? { color: opts.line, width: 1.5 } : { type: 'none' },
  });
}
