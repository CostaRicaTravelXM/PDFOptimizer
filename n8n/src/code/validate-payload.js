// Validate payload — runs once. The webhook already checked the shared secret; this checks
// the shape so a bad request is answered with 400 before any work starts.
const body = $input.first().json.body || {};
const errors = [];
const STYLES = ['minimal', 'immersive'];
const AUDIENCES = ['agent', 'internal', 'client', 'mixed'];
const LANGUAGES = ['en', 'es'];
const s = (v) => (typeof v === 'string' ? v.trim() : '');

if (!/^\d{8}-\d{6}-[0-9a-f]{6}$/.test(s(body.jobId))) errors.push('jobId is missing or malformed');
if (!s(body.title)) errors.push('title is required');
if (!STYLES.includes(body.style)) errors.push('style must be minimal or immersive');
if (!AUDIENCES.includes(body.audience)) errors.push('audience is not one of agent, internal, client, mixed');
if (!LANGUAGES.includes(body.language)) errors.push('language must be en or es');
if (!s(body.destination)) errors.push('destination is required');
if (s(body.text).length < __TEXT_MIN_CHARS__) {
  errors.push('text is too short to plan from (the PDF may be a scan)');
}

return [{ json: { ok: errors.length === 0, errors, jobId: s(body.jobId) } }];
