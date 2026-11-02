#!/usr/bin/env node
'use strict';
/**
 * R-49 回归：无「屏幕录制」授权时，petprobe 只启动一次、不自动重启。
 *
 * 背景（2026-11-02 20:35 事故）：访达身份变更（bundle id 改名）后 TCC 授权失效，
 * App 明知无授权仍启动 petprobe，petprobe 每 125ms 请求一次录屏权限 → 系统弹窗 +
 * tccd 日志风暴。R-49 要求：无授权不启动 / 启动后也只做 CGPreflight、不调 SCK、
 * 不秒级自动重启。
 *
 * 本测试用假 petprobe（只输出一行 no-screen-permission 后退出）验证 PetLocator：
 *   1) permDenied 被置位；
 *   2) 退出后 1s 的自动重启被跳过（总启动次数 = 1）；
 *   3) 显式 stop()→start() 会重置 permDenied 并允许再试一次（总启动次数 = 2，仍不连环重启）。
 *
 * 用法：node test/petinfo-perm-r49.js  → 退出码 0=通过 / 1=失败
 * 不启动 Electron、不碰 GUI、不读写真实用户目录（日志/配置目录都指向临时目录）。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pbp-r49-test-'));
const FAKE = path.join(TMP, 'fake-petprobe.sh');
const COUNT = path.join(TMP, 'spawn-count.txt');
const LOG = path.join(TMP, 'panel.log');
const DIR = path.join(TMP, 'panel-dir');

fs.writeFileSync(FAKE, [
  '#!/bin/bash',
  `echo spawn >> ${JSON.stringify(COUNT)}`,
  `printf '{"ok":false,"reason":"no-screen-permission","preflight":"false"}\\n'`,
  'exit 0',
  '',
].join('\n'), { mode: 0o755 });

const env = Object.assign({}, process.env, {
  GLUTTONBALANCE_PANEL_LOG: LOG,
  GLUTTONBALANCE_PANEL_DIR: DIR,
});

const driver = `
const { PetLocator } = require(${JSON.stringify(path.join(APP_DIR, 'src/petinfo.js'))});
const loc = new PetLocator({ binary: ${JSON.stringify(FAKE)}, intervalMs: 125 });
loc.start();
setTimeout(() => {
  const n1 = require('fs').readFileSync(${JSON.stringify(COUNT)}, 'utf8').trim().split('\\n').length;
  if (!loc.permDenied) { console.log('FAIL: permDenied 未置位'); process.exit(1); }
  if (n1 !== 1) { console.log('FAIL: 无授权时仍在自动重启，启动次数=' + n1); process.exit(1); }
  // 显式重试：应重置 permDenied 并只再启动一次（由外部动作触发，不是后台循环）
  loc.stop();
  loc.start();
  setTimeout(() => {
    const n2 = require('fs').readFileSync(${JSON.stringify(COUNT)}, 'utf8').trim().split('\\n').length;
    loc.stop();
    if (n2 !== 2) { console.log('FAIL: 显式重试后启动次数=' + n2 + '（期望 2）'); process.exit(1); }
    console.log('PASS: 无授权只启动 1 次、不自动重启；显式重试再启动 1 次（合计 2）');
    process.exit(0);
  }, 2200);
}, 2200);
`;

const r = spawnSync(process.execPath, ['-e', driver], { env, encoding: 'utf8', timeout: 15000 });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
process.exit(r.status === 0 ? 0 : 1);
