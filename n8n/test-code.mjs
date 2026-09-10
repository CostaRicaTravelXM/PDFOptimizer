/**
 * Run every Code node of the presentation workflow outside n8n:
 *
 *   npm run n8n:test
 *
 * n8n's Code node evaluates plain JavaScript with a few globals ($input, $('Node'), $runIndex,
 * $prevNode). This harness provides those over hand-built node outputs and walks the same
 * sequence the workflow does — payload → request → validation → retry → asset resolution →
 * Canva result — asserting what each step must produce. It cannot prove the n8n wiring, but
 * it catches the logic errors that would otherwise only show up on n8n Cloud, one paid
 * execution at a time. It also runs the app's own manifest validation over the workflow's
 * output, so the two validators are proven to agree.
 */

import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { codeSource } from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// --- a tiny n8n ---------------------------------------------------------------------------
function runCode(file, { inputs, nodes = {}, runIndex = 0, prevNode = 'prev', extra = {}, pairing = null }) {
  const src = codeSource(file, extra);
  const $input = { all: () => inputs, first: () => inputs[0], last: () => inputs[inputs.length - 1] };
  const $ = (name) => {
    const items = nodes[name];
    if (!items) throw new Error(`No data for node "${name}"`);
    return {
      first: () => items[0],
      all: () => items,
      itemMatching: (i) => {
        const idx = pairing ? pairing[i] : i;
        if (idx === undefined || !items[idx]) throw new Error('no paired item');
        return items[idx];
      },
    };
  };
  const fn = new Function('$input', '$', '$runIndex', '$prevNode', 'Buffer', src);
  return fn($input, $, runIndex, { name: prevNode }, Buffer);
}

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', `${name}: ${e.message}`]);
  }
}

// --- fixtures --------------------------------------------------------------------------------
const payload = JSON.parse(readFileSync(join(here, 'fixtures/sample-payload.json'), 'utf8'));
const fixtureManifest = JSON.parse(readFileSync(join(root, 'scripts/presentations/fixture-manifest.json'), 'utf8'));

/** The fixture manifest as the strict schema would have Claude emit it: every key present, null when unused. */
function toSchemaForm(m) {
  const n = (v) => (v === undefined ? null : v);
  return {
    presentation: { title: m.presentation.title, subtitle: n(m.presentation.subtitle), style: m.presentation.style, audience: m.presentation.audience, language: m.presentation.language },
    brand: { palette: n(m.brand?.palette), title_font: n(m.brand?.title_font), body_font: n(m.brand?.body_font) },
    slides: m.slides.map((s) => ({
      id: s.id,
      type: s.type,
      layout: s.layout,
      theme: n(s.theme),
      copy: {
        eyebrow: n(s.copy.eyebrow), title: n(s.copy.title), subtitle: n(s.copy.subtitle), body: n(s.copy.body), day_label: n(s.copy.day_label),
        meta: n(s.copy.meta),
        stops: s.copy.stops ? s.copy.stops.map((x) => ({ label: x.label, sublabel: n(x.sublabel), date: n(x.date) })) : null,
        cards: s.copy.cards ? s.copy.cards.map((x) => ({ title: x.title, body: n(x.body) })) : null,
        options: s.copy.options ? s.copy.options.map((x) => ({ name: x.name, location: n(x.location), room: n(x.room), notes: n(x.notes), price: n(x.price) })) : null,
        included: n(s.copy.included), excluded: n(s.copy.excluded),
        contact: s.copy.contact ? { name: n(s.copy.contact.name), email: n(s.copy.contact.email), phone: n(s.copy.contact.phone), website: n(s.copy.contact.website) } : null,
        cta: n(s.copy.cta),
      },
      assets: (s.assets || []).map((a) => ({ purpose: a.purpose, source: a.source, subject_kind: a.subject_kind, asset_match: n(a.asset_match), fallback_query: n(a.fallback_query), orientation: n(a.orientation) })),
      layout_constraints: s.layout_constraints ? { title_max_chars: n(s.layout_constraints.title_max_chars), body_max_chars: n(s.layout_constraints.body_max_chars) } : null,
      warnings: n(s.warnings),
    })),
  };
}
const claudeResponse = (manifest, extra = {}) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(manifest) }],
  usage: { input_tokens: 9000, output_tokens: 7000, cache_read_input_tokens: 0 },
  ...extra,
});
mkdirSync(join(here, 'fixtures'), { recursive: true });
writeFileSync(join(here, 'fixtures/sample-claude-response.json'), JSON.stringify(claudeResponse(toSchemaForm(fixtureManifest)), null, 2) + '\n');

const config = [{ json: { TOOLS_APP_URL: 'https://tools.example.com/', CLAUDE_MODEL: 'claude-opus-5', CLAUDE_EFFORT: 'medium', CANVA_ENABLED: 'true', ANTHROPIC_URL: 'https://api.anthropic.com/v1/messages', PEXELS_URL: 'https://api.pexels.com/v1/search', CANVA_URL: 'https://api.canva.com/rest/v1' } }];
const webhook = [{ json: { body: payload, headers: {} } }];
const nodes = { Webhook: webhook, Config: config };

// --- 1. payload -----------------------------------------------------------------------------------
test('validate-payload accepts the sample', () => {
  const [{ json }] = runCode('validate-payload.js', { inputs: webhook });
  assert.equal(json.ok, true, json.errors.join('; '));
  assert.equal(json.jobId, payload.jobId);
});
test('validate-payload rejects short text and bad style', () => {
  const [{ json }] = runCode('validate-payload.js', { inputs: [{ json: { body: { ...payload, text: 'short', style: 'fancy' } } }] });
  assert.equal(json.ok, false);
  assert.ok(json.errors.some((e) => e.includes('text')));
  assert.ok(json.errors.some((e) => e.includes('style')));
});

// --- 2. context -----------------------------------------------------------------------------------
let ctx;
test('contexto trims the app URL and honours dryRun', () => {
  [{ json: ctx }] = runCode('contexto.js', { inputs: [{ json: {} }], nodes });
  assert.equal(ctx.appUrl, 'https://tools.example.com');
  assert.equal(ctx.dryRun, true, 'the sample payload sets dryRun');
  assert.equal(ctx.model, 'claude-opus-5');
});
nodes['Contexto'] = [{ json: ctx }];

test('can-run allows queued and failed, refuses running', () => {
  const ok = runCode('can-run.js', { inputs: [{ json: { status: 'queued' } }], nodes })[0].json;
  assert.equal(ok.run, true);
  const no = runCode('can-run.js', { inputs: [{ json: { status: 'planning' } }], nodes })[0].json;
  assert.equal(no.run, false);
});

// --- 3. request -----------------------------------------------------------------------------------
nodes['Índice de activos'] = runCode('asset-index.js', { inputs: [{ json: {} }], nodes });
let request;
test('build-claude-request has cache breakpoints, schema and the brief', () => {
  [{ json: { request } }] = runCode('build-claude-request.js', { inputs: [{ json: {} }], nodes });
  assert.equal(request.model, 'claude-opus-5');
  assert.equal(request.system[0].cache_control.type, 'ephemeral');
  assert.ok(request.system[0].text.length > 3000, 'system prompt present');
  assert.ok(request.system[0].text.includes('body: 280 (immersive) / 420 (minimal)'), 'copy limits injected');
  assert.equal(request.messages[0].content[0].cache_control.type, 'ephemeral');
  assert.ok(request.messages[0].content[0].text.includes(payload.text.slice(0, 40)));
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.equal(request.output_config.format.schema.additionalProperties, false);
  assert.ok(request.messages[0].content[1].text.includes('None. Use source "placeholder"'), 'empty index explained');
  assert.equal(request.temperature, undefined);
});
nodes['Construir petición Claude'] = [{ json: { request } }];

// --- 4. validation, retry, final --------------------------------------------------------------
let v1;
test('validate-manifest attempt 1 flags the over-long title only', () => {
  [{ json: v1 }] = runCode('validate-manifest.js', { inputs: [{ json: claudeResponse(toSchemaForm(fixtureManifest)) }], nodes, extra: { __ATTEMPT__: '1' } });
  assert.equal(v1.valid, false);
  assert.equal(v1.errors.length, 1, v1.errors.join('; '));
  assert.ok(v1.errors[0].startsWith('long_title: title'), v1.errors[0]);
  assert.ok(v1.warnings.some((w) => w.includes('palette')), 'off-brand palette warned');
  assert.ok(typeof v1.raw === 'string');
});
nodes['Validar manifest'] = [{ json: v1 }];

test('validate-manifest fails hard on max_tokens and bad JSON', () => {
  const cut = runCode('validate-manifest.js', { inputs: [{ json: claudeResponse({}, { stop_reason: 'max_tokens' }) }], nodes, extra: { __ATTEMPT__: '1' } })[0].json;
  assert.equal(cut.valid, false);
  assert.ok(cut.errors[0].includes('max_tokens'));
  const bad = runCode('validate-manifest.js', { inputs: [{ json: { ...claudeResponse({}), content: [{ type: 'text', text: '{not json' }] } }], nodes, extra: { __ATTEMPT__: '1' } })[0].json;
  assert.ok(bad.errors[0].includes('not valid JSON'));
});

test('validate-manifest catches a stock photo on a named hotel', () => {
  const m = toSchemaForm(fixtureManifest);
  m.slides[5].assets[0] = { ...m.slides[5].assets[0], source: 'pexels', fallback_query: 'hotel room' };
  const v = runCode('validate-manifest.js', { inputs: [{ json: claudeResponse(m) }], nodes, extra: { __ATTEMPT__: '1' } })[0].json;
  assert.ok(v.errors.some((e) => e.includes('named property')), v.errors.join('; '));
  const soft = runCode('validate-manifest.js', { inputs: [{ json: claudeResponse(m) }], nodes, extra: { __ATTEMPT__: '2' } })[0].json;
  assert.equal(soft.manifest.slides[5].assets[0].source, 'placeholder');
});

test('build-retry appends the answer and the error list', () => {
  const [{ json: { request: r2 } }] = runCode('build-retry.js', { inputs: [{ json: {} }], nodes });
  assert.equal(r2.messages.length, 3);
  assert.equal(r2.messages[1].role, 'assistant');
  assert.ok(r2.messages[2].content.includes('long_title: title'));
  assert.equal(r2.system[0].text, request.system[0].text, 'system prompt unchanged for the cache');
});

let v2;
test('validate-manifest attempt 2 repairs and passes', () => {
  [{ json: v2 }] = runCode('validate-manifest.js', { inputs: [{ json: claudeResponse(toSchemaForm(fixtureManifest)) }], nodes, extra: { __ATTEMPT__: '2' } });
  assert.equal(v2.valid, true, v2.errors.join('; '));
  const lt = v2.manifest.slides.find((s) => s.id === 'long_title');
  assert.ok(lt.copy.title.length <= 61 && lt.copy.title.endsWith('…'), lt.copy.title);
  assert.equal(lt.copy.subtitle, undefined, 'nulls stripped');
  assert.ok(v2.warnings.some((w) => w.includes('shortened')));
});
nodes['Validar manifest (2)'] = [{ json: v2 }];

let final;
test('manifest-final prefers the repaired attempt', () => {
  [{ json: final }] = runCode('manifest-final.js', { inputs: [{ json: {} }], nodes });
  assert.equal(final.meta.attempts, 2);
  assert.equal(final.manifest.slides.length, 9);
  assert.equal(final.meta.usage.output_tokens, 7000);
});
nodes['Manifest final'] = [{ json: final }];

// --- 4b. the app agrees --------------------------------------------------------------------------
const bundle = join(root, '.check', 'n8n-schema.bundle.mjs');
await build({
  stdin: { contents: "export { parseManifest, parseResolvedAssets } from '@/lib/server/presentations/schema';", resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', alias: { '@': root }, external: ['zod'], outfile: bundle, logLevel: 'warning',
});
const app = await import(pathToFileURL(bundle).href + `?t=${Date.now()}`);
test("the app's parseManifest accepts the workflow's manifest without hard errors", () => {
  const parsed = app.parseManifest(final.manifest);
  assert.equal(parsed.ok, true, parsed.ok ? '' : JSON.stringify(parsed.issues));
  assert.equal(parsed.manifest.slides.length, 9);
});
test("the app's parseManifest also accepts the raw schema-form (nulls)", () => {
  const parsed = app.parseManifest(toSchemaForm(fixtureManifest));
  assert.equal(parsed.ok, true, parsed.ok ? '' : JSON.stringify(parsed.issues));
});

// --- 5. asset resolution -------------------------------------------------------------------------
let reqs;
test('flatten-requirements emits one item per asset with size hints', () => {
  reqs = runCode('flatten-requirements.js', { inputs: [{ json: {} }], nodes });
  assert.equal(reqs.length, 12);
  const cover = reqs.find((r) => r.json.slideId === 'cover' && r.json.purpose === 'background').json;
  assert.equal(cover.minWidth, 1920);
  const sec = reqs.find((r) => r.json.slideId === 'day_02' && r.json.purpose === 'secondary_photo').json;
  assert.equal(sec.orientation, 'portrait');
});
test('flatten-requirements emits a marker when there are no assets', () => {
  const bare = { ...final, manifest: { ...final.manifest, slides: final.manifest.slides.map((s) => ({ ...s, assets: [] })) } };
  const out = runCode('flatten-requirements.js', { inputs: [{ json: {} }], nodes: { ...nodes, 'Manifest final': [{ json: bare }] } });
  assert.equal(out.length, 1);
  assert.equal(out[0].json.none, true);
});

let routed;
test('route-assets: generic → pexels, named/decorative → placeholder, index match → workdrive', () => {
  const index = [{ json: { assets: [{ id: 'wd1', filename: 'costa-rica_caribbean_puerto-viejo_beach_landscape_01.jpg', url: 'https://cdn.example.com/wd1.jpg', width: 2400, height: 1600 }] } }];
  const withMatch = reqs.map((r) => ({ json: { ...r.json } }));
  withMatch[0].json.asset_match = 'costa-rica_caribbean_puerto-viejo_beach_landscape_01.jpg';
  routed = runCode('route-assets.js', { inputs: withMatch, nodes: { ...nodes, 'Índice de activos': index } });
  const by = (id, p) => routed.find((r) => r.json.slideId === id && r.json.purpose === p).json;
  assert.equal(by('cover', 'background').route, 'workdrive');
  assert.equal(by('cover', 'decorative_element').route, 'placeholder');
  assert.equal(by('overview', 'primary_photo').route, 'pexels');
  assert.equal(by('hotels', 'primary_photo').route, 'placeholder');
  assert.equal(by('day_01', 'primary_photo').route, 'pexels');
});
nodes['WorkDrive y ruta'] = routed;

test('select-assets builds the map, dedupes photos and falls back to placeholders', () => {
  const photo = (id, w, h, alt) => ({ id, width: w, height: h, alt, url: `https://www.pexels.com/photo/${id}/`, photographer: 'Ana Test', src: { original: `https://images.pexels.com/${id}/o.jpg`, large2x: `https://images.pexels.com/${id}/l2x.jpg`, large: `https://images.pexels.com/${id}/l.jpg`, portrait: `https://images.pexels.com/${id}/p.jpg` } });
  const pexelsItems = routed.filter((r) => r.json.route === 'pexels');
  const others = routed.filter((r) => r.json.route !== 'pexels');
  // Merge append: pexels results first (paired to their requirement), then the pass-through items.
  const responses = pexelsItems.map((r, i) => {
    if (r.json.slideId === 'long_title') return { json: { photos: [] } }; // nothing found
    if (r.json.purpose === 'secondary_photo') return { json: { photos: [photo(500 + i, 2000, 3000, 'white sand cove palm trees')] } };
    // the same big photo offered to everyone, plus one alternative: dedupe must kick in
    return { json: { photos: [photo(1, 4000, 2600, 'costa rica beach palm trees'), photo(100 + i, 2200, 1500, `${r.json.query} coast`)] } };
  });
  const inputs = [...responses, ...others];
  const pairing = [...pexelsItems.map((r) => routed.indexOf(r)), ...others.map((r) => routed.indexOf(r))];
  const [{ json }] = runCode('select-assets.js', { inputs, nodes, pairing });
  assert.equal(json.assets['cover:background'].source, 'workdrive');
  assert.equal(json.assets['hotels:primary_photo'].source, 'placeholder');
  assert.equal(json.assets['cover:decorative_element'], undefined, 'decorative elements are omitted, not placeholdered');
  assert.equal(json.assets['long_title:primary_photo'].source, 'placeholder');
  assert.ok(json.warnings.some((w) => w.startsWith('long_title:')));
  const ids = json.assetUsage.filter((u) => u.source === 'pexels').map((u) => u.providerImageId);
  assert.equal(new Set(ids).size, ids.length, 'no photo used twice');
  assert.ok(json.assets['day_02:secondary_photo'].url.endsWith('/p.jpg'), 'portrait variant for portrait slots');
  assert.equal(json.assetUsage.find((u) => u.source === 'pexels').licenseUrl, 'https://www.pexels.com/license/');
});

// --- 6. Canva, failure, error handler ------------------------------------------------------------
test('canva-result maps success, failure, pending, timeout and outright errors', () => {
  const ok = runCode('canva-result.js', { inputs: [{ json: { job: { id: 'imp1', status: 'success', result: { designs: [{ id: 'D1', urls: { edit_url: 'https://canva.com/e', view_url: 'https://canva.com/v' } }] } } } }] })[0].json;
  assert.deepEqual([ok.state, ok.designId, ok.editUrl], ['success', 'D1', 'https://canva.com/e']);
  assert.equal(runCode('canva-result.js', { inputs: [{ json: { job: { id: 'imp1', status: 'failed', error: { code: 'x', message: 'nope' } } } }] })[0].json.state, 'failed');
  assert.equal(runCode('canva-result.js', { inputs: [{ json: { job: { id: 'imp1', status: 'in_progress' } } }] })[0].json.state, 'pending');
  assert.equal(runCode('canva-result.js', { inputs: [{ json: { job: { id: 'imp1', status: 'in_progress' } } }], runIndex: 40 })[0].json.state, 'timeout');
  assert.equal(runCode('canva-result.js', { inputs: [{ json: { error: { message: 'HTTP 401' } } }] })[0].json.state, 'failed');
});
test('canva-metadata encodes the title twice and keeps the binary', () => {
  const [{ json, binary }] = runCode('canva-metadata.js', { inputs: [{ json: {}, binary: { data: { mimeType: 'application/octet-stream' } } }], nodes });
  const meta = JSON.parse(Buffer.from(json.importMeta, 'base64').toString('utf8'));
  assert.equal(Buffer.from(meta.title_base64, 'base64').toString('utf8'), ctx.title);
  assert.ok(binary.data);
});
test('fail maps the failing node to a timeline status', () => {
  const [{ json }] = runCode('fail.js', { inputs: [{ json: { error: { message: 'HTTP 529 overloaded' } } }], nodes, prevNode: 'Claude — planificar' });
  assert.equal(json.status, 'planning');
  assert.equal(json.jobId, payload.jobId);
  assert.ok(json.message.includes('529'));
  assert.equal(runCode('fail.js', { inputs: [{ json: {} }], nodes, prevNode: 'Compilar' })[0].json.status, 'compiling');
});
test('error-find-job digs the job id out of execution data', () => {
  const exec = { data: { resultData: { runData: { Webhook: [{ data: { main: [[{ json: { body: { jobId: payload.jobId } } }]] } }] } } } };
  const err = [{ json: { execution: { id: '123', error: { message: 'boom' }, lastNodeExecuted: 'Compilar' } } }];
  const [{ json }] = runCode('error-find-job.js', { inputs: [{ json: exec }], nodes: { 'Error Trigger': err } });
  assert.equal(json.found, true);
  assert.equal(json.jobId, payload.jobId);
  assert.equal(json.node, 'Compilar');
});

// --- report -----------------------------------------------------------------------------------------
let failed = 0;
for (const [status, name] of results) {
  if (status !== 'ok') failed++;
  console.log(`${status === 'ok' ? '  ok ' : ' FAIL'} ${name}`);
}
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
