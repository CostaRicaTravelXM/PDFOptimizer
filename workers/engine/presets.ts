/**
 * Quality presets.
 *
 * The UI never shows DPI or JPEG quality numbers — people who need this tool know their
 * email bounced, not what a dots-per-inch is. These labels are the only vocabulary exposed.
 */

export type PresetId = 'smaller' | 'balanced' | 'sharper';

export interface Preset {
  id: PresetId;
  label: string;
  hint: string;
  /** Images are capped to this many dots per inch of page. */
  dpi: number;
  /** JPEG quality for recompressed images. */
  quality: number;
}

export const PRESETS: Record<PresetId, Preset> = {
  smaller: {
    id: 'smaller',
    label: 'Smaller file',
    hint: 'Best for email limits',
    dpi: 110,
    quality: 0.65,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    hint: 'Recommended for most files',
    dpi: 150,
    quality: 0.74,
  },
  sharper: {
    id: 'sharper',
    label: 'Sharper',
    hint: 'Keeps more photo detail',
    dpi: 200,
    quality: 0.85,
  },
};

export const DEFAULT_PRESET: PresetId = 'balanced';
export const PRESET_LIST: Preset[] = [PRESETS.smaller, PRESETS.balanced, PRESETS.sharper];

/** Size targets, framed as the mail systems people actually hit. */
export interface SizeTarget {
  id: string;
  label: string;
  /** Byte ceiling, or null for "no limit". */
  bytes: number | null;
}

export const SIZE_TARGETS: SizeTarget[] = [
  { id: 'gmail', label: 'Fits Gmail (25 MB)', bytes: 25 * 1024 * 1024 },
  { id: 'strict', label: 'Fits anything (10 MB)', bytes: 10 * 1024 * 1024 },
  { id: 'none', label: 'No limit', bytes: null },
];

export const DEFAULT_TARGET = 'gmail';

export function targetBytes(id: string): number | null {
  return SIZE_TARGETS.find((t) => t.id === id)?.bytes ?? null;
}
