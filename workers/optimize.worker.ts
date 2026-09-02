/// <reference lib="webworker" />

/**
 * Worker entry point. Keeps every expensive operation off the UI thread so a 121 MB file
 * never freezes the page.
 */

import type { FailureCode, WorkerRequest, WorkerResponse } from '@/lib/types';
import { optimize } from './engine/orchestrate';

/** Below this, the file is reported as already small rather than as an optimization. */
const MIN_WORTHWHILE_SAVING = 0.03;

const post = (message: WorkerResponse, transfer?: Transferable[]) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message, transfer ?? []);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer, options } = event.data;
  const source = new Uint8Array(buffer);

  if (!looksLikePdf(source)) {
    post({ type: 'error', id, code: 'not-pdf', message: 'not a pdf' });
    return;
  }

  // Progress messages are cheap but not free; at ~60/s they start competing with the work
  // itself. One update per percent is well past what the eye resolves in a progress bar.
  let lastSent = -1;

  try {
    const result = await optimize(source, options, (fraction, phase) => {
      const step = Math.floor(fraction * 100);
      if (step !== lastSent) {
        lastSent = step;
        post({ type: 'progress', id, progress: fraction, phase });
      }
    });

    // A rounding-error saving is not a result. Presenting "0% smaller" as success invites
    // someone to send the file believing it was fixed, and it will bounce exactly as before.
    if (result.bytes.length > source.length * (1 - MIN_WORTHWHILE_SAVING)) {
      post({ type: 'error', id, code: 'already-small', message: 'no reduction available' });
      return;
    }

    const output = toTransferable(result.bytes);
    post(
      { type: 'done', id, buffer: output, engine: result.engine, stats: result.stats },
      [output],
    );
  } catch (error) {
    const code = classify(error);
    post({ type: 'error', id, code, message: String((error as Error)?.message ?? error) });
  }
};

/** %PDF- magic. Catches the common case of a renamed or mis-picked file immediately. */
function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

/** Map a thrown error onto something the interface can explain without jargon. */
function classify(error: unknown): FailureCode {
  const name = (error as Error)?.name ?? '';
  const message = String((error as Error)?.message ?? error).toLowerCase();

  if (name === 'EncryptedPDFError' || message.includes('encrypted')) return 'encrypted';
  if (name === 'RangeError' || message.includes('out of memory') || message.includes('allocation'))
    return 'out-of-memory';
  if (
    message.includes('invalid pdf') ||
    message.includes('failed to parse') ||
    message.includes('no pdf header') ||
    message.includes('trailer')
  )
    return 'corrupt';
  return 'unknown';
}

/**
 * Hand back a standalone ArrayBuffer.
 *
 * pdf-lib's output is frequently a view onto a larger pooled buffer; transferring that
 * would move far more memory than the file itself, so slice to exactly what was produced.
 */
function toTransferable(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
