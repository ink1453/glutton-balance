'use strict';
// 饭桶余额 Mac 显示窗 · 余额来源（**薄壳转发**，第 27 轮双端统一）
//
// 第 27 轮起，请求/解析/退避/Qoder 的全部逻辑搬到工作区根目录共享核心：
//     shared/providers-core.js   ← Mac / Win 两端共用的唯一实现
// 本文件只做三件事：
//   1. 把 Mac 端真实的 logger 注入共享核心（核心自己不 require('./logger')，
//      因为 Win 端没有这个模块；注入后核心内的日志调用行为与第 26 轮完全一致）；
//   2. 把共享核心的 23 个业务导出**原样转发**（对外 API 与第 26 轮逐项一致）；
//   3. 保持路径不变 —— main.js 第 15 行 `require('./src/providers')` 是红线不能动。
//
// app-win 将来直接 require('<repo>/shared/providers-core.js')，自行注入自己的日志实现。
const core = require('../../shared/providers-core');
const logger = require('./logger');

// 日志端口注入：让共享核心用 Mac 的 panel.log（256KB 轮转 / 脱敏）写日志
core.setLogger(logger);

module.exports = {
  ProviderManager: core.ProviderManager,
  fetchProvider: core.fetchProvider,
  verifyKey: core.verifyKey,
  loadKey: core.loadKey,
  demoViews: core.demoViews,
  resolvePath: core.resolvePath,
  round2: core.round2,
  OFFICIAL_URLS: core.OFFICIAL_URLS,
  ERROR_CODES: core.ERROR_CODES,
  ERROR_TEXT: core.ERROR_TEXT,
  errorText: core.errorText,
  classifyHttpStatus: core.classifyHttpStatus,
  classifyNodeError: core.classifyNodeError,
  redact: core.redact,
  pathTail: core.pathTail,
  KEY_FALLBACKS: core.KEY_FALLBACKS,
  // Qoder（离线用例直接调用；原有导出保持不变）
  queryQoder: core.queryQoder,
  exchangeQoderJobToken: core.exchangeQoderJobToken,
  clearQoderTokenCache: core.clearQoderTokenCache,
  qoderQuotaAmount: core.qoderQuotaAmount,
  httpPost: core.httpPost,
  QODER_DEFAULT_ENDPOINT: core.QODER_DEFAULT_ENDPOINT,
  QODER_TOKEN_TTL_MS: core.QODER_TOKEN_TTL_MS,
};
