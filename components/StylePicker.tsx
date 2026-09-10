'use client';

import { STYLES, type PresentationStyle } from '@/lib/presentations/types';

interface Props {
  value: PresentationStyle;
  onChange: (style: PresentationStyle) => void;
  disabled?: boolean;
}

/**
 * The one choice that changes everything downstream: how dense and how photographic the
 * deck is. Two cards rather than a select, because the difference deserves a sentence each
 * and people pick faster when they can see both.
 */
export function StylePicker({ value, onChange, disabled }: Props) {
  return (
    <div role="radiogroup" aria-label="Presentation style" className="grid gap-3 sm:grid-cols-2">
      {STYLES.map((style) => {
        const selected = style.value === value;
        return (
          <button
            key={style.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(style.value)}
            className={[
              'glass-card rounded-2xl px-4 py-3.5 text-left transition-all duration-200',
              selected
                ? 'border-accent shadow-[0_18px_40px_-18px_#396b1f66]'
                : 'hover:border-accent/50',
              disabled ? 'cursor-default opacity-70' : 'cursor-pointer',
            ].join(' ')}
          >
            <span className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={[
                  'flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  selected ? 'border-accent-deep' : 'border-fg/30',
                ].join(' ')}
              >
                {selected && <span className="bg-accent-deep block size-2 rounded-full" />}
              </span>
              <span className="font-display text-lg font-semibold tracking-tight">{style.label}</span>
            </span>
            <span className="text-muted mt-1.5 block text-sm leading-relaxed">{style.description}</span>
          </button>
        );
      })}
    </div>
  );
}
