'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  onFiles: (files: File[]) => void;
  /** Shrinks to a slim bar once there is a queue to look at instead. */
  compact: boolean;
  /** File input filter. Drops are not filtered — the caller validates what it receives. */
  accept?: string;
  multiple?: boolean;
  /** Wording, so a second tool can borrow the control without borrowing "PDF". */
  label?: string;
  idleTitle?: string;
  compactTitle?: string;
  hint?: React.ReactNode;
}

/**
 * The only control most people will ever touch.
 *
 * The entire window accepts a drop, not just the panel: aiming is a skill people should not
 * need. Paste works too, because "copy the file, paste it here" is how a lot of non-technical
 * users move things around.
 */
export function Dropzone({
  onFiles,
  compact,
  accept: acceptAttr = 'application/pdf,.pdf',
  multiple = true,
  label = 'Choose PDF files to make smaller',
  idleTitle = 'Drop your PDFs here',
  compactTitle = 'Add more PDFs',
  hint,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const accept = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      onFiles(Array.from(list));
    },
    [onFiles],
  );

  useEffect(() => {
    // Counting enter/leave avoids the flicker caused by moving between child elements.
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth.current += 1;
      setDragging(true);
    };
    const onLeave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      accept(e.dataTransfer?.files ?? null);
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length > 0) onFiles(files);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [accept, onFiles]);

  const open = () => input.current?.click();

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={acceptAttr}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = ''; // let the same file be chosen twice in a row
        }}
      />

      <button
        type="button"
        onClick={open}
        aria-label={label}
        className={[
          'glass-card group relative block w-full cursor-pointer overflow-hidden rounded-3xl',
          'text-center transition-all duration-300',
          compact ? 'px-6 py-7' : 'px-6 py-16 sm:py-20',
          dragging
            ? 'border-accent scale-[1.01] shadow-[0_28px_60px_-18px_#396b1f4d]'
            : 'hover:border-accent/50 hover:shadow-[0_25px_50px_-12px_#14313f24]',
        ].join(' ')}
      >
        <span
          aria-hidden
          className={[
            'pointer-events-none absolute inset-3 rounded-[1.35rem] border-2 border-dashed transition-colors duration-300',
            dragging ? 'border-accent/70' : 'border-fg/12 group-hover:border-accent/40',
          ].join(' ')}
        />

        <span className="relative flex flex-col items-center gap-3">
          <span
            className={[
              'flex items-center justify-center rounded-full transition-transform duration-300',
              compact ? 'size-11' : 'size-16',
              dragging ? 'scale-110' : 'group-hover:scale-105',
            ].join(' ')}
            style={{ background: 'linear-gradient(135deg, #72c049, #4e9a33)' }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#14313f"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={compact ? 'size-5' : 'size-7'}
              aria-hidden
            >
              <path d="M12 16V4" />
              <path d="m6 10 6-6 6 6" />
              <path d="M4 20h16" />
            </svg>
          </span>

          <span
            className={[
              'font-display font-semibold tracking-tight',
              compact ? 'text-xl' : 'text-3xl sm:text-4xl',
            ].join(' ')}
          >
            {dragging
              ? multiple
                ? 'Drop them anywhere'
                : 'Drop it anywhere'
              : compact
                ? compactTitle
                : idleTitle}
          </span>

          {!compact && (
            <span className="text-muted max-w-md text-[0.95rem] leading-relaxed">
              {hint ?? (
                <>
                  or <span className="text-accent-deep decoration-accent/40 font-semibold underline underline-offset-4">browse your files</span>.
                  They start shrinking straight away.
                </>
              )}
            </span>
          )}
        </span>
      </button>
    </>
  );
}
