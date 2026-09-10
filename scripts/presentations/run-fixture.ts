/**
 * Entry point bundled by compile-fixture.mjs. Runs the real compiler over the fixture
 * manifest in both styles and writes the decks to `.check/`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compilePresentation } from '@/lib/server/presentations/compile';
import { loadAssets } from '@/lib/server/presentations/images';
import { parseManifest, parseResolvedAssets } from '@/lib/server/presentations/schema';
import type { PresentationStyle } from '@/lib/presentations/manifest';

const root = process.argv[2];
const outDir = join(root, '.check');
mkdirSync(outDir, { recursive: true });

const manifestJson = JSON.parse(readFileSync(join(root, 'scripts/presentations/fixture-manifest.json'), 'utf8'));
const assetsJson = JSON.parse(readFileSync(join(root, 'scripts/presentations/fixture-assets.json'), 'utf8'));

for (const style of ['immersive', 'minimal'] as PresentationStyle[]) {
  const started = Date.now();
  const parsed = parseManifest({ ...manifestJson, presentation: { ...manifestJson.presentation, style } });
  if (!parsed.ok) {
    console.error(`[${style}] manifest rejected:`, parsed.issues);
    process.exitCode = 1;
    continue;
  }
  const { assets, warnings: assetWarnings } = parseResolvedAssets(assetsJson, parsed.manifest);
  const { loaded, warnings: loadWarnings } = await loadAssets(assets);
  const result = await compilePresentation(parsed.manifest, loaded, {
    warnings: [...parsed.warnings, ...assetWarnings, ...loadWarnings],
  });
  const file = join(outDir, `fixture-${style}.pptx`);
  writeFileSync(file, result.buffer);
  console.log(
    `[${style}] ${result.slideCount} slides, ${(result.buffer.byteLength / 1024 / 1024).toFixed(2)} MB, ${Date.now() - started} ms → ${file}`,
  );
  for (const w of result.warnings) console.log(`   ⚠ ${w}`);
}
