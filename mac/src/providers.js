'use strict';
// 余额来源：请求/解析/调度/退避（Win Panel.cs Net + ProviderRuntime 的跨平台移植）
// 四类：official（5 个预设）/ relay（new-api）/ custom（jsonPath）/ rice（大白饭，不联网）
const fs = require('fs');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const os = require('os');
const path = require('path');
const { expandPath } = require('./config');
const logger = require('./logger');

const UA = 'PetBalancePanel/1.0 (Mac)';
const KEY_FALLBACKS = ['A6_CONSOLE_TOKEN', 'A6_CONSOLE_API_KEY', 'A6API_KEY', 'A6_PROXY_KEY', 'A6_KEY', 'TOKEN', 'API_KEY'];
const OFFICIAL_URLS = {
  deepseek: 'https://api.deepseek.com/user/balance',
  kimi: 'https://api.moonshot.cn/v1/users/me/balance',
  siliconflow: 'https://api.siliconflow.cn/v1/user/info',
  stepfun: 'https://api.stepfun.com/v1/accounts',
  openrouter: 'https://openrouter.ai/api/v1/credits',
};

function round2(v) { return Math.round(v * 100) / 100; }

function resolvePath(obj, jsonPath) {
  if (!jsonPath) return undefined;
  let cur = obj;
  for (const part of String(jsonPath).split('.')) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(part)) cur = cur[Number(part)];
    else cur = cur[part];
  }
  return cur;
}

function getFirst(obj, keys) {
  for (const k of keys) {
    if (obj == null) return undefined;
    const v = obj[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.+-]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function httpGet(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('bad url: ' + url)); }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''), method: 'GET',
      headers: Object.assign({ 'User-Agent': UA, 'Accept': 'application/json', 'Connection': 'close' }, headers || {}),
      timeout: timeoutMs || 12000,
    }, (res) => {
      const chunks = [];
      let stream = res;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, body });
        else reject(new Error(`HTTP ${res.statusCode} ${body.slice(0, 160)}`));
      });
      stream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function readKeyFile(file) {
  try {
    const p = expandPath(file);
    if (!p) return { ok: false, error: 'empty path' };
    const text = fs.readFileSync(p, 'utf8');
    const map = {};
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const eq = s.indexOf('=');
      if (eq > 0) {
        const k = s.slice(0, eq).trim();
        let v = s.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        map[k] = v;
      }
    }
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return { ok: true, map, single: lines.length === 1 ? lines[0] : '', path: p };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/** 读取密钥（只进内存，绝不打印）。返回 {key, accountId, error} */
function loadKey(pc, forRelayAccount) {
  const ks = pc.keySource || {};
  const kind = ks.kind || 'file';
  const out = { key: '', accountId: '', error: '' };
  const varName = String(ks.var || '').trim();
  const tryNames = [];
  if (varName) tryNames.push(varName);
  for (const n of KEY_FALLBACKS) if (!tryNames.includes(n)) tryNames.push(n);

  if (kind === 'env') {
    for (const n of tryNames) {
      if (process.env[n]) { out.key = process.env[n]; break; }
    }
    return out;
  }
  const file = String(ks.file || '').trim();
  if (!file) {
    // 没给文件：退回环境变量（Win KeyLoader 行为）
    for (const n of tryNames) {
      if (process.env[n]) { out.key = process.env[n]; break; }
    }
    return out;
  }
  const r = readKeyFile(file);
  if (!r.ok) { out.error = r.error; return out; }
  for (const n of tryNames) {
    if (r.map && r.map[n]) { out.key = r.map[n]; break; }
  }
  if (!out.key && r.single && !varName) out.key = r.single;
  if (!out.key && r.single && varName && r.map[varName] === undefined) {
    // 单行文件：整行即 token（Win 口径）
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(r.single)) out.key = r.single;
  }
  // relay：a6User 为空时从同一文件读 A6_ACCOUNT_ID → 环境变量
  if (forRelayAccount) {
    out.accountId = (pc.a6User && String(pc.a6User).trim()) || (r.map && r.map.A6_ACCOUNT_ID) || process.env.A6_ACCOUNT_ID || '';
  }
  return out;
}

function redact(text, secret) {
  let s = String(text == null ? '' : text);
  if (secret && secret.length >= 8) {
    s = s.split(secret).join('***');
  }
  return s.slice(0, 400);
}

function authHeaders(key) {
  const h = {};
  if (key) h['Authorization'] = 'Bearer ' + key;
  return h;
}

/** 单家抓取：返回 {ok, amount, currency, error} */
async function fetchProvider(pc, ctx) {
  const now = Date.now();
  let lastKey = ''; // 仅用于错误信息脱敏，绝不写入日志本身
  if (pc.type === 'rice') return { ok: true, rice: true, amount: null, currency: 'CNY' };
  try {
    if (pc.type === 'official') {
      const preset = pc.preset || 'deepseek';
      const url = OFFICIAL_URLS[preset] || pc.endpoint;
      const keyInfo = loadKey(pc, false);
      lastKey = keyInfo.key || '';
      const { body } = await httpGet(url, authHeaders(keyInfo.key), 12000);
      const j = JSON.parse(body);
      let amount = NaN;
      if (preset === 'deepseek') {
        const infos = j.balance_infos || [];
        const pick = infos.find(x => x && String(x.currency).toUpperCase() === 'CNY') || infos[0];
        if (pick) amount = toNum(pick.total_balance);
      } else if (preset === 'kimi') amount = toNum(getFirst(resolvePath(j, 'data') || {}, ['available_balance']));
      else if (preset === 'siliconflow') amount = toNum(resolvePath(j, 'data.totalBalance'));
      else if (preset === 'stepfun') amount = toNum(j.balance);
      else if (preset === 'openrouter') {
        const tc = toNum(resolvePath(j, 'data.total_credits'));
        const tu = toNum(resolvePath(j, 'data.total_usage'));
        amount = tc - tu;
      }
      if (!Number.isFinite(amount)) return { ok: false, error: 'parse failed' };
      const currency = (preset === 'openrouter') ? 'USD' : 'CNY';
      return { ok: true, amount: round2(amount), currency };
    }
    if (pc.type === 'relay') {
      let baseUrl = pc.baseUrl;
      if (!baseUrl && pc.endpoint) { try { baseUrl = new URL(pc.endpoint).origin; } catch (e) { /* ignore */ } }
      const statusUrl = pc.statusEndpoint || (baseUrl ? baseUrl + '/api/status' : '');
      const keyInfo = loadKey(pc, true);
      lastKey = keyInfo.key || '';
      let qpu = 500000, fx = 7.0;
      if (statusUrl) {
        const cacheKey = statusUrl;
        const cached = ctx.rateCache.get(cacheKey);
        if (cached && now - cached.at < 600000) { qpu = cached.qpu; fx = cached.fx; }
        else {
          try {
            const { body } = await httpGet(statusUrl, {}, 8000);
            const j = JSON.parse(body);
            const data = (j && j.data) || j;
            const a = toNum(getFirst(data, ['quota_per_unit']));
            const b = toNum(getFirst(data, ['payment_fx_rate_cny_per_usd']));
            if (Number.isFinite(a) && a > 0) qpu = a;
            if (Number.isFinite(b) && b > 0) fx = b;
            ctx.rateCache.set(cacheKey, { qpu, fx, at: now });
          } catch (e) { /* 用默认换算兜底 */ }
        }
      }
      const headers = authHeaders(keyInfo.key);
      if (keyInfo.accountId) headers['New-Api-User'] = keyInfo.accountId;
      const { body } = await httpGet(pc.endpoint, headers, 12000);
      const j = JSON.parse(body);
      const quota = toNum(resolvePath(j, 'data.quota') !== undefined ? resolvePath(j, 'data.quota') : j.quota);
      if (!Number.isFinite(quota)) return { ok: false, error: 'parse failed' };
      const amount = quota / qpu * fx;
      return { ok: true, amount: round2(amount), currency: 'CNY' };
    }
    // custom
    const keyInfo = loadKey(pc, false);
    lastKey = keyInfo.key || '';
    const headers = authHeaders(keyInfo.key);
    const { body } = await httpGet(pc.endpoint, headers, 12000);
    const j = JSON.parse(body);
    const v = toNum(resolvePath(j, pc.jsonPath || 'data.balance'));
    if (!Number.isFinite(v)) return { ok: false, error: 'parse failed: ' + (pc.jsonPath || 'data.balance') };
    return { ok: true, amount: round2(v), currency: pc.currency || 'CNY' };
  } catch (e) {
    return { ok: false, error: redact(e && e.message || e, lastKey) };
  }
}

function backoffSec(failStreak) {
  if (failStreak <= 1) return 10;
  if (failStreak === 2) return 30;
  if (failStreak === 3) return 60;
  return 300;
}

class ProviderManager {
  constructor(opts) {
    this.opts = opts || {};
    this.cfg = null;
    this.runtimes = [];
    this.rateCache = new Map();
    this.timer = null;
    this.demoCount = 0;
    this.demoState = 'normal';
    this.running = false;
  }

  configure(cfg) {
    this.cfg = cfg;
    const old = new Map(this.runtimes.map(r => [r.pc.id, r]));
    this.runtimes = (cfg.providers || []).map((pc) => {
      const prev = old.get(pc.id);
      return {
        pc,
        result: prev ? prev.result : null,
        failStreak: prev ? prev.failStreak : 0,
        lastAttemptMs: 0,
        lastOkMs: 0,
        nextDueMs: 0,
        inFlight: false,
      };
    });
    // 配置重载后全部立即刷新（Win 口径）
    const now = Date.now();
    for (const rt of this.runtimes) rt.nextDueMs = now;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      const now = Date.now();
      for (const rt of this.runtimes) {
        if (!rt.pc.enabled || rt.pc.type === 'rice') continue;
        if (rt.inFlight || now < rt.nextDueMs) continue;
        rt.inFlight = true;
        rt.lastAttemptMs = now;
        const pc = rt.pc;
        const res = await fetchProvider(pc, { rateCache: this.rateCache });
        rt.inFlight = false;
        if (res.ok) {
          rt.result = { ok: true, amount: res.amount, currency: res.currency, error: '' };
          rt.failStreak = 0;
          rt.lastOkMs = Date.now();
          rt.nextDueMs = Date.now() + pc.intervalSec * 1000;
          logger.write(`balance id=${pc.id} ok amount=${res.amount} currency=${res.currency}`);
        } else {
          rt.failStreak++;
          rt.result = { ok: false, amount: rt.result ? rt.result.amount : null, currency: rt.result ? rt.result.currency : 'CNY', error: res.error };
          const bs = backoffSec(rt.failStreak);
          rt.nextDueMs = Date.now() + bs * 1000;
          logger.write(`balance id=${pc.id} failed fails=${rt.failStreak} next=${bs}s error=${redact(res.error, '')}`);
        }
      }
      setTimeout(tick, 120);
    };
    setTimeout(tick, 10);
  }

  stop() { this.running = false; }

  /** 渲染用 views（含 ratio/low/状态），demo 模式直接用演示数据 */
  views() {
    if (this.demoCount > 0) return demoViews(this.demoCount, this.demoState);
    const disp = (this.cfg && this.cfg.display) || {};
    return this.runtimes.filter(rt => rt.pc.enabled).map((rt) => {
      const pc = rt.pc;
      const rice = pc.type === 'rice';
      const r = rt.result;
      const hasResult = !!r;
      const ok = rice ? true : !!(r && r.ok);
      const amount = rice ? null : (r && Number.isFinite(r.amount) ? r.amount : null);
      const fullAmount = pc.fullAmount || disp.refYuan || 100;
      const ratio = rice ? 1 : (ok && Number.isFinite(amount) ? Math.min(1, Math.max(0, amount / fullAmount)) : 0);
      const low = !rice && ok && Number.isFinite(amount) && pc.threshold != null && amount < pc.threshold;
      return {
        id: pc.id, name: pc.name, type: pc.type, rice,
        amount, currency: (r && r.currency) || 'CNY', hasResult, ok, low, ratio,
        fullAmount, threshold: pc.threshold, intervalSec: pc.intervalSec,
        error: (r && r.error) || '',
      };
    });
  }
}

/** 演示数据（--demo / 无 config 兜底）：前 2 家真实样例，其余大白饭（Win DemoData 口径） */
function demoViews(n, state) {
  const out = [];
  const total = Math.max(1, Math.min(n || 9, 9));
  const states = ['normal', 'low', 'full', 'offline', 'rice'];
  for (let i = 0; i < total; i++) {
    let st = state && state !== 'normal' ? state : states[i % states.length];
    if (i === 0) st = 'normal';
    if (i === 1) st = state && state !== 'normal' ? state : 'low';
    if (st === 'rice') {
      out.push({ id: 'r' + i, name: '大白饭', type: 'rice', rice: true, amount: null, currency: 'CNY', hasResult: true, ok: true, low: false, ratio: 1, fullAmount: 100, threshold: null, intervalSec: 60, error: '' });
      continue;
    }
    if (st === 'offline') {
      out.push({ id: 'p' + i, name: ['Kimi', '硅基流动', 'StepFun', 'OpenRouter', 'A6'][i % 5], type: 'custom', rice: false, amount: null, currency: 'CNY', hasResult: true, ok: false, low: false, ratio: 0, fullAmount: 100, threshold: 5, intervalSec: 60, error: '连接失败' });
      continue;
    }
    const amounts = { normal: [123.45, 88.8, 66.6, 45.2, 32.1], low: [3.5, 2.8, 4.2, 1.9, 4.9], full: [100, 100, 100, 100, 100] };
    const arr = amounts[st] || amounts.normal;
    const amount = arr[i % arr.length];
    const fullAmount = st === 'low' ? 20 : (st === 'full' ? 100 : 150);
    out.push({
      id: 'p' + i, name: ['DeepSeek', 'A6', 'Kimi', '硅基流动', '大白饭'][i % 5] + (i > 4 ? ('·' + i) : ''),
      type: 'custom', rice: false, amount, currency: 'CNY', hasResult: true, ok: true,
      low: st === 'low', ratio: Math.max(0, Math.min(1, amount / fullAmount)),
      fullAmount, threshold: 5, intervalSec: 60, error: '',
    });
  }
  return out;
}

module.exports = { ProviderManager, fetchProvider, loadKey, demoViews, resolvePath, round2, OFFICIAL_URLS };
