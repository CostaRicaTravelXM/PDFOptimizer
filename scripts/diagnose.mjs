/**
 * Inventory every image XObject and report why the Smart engine would accept or reject it.
 * Diagnostic aid for widening engine coverage.
 */

import { build } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const input = process.argv[2];
const out = mkdtempSync(join(tmpdir(), 'pdfdiag-'));
const bundlePath = join(out, 'pdflib.mjs');

await build({
  stdin: {
    contents: `export * from 'pdf-lib';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  outfile: bundlePath,
  logLevel: 'warning',
});

const { PDFDocument, PDFName, PDFNumber, PDFArray, PDFDict, PDFRawStream, PDFRef } = await import(
  pathToFileURL(bundlePath).href
);

const N = (s) => PDFName.of(s);
const pdf = await PDFDocument.load(new Uint8Array(readFileSync(input)), {
  updateMetadata: false,
});

const num = (v) => {
  const r = v instanceof PDFRef ? pdf.context.lookup(v) : v;
  return r instanceof PDFNumber ? r.asNumber() : null;
};

const softMasks = new Set();
for (const [, o] of pdf.context.enumerateIndirectObjects()) {
  if (o instanceof PDFRawStream) {
    const sm = o.dict.get(N('SMask'));
    if (sm instanceof PDFRef) softMasks.add(sm.toString());
  }
}

function csDescribe(dict) {
  const cs = pdf.context.lookup(dict.get(N('ColorSpace')));
  if (cs instanceof PDFName) return cs.asString();
  if (cs instanceof PDFArray) {
    const fam = pdf.context.lookup(cs.get(0));
    const famName = fam instanceof PDFName ? fam.asString() : '?';
    if (famName === '/ICCBased') {
      const prof = pdf.context.lookup(cs.get(1));
      const n = prof instanceof PDFRawStream ? num(prof.dict.get(N('N'))) : null;
      return `[ICCBased N=${n}]`;
    }
    return `[${famName} size=${cs.size()}]`;
  }
  return cs ? `other:${cs.constructor.name}` : 'ABSENT';
}

const rows = [];
for (const [ref, o] of pdf.context.enumerateIndirectObjects()) {
  if (!(o instanceof PDFRawStream)) continue;
  if (o.dict.get(N('Subtype'))?.toString() !== '/Image') continue;

  const f = pdf.context.lookup(o.dict.get(N('Filter')));
  let filter;
  if (f instanceof PDFName) filter = f.asString();
  else if (f instanceof PDFArray)
    filter = '[' + f.array.map((x) => pdf.context.lookup(x)?.asString?.() ?? '?').join(',') + ']';
  else filter = 'NONE';

  let parms = pdf.context.lookup(o.dict.get(N('DecodeParms')));
  if (parms instanceof PDFArray) parms = pdf.context.lookup(parms.get(0));
  const predictor = parms instanceof PDFDict ? num(parms.get(N('Predictor'))) : null;

  rows.push({
    ref: ref.toString(),
    w: num(o.dict.get(N('Width'))),
    h: num(o.dict.get(N('Height'))),
    bpc: num(o.dict.get(N('BitsPerComponent'))),
    filter,
    cs: csDescribe(o.dict),
    predictor,
    smask: softMasks.has(ref.toString()) ? 'MASK' : '',
    hasDecode: o.dict.has(N('Decode')) ? 'DECODE' : '',
    maskArr: o.dict.get(N('Mask')) instanceof PDFArray ? 'MASKARR' : '',
    imageMask: o.dict.has(N('ImageMask')) ? 'IMGMASK' : '',
    bytes: o.getContents().length,
  });
}

const tally = (fn) => {
  const m = new Map();
  for (const r of rows) {
    const k = fn(r);
    const e = m.get(k) ?? { n: 0, bytes: 0 };
    e.n++;
    e.bytes += r.bytes;
    m.set(k, e);
  }
  return [...m.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
};

const MB = (b) => (b / 1024 / 1024).toFixed(1) + 'MB';

console.log(`\ntotal image objects: ${rows.length}`);
console.log(`total image bytes:   ${MB(rows.reduce((s, r) => s + r.bytes, 0))}\n`);

for (const [name, fn] of [
  ['FILTER', (r) => r.filter],
  ['COLORSPACE', (r) => r.cs],
  ['BPC', (r) => String(r.bpc)],
  ['PREDICTOR', (r) => String(r.predictor)],
  ['FLAGS', (r) => [r.smask, r.hasDecode, r.maskArr, r.imageMask].filter(Boolean).join('+') || '-'],
]) {
  console.log(`--- by ${name} ---`);
  for (const [k, v] of tally(fn)) console.log(`  ${String(k).padEnd(28)} n=${String(v.n).padStart(4)}  ${MB(v.bytes)}`);
  console.log();
}

console.log('--- 15 heaviest ---');
for (const r of [...rows].sort((a, b) => b.bytes - a.bytes).slice(0, 15)) {
  console.log(
    `  ${MB(r.bytes).padStart(8)}  ${String(r.w) + 'x' + r.h}`.padEnd(28) +
      ` ${r.filter} ${r.cs} bpc=${r.bpc} pred=${r.predictor} ${r.smask}${r.hasDecode}${r.maskArr}${r.imageMask}`,
  );
}
console.log();
