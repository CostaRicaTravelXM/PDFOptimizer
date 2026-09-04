import { unzipSync, zipSync } from 'fflate';

/**
 * Reading and rewriting an email-builder export (Beefree, Stripo, Mailchimp and friends).
 *
 * The shape is always the same: one HTML file plus a folder of images referenced by bare
 * relative paths. Everything here is pure — no network, no DOM — so the rewrite can be
 * reasoned about and tested on its own.
 */

export interface ArchiveEntry {
  /** Path inside the archive, wrapper folder already stripped. */
  path: string;
  bytes: Uint8Array;
}

export interface ParsedArchive {
  /** Path of the HTML document that will be rewritten. */
  htmlPath: string;
  html: string;
  /** Every entry, HTML included, in archive order. */
  entries: ArchiveEntry[];
  /** The subset that will be uploaded. */
  images: ArchiveEntry[];
  /** Other HTML files found but not chosen, for an honest note in the UI. */
  otherHtml: string[];
  /** Wrapper folder that was stripped, if there was one. */
  strippedRoot: string;
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

export function contentTypeFor(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? IMAGE_TYPES[ext] : undefined;
}

export function isImagePath(path: string): boolean {
  return contentTypeFor(path) !== undefined;
}

export class ArchiveError extends Error {}

/** Unpack the archive and work out which file is the email. */
export function parseArchive(zipBytes: Uint8Array): ParsedArchive {
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(zipBytes);
  } catch {
    throw new ArchiveError("That file could not be opened as a .zip. Is it the right export?");
  }

  // Directory markers come through as zero-length entries; they are not files.
  const paths = Object.keys(raw).filter((p) => !p.endsWith('/'));
  if (paths.length === 0) throw new ArchiveError('That .zip is empty.');

  const strippedRoot = commonRoot(paths);
  const strip = (p: string) => (strippedRoot ? p.slice(strippedRoot.length + 1) : p);

  const entries: ArchiveEntry[] = paths
    // __MACOSX/._foo resource forks ride along on zips made in Finder and are not real files.
    .filter((p) => !p.startsWith('__MACOSX/') && !p.split('/').pop()!.startsWith('._'))
    .map((p) => ({ path: strip(p), bytes: raw[p] }));

  const htmlFiles = entries.filter((e) => /\.x?html?$/i.test(e.path));
  if (htmlFiles.length === 0) {
    throw new ArchiveError(
      'No HTML file in that .zip. Export the email again — the archive should contain an .html file and an images folder.',
    );
  }

  // Prefer the conventional name; otherwise the biggest file is the email and the rest are
  // fragments.
  const chosen =
    htmlFiles.find((e) => e.path.toLowerCase() === 'email.html') ??
    htmlFiles.find((e) => e.path.toLowerCase().endsWith('/email.html')) ??
    [...htmlFiles].sort((a, b) => b.bytes.length - a.bytes.length)[0];

  return {
    htmlPath: chosen.path,
    html: new TextDecoder('utf-8').decode(chosen.bytes),
    entries,
    images: entries.filter((e) => isImagePath(e.path)),
    otherHtml: htmlFiles.filter((e) => e !== chosen).map((e) => e.path),
    strippedRoot,
  };
}

/**
 * A single top-level folder around everything is a packaging detail, not part of the paths
 * the HTML refers to. Strip it so `Foo/email.html` and `email.html` behave identically.
 */
function commonRoot(paths: string[]): string {
  const first = paths[0].split('/');
  if (first.length < 2) return '';
  const root = first[0];
  return paths.every((p) => p.startsWith(root + '/')) ? root : '';
}

export interface RewriteResult {
  html: string;
  /** How many references were pointed at the new URLs. */
  replaced: number;
  /** Local-looking references that matched no file in the archive. */
  missed: string[];
}

/**
 * Repoint every local reference at its hosted URL.
 *
 * Substitution happens only when the resolved path is a key in `urlByPath`, which is what
 * keeps `#`, `mailto:`, `tel:`, absolute URLs and `{{ merge_tags }}` safe: none of them can
 * ever resolve to a file that was in the archive, so none of them is ever touched.
 */
export function rewriteHtml(
  html: string,
  urlByPath: Map<string, string>,
  htmlPath: string,
): RewriteResult {
  const dir = htmlPath.includes('/') ? htmlPath.slice(0, htmlPath.lastIndexOf('/')) : '';
  let replaced = 0;
  const missed = new Set<string>();

  /** Returns the hosted URL for a raw reference, or undefined to leave it alone. */
  const lookup = (rawValue: string): string | undefined => {
    const value = rawValue.trim();
    if (!value) return undefined;
    // Anything with a scheme, a protocol-relative host, a fragment, or a template
    // placeholder is not a file in this archive.
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined;
    if (value.startsWith('//') || value.startsWith('#')) return undefined;
    if (value.includes('{{') || value.includes('${') || value.includes('*|')) return undefined;

    const resolved = resolvePath(dir, value.split(/[?#]/)[0]);
    const hit = urlByPath.get(resolved);
    if (hit) {
      replaced += 1;
      return hit;
    }
    // Only complain about things that actually look like local assets. A bare `href="terms"`
    // in an email is a link, not a missing image.
    if (isImagePath(resolved)) missed.add(resolved);
    return undefined;
  };

  // 1. src= and href= attribute values. Covers <img src> and <link rel=preload href>, the
  //    two forms email builders emit, in one pass. The quote style is preserved.
  let out = html.replace(
    /(\s(?:src|href)\s*=\s*)(["'])([^"']*)\2/gi,
    (whole, lead: string, quote: string, value: string) => {
      const url = lookup(value);
      return url ? `${lead}${quote}${escapeAttr(url)}${quote}` : whole;
    },
  );

  // 2. srcset / imagesrcset: a comma-separated list of "url descriptor" pairs.
  out = out.replace(
    /(\s(?:image)?srcset\s*=\s*)(["'])([^"']*)\2/gi,
    (whole, lead: string, quote: string, value: string) => {
      let changed = false;
      const list = value
        .split(',')
        .map((part) => {
          const m = part.match(/^(\s*)(\S+)(\s.*)?$/);
          if (!m) return part;
          const url = lookup(m[2]);
          if (!url) return part;
          changed = true;
          return `${m[1]}${escapeAttr(url)}${m[3] ?? ''}`;
        })
        .join(',');
      return changed ? `${lead}${quote}${list}${quote}` : whole;
    },
  );

  // 3. CSS url(...) — in <style> blocks and inline style attributes alike. Rare in email
  //    (Outlook ignores background-image) but harmless to support.
  out = out.replace(
    /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
    (whole, quote: string, value: string) => {
      const url = lookup(value);
      return url ? `url(${quote || "'"}${url}${quote || "'"})` : whole;
    },
  );

  return { html: out, replaced, missed: [...missed] };
}

/** Resolve a relative reference against the HTML's own folder. Pure string work. */
function resolvePath(dir: string, ref: string): string {
  const absolute = ref.startsWith('/');
  const base = absolute || !dir ? [] : dir.split('/');
  const out = [...base];
  for (const seg of ref.replace(/^\//, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(decodeSegment(seg));
  }
  return out.join('/');
}

/**
 * Archive entry names hold raw characters; HTML references hold percent-encoded ones. A file
 * called `my photo.jpg` arrives as `my%20photo.jpg` in the markup, so decode before matching.
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Rebuild the archive with the rewritten HTML and every other file byte-identical.
 *
 * Level 0 (store) for the same reason as the PDF bundler: the payload is already-compressed
 * JPEG and PNG, so deflating again costs time and buys nothing.
 */
export function rebuildZip(
  entries: ArchiveEntry[],
  htmlPath: string,
  newHtml: string,
): Uint8Array {
  const encoded = new TextEncoder().encode(newHtml);
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const entry of entries) {
    files[entry.path] = [entry.path === htmlPath ? encoded : entry.bytes, { level: 0 }];
  }
  return zipSync(files, { level: 0 });
}

/**
 * A destination folder name derived from the uploaded file: `Luxury Costa Rica.zip` becomes
 * `luxury-costa-rica`. Shown to the user as an editable field, so it only has to be a good
 * first guess.
 */
export function slugify(name: string): string {
  const stem = name.replace(/\.zip$/i, '');
  const slug = stem
    // NFKD splits an accented letter into letter + combining mark; dropping the marks turns
    // "Añejo Café" into "anejo-cafe" rather than "an-ejo-caf-".
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'email';
}
