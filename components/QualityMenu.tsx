'use client';

import { useEffect, useRef, useState } from 'react';
import { PRESET_LIST, SIZE_TARGETS, type PresetId } from '@/workers/engine/presets';

interface Props {
  preset: PresetId;
  target: string;
  onPreset: (id: PresetId) => void;
  onTarget: (id: string) => void;
  disabled: boolean;
}

/**
 * Settings, kept deliberately quiet.
 *
 * Defaults are chosen so that nobody has to open this. It is a dropdown rather than a row
 * of visible controls because every visible control is a decision demanded of someone who
 * only wanted to email a file.
 */
export function QualityMenu({ preset, target, onPreset, onTarget, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = PRESET_LIST.find((p) => p.id === preset)!;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="true"
        className="btn-quiet flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
      >
        <span className="text-muted">Quality:</span>
        <span className="font-semibold">{current.label}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="glass-card-solid animate-in absolute right-0 z-40 mt-2 w-72 rounded-2xl p-2 shadow-[0_25px_50px_-12px_#14313f38]">
          <p className="text-muted px-3 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase">
            Quality
          </p>
          {PRESET_LIST.map((option) => (
            <Option
              key={option.id}
              selected={option.id === preset}
              title={option.label}
              hint={option.hint}
              onClick={() => onPreset(option.id)}
            />
          ))}

          <p className="text-muted mt-1 border-t border-[#14313f14] px-3 pt-3 pb-1 text-xs font-semibold tracking-wide uppercase">
            Must fit in
          </p>
          {SIZE_TARGETS.map((option) => (
            <Option
              key={option.id}
              selected={option.id === target}
              title={option.label}
              onClick={() => onTarget(option.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Option({
  selected,
  title,
  hint,
  onClick,
}: {
  selected: boolean;
  title: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition ${
        selected ? 'bg-accent/15' : 'hover:bg-fg/5'
      }`}
    >
      <span
        aria-hidden
        className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? 'border-accent-deep' : 'border-fg/25'
        }`}
      >
        {selected && <span className="bg-accent-deep size-2 rounded-full" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        {hint && <span className="text-muted block text-xs">{hint}</span>}
      </span>
    </button>
  );
}
