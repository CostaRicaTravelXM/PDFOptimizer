/**
 * Acceptance run: drives the real interface in real Chrome and checks the behaviours the
 * tool is judged on.
 *
 *   node scripts/acceptance.mjs [baseUrl] [reference.pdf]
 *
 * Expects the fixtures under .check/fixtures (see scripts/fixtures.py and
 * scripts/cmyk_fixture.py). The reference file is any large, image-heavy PDF; point the
 * second argument at one, or set REFERENCE_PDF.
 */

import puppeteer from 'puppeteer-core';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.argv[2] ?? 'http://localhost:3210';
const REFERENCE = process.argv[3] ?? process.env.REFERENCE_PDF ?? 'reference.pdf';
const DOWNLOADS = resolve('.check/downloads');

const FIXTURES = '.check/fixtures';

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const rowsOf = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('li')].map((r) => ({
      text: r.innerText.replace(/\s+/g, ' ').trim(),
      hasDownload: !!r.querySelector('a[download]'),
    })),
  );

const settle = (page, n, timeout = 480_000) =>
  page.waitForFunction(
    (count) => {
      const rows = document.querySelectorAll('li');
      if (rows.length < count) return false;
      return [...rows].every(
        (r) =>
          r.querySelector('a[download]') ||
          /try again|damaged|not a PDF|as small as|too large/i.test(r.textContent),
      );
    },
    { timeout, polling: 500 },
    n,
  );

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=4096'],
  defaultViewport: { width: 1280, height: 900 },
  protocolTimeout: 900_000,
});

const consoleErrors = [];

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

  const client = await page.target().createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });

  /* ---- 1. The reference itinerary ---- */
  console.log(`\n1. Reference itinerary (${REFERENCE.split(/[\\/]/).pop()})`);
  await page.goto(base, { waitUntil: 'networkidle0' });
  let input = await page.waitForSelector('input[type=file]');
  const t0 = Date.now();
  await input.uploadFile(resolve(REFERENCE));
  await settle(page, 1);
  const elapsed = (Date.now() - t0) / 1000;

  let rows = await rowsOf(page);
  const m = rows[0].text.match(/→ ([\d.]+) MB.*?(\d+)% smaller/);
  const outMb = m ? Number(m[1]) : NaN;
  check('reduces the reference file below 25 MB', outMb < 25, `${outMb} MB`);
  check('reduction is at least 80%', m && Number(m[2]) >= 80, m ? `${m[2]}%` : 'no match');
  check('keeps the text layer (not flattened)', !/Flattened/i.test(rows[0].text));
  check('finishes in under 60 s', elapsed < 60, `${elapsed.toFixed(1)}s`);

  /* ---- 2. Comparison view ---- */
  console.log('\n2. Before/after comparison');
  const compare = await page.$('li button ::-p-text(Compare)');
  await compare.click();
  const rendered = await page
    .waitForFunction(() => document.querySelectorAll('[role=dialog] img').length >= 2, {
      timeout: 180_000,
      polling: 500,
    })
    .then(() => true)
    .catch(() => false);
  check('renders both pages side by side', rendered);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  check('closes on Escape', (await page.$('[role=dialog]')) === null);

  /* ---- 3. Changing quality re-runs the queue ---- */
  console.log('\n3. Changing quality re-runs finished work');
  await (await page.$('button ::-p-text(Quality:)')).click();
  await new Promise((r) => setTimeout(r, 200));
  await (await page.$('button ::-p-text(Smaller file)')).click();
  await settle(page, 1);
  rows = await rowsOf(page);
  const m2 = rows[0].text.match(/→ ([\d.]+) MB/);
  const smallerMb = m2 ? Number(m2[1]) : NaN;
  check('"Smaller file" produces a smaller result', smallerMb < outMb, `${outMb} → ${smallerMb} MB`);

  /* ---- 4. Awkward inputs ---- */
  console.log('\n4. Awkward inputs');
  await page.goto(base, { waitUntil: 'networkidle0' });
  input = await page.waitForSelector('input[type=file]');
  const awkward = ['locked.pdf', 'text-only.pdf', 'not-really.pdf', 'cmyk-brochure.pdf'].map((f) =>
    resolve(FIXTURES, f),
  );
  await input.uploadFile(...awkward);
  await settle(page, awkward.length);
  rows = await rowsOf(page);
  const find = (name) => rows.find((r) => r.text.startsWith(name))?.text ?? '';

  check('password-protected file explains itself', /password-protected/i.test(find('locked.pdf')));
  check('already-small file says so', /already as small/i.test(find('text-only.pdf')));
  check('non-PDF is rejected', /not a PDF/i.test(find('not-really.pdf')));
  check(
    'CMYK file falls back to flattening',
    /Flattened to fit/i.test(find('cmyk-brochure.pdf')),
    find('cmyk-brochure.pdf').match(/→ [\d.]+ MB/)?.[0] ?? '',
  );
  check('failed files offer no download', !rows.find((r) => r.text.startsWith('locked'))?.hasDownload);

  /* ---- 5. Bulk + zip ---- */
  console.log('\n5. Bulk processing and Download all');
  await page.goto(base, { waitUntil: 'networkidle0' });
  input = await page.waitForSelector('input[type=file]');
  const bulk = ['slice-a.pdf', 'slice-b.pdf', 'cmyk-brochure.pdf'].map((f) => resolve(FIXTURES, f));
  await input.uploadFile(...bulk);
  await settle(page, bulk.length);
  rows = await rowsOf(page);
  check('all bulk files complete', rows.every((r) => r.hasDownload), `${rows.length} rows`);

  for (const f of existsSync(DOWNLOADS) ? readdirSync(DOWNLOADS) : []) {
    unlinkSync(resolve(DOWNLOADS, f));
  }
  await (await page.$('button ::-p-text(Download all)')).click();
  const zipped = await page
    .waitForFunction(() => true, { timeout: 1000 })
    .then(async () => {
      for (let i = 0; i < 60; i++) {
        const files = existsSync(DOWNLOADS) ? readdirSync(DOWNLOADS) : [];
        const zip = files.find((f) => f.endsWith('.zip'));
        if (zip && statSync(resolve(DOWNLOADS, zip)).size > 1000) {
          return { name: zip, size: statSync(resolve(DOWNLOADS, zip)).size };
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      return null;
    });
  check('Download all produces a zip', !!zipped, zipped ? `${(zipped.size / 1048576).toFixed(1)} MB` : 'timed out');

  /* ---- 6. Keyboard ---- */
  console.log('\n6. Keyboard access');
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check('dropzone is reachable by keyboard', /Choose PDF files/i.test(focused ?? ''), focused ?? 'none');

  /* ---- 7. Console ---- */
  console.log('\n7. Console');
  const real = consoleErrors.filter((e) => !/DevTools|Download the React/i.test(e));
  check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
process.exit(failed.length === 0 ? 0 : 1);
