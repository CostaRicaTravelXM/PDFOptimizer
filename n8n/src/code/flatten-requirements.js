// Aplanar requisitos — runs once, returns one item per asset the plan asks for.
//
// A layout's purpose decides the orientation and the smallest acceptable width; a hero
// photograph stretched across the slide needs far more pixels than a card thumbnail.
const m = $('Manifest final').first().json.manifest;

function hint(layout, purpose) {
  if (purpose === 'decorative_element') return { orientation: 'landscape', minWidth: 400 };
  if (layout === 'full_bleed_hero_with_left_copy' || layout === 'closing_story') return { orientation: 'landscape', minWidth: 1920 };
  if (layout === 'asymmetric_two_photo_editorial') {
    return purpose === 'primary_photo' ? { orientation: 'landscape', minWidth: 1600 } : { orientation: 'portrait', minWidth: 1000 };
  }
  if (layout === 'split_photo_text') return { orientation: 'landscape', minWidth: 1400 };
  return { orientation: 'landscape', minWidth: 1200 };
}

const items = [];
for (const slide of m.slides) {
  for (const a of slide.assets || []) {
    const h = hint(slide.layout, a.purpose);
    items.push({
      json: {
        order: items.length,
        slideId: slide.id,
        purpose: a.purpose,
        source: a.source,
        subject_kind: a.subject_kind,
        asset_match: a.asset_match || '',
        query: a.fallback_query || '',
        orientation: a.orientation || h.orientation,
        minWidth: h.minWidth,
      },
    });
  }
}

// A node with no input items never runs, and everything after it would be skipped. A deck
// with no photos at all still has to reach the compiler, so emit a marker item instead.
if (items.length === 0) items.push({ json: { order: 0, none: true } });
return items;
