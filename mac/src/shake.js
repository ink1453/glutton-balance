'use strict';
// 饭桶余额 · 摇一摇手势检测（**薄壳转发**，第 27 轮双端统一）
//
// 第 27 轮起实现搬到工作区根目录共享核心 shared/shake.js（纯函数、零依赖，两端都能量）。
// 本文件保留的原因：main.js 第 17 行 `require('./src/shake')` 是红线不能动，
// 所以用「同路径薄壳」把调用原地转给共享实现，保证 Mac 端只有一份摇一摇逻辑。
// app-win 将来直接 require('<repo>/shared/shake.js')。
const core = require('../../shared/shake');

module.exports = {
  ShakeDetector: core.ShakeDetector,
  normalizeShake: core.normalizeShake,
  DEFAULTS: core.DEFAULTS,
};
