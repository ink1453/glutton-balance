'use strict';
// 日志：~/.dsh/pet-balance-panel/panel.log（与 Win 同路径口径）；256KB 自动轮转；绝不记录密钥/金额以外的隐私
const fs = require('fs');
const path = require('path');
const { userDir } = require('./config');

const MAX_BYTES = 256 * 1024;
let logPath = null;
let disabled = false;

function init(overridePath) {
  logPath = overridePath || process.env.PET_BALANCE_PANEL_LOG || path.join(userDir(), 'panel.log');
  try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); } catch (e) { /* ignore */ }
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > MAX_BYTES) {
      try { fs.renameSync(logPath, logPath + '.1'); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
}

function write(msg) {
  if (disabled) return;
  if (!logPath) init();
  const line = `${new Date().toISOString()} ${msg}\n`;
  try { fs.appendFileSync(logPath, line); } catch (e) {
    if (e && e.code === 'EACCES') { disabled = true; }
  }
}

module.exports = { init, write, logPath: () => logPath };
