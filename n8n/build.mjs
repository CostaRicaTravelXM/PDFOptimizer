/**
 * Assemble the n8n workflows from their sources:
 *
 *   npm run n8n:build      → n8n/workflows/main.json
 *                            n8n/workflows/error-handler.json
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

const CTX = "$('Context').first().json";

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
  const w = makeWorkflow('TravelXM — Itinerary Presentation · Main');
  const { add, link, chain, place } = w;

  add('Instructions', 'n8n-nodes-base.stickyNote', 1, {
    width: 640,
    height: 560,
    content: [
      '## TravelXM — Itinerary Presentation',
      '',
      'Turns an itinerary brief into an editable Canva deck. The Tools Suite app uploads the',
      'PDF and calls this webhook; this workflow plans the slides with Claude, resolves the',
      'photographs, asks the app to compile a PPTX and imports it into Canva. **The app owns',
      'the job record** — every step here reports progress with `PATCH /api/presentations/jobs/:id`.',
      '',
      '### Generated file — do not edit here',
      'Built by `npm run n8n:build` in the PDFOptimizer repo. Edit `n8n/src/code/*.js` or',
      '`n8n/src/system-prompt.md` and redeploy with `npm run n8n:deploy`; anything typed into',
      'these nodes is overwritten. Credentials you pick by hand *are* preserved.',
      '',
      '### Before activating',
      '1. **Config** node: set `TOOLS_APP_URL` to the app, and `CANVA_ENABLED` to `false` if',
      '   Canva is not connected yet.',
      '2. Credentials: *x-tools-secret* on the Webhook; the *bearer* on every `Status: …` node',
      '   and on `Compile`; *Anthropic*; *Pexels*; *Canva account*.',
      '3. Settings → Error Workflow → *TravelXM — Itinerary Presentation · Error handler*, and',
      '   a workflow timeout above 15 minutes (Claude alone can take 4).',
      '4. Activate, then copy the Webhook Production URL into the app as',
      '   `N8N_PRESENTATION_WEBHOOK_URL`.',
      '',
      '### Testing',
      '`dryRun: true` in the webhook body skips Canva; `force: true` re-runs a job that already',
      'finished. Both are for curl tests — the app never sends them.',
    ].join('\n'),
  });

  add('Webhook', 'n8n-nodes-base.webhook', 2, {
    httpMethod: 'POST',
    path: 'itinerary-presentation',
    authentication: 'headerAuth',
    responseMode: 'responseNode',
    options: {},
  }, { webhookId: uuid('webhook:itinerary-presentation'), credentials: CRED.toolsSecret });

  add('Validate payload', 'n8n-nodes-base.code', 2, code(codeSource('validate-payload.js')));
  add('Payload valid?', 'n8n-nodes-base.if', 2.2, ifBool('$json.ok'));
  add('Respond 400', 'n8n-nodes-base.respondToWebhook', 1.1, respond('JSON.stringify({ accepted: false, errors: $json.errors })', 400));
  add('Respond 202', 'n8n-nodes-base.respondToWebhook', 1.1, respond('JSON.stringify({ accepted: true, jobId: $json.jobId })', 202));

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
  add('Context', 'n8n-nodes-base.code', 2, code(codeSource('context.js')));

  add('Read job', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'GET',
    url: `={{ ${CTX}.appUrl }}/api/presentations/jobs/{{ ${CTX}.jobId }}`,
    options: { timeout: 30000 },
  }, { onError: 'continueErrorOutput' });
  add('Can it run?', 'n8n-nodes-base.code', 2, code(codeSource('can-run.js')));
  add('Run?', 'n8n-nodes-base.if', 2.2, ifBool('$json.run'));

  add('Status: planning', 'n8n-nodes-base.httpRequest', 4.2, patchJob("{ status: 'planning', step: 'Reading the brief and planning the slides…' }"), patchExtra);
  add('Asset index', 'n8n-nodes-base.code', 2, code(codeSource('asset-index.js')));
  add('Build Claude request', 'n8n-nodes-base.code', 2, code(codeSource('build-claude-request.js')));
  add('Claude — plan', 'n8n-nodes-base.httpRequest', 4.2, claudeCall(), claudeExtra);
  add('Validate manifest', 'n8n-nodes-base.code', 2, code(codeSource('validate-manifest.js', { __ATTEMPT__: '1' })));
  add('Manifest valid?', 'n8n-nodes-base.if', 2.2, ifBool('$json.valid'));
  add('Build retry', 'n8n-nodes-base.code', 2, code(codeSource('build-retry.js')));
  add('Claude — retry', 'n8n-nodes-base.httpRequest', 4.2, claudeCall(), claudeExtra);
  add('Validate manifest (2)', 'n8n-nodes-base.code', 2, code(codeSource('validate-manifest.js', { __ATTEMPT__: '2' })));
  add('Manifest valid (2)?', 'n8n-nodes-base.if', 2.2, ifBool('$json.valid'));
  add('Final manifest', 'n8n-nodes-base.code', 2, code(codeSource('manifest-final.js')));

  add('Status: resolving assets', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'resolving_assets', step: 'Looking for photographs…', meta: $json.meta, warnings: $json.warnings }",
  ), patchExtra);

  add('Flatten requirements', 'n8n-nodes-base.code', 2, code(codeSource('flatten-requirements.js')));
  add('Route assets', 'n8n-nodes-base.code', 2, code(codeSource('route-assets.js')));
  add('Search Pexels?', 'n8n-nodes-base.if', 2.2, ifEquals('$json.route', 'pexels'));
  add('Pexels — search', 'n8n-nodes-base.httpRequest', 4.2, {
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
  add('Merge', 'n8n-nodes-base.merge', 3, { mode: 'append', numberInputs: 2 });
  add('Select assets', 'n8n-nodes-base.code', 2, code(codeSource('select-assets.js')));

  add('Status: compiling', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'compiling', step: 'Building the presentation…', assets: $json.assetUsage, warnings: $json.warnings }",
  ), patchExtra);
  add('Compile', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST',
    url: `={{ ${CTX}.appUrl }}/api/presentations/compile`,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ jobId: ${CTX}.jobId, manifest: $('Final manifest').first().json.manifest, assets: $('Select assets').first().json.assets }) }}`,
    options: { timeout: 300000 },
  }, { credentials: CRED.bearer, retryOnFail: true, maxTries: 2, waitBetweenTries: 10000, onError: 'continueErrorOutput' });
  add('Status: importing', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'importing', step: 'Importing into Canva…', pptxKey: $json.pptxKey, pptxUrl: $json.pptxUrl, manifestKey: 'presentations/jobs/' + " + CTX + ".jobId + '/manifest.json', warnings: $json.warnings }",
  ), patchExtra);

  add('Import to Canva?', 'n8n-nodes-base.if', 2.2, ifBool(`${CTX}.dryRun`, false));
  add('Status: done (no Canva)', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'done', step: 'Ready (Canva skipped).', warnings: ['Canva import was skipped; download the PowerPoint and import it by hand.'] }",
  ), patchExtra);

  // The official Canva node imports from a public URL and polls the job itself, so the deck
  // never passes through n8n and there is no wait loop to maintain. It throws on failure or
  // timeout; the error output carries that to the same normaliser as a success.
  add('Canva — import', '@canva/n8n-nodes-canva.canva', 1, {
    resource: 'designImport',
    operation: 'createImport',
    url: "={{ $('Compile').first().json.pptxUrl }}",
    title: `={{ ${CTX}.title }}`,
    pollInterval: 3000,
    maxWait: 180,
  }, { credentials: CRED.canva, onError: 'continueErrorOutput' });
  add('Canva result', 'n8n-nodes-base.code', 2, code(codeSource('canva-result.js')));
  add('Canva OK?', 'n8n-nodes-base.if', 2.2, ifBool('$json.ok'));
  add('Status: done (with Canva)', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'done', step: 'Ready.', canva: { designId: $json.designId, editUrl: $json.editUrl, viewUrl: $json.viewUrl || undefined } }",
  ), patchExtra);
  add('Status: done (Canva failed)', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'done', step: 'Ready (no Canva link).', warnings: ['Canva import failed: ' + ($json.error || 'unknown error') + '. Download the PowerPoint and import it by hand.'] }",
  ), patchExtra);

  add('Failure', 'n8n-nodes-base.code', 2, code(codeSource('fail.js')));
  add('Status: failed', 'n8n-nodes-base.httpRequest', 4.2, patchJob(
    "{ status: 'failed', step: 'Failed at ' + $json.step, error: { message: $json.message, step: $json.status } }",
  ), { ...patchExtra, onError: 'continueRegularOutput' });

  // --- wiring -----------------------------------------------------------------------------
  chain('Webhook', 'Validate payload', 'Payload valid?');
  link('Payload valid?', 'Respond 202', { output: 0 });
  link('Payload valid?', 'Respond 400', { output: 1 });
  chain('Respond 202', 'Config', 'Context', 'Read job', 'Can it run?', 'Run?');
  link('Run?', 'Status: planning', { output: 0 });
  chain('Status: planning', 'Asset index', 'Build Claude request', 'Claude — plan', 'Validate manifest', 'Manifest valid?');
  link('Manifest valid?', 'Final manifest', { output: 0 });
  link('Manifest valid?', 'Build retry', { output: 1 });
  chain('Build retry', 'Claude — retry', 'Validate manifest (2)', 'Manifest valid (2)?');
  link('Manifest valid (2)?', 'Final manifest', { output: 0 });
  link('Manifest valid (2)?', 'Failure', { output: 1 });
  chain('Final manifest', 'Status: resolving assets', 'Flatten requirements', 'Route assets', 'Search Pexels?');
  link('Search Pexels?', 'Pexels — search', { output: 0 });
  link('Pexels — search', 'Merge', { input: 0 });
  link('Search Pexels?', 'Merge', { output: 1, input: 1 });
  chain('Merge', 'Select assets', 'Status: compiling', 'Compile', 'Status: importing', 'Import to Canva?');
  link('Import to Canva?', 'Canva — import', { output: 0 });
  link('Import to Canva?', 'Status: done (no Canva)', { output: 1 });
  chain('Canva — import', 'Canva result', 'Canva OK?');
  link('Canva — import', 'Canva result', { output: 1 }); // import failed or timed out
  link('Canva OK?', 'Status: done (with Canva)', { output: 0 });
  link('Canva OK?', 'Status: done (Canva failed)', { output: 1 });
  // Error outputs (second output of nodes with onError: continueErrorOutput).
  for (const n of ['Read job', 'Claude — plan', 'Claude — retry', 'Compile']) link(n, 'Failure', { output: 1 });
  chain('Failure', 'Status: failed');

  // --- layout ----------------------------------------------------------------------------
  const X = 260;
  const row = (y, ...names) => names.forEach((n, i) => place(n, i * X, y));
  place('Instructions', -640, -80);
  row(0, 'Webhook', 'Validate payload', 'Payload valid?', 'Respond 202', 'Config', 'Context', 'Read job', 'Can it run?', 'Run?', 'Status: planning', 'Asset index', 'Build Claude request', 'Claude — plan', 'Validate manifest', 'Manifest valid?', 'Final manifest');
  place('Respond 400', 3 * X, 200);
  row(220, ...Array(15).fill(null), 'Build retry', 'Claude — retry', 'Validate manifest (2)', 'Manifest valid (2)?');
  row(460, 'Status: resolving assets', 'Flatten requirements', 'Route assets', 'Search Pexels?', 'Pexels — search', 'Merge', 'Select assets', 'Status: compiling', 'Compile', 'Status: importing', 'Import to Canva?', 'Canva — import', 'Canva result', 'Canva OK?', 'Status: done (with Canva)');
  place('Status: done (no Canva)', 11 * X, 680);
  place('Status: done (Canva failed)', 14 * X, 680);
  row(900, ...Array(8).fill(null), 'Failure', 'Status: failed');
  return w.finish();
}

// --- Error handler workflow ------------------------------------------------------------------
function buildErrorHandler() {
  const w = makeWorkflow('TravelXM — Itinerary Presentation · Error handler');
  const { add, chain, link, place } = w;
  add('Instructions', 'n8n-nodes-base.stickyNote', 1, {
    width: 520,
    height: 320,
    content: [
      '## Error handler',
      '',
      'Runs when the Main workflow dies somewhere its own `Failure` branch cannot catch — a',
      'Code node throwing, or the instance killing a run. It reads the failed execution back',
      'through the n8n API, digs the `jobId` out of it and marks that job `failed` in the app,',
      'so the page stops waiting and shows a reason instead of spinning.',
      '',
      '**Config**: `TOOLS_APP_URL` (the app) and `N8N_BASE_URL` (this instance).',
      '**Credentials**: *n8n API* and the *bearer*.',
      '',
      'Set it on the Main workflow under Settings → Error Workflow. Generated by',
      '`npm run n8n:build`; do not edit here.',
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
  add('Read execution', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'GET',
    url: "={{ $('Config').first().json.N8N_BASE_URL }}/api/v1/executions/{{ $('Error Trigger').first().json.execution.id }}",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'n8nApi',
    sendQuery: true,
    queryParameters: { parameters: [{ name: 'includeData', value: 'true' }] },
    options: { timeout: 30000 },
  }, { credentials: CRED.n8nApi, onError: 'continueRegularOutput' });
  add('Find job', 'n8n-nodes-base.code', 2, code(codeSource('error-find-job.js')));
  add('Job found?', 'n8n-nodes-base.if', 2.2, ifBool('$json.found'));
  add('Status: failed', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'PATCH',
    url: "={{ $('Config').first().json.TOOLS_APP_URL }}/api/presentations/jobs/{{ $json.jobId }}",
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ status: 'failed', step: 'Error en ' + $json.node, error: { message: $json.message, step: 'unknown' } }) }}",
    options: { timeout: 30000 },
  }, { credentials: CRED.bearer, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 });

  chain('Error Trigger', 'Config', 'Read execution', 'Find job', 'Job found?');
  link('Job found?', 'Status: failed', { output: 0 });
  place('Instructions', -520, -60);
  ['Error Trigger', 'Config', 'Read execution', 'Find job', 'Job found?', 'Status: failed'].forEach((n, i) => place(n, i * 260, 0));
  return w.finish();
}

const main = buildMain();
const errorHandler = buildErrorHandler();
writeFileSync(join(outDir, 'main.json'), JSON.stringify(main, null, 2) + '\n');
writeFileSync(join(outDir, 'error-handler.json'), JSON.stringify(errorHandler, null, 2) + '\n');
writeFileSync(join(outDir, 'system-prompt.generated.md'), systemPrompt + '\n');
console.log(`main: ${main.nodes.length} nodes; error handler: ${errorHandler.nodes.length} nodes; system prompt ${systemPrompt.length} chars → ${outDir}`);
