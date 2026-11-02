#!/usr/bin/env node
'use strict';
/**
 * app/main.js · headless 冒烟（不启动 Electron、不建窗口、不碰 GUI/显示窗）
 *
 * 用 test/fixtures/electron-stub 里的假 electron 模块（NODE_PATH 注入），在纯 node 下加载
 * app/main.js 并跑 `--selftest`（该模式本来就不开窗，只算布局 JSON）。
 * 验证：main.js 模块级代码 + loadConfig + 自测路径能跑通、无语法/运行期错误（改代码后防回归）。
 *
 * 用法：node app/test/main-selftest-smoke.js
 * 退出码：0=通过；1=失败
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const STUB_DIR = path.join(__dirname, 'fixtures', 'electron-stub');
const OUT = path.join(os.tmpdir(), 'pbp-a4-selftest-' + process.pid + '.json');
const LOG = path.join(os.tmpdir(), 'pbp-a4-selftest-' + process.pid + '.log');

function cleanup() {
  for (const p of [OUT, LOG]) { try { fs.unlinkSync(p); } catch (e) { /* ignore */ } }
}
function fail(msg, extra) {
  console.log('\n❌ headless 冒烟失败：' + msg);
  if (extra) console.log(String(extra).trim().slice(0, 2000));
  cleanup();
  process.exit(1);
}

const env = Object.assign({}, process.env, {
  NODE_PATH: STUB_DIR + (process.env.NODE_PATH ? ':' + process.env.NODE_PATH : ''),
  GLUTTONBALANCE_PANEL_LOG: LOG, // 不写正式 panel.log
  GLUTTONBALANCE_PANEL_DIR: path.join(os.tmpdir(), 'pbp-a4-selftest-dir-' + process.pid), // 配置目录也指到临时目录，不碰真实用户目录、不触发旧目录迁移
});
delete env.ELECTRON_RUN_AS_NODE; // DSH 会话环境带该变量；纯 node 自测要清掉

console.log('== app/main.js headless 冒烟（假 electron 模块，不启动 GUI）==');
const r = spawnSync(process.execPath, [path.join(APP_DIR, 'main.js'), '--selftest', OUT], {
  env: env, encoding: 'utf8', timeout: 30000, cwd: APP_DIR,
});
const stdout = String(r.stdout || '');
if (r.error) fail('无法启动 node：' + r.error.message);
if (r.status !== 0) fail('main.js --selftest 退出码 ' + r.status, stdout + '\n' + String(r.stderr || ''));
if (!/selftest\s*->/.test(stdout)) fail('stdout 里没有 "selftest ->" 标记', stdout);

let j = null, parseErr = '';
try { j = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { parseErr = e.message; }
cleanup(); // 先读入内存再清临时文件
if (!j) fail('自测 JSON 未生成/无法读取：' + parseErr, stdout);

const checks = [];
function ok(name, cond, detail) {
  checks.push({ name: name, pass: !!cond, detail: detail || '' });
  if (!cond) fail(name + (detail ? '（' + detail + '）' : ''));
}
ok('自测 JSON 可解析且 tool=authored-selftest', j.tool === 'authored-selftest', 'tool=' + j.tool);
ok('应用名/版本存在', j.app === '饭桶余额' && !!j.version, j.app + ' ' + j.version);
ok('布局用例 3×3×2×4=72 个', Array.isArray(j.cases) && j.cases.length === 72, 'cases=' + (j.cases || []).length);
ok('家数边界 2..9 段齐全', j.counts && [2, 3, 4, 5, 6, 7, 8, 9].every((n) => j.counts[n]), 'keys=' + Object.keys(j.counts || {}).join(','));
ok('匹配比例常量生效（graphicsScale p1≈0.9524）', Math.abs(j.graphicsScale.p1 - 0.9524) < 0.001, 'p1=' + j.graphicsScale.p1);
ok('头顶几何段存在', j.wear && Number.isFinite(j.wear.headPanelY), 'headPanelY=' + (j.wear || {}).headPanelY);
ok('运行平台信息存在', j.env && j.env.platform && j.env.node, JSON.stringify(j.env || {}));

// 临时文件清理确认
const leftovers = [OUT, LOG].filter((p) => fs.existsSync(p));
ok('临时文件已清理', leftovers.length === 0, leftovers.join(','));

console.log('✅ headless 冒烟通过（main.js 可加载、--selftest 正常、72 个布局用例、临时文件已清）');
