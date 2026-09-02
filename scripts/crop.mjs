/**
 * Render the same crop of the same page from two PDFs, stacked for eyeballing.
 *
 *   node scripts/crop.mjs <a.pdf> <b.pdf> <page> <out.png> [renderWidth] [cx] [cy] [cw] [ch]
 *
 * cx/cy/cw/ch are fractions of the page (0-1). PSNR says how much changed; this says
 * whether it matters.
 */

import puppeteer from 'puppeteer-core';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [
  , , aPath, bPath, pageArg = '1', outPath = '.check/crop.png',
  widthArg = '2400', cxArg = '0', cyArg = '0', cwArg = '1', chArg = '1',
] = process.argv;

const pdfjsDir = require.resolve('pdfjs-dist/package.json').replace('package.json', '');
const routes = {
  '/a.pdf': resolve(aPath),
  '/b.pdf': resolve(bPath),
  '/pdf.mjs': pdfjsDir + 'build/pdf.mjs',
  '/pdf.worker.mjs': pdfjsDir + 'build/pdf.worker.mjs',
};
for (const [r, f] of Object.entries(routes)) {
  if (!existsSync(f)) {
    console.error(`missing ${r}: ${f}`);
    process.exit(1);
  }
}

const server = createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><meta charset="utf-8"><title>crop</title>');
    return;
  }
  const file = routes[p];
  if (!file) return res.writeHead(404).end();
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

  const dataUrl = await page.evaluate(
    async (base, n, width, cx, cy, cw, ch) => {
      const lib = await import(base + '/pdf.mjs');
      lib.GlobalWorkerOptions.workerSrc = base + '/pdf.worker.mjs';

      const draw = async (name) => {
        const doc = await lib.getDocument({ url: base + name, isEvalSupported: false }).promise;
        const p = await doc.getPage(n);
        const v1 = p.getViewport({ scale: 1 });
        const viewport = p.getViewport({ scale: width / v1.width });
        const c = document.createElement('canvas');
        c.width = Math.ceil(viewport.width);
        c.height = Math.ceil(viewport.height);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        await p.render({ canvasContext: ctx, viewport }).promise;
        await doc.destroy();
        return c;
      };

      const A = await draw('/a.pdf');
      const B = await draw('/b.pdf');

      const sx = Math.round(A.width * cx);
      const sy = Math.round(A.height * cy);
      const sw = Math.round(A.width * cw);
      const sh = Math.round(A.height * ch);

      const label = 34;
      const out = document.createElement('canvas');
      out.width = sw;
      out.height = (sh + label) * 2;
      const o = out.getContext('2d');
      o.fillStyle = '#14313f';
      o.fillRect(0, 0, out.width, out.height);
      o.font = '600 22px system-ui, sans-serif';
      o.fillStyle = '#ffffff';

      o.fillText('BEFORE (original)', 12, 24);
      o.drawImage(A, sx, sy, sw, sh, 0, label, sw, sh);
      o.fillText('AFTER (optimized)', 12, label + sh + 24);
      o.drawImage(B, sx, sy, sw, sh, 0, label * 2 + sh, sw, sh);

      return out.toDataURL('image/png');
    },
    origin, Number(pageArg), Number(widthArg),
    Number(cxArg), Number(cyArg), Number(cwArg), Number(chArg),
  );

  writeFileSync(outPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`wrote ${outPath}`);
} finally {
  await browser.close();
  server.close();
}
