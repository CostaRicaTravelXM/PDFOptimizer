import type { Audience, AssetSource, Language, PresentationStyle } from './types';

export type { PresentationStyle } from './types';

/**
 * The slide manifest: what the planning step (Claude, driven by n8n) hands to the compiler.
 *
 * Claude chooses a layout primitive and supplies the copy; the compiler owns every
 * coordinate, font size and crop. Keeping the manifest at this altitude is what lets decks
 * vary in rhythm and composition while still coming out on-brand and inside the slide.
 *
 * Client-safe types only. The zod schema that enforces them is in
 * `lib/server/presentations/schema.ts`.
 */

export type SlideType =
  | 'cover'
  | 'overview'
  | 'route'
  | 'itinerary_day'
  | 'accommodation'
  | 'inclusions'
  | 'closing';

export type LayoutId =
  | 'full_bleed_hero_with_left_copy'
  | 'split_photo_text'
  | 'asymmetric_two_photo_editorial'
  | 'timeline_route'
  | 'information_cards'
  | 'hotel_comparison'
  | 'closing_story';

export const SLIDE_TYPES: SlideType[] = [
  'cover',
  'overview',
  'route',
  'itinerary_day',
  'accommodation',
  'inclusions',
  'closing',
];

export const LAYOUT_IDS: LayoutId[] = [
  'full_bleed_hero_with_left_copy',
  'split_photo_text',
  'asymmetric_two_photo_editorial',
  'timeline_route',
  'information_cards',
  'hotel_comparison',
  'closing_story',
];

/** Where a layout falls back to when Claude names something it does not know. */
export const DEFAULT_LAYOUT_FOR_TYPE: Record<SlideType, LayoutId> = {
  cover: 'full_bleed_hero_with_left_copy',
  overview: 'split_photo_text',
  route: 'timeline_route',
  itinerary_day: 'split_photo_text',
  accommodation: 'hotel_comparison',
  inclusions: 'information_cards',
  closing: 'closing_story',
};

/**
 * Three photo purposes, one decorative: "at most three photos per slide" is then a property
 * of the type rather than a rule someone has to remember to check.
 */
export type AssetPurpose =
  | 'background'
  | 'primary_photo'
  | 'secondary_photo'
  | 'tertiary_photo'
  | 'decorative_element';

export const PHOTO_PURPOSES: AssetPurpose[] = [
  'background',
  'primary_photo',
  'secondary_photo',
  'tertiary_photo',
];

/**
 * What the image is of, which decides where it may come from: a named hotel must never be
 * "illustrated" with a stock photo of some other hotel.
 */
export type SubjectKind = 'generic_scene' | 'named_property' | 'brand_element';

export interface AssetSpec {
  purpose: AssetPurpose;
  source: AssetSource;
  subject_kind: SubjectKind;
  /** Filename of an approved WorkDrive asset, when the index offered one. */
  asset_match?: string;
  /** English stock-photo query for generic scenes. */
  fallback_query?: string;
  orientation?: 'landscape' | 'portrait';
}

export interface TimelineStop {
  label: string;
  sublabel?: string;
  date?: string;
}

export interface InfoCard {
  title: string;
  body?: string;
}

export interface HotelOption {
  name: string;
  location?: string;
  room?: string;
  notes?: string;
  price?: string;
}

export interface ContactBlock {
  name?: string;
  email?: string;
  phone?: string;
  website?: string;
}

export interface SlideCopy {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  day_label?: string;
  meta?: string[];
  stops?: TimelineStop[];
  cards?: InfoCard[];
  options?: HotelOption[];
  included?: string[];
  excluded?: string[];
  contact?: ContactBlock;
  cta?: string;
}

export interface SlideSpec {
  id: string;
  type: SlideType;
  layout: LayoutId;
  /** Surface tint for the slide; each layout decides what that means. */
  theme?: 'light' | 'dark' | 'accent';
  copy: SlideCopy;
  assets?: AssetSpec[];
  layout_constraints?: Record<string, number>;
  warnings?: string[];
}

export interface Manifest {
  presentation: {
    title: string;
    subtitle?: string;
    style: PresentationStyle;
    audience: Audience;
    language: Language;
  };
  brand?: {
    palette?: string[];
    title_font?: string;
    body_font?: string;
  };
  slides: SlideSpec[];
}

/** `<slideId>:<purpose>` — how the resolver hands the compiler a URL for each requirement. */
export type AssetRef = `${string}:${AssetPurpose}`;

export function assetRef(slideId: string, purpose: AssetPurpose): AssetRef {
  return `${slideId}:${purpose}`;
}

export interface ResolvedAsset {
  url: string;
  source: AssetSource;
  width?: number;
  height?: number;
  /** "Photo by X on Pexels" — rendered in the credits, never on the slide. */
  credit?: string;
}

export type ResolvedAssets = Record<string, ResolvedAsset>;

export interface CompileRequest {
  jobId: string;
  manifest: Manifest;
  assets: ResolvedAssets;
}

/**
 * Character ceilings per field. The planning prompt, the manifest validator in n8n and the
 * compiler's own fitting all read from this one table, so a limit changes in one place.
 */
export const COPY_LIMITS = {
  eyebrow: 24,
  cover_title: 42,
  title: 60,
  subtitle: 90,
  day_label: 12,
  body_immersive: 280,
  body_minimal: 420,
  meta_items: 5,
  meta_item: 40,
  cards: 6,
  card_title: 32,
  card_body: 120,
  options: 3,
  stops: 7,
  list_items: 8,
  list_item: 60,
  cta: 60,
} as const;

export const SLIDE_LIMITS = {
  minimal: { min: 8, max: 20 },
  immersive: { min: 10, max: 22 },
  hard_max: 25,
} as const;
