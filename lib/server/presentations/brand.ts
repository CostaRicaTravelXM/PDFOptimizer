import type { PresentationStyle } from '@/lib/presentations/manifest';

/**
 * Brand tokens for the compiler.
 *
 * Colours are the travelxm.com tokens already in `app/globals.css`, written without the
 * leading `#` because that is the form PptxGenJS expects. Fonts are the two families the
 * site uses and that Canva's library also carries, so an imported deck keeps its type
 * instead of falling back to Arial.
 *
 * Version comment for the planning prompt, which pastes this palette: brand-tokens v1.
 */

export const SLIDE = { w: 13.333, h: 7.5 } as const;
export const MARGIN = 0.65;
export const GUTTER = 0.35;

export const PALETTE = {
  ink: '14313F',
  inkMuted: '456572',
  accent: '72C049',
  accentLight: '8FD06A',
  accentDeep: '396B1F',
  titleAccent: '3A9E46',
  sand: 'D6BF8A',
  coral: 'FF7F30',
  sky: '0C86A0',
  skyLight: '5BC0DE',
  sunshine: 'F2B705',
  navy: '274690',
  bgLight: 'F2F9FC',
  bg: 'D9ECF5',
  cream: 'F7F4EC',
  white: 'FFFFFF',
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Colours Claude may pick for section theming; anything else is dropped with a warning. */
export const BRAND_PALETTE_HEX: string[] = Object.values(PALETTE).map((c) => `#${c}`);

export const FONTS = { title: 'Cormorant Garamond', body: 'DM Sans' } as const;
export const FONT_WHITELIST = ['Cormorant Garamond', 'DM Sans', 'Playfair Display', 'Inter'];

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Strip a leading `#` and validate; returns null for anything that is not 6-digit hex. */
export function hex(input: string | undefined): string | null {
  if (!input) return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(input.trim());
  return m ? m[1].toUpperCase() : null;
}

export interface StyleTokens {
  style: PresentationStyle;
  /** Page background for slides that are not a photograph. */
  surface: string;
  surfaceAlt: string;
  ink: string;
  inkMuted: string;
  accent: string;
  accentDeep: string;
  /** Text colour over photographs and dark scrims. */
  onPhoto: string;
  onPhotoMuted: string;
  cardFill: string;
  cardLine: string;
  /** Whether wildlife/decorative illustrations are placed at all. */
  decorative: boolean;
  /** Whether hero-type layouts bleed the photo to the slide edge. */
  fullBleed: boolean;
  pageNumbers: boolean;
  /** Corner radius, in inches, for inset photos and cards. */
  radius: number;
}

export function styleTokens(style: PresentationStyle): StyleTokens {
  if (style === 'minimal') {
    return {
      style,
      surface: PALETTE.white,
      surfaceAlt: PALETTE.cream,
      ink: PALETTE.ink,
      inkMuted: PALETTE.inkMuted,
      accent: PALETTE.accent,
      accentDeep: PALETTE.accentDeep,
      onPhoto: PALETTE.white,
      onPhotoMuted: 'E6EEF2',
      cardFill: PALETTE.bgLight,
      cardLine: 'D8E4EA',
      decorative: false,
      fullBleed: false,
      pageNumbers: true,
      radius: 0.12,
    };
  }
  return {
    style,
    surface: PALETTE.cream,
    surfaceAlt: PALETTE.bgLight,
    ink: PALETTE.ink,
    inkMuted: PALETTE.inkMuted,
    accent: PALETTE.accent,
    accentDeep: PALETTE.accentDeep,
    onPhoto: PALETTE.white,
    onPhotoMuted: 'E6EEF2',
    cardFill: PALETTE.white,
    cardLine: 'E3DDD0',
    decorative: true,
    fullBleed: true,
    pageNumbers: false,
    radius: 0.18,
  };
}

/** Accent colour for a themed section; `accent` theme cycles through the brand tints. */
export function themeAccent(theme: 'light' | 'dark' | 'accent' | undefined, index: number): string {
  if (theme !== 'accent') return PALETTE.accentDeep;
  const cycle = [PALETTE.sky, PALETTE.accentDeep, PALETTE.navy, PALETTE.coral, PALETTE.sunshine];
  return cycle[index % cycle.length];
}

export type TextRole =
  | 'eyebrow'
  | 'title'
  | 'titleCover'
  | 'subtitle'
  | 'body'
  | 'meta'
  | 'caption'
  | 'dayLabel'
  | 'cardTitle'
  | 'cardBody'
  | 'stopLabel'
  | 'stopSub'
  | 'closingTitle';

export interface RoleSpec {
  size: number;
  min: number;
  face: 'title' | 'body';
  bold?: boolean;
  italic?: boolean;
  charSpacing?: number;
  lineSpacing: number;
  /** Average advance width as a fraction of the font size, used to predict wrapping. */
  glyph: number;
}

// Deliberately generous: Cormorant Garamond is narrow, but a deck opened where the face is
// missing falls back to something wider, and a prediction that errs long only leaves air.
const TITLE_GLYPH = 0.5;
const BODY_GLYPH = 0.55;

const BASE: Record<TextRole, RoleSpec> = {
  eyebrow: { size: 12, min: 10, face: 'body', bold: true, charSpacing: 3, lineSpacing: 1.2, glyph: BODY_GLYPH + 0.1 },
  title: { size: 40, min: 24, face: 'title', bold: true, lineSpacing: 1.05, glyph: TITLE_GLYPH },
  titleCover: { size: 54, min: 30, face: 'title', bold: true, lineSpacing: 1.0, glyph: TITLE_GLYPH },
  closingTitle: { size: 48, min: 28, face: 'title', bold: true, lineSpacing: 1.0, glyph: TITLE_GLYPH },
  subtitle: { size: 20, min: 14, face: 'body', lineSpacing: 1.3, glyph: BODY_GLYPH },
  body: { size: 16, min: 12, face: 'body', lineSpacing: 1.4, glyph: BODY_GLYPH },
  meta: { size: 13, min: 10, face: 'body', lineSpacing: 1.35, glyph: BODY_GLYPH },
  caption: { size: 10, min: 9, face: 'body', lineSpacing: 1.3, glyph: BODY_GLYPH },
  dayLabel: { size: 11, min: 9, face: 'body', bold: true, charSpacing: 2, lineSpacing: 1.2, glyph: BODY_GLYPH + 0.1 },
  cardTitle: { size: 18, min: 13, face: 'title', bold: true, lineSpacing: 1.1, glyph: TITLE_GLYPH + 0.03 },
  cardBody: { size: 13, min: 10, face: 'body', lineSpacing: 1.35, glyph: BODY_GLYPH },
  stopLabel: { size: 14, min: 10, face: 'body', bold: true, lineSpacing: 1.2, glyph: BODY_GLYPH },
  stopSub: { size: 11, min: 9, face: 'body', lineSpacing: 1.25, glyph: BODY_GLYPH },
};

/** Minimal runs a notch smaller everywhere: more on the slide, quieter type. */
const MINIMAL_SCALE: Partial<Record<TextRole, number>> = {
  title: 0.8,
  titleCover: 0.8,
  closingTitle: 0.8,
  subtitle: 0.85,
  body: 0.85,
  meta: 0.9,
  cardTitle: 0.85,
};

export function roleSpec(role: TextRole, style: PresentationStyle): RoleSpec {
  const base = BASE[role];
  if (style === 'immersive') return base;
  const k = MINIMAL_SCALE[role] ?? 1;
  return { ...base, size: Math.round(base.size * k), min: Math.round(base.min * Math.min(1, k + 0.1)) };
}

/** The logo sits in the same corner on every slide, whatever the layout does around it. */
export const LOGO = { w: 1.05, h: 0.42, margin: 0.4 } as const;
