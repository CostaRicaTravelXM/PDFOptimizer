// Fallo — runs once. Every error output in the workflow lands here. It names the node that
// failed and carries a readable message to the app, which shows it under the timeline.
const item = $input.first().json || {};
let jobId = '';
try {
  jobId = $('Contexto').first().json.jobId;
} catch (e) {
  jobId = (($('Webhook').first().json || {}).body || {}).jobId || '';
}
const raw =
  (item.error && (item.error.message || item.error.description || item.error)) ||
  item.message ||
  (Array.isArray(item.errors) ? item.errors.join('; ') : '') ||
  'Unknown error';
const step = $prevNode.name;

// Which timeline row failed, for the page: map node names onto job statuses.
const STATUS_FOR = [
  [/Claude|manifest|petición/i, 'planning'],
  [/Pexels|activos|requisitos|ruta/i, 'resolving_assets'],
  [/Compilar/i, 'compiling'],
  [/Canva|PPTX/i, 'importing'],
];
let status = 'queued';
for (const [re, s] of STATUS_FOR) if (re.test(step)) { status = s; break; }

return [{ json: { jobId, step, status, message: String(raw).slice(0, 500) } }];
