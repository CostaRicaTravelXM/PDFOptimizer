// Validar manifest — runs once. Parses Claude's answer and checks the business rules the
// schema cannot express. Attempt 1 is strict and reports errors for a retry; attempt 2
// repairs what it safely can (shortens copy, drops extras) and only fails on what it cannot.
const ATTEMPT = __ATTEMPT__;
const SOFT = ATTEMPT >= 2;
const LIMITS = __COPY_LIMITS__;
const SLIDE_LIMITS = __SLIDE_LIMITS__;
const LAYOUTS = __LAYOUT_IDS__;
const TYPES = __SLIDE_TYPES__;
const DEFAULT_LAYOUT = __DEFAULT_LAYOUT_FOR_TYPE__;
const PALETTE = __BRAND_PALETTE_HEX__.map((c) => c.toUpperCase());
const FONTS = __FONT_WHITELIST__;

const res = $input.first().json;
const ctx = $('Contexto').first().json;
const index = ($('Índice de activos').first().json || {}).assets || [];
const known = new Set(index.map((a) => String(a.filename || a.id || '').toLowerCase()));

const out = {
  valid: false,
  attempt: ATTEMPT,
  errors: [],
  warnings: [],
  manifest: null,
  raw: null,
  usage: res.usage || null,
  stop_reason: res.stop_reason || null,
  model: res.model || null,
};
const fail = (msg) => {
  out.errors.push(msg);
  return [{ json: out }];
};

if (res.error) return fail(`API error: ${res.error.message || JSON.stringify(res.error)}`);
if (res.stop_reason === 'max_tokens') return fail('The answer was cut off (max_tokens); the manifest is incomplete.');
if (res.stop_reason === 'refusal') return fail('The model declined to produce a plan for this brief.');

const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
out.raw = text;
let m;
try {
  m = JSON.parse(text);
} catch (e) {
  return fail(`The answer is not valid JSON: ${e.message}`);
}

// --- helpers -------------------------------------------------------------------------
const errors = out.errors;
const warnings = out.warnings;
const cut = (s, max) => {
  const t = String(s).slice(0, max);
  const sp = t.lastIndexOf(' ');
  return (sp > max * 0.6 ? t.slice(0, sp) : t).replace(/[\s,;:–-]+$/, '') + '…';
};
// Null means "not used"; drop those keys so the compiler sees plain optionals.
const clean = (v) => {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) o[k] = clean(x);
    return o;
  }
  return v;
};
m = clean(m);

// --- presentation ------------------------------------------------------------------
const p = m.presentation || {};
if (!p.title) errors.push('presentation.title is empty');
if (p.style !== ctx.style) {
  if (SOFT) { p.style = ctx.style; warnings.push('presentation.style corrected to the requested style'); }
  else errors.push(`presentation.style must be "${ctx.style}"`);
}
if (p.language !== ctx.language) {
  if (SOFT) { p.language = ctx.language; warnings.push('presentation.language corrected'); }
  else errors.push(`presentation.language must be "${ctx.language}"`);
}
p.audience = p.audience || ctx.audience;
m.presentation = p;

// --- brand -----------------------------------------------------------------------------
const brand = m.brand || {};
if (Array.isArray(brand.palette)) {
  const kept = brand.palette.map((c) => String(c).toUpperCase()).filter((c) => PALETTE.includes(c));
  if (kept.length !== brand.palette.length) warnings.push('palette colours outside the brand set were dropped');
  brand.palette = kept;
}
for (const k of ['title_font', 'body_font']) {
  if (brand[k] && !FONTS.includes(brand[k])) {
    warnings.push(`${k} "${brand[k]}" is not approved; the brand default is used`);
    delete brand[k];
  }
}
m.brand = brand;

// --- slides ----------------------------------------------------------------------------
let slides = Array.isArray(m.slides) ? m.slides : [];
if (slides.length === 0) return fail('slides is empty');

const range = SLIDE_LIMITS[ctx.style];
if (slides.length > SLIDE_LIMITS.hard_max) {
  if (SOFT) { slides = slides.slice(0, SLIDE_LIMITS.hard_max); warnings.push(`only the first ${SLIDE_LIMITS.hard_max} slides were kept`); }
  else errors.push(`too many slides (${slides.length}); the maximum is ${SLIDE_LIMITS.hard_max}`);
} else if (slides.length < range.min || slides.length > range.max) {
  warnings.push(`${slides.length} slides is outside the usual ${range.min}–${range.max} for ${ctx.style}`);
}

const ids = new Set();
const bodyMax = ctx.style === 'immersive' ? LIMITS.body_immersive : LIMITS.body_minimal;

const checkStr = (slide, field, value, max) => {
  if (typeof value !== 'string' || value.length <= max) return value;
  if (SOFT) { warnings.push(`${slide.id}: ${field} shortened to ${max} characters`); return cut(value, max); }
  errors.push(`${slide.id}: ${field} is ${value.length} characters; the limit is ${max}`);
  return value;
};
const checkList = (slide, field, list, maxItems, maxEach) => {
  if (!Array.isArray(list)) return list;
  let l = list;
  if (l.length > maxItems) {
    if (SOFT) { warnings.push(`${slide.id}: ${field} trimmed to ${maxItems} items`); l = l.slice(0, maxItems); }
    else errors.push(`${slide.id}: ${field} has ${l.length} items; the limit is ${maxItems}`);
  }
  return maxEach ? l.map((x) => (typeof x === 'string' ? checkStr(slide, `${field} item`, x, maxEach) : x)) : l;
};

slides.forEach((slide, i) => {
  slide.id = String(slide.id || `slide_${i + 1}`).replace(/[^A-Za-z0-9_-]+/g, '_');
  if (ids.has(slide.id)) {
    const base = slide.id; let n = 2;
    while (ids.has(`${base}_${n}`)) n++;
    slide.id = `${base}_${n}`;
    warnings.push(`duplicate slide id "${base}" renamed`);
  }
  ids.add(slide.id);

  if (!TYPES.includes(slide.type)) {
    if (SOFT) { const t = i === 0 ? 'cover' : i === slides.length - 1 ? 'closing' : 'itinerary_day'; warnings.push(`${slide.id}: unknown type "${slide.type}" treated as ${t}`); slide.type = t; }
    else errors.push(`${slide.id}: unknown slide type "${slide.type}"`);
  }
  if (!LAYOUTS.includes(slide.layout)) {
    if (SOFT) { slide.layout = DEFAULT_LAYOUT[slide.type] || 'split_photo_text'; warnings.push(`${slide.id}: unknown layout replaced by ${slide.layout}`); }
    else errors.push(`${slide.id}: unknown layout "${slide.layout}"`);
  }

  const c = slide.copy || {};
  const isCover = slide.type === 'cover';
  c.eyebrow = checkStr(slide, 'eyebrow', c.eyebrow, LIMITS.eyebrow);
  c.title = checkStr(slide, 'title', c.title, isCover ? LIMITS.cover_title : LIMITS.title);
  c.subtitle = checkStr(slide, 'subtitle', c.subtitle, LIMITS.subtitle);
  c.body = checkStr(slide, 'body', c.body, bodyMax);
  c.day_label = checkStr(slide, 'day_label', c.day_label, LIMITS.day_label);
  c.cta = checkStr(slide, 'cta', c.cta, LIMITS.cta);
  c.meta = checkList(slide, 'meta', c.meta, LIMITS.meta_items, LIMITS.meta_item);
  c.included = checkList(slide, 'included', c.included, LIMITS.list_items, LIMITS.list_item);
  c.excluded = checkList(slide, 'excluded', c.excluded, LIMITS.list_items, LIMITS.list_item);
  c.stops = checkList(slide, 'stops', c.stops, LIMITS.stops, 0);
  c.options = checkList(slide, 'options', c.options, LIMITS.options, 0);
  c.cards = checkList(slide, 'cards', c.cards, LIMITS.cards, 0);
  if (Array.isArray(c.cards)) {
    c.cards = c.cards.map((card) => ({ ...card, title: checkStr(slide, 'card title', card.title, LIMITS.card_title), body: checkStr(slide, 'card body', card.body, LIMITS.card_body) }));
  }
  if (!c.title) errors.push(`${slide.id}: title is required`);
  slide.copy = c;

  // Assets: counts and the source policy.
  let photos = 0, decoratives = 0;
  const assets = [];
  for (const a of slide.assets || []) {
    if (a.purpose === 'decorative_element') {
      if (decoratives++ >= 1) { warnings.push(`${slide.id}: extra decorative element dropped`); continue; }
    } else if (photos++ >= 3) { warnings.push(`${slide.id}: more than three photos; extras dropped`); continue; }

    const named = a.subject_kind === 'named_property' || a.subject_kind === 'brand_element';
    if (a.source === 'workdrive') {
      const match = String(a.asset_match || '').toLowerCase();
      if (!match || !known.has(match)) {
        a.source = named ? 'placeholder' : 'pexels';
        warnings.push(`${slide.id}: "${a.asset_match || '?'}" is not in the asset index; using ${a.source}`);
      }
    }
    if (named && a.source === 'pexels') {
      if (SOFT) { a.source = 'placeholder'; warnings.push(`${slide.id}: a named property cannot use a stock photo; placeholder used`); }
      else errors.push(`${slide.id}: ${a.purpose} is a named property and must not use pexels`);
    }
    if (a.source === 'pexels' && !a.fallback_query) {
      if (SOFT) { a.source = 'placeholder'; warnings.push(`${slide.id}: pexels asset without a query; placeholder used`); }
      else errors.push(`${slide.id}: ${a.purpose} uses pexels but has no fallback_query`);
    }
    assets.push(a);
  }
  slide.assets = assets;
});

if (slides[0].type !== 'cover') errors.push('the first slide must be the cover');
if (slides[slides.length - 1].type !== 'closing') errors.push('the last slide must be the closing slide');
if (ctx.style === 'immersive' && slides[0].layout !== 'full_bleed_hero_with_left_copy') {
  if (SOFT) { slides[0].layout = 'full_bleed_hero_with_left_copy'; warnings.push('cover layout set to the full-bleed hero'); }
  else errors.push('an immersive cover must use full_bleed_hero_with_left_copy');
}
for (let i = 2; i < slides.length; i++) {
  if (slides[i].layout === slides[i - 1].layout && slides[i].layout === slides[i - 2].layout) {
    const msg = `slides ${slides[i - 2].id}, ${slides[i - 1].id}, ${slides[i].id} use the same layout three times in a row`;
    if (SOFT) warnings.push(msg); else errors.push(msg);
    break;
  }
}

m.slides = slides;
out.manifest = m;
out.valid = errors.length === 0;
return [{ json: out }];
