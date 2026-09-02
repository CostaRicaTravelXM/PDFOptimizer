/**
 * End-to-end check in real Chrome.
 *
 *   node scripts/e2e.mjs <baseUrl> <file.pdf> [morePdfs...]
 *
 * Drives the actual interface — file input, Web Workers, OffscreenCanvas, Chrome's own JPEG
 * encoder — because the Node harness proves the algorithm, not the app.
 */

import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [, , baseUrl = 'http://localhost:3210', ...inputs] = process.argv;
const files = inputs.map((f) => resolve(f));

if (files.length === 0) {
  console.error('usage: node scripts/e2e.mjs <baseUrl> <file.pdf> [...]');
  process.exit(1);
}
mkdirSync('.check', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=4096'],
  defaultViewport: { width: 1280, height: 900 },
  protocolTimeout: 600_000,
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const client = await page.target().createCDPSession();
await client.send('Browser.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: resolve('.check'),
});

console.log(`opening ${baseUrl}`);
await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 120_000 });

await page.screenshot({ path: '.check/01-empty.png' });
console.log('  captured empty state');

const input = await page.waitForSelector('input[type=file]');
console.log(`uploading ${files.length} file(s)`);
for (const f of files) console.log(`  ${f.split(/[\\/]/).pop()} (${(readFileSync(f).length / 1048576).toFixed(1)} MB)`);
await input.uploadFile(...files);

// Wait for every row to leave the working state.
const started = Date.now();
await page.waitForFunction(
  (n) => {
    const rows = document.querySelectorAll('li');
    if (rows.length < n) return false;
    return [...rows].every(
      (r) => r.querySelector('a[download]') || r.textContent.match(/try again|damaged|not a PDF|as small as/i),
    );
  },
  { timeout: 480_000, polling: 500 },
  files.length,
);
console.log(`  all files settled in ${((Date.now() - started) / 1000).toFixed(1)}s`);

await page.screenshot({ path: '.check/02-results.png', fullPage: true });

const results = await page.evaluate(() =>
  [...document.querySelectorAll('li')].map((r) => ({
    text: r.innerText.replace(/\s+/g, ' ').trim(),
    download: r.querySelector('a[download]')?.getAttribute('download') ?? null,
  })),
);

console.log('\n--- rows ---');
for (const r of results) console.log(`  ${r.text}`);

// Open the before/after comparison on the first finished row.
const compare = await page.$('li button ::-p-text(Compare)');
if (compare) {
  await compare.click();
  await page
    .waitForFunction(
      () => document.querySelectorAll('[role=dialog] img').length >= 2,
      { timeout: 180_000, polling: 500 },
    )
    .catch(() => console.log('  (comparison images did not both render)'));
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: '.check/03-compare.png' });
  console.log('  captured comparison view');
  await page.keyboard.press('Escape');
}

// Mobile rendering.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: '.check/04-mobile.png', fullPage: true });
console.log('  captured mobile layout');

console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 15)) console.log(`  ${e}`);

await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
