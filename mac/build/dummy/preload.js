// 打包链路自测用的 preload（验证 contextIsolation 桥可用，不是正式 preload.js）
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('dummy', {
  ping: () => 'pong',
  hasElectron: typeof process !== 'undefined' && !!process.versions && !!process.versions.electron,
});
