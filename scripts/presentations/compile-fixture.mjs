/**
 * Build the fixture decks without a server:
 *
 *   npm run presentations:fixture
 *
 * Bundles the compiler with esbuild — the same source the compile route runs — and executes
 * it against `fixture-manifest.json` + `fixture-assets.json`. The fixture exercises every
 * layout primitive, a missing photo (placeholder path), an unsupported image type (rejection
 * path) and an over-long title (truncation path), in both styles. Open the results in
 * `.check/` with PowerPoint or LibreOffice, or import them into Canva by hand.
 */

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The bundle lives inside the repo so Node resolves the external packages from node_modules.
const out = join(root, '.check');
mkdirSync(out, { recursive: true });
const bundlePath = join(out, 'run-fixture.bundle.mjs');

await build({
  entryPoints: [join(root, 'scripts/presentations/run-fixture.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  alias: { '@': root },
  // Node loads these itself, exactly as it does inside the deployed route.
  external: ['pptxgenjs', 'image-size', 'zod'],
  outfile: bundlePath,
  logLevel: 'warning',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

process.argv[2] = root;
await import(pathToFileURL(bundlePath).href);
