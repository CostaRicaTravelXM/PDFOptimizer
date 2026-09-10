/**
 * Push the built workflows to an n8n instance through its public API:
 *
 *   N8N_BASE_URL=https://xxx.app.n8n.cloud N8N_API_KEY=... npm run n8n:deploy [-- --activate]
 *
 * Both variables may also live in `.env.local`. Workflows are matched by name: an existing
 * one is updated in place (keeping its id, credentials and settings such as the error
 * workflow), a missing one is created. `--activate` activates the Main workflow afterwards.
 *
 * What the API cannot do, and the README covers: selecting credentials on the nodes, the
 * Canva OAuth "Connect my account" click, and setting the error workflow in Settings.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function env() {
  const out = { ...process.env };
  const file = join(root, '.env.local');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#')) out[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

const E = env();
const base = String(E.N8N_BASE_URL || '').replace(/\/+$/, '');
const key = E.N8N_API_KEY;
if (!base || !key) {
  console.error('Set N8N_BASE_URL and N8N_API_KEY (environment or .env.local).');
  process.exit(1);
}
const activate = process.argv.includes('--activate');

async function api(method, path, body) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': key, 'content-type': 'application/json', accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

const existing = new Map();
let cursor;
do {
  const page = await api('GET', `/workflows?limit=100${cursor ? `&cursor=${cursor}` : ''}`);
  for (const w of page.data ?? []) existing.set(w.name, w);
  cursor = page.nextCursor;
} while (cursor);

const files = ['presentaciones-error-handler.json', 'presentaciones-main.json'];
for (const file of files) {
  const wf = JSON.parse(readFileSync(join(here, 'workflows', file), 'utf8'));
  // The public API accepts only these fields; anything else is rejected.
  const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const found = existing.get(wf.name);
  let saved;
  if (found) {
    saved = await api('PUT', `/workflows/${found.id}`, body);
    console.log(`updated  ${wf.name} (${found.id})`);
  } else {
    saved = await api('POST', '/workflows', body);
    console.log(`created  ${wf.name} (${saved.id})`);
  }
  if (activate && file === 'presentaciones-main.json') {
    await api('POST', `/workflows/${saved.id}/activate`);
    console.log(`activated ${wf.name}`);
  }
  console.log(`         ${base}/workflow/${saved.id}`);
}
console.log('\nNext in the n8n UI: select the credentials on the nodes, fill the Config node, set the error workflow, and copy the Production URL of the Webhook.');
