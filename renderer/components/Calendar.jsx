'use client';

import { useMemo, useState } from 'react';

import Dropdown from './Dropdown';
import TimePicker from './TimePicker';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const LEADS = [
  { v: 0, label: 'At the time' },
  { v: 5, label: '5 min before' },
  { v: 10, label: '10 min before' },
  { v: 15, label: '15 min before' },
  { v: 30, label: '30 min before' },
  { v: 60, label: '1 hour before' },
  { v: 120, label: '2 hours before' },
  { v: 1440, label: '1 day before' },
];

const REPEATS = [
  { v: 'none', label: 'Once' },
  { v: 'daily', label: 'Daily' },
  { v: 'weekly', label: 'Weekly' },
  { v: 'monthly', label: 'Monthly' },
];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const sameDay = (a, b) => startOfDay(new Date(a)) === startOfDay(new Date(b));

const fmtTime = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Short form for the list: "10m before". */
function leadLabel(mins) {
  if (!mins) return null;
  if (mins % 1440 === 0) return mins / 1440 + 'd before';
  if (mins % 60 === 0) return mins / 60 + 'h before';
  return mins + 'm before';
}

/** Default suggestion: the next whole hour, so the form is usable immediately. */
function nextHourValue() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return String(d.getHours()).padStart(2, '0') + ':00';
}

/**
 * Every time this reminder lands inside the given month.
 *
 * A recurring reminder is stored as a single row holding its *next* occurrence,
 * so the grid has to project the series forward itself — otherwise a weekly
 * stand-up would show a dot on one day a month.
 */
function occurrencesInMonth(r, year, month) {
  const out = [];
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();
  const seriesStart = startOfDay(new Date(r.at));
  const type = (r.repeat && r.repeat.type) || 'none';

  if (type === 'none') {
    if (r.at >= new Date(year, month, 1).getTime() && r.at <= monthEnd) out.push(r.at);
    return out;
  }
  if (r.at > monthEnd) return out; // series has not started yet

  const base = new Date(r.at);
  const h = base.getHours();
  const mi = base.getMinutes();
  const total = new Date(year, month + 1, 0).getDate();

  if (type === 'daily') {
    for (let d = 1; d <= total; d++) {
      const t = new Date(year, month, d, h, mi).getTime();
      if (t >= seriesStart) out.push(t);
    }
  } else if (type === 'weekly') {
    const days = r.repeat.days && r.repeat.days.length ? r.repeat.days : [base.getDay()];
    for (let d = 1; d <= total; d++) {
      const dt = new Date(year, month, d, h, mi);
      if (days.includes(dt.getDay()) && dt.getTime() >= seriesStart) out.push(dt.getTime());
    }
  } else if (type === 'monthly') {
    const anchor = (r.repeat && r.repeat.day) || base.getDate();
    const t = new Date(year, month, Math.min(anchor, total), h, mi).getTime();
    if (t >= seriesStart) out.push(t);
  }

  return out;
}

const repeatSummary = (rep) => {
  if (!rep || rep.type === 'none') return null;
  if (rep.type === 'weekly' && rep.days && rep.days.length) {
    return rep.days.map((d) => WEEKDAYS[d]).join('');
  }
  return rep.type;
};

const Chevron = ({ className = '' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M9 18l6-6-6-6" />
  </svg>
);

const Repeat = ({ className = '' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 01-4 4H3" />
  </svg>
);

const fieldClass =
  'select-text rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] ' +
  'text-ink-text outline-none focus:border-white/25 [color-scheme:dark]';

export default function Calendar({ reminders, onAdd, onDelete }) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(() => startOfDay(today));
  const [text, setText] = useState('');
  const [time, setTime] = useState(nextHourValue);
  const [lead, setLead] = useState(0);
  const [repeatType, setRepeatType] = useState('none');
  const [weekDays, setWeekDays] = useState([]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const cells = useMemo(() => {
    const first = new Date(year, month, 1).getDay();
    const total = new Date(year, month + 1, 0).getDate();
    return [
      ...Array.from({ length: first }, () => null),
      ...Array.from({ length: total }, (_, i) => new Date(year, month, i + 1).getTime()),
    ];
  }, [year, month]);

  /** Every projected occurrence in view, grouped by day. */
  const byDay = useMemo(() => {
    const map = new Map();
    for (const r of reminders) {
      for (const at of occurrencesInMonth(r, year, month)) {
        const key = startOfDay(new Date(at));
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ at, reminder: r });
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.at - b.at);
    return map;
  }, [reminders, year, month]);

  const dayList = byDay.get(selected) || [];

  const shiftMonth = (delta) => setCursor(new Date(year, month + delta, 1));

  const toggleDay = (d) =>
    setWeekDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const submit = (e) => {
    e.preventDefault();
    const label = text.trim();
    if (!label || !time) return;

    const [h, m] = time.split(':').map(Number);
    const when = new Date(selected);
    when.setHours(h, m, 0, 0);

    const repeat = { type: repeatType, days: [], day: 0 };
    if (repeatType === 'weekly') {
      repeat.days = weekDays.length ? weekDays : [when.getDay()];
    } else if (repeatType === 'monthly') {
      repeat.day = when.getDate();
    }

    onAdd(label, when.getTime(), lead, repeat);
    setText('');
  };

  return (
    <div className="cal-wrap flex h-full min-h-0 gap-3 p-3">
      {/* ------------------------------ grid ------------------------------ */}
      <div className="cal-month flex flex-none flex-col">
        <div className="mb-2 flex items-center gap-1">
          <button
            onClick={() => shiftMonth(-1)}
            title="Previous month"
            className="grid h-[20px] w-[20px] place-items-center rounded text-white/40 hover:bg-white/10 hover:text-ink-text"
          >
            <Chevron className="h-3 w-3 rotate-180" />
          </button>
          <span className="flex-1 text-center font-display text-[13px]">
            {MONTHS[month]} {year}
          </span>
          <button
            onClick={() => shiftMonth(1)}
            title="Next month"
            className="grid h-[20px] w-[20px] place-items-center rounded text-white/40 hover:bg-white/10 hover:text-ink-text"
          >
            <Chevron className="h-3 w-3" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-[2px] text-center text-[9px] text-white/30">
          {WEEKDAYS.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>

        <div className="mt-1 grid grid-cols-7 gap-[2px]">
          {cells.map((ts, i) => {
            if (ts === null) return <span key={'b' + i} />;
            const isToday = sameDay(ts, today.getTime());
            const isSelected = ts === selected;
            const has = byDay.has(ts);

            const base = 'relative grid h-[26px] place-items-center rounded text-[11px] transition ';
            const tone = isSelected
              ? 'bg-white/85 font-medium text-black'
              : 'text-white/70 hover:bg-white/10';
            const ring = isToday && !isSelected ? ' ring-1 ring-inset ring-white/35' : '';

            return (
              <button key={ts} onClick={() => setSelected(ts)} className={base + tone + ring}>
                {new Date(ts).getDate()}
                {has ? (
                  <span
                    className={
                      'absolute bottom-[3px] h-[3px] w-[3px] rounded-full ' +
                      (isSelected ? 'bg-black/60' : 'bg-white/60')
                    }
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* --------------------------- day detail --------------------------- */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mb-1 flex-none text-[10px] uppercase tracking-wide text-white/30">
          {new Date(selected).toLocaleDateString([], {
            weekday: 'short', day: 'numeric', month: 'short',
          })}
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
          {dayList.length === 0 ? (
            <p className="py-2 text-[11px] text-white/25">Nothing scheduled.</p>
          ) : (
            <ul className="space-y-1">
              {dayList.map(({ at, reminder: r }) => {
                const past = at <= Date.now();
                const rep = repeatSummary(r.repeat);
                return (
                  <li
                    key={r.id + '-' + at}
                    className="group flex items-start gap-2 rounded-md bg-white/[0.04] px-2 py-1.5"
                  >
                    <span
                      className={
                        'mt-[2px] flex-none font-sans text-[10px] tabular-nums ' +
                        (past ? 'text-white/25' : 'text-white/55')
                      }
                    >
                      {fmtTime(at)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span
                        className={
                          'block break-words text-[11.5px] leading-snug ' +
                          (past ? 'text-white/35 line-through' : 'text-ink-text')
                        }
                      >
                        {r.text}
                      </span>
                      {(r.lead || rep) && (
                        <span className="mt-[2px] flex items-center gap-1.5 text-[9px] text-white/30">
                          {r.lead ? <span>{leadLabel(r.lead)}</span> : null}
                          {rep ? (
                            <span className="flex items-center gap-[3px]">
                              <Repeat className="h-[8px] w-[8px]" />
                              {rep}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </span>

                    <button
                      onClick={() => onDelete(r.id)}
                      title={rep ? 'Delete the whole series' : 'Delete'}
                      className="flex-none text-white/20 opacity-0 transition group-hover:opacity-100 hover:text-white/70"
                    >
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor"
                           strokeWidth="2.4" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ----------------------------- add ----------------------------- */}
        <form onSubmit={submit} className="mt-2 flex flex-none flex-col gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Remind me to…"
            maxLength={200}
            className={fieldClass + ' py-1.5 text-[11.5px] placeholder:text-white/25'}
          />

          <TimePicker value={time} onChange={setTime} />

          <Dropdown
            value={lead}
            onChange={setLead}
            options={LEADS}
            title="How far in advance to warn you"
          />

          <div className="flex gap-1.5">
            <Dropdown
              value={repeatType}
              onChange={setRepeatType}
              options={REPEATS}
              title="Repeat"
              className="min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="flex-none rounded-md border border-white/15 px-3 text-[11px] text-white/70
                         transition hover:bg-white/10 hover:text-ink-text disabled:opacity-25
                         disabled:hover:bg-transparent"
            >
              Set
            </button>
          </div>

          {repeatType === 'weekly' ? (
            <div className="flex gap-[3px]">
              {WEEKDAYS.map((d, i) => {
                const on = weekDays.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    title={'Repeat on ' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]}
                    className={
                      'h-[20px] flex-1 rounded text-[9.5px] transition ' +
                      (on ? 'bg-white/80 font-medium text-black' : 'bg-white/[0.06] text-white/45 hover:bg-white/15')
                    }
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          ) : null}

          {repeatType === 'monthly' ? (
            <p className="text-[9px] text-white/30">
              Repeats on the {new Date(selected).getDate()}
              {'  '}of each month, clamped in shorter ones.
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
