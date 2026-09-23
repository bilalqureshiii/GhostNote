'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';

const HOLD_SECONDS = 5;

const fmt = (ms) =>
  new Date(ms).toLocaleString([], {
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  });

/**
 * The card that rides out of the docked edge when a reminder comes due.
 *
 * It owns the whole window: main shrinks the frame to this card's measured
 * height, so a one-line reminder gets a one-line window rather than unfolding
 * the full note panel. Dismisses itself after five seconds, but the countdown
 * pauses while the pointer is over it.
 */
export default function ReminderAlert({ reminder, onDone }) {
  const rootRef = useRef(null);
  const bodyRef = useRef(null);
  const barRef = useRef(null);
  const countdown = useRef(null);
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    countdown.current?.kill();
    onDone();
  };

  // Measure the content and ask main for exactly that much window.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const height = Math.ceil(body.getBoundingClientRect().height) + 24; // + padding
    window.ghostnote?.resizeAlert?.(height);
  }, [reminder?.id, reminder?.text]);

  useLayoutEffect(() => {
    finished.current = false;
    const root = rootRef.current;
    const bar = barRef.current;
    if (!root || !bar) return;

    gsap.fromTo(
      root,
      { opacity: 0, scale: 0.94 },
      { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.5)' }
    );

    countdown.current = gsap.fromTo(
      bar,
      { scaleX: 1 },
      {
        scaleX: 0,
        duration: HOLD_SECONDS,
        ease: 'none',
        transformOrigin: 'left center',
        onComplete: finish,
      }
    );

    return () => {
      countdown.current?.kill();
      gsap.killTweensOf(root);
    };
    // A new reminder means a fresh card, so restart the whole thing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminder?.id]);

  // Esc dismisses the alert rather than hiding the widget.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!reminder) return null;

  return (
    <div
      ref={rootRef}
      className="shell drag flex h-full w-full flex-col justify-center overflow-hidden px-3 py-2"
      onMouseEnter={() => countdown.current?.pause()}
      onMouseLeave={() => countdown.current?.resume()}
    >
      <div ref={bodyRef}>
        <div className="flex items-center gap-2">
          <span className="font-display text-[12px] tracking-[0.01em] text-white/55">
            {reminder.late ? 'Missed reminder' : 'Reminder'}
          </span>
          {reminder.late ? (
            <span className="rounded-full bg-amber-400/15 px-1.5 text-[8.5px] uppercase tracking-wide text-amber-300/90">
              late
            </span>
          ) : null}
          <span className="font-sans text-[9.5px] tabular-nums text-white/30">
            {fmt(reminder.at)}
          </span>
          <span className="flex-1" />
          <button
            onClick={finish}
            title="Dismiss"
            className="nodrag grid h-[18px] w-[18px] flex-none place-items-center rounded text-white/35 transition hover:bg-white/10 hover:text-ink-text"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor"
                 strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <p className="mt-1 break-words text-[13px] leading-snug text-ink-text">
          {reminder.text || 'Untitled reminder'}
        </p>

        <div className="mt-2 h-[2px] w-full overflow-hidden rounded-full bg-white/10">
          <div ref={barRef} className="h-full w-full origin-left rounded-full bg-white/45" />
        </div>
      </div>
    </div>
  );
}
