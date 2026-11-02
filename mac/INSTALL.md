# INSTALL · 饭桶余额 macOS 显示窗（源码 · v0.0.4）

本目录是 **macOS 版**「饭桶余额」显示窗的源码包，配合 Coopanion 的 `glutton-balance` 扩展使用。本文说明从源码到安装的完整步骤。

> 本源码包**不自带 Electron 运行时，也不带已编译的 .app**：需要本机用官方 Electron 运行时打一次包。程序为源码自建、用**本机自签证书**签名（默认 `Maizi Local Code Signing`，可用 `SIGN_IDENTITY` 覆盖），首次打开可能被 Gatekeeper 提示，属正常现象（见 §4）。

## 1. 前置条件

- **macOS 14 或更高**，**Apple 芯片（arm64）**
- **Coopanion 0.2.16+**（World API 6）
- 已在 Coopanion 里安装并启用 **「饭桶余额」** 扩展（`glutton-balance`）
- **Electron 38.8.6 arm64 运行时**：从 Electron 官方发布页下载 `electron-v38.8.6-darwin-arm64.zip`，解压后把 `Electron.app` 放到本目录的 `tools/Electron.app`（或任意位置，构建时用 `--electron-src=<路径>` 指定）。运行时体积较大，不进仓库。
- **代码签名证书**：打包脚本默认使用本机自签证书 `Maizi Local Code Signing`（规矩：**禁 ad-hoc**——ad-hoc 每次重打包屏幕录制授权都会失效）。
  没有该证书时用环境变量指定自己的证书：`SIGN_IDENTITY="你的证书名" ./build/build-app.sh`；全新机器可在「钥匙串访问 → 证书助理 → 创建证书」建一张「代码签名」用途的自签证书。
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
- 环境变量：`SIGN_IDENTITY=<证书名>`（默认 `Maizi Local Code Signing`）
- 脚本会：复制 Electron 运行时 → 注入 `main.js / preload.js / src / renderer / assets / native` → 改名字/bundle id/版本/无 Dock 图标 → **本机证书签名 + 硬校验**（`--verify --deep --strict`、`Authority`、`flags=0x0`，不满足就拒绝出包）。

## 3. 安装

```bash
./build/install.sh
```

- 装到 `~/Applications/饭桶余额.app`
- 写登录自启 `~/Library/LaunchAgents/com.gluttonbalance.panel.plist`：
  - 方案 = **launchd 直启 App**：`ProgramArguments = [~/Applications/饭桶余额.app/Contents/MacOS/Electron, --autostart]`；
    `RunAtLoad=true`、`KeepAlive=true`（退出后自动拉起）、`LimitLoadToSessionType=Aqua`、`ProcessType=Interactive`、`ThrottleInterval=10`。
  - 不写 `ELECTRON_RUN_AS_NODE`，不依赖其它宿主程序（旧版「DSH 载体」方案已下线，历史遗留自动清理）。
- 其它参数：`--no-autostart`（只装 App 不写自启）、`--no-start`（写自启但不立刻启动）、`--dry-run`（只打印计划）、`--app=<别的.app>`（指定源包）。
- 不动系统设置、不代点任何权限弹窗。
- 日常开发改完代码，用一键闭环：`./build/dev-install.sh`（打包 + 备份旧安装 + 安装 + 重启显示窗 + 冒烟；`--dry-run` 只打印计划）。

## 4. 首次运行与权限

1. 首次打开：Finder 里双击 `~/Applications/饭桶余额.app` 即可；若被 Gatekeeper 拦（从别的机器拷来的包），右键 →「打开」一次。
2. **屏幕录制权限（必须）**：系统设置 → 隐私与安全性 → 屏幕录制 → 给 **「饭桶余额」** 打开开关（首次启动会弹权限引导小窗，跟着点即可）。
   授权后必须**把 App 完全退出再打开**（屏幕录制必须重启进程才生效）。登录自启（launchd 直启）也认同一条授权。
3. 显示窗启动后会出现一个菜单栏图标：立即刷新 / 展开明细 / 打开配置目录 / 退出。
4. 打开 Coopanion 的「饭桶余额」设置页，填写余额来源（官方接口 / new-api 中转站 / 自定义接口，或「大白饭」演示档）→ 点「保存」。显示窗约 5 秒内自动热载生效。

## 5. 配置

- 配置文件：`~/.dsh/glutton-balance/config.json`（默认路径；可用 `GLUTTONBALANCE_PANEL_DIR` / `GLUTTONBALANCE_PANEL_CONFIG` 覆盖）。
- 改名兼容（2026-11-02）：新变量 `GLUTTONBALANCE_PANEL_*` 优先、旧变量 `PET_BALANCE_PANEL_*` 仍兼容；首次启动若新目录没有 `config.json` 且旧目录 `~/.dsh/pet-balance-panel/config.json` 存在，会自动迁移 `config.json`、`bowls/`、`rice/` 到新目录（旧目录保留、幂等、不覆盖）。
- 与 Windows 版**同一份配置格式**：`providers`、`display`（含 `wear` 固定 `head`）、`interaction`、`theme`、`position` 等字段一致。
- **内置饭桶外观三款**：白瓷（默认，`porcelain`）/ 黑陶（`black`）/ 不锈钢（`steel`）；旧配置里的**搪瓷（`enamel`）已下线**，会自动回退白瓷（日志有 WARN 提示，不报错）。
- `keySource` 里的文件路径支持 `~`、`$VAR`、`%VAR%` 展开：**Windows 示例中的 `%USERPROFILE%\.dsh\.env` 在 macOS 上请改成 `~/.dsh/.env`**。
- 日志：`~/.dsh/glutton-balance/panel.log`；LaunchAgent 日志：`~/Library/Logs/饭桶余额/`。

## 6. 更新 / 卸载

- 更新（日常开发一键闭环）：

```bash
./build/dev-install.sh            # 重打 + 备份旧安装 + 安装 + 重启显示窗 + 冒烟
./build/dev-install.sh --dry-run  # 只看计划
./build/dev-install.sh --no-build # 用现有产物安装（不重新打包）
```

- 更新（手动两步）：`./build/build-app.sh` → `./build/install.sh`（幂等，会覆盖旧 App 与自启）。
- 卸载：

```bash
./build/uninstall.sh              # 删 App + 自启，保留用户配置与日志
./build/uninstall.sh --keep-app   # 只删自启，保留 App
./build/uninstall.sh --dry-run    # 干跑看计划
./build/uninstall.sh --purge --yes  # 连用户配置一起删（明确确认后）
```

## 7. 已知限制

- **本机自签 / 未公证**：换机器分发会被 Gatekeeper 拦；分发前建议用开发者证书（Developer ID）签名并公证。
- 仅 **Apple 芯片（arm64）**；Intel Mac 需自行替换 Electron 运行时并重编 `native/petprobe`（未适配）。
- 固定**头顶**形态；脚下形态在 macOS 上不适用。
- 多显示器 / 外接屏未实测。
- 首次使用需给「饭桶余额」授一次屏幕录制权限；未授权时显示窗退回上次/屏幕中间位置（`panel.log` 里 `place src=fallback-*`），授权后重启 App 才 `place src=detect`。
- 只读余额接口，不调模型、不扣额度、不上报数据。

## 8. 安全说明

打包完成后建议跑一次包内容扫描，确认包里没有本机路径 / 用户名 / 密钥 / 开发垃圾：

```bash
./build/scan-package.sh --strict
```

退出码 0 = 通过；1 = 有真问题；2 = 用法错误。
