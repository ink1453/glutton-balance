'use strict';
// 饭桶余额 Mac 显示窗 · 配置加载与归一化（**薄壳转发**，第 27 轮双端统一）
//
// 第 27 轮起，真正的归一化逻辑已搬到工作区根目录的共享核心：
//     shared/config-core.js   ← Mac / Win 两端共用的唯一实现
// 本文件只做两件事：
//   1. 把共享核心的 18 个导出**原样转发**（对外 API 与第 26 轮逐项一致）；
//   2. 保留 Mac 端特有的 `./shake` 依赖链（main.js / logger.js / layout.js 都经由这里间接拿到它）。
//
// 为什么还要留着这个文件：main.js 第 11 行 require('./src/config')、logger.js、layout.js
// 都指向这里；本轮红线是不动 main.js，所以用「同路径薄壳」保证零改动接入。
// 将来 Win 端（app-win）直接 require('<repo>/shared/config-core.js') 即可，不经过本文件。
const core = require('../../shared/config-core');

module.exports = {
  defaultConfig: core.defaultConfig,
  normalizeConfig: core.normalizeConfig,
  configPath: core.configPath,
  userDir: core.userDir,
  readConfigFile: core.readConfigFile,
  expandPath: core.expandPath,
  migrateLegacyUserData: core.migrateLegacyUserData,
  OFFICIAL_PRESETS: core.OFFICIAL_PRESETS,
  MAX_PROVIDERS: core.MAX_PROVIDERS,
  providerDefaultKeySource: core.providerDefaultKeySource,
  normalizeProvider: core.normalizeProvider,
  normalizeUnit: core.normalizeUnit,
  ENV_DIR: core.ENV_DIR,
  ENV_CONFIG: core.ENV_CONFIG,
  ENV_LOG: core.ENV_LOG,
  LEGACY_ENV_DIR: core.LEGACY_ENV_DIR,
  LEGACY_ENV_CONFIG: core.LEGACY_ENV_CONFIG,
  LEGACY_ENV_LOG: core.LEGACY_ENV_LOG,
};
