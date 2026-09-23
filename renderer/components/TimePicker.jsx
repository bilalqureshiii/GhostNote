'use client';

import Dropdown from './Dropdown';

/**
 * Hour / minute / meridiem, built from the same Dropdown as everything else.
 *
 * <input type="time"> hands its popup to Chromium, which paints its own blue
 * selection and cannot be themed from CSS. Value stays 24-hour "HH:MM" so the
 * rest of the form is unchanged.
 */

const HOURS = Array.from({ length: 12 }, (_, i) => {
  const h = i === 0 ? 12 : i;
  return { v: h, label: String(h).padStart(2, '0') };
});

// Five-minute steps: enough for anything you would schedule, short enough to
// pick without scrolling far.
const MINUTES = Array.from({ length: 12 }, (_, i) => ({
  v: i * 5,
  label: String(i * 5).padStart(2, '0'),
}));

const MERIDIEM = [
  { v: 'AM', label: 'AM' },
  { v: 'PM', label: 'PM' },
];

const pad = (n) => String(n).padStart(2, '0');

export default function TimePicker({ value, onChange }) {
  const [rawH, rawM] = (value || '09:00').split(':').map(Number);
  const h24 = Number.isFinite(rawH) ? rawH : 9;
  const minute = Number.isFinite(rawM) ? rawM : 0;

  const meridiem = h24 >= 12 ? 'PM' : 'AM';
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;

  // Snap to the nearest step so a value of :37 still highlights something.
  const snapped = Math.round(minute / 5) * 5 % 60;

  const emit = (h12, m, mer) => {
    const base = h12 % 12; // 12 AM -> 0, 12 PM -> 12
    onChange(pad(mer === 'PM' ? base + 12 : base) + ':' + pad(m));
  };

  return (
    <div className="flex gap-1.5">
      <Dropdown
        value={hour12}
        onChange={(v) => emit(v, snapped, meridiem)}
        options={HOURS}
        title="Hour"
        className="flex-1"
      />
      <Dropdown
        value={snapped}
        onChange={(v) => emit(hour12, v, meridiem)}
        options={MINUTES}
        title="Minute"
        className="flex-1"
      />
      <Dropdown
        value={meridiem}
        onChange={(v) => emit(hour12, snapped, v)}
        options={MERIDIEM}
        title="AM / PM"
        className="w-[62px] flex-none"
      />
    </div>
  );
}
