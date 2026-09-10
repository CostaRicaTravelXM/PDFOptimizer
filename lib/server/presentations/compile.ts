import PptxGenJS from 'pptxgenjs';
import type { Manifest } from '@/lib/presentations/manifest';
import { styleTokens } from './brand';
import type { LoadedImage } from './images';
import { LAYOUTS, type RenderContext } from './layouts';

/**
 * Turn a validated manifest plus loaded images into a PowerPoint file.
 *
 * Deterministic on purpose: the same manifest and images always produce the same deck. The
 * creative choices were made upstream by the planner; this step's job is to honour them
 * inside the brand and inside the slide.
 */

export interface CompileOutput {
  buffer: Buffer;
  slideCount: number;
  warnings: string[];
}

export async function compilePresentation(
  manifest: Manifest,
  images: Map<string, LoadedImage>,
  opts: { warnings?: string[] } = {},
): Promise<CompileOutput> {
  const warnings = [...(opts.warnings ?? [])];
  const style = manifest.presentation.style;
  const tokens = styleTokens(style);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = manifest.presentation.title;
  pptx.subject = manifest.presentation.subtitle ?? '';
  pptx.author = 'TravelXM';
  pptx.company = 'TravelXM';

  manifest.slides.forEach((spec, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: tokens.surface };
    const ctx: RenderContext = {
      pptx,
      slide,
      style,
      language: manifest.presentation.language,
      tokens,
      spec,
      index,
      total: manifest.slides.length,
      images,
      warn: (message) => warnings.push(message),
    };
    for (const w of spec.warnings ?? []) warnings.push(`${spec.id}: ${w}`);
    try {
      LAYOUTS[spec.layout](ctx);
    } catch (error) {
      // One slide failing should not sink the deck: leave it with its title so the editor
      // can see what was meant to be there.
      const reason = error instanceof Error ? error.message : 'unknown error';
      warnings.push(`${spec.id}: the "${spec.layout}" layout could not be rendered (${reason}).`);
      slide.addText(spec.copy.title ?? spec.id, {
        x: 0.65,
        y: 0.65,
        w: 12,
        h: 1,
        fontFace: 'DM Sans',
        fontSize: 24,
        color: tokens.ink,
      });
    }
  });

  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return { buffer, slideCount: manifest.slides.length, warnings };
}

/** A filename-safe slug for the deck, from its title. */
export function deckSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'presentation';
}
