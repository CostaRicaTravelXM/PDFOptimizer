/**
 * Measure how much the optimized file actually differs from its source.
 *
 *   node scripts/quality.mjs <original.pdf> <optimized.pdf> [pages]
 *
 * Renders matching pages of both documents at identical resolution in real Chrome and
 * reports PSNR. This is the evidence behind "keeps the quality" — a size claim on its own
 * asks the reader to take it on trust.
 *
 * Rule of thumb for photographic content: above 40 dB the difference is invisible, 35-40 dB
 * is indistinguishable in normal viewing, below 30 dB starts to show.
 *
 * Files are served over a throwaway local HTTP server rather than pushed through the
 * debugging protocol: a 121 MB document base64-encoded into an evaluate() call kills the tab.
 */

import puppeteer from 'puppeteer-core';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [, , originalPath, optimizedPath, pagesArg = '3'] = process.argv;

if (!originalPath || !optimizedPath) {
  console.error('usage: node scripts/quality.mjs <original.pdf> <optimized.pdf> [pages]');
  process.exit(1);
}

const pdfjsDir = require.resolve('pdfjs-dist/package.json').replace('package.json', '');
const routes = {
  '/a.pdf': resolve(originalPath),
  '/b.pdf': resolve(optimizedPath),
  '/pdf.mjs': pdfjsDir + 'build/pdf.mjs',
  '/pdf.worker.mjs': pdfjsDir + 'build/pdf.worker.mjs',
};

for (const [route, file] of Object.entries(routes)) {
  if (!existsSync(file)) {
    console.error(`missing file for ${route}: ${file}`);
    process.exit(1);
  }
}

const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/') {
    // A real same-origin document, so the dynamic import of pdf.js is permitted.
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><meta charset="utf-8"><title>quality</title>');
    return;
  }
  const file = routes[path];
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': file.endsWith('.mjs') ? 'text/javascript' : 'application/pdf',
    'Content-Length': statSync(file).size,
  });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=4096'],
  protocolTimeout: 900_000,
});

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });

  const report = await page.evaluate(async (base, pageCount) => {
    const lib = await import(base + '/pdf.mjs');
    lib.GlobalWorkerOptions.workerSrc = base + '/pdf.worker.mjs';

    const load = (name) =>
      lib.getDocument({ url: base + name, isEvalSupported: false }).promise;

    const render = async (doc, n, width) => {
      const p = await doc.getPage(n);
      const v1 = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: width / v1.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await p.render({ canvasContext: ctx, viewport }).promise;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      p.cleanup();
      canvas.width = canvas.height = 0;
      return data;
    };

    const a = await load('/a.pdf');
    const b = await load('/b.pdf');
    const results = [];
    const limit = Math.min(pageCount, a.numPages, b.numPages);

    for (let n = 1; n <= limit; n++) {
      const x = await render(a, n, 1200);
      const y = await render(b, n, 1200);
      if (x.width !== y.width || x.height !== y.height) {
        results.push({ page: n, error: 'page size mismatch' });
        continue;
      }
      let sum = 0;
      let worst = 0;
      const px = x.width * x.height;
      for (let i = 0; i < px; i++) {
        const o = i * 4;
        for (let c = 0; c < 3; c++) {
          const d = x.data[o + c] - y.data[o + c];
          sum += d * d;
          if (Math.abs(d) > worst) worst = Math.abs(d);
        }
      }
      const mse = sum / (px * 3);
      results.push({
        page: n,
        psnr: mse === 0 ? 999 : 10 * Math.log10((255 * 255) / mse),
        maxChannelDelta: worst,
      });
    }

    const out = { pagesA: a.numPages, pagesB: b.numPages, results };
    await a.destroy();
    await b.destroy();
    return out;
  }, origin, Number(pagesArg));

  console.log(`\npages: ${report.pagesA} → ${report.pagesB}\n`);
  let total = 0;
  let counted = 0;
  for (const r of report.results) {
    if (r.error) {
      console.log(`  page ${r.page}: ${r.error}`);
      continue;
    }
    const verdict =
      r.psnr >= 40 ? 'invisible' : r.psnr >= 35 ? 'indistinguishable' : r.psnr >= 30 ? 'slight' : 'VISIBLE';
    console.log(
      `  page ${String(r.page).padStart(2)}: PSNR ${r.psnr.toFixed(1).padStart(5)} dB   max delta ${String(r.maxChannelDelta).padStart(3)}   ${verdict}`,
    );
    total += r.psnr;
    counted++;
  }
  if (counted) console.log(`\n  mean PSNR: ${(total / counted).toFixed(1)} dB\n`);
} finally {
  await browser.close();
  server.close();
}
