# INSTALL · 饭桶余额 macOS 显示窗（源码 · v0.0.3）

本目录是 **macOS 版**「饭桶余额」显示窗的源码包，配合 Coopanion 的 `pet-balance-world` 扩展使用。本文说明从源码到安装的完整步骤。

> 本源码包**不自带 Electron 运行时，也不带已编译的 .app**：需要本机用官方 Electron 运行时打一次包。程序为源码自建、**ad-hoc 未签名**，首次打开会被 Gatekeeper 提示，属正常现象（见 §4）。

## 1. 前置条件

- **macOS 14 或更高**，**Apple 芯片（arm64）**
- **Coopanion 0.2.16+**（World API 6）
- 已在 Coopanion 里安装并启用 **「饭桶余额」** 扩展（`pet-balance-world`）
- **Electron 38.8.6 arm64 运行时**：从 Electron 官方发布页下载 `electron-v38.8.6-darwin-arm64.zip`，解压后把 `Electron.app` 放到本目录的 `tools/Electron.app`（或任意位置，构建时用 `--electron-src=<路径>` 指定）。运行时体积较大，不进仓库。
- 可选：**DeepSeek Harness（DSH）**。macOS 上「饭桶余额」自身的屏幕录制授权无法生效（系统限制），登录自启默认用 DSH 主程序当载体，让显示窗继承 DSH 的屏幕录制授权。没装 DSH 也能跑，只是自启方式不同（见 §3 与 §4）。
- 打包脚本依赖：`bash`、`ditto`、`codesign`、`PlistBuddy`（macOS 自带）；`jq` 可选（没有时用 `build/runtime-package.json` 兜底）。

## 2. 打包

在本目录执行：

```bash
./build/build-app.sh
```

- 产物：`build/dist/饭桶余额.app`
- 常用参数：
  - `--electron-src=<路径>`：指定 Electron 运行时（等价于 `ELECTRON_SRC` 环境变量）
  - `--with-scan`：打包后顺便跑一次包内容安全扫描
  - `--dummy`：用内置假工程验证打包链路（不产出正式包）
- 脚本会：复制 Electron 运行时 → 注入 `main.js / preload.js / src / renderer / assets / native` → 改名字/bundle id/版本/无 Dock 图标 → ad-hoc 签名 → 校验产物。

## 3. 安装

```bash
./build/install.sh
```

- 装到 `~/Applications/饭桶余额.app`
- 写登录自启 `~/Library/LaunchAgents/com.ricebowl.petbalancepanel.plist`：
  - 默认方案 = **DSH 载体**：LaunchAgent 以 Node 模式启动 DeepSeek Harness 主程序，由守护壳 `~/.dsh/pet-balance-panel/launch-via-dsh.mjs` spawn 显示窗，显示窗继承 DSH 的屏幕录制授权。**要求本机已安装 DSH**（默认路径 `/Applications/DeepSeek Harness.app`），否则脚本会报错。
  - 没有 DSH：用 `./build/install.sh --no-autostart` 只装 App，不写自启；之后手动双击/命令行启动，并按 §4 给权限。
- 其它参数：`--no-start`（写自启但不立刻启动）、`--dry-run`（只打印计划）、`--app=<别的.app>`（指定源包）。
- 不动系统设置、不代点任何权限弹窗。

## 4. 首次运行与权限

1. 首次打开：Finder 里**右键 →「打开」**（ad-hoc 未签名，双击会被拦一次）。
2. **屏幕录制权限**：显示窗需要该权限才能识别桌宠窗口位置。
   - DSH 载体方案：授权给 **DeepSeek Harness**（系统设置 → 隐私与安全性 → 屏幕录制），显示窗继承即可；
   - 手动启动方案：在「隐私与安全性 → 屏幕录制」里给「饭桶余额」打开开关，按系统提示重启 App。
   - 本机实测「饭桶余额」自身的屏幕录制授权可能无法生效（macOS 限制），此时优先用 DSH 载体方案。
3. 显示窗启动后会出现一个菜单栏图标：立即刷新 / 展开明细 / 打开配置目录 / 退出。
4. 打开 Coopanion 的「饭桶余额」设置页，填写余额来源（官方接口 / new-api 中转站 / 自定义接口，或「大白饭」演示档）→ 点「保存」。显示窗约 5 秒内自动热载生效。

## 5. 配置

- 配置文件：`~/.dsh/pet-balance-panel/config.json`（默认路径；可用 `PET_BALANCE_PANEL_DIR` / `PET_BALANCE_PANEL_CONFIG` 覆盖）。
- 与 Windows 版**同一份配置格式**：`providers`、`display`（含 `wear` 固定 `head`）、`interaction`、`theme`、`position` 等字段一致。
- `keySource` 里的文件路径支持 `~`、`$VAR`、`%VAR%` 展开：**Windows 示例中的 `%USERPROFILE%\.dsh\.env` 在 macOS 上请改成 `~/.dsh/.env`**。
- 日志：`~/.dsh/pet-balance-panel/panel.log`；LaunchAgent 日志：`~/Library/Logs/饭桶余额/`。

## 6. 更新 / 卸载

- 更新：重新 `./build/build-app.sh` → `./build/install.sh`（幂等，会覆盖旧 App 与自启）。
- 卸载：

```bash
./build/uninstall.sh              # 删 App + 自启，保留用户配置与日志
./build/uninstall.sh --keep-app   # 只删自启，保留 App
./build/uninstall.sh --dry-run    # 干跑看计划
./build/uninstall.sh --purge --yes  # 连用户配置一起删（明确确认后）
```

## 7. 已知限制

- **未签名 / 未公证**：换机器分发会被 Gatekeeper 拦；分发前建议用开发者证书签名并公证。
- 仅 **Apple 芯片（arm64）**；Intel Mac 需自行替换 Electron 运行时并重编 `native/petprobe`（未适配）。
- 固定**头顶**形态；脚下形态在 macOS 上不适用。
- 多显示器 / 外接屏未实测。
- 登录自启依赖 DSH 载体（继承屏幕录制授权）；没有 DSH 时用 `--no-autostart` 手动启动并自行授权。
- 只读余额接口，不调模型、不扣额度、不上报数据。

## 8. 安全说明

打包完成后建议跑一次包内容扫描，确认包里没有本机路径 / 用户名 / 密钥 / 开发垃圾：

```bash
./build/scan-package.sh --strict
```

退出码 0 = 通过；1 = 有真问题；2 = 用法错误。
