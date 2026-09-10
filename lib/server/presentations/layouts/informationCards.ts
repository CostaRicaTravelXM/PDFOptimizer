import { COPY_LIMITS } from '@/lib/presentations/manifest';
import { GUTTER, MARGIN, SLIDE } from '../brand';
import { addRect } from '../overlays';
import { addBulletList, addFittedText, type Box } from '../text';
import {
  addDecorative,
  addLogo,
  addPageNumber,
  copyField,
  LOGO_CLEARANCE,
  type LayoutRenderer,
  type RenderContext,
} from './shared';

/**
 * `information_cards` — inclusions, logistics, facts.
 *
 * Cards come from `copy.cards`, or from `included`/`excluded` lists which become two cards
 * with bullets. The grid adapts to the count (two across for up to four, three across for
 * five or six) so a short list does not sit in an empty corner.
 */
export const informationCards: LayoutRenderer = (ctx) => {
  const { slide, style, tokens } = ctx;
  slide.background = { color: tokens.surface };

  const title = copyField(ctx, 'title') ?? '';
  const subtitle = copyField(ctx, 'subtitle') ?? copyField(ctx, 'body');

  let y = LOGO_CLEARANCE - 0.2;
  const titleFit = addFittedText(slide, title, { x: MARGIN, y, w: SLIDE.w - 2 * MARGIN - 1.5, h: 1.1 }, style, {
    role: 'title',
    color: tokens.ink,
    warn: ctx.warn,
    label: `${ctx.spec.id} title`,
  });
  y += (titleFit.lines * titleFit.fontSize * 1.05) / 72 + 0.15;
  if (subtitle) {
    const fit = addFittedText(slide, subtitle, { x: MARGIN, y, w: SLIDE.w * 0.6, h: 0.7 }, style, {
      role: 'subtitle',
      color: tokens.inkMuted,
      warn: ctx.warn,
      label: `${ctx.spec.id} subtitle`,
    });
    y += Math.min(0.7, (fit.lines * fit.fontSize * 1.3) / 72) + 0.15;
  }
  y += 0.2;

  const cards = collectCards(ctx);
  if (cards.length === 0) {
    ctx.warn(`${ctx.spec.id}: an information slide was planned without cards.`);
    addLogo(ctx, false);
    return;
  }

  const cols = cards.length <= 2 ? cards.length : cards.length <= 4 ? 2 : 3;
  const rows = Math.ceil(cards.length / cols);
  const gridBox: Box = { x: MARGIN, y, w: SLIDE.w - 2 * MARGIN, h: SLIDE.h - MARGIN - y };
  const cardW = (gridBox.w - GUTTER * (cols - 1)) / cols;
  const cardH = (gridBox.h - GUTTER * (rows - 1)) / rows;

  cards.forEach((card, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const box: Box = { x: gridBox.x + col * (cardW + GUTTER), y: gridBox.y + row * (cardH + GUTTER), w: cardW, h: cardH };
    addRect(slide, box, { color: tokens.cardFill, radius: tokens.radius, line: tokens.cardLine, shadow: style === 'immersive' });
    addRect(slide, { x: box.x, y: box.y + 0.35, w: 0.06, h: 0.5 }, { color: card.accent ?? tokens.accent });

    const pad = 0.3;
    const inner: Box = { x: box.x + pad + 0.1, y: box.y + pad, w: box.w - 2 * pad - 0.1, h: box.h - 2 * pad };
    const titleFit2 = addFittedText(slide, card.title, { x: inner.x, y: inner.y, w: inner.w, h: 0.6 }, style, {
      role: 'cardTitle',
      color: tokens.ink,
      warn: ctx.warn,
      label: `${ctx.spec.id} card "${card.title}"`,
    });
    const bodyY = inner.y + (titleFit2.lines * titleFit2.fontSize * 1.1) / 72 + 0.15;
    const bodyBox: Box = { x: inner.x, y: bodyY, w: inner.w, h: inner.y + inner.h - bodyY };
    if (card.items) {
      addBulletList(slide, card.items, bodyBox, style, {
        role: 'cardBody',
        color: tokens.inkMuted,
        warn: ctx.warn,
        label: `${ctx.spec.id} card "${card.title}"`,
        maxItems: COPY_LIMITS.list_items,
      });
    } else if (card.body) {
      addFittedText(slide, card.body, bodyBox, style, {
        role: 'cardBody',
        color: tokens.inkMuted,
        warn: ctx.warn,
        label: `${ctx.spec.id} card "${card.title}"`,
      });
    }
  });

  addDecorative(ctx);
  addLogo(ctx, false);
  addPageNumber(ctx, tokens.inkMuted);
};

interface Card {
  title: string;
  body?: string;
  items?: string[];
  accent?: string;
}

function collectCards(ctx: RenderContext): Card[] {
  const { copy } = ctx.spec;
  const es = ctx.language === 'es';
  const out: Card[] = [];
  if (copy.cards?.length) {
    out.push(...copy.cards.slice(0, COPY_LIMITS.cards).map((c) => ({ title: c.title, body: c.body })));
  }
  if (copy.included?.length) {
    out.push({ title: es ? 'Incluido' : 'Included', items: copy.included, accent: ctx.tokens.accent });
  }
  if (copy.excluded?.length) {
    out.push({ title: es ? 'No incluido' : 'Not included', items: copy.excluded, accent: 'FF7F30' });
  }
  return out.slice(0, COPY_LIMITS.cards);
}
