'use strict';

/**
 * GhostNote persistence.
 *
 * A single JSON document in the OS appData directory, written atomically
 * (tmp file -> fsync -> rename) so a crash or a power cut mid-save can never
 * leave a half-written file behind. The previous good copy is kept as .bak and
 * used automatically if the primary file ever fails to parse.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const MAX_PAGES = 24;
const EDGES = ['left', 'right', 'top', 'bottom'];

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function blankPage(title = 'Untitled') {
  const now = Date.now();
  return { id: newId(), title, body: '', createdAt: now, updatedAt: now };
}

function defaultData() {
  return {
    version: SCHEMA_VERSION,
    activeIndex: 0,
    pages: [blankPage('First Note')],
    dock: null,
    settings: { autostartInitialised: false },
  };
}

/**
 * Coerces whatever we read off disk into a shape the renderer can trust.
 * Never throws: a corrupt field is replaced, not fatal.
 */
function normalise(input) {
  const base = defaultData();
  if (!input || typeof input !== 'object') return base;

  const pages = Array.isArray(input.pages)
    ? input.pages
        .filter((p) => p && typeof p === 'object')
        .slice(0, MAX_PAGES)
        .map((p) => ({
          id: typeof p.id === 'string' && p.id ? p.id : newId(),
          title: typeof p.title === 'string' ? p.title : 'Untitled',
          body: typeof p.body === 'string' ? p.body : '',
          createdAt: Number.isFinite(p.createdAt) ? p.createdAt : Date.now(),
          updatedAt: Number.isFinite(p.updatedAt) ? p.updatedAt : Date.now(),
        }))
    : [];

  if (pages.length === 0) pages.push(blankPage('First Note'));

  // Which screen edge the widget clings to, and how far along that edge it
  // sits. `y` is accepted as a legacy alias for `pos` from earlier builds.
  const rawDock = input.dock;
  const rawPos =
    rawDock && (Number.isFinite(rawDock.pos) ? rawDock.pos : rawDock.y);

  const dock =
    rawDock && typeof rawDock === 'object' && Number.isFinite(rawPos)
      ? {
          edge: EDGES.includes(rawDock.edge) ? rawDock.edge : 'right',
          pos: Math.round(rawPos),
          collapsed: Boolean(rawDock.collapsed),
        }
      : null;

  return {
    version: SCHEMA_VERSION,
    activeIndex: Math.min(Math.max(0, Number(input.activeIndex) || 0), pages.length - 1),
    pages,
    dock,
    settings: {
      // Records that first-run autostart has been applied, so a user who
      // later switches it off doesn't get it switched back on next launch.
      autostartInitialised: Boolean(input.settings && input.settings.autostartInitialised),
    },
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'notes.json');
    this.backup = path.join(dir, 'notes.bak.json');
    this.data = null;
    this._timer = null;
    this._dirty = false;
  }

  /** Reads from disk once, then serves from memory. */
  load() {
    if (this.data) return this.data;

    for (const candidate of [this.file, this.backup]) {
      try {
        if (!fs.existsSync(candidate)) continue;
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        this.data = normalise(parsed);
        return this.data;
      } catch (err) {
        // Corrupt file: keep it around for forensics, then try the backup.
        try {
          fs.renameSync(candidate, `${candidate}.corrupt-${Date.now()}`);
        } catch (_) {
          /* best effort */
        }
      }
    }

    this.data = defaultData();
    return this.data;
  }

  /** Replaces the note document in memory and schedules a coalesced flush. */
  update(partial) {
    const current = this.load();
    const next = normalise({ ...current, ...partial });
    this.data = next;
    this._dirty = true;
    this._schedule();
    return next;
  }

  /** Debounces disk I/O so a fast typist causes one write, not fifty. */
  _schedule(delay = 400) {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), delay);
  }

  /** Writes immediately. Safe to call when nothing is pending. */
  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this._dirty || !this.data) return { ok: true, savedAt: null };

    const tmp = path.join(this.dir, `.notes.${process.pid}.tmp`);
    const payload = JSON.stringify(this.data, null, 2);

    try {
      fs.mkdirSync(this.dir, { recursive: true });

      const fd = fs.openSync(tmp, 'w');
      try {
        fs.writeFileSync(fd, payload, 'utf8');
        fs.fsyncSync(fd); // durability before the rename
      } finally {
        fs.closeSync(fd);
      }

      // Demote the current good file to .bak, then swap the new one in.
      if (fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.file, this.backup);
        } catch (_) {
          /* non-fatal */
        }
      }
      fs.renameSync(tmp, this.file); // atomic on both NTFS and POSIX

      this._dirty = false;
      return { ok: true, savedAt: Date.now() };
    } catch (err) {
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch (_) {
        /* best effort */
      }
      return { ok: false, error: err.message };
    }
  }
}

module.exports = { Store, blankPage, defaultData, SCHEMA_VERSION, MAX_PAGES };
