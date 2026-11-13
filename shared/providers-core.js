'use strict';
// 饭桶余额 · 共享余额核心（第 27 轮双端统一）
//
// 定位：纯 CommonJS / 纯 JS / 不 require('electron') / 不碰 UI，Mac 与后续 Win 端共用这一份。
// 来源：第 26 轮 app-mac/src/providers.js 第 1–958 行整份搬迁（逐字节搬运，非重写）。
// 边界：
//   · 只依赖 Node 内置模块 + 同目录 ./config-core + ./shake；
//   · 平台差异（默认密钥路径、User-Agent）按 process.platform 派生；
//   · 日志走注入端口 setLogger()，核心自身不 require app 层 logger（Win 端没有那个模块）。
//
// 余额来源：请求/解析/调度/退避（Win Panel.cs Net + ProviderRuntime 的跨平台移植）
// 四类：official（5 个预设）/ relay（new-api）/ custom（jsonPath）/ rice（大白饭，不联网）
//
// 第 7 轮乙路（#4 安全 ①「失败分类码」+ ③「日志脱敏」）改口径：
//  - 每次失败都带**分类枚举**（ERROR_CODES）+ 用户可见中文文案（ERROR_TEXT）：网络/鉴权/限流/解析/配置缺失互不混淆；
//  - 用户可见文案**不含**内部细节（不回显响应体、HTTP 原文、系统错误码、密钥值），日志只记「分类码 + HTTP 状态码 + 白名单字段」；
//  - loadKey 明确区分「未配置 / 文件缺失 / 变量缺失 / 空值」，并在不请求接口的情况下直接给出可操作提示（不再白打一次 401）；
//  - redact 增加「服务端回显的掩码密钥尾号」二次脱敏，供日志/错误文案兜底；
//  - 新增 verifyKey()：给「设置页/托盘测试连接」用的只读主动校验（主进程接入属甲路写范围，本轮先落数据层）。
const fs = require('fs');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');
const { expandPath } = require('./config-core');

// 日志端口：默认空实现，由 app 层（app-mac/src/providers.js）在 require 后注入真实 logger。
// 用 let + 函数体内按名引用，注入后立即对后续所有调用生效。
let logger = { write() {} };
function setLogger(impl) {
  logger = (impl && typeof impl.write === 'function') ? impl : { write() {} };
}

// User-Agent 按平台派生（两端同一份核心，不能写死 Mac）
const UA = process.platform === 'win32' ? 'GluttonBalance/1.0 (Win)' : 'GluttonBalance/1.0 (Mac)';
// 回退变量表：仅在 keySource.var 未命中时兜底（兼容旧配置）；命中哪一项会记在 usedVar（只记变量名，不记值）
const KEY_FALLBACKS = ['A6_CONSOLE_TOKEN', 'A6_CONSOLE_API_KEY', 'A6API_KEY', 'A6_PROXY_KEY', 'A6_KEY', 'TOKEN', 'API_KEY'];
const OFFICIAL_URLS = {
  deepseek: 'https://api.deepseek.com/user/balance',
  kimi: 'https://api.moonshot.cn/v1/users/me/balance',
  siliconflow: 'https://api.siliconflow.cn/v1/user/info',
  stepfun: 'https://api.stepfun.com/v1/accounts',
  openrouter: 'https://openrouter.ai/api/v1/credits',
};

// ---- Qoder（规格 output/qoder-provider-spec.md）----
// 两段式：POST exchange 把 PAT 换 jt-，再 GET usage。endpoint 是 base，允许用户改国际版。
const QODER_DEFAULT_ENDPOINT = 'https://openapi.qoder.com.cn';
const QODER_EXCHANGE_PATH = '/api/v1/jobToken/exchange';
const QODER_USAGE_PATH = '/sash/api/v2/me/usage';
const QODER_TOKEN_TTL_MS = 20 * 60 * 1000; // 进程内按 base+PAT 缓存 20 分钟
const qoderTokenCache = new Map(); // key=sha256(base+PAT)，value={token, at}；不存明文 PAT

// ============================================================ 失败分类码（第 7 轮 #4 ①）
// 原则：分类码进日志（内部枚举）；中文文案进界面（用户可操作）；任何分支都不回显密钥值。
const ERROR_CODES = Object.freeze({
  OK: 'OK',
  NO_KEY_SOURCE: 'NO_KEY_SOURCE',       // keySource 三字段全空
  KEY_FILE_MISSING: 'KEY_FILE_MISSING', // 凭据文件不存在（ENOENT）
  KEY_FILE_INVALID: 'KEY_FILE_INVALID', // 凭据文件读不了/不是普通文件
  KEY_VAR_MISSING: 'KEY_VAR_MISSING',   // 文件里没有 keySource.var 且无可用回退
  KEY_EMPTY: 'KEY_EMPTY',               // 命中变量但值为空
  CONFIG_MISSING: 'CONFIG_MISSING',     // 缺一项非密钥配置（与扩展设置页同名分类；Mac 侧当前不产生）
  KEY_INVALID: 'KEY_INVALID',           // 余额接口 401
  KEY_FORBIDDEN: 'KEY_FORBIDDEN',       // 余额接口 403
  ENDPOINT_NOT_FOUND: 'ENDPOINT_NOT_FOUND', // 404
  RATE_LIMITED: 'RATE_LIMITED',         // 429
  SERVER_ERROR: 'SERVER_ERROR',         // 5xx
  NETWORK: 'NETWORK',                   // DNS/连接被拒/断网
  TIMEOUT: 'TIMEOUT',                   // 请求超时
  TLS_ERROR: 'TLS_ERROR',               // 证书校验失败
  PARSE_FAILED: 'PARSE_FAILED',         // JSON 解析失败 / 字段路径取不到数字
  BAD_ENDPOINT: 'BAD_ENDPOINT',         // 接口地址格式不合法
  UNKNOWN: 'UNKNOWN',
});

// 用户可见文案（{detail} 只允许填「变量名 / 路径末两段 / JSON 路径」这类非敏感字段）
const ERROR_TEXT = Object.freeze({
  OK: '连接成功',
  NO_KEY_SOURCE: '还没配置密钥来源：请在配置文件里补上凭据文件路径或环境变量名（密钥值不会显示在这里）',
  KEY_FILE_MISSING: '找不到凭据文件{detail}：请检查路径是否写对（支持 ~ 与 %变量%）',
  KEY_FILE_INVALID: '凭据文件读不了或不是普通文件{detail}：请检查文件权限与路径',
  KEY_VAR_MISSING: '凭据文件里没有变量{detail}：请检查变量名是否写对',
  KEY_EMPTY: '变量{detail}的值是空的：请把密钥填进凭据文件或环境变量',
  CONFIG_MISSING: '还缺一项配置{detail}：请在配置文件里补上',
  KEY_INVALID: 'key 无效或已被吊销：请到服务商控制台重新生成，并更新凭据文件',
  KEY_FORBIDDEN: '这个 key 没有余额查询权限：请换一个只读、最小权限的 key',
  ENDPOINT_NOT_FOUND: '接口地址不对（404）：请检查「接口地址」或厂商预设是否选对',
  RATE_LIMITED: '请求太频繁（429）：稍后会自动重试',
  SERVER_ERROR: '服务端临时故障（5xx）：稍后会自动重试',
  NETWORK: '网络连不上：请检查网络 / 代理 / DNS',
  TIMEOUT: '请求超时：请检查网络 / 代理',
  TLS_ERROR: '证书校验失败：请检查系统时间或代理证书',
  PARSE_FAILED: '接口返回的内容看不懂{detail}：请检查「接口地址」与「JSON 取值路径」是否符合该接口',
  BAD_ENDPOINT: '接口地址格式不对：请以 http(s):// 开头',
  UNKNOWN: '未知错误：请查看面板日志（日志已脱敏）',
});

/** 分类码 → 用户可见中文文案（detail 只传非敏感字段）。 */
function errorText(code, detail) {
  const raw = ERROR_TEXT[code] || ERROR_TEXT.UNKNOWN;
  const tail = detail ? `（${String(detail)}）` : '';
  return String(raw).replace('{detail}', tail);
}

function classifyHttpStatus(status) {
  if (status === 401) return ERROR_CODES.KEY_INVALID;
  if (status === 403) return ERROR_CODES.KEY_FORBIDDEN;
  if (status === 404) return ERROR_CODES.ENDPOINT_NOT_FOUND;
  if (status === 429) return ERROR_CODES.RATE_LIMITED;
  if (status >= 500) return ERROR_CODES.SERVER_ERROR;
  if (status >= 400) return ERROR_CODES.UNKNOWN;
  return ERROR_CODES.UNKNOWN;
}

function classifyNodeError(err) {
  const codeStr = String((err && (err.code || err.errno)) || '');
  const msg = String((err && err.message) || '');
  const all = codeStr + ' ' + msg;
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|EPROTO/i.test(all)) return ERROR_CODES.TLS_ERROR;
  if (/ETIMEDOUT|ESOCKETTIMEDOUT/i.test(codeStr) || /timeout/i.test(msg)) return ERROR_CODES.TIMEOUT;
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE|ECONNABORTED/i.test(codeStr)) return ERROR_CODES.NETWORK;
  if (/ERR_INVALID_URL|bad url/i.test(all)) return ERROR_CODES.BAD_ENDPOINT;
  if (/Unexpected token|Unexpected end|is not valid JSON|JSON/i.test(msg)) return ERROR_CODES.PARSE_FAILED;
  return ERROR_CODES.UNKNOWN;
}

/** 只保留 Node errno 名称；绝不把原始错误 message/URL/token 带进诊断。 */
function safeErrno(err) {
  const raw = err && (err.code != null ? err.code : err.errno);
  if (raw == null) return '';
  const value = String(raw).toUpperCase().replace(/[^A-Z0-9_:-]/g, '').slice(0, 32);
  return value || '';
}

function elapsedMs(start, at) {
  if (typeof start !== 'bigint' || typeof at !== 'bigint') return null;
  const n = Number(at - start) / 1e6;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** HTTP 阶段诊断只含白名单数字/errno/status；空字段不输出。 */
function httpDiag(state, err, status) {
  const out = {};
  for (const key of ['dnsMs', 'connectMs', 'tlsMs', 'ttfbMs', 'totalMs']) {
    const value = state && state[key];
    if (Number.isFinite(value)) out[key] = Math.max(0, Math.round(value));
  }
  const errno = safeErrno(err);
  if (errno) out.errno = errno;
  const code = Number(status);
  if (Number.isInteger(code) && code > 0) out.status = code;
  return Object.keys(out).length ? out : null;
}

function parseRetryAfter(headers) {
  const raw = headers && headers['retry-after'];
  if (Array.isArray(raw)) return parseRetryAfter({ 'retry-after': raw[0] });
  if (raw == null) return null;
  const value = String(raw).trim();
  if (/^\d+$/.test(value)) return Math.max(0, Number(value));
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** HTTP 诊断格式仅供日志使用，字段来自固定白名单。 */
function formatHttpDiag(diag, retryAfterSec) {
  const d = diag && typeof diag === 'object' ? diag : {};
  const parts = [];
  for (const [key, label] of [['dnsMs', 'dns'], ['connectMs', 'connect'], ['tlsMs', 'tls'], ['ttfbMs', 'ttfb'], ['totalMs', 'total']]) {
    if (Number.isFinite(d[key])) parts.push(`${label}=${Math.max(0, Math.round(d[key]))}ms`);
  }
  if (d.errno) parts.push('errno=' + safeErrno({ code: d.errno }));
  if (Number.isFinite(retryAfterSec)) parts.push(`retryAfter=${Math.max(0, Math.round(retryAfterSec))}s`);
  return parts.length ? ' http=' + parts.join(',') : '';
}

/** 带分类码的内部错误（message 不给用户看；用户文案由 errorText 生成）。 */
function classifiedError(code, detail, status, diag, retryAfterSec) {
  const e = new Error(code || 'UNKNOWN');
  e.pbCode = code || ERROR_CODES.UNKNOWN;
  if (detail) e.pbDetail = String(detail);
  if (status) e.pbStatus = Number(status);
  if (diag) e.pbHttpDiag = diag;
  // Retry-After 只允许随 429（RATE_LIMITED）传播，其他状态绝不挂载该字段。
  if (e.pbCode === ERROR_CODES.RATE_LIMITED && Number.isFinite(retryAfterSec)) e.pbRetryAfterSec = Math.max(0, Math.round(retryAfterSec));
  return e;
}

// ============================================================ 脱敏（第 7 轮 #4 ③）
const REDACT_RULES = [
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, '$1***'],
  [/(Authorization\s*[:=]\s*)[^\s,;}]+/gi, '$1***'],
  [/\*{2,}[A-Za-z0-9_\-]{3,}/g, '****'],
  [/\b(sk|pk|ghp|gho|ghs|ghu|github_pat|npm|xoxa|xoxb|xoxp)[_-][A-Za-z0-9_\-]{6,}/g, '$1_***'],
  [/((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',;}]{6,}/gi, '$1***'],
];

/** 二次脱敏：完整密钥 → ***；服务端「掩码尾号」形态 → ****；Bearer 头值 → ***。 */
function redact(text, secret) {
  let s = String(text == null ? '' : text);
  if (secret && secret.length >= 8) s = s.split(secret).join('***');
  for (const [re, rep] of REDACT_RULES) s = s.replace(re, rep);
  return s.slice(0, 400);
}

/** 路径只留末 n 段（日志/提示里用；不暴露用户名与完整家目录）。 */
function pathTail(p, n) {
  const parts = String(p || '').replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-(n || 2)).join('/');
}

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

// ------------------------------------------------------------ HTTP（只读；响应体不进错误对象）
// Qoder 需要 POST（exchange）：抽一个最小 httpRequest 复用同一套超时/TLS/错误分类/httpDiag；
// GET 行为与旧 httpGet 完全一致（默认 method=GET、无 body）。
function httpRequest(url, headers, timeoutMs, opts) {
  const o = opts || {};
  const method = String(o.method || 'GET').toUpperCase();
  const bodyText = typeof o.body === 'string' ? o.body : '';
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(classifiedError(ERROR_CODES.BAD_ENDPOINT)); }
    const mod = u.protocol === 'https:' ? https : http;
    const started = process.hrtime.bigint();
    const state = { dnsMs: null, connectMs: null, tlsMs: null, ttfbMs: null, totalMs: null };
    let socketAt = null;
    let dnsDoneAt = null;
    let connectAt = null;
    let req = null;
    let settled = false;
    const deadlineMs = Math.max(1, Number(timeoutMs) || 12000);
    const finish = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(deadline);
      return true;
    };
    const fail = (err, status, retryAfterSec) => {
      if (!finish()) return;
      state.totalMs = elapsedMs(started, process.hrtime.bigint());
      if (req && !req.destroyed) req.destroy();
      const code = (err && err.pbCode) || classifyNodeError(err);
      reject(classifiedError(
        code,
        (err && err.pbDetail) || '',
        status || (err && err.pbStatus) || 0,
        httpDiag(state, err, status || (err && err.pbStatus)),
        retryAfterSec
      ));
    };
    const deadline = setTimeout(() => fail(classifiedError(ERROR_CODES.TIMEOUT)), deadlineMs);
    const reqHeaders = Object.assign({ 'User-Agent': UA, 'Accept': 'application/json', 'Connection': 'close' }, headers || {});
    if (bodyText) reqHeaders['Content-Length'] = Buffer.byteLength(bodyText);
    try {
      req = mod.request({
        protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''), method,
        headers: reqHeaders,
        timeout: deadlineMs,
      }, (res) => {
        state.ttfbMs = elapsedMs(started, process.hrtime.bigint());
        const chunks = [];
        let stream = res;
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => {
          if (settled) return;
          state.totalMs = elapsedMs(started, process.hrtime.bigint());
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            if (finish()) resolve({ status: res.statusCode, body, httpDiag: httpDiag(state, null, res.statusCode) });
            return;
          }
          const code = classifyHttpStatus(res.statusCode);
          const retryAfterSec = code === ERROR_CODES.RATE_LIMITED ? parseRetryAfter(res.headers) : null;
          fail(classifiedError(code), res.statusCode, retryAfterSec);
        });
        stream.on('error', (e) => fail(e));
      });
      req.on('socket', (socket) => {
        socketAt = process.hrtime.bigint();
        socket.on('lookup', (err) => {
          const now = process.hrtime.bigint();
          state.dnsMs = elapsedMs(socketAt, now);
          dnsDoneAt = now;
          if (err) fail(err);
        });
        socket.on('connect', () => {
          connectAt = process.hrtime.bigint();
          state.connectMs = elapsedMs(dnsDoneAt || socketAt, connectAt);
        });
        socket.on('secureConnect', () => {
          state.tlsMs = elapsedMs(connectAt || socketAt, process.hrtime.bigint());
        });
      });
      req.on('timeout', () => fail(classifiedError(ERROR_CODES.TIMEOUT)));
      req.on('error', (e) => fail(e));
      req.end(bodyText);
    } catch (e) {
      fail(e);
    }
  });
}

function httpGet(url, headers, timeoutMs) {
  return httpRequest(url, headers, timeoutMs, { method: 'GET' });
}

function httpPost(url, headers, body, timeoutMs) {
  return httpRequest(url, headers, timeoutMs, { method: 'POST', body });
}

function parseJsonBody(body) {
  try {
    return JSON.parse(body);
  } catch (e) {
    throw classifiedError(ERROR_CODES.PARSE_FAILED);
  }
}

// ------------------------------------------------------------ Qoder 两段式查询（PAT → jt- → usage）
// 密钥/令牌只进内存：缓存键是 sha256(base+PAT)，日志与错误文案都不出现 PAT / jt-。
function qoderBase(pc) {
  const raw = String((pc && pc.endpoint) || '').trim();
  return (raw || QODER_DEFAULT_ENDPOINT).replace(/\/+$/, '');
}

function qoderCacheKey(base, pat) {
  return crypto.createHash('sha256').update(base + '\n' + pat).digest('hex');
}

function qoderCachedToken(key, now) {
  const hit = qoderTokenCache.get(key);
  if (!hit) return '';
  if (!(now - hit.at < QODER_TOKEN_TTL_MS)) { qoderTokenCache.delete(key); return ''; }
  return hit.token || '';
}

function qoderRememberToken(key, token, now) {
  qoderTokenCache.set(key, { token, at: now });
}

/** 清空 jt- 缓存（测试/配置切换用）。 */
function clearQoderTokenCache() {
  qoderTokenCache.clear();
}

/**
 * PAT → jt-。响应取 token / job_token / jobToken 任一；交换 400/401/403 一律 KEY_INVALID。
 * 返回值 {token, httpDiag}；任何分支都不带响应体原文。
 */
async function exchangeQoderJobToken(base, pat) {
  let res;
  try {
    res = await httpPost(
      base + QODER_EXCHANGE_PATH,
      { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      JSON.stringify({ personal_token: pat }),
      12000
    );
  } catch (e) {
    const status = Number(e && e.pbStatus) || 0;
    if (status === 400 || status === 401 || status === 403) {
      throw classifiedError(ERROR_CODES.KEY_INVALID, '', status, e && e.pbHttpDiag);
    }
    throw e;
  }
  const j = parseJsonBody(res.body);
  const raw = getFirst(j || {}, ['token', 'job_token', 'jobToken']);
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token) throw classifiedError(ERROR_CODES.PARSE_FAILED, 'qoder.jobToken', res.status, res.httpDiag);
  return { token, httpDiag: res.httpDiag };
}

/** 单池余额：remaining 优先；否则 total-used；读不懂按 0（规格 §2，不能让整次查询失败）。 */
function qoderQuotaRemaining(pool) {
  if (!pool || typeof pool !== 'object') return 0;
  const rem = toNum(pool.remaining);
  if (Number.isFinite(rem)) return rem;
  const total = toNum(pool.total);
  const used = toNum(pool.used);
  if (Number.isFinite(total) && Number.isFinite(used)) return total - used;
  return 0;
}

/** 汇总 userQuota + addOnQuota + orgResourcePackage；三池全缺 → PARSE_FAILED（detail 只写 qoder.quota）。 */
function qoderQuotaAmount(body) {
  const j = (body && typeof body === 'object' && !Array.isArray(body)) ? body : null;
  const usage = (j && j.qoderUsage && typeof j.qoderUsage === 'object') ? j.qoderUsage : j;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    throw classifiedError(ERROR_CODES.PARSE_FAILED, 'qoder.quota');
  }
  const pools = ['userQuota', 'addOnQuota', 'orgResourcePackage'];
  let present = 0;
  let sum = 0;
  for (const name of pools) {
    const pool = usage[name];
    if (pool && typeof pool === 'object' && !Array.isArray(pool)) {
      present++;
      sum += qoderQuotaRemaining(pool);
    }
  }
  if (!present) throw classifiedError(ERROR_CODES.PARSE_FAILED, 'qoder.quota');
  return round2(sum);
}

/** Qoder 查询：返回 {ok:true, amount, currency:'CREDITS'} 或 failureResult；不抛出到调用方。 */
async function queryQoder(pc) {
  try {
    const keyInfo = loadKey(pc, false);
    if (!keyInfo.key) {
      const code = keyInfo.code;
      const detail = keySourceDetail(code, pc);
      return failureResult(code, { detail, logHint: logHintFor(code, detail) });
    }
    const pat = keyInfo.key;
    const base = qoderBase(pc);
    const cacheKey = qoderCacheKey(base, pat);
    let token = qoderCachedToken(cacheKey, Date.now());
    let tokenDiag = null;
    if (!token) {
      const ex = await exchangeQoderJobToken(base, pat);
      token = ex.token;
      tokenDiag = ex.httpDiag;
      qoderRememberToken(cacheKey, token, Date.now());
    }
    let usageRes;
    try {
      usageRes = await httpGet(base + QODER_USAGE_PATH, authHeaders(token), 12000);
    } catch (e) {
      if (Number(e && e.pbStatus) !== 401) throw e;
      // usage 401：jt- 可能已失效，强制重换一次再试；仍 401 归 KEY_INVALID
      qoderTokenCache.delete(cacheKey);
      const ex = await exchangeQoderJobToken(base, pat);
      token = ex.token;
      tokenDiag = ex.httpDiag || tokenDiag;
      qoderRememberToken(cacheKey, token, Date.now());
      try {
        usageRes = await httpGet(base + QODER_USAGE_PATH, authHeaders(token), 12000);
      } catch (e2) {
        if (Number(e2 && e2.pbStatus) === 401) {
          throw classifiedError(ERROR_CODES.KEY_INVALID, '', 401, e2 && e2.pbHttpDiag);
        }
        throw e2;
      }
    }
    const j = parseJsonBody(usageRes.body);
    const amount = qoderQuotaAmount(j);
    return { ok: true, amount, currency: 'CREDITS', httpDiag: usageRes.httpDiag || tokenDiag };
  } catch (e) {
    const code = (e && e.pbCode) || classifyNodeError(e);
    const status = (e && e.pbStatus) || 0;
    const detail = (e && e.pbDetail) || '';
    return failureResult(code, {
      status,
      detail,
      httpDiag: e && e.pbHttpDiag,
      retryAfterSec: e && e.pbRetryAfterSec,
      logHint: logHintFor(code, detail),
    });
  }
}

// ------------------------------------------------------------ 密钥读取（只进内存；返回分类码）
function readKeyFile(file) {
  try {
    const p = expandPath(file);
    if (!p) return { ok: false, code: ERROR_CODES.NO_KEY_SOURCE, error: 'empty path' };
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
    const code = e && e.code === 'ENOENT' ? ERROR_CODES.KEY_FILE_MISSING : ERROR_CODES.KEY_FILE_INVALID;
    return { ok: false, code, error: String((e && e.code) || (e && e.message) || e) };
  }
}

/**
 * 读取密钥（只进内存，绝不打印）。
 * 返回 {key, accountId, error, code, usedVar, usedFallback}：
 *  - code=OK 且 key 非空 = 可用；否则 code 为分类码，供界面提示/日志记录；
 *  - usedVar 只记**命中的变量名**（不记值），便于用户核对「是不是用错了 key」。
 */
function loadKey(pc, forRelayAccount) {
  const ks = pc.keySource || {};
  const kind = ks.kind || 'file';
  const out = { key: '', accountId: '', error: '', code: ERROR_CODES.OK, usedVar: '', usedFallback: false };
  const varName = String(ks.var || '').trim();
  const tryNames = [];
  if (varName) tryNames.push(varName);
  for (const n of KEY_FALLBACKS) if (!tryNames.includes(n)) tryNames.push(n);

  if (kind === 'env') {
    // env 类型只认 keySource.var 显式变量名（审计 M3：不再回退到通用 TOKEN/API_KEY，避免发错钥匙）
    if (!varName) {
      out.code = ERROR_CODES.NO_KEY_SOURCE;
      out.error = 'kind=env 但没有配置 keySource.var';
      return out;
    }
    const v = process.env[varName];
    if (v === undefined) {
      out.code = ERROR_CODES.KEY_VAR_MISSING;
      out.error = 'env var not set: ' + varName;
      out.usedVar = varName;
      return out;
    }
    if (!String(v).trim()) {
      out.code = ERROR_CODES.KEY_EMPTY;
      out.error = 'env var empty: ' + varName;
      out.usedVar = varName;
      return out;
    }
    out.key = String(v).trim();
    out.usedVar = varName;
    if (forRelayAccount) out.accountId = (pc.a6User && String(pc.a6User).trim()) || process.env.A6_ACCOUNT_ID || '';
    return out;
  }

  const file = String(ks.file || '').trim();
  if (!file) {
    // 没给文件：退回环境变量（旧 Win KeyLoader 行为）；记录命中变量名，便于排查
    for (const n of tryNames) {
      const v = process.env[n];
      if (v !== undefined && String(v).trim() !== '') {
        out.key = String(v).trim();
        out.usedVar = n;
        out.usedFallback = !varName || n !== varName;
        if (forRelayAccount) out.accountId = (pc.a6User && String(pc.a6User).trim()) || process.env.A6_ACCOUNT_ID || '';
        return out;
      }
    }
    out.code = ERROR_CODES.NO_KEY_SOURCE;
    out.error = '没有 keySource.file，也没有可用环境变量';
    return out;
  }

  const r = readKeyFile(file);
  if (!r.ok) {
    out.code = r.code || ERROR_CODES.KEY_FILE_INVALID;
    out.error = r.error;
    if (out.code === ERROR_CODES.KEY_FILE_MISSING) out.usedVar = '';
    return out;
  }
  for (const n of tryNames) {
    if (r.map && r.map[n]) {
      out.key = r.map[n];
      out.usedVar = n;
      out.usedFallback = !!varName && n !== varName;
      break;
    }
  }
  // 单行文件：整行即 token（Win 口径）
  if (!out.key && r.single) {
    if (!varName) { out.key = r.single; out.usedVar = ''; }
    else if (r.map[varName] === undefined && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(r.single)) {
      out.key = r.single;
      out.usedVar = '';
    }
  }
  if (!out.key) {
    // 文件存在但没取到值：区分「变量名写错」与「值为空」
    if (r.map && varName && Object.prototype.hasOwnProperty.call(r.map, varName)) out.code = ERROR_CODES.KEY_EMPTY;
    else out.code = ERROR_CODES.KEY_VAR_MISSING;
    out.error = varName ? 'key var not found: ' + varName : 'key var not specified';
    out.usedVar = varName;
    return out;
  }
  // relay：a6User 为空时从同一文件读 A6_ACCOUNT_ID → 环境变量
  if (forRelayAccount) {
    out.accountId = (pc.a6User && String(pc.a6User).trim()) || (r.map && r.map.A6_ACCOUNT_ID) || process.env.A6_ACCOUNT_ID || '';
  }
  return out;
}

function authHeaders(key) {
  const h = {};
  if (key) h['Authorization'] = 'Bearer ' + key;
  return h;
}

// ------------------------------------------------------------ 失败结果组装（分类码 + 用户文案 + 日志白名单）
function failureResult(code, opts) {
  const o = opts || {};
  const message = errorText(code, o.detail);
  const out = {
    ok: false,
    code,
    status: o.status || 0,
    message,
    error: message, // 兼容旧字段（views/main.js 只把它当“失败”用）
    logHint: o.logHint || '',
  };
  if (o.httpDiag) out.httpDiag = o.httpDiag;
  if (code === ERROR_CODES.RATE_LIMITED && Number.isFinite(o.retryAfterSec)) {
    out.retryAfterSec = Math.max(0, Math.round(o.retryAfterSec));
  }
  return out;
}

/** 日志附加信息白名单：只允许变量名 / 路径末两段 / JSON 路径。 */
function logHintFor(code, detail) {
  if (!detail) return '';
  if (code === ERROR_CODES.KEY_FILE_MISSING || code === ERROR_CODES.KEY_FILE_INVALID) return 'file=' + detail;
  if (code === ERROR_CODES.KEY_VAR_MISSING || code === ERROR_CODES.KEY_EMPTY) return 'var=' + detail;
  if (code === ERROR_CODES.PARSE_FAILED) return 'path=' + detail;
  return '';
}

function keySourceDetail(code, pc) {
  const ks = (pc && pc.keySource) || {};
  const file = String(ks.file || '').trim();
  const varName = String(ks.var || '').trim();
  if (code === ERROR_CODES.KEY_FILE_MISSING || code === ERROR_CODES.KEY_FILE_INVALID) {
    return file ? pathTail(expandPath(file), 2) : '';
  }
  if (code === ERROR_CODES.KEY_VAR_MISSING || code === ERROR_CODES.KEY_EMPTY) return varName;
  return '';
}

/** 单家抓取：返回 {ok, amount, currency} 或 {ok:false, code, status, message, error, logHint} */
async function fetchProvider(pc, ctx) {
  const now = Date.now();
  const rateCache = (ctx && ctx.rateCache) || new Map();
  if (pc.type === 'rice') return { ok: true, rice: true, amount: null, currency: 'CNY' };
  try {
    if (pc.type === 'official' && (pc.preset || 'deepseek') === 'qoder') return await queryQoder(pc);
    if (pc.type === 'official') {
      const preset = pc.preset || 'deepseek';
      const url = OFFICIAL_URLS[preset] || pc.endpoint;
      const keyInfo = loadKey(pc, false);
      if (!keyInfo.key) {
        const code = keyInfo.code;
        return failureResult(code, {
          detail: keySourceDetail(code, pc),
          logHint: logHintFor(code, keySourceDetail(code, pc)),
        });
      }
      const { body, httpDiag } = await httpGet(url, authHeaders(keyInfo.key), 12000);
      const j = parseJsonBody(body);
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
      if (!Number.isFinite(amount)) {
        return failureResult(ERROR_CODES.PARSE_FAILED, {
          detail: preset === 'deepseek' ? 'balance_infos' : 'data',
          logHint: logHintFor(ERROR_CODES.PARSE_FAILED, preset),
        });
      }
      const currency = (preset === 'openrouter') ? 'USD' : 'CNY';
      return { ok: true, amount: round2(amount), currency, httpDiag };
    }
    if (pc.type === 'relay') {
      let baseUrl = pc.baseUrl;
      if (!baseUrl && pc.endpoint) { try { baseUrl = new URL(pc.endpoint).origin; } catch (e) { /* ignore */ } }
      const statusUrl = pc.statusEndpoint || (baseUrl ? baseUrl + '/api/status' : '');
      const keyInfo = loadKey(pc, true);
      if (!keyInfo.key) {
        const code = keyInfo.code;
        return failureResult(code, {
          detail: keySourceDetail(code, pc),
          logHint: logHintFor(code, keySourceDetail(code, pc)),
        });
      }
      let qpu = 500000, fx = 7.0;
      if (statusUrl) {
        const cacheKey = statusUrl;
        const cached = rateCache.get(cacheKey);
        if (cached && now - cached.at < 600000) { qpu = cached.qpu; fx = cached.fx; }
        else {
          try {
            const { body } = await httpGet(statusUrl, {}, 8000);
            const j = parseJsonBody(body);
            const data = (j && j.data) || j;
            const a = toNum(getFirst(data, ['quota_per_unit']));
            const b = toNum(getFirst(data, ['payment_fx_rate_cny_per_usd']));
            if (Number.isFinite(a) && a > 0) qpu = a;
            if (Number.isFinite(b) && b > 0) fx = b;
            rateCache.set(cacheKey, { qpu, fx, at: now });
          } catch (e) { /* 用默认换算兜底（状态接口失败不影响余额查询） */ }
        }
      }
      const headers = authHeaders(keyInfo.key);
      if (keyInfo.accountId) headers['New-Api-User'] = keyInfo.accountId;
      const { body, httpDiag } = await httpGet(pc.endpoint, headers, 12000);
      const j = parseJsonBody(body);
      const quota = toNum(resolvePath(j, 'data.quota') !== undefined ? resolvePath(j, 'data.quota') : j.quota);
      if (!Number.isFinite(quota)) {
        return failureResult(ERROR_CODES.PARSE_FAILED, {
          detail: 'data.quota',
          logHint: logHintFor(ERROR_CODES.PARSE_FAILED, 'data.quota'),
        });
      }
      const amount = quota / qpu * fx;
      return { ok: true, amount: round2(amount), currency: 'CNY', httpDiag };
    }
    // custom
    const keyInfo = loadKey(pc, false);
    if (!keyInfo.key) {
      const code = keyInfo.code;
      return failureResult(code, {
        detail: keySourceDetail(code, pc),
        logHint: logHintFor(code, keySourceDetail(code, pc)),
      });
    }
    const headers = authHeaders(keyInfo.key);
    const { body, httpDiag } = await httpGet(pc.endpoint, headers, 12000);
    const j = parseJsonBody(body);
    const jsonPath = pc.jsonPath || 'data.balance';
    const v = toNum(resolvePath(j, jsonPath));
    if (!Number.isFinite(v)) {
      return failureResult(ERROR_CODES.PARSE_FAILED, {
        detail: jsonPath,
        logHint: logHintFor(ERROR_CODES.PARSE_FAILED, jsonPath),
      });
    }
    return { ok: true, amount: round2(v), currency: (pc.unit === 'CREDITS' ? 'CREDITS' : (pc.currency || 'CNY')), httpDiag };
  } catch (e) {
    const code = (e && e.pbCode) || classifyNodeError(e);
    const status = (e && e.pbStatus) || 0;
    const detail = (e && e.pbDetail) || '';
    return failureResult(code, {
      status,
      detail,
      httpDiag: e && e.pbHttpDiag,
      retryAfterSec: e && e.pbRetryAfterSec,
      logHint: logHintFor(code, detail),
    });
  }
}

/**
 * 主动校验一次（只读 GET、0 token、不扣额度）：给「测试连接」入口用。
 * 返回 {ok, code, message, amount?, currency?, latencyMs, usedVar?}；不返回任何密钥。
 */
async function verifyKey(pc, ctx) {
  const started = Date.now();
  if (pc && pc.type === 'rice') {
    return { ok: true, code: ERROR_CODES.OK, message: '大白饭档不联网，无需测试', rice: true, amount: null, currency: 'CNY', latencyMs: 0 };
  }
  let usedVar = '';
  try {
    const info = loadKey(pc, pc && pc.type === 'relay');
    usedVar = info.usedVar || '';
    if (!info.key) {
      const code = info.code;
      const detail = keySourceDetail(code, pc);
      return { ok: false, code, message: errorText(code, detail), latencyMs: Date.now() - started, usedVar };
    }
  } catch (e) { /* 继续走真实请求，由 fetchProvider 分类 */ }
  const res = await fetchProvider(pc, ctx || { rateCache: new Map() });
  if (res.ok) {
    return {
      ok: true, code: ERROR_CODES.OK, message: errorText(ERROR_CODES.OK),
      amount: res.amount, currency: res.currency, latencyMs: Date.now() - started, usedVar,
    };
  }
  return { ok: false, code: res.code, message: res.message, status: res.status || 0, latencyMs: Date.now() - started, usedVar };
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
    this.onUpdate = typeof this.opts.onUpdate === 'function' ? this.opts.onUpdate : null;
    this.cfg = null;
    this.runtimes = [];
    this.rateCache = new Map();
    this.timer = null;
    this.demoCount = 0;
    this.demoState = 'normal';
    this.running = false;
  }

  notifyUpdate(rt, res) {
    if (!this.onUpdate) return;
    try { this.onUpdate({ id: rt.pc.id, result: rt.result, response: res }); } catch (e) { /* UI 推送失败不影响轮询 */ }
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
          rt.result = { ok: true, amount: res.amount, currency: res.currency, error: '', code: ERROR_CODES.OK };
          rt.failStreak = 0;
          rt.lastOkMs = Date.now();
          rt.nextDueMs = Date.now() + pc.intervalSec * 1000;
          logger.write(`balance id=${pc.id} ok amount=${res.amount} currency=${res.currency}` + formatHttpDiag(res.httpDiag));
          this.notifyUpdate(rt, res);
        } else {
          rt.failStreak++;
          rt.result = {
            ok: false,
            amount: rt.result ? rt.result.amount : null,
            currency: rt.result ? rt.result.currency : 'CNY',
            error: res.error,
            code: res.code,
            status: res.status || 0,
          };
          const defaultBackoff = backoffSec(rt.failStreak);
          const retryAfter = res.code === ERROR_CODES.RATE_LIMITED && Number.isFinite(res.retryAfterSec)
            ? Math.min(3600, Math.max(defaultBackoff, res.retryAfterSec))
            : defaultBackoff;
          rt.nextDueMs = Date.now() + retryAfter * 1000;
          const bs = retryAfter;
          // 只记「分类码 + HTTP 状态码 + 白名单字段」（变量名/路径末两段/JSON 路径），不记响应体、不记密钥
          logger.write(
            `balance id=${pc.id} failed fails=${rt.failStreak} next=${bs}s code=${res.code}` +
            (res.status ? ` status=${res.status}` : '') +
            (res.logHint ? ` ${res.logHint}` : '') +
            formatHttpDiag(res.httpDiag, res.retryAfterSec)
          );
          this.notifyUpdate(rt, res);
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
        amount, currency: (r && r.currency) || (pc.unit === 'CREDITS' ? 'CREDITS' : 'CNY'), unit: pc.unit || 'CNY',
        hasResult, ok, low, ratio,
        fullAmount, threshold: pc.threshold, intervalSec: pc.intervalSec,
        error: (r && r.error) || '',
        // 第 7 轮新增（附加字段，旧渲染器忽略也不影响）：失败分类码，供主进程/明细卡展示中文原因
        errorCode: (r && r.code) || '',
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
      out.push({ id: 'r' + i, name: '大白饭', type: 'rice', rice: true, amount: null, currency: 'CNY', hasResult: true, ok: true, low: false, ratio: 1, fullAmount: 100, threshold: null, intervalSec: 60, error: '', errorCode: '' });
      continue;
    }
    if (st === 'offline') {
      out.push({ id: 'p' + i, name: ['Kimi', '硅基流动', 'StepFun', 'OpenRouter', 'A6'][i % 5], type: 'custom', rice: false, amount: null, currency: 'CNY', hasResult: true, ok: false, low: false, ratio: 0, fullAmount: 100, threshold: 5, intervalSec: 60, error: '连接失败', errorCode: 'NETWORK' });
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
      fullAmount, threshold: 5, intervalSec: 60, error: '', errorCode: '',
    });
  }
  return out;
}

module.exports = {
  // 平台端口（供 app 层注入；不属于业务 API）
  setLogger,

  // 调度与查询
  ProviderManager,
  fetchProvider,
  verifyKey,
  loadKey,
  demoViews,
  resolvePath,
  round2,

  // 常量表
  OFFICIAL_URLS,
  ERROR_CODES,
  ERROR_TEXT,
  KEY_FALLBACKS,

  // 错误分类与脱敏
  errorText,
  classifyHttpStatus,
  classifyNodeError,
  redact,
  pathTail,

  // Qoder（离线用例直接调用；原有导出保持不变）
  queryQoder,
  exchangeQoderJobToken,
  clearQoderTokenCache,
  qoderQuotaAmount,
  httpPost,
  QODER_DEFAULT_ENDPOINT,
  QODER_TOKEN_TTL_MS,
};
