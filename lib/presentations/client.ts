import type {
  CreateJobRequest,
  CreateJobResponse,
  JobListResponse,
  JobRecord,
  JobSummary,
  UploadUrlResponse,
} from './types';

/**
 * Browser side of the presentation tool: every call the page makes to the app's own routes.
 * Mirrors `lib/r2Upload.ts` in spirit — small functions, plain fetch, errors as messages a
 * person can read.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const ACCESS_KEY = 'tools-access-code';

/**
 * The optional access code lives in localStorage rather than a cookie so the routes stay
 * stateless and the code never travels on requests to other origins.
 */
export function getAccessCode(): string | null {
  try {
    return localStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}

export function setAccessCode(code: string | null): void {
  try {
    if (code) localStorage.setItem(ACCESS_KEY, code);
    else localStorage.removeItem(ACCESS_KEY);
  } catch {
    // Private mode or blocked storage: the code simply has to be entered again next time.
  }
}

function headers(json: boolean): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h['content-type'] = 'application/json';
  const code = getAccessCode();
  if (code) h['x-tools-access'] = code;
  return h;
}

async function call<T>(input: string, init: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (payload && typeof payload.error === 'string' && payload.error) ||
      `The server refused the request (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export function requestUploadUrl(file: File, signal?: AbortSignal): Promise<UploadUrlResponse> {
  return call<UploadUrlResponse>('/api/presentations/upload-url', {
    method: 'POST',
    headers: headers(true),
    signal,
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: 'application/pdf',
    }),
  });
}

/**
 * PUT the PDF straight to the bucket.
 *
 * XMLHttpRequest for the same reason as the image uploader: fetch reports no upload
 * progress, and a 120 MB itinerary over hotel wifi needs a bar. The File is sent as-is
 * rather than copied into a Uint8Array first — a copy of a file that size would double the
 * tab's memory for nothing.
 */
export function uploadPdf(
  uploadUrl: string,
  file: File,
  onFraction: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const attempt = () =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', 'application/pdf');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onFraction(e.loaded / e.total);
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new ApiError(`The bucket rejected the PDF (${xhr.status}).`, xhr.status));
      xhr.onerror = () =>
        reject(
          new ApiError(
            'Could not reach the storage bucket. If this keeps happening, the bucket CORS policy may not allow uploads from this site.',
            0,
          ),
        );
      xhr.ontimeout = () => reject(new ApiError('The upload timed out.', 0));
      xhr.onabort = () => reject(new ApiError('Upload cancelled.', 0));
      if (signal) {
        if (signal.aborted) {
          xhr.abort();
          return;
        }
        signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }
      xhr.send(file);
    });

  // One retry: a single dropped connection should not cost a multi-minute upload.
  return attempt().catch((error) => {
    if (signal?.aborted) throw error;
    onFraction(0);
    return attempt();
  });
}

export async function createJob(body: CreateJobRequest, signal?: AbortSignal): Promise<JobRecord> {
  const { job } = await call<CreateJobResponse>('/api/presentations/jobs', {
    method: 'POST',
    headers: headers(true),
    signal,
    body: JSON.stringify(body),
  });
  return job;
}

export function fetchJob(id: string, signal?: AbortSignal): Promise<JobRecord> {
  return call<JobRecord>(`/api/presentations/jobs/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: headers(false),
    cache: 'no-store',
    signal,
  });
}

export async function listJobs(limit = 12, signal?: AbortSignal): Promise<JobSummary[]> {
  const { jobs } = await call<JobListResponse>(`/api/presentations/jobs?limit=${limit}`, {
    method: 'GET',
    headers: headers(false),
    cache: 'no-store',
    signal,
  });
  return jobs;
}
