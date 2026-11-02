'use strict';
// 日志：~/.dsh/glutton-balance/panel.log（与 Win 同路径口径；旧目录首次启动自动迁移，见 src/config.js）
//
// 第 7 轮乙路（#4 安全 ③「日志脱敏 + 轮转」）改口径：
//  1) **每次写入前**判体积，超过 256 KB 立刻轮转，最多保留 3 份历史（panel.log.1 ~ .3）——
//     旧实现只在 init() 判一次，长跑会无限增长（实测 577 KB / 2.2 倍阈值）。
//  2) 新建文件用 600 权限；已存在的 644 日志在 init/写入时收敛为 600（只给属主读写）。
//  3) 写盘前统一二次脱敏：完整密钥、Bearer/Authorization 头的值、服务端回显的「****尾号」形态
//     一律打码——绝不让原始值或可回溯尾号落盘（旧实现只替换完整密钥）。
//  4) 本模块只写「分类码 / 状态码 / 金额 / 路径」这类结构化字段；不写响应体、不写 Authorization。
const fs = require('fs');
const path = require('path');
const { userDir } = require('./config');

const MAX_BYTES = 256 * 1024; // 单文件上限（与 Win 口径一致）
const BACKUPS = 3;            // 最多保留 panel.log.1 ~ .3
const FILE_MODE = 0o600;      // 新文件权限：仅属主可读写
const MAX_LINE_BYTES = 64 * 1024; // 单行兜底上限，防止一次写入把文件撑爆

let logPath = null;
let disabled = false;

// 脱敏规则：顺序从具体到宽泛；替换后保留「这里曾经有个凭据」的可读性（*** / ****）
const MASK_RULES = [
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, '$1***'],
  [/(Authorization\s*[:=]\s*)[^\s,;}]+/gi, '$1***'],
  [/\*{2,}[A-Za-z0-9_\-]{3,}/g, '****'],
  [/\b(sk|pk|ghp|gho|ghs|ghu|github_pat|npm|xoxa|xoxb|xoxp)[_-][A-Za-z0-9_\-]{6,}/g, '$1_***'],
  [/((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',;}]{6,}/gi, '$1***'],
];

/** 对一行文本做二次脱敏（导出给测试与排障用；幂等）。 */
function maskSensitive(text) {
  let s = String(text == null ? '' : text);
  for (const [re, rep] of MASK_RULES) s = s.replace(re, rep);
  return s;
}

function ensureFileMode(p) {
  try {
    const st = fs.statSync(p);
    if ((st.mode & 0o077) !== 0) fs.chmodSync(p, FILE_MODE);
  } catch (e) { /* 文件不存在/无权限：忽略 */ }
}

/** 超阈值就把 panel.log 轮转成 panel.log.1，旧份顺移，最旧一份丢弃；最多 BACKUPS 份。 */
function rotateIfNeeded() {
  if (!logPath) return false;
  let size = -1;
  try { size = fs.statSync(logPath).size; } catch (e) { return false; }
  if (size < MAX_BYTES) return false;
  try {
    try { fs.rmSync(logPath + '.' + BACKUPS, { force: true }); } catch (e) { /* ignore */ }
    for (let i = BACKUPS - 1; i >= 1; i--) {
      try { fs.renameSync(logPath + '.' + i, logPath + '.' + (i + 1)); } catch (e) { /* 该份不存在正常 */ }
    }
    fs.renameSync(logPath, logPath + '.1');
    ensureFileMode(logPath + '.1');
    return true;
  } catch (e) {
    return false;
  }
}

function init(overridePath) {
  // 新变量 GLUTTONBALANCE_PANEL_LOG 优先；旧变量 PET_BALANCE_PANEL_LOG 兼容回退（改名口径 2026-11-02）
  logPath = overridePath || process.env.GLUTTONBALANCE_PANEL_LOG || process.env.PET_BALANCE_PANEL_LOG || path.join(userDir(), 'panel.log');
  try { fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 }); } catch (e) { /* ignore */ }
  rotateIfNeeded(); // 兼容旧行为：启动时若已超阈值先轮转一次
  ensureFileMode(logPath);
  for (let i = 1; i <= BACKUPS; i++) ensureFileMode(logPath + '.' + i);
}

function write(msg) {
  if (disabled) return;
  if (!logPath) init();
  let line = `${new Date().toISOString()} ${maskSensitive(msg)}\n`;
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
    line = Buffer.from(line).subarray(0, MAX_LINE_BYTES).toString('utf8') + '\n';
  }
  rotateIfNeeded(); // 每次写入前判：运行中也会轮转，防无限增长
  try {
    fs.appendFileSync(logPath, line, { mode: FILE_MODE });
    ensureFileMode(logPath); // 已存在的 644 文件收敛为 600（仅当组/其他可读写）
  } catch (e) {
    if (e && e.code === 'EACCES') { disabled = true; }
  }
}

module.exports = {
  init,
  write,
  maskSensitive,
  rotateNow: rotateIfNeeded,
  logPath: () => logPath,
  MAX_BYTES,
  BACKUPS,
  FILE_MODE,
};
