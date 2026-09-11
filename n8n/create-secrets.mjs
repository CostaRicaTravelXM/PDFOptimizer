/**
 * Create the two shared-secret credentials the workflows need:
 *
 *   node n8n/create-secrets.mjs
 *
 * These two are not third-party API keys — they are values this project invents so the app
 * and n8n can recognise each other:
 *
 *   Tools Suite → n8n (x-tools-secret)   the app proves it is the one starting a job
 *   n8n → Tools Suite (bearer)           n8n proves it is the one reporting progress
 *
 * The script generates them, creates the credentials in n8n, and prints the values once so
 * they can be set in Vercel (`N8N_SHARED_SECRET`, `PRESENTATIONS_COMPILE_SECRET`). It refuses
 * to overwrite a credential that already exists: if these are ever rotated, do it in the n8n
 * UI and Vercel together, or delete the credentials first.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const E = { ...process.env };
const envFile = join(root, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) E[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
  }
}
const base = String(E.N8N_BASE_URL || '').replace(/\/+$/, '');
const key = E.N8N_API_KEY;
if (!base || !key) {
  console.error('Set N8N_BASE_URL and N8N_API_KEY (environment or .env.local).');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': key, 'content-type': 'application/json', accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const secret = () => randomBytes(32).toString('base64url');

const existing = new Set();
let cursor;
do {
  const page = await api('GET', `/credentials?limit=100${cursor ? `&cursor=${cursor}` : ''}`);
  for (const c of page.data ?? []) existing.add(c.name);
  cursor = page.nextCursor;
} while (cursor);

const sharedSecret = secret();
const compileSecret = secret();

const wanted = [
  {
    name: 'Tools Suite → n8n (x-tools-secret)',
    type: 'httpHeaderAuth',
    data: { name: 'x-tools-secret', value: sharedSecret },
    envVar: 'N8N_SHARED_SECRET',
    envValue: sharedSecret,
  },
  {
    name: 'n8n → Tools Suite (bearer)',
    type: 'httpHeaderAuth',
    data: { name: 'Authorization', value: `Bearer ${compileSecret}` },
    envVar: 'PRESENTATIONS_COMPILE_SECRET',
    envValue: compileSecret,
  },
];

const made = [];
for (const c of wanted) {
  if (existing.has(c.name)) {
    console.log(`exists   ${c.name} — left alone`);
    continue;
  }
  const saved = await api('POST', '/credentials', { name: c.name, type: c.type, data: c.data });
  console.log(`created  ${c.name} (${saved.id})`);
  made.push(c);
}

if (made.length) {
  console.log('\nSet these in Vercel (Settings → Environment Variables) so the app matches n8n:\n');
  for (const c of made) console.log(`  ${c.envVar}=${c.envValue}`);
  console.log('\nThey are shown once here; afterwards they can be read in the n8n credential UI.');
}
