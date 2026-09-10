import { z } from 'zod';
import {
  COPY_LIMITS,
  DEFAULT_LAYOUT_FOR_TYPE,
  LAYOUT_IDS,
  PHOTO_PURPOSES,
  SLIDE_LIMITS,
  SLIDE_TYPES,
  type AssetPurpose,
  type LayoutId,
  type Manifest,
  type ResolvedAssets,
  type SlideSpec,
} from '@/lib/presentations/manifest';
import { BRAND_PALETTE_HEX, FONT_WHITELIST, hex } from './brand';

/**
 * Validation for what n8n sends the compiler.
 *
 * Two levels on purpose. The zod schema rejects only what the compiler cannot render at all
 * (no title, no slides, a style that is not one of ours). Everything else that is merely
 * off-policy — an unknown layout, a fourth photo, a colour outside the brand — is fixed up
 * with a warning, because a deck with one corrected slide is worth far more to the user than
 * a failed job. The planning workflow is where the strict rules live; this is the safety net
 * under it.
 */

const str = (max: number) => z.string().trim().max(max);
// The planner's structured-output schema expresses "optional" as nullable, so null and
// undefined mean the same thing here.
const optStr = (max: number) =>
  str(max)
    .nullish()
    .transform((v) => (v ? v : undefined));
const optArr = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .nullish()
    .transform((v) => v ?? undefined);

const slideCopySchema = z
  .object({
    eyebrow: optStr(200),
    title: optStr(400),
    subtitle: optStr(600),
    body: optStr(2000),
    day_label: optStr(60),
    meta: optArr(str(200), 12),
    stops: optArr(z.object({ label: str(120), sublabel: optStr(200), date: optStr(60) }), 12),
    cards: optArr(z.object({ title: str(200), body: optStr(600) }), 12),
    options: optArr(
      z.object({
        name: str(200),
        location: optStr(200),
        room: optStr(200),
        notes: optStr(600),
        price: optStr(100),
      }),
      6,
    ),
    included: optArr(str(300), 20),
    excluded: optArr(str(300), 20),
    contact: z
      .object({ name: optStr(120), email: optStr(160), phone: optStr(60), website: optStr(200) })
      .nullish()
      .transform((v) => v ?? undefined),
    cta: optStr(200),
  })
  .passthrough();

const assetSchema = z
  .object({
    purpose: z.string(),
    source: z.enum(['workdrive', 'pexels', 'unsplash', 'placeholder']).catch('placeholder'),
    subject_kind: z.enum(['generic_scene', 'named_property', 'brand_element']).catch('generic_scene'),
    asset_match: optStr(300),
    fallback_query: optStr(300),
    orientation: z
      .enum(['landscape', 'portrait'])
      .nullish()
      .transform((v) => v ?? undefined),
  })
  .passthrough();

const slideSchema = z
  .object({
    id: str(80).min(1),
    type: z.string(),
    layout: z.string().optional(),
    theme: z
      .enum(['light', 'dark', 'accent'])
      .nullish()
      .transform((v) => v ?? undefined),
    copy: slideCopySchema.default({}),
    assets: optArr(assetSchema, 12),
    decorative_elements: optArr(z.string(), 12),
    layout_constraints: z
      .record(z.number().nullable())
      .nullish()
      .transform((v) => {
        if (!v) return undefined;
        const out: Record<string, number> = {};
        for (const [k, n] of Object.entries(v)) if (typeof n === 'number') out[k] = n;
        return out;
      }),
    warnings: optArr(z.string(), 20),
  })
  .passthrough();

const manifestSchema = z
  .object({
    presentation: z.object({
      title: str(200).min(1, 'presentation.title is required'),
      subtitle: optStr(300),
      style: z.enum(['minimal', 'immersive']),
      audience: z.enum(['agent', 'internal', 'client', 'mixed']).catch('client'),
      language: z.enum(['en', 'es']).catch('en'),
    }),
    brand: z
      .object({
        palette: optArr(z.string(), 20),
        title_font: optStr(100),
        body_font: optStr(100),
      })
      .nullish()
      .transform((v) => v ?? undefined),
    slides: z.array(slideSchema).min(1, 'at least one slide is required'),
  })
  .passthrough();

export type ParseResult =
  | { ok: true; manifest: Manifest; warnings: string[] }
  | { ok: false; issues: { path: string; message: string }[] };

const PURPOSES = new Set<string>([...PHOTO_PURPOSES, 'decorative_element']);

export function parseManifest(input: unknown): ParseResult {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }

  const warnings: string[] = [];
  const raw = parsed.data;
  const style = raw.presentation.style;

  // Brand: only whitelisted fonts and brand colours survive; the rest is replaced silently
  // enough that the deck still ships, loudly enough that the prompt can be tuned.
  const brand: Manifest['brand'] = {};
  if (raw.brand?.palette) {
    const kept = raw.brand.palette.map(hex).filter((c): c is string => !!c).map((c) => `#${c}`);
    const dropped = raw.brand.palette.length - kept.length;
    const inBrand = kept.filter((c) => BRAND_PALETTE_HEX.includes(c));
    if (dropped > 0 || inBrand.length !== kept.length) {
      warnings.push('Some palette colours were outside the brand set and were ignored.');
    }
    brand.palette = inBrand;
  }
  for (const key of ['title_font', 'body_font'] as const) {
    const font = raw.brand?.[key];
    if (font && !FONT_WHITELIST.includes(font)) {
      warnings.push(`Font "${font}" is not in the approved list; the brand default was used.`);
    } else if (font) {
      brand[key] = font;
    }
  }

  // Slides: cap the count, repair layouts, cap photos, de-duplicate ids.
  let slidesIn = raw.slides;
  if (slidesIn.length > SLIDE_LIMITS.hard_max) {
    warnings.push(
      `The plan had ${slidesIn.length} slides; only the first ${SLIDE_LIMITS.hard_max} were built.`,
    );
    slidesIn = slidesIn.slice(0, SLIDE_LIMITS.hard_max);
  }

  const seen = new Set<string>();
  const slides: SlideSpec[] = slidesIn.map((s, index) => {
    let id = s.id.replace(/[^A-Za-z0-9_-]+/g, '_');
    if (seen.has(id)) {
      const base = id;
      let n = 2;
      while (seen.has(`${base}_${n}`)) n++;
      id = `${base}_${n}`;
      warnings.push(`Duplicate slide id "${base}" renamed to "${id}".`);
    }
    seen.add(id);

    const type = (SLIDE_TYPES as string[]).includes(s.type) ? (s.type as SlideSpec['type']) : null;
    const resolvedType = type ?? (index === 0 ? 'cover' : index === slidesIn.length - 1 ? 'closing' : 'itinerary_day');
    if (!type) warnings.push(`Slide "${id}": unknown type "${s.type}", treated as ${resolvedType}.`);

    let layout: LayoutId;
    if (s.layout && (LAYOUT_IDS as string[]).includes(s.layout)) {
      layout = s.layout as LayoutId;
    } else {
      layout = DEFAULT_LAYOUT_FOR_TYPE[resolvedType];
      if (s.layout) warnings.push(`Slide "${id}": unknown layout "${s.layout}", used ${layout}.`);
    }

    const assets: SlideSpec['assets'] = [];
    let photos = 0;
    let decoratives = 0;
    for (const a of s.assets ?? []) {
      if (!PURPOSES.has(a.purpose)) {
        warnings.push(`Slide "${id}": asset purpose "${a.purpose}" is not supported and was skipped.`);
        continue;
      }
      const purpose = a.purpose as AssetPurpose;
      if (purpose === 'decorative_element') {
        if (decoratives >= 1) {
          warnings.push(`Slide "${id}": only one decorative element is allowed; extras were dropped.`);
          continue;
        }
        decoratives++;
      } else {
        if (photos >= 3) {
          warnings.push(`Slide "${id}": more than three photos were planned; extras were dropped.`);
          continue;
        }
        photos++;
      }
      assets.push({
        purpose,
        source: a.source,
        subject_kind: a.subject_kind,
        asset_match: a.asset_match,
        fallback_query: a.fallback_query,
        orientation: a.orientation,
      });
    }

    return {
      id,
      type: resolvedType,
      layout,
      theme: s.theme,
      copy: s.copy,
      assets,
      layout_constraints: s.layout_constraints,
      warnings: s.warnings,
    };
  });

  // Copy that runs far past the limits gets trimmed here as a last resort; the fitting code
  // will shorten again to the box, but starting from a sane length keeps the sizes readable.
  for (const s of slides) {
    const bodyMax = style === 'immersive' ? COPY_LIMITS.body_immersive : COPY_LIMITS.body_minimal;
    if (s.copy.body && s.copy.body.length > bodyMax * 1.5) {
      s.copy.body = s.copy.body.slice(0, bodyMax * 1.5).trim() + '…';
      warnings.push(`Slide "${s.id}": body copy was much longer than the limit and was cut.`);
    }
  }

  // Layout monotony is a warning, not a failure: it is the prompt's job to vary rhythm.
  for (let i = 2; i < slides.length; i++) {
    if (slides[i].layout === slides[i - 1].layout && slides[i].layout === slides[i - 2].layout) {
      warnings.push(`Slides ${slides[i - 2].id}–${slides[i].id} use the same layout three times in a row.`);
      break;
    }
  }

  const manifest: Manifest = {
    presentation: {
      title: raw.presentation.title,
      subtitle: raw.presentation.subtitle,
      style,
      audience: raw.presentation.audience,
      language: raw.presentation.language,
    },
    brand,
    slides,
  };
  return { ok: true, manifest, warnings };
}

const resolvedAssetSchema = z.object({
  url: z.string().max(2000).optional().default(''),
  source: z.enum(['workdrive', 'pexels', 'unsplash', 'placeholder']),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  credit: z.string().max(300).optional(),
});

/**
 * The asset map may only point at https URLs and at references the manifest actually
 * declares; anything else is dropped with a warning rather than fetched.
 */
export function parseResolvedAssets(
  input: unknown,
  manifest: Manifest,
): { assets: ResolvedAssets; warnings: string[] } {
  const warnings: string[] = [];
  const assets: ResolvedAssets = {};
  if (typeof input !== 'object' || input === null) return { assets, warnings };

  const declared = new Set<string>();
  for (const s of manifest.slides) for (const a of s.assets ?? []) declared.add(`${s.id}:${a.purpose}`);

  for (const [ref, value] of Object.entries(input as Record<string, unknown>)) {
    if (!declared.has(ref)) {
      warnings.push(`Asset "${ref}" does not match any slide requirement and was ignored.`);
      continue;
    }
    const parsed = resolvedAssetSchema.safeParse(value);
    if (!parsed.success) {
      warnings.push(`Asset "${ref}" was malformed and was ignored.`);
      continue;
    }
    const a = parsed.data;
    if (a.source !== 'placeholder' && !a.url.startsWith('https://')) {
      warnings.push(`Asset "${ref}" is not an https URL and was ignored.`);
      continue;
    }
    assets[ref] = a;
  }
  return { assets, warnings };
}
