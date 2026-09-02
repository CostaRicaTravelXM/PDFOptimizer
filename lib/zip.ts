import { zip, type Zippable } from 'fflate';
import { optimizedName } from './format';

/**
 * Bundle finished files into a single download.
 *
 * Level 0 (store) is deliberate: the payload is already-compressed JPEG inside PDF, so
 * deflating it again buys a fraction of a percent for a great deal of time and memory on
 * what may be a hundred megabytes of input.
 */
export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const entries: Zippable = {};
  const used = new Set<string>();

  for (const file of files) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    entries[uniqueName(optimizedName(file.name), used)] = [bytes, { level: 0 }];
  }

  const packed = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)));
  });

  return new Blob([packed as BlobPart], { type: 'application/zip' });
}

/** Two files can legitimately share a name; a zip entry cannot. */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const stem = name.replace(/\.pdf$/i, '');
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i}).pdf`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}
