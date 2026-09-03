'use strict';

/**
 * GhostNote — main process.
 *
 * Owns the frameless/transparent widget, its four-sided edge dock, the tray,
 * the global hotkey, and the IPC surface the renderer uses to read/write notes.
 */

const electron = require('electron');

// If Electron booted as plain Node (ELECTRON_RUN_AS_NODE=1, which VS Code and
// Antigravity set in their integrated terminals) the module above is a path
// string rather than the API object. Fail loudly instead of on `app.whenReady`.
if (typeof electron === 'string' || !electron.app) {
  process.stderr.write(
    '\n  ghostnote: Electron started in Node mode, so the desktop API is unavailable.\n' +
      '  ELECTRON_RUN_AS_NODE is set in this environment (common inside IDE terminals).\n' +
      '  Launch with the `ghostnote` command, which scrubs it, rather than `electron .`.\n\n'
  );
  process.exit(1);
}

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  globalShortcut,
  shell,
  screen,
  nativeImage,
  protocol,
  net,
} = electron;
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Store, MAX_PAGES } = require('./store');

const RENDERER_OUT = path.join(__dirname, '..', 'renderer', 'out');

// The panel reshapes to suit the edge it hangs from: portrait down the sides,
// landscape along the top and bottom.
const PORTRAIT = { width: 380, height: 480 };
const LANDSCAPE = { width: 620, height: 300 };

// Folded state: a slim tab lying flush along the docked edge.
const TAB_THICK = 22; // depth into the screen — thin, but still grabbable
const TAB_LENGTH = 120; // run along the edge

const SNAP_MS = 240; // magnet settle
const FOLD_MS = 300; // must match the renderer's fold
const MAGNET_PX = 70; // pull toward start/centre/end of the edge
const EDGE_HYSTERESIS = 40; // stops corner flicker between two close edges

const EDGES = ['left', 'right', 'top', 'bottom'];
const HOTKEY = 'CommandOrControl+Shift+Space';
const ASSETS = path.join(__dirname, 'assets');

// Transparent windows must not be GPU-composited away on some Windows drivers.
app.commandLine.appendSwitch('enable-transparent-visuals');

// Next's static export references its chunks by absolute path (/_next/...),
// which breaks under file://. Serving the export from a privileged custom
// scheme makes those paths resolve, and keeps a secure context so the renderer
// still gets crypto.randomUUID and friends.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ghostnote',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

let win = null;
let tray = null;
let store = null;
let isQuitting = false;

/**
 * Live dock state.
 *   edge — which screen side we cling to
 *   pos  — offset along that edge (y for left/right, x for top/bottom)
 */
let dock = { edge: 'right', pos: 0, collapsed: false };
let tweenTimer = null;
let dragTimer = null;

// ---------------------------------------------------------------------------
// Single instance
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

app.on('second-instance', (_event, argv) => {
  if (argv.includes('--quit')) {
    quitApp();
    return;
  }
  if (argv.includes('--new')) send('new-page');
  showWidget();
});

// ---------------------------------------------------------------------------
// Docking geometry
//
// The widget is never free-floating. Whichever of the four edges the cursor is
// nearest, the window is pinned to it: the perpendicular axis is locked and
// only the parallel axis follows the drag.
// ---------------------------------------------------------------------------

/** True when the widget lies along a horizontal edge, so it slides in X. */
function isHorizontal(edge) {
  return edge === 'top' || edge === 'bottom';
}

function currentArea() {
  if (win && !win.isDestroyed()) return screen.getDisplayMatching(win.getBounds()).workArea;
  return screen.getPrimaryDisplay().workArea;
}

/** Window size for a dock state — both panel and tab rotate with the edge. */
function sizeFor(state) {
  if (state.collapsed) {
    return isHorizontal(state.edge)
      ? { width: TAB_LENGTH, height: TAB_THICK }
      : { width: TAB_THICK, height: TAB_LENGTH };
  }
  return isHorizontal(state.edge) ? { ...LANDSCAPE } : { ...PORTRAIT };
}

/**
 * setBounds wrapper. resizable:false blocks programmatic resizes on Windows,
 * so lift the constraint for the instant it takes to apply new bounds.
 */
function applyBounds(target) {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const resizing = b.width !== target.width || b.height !== target.height;
  if (resizing) win.setResizable(true);
  win.setBounds(target);
  if (resizing) win.setResizable(false);
}

const clamp = (v, lo, hi) => Math.round(Math.min(Math.max(v, lo), hi));

/** Absolute bounds for a dock state — flush against the edge, no gap. */
function boundsFor(state, area = currentArea()) {
  const { width, height } = sizeFor(state);

  if (isHorizontal(state.edge)) {
    return {
      width,
      height,
      x: clamp(state.pos, area.x, area.x + area.width - width),
      y: state.edge === 'top' ? area.y : area.y + area.height - height,
    };
  }
  return {
    width,
    height,
    x: state.edge === 'left' ? area.x : area.x + area.width - width,
    y: clamp(state.pos, area.y, area.y + area.height - height),
  };
}

/**
 * Nearest edge to the *cursor*, not to the window.
 *
 * Measuring from the window is unworkable while it is pinned: its distance to
 * the docked edge is permanently width/2 (190px), which no other edge can beat
 * because the panel's own half-height is 240px. The top edge was therefore
 * unreachable. The cursor has no such bias — you point at an edge, you get it.
 */
function nearestEdgeToCursor(cursor, area) {
  const gap = {
    left: cursor.x - area.x,
    right: area.x + area.width - cursor.x,
    top: cursor.y - area.y,
    bottom: area.y + area.height - cursor.y,
  };

  const closest = EDGES.reduce((best, e) => (gap[e] < gap[best] ? e : best), dock.edge);

  // Hysteresis: near a corner two edges are almost equidistant, and a bare
  // comparison would flicker between them. Demand a clear win to switch.
  if (closest !== dock.edge && gap[closest] > gap[dock.edge] - EDGE_HYSTERESIS) {
    return dock.edge;
  }
  return closest;
}

/** easeOutCubic bounds tween. Electron has no built-in animator on Windows. */
function tweenTo(target, duration, onDone) {
  if (!win || win.isDestroyed()) return;
  if (tweenTimer) clearInterval(tweenTimer);

  const start = win.getBounds();
  const t0 = Date.now();

  // resizable:false blocks programmatic resizes on Windows, so lift it briefly.
  win.setResizable(true);

  tweenTimer = setInterval(() => {
    if (!win || win.isDestroyed()) {
      clearInterval(tweenTimer);
      tweenTimer = null;
      return;
    }
    const p = Math.min(1, (Date.now() - t0) / duration);
    const e = 1 - Math.pow(1 - p, 3);

    win.setBounds({
      x: Math.round(start.x + (target.x - start.x) * e),
      y: Math.round(start.y + (target.y - start.y) * e),
      width: Math.round(start.width + (target.width - start.width) * e),
      height: Math.round(start.height + (target.height - start.height) * e),
    });

    if (p >= 1) {
      clearInterval(tweenTimer);
      tweenTimer = null;
      win.setResizable(false);
      if (onDone) onDone();
    }
  }, 8);
}

/**
 * Constrains an in-progress OS drag. The window cannot be released in open
 * space: it re-pins to whichever edge the cursor is nearest, and switches
 * edges live as you cross the screen's midlines.
 */
function constrainDrag(event, newBounds) {
  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;

  const edge = nearestEdgeToCursor(cursor, area);
  const size = sizeFor({ ...dock, edge });

  // Turning a corner swaps which axis is free, so the old offset is meaningless
  // in the new orientation — recentre on the cursor instead of inheriting it.
  const turned = isHorizontal(edge) !== isHorizontal(dock.edge);
  const pos = turned
    ? isHorizontal(edge)
      ? cursor.x - size.width / 2
      : cursor.y - size.height / 2
    : isHorizontal(edge)
      ? newBounds.x
      : newBounds.y;

  const next = { edge, pos: Math.round(pos), collapsed: dock.collapsed };
  const target = boundsFor(next, area);

  const b = win.getBounds();
  if (
    newBounds.x !== target.x ||
    newBounds.y !== target.y ||
    b.width !== target.width ||
    b.height !== target.height
  ) {
    event.preventDefault();
    applyBounds(target); // may also reshape, if we just turned a corner
  }

  const edgeChanged = edge !== dock.edge;
  dock = next;
  if (edgeChanged) notifyDock(); // renderer re-orients corners, chevron and hinge
}

/** Applies the magnet once the drag settles, then persists. */
function settleDock() {
  if (!win || win.isDestroyed()) return;

  const area = currentArea();
  const size = sizeFor(dock);
  const b = win.getBounds();

  const horizontal = isHorizontal(dock.edge);
  const start = horizontal ? area.x : area.y;
  const span = horizontal ? area.width : area.height;
  const length = horizontal ? size.width : size.height;

  const anchors = [start, Math.round(start + (span - length) / 2), start + span - length];
  let pos = horizontal ? b.x : b.y;
  for (const a of anchors) {
    if (Math.abs(pos - a) <= MAGNET_PX) {
      pos = a;
      break;
    }
  }

  dock = { ...dock, pos };
  const target = boundsFor(dock, area);
  if (target.x !== b.x || target.y !== b.y) tweenTo(target, SNAP_MS);

  updateTrayMenu();
  store.update({ dock });
}

/** Folds the panel into its edge, or unfolds it back out. */
function setCollapsed(next, animate = true) {
  if (!win || win.isDestroyed() || dock.collapsed === next) return;

  const area = currentArea();
  const before = win.getBounds();
  const horizontal = isHorizontal(dock.edge);

  // Fold about the panel's midpoint so the tab lands centred on it.
  const centre = horizontal
    ? before.x + before.width / 2
    : before.y + before.height / 2;
  const nextSize = sizeFor({ ...dock, collapsed: next });
  const length = horizontal ? nextSize.width : nextSize.height;

  dock = { ...dock, collapsed: next, pos: Math.round(centre - length / 2) };

  // Tell the renderer first so its fold runs alongside the bounds tween.
  notifyDock();
  const target = boundsFor(dock, area);
  if (animate) tweenTo(target, FOLD_MS);
  else win.setBounds(target);

  store.update({ dock });
}

function dockTo(edge) {
  if (!EDGES.includes(edge)) return;
  showWidget();

  // Re-centre along the new edge rather than carrying a stale offset over.
  const area = currentArea();
  const size = sizeFor({ ...dock, edge });
  const horizontal = isHorizontal(edge);
  const pos = horizontal
    ? Math.round(area.x + (area.width - size.width) / 2)
    : Math.round(area.y + (area.height - size.height) / 2);

  dock = { ...dock, edge, pos };
  tweenTo(boundsFor(dock, area), SNAP_MS);
  notifyDock();
  store.update({ dock });
}

function notifyDock() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('ghostnote:dock', { edge: dock.edge, collapsed: dock.collapsed });
  }
  updateTrayMenu(); // keeps the Dock To radio buttons honest
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

const hasExport = () => fs.existsSync(path.join(RENDERER_OUT, 'index.html'));

// Everything the UI needs ships inside the export; nothing is fetched at
// runtime, so the policy can stay tight. 'unsafe-inline' covers Next's
// hydration bootstrap and the styles it inlines.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Maps ghostnote://app/<path> onto the static export, refusing escapes. */
function registerProtocol() {
  protocol.handle('ghostnote', async (request) => {
    const { pathname } = new URL(request.url);
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';

    const target = path.join(RENDERER_OUT, rel);
    const root = path.resolve(RENDERER_OUT);

    // Directory traversal guard: never serve outside the export.
    if (!path.resolve(target).startsWith(root)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Next exports routes as `/about` -> `about.html`.
    const file = fs.existsSync(target) ? target : `${target}.html`;
    if (!fs.existsSync(file)) return new Response('Not found', { status: 404 });

    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: res.status, headers });
  });
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = store.load().dock;

  // Default: docked right, vertically centred.
  dock = saved || {
    edge: 'right',
    pos: Math.round(area.y + (area.height - PORTRAIT.height) / 2),
    collapsed: false,
  };

  const { x, y, width, height } = boundsFor(dock, area);

  win = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false, // revealed on ready-to-show to avoid a white flash
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false, // a real shadow would box the rounded corners on Windows
    backgroundColor: '#00000000',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });

  // 'screen-saver' outranks other topmost windows, including most fullscreen apps.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // The built UI when it exists, otherwise the pre-Phase-3 stub.
  if (hasExport()) win.loadURL('ghostnote://app/index.html');
  else win.loadFile(path.join(__dirname, 'placeholder.html'));

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    notifyDock(); // renderer needs the edge to orient itself
  });

  // Closing (Esc, the UI button, Alt+F4) hides. Only the tray truly quits.
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  // Glue the widget to an edge for the whole duration of the drag.
  win.on('will-move', (event, newBounds) => {
    if (tweenTimer) return; // our own tween is driving; don't fight it
    constrainDrag(event, newBounds);
  });

  // 'moved' fires repeatedly on Windows, so debounce to find the resting spot.
  win.on('moved', () => {
    if (tweenTimer) return;
    if (dragTimer) clearTimeout(dragTimer);
    dragTimer = setTimeout(() => {
      dragTimer = null;
      settleDock();
    }, 180);
  });

  // External links open in the real browser, never inside the widget.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.argv.includes('--devtools')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

function showWidget() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  win.show();
  win.focus();
}

function toggleWidget() {
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) win.hide();
  else showWidget();
}

function send(command) {
  if (win && !win.isDestroyed()) win.webContents.send('ghostnote:command', command);
}

function quitApp() {
  isQuitting = true;
  store.flush(); // never lose the last keystroke
  app.quit();
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
/** Rebuilt on every dock change so the radio state matches reality. */
function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / Hide', click: toggleWidget },
      { label: 'New Page', click: () => { showWidget(); send('new-page'); } },
      { type: 'separator' },
      {
        label: 'Dock To',
        submenu: EDGES.map((e) => ({
          label: e[0].toUpperCase() + e.slice(1),
          type: 'radio',
          checked: dock.edge === e,
          click: () => dockTo(e),
        })),
      },
      { label: 'Fold / Unfold', click: () => { showWidget(); setCollapsed(!dock.collapsed); } },
      { type: 'separator' },
      { label: `Toggle:  ${HOTKEY.replace('CommandOrControl', 'Ctrl')}`, enabled: false },
      { label: 'Open Data Folder', click: () => shell.showItemInFolder(store.file) },
      { type: 'separator' },
      { label: 'Quit GhostNote', click: quitApp },
    ])
  );
}

function createTray() {
  const image = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('GhostNote');
  tray.on('click', toggleWidget);
  updateTrayMenu();
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('notes:load', () => store.load());

  ipcMain.handle('notes:save', (_event, incoming) => {
    if (!incoming || typeof incoming !== 'object') return { ok: false, error: 'invalid payload' };
    const pages = Array.isArray(incoming.pages) ? incoming.pages.slice(0, MAX_PAGES) : undefined;
    store.update({
      ...(pages ? { pages } : {}),
      ...(Number.isFinite(incoming.activeIndex) ? { activeIndex: incoming.activeIndex } : {}),
    });
    return { ok: true, queuedAt: Date.now() };
  });

  ipcMain.handle('notes:path', () => store.file);
  ipcMain.handle('notes:reveal', () => shell.showItemInFolder(store.file));

  ipcMain.handle('window:hide', () => {
    if (win && !win.isDestroyed()) win.hide();
  });
  ipcMain.handle('window:quit', () => quitApp());

  ipcMain.handle('window:opacity', (_event, value) => {
    const v = Number(value);
    if (win && !win.isDestroyed() && Number.isFinite(v)) {
      win.setOpacity(Math.min(1, Math.max(0.3, v)));
    }
  });

  // --- docking ---
  ipcMain.handle('dock:get', () => ({ edge: dock.edge, collapsed: dock.collapsed }));
  ipcMain.handle('dock:collapse', () => setCollapsed(true));
  ipcMain.handle('dock:expand', () => setCollapsed(false));
  ipcMain.handle('dock:toggle', () => setCollapsed(!dock.collapsed));
  ipcMain.handle('dock:setEdge', (_event, edge) => dockTo(edge));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // Keeps the widget out of the Windows taskbar / macOS dock entirely.
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  store = new Store(app.getPath('userData'));
  store.load();

  registerProtocol();
  registerIpc();
  createWindow();
  createTray();

  if (!globalShortcut.register(HOTKEY, toggleWidget)) {
    console.warn(`[ghostnote] hotkey ${HOTKEY} is already taken by another app.`);
  }

  app.on('activate', showWidget);
});

// The widget lives in the tray, so a hidden window must not end the process.
app.on('window-all-closed', (event) => {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
});

app.on('before-quit', () => {
  isQuitting = true;
  store.flush();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
