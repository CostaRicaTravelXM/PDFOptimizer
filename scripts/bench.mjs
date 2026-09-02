/**
 * Verification harness: run the real Smart engine over a real PDF and report the result.
 *
 *   node scripts/bench.mjs "<file.pdf>" [preset]
 *
 * Bundles the TypeScript engine with esbuild so the harness exercises exactly the code the
 * browser worker ships, rather than a reimplementation of it.
 */

import './polyfill.mjs';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const input = process.argv[2];
const preset = process.argv[3] ?? 'balanced';

if (!input) {
  console.error('usage: node scripts/bench.mjs <file.pdf> [smaller|balanced|sharper]');
  process.exit(1);
}

const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

const out = mkdtempSync(join(tmpdir(), 'pdfopt-'));
const bundlePath = join(out, 'engine.mjs');

await build({
  entryPoints: ['workers/engine/smart.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['import', 'default'],
  target: 'es2022',
  outfile: bundlePath,
  alias: { '@': process.cwd() },
  logLevel: 'warning',
});

const { optimizeSmart } = await import(pathToFileURL(bundlePath).href);

const source = new Uint8Array(readFileSync(input));
console.log(`\ninput   ${basename(input)}`);
console.log(`size    ${mb(source.length)}`);
console.log(`preset  ${preset}\n`);

let lastPhase = '';
const started = Date.now();

const result = await optimizeSmart(source, { preset, targetBytes: null }, (fraction, phase) => {
  if (phase !== lastPhase) {
    lastPhase = phase;
    process.stdout.write(`  ${String(Math.round(fraction * 100)).padStart(3)}%  ${phase}\n`);
  }
});

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const saved = 1 - result.bytes.length / source.length;

const outPath = input.replace(/\.pdf$/i, '') + `.optimized-${preset}.pdf`;
writeFileSync(outPath, result.bytes);

console.log('\n--- result -------------------------------------');
console.log(`engine            ${result.engine}`);
console.log(`before            ${mb(source.length)}`);
console.log(`after             ${mb(result.bytes.length)}`);
console.log(`saved             ${(saved * 100).toFixed(1)}%`);
console.log(`elapsed           ${elapsed}s`);
console.log(`pages             ${result.stats.pages}`);
console.log(`images optimized  ${result.stats.imagesOptimized}`);
console.log(`images skipped    ${result.stats.imagesSkipped}`);
console.log(`images deduped    ${result.stats.imagesDeduped}`);
console.log(`masks dropped     ${result.stats.masksDropped}`);
console.log(`written to        ${outPath}`);
console.log('------------------------------------------------\n');
