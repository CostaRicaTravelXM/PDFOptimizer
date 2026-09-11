/**
 * Assemble the n8n workflows from their sources:
 *
 *   npm run n8n:build      → n8n/workflows/presentaciones-main.json
 *                            n8n/workflows/presentaciones-error-handler.json
 *
 * The Code nodes are written as real files under n8n/src/code/ so they can be read, diffed
 * and run by the offline harness; this script inlines them. The system prompt, the manifest
 * JSON schema, the copy limits and the layout ids are pulled from the app's own TypeScript
 * constants (bundled with esbuild), so the planner, the validator and the compiler cannot
 * drift apart. Credentials are referenced by name only — nothing secret is in the output.
 */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(here, 'workflows');
const tmp = join(root, '.check');
mkdirSync(outDir, { recursive: true });
mkdirSync(tmp, { recursive: true });

// --- constants from the app --------------------------------------------------------------
const bundle = join(tmp, 'n8n-constants.bundle.mjs');
await build({
  entryPoints: [join(here, 'src/constants-entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { '@': root },
  outfile: bundle,
  logLevel: 'warning',
});
const C = await import(pathToFileURL(bundle).href + `?t=${Date.now()}`);

// --- prompt ---------------------------------------------------------------------------------
const grammar = {
  cover: ['full_bleed_hero_with_left_copy'],
  overview: ['split_photo_text', 'full_bleed_hero_with_left_copy'],
  route: ['timeline_route'],
  itinerary_day: ['split_photo_text', 'asymmetric_two_photo_editorial'],
  accommodation: ['hotel_comparison', 'asymmetric_two_photo_editorial'],
  inclusions: ['information_cards'],
  closing: ['closing_story'],
};
const L = C.COPY_LIMITS;
const copyLimits = [
  `- eyebrow: ${L.eyebrow}`,
  `- title: ${L.cover_title} on the cover, ${L.title} elsewhere`,
  `- subtitle: ${L.subtitle}`,
  `- body: ${L.body_immersive} (immersive) / ${L.body_minimal} (minimal)`,
  `- day_label: ${L.day_label}`,
  `- meta: up to ${L.meta_items} items of ${L.meta_item}`,
  `- stops: up to ${L.stops}; label ≤ 24, sublabel ≤ 30, date ≤ 16`,
  `- cards: up to ${L.cards}; title ${L.card_title}, body ${L.card_body}`,
  `- options: up to ${L.options}; name ≤ 40, location ≤ 30, room ≤ 40, notes ≤ 140, price ≤ 30`,
  `- included / excluded: up to ${L.list_items} items of ${L.list_item}`,
  `- cta: ${L.cta}`,
].join('\n');

const systemPrompt = readFileSync(join(here, 'src/system-prompt.md'), 'utf8')
  .replace('{{SLIDE_GRAMMAR}}', Object.entries(grammar).map(([t, ls]) => `- ${t}: ${ls.join(', ')}`).join('\n'))
  .replace('{{COPY_LIMITS}}', copyLimits)
  .replace('{{STOPS_MAX}}', String(L.stops))
  .replace('{{OPTIONS_MAX}}', String(L.options))
  .replace('{{MIN_MINIMAL}}', String(C.SLIDE_LIMITS.minimal.min))
  .replace('{{MAX_MINIMAL}}', String(C.SLIDE_LIMITS.minimal.max))
  .replace('{{MIN_IMMERSIVE}}', String(C.SLIDE_LIMITS.immersive.min))
  .replace('{{MAX_IMMERSIVE}}', String(C.SLIDE_LIMITS.immersive.max))
  .replace('{{HARD_MAX}}', String(C.SLIDE_LIMITS.hard_max))
  .replace('{{PALETTE}}', C.BRAND_PALETTE_HEX.join(', '))
  .replace('{{FONTS}}', C.FONT_WHITELIST.join(', '))
  .trim();

// --- code nodes -------------------------------------------------------------------------------
const injections = {
  __TEXT_MIN_CHARS__: JSON.stringify(C.LIMITS.TEXT_MIN_CHARS),
  __SYSTEM_PROMPT__: JSON.stringify(systemPrompt),
  __MANIFEST_SCHEMA__: JSON.stringify(C.MANIFEST_JSON_SCHEMA),
  __COPY_LIMITS__: JSON.stringify(C.COPY_LIMITS),
  __SLIDE_LIMITS__: JSON.stringify(C.SLIDE_LIMITS),
  __LAYOUT_IDS__: JSON.stringify(C.LAYOUT_IDS),
  __SLIDE_TYPES__: JSON.stringify(C.SLIDE_TYPES),
  __DEFAULT_LAYOUT_FOR_TYPE__: JSON.stringify(C.DEFAULT_LAYOUT_FOR_TYPE),
  __BRAND_PALETTE_HEX__: JSON.stringify(C.BRAND_PALETTE_HEX),
  __FONT_WHITELIST__: JSON.stringify(C.FONT_WHITELIST),
};

export function codeSource(file, extra = {}) {
  let src = readFileSync(join(here, 'src/code', file), 'utf8');
  for (const [k, v] of Object.entries({ ...injections, ...extra })) src = src.split(k).join(v);
  const left = src.match(/__[A-Z_]+__/);
  if (left) throw new Error(`${file}: placeholder ${left[0]} was not injected`);
  return src;
}

// --- node factory -----------------------------------------------------------------------------
const uuid = (seed) => {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const CRED = {
  toolsSecret: { httpHeaderAuth: { id: '', name: 'Tools Suite → n8n (x-tools-secret)' } },
  bearer: { httpHeaderAuth: { id: '', name: 'n8n → Tools Suite (bearer)' } },
  anthropic: { anthropicApi: { id: '', name: 'Anthropic account TravelXM' } },
  pexels: { httpHeaderAuth: { id: '', name: 'Pexels' } },
  canva: { canvaOAuth2Api: { id: '', name: 'Canva account' } },
  n8nApi: { n8nApi: { id: '', name: 'n8n API' } },
};

const CTX = "$('Contexto').first().json";

function makeWorkflow(name) {
  const nodes = [];
  const connections = {};
  const add = (name, type, typeVersion, parameters, extra = {}) => {
    nodes.push({ id: uuid(`${name}:${type}`), name, type, typeVersion, position: [0, 0], parameters, ...extra });
    return name;
  };
  const link = (from, to, { output = 0, input = 0 } = {}) => {
    connections[from] ??= { main: [] };
    while (connections[from].main.length <= output) connections[from].main.push([]);
    connections[from].main[output].push({ node: to, type: 'main', index: input });
  };
  const chain = (...names) => {
    for (let i = 0; i < names.length - 1; i++) link(names[i], names[i + 1]);
  };
  const place = (name, x, y) => {
    const n = nodes.find((n) => n.name === name);
    if (n) n.position = [x, y];
  };
  const finish = () => ({
    name,
    nodes,
    connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true },
    pinData: {},
    active: false,
  });
  return { add, link, chain, place, finish };
}

// Reusable node shapes ------------------------------------------------------------------------
const code = (js, mode = 'runOnceForAllItems') => ({ jsCode: js, mode });

const ifBool = (expr, truthy = true) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: uuid(expr + truthy), leftValue: `={{ ${expr} }}`, rightValue: '', operator: { type: 'boolean', operation: truthy ? 'true' : 'false', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});
const ifEquals = (expr, value) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: uuid(expr + value), leftValue: `={{ ${expr} }}`, rightValue: value, operator: { type: 'string', operation: 'equals' } }],
    combinator: 'and',
  },
  options: {},
});

const respond = (bodyExpr, code) => ({ respondWith: 'json', responseBody: `={{ ${bodyExpr} }}`, options: { responseCode: code } });

/** PATCH the job record through the app. `bodyExpr` is a JS object literal, evaluated by n8n. */
const patchJob = (bodyExpr) => ({
  method: 'PATCH',
  url: `={{ ${CTX}.appUrl }}/api/presentations/jobs/{{ ${CTX}.jobId }}`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: `={{ JSON.stringify(${bodyExpr}) }}`,
  options: { timeout: 30000 },
});
const patchExtra = { credentials: CRED.bearer, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 };

const claudeCall = () => ({
  method: 'POST',
  url: `={{ ${CTX}.anthropicUrl }}`,
  authentication: 'predefinedCredentialType',
  nodeCredentialType: 'anthropicApi',
  sendHeaders: true,
  headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] },
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '={{ JSON.stringify($json.request) }}',
  options: { timeout: 600000 },
});
const claudeExtra = { credentials: CRED.anthropic, retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, onError: 'continueErrorOutput' };

// --- Main workflow ------------------------------------------------------------------------------
function buildMain() {
  const w = makeWorkflow('TravelXM — Presentaciones · Main');
  const { add, link, chain, place } = w;

  add('Instrucciones', 'n8n-nodes-base.stickyNote', 1, {
    width: 520,
    height: 420,
    content: [
      '## TravelXM — Presentaciones',
      '',
      'Generado por `npm run n8n:build`; no editar el código de los nodos aquí, editar `n8n/src/`.',
      '',
      '**Antes de activar:**',
      '1. Nodo **Config**: poner `TOOLS_APP_URL` (la app en Vercel) y `CANVA_ENABLED`.',
      '2. Credenciales: *Tools Suite → n8n (x-tools-secret)* en el Webhook; *n8n → Tools Suite (bearer)* en los nodos `Estado: …` y `Compilar`; *Anthropic*; *Pexels*; *Canva account* (Canva OAuth2 API: sólo Client ID y Secret, el resto viene puesto).',
      '3. Settings → Error Workflow → *TravelXM — Presentaciones · Error handler*.',
      '4. Activar y copiar la Production URL del Webhook a `N8N_PRESENTATION_WEBHOOK_URL` en Vercel.',
      '',
      'El cuerpo del webhook puede llevar `dryRun: true` (omite Canva) y `force: true` (re-ejecuta un job terminado).',
    ].join('\n'),
  });

  add('Webhook', 'n8n-nodes-base.webhook', 2, {
    httpMethod: 'POST',
    path: 'itinerary-presentation',
    authentication: 'headerAuth',
    responseMode: 'responseNode',
    options: {},
  }, { webhookId: uuid('webhook:itinerary-presentation'), credentials: CRED.toolsSecret });

  add('Validar payload', 'n8n-nodes-base.code', 2, code(codeSource('validate-payload.js')));
  add('¿Payload válido?', 'n8n-nodes-base.if', 2.2, ifBool('$json.ok'));
  add('Responder 400', 'n8n-nodes-base.respondToWebhook', 1.1, respond('JSON.stringify({ accepted: false, errors: $json.errors })', 400));
  add('Responder 202', 'n8n-nodes-base.respondToWebhook', 1.1, respond('JSON.stringify({ accepted: true, jobId: $json.jobId })', 202));

  add('Config', 'n8n-nodes-base.set', 3.4, {
    assignments: {
      assignments: [
        { id: uuid('cfg1'), name: 'TOOLS_APP_URL', value: 'https://REEMPLAZAR.vercel.app', type: 'string' },
        { id: uuid('cfg2'), name: 'CLAUDE_MODEL', value: 'claude-opus-5', type: 'string' },
        { id: uuid('cfg3'), name: 'CLAUDE_EFFORT', value: 'medium', type: 'string' },
        { id: uuid('cfg4'), name: 'CANVA_ENABLED', value: 'true', type: 'string' },
        { id: uuid('cfg5'), name: 'ANTHROPIC_URL', value: 'https://api.anthropic.com/v1/messages', type: 'string' },
        { id: uuid('cfg6'), name: 'PEXELS_URL', value: 'https://api.pexels.com/v1/search', type: 'string' },
        { id: uuid('cfg7'), name: 'CANVA_URL', value: 'https://api.canva.com/rest/v1', type: 'string' },
      ],
    },
    includeOtherFields: false,
    options: {},
  });
  add('Contexto', 'n8n-nodes-base.code', 2, code(codeSource('contexto.js')));

  add('Leer job', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'GET',
    url: `={{ ${CTX}.appUrl }}/api/presentations/jobs/{{ ${CTX}.jobId }}`,
    options: { timeout: 30000 },
  }, { onError: 'continueErrorOutput' });
  add('¿Se puede ejecutar?', 'n8n-nodes-base.code', 2, code(codeSource('can-run.js')));
  add('¿Ejecutar?', 'n8n-nodes-base.if', 2.2, ifBool('$json.run'));

  add('Estado: planning', 'n8n-nodes-base.httpRequest', 4.2, patchJob("{ status: 'planning', step: 'Leyendo el brief y planificando las diapositivas…' }"), patchExtra);
  add('Índice de activos', 'n8n-nodes-base.code', 2, code(codeSource('asset-index.js')));
  add('Construir petición Claude', 'n8n-nodes-base.code', 2, code(codeSource('build-claude-request.js')));
  add('Claude — planificar', 'n8n-nodes-base.httpRequest', 4.2, claudeCall(), claudeExtra);
  add('Validar manifest', 'n8n-nodes-base.code', 2, code(codeSource('validate-manifest.js', { __ATTEMPT__: '1' })));
  add('¿Manifest válido?', 'n8n-nodes-base.if', 2.2, ifBool('$json.valid'));
  add('Construir reintento', 'n8n-nodes-base.code', 2, code(codeSource('build-retry.js')));
  add('Claude — reintento', 'n8n-nodes-base.httpRequest', 4.2, claudeCall(), claudeExtra);
  add('Validar manifest (2)', 'n8n-nodes-base.code', 2, code(codeSource('validate-manifest.js', { __ATTEMPT__: '2' })));
  add('¿Manifest válido (2)?', 'n8n-nodes-base.if', 2.2, ifBool('$json.valid'));
  add('Manifest final', 'n8n-nodes-base.code', 2, code(codeSource('manifest-final.js')));

  add('Estado: resolving_assets', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'resolving_assets', step: 'Buscando fotografías…', meta: $json.meta, warnings: $json.warnings }",
  ), patchExtra);

  add('Aplanar requisitos', 'n8n-nodes-base.code', 2, code(codeSource('flatten-requirements.js')));
  add('WorkDrive y ruta', 'n8n-nodes-base.code', 2, code(codeSource('route-assets.js')));
  add('¿Buscar en Pexels?', 'n8n-nodes-base.if', 2.2, ifEquals('$json.route', 'pexels'));
  add('Pexels — buscar', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'GET',
    url: `={{ ${CTX}.pexelsUrl }}`,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendQuery: true,
    queryParameters: {
      parameters: [
        { name: 'query', value: '={{ $json.query }}' },
        { name: 'orientation', value: '={{ $json.orientation }}' },
        { name: 'size', value: 'large' },
        { name: 'per_page', value: '8' },
        { name: 'locale', value: 'en-US' },
      ],
    },
    options: { timeout: 30000, batching: { batch: { batchSize: 5, batchInterval: 1200 } } },
  }, { credentials: CRED.pexels, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: 'continueRegularOutput' });
  add('Unir', 'n8n-nodes-base.merge', 3, { mode: 'append', numberInputs: 2 });
  add('Seleccionar activos', 'n8n-nodes-base.code', 2, code(codeSource('select-assets.js')));

  add('Estado: compiling', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'compiling', step: 'Construyendo la presentación…', assets: $json.assetUsage, warnings: $json.warnings }",
  ), patchExtra);
  add('Compilar', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST',
    url: `={{ ${CTX}.appUrl }}/api/presentations/compile`,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ jobId: ${CTX}.jobId, manifest: $('Manifest final').first().json.manifest, assets: $('Seleccionar activos').first().json.assets }) }}`,
    options: { timeout: 300000 },
  }, { credentials: CRED.bearer, retryOnFail: true, maxTries: 2, waitBetweenTries: 10000, onError: 'continueErrorOutput' });
  add('Estado: importing', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'importing', step: 'Importando a Canva…', pptxKey: $json.pptxKey, pptxUrl: $json.pptxUrl, manifestKey: 'presentations/jobs/' + " + CTX + ".jobId + '/manifest.json', warnings: $json.warnings }",
  ), patchExtra);

  add('¿Importar a Canva?', 'n8n-nodes-base.if', 2.2, ifBool(`${CTX}.dryRun`, false));
  add('Estado: done (sin Canva)', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'done', step: 'Lista (Canva omitido).', warnings: ['Canva import was skipped; download the PowerPoint and import it by hand.'] }",
  ), patchExtra);

  // The official Canva node imports from a public URL and polls the job itself, so the deck
  // never passes through n8n and there is no wait loop to maintain. It throws on failure or
  // timeout; the error output carries that to the same normaliser as a success.
  add('Canva — importar', '@canva/n8n-nodes-canva.canva', 1, {
    resource: 'designImport',
    operation: 'createImport',
    url: "={{ $('Compilar').first().json.pptxUrl }}",
    title: `={{ ${CTX}.title }}`,
    pollInterval: 3000,
    maxWait: 180,
  }, { credentials: CRED.canva, onError: 'continueErrorOutput' });
  add('Resultado Canva', 'n8n-nodes-base.code', 2, code(codeSource('canva-result.js')));
  add('¿Canva OK?', 'n8n-nodes-base.if', 2.2, ifBool('$json.ok'));
  add('Estado: done (con Canva)', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'done', step: 'Lista.', canva: { designId: $json.designId, editUrl: $json.editUrl, viewUrl: $json.viewUrl || undefined } }",
  ), patchExtra);
  add('Estado: done (Canva falló)', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'done', step: 'Lista (sin Canva).', warnings: ['Canva import failed: ' + ($json.error || 'unknown error') + '. Download the PowerPoint and import it by hand.'] }",
  ), patchExtra);

  add('Fallo', 'n8n-nodes-base.code', 2, code(codeSource('fail.js')));
  add('Estado: failed', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'failed', step: 'Error en ' + $json.step, error: { message: $json.message, step: $json.status } }",
  ), { ...patchExtra, onError: 'continueRegularOutput' });

  // --- wiring -----------------------------------------------------------------------------
  chain('Webhook', 'Validar payload', '¿Payload válido?');
  link('¿Payload válido?', 'Responder 202', { output: 0 });
  link('¿Payload válido?', 'Responder 400', { output: 1 });
  chain('Responder 202', 'Config', 'Contexto', 'Leer job', '¿Se puede ejecutar?', '¿Ejecutar?');
  link('¿Ejecutar?', 'Estado: planning', { output: 0 });
  chain('Estado: planning', 'Índice de activos', 'Construir petición Claude', 'Claude — planificar', 'Validar manifest', '¿Manifest válido?');
  link('¿Manifest válido?', 'Manifest final', { output: 0 });
  link('¿Manifest válido?', 'Construir reintento', { output: 1 });
  chain('Construir reintento', 'Claude — reintento', 'Validar manifest (2)', '¿Manifest válido (2)?');
  link('¿Manifest válido (2)?', 'Manifest final', { output: 0 });
  link('¿Manifest válido (2)?', 'Fallo', { output: 1 });
  chain('Manifest final', 'Estado: resolving_assets', 'Aplanar requisitos', 'WorkDrive y ruta', '¿Buscar en Pexels?');
  link('¿Buscar en Pexels?', 'Pexels — buscar', { output: 0 });
  link('Pexels — buscar', 'Unir', { input: 0 });
  link('¿Buscar en Pexels?', 'Unir', { output: 1, input: 1 });
  chain('Unir', 'Seleccionar activos', 'Estado: compiling', 'Compilar', 'Estado: importing', '¿Importar a Canva?');
  link('¿Importar a Canva?', 'Canva — importar', { output: 0 });
  link('¿Importar a Canva?', 'Estado: done (sin Canva)', { output: 1 });
  chain('Canva — importar', 'Resultado Canva', '¿Canva OK?');
  link('Canva — importar', 'Resultado Canva', { output: 1 }); // import failed or timed out
  link('¿Canva OK?', 'Estado: done (con Canva)', { output: 0 });
  link('¿Canva OK?', 'Estado: done (Canva falló)', { output: 1 });
  // Error outputs (second output of nodes with onError: continueErrorOutput).
  for (const n of ['Leer job', 'Claude — planificar', 'Claude — reintento', 'Compilar']) link(n, 'Fallo', { output: 1 });
  chain('Fallo', 'Estado: failed');

  // --- layout ----------------------------------------------------------------------------
  const X = 260;
  const row = (y, ...names) => names.forEach((n, i) => place(n, i * X, y));
  place('Instrucciones', -640, -80);
  row(0, 'Webhook', 'Validar payload', '¿Payload válido?', 'Responder 202', 'Config', 'Contexto', 'Leer job', '¿Se puede ejecutar?', '¿Ejecutar?', 'Estado: planning', 'Índice de activos', 'Construir petición Claude', 'Claude — planificar', 'Validar manifest', '¿Manifest válido?', 'Manifest final');
  place('Responder 400', 3 * X, 200);
  row(220, ...Array(15).fill(null), 'Construir reintento', 'Claude — reintento', 'Validar manifest (2)', '¿Manifest válido (2)?');
  row(460, 'Estado: resolving_assets', 'Aplanar requisitos', 'WorkDrive y ruta', '¿Buscar en Pexels?', 'Pexels — buscar', 'Unir', 'Seleccionar activos', 'Estado: compiling', 'Compilar', 'Estado: importing', '¿Importar a Canva?', 'Canva — importar', 'Resultado Canva', '¿Canva OK?', 'Estado: done (con Canva)');
  place('Estado: done (sin Canva)', 11 * X, 680);
  place('Estado: done (Canva falló)', 14 * X, 680);
  row(900, ...Array(8).fill(null), 'Fallo', 'Estado: failed');
  return w.finish();
}

// --- Error handler workflow ------------------------------------------------------------------
function buildErrorHandler() {
  const w = makeWorkflow('TravelXM — Presentaciones · Error handler');
  const { add, chain, link, place } = w;
  add('Instrucciones', 'n8n-nodes-base.stickyNote', 1, {
    width: 460,
    height: 260,
    content: [
      '## Error handler',
      '',
      'Se ejecuta cuando el workflow principal falla sin pasar por su propio nodo *Fallo*.',
      'Lee la ejecución fallida por la API de n8n, localiza el `jobId` y marca el job como `failed` en la app.',
      '',
      '**Config**: `TOOLS_APP_URL` (la app) y `N8N_BASE_URL` (esta instancia, p. ej. https://xxx.app.n8n.cloud). Credenciales: *n8n API* y *n8n → Tools Suite (bearer)*.',
    ].join('\n'),
  });
  add('Error Trigger', 'n8n-nodes-base.errorTrigger', 1, {});
  add('Config', 'n8n-nodes-base.set', 3.4, {
    assignments: {
      assignments: [
        { id: uuid('ecfg1'), name: 'TOOLS_APP_URL', value: 'https://REEMPLAZAR.vercel.app', type: 'string' },
        { id: uuid('ecfg2'), name: 'N8N_BASE_URL', value: 'https://REEMPLAZAR.app.n8n.cloud', type: 'string' },
      ],
    },
    includeOtherFields: true,
    options: {},
  });
  add('Leer ejecución', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'GET',
    url: "={{ $('Config').first().json.N8N_BASE_URL }}/api/v1/executions/{{ $('Error Trigger').first().json.execution.id }}",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'n8nApi',
    sendQuery: true,
    queryParameters: { parameters: [{ name: 'includeData', value: 'true' }] },
    options: { timeout: 30000 },
  }, { credentials: CRED.n8nApi, onError: 'continueRegularOutput' });
  add('Localizar job', 'n8n-nodes-base.code', 2, code(codeSource('error-find-job.js')));
  add('¿Job encontrado?', 'n8n-nodes-base.if', 2.2, ifBool('$json.found'));
  add('Estado: failed', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'PATCH',
    url: "={{ $('Config').first().json.TOOLS_APP_URL }}/api/presentations/jobs/{{ $json.jobId }}",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ status: 'failed', step: 'Error en ' + $json.node, error: { message: $json.message, step: 'unknown' } }) }}",
    options: { timeout: 30000 },
  }, { credentials: CRED.bearer, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 });

  chain('Error Trigger', 'Config', 'Leer ejecución', 'Localizar job', '¿Job encontrado?');
  link('¿Job encontrado?', 'Estado: failed', { output: 0 });
  place('Instrucciones', -520, -60);
  ['Error Trigger', 'Config', 'Leer ejecución', 'Localizar job', '¿Job encontrado?', 'Estado: failed'].forEach((n, i) => place(n, i * 260, 0));
  return w.finish();
}

const main = buildMain();
const errorHandler = buildErrorHandler();
writeFileSync(join(outDir, 'presentaciones-main.json'), JSON.stringify(main, null, 2) + '\n');
writeFileSync(join(outDir, 'presentaciones-error-handler.json'), JSON.stringify(errorHandler, null, 2) + '\n');
writeFileSync(join(outDir, 'system-prompt.generated.md'), systemPrompt + '\n');
console.log(`main: ${main.nodes.length} nodes; error handler: ${errorHandler.nodes.length} nodes; system prompt ${systemPrompt.length} chars → ${outDir}`);
