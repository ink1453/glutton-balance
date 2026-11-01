'use strict';
// 仅本地自测用的 electron 假模块（headless）：不创建任何窗口、不弹任何 UI。
// 目的：让 app/main.js 在纯 node 下能加载并跑 `--selftest`（自测模式本来就不开窗）。
// 只在 app/test/main-selftest-smoke.js 里通过 NODE_PATH 注入，绝不进包、不影响正式运行。
const os = require('os');
const noop = () => {};
class BrowserWindow {
  constructor() {
    this.webContents = { on: noop, once: noop, send: noop, capturePage: async () => ({ isEmpty: () => true, getSize: () => ({ width: 1, height: 1 }), toPNG: () => Buffer.alloc(0) }) };
  }
  loadFile() { }
  on() { }
  once() { }
  showInactive() { }
  isDestroyed() { return false; }
  setSize() { }
  setPosition() { }
  getBounds() { return { x: 0, y: 0, width: 1, height: 1 }; }
  setIgnoreMouseEvents() { }
  setAlwaysOnTop() { }
  setVisibleOnAllWorkspaces() { }
}
const app = {
  requestSingleInstanceLock: () => true,
  whenReady: () => Promise.resolve(),
  on: noop,
  quit: () => process.exit(0),
  setName: noop,
  getPath: (n) => os.tmpdir(),
  dock: { hide: noop },
};
module.exports = {
  app,
  BrowserWindow,
  ipcMain: { on: noop, once: noop },
  screen: { getAllDisplays: () => [], getDisplayMatching: () => null, getPrimaryDisplay: () => ({ id: 0 }) },
  systemPreferences: { getMediaAccessStatus: () => 'granted' },
  shell: { openExternal: noop, openPath: () => 0 },
  Tray: class { constructor() { } setToolTip() { } setContextMenu() { } on() { } },
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({ setTemplateImage: noop }) },
  globalShortcut: { unregisterAll: noop, register: () => true },
};
