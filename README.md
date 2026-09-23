# GhostNote

A frameless, always-on-top note widget you launch from your terminal. It docks
to the edge of your screen, folds away when you don't need it, and saves every
keystroke on its own.

```bash
npm install -g https://github.com/bilalqureshiii/GhostNote/releases/download/v0.1.0/ghostnote-0.1.0.tgz
ghostnote
```

Close the terminal — the widget stays.

> **Requires Node 18+.** GhostNote isn't on the npm registry yet, so install it
> from the [latest release](https://github.com/bilalqureshiii/GhostNote/releases/latest).
> Once it's published, `npm install -g ghostnote` will do the same thing.

---

## Why

Quick notes usually mean opening an app, finding a window, and remembering to
save. GhostNote is a bubble stuck to the side of your screen: press a hotkey,
type, and forget about it.

- **Edge-docked.** It clings to the left, right, top or bottom of your screen
  and can't be dropped in the middle. Portrait down the sides, landscape along
  the top and bottom.
- **Folds away.** One click hinges it into the screen edge, leaving a slim tab.
- **Always on top**, no title bar, no taskbar entry.
- **No save button.** Every keystroke is debounced and written to a local JSON
  file atomically.
- **Multiple pages** you turn like a book.

## Usage

```bash
ghostnote                      # launch, or reveal a running widget
ghostnote --new                # launch and start a new page
ghostnote --quit               # fully quit a running widget
ghostnote --disable-autostart  # stop launching at login
ghostnote --enable-autostart   # launch at login again
ghostnote --debug              # run attached, with logs in the terminal
ghostnote --devtools           # open DevTools
```

### Starting with your computer

The first launch registers GhostNote to start with your OS, so the terminal is
a one-time step — after a restart it reappears on the same edge, on the same
page, with all your notes. Turn it off from the tray menu (**Start With
Windows**) or with `ghostnote --disable-autostart`; the choice sticks.

Once it's running it lives in your system tray. Right-click the tray icon to
dock it, fold it, open the data folder, or quit.

### Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+Space` | Show / hide from anywhere (global) |
| `Ctrl+N` | New page |
| `Alt+←` / `Alt+→` | Previous / next page |
| `Ctrl+Shift+←↑→↓` | Dock to that edge |
| `Ctrl+\` | Fold / unfold |
| `Esc` | Hide |

### Moving it

Drag the header. The widget stays glued to an edge and slides along it; point
your cursor at a different edge to send it there. When folded, drag the tab.

## Where notes live

A single JSON file in your OS app-data directory:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\ghostnote\notes.json` |
| macOS | `~/Library/Application Support/ghostnote/notes.json` |
| Linux | `~/.config/ghostnote/notes.json` |

Writes go to a temp file, are `fsync`'d, then renamed over the original, so an
interrupted save can't corrupt your notes. The previous good copy is kept as
`notes.bak.json` and restored automatically if the main file is ever unreadable.

## Development

```bash
git clone https://github.com/bilalqureshiii/GhostNote.git
cd GhostNote
npm install          # Electron (runtime)
npm run ui:install   # Next.js, React, Tailwind, GSAP (build-time only)

npm run dev          # build the UI, then launch attached with logs
npm run build        # rebuild the UI only
npm link             # expose `ghostnote` globally from this checkout
```

### Layout

```
bin/cli.js         detached spawn of the Electron binary
electron/
  main.js          window, four-edge dock, tray, hotkey, IPC
  store.js         atomic JSON persistence
  preload.js       the only Node surface the UI can see
renderer/          Next.js app, static-exported to renderer/out/
```

The UI is a Next.js static export served to Electron over a custom
`ghostnote://` protocol — Next emits absolute `/_next/...` asset paths, which
`file://` can't resolve. `contextIsolation` is on, `nodeIntegration` is off, and
the renderer talks to the main process only through the preload bridge.

## License

MIT
