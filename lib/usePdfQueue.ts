'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FAILURE_MESSAGES,
  type Job,
  type OptimizeOptions,
  type WorkerResponse,
} from './types';
import { DEFAULT_PRESET, DEFAULT_TARGET, targetBytes } from '@/workers/engine/presets';
import type { PresetId } from '@/workers/engine/presets';

/**
 * Concurrency is governed by bytes in flight, not by file count.
 *
 * A worker decoding a 20 megapixel photograph holds far more memory than the file on disk
 * suggests, and the whole point of this tool is that people drop oversized files into it.
 * Small files parallelise happily; a large one is given the machine to itself.
 */
const MAX_BYTES_IN_FLIGHT = 80 * 1024 * 1024;
const LARGE_FILE = 25 * 1024 * 1024;

function maxWorkers(): number {
  if (typeof navigator === 'undefined') return 2;
  return Math.max(1, Math.min(3, (navigator.hardwareConcurrency ?? 4) - 1));
}

let counter = 0;
const nextId = () => `job-${++counter}-${Date.now().toString(36)}`;

export function usePdfQueue() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [preset, setPreset] = useState<PresetId>(DEFAULT_PRESET);
  const [target, setTarget] = useState<string>(DEFAULT_TARGET);

  const workers = useRef<Worker[]>([]);
  const idle = useRef<Worker[]>([]);
  const pending = useRef<Job[]>([]);
  const running = useRef(new Map<string, { worker: Worker; bytes: number }>());
  const optionsRef = useRef<OptimizeOptions>({
    preset: DEFAULT_PRESET,
    targetBytes: targetBytes(DEFAULT_TARGET),
  });

  useEffect(() => {
    optionsRef.current = { preset, targetBytes: targetBytes(target) };
  }, [preset, target]);

  const patch = useCallback((id: string, next: Partial<Job>) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...next } : job)));
  }, []);

  /** Take the next job whose size fits within the remaining memory allowance. */
  const pump = useCallback(() => {
    while (pending.current.length > 0 && idle.current.length > 0) {
      const inFlight = [...running.current.values()].reduce((sum, r) => sum + r.bytes, 0);
      const next = pending.current[0];

      if (running.current.size > 0) {
        const wouldExceed = inFlight + next.originalSize > MAX_BYTES_IN_FLIGHT;
        const isLarge = next.originalSize > LARGE_FILE;
        if (wouldExceed || isLarge) return; // wait for room rather than risk the tab
      }

      pending.current.shift();
      const worker = idle.current.pop()!;
      running.current.set(next.id, { worker, bytes: next.originalSize });
      patch(next.id, { status: 'working', phase: 'Reading the file', progress: 0.01 });

      next.file
        .arrayBuffer()
        .then((buffer) => {
          worker.postMessage(
            { type: 'optimize', id: next.id, buffer, options: optionsRef.current },
            [buffer],
          );
        })
        .catch(() => {
          running.current.delete(next.id);
          idle.current.push(worker);
          patch(next.id, {
            status: 'failed',
            error: { code: 'corrupt', message: FAILURE_MESSAGES.corrupt },
          });
          pump();
        });
    }
  }, [patch]);

  const finish = useCallback(
    (id: string) => {
      const entry = running.current.get(id);
      if (entry) {
        running.current.delete(id);
        idle.current.push(entry.worker);
      }
      pump();
    },
    [pump],
  );

  useEffect(() => {
    const pool: Worker[] = [];
    for (let i = 0; i < maxWorkers(); i++) {
      const worker = new Worker(new URL('../workers/optimize.worker.ts', import.meta.url), {
        type: 'module',
      });

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.type === 'progress') {
          patch(message.id, { progress: message.progress, phase: message.phase });
          return;
        }
        if (message.type === 'done') {
          const blob = new Blob([message.buffer], { type: 'application/pdf' });
          patch(message.id, {
            status: 'done',
            progress: 1,
            phase: 'Done',
            result: {
              blob,
              size: blob.size,
              engine: message.engine,
              stats: message.stats,
            },
          });
          finish(message.id);
          return;
        }
        patch(message.id, {
          status: 'failed',
          progress: 1,
          error: { code: message.code, message: FAILURE_MESSAGES[message.code] },
        });
        finish(message.id);
      };

      worker.onerror = () => {
        // A worker that died takes its job with it; surface it rather than hanging.
        for (const [id, entry] of running.current.entries()) {
          if (entry.worker === worker) {
            patch(id, {
              status: 'failed',
              error: { code: 'out-of-memory', message: FAILURE_MESSAGES['out-of-memory'] },
            });
            running.current.delete(id);
          }
        }
        pump();
      };

      pool.push(worker);
    }

    workers.current = pool;
    idle.current = [...pool];

    return () => {
      pool.forEach((w) => w.terminate());
      workers.current = [];
      idle.current = [];
      running.current.clear();
    };
  }, [patch, finish, pump]);

  const add = useCallback(
    (files: File[]) => {
      const pdfs = files.filter(
        (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
      );
      if (pdfs.length === 0) return;

      const created: Job[] = pdfs.map((file) => ({
        id: nextId(),
        file,
        name: file.name,
        originalSize: file.size,
        status: 'queued',
        progress: 0,
        phase: 'Waiting',
      }));

      setJobs((current) => [...current, ...created]);
      pending.current.push(...created);
      pump();
    },
    [pump],
  );

  /** Re-run everything under new settings. Called when the quality choice changes. */
  const rerun = useCallback(() => {
    setJobs((current) => {
      const revivable = current.filter((job) => job.status !== 'working');
      if (revivable.length === 0) return current;

      const reset = current.map((job) =>
        job.status === 'working'
          ? job
          : {
              ...job,
              status: 'queued' as const,
              progress: 0,
              phase: 'Waiting',
              result: undefined,
              error: undefined,
              previewAfter: undefined,
            },
      );
      pending.current = reset.filter((job) => job.status === 'queued');
      queueMicrotask(pump);
      return reset;
    });
  }, [pump]);

  const remove = useCallback((id: string) => {
    pending.current = pending.current.filter((job) => job.id !== id);
    setJobs((current) => current.filter((job) => job.id !== id));
  }, []);

  const clear = useCallback(() => {
    pending.current = [];
    setJobs([]);
  }, []);

  return {
    jobs,
    add,
    remove,
    clear,
    rerun,
    preset,
    setPreset,
    target,
    setTarget,
    busy: jobs.some((j) => j.status === 'queued' || j.status === 'working'),
  };
}
