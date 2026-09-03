#!/usr/bin/env node
'use strict';

/**
 * GhostNote CLI entry point.
 *
 * Responsibility: locate the Electron binary that shipped with this package and
 * hand the app directory to it as a fully detached child process, so the
 * terminal that launched it can be closed immediately.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(APP_ROOT, 'package.json'));

const argv = process.argv.slice(2);

function has(...flags) {
  return flags.some((f) => argv.includes(f));
}

if (has('-h', '--help')) {
  process.stdout.write(
    `\n  ghostnote v${pkg.version} — floating note widget\n\n` +
      `  Usage:\n` +
      `    ghostnote                launch the widget, or reveal it if already running\n` +
      `    ghostnote --new          launch/reveal and start a new note page\n` +
      `    ghostnote --quit         fully quit a running widget\n` +
      `    ghostnote --debug        launch attached, streaming main/renderer logs to this terminal\n` +
      `    ghostnote --devtools     launch detached with DevTools opened\n` +
      `\n  Once running:  Ctrl+Shift+Space toggles it  ·  tray icon -> Quit GhostNote\n` +
      `    ghostnote --version      print version\n` +
      `    ghostnote --help         show this message\n\n`
  );
  process.exit(0);
}

if (has('-v', '--version')) {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

/**
 * `require('electron')` from a plain Node process resolves to the absolute path
 * of the platform's Electron executable (that is the documented behaviour of
 * the electron npm package's index.js). We fall back to reading dist/path.txt
 * manually in case that shim ever changes shape.
 */
function resolveElectronBinary() {
  try {
    const resolved = require('electron');
    if (typeof resolved === 'string' && fs.existsSync(resolved)) return resolved;
  } catch (_) {
    /* fall through to manual resolution */
  }

  try {
    const electronPkgDir = path.dirname(
      require.resolve('electron/package.json', { paths: [APP_ROOT] })
    );
    const pathTxt = path.join(electronPkgDir, 'path.txt');
    if (fs.existsSync(pathTxt)) {
      const exe = fs.readFileSync(pathTxt, 'utf8').trim();
      const full = path.join(electronPkgDir, 'dist', exe);
      if (fs.existsSync(full)) return full;
    }
  } catch (_) {
    /* fall through to the error below */
  }

  return null;
}

const electronBinary = resolveElectronBinary();

if (!electronBinary) {
  process.stderr.write(
    '\n  ghostnote: could not locate the Electron runtime.\n' +
      '  Try reinstalling the package:  npm install -g ghostnote\n' +
      '  (or, from a local checkout:    npm install)\n\n'
  );
  process.exit(1);
}

// Flags we forward to the app itself rather than consume here.
const forwarded = argv.filter((a) => a !== '--debug' && a !== '-d');
const debug = has('-d', '--debug');

const electronArgs = [APP_ROOT, ...forwarded];

/**
 * Build a clean environment for the child.
 *
 * Critical: VS Code, Antigravity, Cursor and other Electron-based IDEs export
 * ELECTRON_RUN_AS_NODE=1 into their integrated terminals. If that leaks into
 * our child, electron.exe boots as a plain Node process, the built-in
 * `electron` module never registers, and main.js dies on `app` being undefined.
 * Same story for NODE_OPTIONS, which those IDEs use to inject debug hooks.
 */
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
delete childEnv.NODE_OPTIONS;
delete childEnv.ELECTRON_NO_ASAR;
childEnv.GHOSTNOTE_LAUNCHED_FROM_CLI = '1';
if (!debug) {
  // Keeps Electron from attaching a console window on Windows.
  childEnv.ELECTRON_NO_ATTACH_CONSOLE = '1';
}

const child = spawn(electronBinary, electronArgs, {
  cwd: APP_ROOT,
  // Detached in normal mode so the widget outlives this shell. In debug mode we
  // deliberately stay attached so Ctrl+C and log output behave as expected.
  detached: !debug,
  stdio: debug ? 'inherit' : 'ignore',
  windowsHide: true,
  env: childEnv,
});

child.on('error', (err) => {
  process.stderr.write(`\n  ghostnote: failed to start Electron — ${err.message}\n\n`);
  process.exit(1);
});

if (debug) {
  child.on('exit', (code) => process.exit(code == null ? 0 : code));
} else {
  // Sever the last reference so this Node process can exit right away.
  child.unref();
  process.exit(0);
}
