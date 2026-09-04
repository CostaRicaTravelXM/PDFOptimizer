/**
 * Browser side of the R2 upload: ask the server for signed URLs, then PUT the bytes
 * straight to the bucket.
 */

export interface PresignedUpload {
  /** Path inside the archive this URL is for. */
  path: string;
  key: string;
  uploadUrl: string;
  publicUrl: string;
}

export interface UploadItem {
  path: string;
  bytes: Uint8Array;
  contentType: string;
}

export type UploadState = 'waiting' | 'uploading' | 'done' | 'error';

export interface UploadProgress {
  path: string;
  state: UploadState;
  /** 0–1, best effort: some browsers report nothing until the body is flushed. */
  fraction: number;
  publicUrl?: string;
  error?: string;
}

/** How many PUTs are in flight at once. Enough to saturate a link, few enough to stay fair. */
const CONCURRENCY = 4;

export class UploadError extends Error {}

export async function presign(
  prefix: string,
  items: UploadItem[],
  signal?: AbortSignal,
): Promise<PresignedUpload[]> {
  const response = await fetch('/api/r2/presign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      prefix,
      files: items.map((i) => ({
        path: i.path,
        contentType: i.contentType,
        size: i.bytes.byteLength,
      })),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new UploadError(payload?.error ?? `The server refused the upload (${response.status}).`);
  }
  if (!payload || !Array.isArray(payload.uploads)) {
    throw new UploadError('The server sent back something unexpected.');
  }
  return payload.uploads as PresignedUpload[];
}

/**
 * Upload every file, reporting per-file progress as it goes.
 *
 * XMLHttpRequest rather than fetch: fetch gives no upload progress in any shipping browser,
 * and on a 20 MB archive over hotel wifi a progress bar is the difference between "working"
 * and "frozen".
 */
export async function uploadAll(
  items: UploadItem[],
  urls: PresignedUpload[],
  onProgress: (progress: UploadProgress[]) => void,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const urlByPath = new Map(urls.map((u) => [u.path, u]));
  const state: UploadProgress[] = items.map((i) => ({
    path: i.path,
    state: 'waiting',
    fraction: 0,
  }));
  const index = new Map(state.map((s, i) => [s.path, i]));
  const report = () => onProgress(state.map((s) => ({ ...s })));

  const publicUrls = new Map<string, string>();
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      if (signal?.aborted) throw new UploadError('Upload cancelled.');

      const item = items[i];
      const target = urlByPath.get(item.path);
      const slot = index.get(item.path)!;

      if (!target) {
        state[slot] = { ...state[slot], state: 'error', error: 'No upload URL was issued.' };
        report();
        continue;
      }

      state[slot] = { ...state[slot], state: 'uploading', fraction: 0 };
      report();

      try {
        // One retry: a single dropped connection mid-batch should not cost the whole run.
        await putWithRetry(target.uploadUrl, item, signal, (fraction) => {
          state[slot] = { ...state[slot], fraction };
          report();
        });
        state[slot] = {
          ...state[slot],
          state: 'done',
          fraction: 1,
          publicUrl: target.publicUrl,
        };
        publicUrls.set(item.path, target.publicUrl);
      } catch (error) {
        state[slot] = {
          ...state[slot],
          state: 'error',
          error: error instanceof Error ? error.message : 'Upload failed.',
        };
      }
      report();
    }
  };

  report();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return publicUrls;
}

async function putWithRetry(
  url: string,
  item: UploadItem,
  signal: AbortSignal | undefined,
  onFraction: (fraction: number) => void,
): Promise<void> {
  try {
    await put(url, item, signal, onFraction);
  } catch (error) {
    if (signal?.aborted) throw error;
    onFraction(0);
    await put(url, item, signal, onFraction);
  }
}

function put(
  url: string,
  item: UploadItem,
  signal: AbortSignal | undefined,
  onFraction: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', item.contentType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onFraction(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new UploadError(`${item.path}: the bucket rejected it (${xhr.status}).`));
    // A network-level failure here is very often a missing CORS rule on the bucket, and
    // that error is otherwise completely silent.
    xhr.onerror = () =>
      reject(
        new UploadError(
          `${item.path}: could not reach the bucket. If this happens to every file, check the bucket's CORS policy allows PUT from this site.`,
        ),
      );
    xhr.ontimeout = () => reject(new UploadError(`${item.path}: timed out.`));
    xhr.onabort = () => reject(new UploadError('Upload cancelled.'));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    // A fresh copy: the caller's Uint8Array may be a view onto a larger unzip buffer, and
    // send() would otherwise transmit the whole thing.
    xhr.send(item.bytes.slice().buffer as ArrayBuffer);
  });
}
