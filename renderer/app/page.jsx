'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';

import Calendar from '../components/Calendar';
import ReminderAlert from '../components/ReminderAlert';

const MAX_PAGES = 24;

const ARROW_EDGE = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'top',
  ArrowDown: 'bottom',
};

/** The preload bridge. Absent while Next prerenders, and in a plain browser. */
const bridge = () => (typeof window === 'undefined' ? null : window.ghostnote);

function makePage(n) {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2);
  return { id, title: `Page ${n}`, body: '', createdAt: Date.now(), updatedAt: Date.now() };
}

/** Hinge transform for the folded-away panel, per docked edge. */
function foldedVars(edge) {
  switch (edge) {
    case 'left':
      return { rotationY: -78, scaleX: 0.35, opacity: 0 };
    case 'top':
      return { rotationX: 78, scaleY: 0.35, opacity: 0 };
    case 'bottom':
      return { rotationX: -78, scaleY: 0.35, opacity: 0 };
    default:
      return { rotationY: 78, scaleX: 0.35, opacity: 0 };
  }
}

const OPEN_VARS = { rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1, opacity: 1 };

const Chevron = ({ className = '' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M9 18l6-6-6-6" />
  </svg>
);

const Plus = ({ className = '' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    className={className}
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const CalendarIcon = ({ className = "" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

const NoteIcon = ({ className = "" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5" />
  </svg>
);

/** Static render of a page, used for both faces mid-turn. */
function Preview({ page }) {
  return (
    <div className="h-full w-full overflow-hidden whitespace-pre-wrap break-words px-4 py-3 text-[13px] leading-[1.75] text-ink-text">
      {page?.body || <span className="text-white/25">Empty page</span>}
    </div>
  );
}

export default function GhostNote() {
  const [pages, setPages] = useState([]);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('');
  const [dock, setDock] = useState({ edge: 'right', collapsed: false });
  const [showTab, setShowTab] = useState(false);

  /** Non-null only while a page is mid-turn: { dir, from }. */
  const [turn, setTurn] = useState(null);

  /** 'notes' or 'reminders' — the whole panel flips between the two. */
  const [view, setView] = useState("notes");
  const [reminders, setReminders] = useState([]);
  const [alert, setAlert] = useState(null);

  const shellRef = useRef(null);
  const tabRef = useRef(null);
  const overlayRef = useRef(null);
  const shadeRef = useRef(null);
  const editorRef = useRef(null);
  const saveTimer = useRef(null);
  const lastCollapsed = useRef(false);

  // --- load + dock wiring -------------------------------------------------
  useEffect(() => {
    const g = bridge();
    if (!g) {
      // Browser preview (npm run dev) gets a scratch page so the UI still works.
      setPages([makePage(1)]);
      setReady(true);
      return;
    }

    // Main keeps the window hidden until this resolves, so the widget appears
    // already populated and already the right shape — no empty panel, and no
    // flash of the full panel before folding down to a tab.
    Promise.all([g.load(), g.getDock()])
      .then(([doc, state]) => {
        setPages(doc.pages);
        setIndex(Math.min(doc.activeIndex ?? 0, doc.pages.length - 1));
        setReminders(doc.reminders || []);

        setDock(state);
        setShowTab(state.collapsed);
        lastCollapsed.current = state.collapsed;

        setReady(true);
      })
      .finally(() => {
        // Also releases any reminders missed while we were closed.
        g.uiReady?.();
      });

    const offDock = g.onDock((state) => setDock(state));
    const offReminder = g.onReminder?.((r) => setAlert(r));
    const offCmd = g.onCommand((cmd) => {
      if (cmd === 'new-page') addPageRef.current?.();
    });

    return () => {
      offDock?.();
      offCmd?.();
      offReminder?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror dock state onto <body> so the CSS can orient the chrome.
  useEffect(() => {
    document.body.dataset.edge = dock.edge;
    document.body.dataset.collapsed = String(showTab);
  }, [dock.edge, showTab]);

  // --- fold / unfold ------------------------------------------------------
  useLayoutEffect(() => {
    if (!ready || dock.collapsed === lastCollapsed.current) return;
    lastCollapsed.current = dock.collapsed;

    const edge = dock.edge;

    if (dock.collapsed) {
      gsap.to(shellRef.current, {
        ...foldedVars(edge),
        duration: 0.3,
        ease: 'power2.in',
        onComplete: () => {
          setShowTab(true);
          requestAnimationFrame(() => {
            if (tabRef.current) {
              gsap.fromTo(tabRef.current, foldedVars(edge), {
                ...OPEN_VARS,
                duration: 0.28,
                ease: 'power2.out',
              });
            }
          });
        },
      });
    } else {
      setShowTab(false);
      requestAnimationFrame(() => {
        if (shellRef.current) {
          gsap.fromTo(shellRef.current, foldedVars(edge), {
            ...OPEN_VARS,
            duration: 0.32,
            ease: 'power2.out',
          });
        }
      });
    }
  }, [dock.collapsed, dock.edge, ready]);

  // --- persistence --------------------------------------------------------
  /** Latest unsaved snapshot, so we can force it out early if needed. */
  const pending = useRef(null);

  const queueSave = useCallback((nextPages, nextIndex) => {
    setStatus('typing…');
    pending.current = { pages: nextPages, activeIndex: nextIndex };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const g = bridge();
      if (!g || !pending.current) return;
      const snapshot = pending.current;
      pending.current = null;
      const res = await g.save(snapshot);
      setStatus(res?.ok ? 'saved' : 'save failed');
    }, 300);
  }, []);

  /** Skips the debounce — used when we might be about to lose the window. */
  const flushNow = useCallback(() => {
    if (!pending.current) return;
    clearTimeout(saveTimer.current);
    const snapshot = pending.current;
    pending.current = null;
    bridge()?.save(snapshot);
  }, []);

  // A shutdown, a hide, or clicking away can all cut the debounce short.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flushNow();
    window.addEventListener('blur', flushNow);
    window.addEventListener('beforeunload', flushNow);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('blur', flushNow);
      window.removeEventListener('beforeunload', flushNow);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flushNow]);

  const onType = (value) => {
    const next = pages.map((p, i) =>
      i === index ? { ...p, body: value, updatedAt: Date.now() } : p
    );
    setPages(next);
    queueSave(next, index);
  };

  // --- page turning -------------------------------------------------------
  const goTo = useCallback(
    (target) => {
      if (turn) return; // one turn at a time
      if (target < 0 || target >= pages.length || target === index) return;

      setTurn({ dir: target > index ? 'next' : 'prev', from: index });
      setIndex(target);
      queueSave(pages, target);
    },
    [turn, pages, index, queueSave]
  );

  const addPage = useCallback(() => {
    if (turn || pages.length >= MAX_PAGES) return;

    const next = [...pages, makePage(pages.length + 1)];
    setTurn({ dir: 'next', from: index });
    setPages(next);
    setIndex(next.length - 1);
    queueSave(next, next.length - 1);
  }, [turn, pages, index, queueSave]);

  // Keeps the tray's "New Page" command pointed at the current closure.
  const addPageRef = useRef(addPage);
  useEffect(() => {
    addPageRef.current = addPage;
  }, [addPage]);

  // --- reminders ----------------------------------------------------------
  const persistReminders = useCallback((list) => {
    setReminders(list);
    bridge()?.saveReminders?.(list);
  }, []);

  const addReminder = useCallback(
    (text, at, lead = 0, repeat = { type: "none", days: [], day: 0 }) => {
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(16).slice(2);
      const next = [
        ...reminders,
        { id, text, at, lead, repeat, notified: false, createdAt: Date.now() },
      ];
      next.sort((a, b) => a.at - b.at);
      persistReminders(next);
    },
    [reminders, persistReminders]
  );

  const deleteReminder = useCallback(
    (id) => persistReminders(reminders.filter((r) => r.id !== id)),
    [reminders, persistReminders]
  );

  /** Alert is done: main folds the widget back to however it was. */
  const dismissAlert = useCallback(() => {
    setAlert(null);
    bridge()?.reminderDone?.();
  }, []);

  /**
   * The turn itself: the leaf hinges about its left edge, exactly like lifting
   * a page in a bound book, while a gradient sweeps across it to fake the
   * shadow of the lifted paper.
   */
  useLayoutEffect(() => {
    if (!turn || !overlayRef.current) return;

    const leaf = overlayRef.current;
    const shade = shadeRef.current;
    const tl = gsap.timeline({
      onComplete: () => {
        setTurn(null);
        requestAnimationFrame(() => editorRef.current?.focus());
      },
    });

    const common = { transformOrigin: 'left center', transformPerspective: 1400 };

    if (turn.dir === 'next') {
      gsap.set(leaf, { ...common, rotationY: 0, opacity: 1 });
      gsap.set(shade, { opacity: 0 });
      tl.to(leaf, { rotationY: -96, duration: 0.5, ease: 'power2.in' }, 0)
        .to(shade, { opacity: 0.55, duration: 0.5, ease: 'power2.in' }, 0)
        .to(leaf, { opacity: 0, duration: 0.14 }, 0.36);
    } else {
      gsap.set(leaf, { ...common, rotationY: -96, opacity: 1 });
      gsap.set(shade, { opacity: 0.55 });
      tl.to(leaf, { rotationY: 0, duration: 0.55, ease: 'power2.out' }, 0)
        .to(shade, { opacity: 0, duration: 0.55, ease: 'power2.out' }, 0);
    }

    return () => tl.kill();
  }, [turn]);

  // --- keyboard -----------------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      const g = bridge();

      if (e.key === 'Escape') return g?.hide();
      if (e.ctrlKey && e.key === '\\') {
        e.preventDefault();
        return g?.toggleCollapse();
      }
      if (e.ctrlKey && e.shiftKey && ARROW_EDGE[e.key]) {
        e.preventDefault();
        return g?.setEdge(ARROW_EDGE[e.key]);
      }
      // Alt+arrows turn pages; plain arrows still move the caret.
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        return goTo(index + 1);
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        return goTo(index - 1);
      }
      if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        return addPage();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, addPage, index]);

  // --- render -------------------------------------------------------------
  const active = pages[index];

  // Mid-turn the lifted leaf sits above whichever page is being revealed.
  const basePage = turn ? (turn.dir === 'next' ? pages[index] : pages[turn.from]) : active;
  const leafPage = turn ? (turn.dir === 'next' ? pages[turn.from] : pages[index]) : null;

  return (
    <div id="stage">
      {/* ----------------------------- panel ----------------------------- */}
      {/* NB: display is set inline, not via the `hidden` attribute. Tailwind's
          preflight `[hidden]{display:none}` and the `flex` utility have equal
          specificity, so the utility wins and `hidden` does nothing. */}
      <div
        ref={shellRef}
        style={{ display: alert || showTab ? 'none' : 'flex' }}
        className="shell relative h-full flex-col overflow-hidden"
      >
        <header className="drag flex flex-none items-center gap-2 border-b border-white/[0.06] px-3 py-2">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <i key={i} className="h-[3px] w-[3px] rounded-full bg-white/25" />
            ))}
          </span>

          <h1 className="flex-1 font-display text-[15px] font-medium tracking-[0.01em]">
            GhostNote
          </h1>

          <span className="font-sans text-[10px] tabular-nums text-white/30">
            {status || (pages.length ? `${index + 1} / ${pages.length}` : '')}
          </span>

          {view === "notes" ? (
            <button
              onClick={addPage}
              disabled={pages.length >= MAX_PAGES}
              title="New page  (Ctrl+N)"
              className="nodrag grid h-[22px] w-[22px] place-items-center rounded-md text-white/40 transition hover:bg-white/[0.08] hover:text-ink-text disabled:opacity-20 disabled:hover:bg-transparent"
            >
              <Plus className="h-[13px] w-[13px]" />
            </button>
          ) : null}

          <button
            onClick={() => setView(view === "notes" ? "reminders" : "notes")}
            title={view === "notes" ? "Reminders" : "Notes"}
            className="nodrag grid h-[22px] w-[22px] place-items-center rounded-md text-white/40 transition hover:bg-white/[0.08] hover:text-ink-text"
          >
            {view === "notes" ? (
              <CalendarIcon className="h-[13px] w-[13px]" />
            ) : (
              <NoteIcon className="h-[13px] w-[13px]" />
            )}
          </button>

          <button
            onClick={() => bridge()?.collapse()}
            title="Fold into edge  (Ctrl+\)"
            className="nodrag grid h-[22px] w-[22px] place-items-center rounded-md text-white/40 transition hover:bg-white/[0.08] hover:text-ink-text"
          >
            <Chevron className="fold-glyph h-[13px] w-[13px]" />
          </button>
        </header>

        {view === "reminders" ? (
          <div className="min-h-0 flex-1">
            <Calendar reminders={reminders} onAdd={addReminder} onDelete={deleteReminder} />
          </div>
        ) : (
          /* ------------------------- the book ------------------------- */
          <div className="relative min-h-0 flex-1" style={{ perspective: '1600px' }}>
          {/* Spine shading down the hinge side. */}
          <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-3 bg-gradient-to-r from-black/25 to-transparent" />

          <div className="absolute inset-0">
            {turn ? (
              <Preview page={basePage} />
            ) : (
              <textarea
                ref={editorRef}
                value={active?.body ?? ''}
                onChange={(e) => onType(e.target.value)}
                spellCheck
                placeholder="Start typing — it saves itself."
                className="scroll-thin nodrag h-full w-full select-text resize-none overflow-y-auto bg-transparent px-4 py-3 text-[13px] leading-[1.75] text-ink-text outline-none placeholder:text-white/25"
              />
            )}
          </div>

          {turn && (
            <div
              ref={overlayRef}
              className="absolute inset-0 z-10"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <div className="absolute inset-0 bg-[rgba(12,12,15,0.995)]">
                <Preview page={leafPage} />
              </div>
              <div
                ref={shadeRef}
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/80 via-black/30 to-transparent opacity-0"
              />
            </div>
          )}
        </div>

        )}

        {/* --------------------------- page nav --------------------------- */}
        {view === "notes" ? (
        <footer className="nodrag flex flex-none items-center gap-2 border-t border-white/[0.06] px-3 py-2">
          <button
            onClick={() => goTo(index - 1)}
            disabled={index === 0 || !!turn}
            title="Previous page  (Alt+←)"
            className="grid h-[22px] w-[22px] place-items-center rounded-md text-white/45 transition hover:bg-white/[0.08] hover:text-ink-text disabled:opacity-20 disabled:hover:bg-transparent"
          >
            <Chevron className="h-[13px] w-[13px] rotate-180" />
          </button>

          <div className="flex flex-1 items-center justify-center gap-[5px] overflow-hidden">
            {pages.map((p, i) => (
              <button
                key={p.id}
                onClick={() => goTo(i)}
                title={p.title}
                className={`h-[5px] rounded-full transition-all duration-200 ${
                  i === index ? 'w-[14px] bg-white/70' : 'w-[5px] bg-white/20 hover:bg-white/40'
                }`}
              />
            ))}
          </div>

          <button
            onClick={() => goTo(index + 1)}
            disabled={index >= pages.length - 1 || !!turn}
            title="Next page  (Alt+→)"
            className="grid h-[22px] w-[22px] place-items-center rounded-md text-white/45 transition hover:bg-white/[0.08] hover:text-ink-text disabled:opacity-20 disabled:hover:bg-transparent"
          >
            <Chevron className="h-[13px] w-[13px]" />
          </button>
        </footer>
        ) : null}

      </div>

      {/* ----------------------------- alert ----------------------------- */}
      {/* Its own surface: the window shrinks to the card, so the panel and
          tab step aside entirely rather than being covered. */}
      {alert ? <ReminderAlert reminder={alert} onDone={dismissAlert} /> : null}

      {/* ------------------------------ tab ------------------------------ */}
      <div
        ref={tabRef}
        style={{ display: !alert && showTab ? 'flex' : 'none' }}
        className="tab absolute inset-0 items-center justify-center"
      >
        <button
          onClick={() => bridge()?.expand()}
          title="Unfold"
          className="nodrag grid cursor-pointer place-items-center rounded-[5px] text-white/50 transition hover:bg-white/10 hover:text-ink-text data-[axis=x]:h-full data-[axis=x]:w-[30px] data-[axis=y]:h-[30px] data-[axis=y]:w-full"
          data-axis={dock.edge === 'top' || dock.edge === 'bottom' ? 'x' : 'y'}
        >
          <Chevron className="tab-glyph h-[11px] w-[11px]" />
        </button>
      </div>
    </div>
  );
}
