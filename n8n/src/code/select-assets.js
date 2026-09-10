// Seleccionar activos — runs once over the merged items. Turns search results into the
// asset map the compiler expects and the audit records the job keeps.
//
// The HTTP node replaced each Pexels item's data with the API response, so the requirement
// each result belongs to is recovered through n8n's paired-item chain (`itemMatching`).
// Photos are scored for relevance against the query, checked for orientation and size, and
// never reused within a deck; when nothing acceptable comes back the slot becomes a
// placeholder with a warning rather than a wrong picture.
const items = $input.all();
const assets = {};
const assetUsage = [];
const warnings = [];
const used = new Set();
const now = new Date().toISOString();

const tokens = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
const AVOID = /\b(hotel|resort|villa|room|suite|logo|brand|lobby)\b/i;

function pickPhoto(req, photos) {
  const q = new Set(tokens(req.query));
  const landscape = req.orientation !== 'portrait';
  let best = null;
  for (const ph of photos) {
    if (!ph || used.has(ph.id)) continue;
    const w = ph.width || 0, h = ph.height || 1;
    const ratio = w / h;
    if (w < req.minWidth) continue;
    if (landscape ? ratio < 1.25 : ratio > 0.85) continue;
    let score = 0;
    for (const t of tokens(ph.alt)) if (q.has(t)) score += 2;
    if (AVOID.test(ph.alt || '')) score -= 3;
    score += Math.min(3, w / 2000);
    if (!best || score > best.score) best = { ph, score };
  }
  return best ? best.ph : null;
}

function downloadUrl(req, ph) {
  const src = ph.src || {};
  if (req.orientation === 'portrait') return src.portrait || src.large2x || src.original;
  return src.large2x || src.large || src.original;
}

for (let i = 0; i < items.length; i++) {
  let req;
  try {
    req = $('WorkDrive y ruta').itemMatching(i).json;
  } catch (e) {
    warnings.push('a search result could not be matched to its slide');
    continue;
  }
  if (req.none) continue;
  const ref = `${req.slideId}:${req.purpose}`;
  const res = items[i].json || {};

  if (req.route === 'workdrive' && req.resolved) {
    assets[ref] = { url: req.resolved.url, source: 'workdrive', width: req.resolved.width, height: req.resolved.height };
    assetUsage.push({ slideId: req.slideId, purpose: req.purpose, source: 'workdrive', provider: 'zoho-workdrive', providerImageId: String(req.resolved.id || ''), sourceUrl: req.resolved.url, downloadUrl: req.resolved.url, retrievedAt: now });
    continue;
  }

  if (req.route === 'pexels') {
    const photos = Array.isArray(res.photos) ? res.photos : [];
    const ph = res.error ? null : pickPhoto(req, photos);
    if (ph) {
      used.add(ph.id);
      const url = downloadUrl(req, ph);
      assets[ref] = { url, source: 'pexels', width: ph.width, height: ph.height, credit: `Photo by ${ph.photographer} on Pexels` };
      assetUsage.push({ slideId: req.slideId, purpose: req.purpose, source: 'pexels', provider: 'pexels', providerImageId: String(ph.id), sourceUrl: ph.url, downloadUrl: url, photographer: ph.photographer, licenseUrl: 'https://www.pexels.com/license/', query: req.query, retrievedAt: now });
      continue;
    }
    warnings.push(res.error
      ? `${req.slideId}: the stock photo search failed (${res.error.message || 'error'}); a placeholder is used`
      : `${req.slideId}: no suitable stock photo for "${req.query}"; a placeholder is used`);
  } else if (req.overridden) {
    warnings.push(`${req.slideId}: ${req.overridden}; a placeholder is used`);
  }

  if (req.purpose === 'decorative_element') continue; // no placeholder for illustrations: simply omitted
  assets[ref] = { url: '', source: 'placeholder' };
  assetUsage.push({ slideId: req.slideId, purpose: req.purpose, source: 'placeholder', retrievedAt: now });
}

return [{ json: { assets, assetUsage, warnings } }];
