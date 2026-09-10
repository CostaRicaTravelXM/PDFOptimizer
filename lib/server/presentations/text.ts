import type PptxGenJS from 'pptxgenjs';
import { FONTS, roleSpec, type RoleSpec, type TextRole } from './brand';
import type { PresentationStyle } from '@/lib/presentations/manifest';

/**
 * Text that stays inside its box.
 *
 * PowerPoint can shrink text to fit on open; Canva's importer does not, and a deck is only
 * useful if it arrives in Canva looking right. So fitting is done here, deterministically:
 * predict the wrapped line count from average glyph widths, step the size down to the
 * role's floor, and if it still overflows cut at a word boundary and say so in a warning.
 *
 * The prediction is a heuristic. Boxes leave slack for it, and the copy limits in the
 * manifest keep the input inside the range where it holds.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PT_PER_IN = 72;

export function inset(box: Box, dx: number, dy = dx): Box {
  return { x: box.x + dx, y: box.y + dy, w: Math.max(0.1, box.w - 2 * dx), h: Math.max(0.1, box.h - 2 * dy) };
}

/** Lines a paragraph occupies at a given size, by simulating word wrap. */
function wrappedLines(text: string, fontSize: number, spec: RoleSpec, widthIn: number): number {
  const charW = (fontSize * spec.glyph) / PT_PER_IN;
  const perLine = Math.max(4, Math.floor(widthIn / charW));
  let lines = 0;
  for (const para of text.split('\n')) {
    if (para.trim() === '') {
      lines += 1;
      continue;
    }
    let used = 0;
    let count = 1;
    for (const word of para.split(/\s+/)) {
      const len = word.length;
      if (used === 0) used = Math.min(len, perLine);
      else if (used + 1 + len <= perLine) used += 1 + len;
      else {
        count += 1;
        used = Math.min(len, perLine);
      }
    }
    lines += count;
  }
  return lines;
}

function heightFor(lines: number, fontSize: number, spec: RoleSpec): number {
  return (lines * fontSize * spec.lineSpacing) / PT_PER_IN;
}

export interface Fitted {
  text: string;
  fontSize: number;
  lines: number;
  truncated: boolean;
}

/**
 * Padding inside the text box, in inches, that PptxGenJS applies by default (0.1in each
 * side). Callers pass `margin: 0` so the box maths here is the whole story.
 */
export function fitText(text: string, box: Box, role: TextRole, style: PresentationStyle): Fitted {
  const spec = roleSpec(role, style);
  const clean = text.replace(/\s+\n/g, '\n').trim();
  let size = spec.size;

  for (;;) {
    const lines = wrappedLines(clean, size, spec, box.w);
    if (heightFor(lines, size, spec) <= box.h) {
      return { text: clean, fontSize: size, lines, truncated: false };
    }
    if (size - 2 < spec.min) break;
    size -= 2;
  }

  // At the floor and still too tall: how many characters fit, roughly, then cut on a word.
  const charW = (size * spec.glyph) / PT_PER_IN;
  const perLine = Math.max(4, Math.floor(box.w / charW));
  const maxLines = Math.max(1, Math.floor((box.h * PT_PER_IN) / (size * spec.lineSpacing)));
  const budget = perLine * maxLines - 1;
  let cut = clean.slice(0, Math.max(0, budget));
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > budget * 0.6) cut = cut.slice(0, lastSpace);
  cut = cut.replace(/[\s,;:–-]+$/, '') + '…';
  return { text: cut, fontSize: size, lines: maxLines, truncated: true };
}

export interface TextOptions {
  role: TextRole;
  color: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** Override the role's face, e.g. a body-font title in a card. */
  face?: 'title' | 'body';
  bold?: boolean;
  italic?: boolean;
  transparency?: number;
  /** Set when a truncation should be reported; receives a one-line note. */
  warn?: (message: string) => void;
  /** Used in the warning so the reader knows which slide to look at. */
  label?: string;
}

/**
 * Add a fitted text box. Returns the fit so layouts can stack the next element beneath the
 * space actually used.
 */
export function addFittedText(
  slide: PptxGenJS.Slide,
  text: string,
  box: Box,
  style: PresentationStyle,
  opts: TextOptions,
): Fitted {
  const spec = roleSpec(opts.role, style);
  const fit = fitText(text, box, opts.role, style);
  if (fit.truncated && opts.warn) {
    opts.warn(`${opts.label ?? opts.role}: text shortened to fit the slide.`);
  }
  const face = opts.face ?? spec.face;
  slide.addText(fit.text, {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    margin: 0,
    fontFace: face === 'title' ? FONTS.title : FONTS.body,
    fontSize: fit.fontSize,
    bold: opts.bold ?? spec.bold ?? false,
    italic: opts.italic ?? spec.italic ?? false,
    color: opts.color,
    transparency: opts.transparency,
    charSpacing: spec.charSpacing,
    lineSpacingMultiple: spec.lineSpacing,
    align: opts.align ?? 'left',
    valign: opts.valign ?? 'top',
    fit: 'none',
    wrap: true,
    isTextBox: true,
  });
  return fit;
}

/**
 * A bulleted list, one run per item, fitted as a whole. Items are joined into a single
 * paragraph string for the fit prediction, then emitted as separate runs so each becomes a
 * real bullet in Canva rather than a typed "•".
 */
export function addBulletList(
  slide: PptxGenJS.Slide,
  items: string[],
  box: Box,
  style: PresentationStyle,
  opts: TextOptions & { maxItems?: number },
): Fitted {
  const spec = roleSpec(opts.role, style);
  const limited = items.slice(0, opts.maxItems ?? items.length);
  if (limited.length < items.length && opts.warn) {
    opts.warn(`${opts.label ?? opts.role}: only the first ${limited.length} items fit.`);
  }
  const fit = fitText(limited.join('\n'), box, opts.role, style);
  const lines = fit.text.split('\n');
  if (fit.truncated && opts.warn) {
    opts.warn(`${opts.label ?? opts.role}: list shortened to fit the slide.`);
  }
  slide.addText(
    lines.map((line, i) => ({
      text: line,
      options: {
        bullet: { characterCode: '2022', indent: 12 },
        breakLine: i < lines.length - 1,
      },
    })),
    {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      margin: 0,
      fontFace: FONTS.body,
      fontSize: fit.fontSize,
      bold: opts.bold ?? spec.bold ?? false,
      color: opts.color,
      lineSpacingMultiple: spec.lineSpacing,
      paraSpaceAfter: 3,
      align: 'left',
      valign: opts.valign ?? 'top',
      fit: 'none',
      wrap: true,
      isTextBox: true,
    },
  );
  return fit;
}

/** Height, in inches, of a single line at the role's default size — for stacking. */
export function lineHeight(role: TextRole, style: PresentationStyle, fontSize?: number): number {
  const spec = roleSpec(role, style);
  return ((fontSize ?? spec.size) * spec.lineSpacing) / PT_PER_IN;
}

/** Apply the manifest's per-slide character constraints before fitting. */
export function applyMaxChars(text: string | undefined, max: number | undefined): string | undefined {
  if (!text || !max || text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:–-]+$/, '') + '…';
}
