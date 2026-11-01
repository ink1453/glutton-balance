// 打包链路自测用的最小 Electron 应用（不是正式主程序；正式 main.js 由 Lead 写）
// 只用本文件验证：Electron runtime 复制 → 注入 app → Info.plist → 图标 → ad-hoc 签名 → 真机启动
const { app, BrowserWindow, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const argv = process.argv.slice(1);
const hasArg = (name) => argv.some((a) => a === name || a.startsWith(name + '='));
const argValue = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(name + '='));
  return hit ? hit.slice(name.length + 1) : dflt;
};

// 假装的 --quit：正式 main.js 用单实例锁实现，这里只要能退就行
if (hasArg('--quit')) {
  app.whenReady().then(() => {
    console.log('[dummy] --quit 收到，退出');
    app.exit(0);
  });
  process.exit(0);
}

app.setName('饭桶余额');

let win = null;

function log(...a) {
  const line = a.join(' ');
  console.log('[dummy]', line);
}

app.whenReady().then(async () => {
  log('electron=' + process.versions.electron, 'chrome=' + process.versions.chrome, 'node=' + process.versions.node);
  log('app.getVersion()=' + app.getVersion(), 'name=' + app.getName());
  log('resourcesPath=' + process.resourcesPath);
  log('screen=' + JSON.stringify(screen.getPrimaryDisplay().size) + ' scale=' + screen.getPrimaryDisplay().scaleFactor);

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: 260,
    height: 140,
    x: Math.max(0, Math.round(width / 2 - 130)),
    y: Math.max(40, Math.round(height / 2 - 70)),
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    win.showInactive();
    log('ready-to-show');
    // 打包链路自测：出图后退出
    if (hasArg('--smoke')) {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          const out = argValue('--smoke', '');
          if (out && out !== 'true') {
            fs.writeFileSync(out, img.toPNG());
            log('capturePage 已保存 ' + out + ' ' + JSON.stringify(img.getSize()));
          } else {
            log('capturePage ' + JSON.stringify(img.getSize()) + ' empty=' + img.isEmpty());
          }
        } catch (e) {
          log('capturePage 失败: ' + e.message);
        }
        setTimeout(() => {
          log('SMOKE-OK');
          app.exit(0);
        }, 300);
      }, 600);
    }
  });
  win.webContents.on('did-finish-load', () => log('did-finish-load'));
  win.webContents.on('render-process-gone', (_e, d) => log('render-process-gone ' + JSON.stringify(d)));
});

app.on('window-all-closed', () => app.quit());
process.on('uncaughtException', (e) => log('uncaughtException ' + e.message));
