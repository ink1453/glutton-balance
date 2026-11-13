'use strict';
/**
 * Qoder 供应商离线用例（契约：output/qoder-provider-spec.md）。
 *
 * 只依赖 Node 内置模块和 app-mac/src/providers.js、config.js；不启动 Electron、不访问外网。
 * 用本地 http 假服务模拟 POST /api/v1/jobToken/exchange 与 GET /sash/api/v2/me/usage。
 *
 * 覆盖：
 *   1. 配置：qoder 预设默认（base / key 文件 / unit）、defaultConfig 不塞 Qoder、旧预设行为不变
 *   2. 正常汇总：userQuota + addOnQuota + orgResourcePackage = 2177.00 CREDITS
 *   3. jt- 进程内缓存：第二次查询复用，不再换 token
 *   4. usage 401 → 强制重换一次 → 成功
 *   5. 重换后仍 401 → KEY_INVALID
 *   6. 交换 400（PAT 失效）→ KEY_INVALID
 *   7. PAT 文件缺失 → KEY_FILE_MISSING（且不发任何请求）
 *   8. 余额口径：remaining 缺失回退 total-used、坏池按 0、三池全缺 → PARSE_FAILED
 *
 * 用法：node app-mac/test/qoder-provider-offline.js
 * 退出码：0 = 全部通过；1 = 有失败项。
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const providers = require(path.join(APP_DIR, 'src', 'providers'));
const config = require(path.join(APP_DIR, 'src', 'config'));

const PAT = 'pt-offline-' + 'qoder'.repeat(10);
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pbp-qoder-'));
const KEY_FILE = path.join(TMP_DIR, 'qoder-pat.txt');
fs.writeFileSync(KEY_FILE, 'QODER_PAT=' + PAT + '\n', { mode: 0o600 });

const USAGE_BODY = {
  qoderUsage: {
    userType: 'personal_professional',
    userQuota: { total: 2000, used: 23, remaining: 1977, unit: 'credits' },
    addOnQuota: { total: 200, used: 0, remaining: 200 },
    orgResourcePackage: { total: 50, used: 50, remaining: 0 },
    isQuotaExceeded: false,
  },
};

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: detail || '' });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '：' + detail : ''));
}
function safeDetail(value) {
  return String(value == null ? '' : value)
    .replace(PAT, '<pat-redacted>')
    .replace(/jt-offline-\d+/g, 'jt-offline-<n>')
    .slice(0, 240);
}
function step(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => record(name, true))
    .catch((e) => record(name, false, safeDetail(e && e.message || e)));
}
/** 结果里不得出现 PAT、jt- 或响应体原文。 */
function assertNoSecret(value) {
  const text = JSON.stringify(value == null ? null : value);
  assert(!text.includes(PAT), '结果里出现了 PAT');
  assert(!text.includes('jt-offline-'), '结果里出现了 jt- 明文');
  assert(!text.includes('invalid_personal_token'), '结果里出现了响应体原文');
}

function makeProvider(base, keyFile) {
  return {
    id: 'qoder-offline',
    name: 'Qoder',
    type: 'official',
    preset: 'qoder',
    endpoint: base,
    keySource: { kind: 'file', file: keyFile || KEY_FILE, var: 'QODER_PAT' },
    currency: 'CNY',
    unit: 'CREDITS',
    threshold: 100,
    fullAmount: 2000,
    intervalSec: 60,
    enabled: true,
  };
}

/** 本地假服务：mode = ok | usage401first | usage401always | exchange400 */
function startMock(mode) {
  const state = { mode: mode || 'ok', exchanges: 0, usages: 0, tokens: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/api/v1/jobToken/exchange') {
        state.exchanges++;
        let body = {};
        try { body = JSON.parse(raw); } catch (e) { body = {}; }
        if (state.mode === 'exchange400' || body.personal_token !== PAT) {
          res.statusCode = 400;
          res.end('{"error":"invalid_personal_token"}');
          return;
        }
        const token = 'jt-offline-' + state.exchanges;
        state.tokens.push(token);
        res.statusCode = 200;
        res.end(JSON.stringify({ token }));
        return;
      }
      if (req.method === 'GET' && req.url === '/sash/api/v2/me/usage') {
        state.usages++;
        const auth = String(req.headers.authorization || '');
        const token = auth.replace(/^Bearer\s+/i, '').trim();
        if (!/^jt-offline-\d+$/.test(token)) {
          res.statusCode = 401;
          res.end('{}');
          return;
        }
        if (state.mode === 'usage401always' || (state.mode === 'usage401first' && state.usages === 1)) {
          res.statusCode = 401;
          res.end('{}');
          return;
        }
        res.statusCode = 200;
        res.end(JSON.stringify(USAGE_BODY));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, state, base: 'http://127.0.0.1:' + server.address().port });
    });
  });
}
function stopMock(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function main() {
  try {
    // ---------------- 1. 配置归一化 ----------------
    await step('config: qoder 预设默认 base / key 文件 / unit=CREDITS / 名称', () => {
      const cfg = config.normalizeConfig({ providers: [{ id: 'q', type: 'official', preset: 'qoder' }] });
      const p = cfg.providers[0];
      assert.strictEqual(p.type, 'official');
      assert.strictEqual(p.preset, 'qoder');
      assert.strictEqual(p.endpoint, 'https://openapi.qoder.com.cn');
      assert.strictEqual(p.unit, 'CREDITS');
      assert.strictEqual(p.currency, 'CNY', 'currency 旧字段保持 CNY，显示走 unit/结果 currency');
      assert.strictEqual(p.name, 'Qoder');
      assert.deepStrictEqual(p.keySource, {
        kind: 'file', file: '~/.dsh/secrets/qoder-pat.txt', var: 'QODER_PAT',
      });
    });

    await step('config: endpoint 允许覆盖国际版（预设默认不覆盖用户值）', () => {
      const p = config.normalizeConfig({
        providers: [{ id: 'q', preset: 'qoder', endpoint: 'https://openapi.qoder.sh' }],
      }).providers[0];
      assert.strictEqual(p.endpoint, 'https://openapi.qoder.sh');
    });

    await step('config: 显式 keySource（env）不被预设默认覆盖', () => {
      const p = config.normalizeConfig({
        providers: [{ id: 'q', preset: 'qoder', keySource: { kind: 'env', var: 'QODER_PAT' } }],
      }).providers[0];
      assert.strictEqual(p.keySource.kind, 'env');
      assert.strictEqual(p.keySource.var, 'QODER_PAT');
      assert.strictEqual(p.keySource.file, '');
    });

    await step('config: defaultConfig 不自动塞 Qoder 供应商', () => {
      assert.strictEqual(config.defaultConfig().providers.length, 0);
      const names = config.normalizeConfig({}).providers.map((p) => p.preset);
      assert(!names.includes('qoder'), '默认配置里出现了 qoder');
    });

    await step('config: 旧配置 unit 推导不变（deepseek→CNY、openrouter→USD）', () => {
      const cfg = config.normalizeConfig({
        providers: [
          { id: 'd', type: 'official', preset: 'deepseek' },
          { id: 'o', type: 'official', preset: 'openrouter' },
          { id: 'x', type: 'custom', endpoint: 'http://127.0.0.1:1/x' },
        ],
      });
      assert.strictEqual(cfg.providers[0].unit, 'CNY');
      assert.strictEqual(cfg.providers[0].keySource.file, '', '旧预设 keySource 行为不许变');
      assert.strictEqual(cfg.providers[0].keySource.var, '');
      assert.strictEqual(cfg.providers[1].unit, 'USD');
      assert.strictEqual(cfg.providers[2].unit, 'CNY');
    });

    await step('config: unit 显式值大小写不敏感', () => {
      const p = config.normalizeConfig({
        providers: [{ id: 'x', type: 'custom', endpoint: 'http://127.0.0.1:1/x', unit: ' credits ' }],
      }).providers[0];
      assert.strictEqual(p.unit, 'CREDITS');
    });

    // ---------------- 2. 正常汇总 + 缓存 ----------------
    await step('query: 正常汇总 userQuota+addOn+org = 2177.00 CREDITS', async () => {
      providers.clearQoderTokenCache();
      const mock = await startMock('ok');
      try {
        const res = await providers.queryQoder(makeProvider(mock.base));
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.amount, 2177);
        assert.strictEqual(res.currency, 'CREDITS');
        assert.strictEqual(mock.state.exchanges, 1);
        assert.strictEqual(mock.state.usages, 1);
        assert.deepStrictEqual(mock.state.tokens, ['jt-offline-1']);
        assertNoSecret(res);
      } finally {
        await stopMock(mock.server);
      }
    });

    await step('cache: 20 分钟内同一 base+PAT 复用 jt-，不重复交换', async () => {
      providers.clearQoderTokenCache();
      const mock = await startMock('ok');
      try {
        const pc = makeProvider(mock.base);
        const first = await providers.queryQoder(pc);
        const second = await providers.queryQoder(pc);
        assert.strictEqual(first.ok, true);
        assert.strictEqual(second.ok, true);
        assert.strictEqual(second.amount, 2177);
        assert.strictEqual(mock.state.exchanges, 1, '第二次不应重新交换');
        assert.strictEqual(mock.state.usages, 2);
      } finally {
        await stopMock(mock.server);
      }
    });

    await step('cache: 超过 20 分钟 TTL 后重新交换', async () => {
      providers.clearQoderTokenCache();
      const mock = await startMock('ok');
      const realNow = Date.now;
      let fakeNow = realNow();
      try {
        Date.now = () => fakeNow;
        const pc = makeProvider(mock.base);
        assert.strictEqual((await providers.queryQoder(pc)).ok, true);
        assert.strictEqual(mock.state.exchanges, 1);
        fakeNow += providers.QODER_TOKEN_TTL_MS + 1000;
        assert.strictEqual((await providers.queryQoder(pc)).ok, true);
        assert.strictEqual(mock.state.exchanges, 2, 'TTL 过期后应重新交换');
      } finally {
        Date.now = realNow;
        await stopMock(mock.server);
      }
    });

    // ---------------- 3. usage 401 重换 ----------------
    await step('retry: usage 401 → 强制重换一次 → 成功（共 2 次交换）', async () => {
      providers.clearQoderTokenCache();
      const mock = await startMock('usage401first');
      try {
        const res = await providers.fetchProvider(makeProvider(mock.base), { rateCache: new Map() });
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.amount, 2177);
        assert.strictEqual(res.currency, 'CREDITS');
        assert.strictEqual(mock.state.exchanges, 2);
        assert.strictEqual(mock.state.usages, 2);
        assert.deepStrictEqual(mock.state.tokens, ['jt-offline-1', 'jt-offline-2']);
        assertNoSecret(res);
      } finally {
        await stopMock(mock.server);
      }
    });

    await step('retry: 重换后仍 401 → KEY_INVALID', async () => {
      providers.clearQoderTokenCache();
      const mock = await startMock('usage401always');
      try {
        const res = await providers.fetchProvider(makeProvider(mock.base), { rateCache: new Map() });
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.code, 'KEY_INVALID');
        assert.strictEqual(res.status, 401);
        assert.strictEqual(mock.state.exchanges, 2, '应强制重换一次');
        assertNoSecret(res);
      } finally {
        await stopMock(mock.server);
      }
    });

    // ---------------- 4. PAT 失效 / 缺失 ----------------
    await step('key: 交换 400（PAT 失效）→ KEY_INVALID，不发 usage', async () => {
      providers.clearQoderTokenCache();
      const mock = await startMock('exchange400');
      try {
        const res = await providers.fetchProvider(makeProvider(mock.base), { rateCache: new Map() });
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.code, 'KEY_INVALID');
        assert.strictEqual(res.status, 400);
        assert.strictEqual(mock.state.usages, 0);
        assertNoSecret(res);
      } finally {
        await stopMock(mock.server);
      }
    });

    await step('key: PAT 文件缺失 → KEY_FILE_MISSING，且不发任何请求', async () => {
      providers.clearQoderTokenCache();
      const mock = await startMock('ok');
      try {
        const missing = path.join(TMP_DIR, 'no-such-qoder-pat.txt');
        const res = await providers.fetchProvider(makeProvider(mock.base, missing), { rateCache: new Map() });
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.code, 'KEY_FILE_MISSING');
        assert.strictEqual(mock.state.exchanges, 0);
        assert.strictEqual(mock.state.usages, 0);
        assertNoSecret(res);
      } finally {
        await stopMock(mock.server);
      }
    });

    // ---------------- 5. 余额口径 ----------------
    await step('quota: remaining 缺失回退 total-used，坏池按 0，外层可缺 qoderUsage', () => {
      const amount = providers.qoderQuotaAmount({
        userQuota: { total: 100, used: 30 },
        addOnQuota: {},
        orgResourcePackage: { remaining: '12.345' },
      });
      assert.strictEqual(amount, 82.35);
    });

    await step('quota: 三池全缺 → PARSE_FAILED，detail 只写 qoder.quota', () => {
      assert.throws(
        () => providers.qoderQuotaAmount({ qoderUsage: {} }),
        (e) => e && e.pbCode === 'PARSE_FAILED' && e.pbDetail === 'qoder.quota'
      );
      assert.throws(
        () => providers.qoderQuotaAmount('not-json-object'),
        (e) => e && e.pbCode === 'PARSE_FAILED' && e.pbDetail === 'qoder.quota'
      );
    });
  } finally {
    providers.clearQoderTokenCache();
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }

  const summary = { pass: checks.filter((c) => c.pass).length, fail: checks.filter((c) => !c.pass).length };
  console.log('汇总：PASS=' + summary.pass + ' FAIL=' + summary.fail);
  process.exitCode = summary.fail ? 1 : 0;
}

main().catch((e) => {
  console.error('测试异常：' + safeDetail(e && e.stack || e));
  process.exitCode = 1;
});