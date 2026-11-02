# AI-INSTALL · 饭桶余额（GluttonBalance）AI 一键安装说明

> 这份文件是写给**能执行命令的 AI 助手**看的：用户把本文件链接交给你，请按下面步骤在他的电脑上完成「安装 / 更新」，并在每一步失败时**停下、原样报告**（不要猜、不要绕过）。
> 本文件**不要求、不读取、不上传任何 API key / token / 密码**；只安装本清单列出的包与 Release 资产。
> 产品仓库：<https://github.com/ink1453/pet-balance-panel> ｜ npm：<https://www.npmjs.com/package/pet-balance-world> ｜ 许可证 MIT

**安装目标由两部分组成（缺一不可）**：

| 部件 | 是什么 | 从哪装 |
|---|---|---|
| ① Coopanion World 扩展 | 设置页 / 配置入口（npm 包 `pet-balance-world`） | Coopanion 本地安装 API（§2）或市场手动（§3） |
| ② 显示窗程序 | 桌宠头顶/脚边的饭桶窗口（Windows C# / macOS Electron） | GitHub Release 源码包，本机构建安装（§4） |

**前置条件**：Coopanion **0.2.16+**（World API 6）；macOS 14+ / Apple 芯片（arm64）或 Windows 10/11 64 位（.NET Framework 4.8）。

---

## 1. 先探测环境（只读，不改任何东西）

```bash
uname -s                                   # Darwin = macOS
curl -s -m 5 http://127.0.0.1:17788/api/extensions/index-base
```

- 第二条命令能返回 JSON（含 `base`）→ Coopanion 正在运行且本地 API 可达（Mac 实测默认端口 **17788**；Windows 客户端同理，端口以客户端实际为准）。
- 返回空/连接失败 → 不要猜端口；直接走 §3 让用户在扩展市场手动安装。

---

## 2. 安装 / 更新扩展（推荐：Coopanion 本地安装 API，无需登录）

```bash
# 安装或更新到最新版（等价于在扩展市场点「安装 / 更新」）
curl -s -X POST http://127.0.0.1:17788/api/extensions/install \
  -H 'content-type: application/json' \
  -d '{"name":"pet-balance-world"}'
```

- 成功返回形如 `{"ok":true,"result":"...","restartRequired":true}`。
- **不要自动重启 Coopanion**；请告诉用户：「重启 Coopanion 后扩展生效」。
- 需要固定版本时：`-d '{"name":"pet-balance-world","version":"<目标版本，如 0.0.4>"}'`。
- 返回错误 / 非 2xx → **停下报告**（附返回内容），并改用 §3 让用户手动安装。
- 卸载（**仅在用户明确要求时**）：把同一地址换成 `/api/extensions/uninstall`，body `{"name":"pet-balance-world"}`。

---

## 3. 备用方案：扩展市场手动安装

请用户操作：**Coopanion → 扩展 → World 扩展 → 扩展市场 → 搜索「饭桶余额」→ 安装/更新 → 重启 Coopanion**。
（补充：本包在市场分类「诊断与维护」，默认按认证优先排序，搜索最稳。）

---

## 4. 安装显示窗程序（必须；按系统二选一）

### 4.1 找最新 Release 资产（两个平台通用）

```bash
curl -s https://api.github.com/repos/ink1453/pet-balance-panel/releases/latest
```

- 资产名形如：`pet-balance-panel-mac-<版本>-src.zip`（macOS）/ `pet-balance-panel-x-<版本>-src.zip`（Windows）。
- 下载 `.browser_download_url` 对应的 zip 到临时目录并解压。
- 如果 GitHub API 不可达，请用户打开 Release 页面手动下载：<https://github.com/ink1453/pet-balance-panel/releases/latest>

### 4.2 macOS（macOS 14+ / Apple 芯片 arm64）

1. 解压 `pet-balance-panel-mac-<版本>-src.zip`。
2. 下载 Electron 38.8.6 arm64 运行时（官方 `electron-v38.8.6-darwin-arm64.zip`），解压得到 `Electron.app`；放进 `mac/tools/Electron.app`，构建时用 `--electron-src=<路径>` 指定（运行时不进仓库）。
3. 构建 + 安装：

   ```bash
   cd <解压目录>/mac
   ./build/build-app.sh --electron-src=<Electron.app 路径>
   ./build/install.sh            # 装到 ~/Applications/饭桶余额.app + 写登录自启
   # 没装 DSH 时：./build/install.sh --no-autostart 只装 App
   ```

4. 首次打开：Finder 里**右键 →「打开」**（ad-hoc 未签名，双击会被拦一次）。
5. 屏幕录制权限（识别桌宠位置必需）：系统设置 → 隐私与安全性 → 屏幕录制；DSH 载体方案授权给 **DeepSeek Harness**，手动方案授权给「饭桶余额」。详见仓库 `mac/INSTALL.md` §4。

### 4.3 Windows（Windows 10/11 64 位）

1. 解压 `pet-balance-panel-x-<版本>-src.zip` 到 `%USERPROFILE%\.dsh\pet-balance-panel`（推荐默认位置；放别处请设环境变量 `PET_BALANCE_PANEL_DIR`）。
2. 编译 + 安装（PowerShell）：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
   ```

3. 首次运行若出现「Windows 已保护你的电脑」：点「更多信息 → 仍要运行」（源码自建、未签名，属正常）。

---

## 5. 验证（装完逐条检查，失败就报告）

```bash
# 扩展（重启 Coopanion 后）
curl -s 'http://127.0.0.1:17788/api/extensions/package?name=pet-balance-world'
#   → installed: true、version 应为本次安装的版本
```

- macOS：`ls ~/Applications/饭桶余额.app` 存在；Windows：`%USERPROFILE%\.dsh\pet-balance-panel\panel.exe` 存在。
- 功能：桌宠头顶/脚边出现小饭桶；Coopanion 的「饭桶余额」设置页能打开、能保存。
- 若有旧版本设置页：让用户刷新页面后再保存，避免旧表单写回旧格式。

---

## 6. 安全边界（给 AI 的硬约束）

- 只安装：npm 包 `pet-balance-world`、本仓库 Release 资产；**不要**从其它来源安装任何东西。
- **不要读取 / 打印 / 上传**用户任何 key、token、密钥文件；本产品的 key 由用户自己在设置页/配置文件里填（可选），安装流程完全不需要它。
- 不要修改系统安全设置；屏幕录制等权限由用户手动授予。
- 卸载扩展/显示窗属于**破坏性操作**，必须得到用户明确同意后才做。

---

## 7. 回滚

- 扩展：`POST /api/extensions/uninstall`，body `{"name":"pet-balance-world"}`（需用户同意）。
- 显示窗：macOS `./build/uninstall.sh`；Windows `powershell -File .\uninstall.ps1`。
- 配置默认保留在 `~/.dsh/pet-balance-panel/config.json`（macOS）/ `%USERPROFILE%\.dsh\pet-balance-panel\config.json`（Windows），卸载不会删除（除非加 `-PurgeFiles`）。

---

## 8. 机器可读摘要（给 Agent 解析）

```json
{
  "product": "GluttonBalance / 饭桶余额",
  "repo": "https://github.com/ink1453/pet-balance-panel",
  "npm": "pet-balance-world",
  "requires": { "coopanion": ">=0.2.16", "worldApi": 6 },
  "extensionInstall": {
    "api": "POST http://127.0.0.1:17788/api/extensions/install",
    "body": { "name": "pet-balance-world", "version": "optional" },
    "restartRequired": true
  },
  "extensionUninstall": {
    "api": "POST http://127.0.0.1:17788/api/extensions/uninstall",
    "body": { "name": "pet-balance-world" },
    "userConsentRequired": true
  },
  "panel": {
    "releaseApi": "https://api.github.com/repos/ink1453/pet-balance-panel/releases/latest",
    "macAssetPattern": "pet-balance-panel-mac-*-src.zip",
    "winAssetPattern": "pet-balance-panel-x-*-src.zip",
    "macBuild": "./mac/build/build-app.sh && ./mac/build/install.sh",
    "winBuild": ".\\build.ps1 && .\\install.ps1"
  },
  "noSecretsRequired": true
}
```

---

> 维护：本文件随版本更新；如发现步骤与现场不符，以仓库 `INSTALL.md` / `mac/INSTALL.md` 为准并回报项目维护者。
