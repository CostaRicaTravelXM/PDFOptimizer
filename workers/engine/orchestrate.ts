/**
 * Decide how hard to try.
 *
 * The user picks an outcome ("fits Gmail"), not a technique. This works out how to get
 * there, spending quality before it spends the text layer:
 *
 *   1. Smart at the chosen preset.
 *   2. Smart at a lower preset, if the target was missed.
 *   3. Flatten, only once recompression has run out of room.
 *
 * Step 2 matters because it is nearly free to the reader — a slightly softer photo — while
 * step 3 costs them search, selection and links forever. On the reference itinerary the
 * ladder never reaches step 3: 121 MB lands at 14 MB with text intact.
 */

import type { OptimizeOptions, OptimizeResult } from '@/lib/types';
import type { PresetId } from './presets';
import { optimizeSmart, type ProgressFn } from './smart';
import { optimizeFlatten } from './raster';

/** Presets in descending order of output size, for stepping down. */
const LADDER: PresetId[] = ['sharper', 'balanced', 'smaller'];

export async function optimize(
  bytes: Uint8Array,
  options: OptimizeOptions,
  onProgress: ProgressFn,
): Promise<OptimizeResult> {
  const limit = options.targetBytes;
  const attempts = presetLadder(options.preset, limit !== null);

  let best: OptimizeResult | null = null;

  for (let i = 0; i < attempts.length; i++) {
    const preset = attempts[i];
    const span = spanFor(i, attempts.length);

    const result = await optimizeSmart(bytes, { ...options, preset }, (f, phase) =>
      onProgress(span.from + (span.to - span.from) * f, phase),
    );

    if (!best || result.bytes.length < best.bytes.length) best = result;
    if (limit === null || result.bytes.length <= limit) return best;
  }

  // Recompression alone could not reach the target. Flattening is the last resort, and
  // only worth it if it actually wins — on a text-heavy file it can even be larger.
  try {
    const flattened = await optimizeFlatten(
      bytes,
      { ...options, preset: attempts[attempts.length - 1] },
      (f, phase) => onProgress(0.75 + 0.25 * f, phase),
    );
    if (!best || flattened.bytes.length < best.bytes.length) return flattened;
  } catch {
    // Rendering failed; the Smart result still stands on its own.
  }

  return best!;
}

/**
 * Which presets to try, in order.
 *
 * With no size target the user's choice is final — they asked for a look, not a number.
 * With a target, we are allowed to step down toward it, but never up: nobody is surprised
 * by a file that came out smaller than they asked for.
 */
function presetLadder(chosen: PresetId, hasTarget: boolean): PresetId[] {
  if (!hasTarget) return [chosen];
  const from = LADDER.indexOf(chosen);
  return LADDER.slice(from === -1 ? 1 : from);
}

/** Split the progress bar across however many attempts we may need. */
function spanFor(index: number, total: number): { from: number; to: number } {
  const ceiling = 0.75; // leave headroom for a possible flatten pass
  const width = ceiling / total;
  return { from: index * width, to: (index + 1) * width };
}
