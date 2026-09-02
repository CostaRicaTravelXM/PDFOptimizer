import type { PresetId } from '@/workers/engine/presets';

/** Which engine produced a result. Surfaced to the user in plain language, never by name. */
export type EngineId = 'smart' | 'flatten' | 'none';

export interface OptimizeOptions {
  preset: PresetId;
  /** Byte ceiling the file must come in under, or null for no limit. */
  targetBytes: number | null;
}

export interface OptimizeStats {
  pages: number;
  /** Images the Smart engine successfully recompressed. */
  imagesOptimized: number;
  /** Images left byte-identical because their encoding was not safely convertible. */
  imagesSkipped: number;
  /** Duplicate image streams collapsed onto a single shared object. */
  imagesDeduped: number;
  /** Fully-opaque soft-masks removed outright. */
  masksDropped: number;
}

export interface OptimizeResult {
  bytes: Uint8Array;
  engine: EngineId;
  stats: OptimizeStats;
}

/** A well-formed failure the UI can explain in plain English. */
export type FailureCode =
  | 'encrypted'
  | 'corrupt'
  | 'not-pdf'
  | 'out-of-memory'
  | 'already-small'
  | 'unknown';

export type JobStatus = 'queued' | 'working' | 'done' | 'failed';

export interface Job {
  id: string;
  file: File;
  name: string;
  originalSize: number;
  status: JobStatus;
  /** 0..1 */
  progress: number;
  /** Short present-tense phrase, e.g. "Shrinking images". */
  phase: string;
  result?: {
    blob: Blob;
    size: number;
    engine: EngineId;
    stats: OptimizeStats;
  };
  error?: { code: FailureCode; message: string };
  /** Object URLs for the before/after comparison, created lazily. */
  previewBefore?: string;
  previewAfter?: string;
}

/* ---------- Worker message protocol ---------- */

export type WorkerRequest = {
  type: 'optimize';
  id: string;
  buffer: ArrayBuffer;
  options: OptimizeOptions;
};

export type WorkerResponse =
  | { type: 'progress'; id: string; progress: number; phase: string }
  | {
      type: 'done';
      id: string;
      buffer: ArrayBuffer;
      engine: EngineId;
      stats: OptimizeStats;
    }
  | { type: 'error'; id: string; code: FailureCode; message: string };

/** Maps an internal failure code to copy a non-technical person can act on. */
export const FAILURE_MESSAGES: Record<FailureCode, string> = {
  encrypted: 'This PDF is password-protected. Remove the password and try again.',
  corrupt: "This file is damaged and can't be read.",
  'not-pdf': 'This is not a PDF file.',
  'out-of-memory': 'This file is too large for your browser. Try one file at a time.',
  'already-small': 'This file is already as small as it can get.',
  unknown: "Something went wrong with this file. It was left untouched.",
};
