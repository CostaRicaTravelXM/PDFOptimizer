/**
 * A stand-in for the n8n workflow, for developing the tool without n8n.
 *
 *   npm run presentations:mock-n8n            # listens on http://localhost:5678
 *   npm run presentations:mock-n8n -- --fail-at=compiling
 *
 * Point `.env.local` at it:
 *
 *   N8N_PRESENTATION_WEBHOOK_URL=http://localhost:5678/webhook/itinerary-presentation
 *
 * It accepts the webhook exactly as n8n will (checks `x-tools-secret`, answers 202 at once),
 * then walks the job through every status by calling the app's PATCH route, asks the app to
 * compile the fixture manifest — restyled to the job's own title, style and language — and
 * finishes with `done` and a PowerPoint link. Canva is skipped, which is also the app's
 * "import failed" path, so the download-only result gets exercised too.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadEnv() {
  const file = join(root, '.env.local');
  const env = { ...process.env };
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#')) env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
const APP_URL = env.TOOLS_APP_URL ?? 'http://localhost:3000';
const SHARED_SECRET = env.N8N_SHARED_SECRET;
const COMPILE_SECRET = env.PRESENTATIONS_COMPILE_SECRET;
const PORT = Number(env.MOCK_N8N_PORT ?? 5678);
const failAt = process.argv.find((a) => a.startsWith('--fail-at='))?.split('=')[1] ?? null;
const stepDelay = Number(process.argv.find((a) => a.startsWith('--delay='))?.split('=')[1] ?? 2500);

if (!SHARED_SECRET || !COMPILE_SECRET) {
  console.error('N8N_SHARED_SECRET and PRESENTATIONS_COMPILE_SECRET must be set (in .env.local).');
  process.exit(1);
}

const manifestTemplate = JSON.parse(readFileSync(join(root, 'scripts/presentations/fixture-manifest.json'), 'utf8'));
const assets = JSON.parse(readFileSync(join(root, 'scripts/presentations/fixture-assets.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function patch(jobId, body) {
  const res = await fetch(`${APP_URL}/api/presentations/jobs/${jobId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${COMPILE_SECRET}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${jobId} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function run(payload) {
  const { jobId } = payload;
  const log = (m) => console.log(`[${jobId}] ${m}`);
  try {
    await sleep(stepDelay);
    await patch(jobId, { status: 'planning', step: 'Reading the brief and planning the slides…' });
    if (failAt === 'planning') throw new Error('Simulated planner failure');

    await sleep(stepDelay);
    await patch(jobId, {
      status: 'resolving_assets',
      step: 'Looking for photos…',
      meta: { model: 'mock', usage: { input_tokens: 0, output_tokens: 0 } },
    });
    if (failAt === 'resolving_assets') throw new Error('Simulated photo lookup failure');

    await sleep(stepDelay);
    const assetUsage = Object.entries(assets)
      .filter(([, a]) => a.source !== 'placeholder')
      .map(([ref, a]) => ({
        slideId: ref.split(':')[0],
        purpose: ref.split(':')[1],
        source: 'pexels',
        provider: 'pexels',
        providerImageId: 'fixture',
        sourceUrl: a.url,
        downloadUrl: a.url,
        photographer: 'Picsum (fixture)',
        licenseUrl: 'https://www.pexels.com/license/',
        query: 'fixture',
        retrievedAt: new Date().toISOString(),
      }));
    await patch(jobId, { status: 'compiling', step: 'Building the deck…', assets: assetUsage });
    if (failAt === 'compiling') throw new Error('Simulated compile failure');

    const manifest = {
      ...manifestTemplate,
      presentation: {
        ...manifestTemplate.presentation,
        title: payload.title,
        subtitle: payload.travelDates || manifestTemplate.presentation.subtitle,
        style: payload.style,
        audience: payload.audience,
        language: payload.language,
      },
    };
    const res = await fetch(`${APP_URL}/api/presentations/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${COMPILE_SECRET}` },
      body: JSON.stringify({ jobId, manifest, assets }),
    });
    const compiled = await res.json();
    if (!res.ok) throw new Error(`compile → ${res.status}: ${JSON.stringify(compiled)}`);
    log(`compiled ${compiled.slideCount} slides → ${compiled.pptxUrl}`);

    await patch(jobId, {
      status: 'importing',
      step: 'Sending to Canva…',
      pptxKey: compiled.pptxKey,
      pptxUrl: compiled.pptxUrl,
      warnings: compiled.warnings,
    });
    if (failAt === 'importing') throw new Error('Simulated Canva failure');

    await sleep(stepDelay);
    await patch(jobId, {
      status: 'done',
      step: 'Ready (Canva skipped by the mock).',
      warnings: ['Canva import was skipped by the local mock; download the PowerPoint instead.'],
    });
    log('done');
  } catch (error) {
    log(`failed: ${error.message}`);
    await patch(jobId, {
      status: 'failed',
      step: 'Stopped.',
      error: { message: error.message, step: failAt ?? 'unknown' },
    }).catch((e) => log(`could not record failure: ${e.message}`));
  }
}

createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook/itinerary-presentation') {
    res.writeHead(404).end();
    return;
  }
  if (req.headers['x-tools-secret'] !== SHARED_SECRET) {
    res.writeHead(403, { 'content-type': 'application/json' }).end('{"accepted":false,"error":"bad secret"}');
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400).end('{"accepted":false}');
      return;
    }
    console.log(`webhook: job ${payload.jobId} "${payload.title}" (${payload.style}, ${payload.language}, ${String(payload.text ?? '').length} chars)`);
    res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ accepted: true, jobId: payload.jobId }));
    void run(payload);
  });
}).listen(PORT, () => {
  console.log(`mock n8n listening on http://localhost:${PORT}/webhook/itinerary-presentation → app at ${APP_URL}${failAt ? ` (failing at ${failAt})` : ''}`);
});
