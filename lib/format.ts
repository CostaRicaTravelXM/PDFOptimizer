/** Human-facing number formatting. Everything the user reads about size comes from here. */

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  // Below 100 MB one decimal is meaningful; above it, it is noise.
  return mb < 100 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** Whole-percent reduction, floored so the claim is never generous. */
export function percentSaved(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.max(0, Math.floor((1 - after / before) * 100));
}

/** Strip the extension for display, keeping the name recognisable. */
export function baseName(name: string): string {
  return name.replace(/\.pdf$/i, '');
}

/** The filename a download is offered under. */
export function optimizedName(name: string): string {
  return `${baseName(name)} (optimized).pdf`;
}
