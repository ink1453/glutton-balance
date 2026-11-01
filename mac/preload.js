'use strict';
// 渲染进程 ↔ 主进程 桥（contextIsolation）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pbp', {
  onInit: (cb) => ipcRenderer.on('pbp:init', (_e, data) => { try { cb(data); } catch (err) { /* ignore */ } }),
  onState: (cb) => ipcRenderer.on('pbp:state', (_e, s) => { try { cb(s); } catch (err) { /* ignore */ } }),
  ready: () => ipcRenderer.send('pbp:ready'),
  rendered: (seq) => ipcRenderer.send('pbp:rendered', seq),
  click: (x, y) => ipcRenderer.send('pbp:click', { x, y }),
  hover: (inside) => ipcRenderer.send('pbp:hover', !!inside),
  log: (msg) => ipcRenderer.send('pbp:log', String(msg)),
});

contextBridge.exposeInMainWorld('pbpGuide', {
  openSettings: (which) => ipcRenderer.send('guide:open-settings', which),
  retry: () => ipcRenderer.send('guide:retry'),
  onStatus: (cb) => ipcRenderer.on('guide:status', (_e, s) => { try { cb(s); } catch (err) { /* ignore */ } }),
});
