'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A select that matches the widget.
 *
 * The native <select> popup is drawn by the OS: square corners, system font,
 * and a light background unless the whole app declares a dark colour scheme.
 * Even then it looks foreign inside a rounded translucent panel, so this draws
 * its own list. It opens upward because the form sits at the bottom of the
 * panel, where a downward list would be clipped by the window edge.
 */
export default function Dropdown({ value, onChange, options, title, className = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const current = options.find((o) => o.v === value);

  useEffect(() => {
    if (!open) return;

    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // don't let Esc hide the whole widget
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={'relative ' + className}>
      <button
        type="button"
        title={title}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded-md border border-white/10 bg-white/[0.04]
                   px-2 py-1 text-left text-[11px] text-ink-text transition hover:border-white/20
                   focus:border-white/25 focus:outline-none"
      >
        <span className="min-w-0 flex-1 truncate">{current ? current.label : ''}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={'h-[9px] w-[9px] flex-none text-white/40 transition-transform ' +
            (open ? 'rotate-180' : '')}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <ul
          className="scroll-thin absolute bottom-full left-0 z-40 mb-1 max-h-[148px] w-full
                     overflow-y-auto rounded-md border border-white/10 bg-[rgba(18,18,22,0.99)]
                     py-1 shadow-lg shadow-black/40"
        >
          {options.map((o) => {
            const active = o.v === value;
            return (
              <li key={String(o.v)}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.v);
                    setOpen(false);
                  }}
                  className={
                    'block w-full px-2 py-[5px] text-left text-[11px] transition ' +
                    (active
                      ? 'bg-white/[0.12] text-ink-text'
                      : 'text-white/60 hover:bg-white/[0.08] hover:text-ink-text')
                  }
                >
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
