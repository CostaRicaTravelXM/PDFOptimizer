/**
 * Push the built workflows to an n8n instance through its public API:
 *
 *   npm run n8n:deploy                      # create/update in the configured folder
 *   npm run n8n:deploy -- --activate        # …and activate the Main workflow
 *   npm run n8n:deploy -- --dry-run         # show what would happen, change nothing
 *
 * Needs `N8N_BASE_URL` and `N8N_API_KEY` (environment or `.env.local`). By default the
 * workflows land in the API key owner's personal project, in the folder named by
 * `N8N_FOLDER` (default "TravelXM Workflows"); `--project` and `--folder` override either.
 *
 * Two things make this worth running rather than importing by hand:
 *
 * - Workflows are matched **by name inside that folder**, so re-running updates the same two
 *   workflows instead of piling up copies, and never touches anything else in the instance.
 * - Node credentials are referenced by name in the generated JSON. Here they are resolved
 *   against the credentials that actually exist and rewritten with their real ids, so the
 *   nodes come out already wired. Anything unresolved is listed at the end for you to pick
 *   in the UI.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function loadEnv() {
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

const E = loadEnv();
const base = String(E.N8N_BASE_URL || '').replace(/\/+$/, '');
const key = E.N8N_API_KEY;
if (!base || !key) {
  console.error('Set N8N_BASE_URL and N8N_API_KEY (environment or .env.local).');
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
const activate = !!flag('activate', false);
const dryRun = !!flag('dry-run', false);
const wantProject = flag('project', E.N8N_PROJECT || null);
const wantFolder = flag('folder', E.N8N_FOLDER || 'TravelXM Workflows');

async function api(method, path, body) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': key, 'content-type': 'application/json', accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

async function pages(path) {
  const out = [];
  let cursor;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const page = await api('GET', `${path}${sep}limit=100${cursor ? `&cursor=${cursor}` : ''}`);
    out.push(...(page.data ?? []));
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

// --- where do the workflows go? -------------------------------------------------------------
const projects = await pages('/projects');
let project;
if (wantProject) {
  project = projects.find((p) => p.id === wantProject || p.name === wantProject);
  if (!project) throw new Error(`No project "${wantProject}". Have: ${projects.map((p) => p.name).join(', ')}`);
} else {
  // The API key's own personal project: the one it created.
  project = projects.find((p) => p.type === 'personal') ?? projects[0];
}

// The folders endpoint paginates with skip/take, not cursor/limit.
const folders = (await api('GET', `/projects/${project.id}/folders?take=200`)).data ?? [];
const folder = folders.find((f) => f.id === wantFolder || f.name === wantFolder);
if (!folder) {
  throw new Error(`No folder "${wantFolder}" in project "${project.name}". Have: ${folders.map((f) => f.name).join(', ')}`);
}
console.log(`project  ${project.name} (${project.id})`);
console.log(`folder   ${folder.name} (${folder.id}) — ${folder.workflowCount} workflow(s) today\n`);

// --- resolve credentials by name --------------------------------------------------------------
const credentials = await pages('/credentials');
const byName = new Map(credentials.map((c) => [c.name, c]));
const unresolved = new Map();

function wireCredentials(nodes) {
  for (const node of nodes) {
    if (!node.credentials) continue;
    for (const [type, ref] of Object.entries(node.credentials)) {
      const found = byName.get(ref.name);
      if (found && found.type === type) {
        ref.id = found.id;
        continue;
      }
      // A reference n8n cannot resolve is rejected outright ("credentials that are not
      // shared with you"), so an unknown credential is dropped and reported instead. The
      // node then simply shows an empty credential picker.
      delete node.credentials[type];
      const list = unresolved.get(`${ref.name} (${type})`) ?? [];
      list.push(node.name);
      unresolved.set(`${ref.name} (${type})`, list);
    }
    if (Object.keys(node.credentials).length === 0) delete node.credentials;
  }
}

// --- deploy -------------------------------------------------------------------------------------
const existing = await pages(`/workflows?projectId=${project.id}&excludePinnedData=true`);
const inFolder = new Map();
for (const w of existing) {
  const pf = w.parentFolder?.id ?? w.parentFolderId ?? null;
  if (pf === folder.id) inFolder.set(w.name, w);
}

const files = ['presentaciones-error-handler.json', 'presentaciones-main.json'];
const deployed = [];
for (const file of files) {
  const wf = JSON.parse(readFileSync(join(here, 'workflows', file), 'utf8'));
  wireCredentials(wf.nodes);
  const found = inFolder.get(wf.name) ?? existing.find((w) => w.name === wf.name);
  const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };

  if (dryRun) {
    console.log(`${found ? 'would update' : 'would create'}  ${wf.name} (${wf.nodes.length} nodes)`);
    continue;
  }

  let saved;
  if (found) {
    saved = await api('PUT', `/workflows/${found.id}`, body);
    console.log(`updated  ${wf.name} (${found.id})`);
  } else {
    saved = await api('POST', '/workflows', { ...body, projectId: project.id, parentFolderId: folder.id });
    console.log(`created  ${wf.name} (${saved.id})`);
  }
  deployed.push({ file, wf, saved });
  console.log(`         ${base}/workflow/${saved.id}`);
}

if (activate && !dryRun) {
  const main = deployed.find((d) => d.file === 'presentaciones-main.json');
  if (main) {
    await api('POST', `/workflows/${main.saved.id}/activate`);
    console.log(`\nactivated ${main.wf.name}`);
  }
}

if (unresolved.size) {
  console.log('\nCredentials still to select in the n8n UI:');
  for (const [name, nodes] of unresolved) {
    console.log(`  ${name} → ${[...new Set(nodes)].join(', ')}`);
  }
}
if (!dryRun) {
  console.log('\nThen: fill the Config node (TOOLS_APP_URL), set Settings → Error Workflow on the Main workflow, activate it, and copy the Webhook Production URL into Vercel.');
}
