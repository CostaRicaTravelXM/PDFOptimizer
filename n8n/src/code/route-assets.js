// WorkDrive y ruta — runs once over all requirement items. The pluggable first step of the
// resolver: look for an approved asset, then decide where the photo comes from.
//
// Order of precedence, from the business rules: an approved library match wins; a named
// property or brand element with no match gets the branded placeholder (never a stock
// photo, even if the planner asked for one); anything generic goes to Pexels.
const index = ($('Índice de activos').first().json || {}).assets || [];
const byName = new Map();
for (const a of index) {
  for (const key of [a.filename, a.id]) if (key) byName.set(String(key).toLowerCase(), a);
}
const normalize = (s) => String(s || '').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-');
const byNormalized = new Map();
for (const a of index) if (a.filename) byNormalized.set(normalize(a.filename), a);

return $input.all().map((item) => {
  const r = { ...item.json };
  if (r.none) return { json: { ...r, route: 'none' } };

  let resolved = null;
  if (r.asset_match) {
    resolved = byName.get(String(r.asset_match).toLowerCase()) || byNormalized.get(normalize(r.asset_match)) || null;
  }
  const named = r.subject_kind === 'named_property' || r.subject_kind === 'brand_element' || r.purpose === 'decorative_element';

  if (resolved && resolved.url) {
    r.route = 'workdrive';
    r.resolved = { url: resolved.url, id: resolved.id || resolved.workdrive_file_id || '', filename: resolved.filename || '', width: resolved.width, height: resolved.height };
  } else if (named) {
    r.route = 'placeholder';
    if (r.source === 'pexels') r.overridden = 'a named property may not use a stock photo';
  } else if (r.query) {
    r.route = 'pexels';
  } else {
    r.route = 'placeholder';
    r.overridden = 'no query for a stock search';
  }
  return { json: r };
});
