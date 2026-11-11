# 主程序接入点（Lead 改 main.js / preload.js 时对照）

> 打包侧已经把这些外部条件准备齐了；这里是「主程序需要配合的点」+「当前实现状态」+「已知限制」。
> 打包脚本只写 `build/`，**不改主程序**；下面带 ⚠️ 的项需要 Lead 决定是否改主程序。

## 1. 打包后主程序的运行环境（事实）

| 项 | 打包后的值 |
|---|---|
| `__dirname`（= `APP_ROOT`） | `饭桶余额.app/Contents/Resources/app` |
| `assets/` | `…/Resources/app/assets/`（三款饭桶 + rice + config.example.json + `trayTemplate.png`） |
| `native/petprobe` | `…/Resources/app/native/petprobe`（**可执行位 + 单独用本机自签证书签名**，build-app.sh 保证） |
| `permission.html` | `…/Resources/app/permission.html` |
| `renderer/index.html` | `…/Resources/app/renderer/index.html` |
| 托盘模板图 | `…/Resources/app/assets/trayTemplate.png`（16×16）+ `…@2x.png`（32×32） |
| `app.getVersion()` | 工程版本（当前 `0.0.6`，来自 Info.plist `CFBundleShortVersionString`） |
| `app.getName()` | `饭桶余额`（`app.setName` 已做；Info.plist `CFBundleName` 也是它） |
| 启动参数（登录自启） | launchd 直启 `饭桶余额.app/Contents/MacOS/Electron --autostart`（见 §2） |
| 进程环境 | launchd 直启，环境干净：**没有** `ELECTRON_RUN_AS_NODE`（该变量只在 DSH 会话 shell 里出现，plist 绝不写它） |

## 2. 登录自启方案（2026-11-01 第 11 轮起 = 「launchd 直启 App」）

- App 已用**本机自签证书** `Maizi Local Code Signing` 签名（`build-app.sh` 硬校验，禁 ad-hoc）→
  显示窗自己就能持有「屏幕录制」授权，**不再需要 DeepSeek Harness 当载体**（旧 DSH 载体方案已下线）。
- `~/Library/LaunchAgents/com.gluttonbalance.panel.plist` 关键内容：
  - `Label = com.gluttonbalance.panel`
  - `ProgramArguments = [~/Applications/饭桶余额.app/Contents/MacOS/Electron, --autostart]`（用 `$HOME` 展开成实际用户路径）
  - `RunAtLoad = true`、`KeepAlive = true`（退出后 launchd 自动拉起）、`LimitLoadToSessionType = Aqua`
  - `ProcessType = Interactive`、`ThrottleInterval = 10`
  - `StandardOutPath/StandardErrorPath = ~/Library/Logs/饭桶余额/launch.log / launch.err.log`
  - **没有** `ELECTRON_RUN_AS_NODE`、**没有** DSH 路径、**没有** `launch-via-dsh.mjs` 守护壳。
- 旧世代遗留（`~/.dsh/pet-balance-panel/launch-via-dsh.mjs`、旧 bundle id `com.ricebowl.*` 的 plist）
  由 `install.sh` / `uninstall.sh` 顺手清理，不会两套自启打架；改名前的本机旧 label 不写入源码（R-42 隔离口径）。
- **改名兼容（2026-11-02）**：配置目录默认 `~/.dsh/glutton-balance`；首次启动若新目录没有 `config.json`
  且旧目录 `~/.dsh/pet-balance-panel/config.json` 存在，会自动复制 `config.json`、`bowls/`、`rice/` 到新目录
  （旧目录原样保留、幂等、不覆盖新文件，`panel.log` 记一行迁移说明）；环境变量 `GLUTTONBALANCE_PANEL_*`
  优先、旧变量 `PET_BALANCE_PANEL_*` 仍兼容。
- `--autostart` 参数由 launchd 固定传入；主程序解析后暂未使用（见 §3.1 建议）。
- 日常开发更新走 `build/dev-install.sh`：打包 → 备份旧安装 → ditto 安装 → bootout/bootstrap/kickstart → 冒烟。

## 3. 主程序接入点现状

### ✅ 3.1 `--autostart`（登录自启参数）已解析；建议再补「别弹引导窗」

`parseArgs()` 已识别 `--autostart`（字段 `out.autostart`），但主程序里暂未使用。
登录自启（plist 带 `--autostart`）时如果**还没有屏幕录制权限**，每次登录仍会弹「权限引导」小窗。
建议（一行逻辑）：`if (ARGS.autostart && !checkScreenPermission()) { 只写日志 + 托盘菜单给「去开权限」入口；不弹窗 }`。
- 影响：老板每次开机被弹窗打扰；不补也能用（只是烦），不影响安装/启动。
- 打包侧已在 LaunchAgent 里固定传这个参数，补不补都不影响安装。

### ✅ 3.2 `--shot` 默认出图目录已改到 /tmp（不再破坏签名）

最终源码已是 `shotOutDir = outDir || path.join(os.tmpdir(), 'pbp-shots')`，不会写进 .app 内部，代码签名不会被破坏。✔ 已解决。

### ⚠️ 3.3 `--click` 依赖「辅助功能」，发布路径不要用

`--click` 用 CGEvent 注入点击做自测，需要辅助功能授权；本版**不申请**辅助功能（Mac 上抬升桌宠也被系统弹回）。
建议：`--click` 只留开发自测；安装/自启/交付说明里不要引导用户开辅助功能（PERMISSIONS.md 已写「可选、本版不用」）。

## 4. 版本号口径

- 打包版本：`CFBundleShortVersionString=0.0.6`、`CFBundleVersion=1`（`build-app.sh` 顶部常量 `APP_VERSION`，与 `app-mac/package.json` 同号；发布新版改 `build-app.sh` 这一处 + `package.json` + 重新打包）。
- 主程序 `main.js` 的 `APP_VERSION` 已统一为 `0.0.6`（第 11 轮由历史值 `0.1.0` 修正，`panel.log` 的 `start 饭桶余额 v0.0.6` 即来自它）。
- 更好的做法（后续可做）：改成 `app.getVersion()` 读 Info.plist，单一来源更稳。

## 5. 打包侧已保证（不用主程序操心）

- Info.plist：`CFBundleName/CFBundleDisplayName=饭桶余额`、`CFBundleIdentifier=com.gluttonbalance.panel`、
  `CFBundleShortVersionString=0.0.6`、`CFBundleVersion=1`、`CFBundleIconFile=app.icns`、`LSUIElement=true`、
  `NSHighResolutionCapable=true`、`LSMinimumSystemVersion=14.0`、`CFBundleExecutable=Electron`。
- 应用图标：`Contents/Resources/app.icns` = `build/icon/app.icns`（白瓷饭桶 1024 → 10 尺寸）。
- 托盘模板图：`app/assets/trayTemplate.png` + `@2x`。
- 进包源码：`main.js`、`preload.js`、`permission.html`、`package.json`（去 dev 字段/scripts）、`src/`、`renderer/`、`assets/`、`native/`；
  **不带** `test/`、`build/`、`tools/`、`docs/`、`.DS_Store`、`node_modules`。
- 签名：本机自签证书 `Maizi Local Code Signing`——先单独签 `native/petprobe`，再 `codesign --force --deep --sign "Maizi Local Code Signing"` 签 App 本体；硬校验 `--verify --deep --strict` + `Authority` + `flags=0x0`（不用 ad-hoc）。
- 安装：`~/Applications/饭桶余额.app` + `~/Library/LaunchAgents/com.gluttonbalance.panel.plist`（RunAtLoad、KeepAlive、Aqua 会话）。

## 6. 验收清单（打包侧按这个跑）

```bash
cd app-mac/build
./icon/make-icon.sh                 # 图标幂等
./build-app.sh                      # → dist/饭桶余额.app
./scan-package.sh                   # 退出码 0；报告 dist/package-scan.txt
./dev-install.sh --dry-run          # 干跑：看会打包/备份/安装/重启什么，不改机器
./dev-install.sh                    # 一键闭环：打包 + 备份 + 安装 + kickstart + 冒烟
launchctl print gui/$(id -u)/com.gluttonbalance.panel   # 自启任务在（直启 App）
ps aux | grep "饭桶余额.app/Contents/MacOS/Electron"        # 进程在
tail -n 20 ~/.dsh/glutton-balance/panel.log               # 启动日志正常（start ... v0.0.6 / place src=...）
# 出图证据（不需要屏幕录制权限）：
env -u ELECTRON_RUN_AS_NODE \
  "$HOME/Applications/饭桶余额.app/Contents/MacOS/Electron" \
  --demo=9 --capture=/tmp/pbp-panel.png --capture-wait=8
./uninstall.sh --dry-run            # 干跑：只打印计划（LaunchAgent / 旧世代遗留 / plist 备份），不删任何东西
./uninstall.sh                      # 清理（删 LaunchAgent + 旧世代遗留；默认保留用户配置与日志）
```

## 7. 权限 / TCC 归属要知道的

- 屏幕录制授权对象是 **`.app`（bundle id + 证书身份）**；用本机自签证书签名后重新打包**身份不变**，TCC 不会再把它当新程序反复问（ad-hoc 才会按 cdhash 每次变、导致授权死循环——所以老板 2026-11-01 定了只用本机证书）。
- 登录自启 = launchd 直启 App：**要给「饭桶余额」授权一次**（系统设置 → 隐私与安全性 → 屏幕录制）。授权后重启 App 生效。
- petprobe 是 app 子进程，TCC 按「责任进程」判权 → **只需给 `饭桶余额.app` 授权一次**，petprobe 跟着生效。
- 把 app 换目录（比如从 `~/Applications` 挪走）后权限记录可能对不上；建议固定在 `~/Applications`。
- 授权后必须**重启 app 进程**才生效（macOS 规定）；引导窗「重新检测」只在进程内查状态，不能凭空绕过重启。
- **实测观察（2026-11-01）**：
  - 从 DSH 会话直接跑 `…/饭桶余额.app/Contents/MacOS/Electron`：屏幕录制权限会顺着「终端/会话」的责任进程链生效 → `place src=detect/detect`；
  - launchd 直启（登录自启）或访达双击：app 自己当责任进程 → **未授权时**弹「权限引导」窗、`place src=fallback-…`；
  - 结论：直启方案下，授权给「饭桶余额」一次后，登录自启路径才能 `detect`；`dev-install.sh` 冒烟里 `place src=detect` 就是查这一条（未授权记 WARN，退出码 3）。

## 8. 数据与日志路径

| 用途 | 路径 |
|---|---|
| 用户配置（只读） | `~/.dsh/glutton-balance/config.json` |
| 程序日志（256 KB 轮转） | `~/.dsh/glutton-balance/panel.log`（+ `panel.log.1`） |
| launchd 输出 | `~/Library/Logs/饭桶余额/launch.log`、`launch.err.log` |
| Electron userData | `~/Library/Application Support/饭桶余额/` |
| 自启 plist | `~/Library/LaunchAgents/com.gluttonbalance.panel.plist` |
| 旧世代 DSH 载体守护壳（已下线；install/uninstall 会清理） | `~/.dsh/pet-balance-panel/launch-via-dsh.mjs` |
| 改名前的旧配置目录（迁移来源；默认保留，`--purge` 时删除） | `~/.dsh/pet-balance-panel/` |
| 安装位置 | `~/Applications/饭桶余额.app` |
