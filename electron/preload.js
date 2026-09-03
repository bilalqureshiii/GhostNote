'use strict';

/**
 * The only bridge between the renderer and Node. contextIsolation is on and
 * nodeIntegration is off, so the UI sees exactly the seven functions below and
 * nothing else — no `require`, no `fs`, no ipcRenderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostnote', {
  // --- data ---------------------------------------------------------------
  /** @returns {Promise<{version:number,activeIndex:number,pages:Array}>} */
  load: () => ipcRenderer.invoke('notes:load'),

  /** Persist the whole document. Debounced again in main. */
  save: (data) => ipcRenderer.invoke('notes:save', data),

  /** @returns {Promise<string>} absolute path of the JSON file, for the UI to show. */
  dataPath: () => ipcRenderer.invoke('notes:path'),

  revealDataFolder: () => ipcRenderer.invoke('notes:reveal'),

  // --- window -------------------------------------------------------------
  hide: () => ipcRenderer.invoke('window:hide'),
  quit: () => ipcRenderer.invoke('window:quit'),
  setOpacity: (value) => ipcRenderer.invoke('window:opacity', value),

  // --- docking ------------------------------------------------------------
  /** @returns {Promise<{edge:'left'|'right', collapsed:boolean}>} */
  getDock: () => ipcRenderer.invoke('dock:get'),
  collapse: () => ipcRenderer.invoke('dock:collapse'),
  expand: () => ipcRenderer.invoke('dock:expand'),
  toggleCollapse: () => ipcRenderer.invoke('dock:toggle'),
  setEdge: (edge) => ipcRenderer.invoke('dock:setEdge', edge),

  /** Fires whenever the widget re-docks or folds. Drives the fold animation. */
  onDock: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('ghostnote:dock', listener);
    return () => ipcRenderer.removeListener('ghostnote:dock', listener);
  },

  // --- events from main ---------------------------------------------------
  /** Tray "New page" and other main-side commands arrive here. */
  onCommand: (handler) => {
    const listener = (_event, command) => handler(command);
    ipcRenderer.on('ghostnote:command', listener);
    return () => ipcRenderer.removeListener('ghostnote:command', listener);
  },

  platform: process.platform,
});
