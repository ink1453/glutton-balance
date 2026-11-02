# 饭桶余额 · 打包与安装（build/ 一页说明）

> 这个目录只做「打包 + 图标 + 登录自启 + 权限引导 + 包内容扫描」，**不改主程序**。
> 主程序文件（`main.js` / `preload.js` / `src/` / `renderer/` / `assets/` / `native/`）由 Lead/渲染队友维护。
> 与主程序的接入点见 [INTEGRATION.md](INTEGRATION.md)。

## 产物

| 产出 | 路径 | 说明 |
|---|---|---|
| 安装包 | `build/dist/饭桶余额.app` | Electron 38.8.6（arm64）+ 本工程源码，**本机自签证书 Maizi Local Code Signing 签名**（对外分发换 Developer ID + 公证）|
| 应用图标 | `build/icon/app.icns` | 1024 底图 → 10 尺寸 iconset → icns（白瓷饭桶） |
| 托盘模板图 | `build/icon/tray/trayTemplate.png`（16，+@2x 32） | 白瓷饭桶剪影；进包为 `app/assets/trayTemplate.png` |
| 构建记录 | `build/dist/build-report.txt` | 时间/大小/版本/签名状态/Info.plist sha256 |
| 扫描报告 | `build/dist/package-scan.txt` | 包内容安全检查结果 |
| 校验清单 | `build/dist/SHA256SUMS.txt` | 整包内容 sha256 + 关键文件 hash（可复算） |
| 验收证据 | `build/dist/evidence/` | 全屏截图 / 面板带 alpha 图 / launch-evidence.txt |
| 权限引导 | `build/permission-guide.html` + `build/PERMISSIONS.md` | 给老板看的图文说明（不入包） |

**包体大小：约 254 MB（266,678,272 字节，`du -sk` 口径）**——基本都是 Electron 运行时（Electron Framework 约 165 MB）。不装 brew、不 npm 装依赖、不下载：运行时来自 `app-mac/tools/Electron.app`（Electron 38.8.6 arm64，不进仓库）。

## 快速开始

```bash
cd app-mac/build

./icon/make-icon.sh        # ① 出图标（幂等；已有且较新会自动跳过）
./build-app.sh             # ② 打包 → dist/饭桶余额.app
./scan-package.sh          # ③ 包内容安全扫描（有问题退出码非 0）
./dev-install.sh           # ④ 一键：重新打包 + 备份旧安装 + 安装 + 重启显示窗 + 冒烟自检
```

首次安装 / 重设登录自启：`./install.sh`（装到 `~/Applications` + 写 LaunchAgent + 立刻启动）。
只想看会做什么、不动机器：`./dev-install.sh --dry-run` / `./install.sh --dry-run` / `./uninstall.sh --dry-run`（只打印计划）。

## 本地开发 → 本机安装一键闭环（dev-install.sh）

日常改完代码，用这一条完成「重打 + 重装 + 重启显示窗 + 冒烟」：

```bash
./dev-install.sh                 # 完整闭环（约 1–2 分钟，其中打包 30–60 秒）
./dev-install.sh --dry-run       # 只打印步骤与当前现场，不改任何文件
./dev-install.sh --no-build      # 不重新打包，用现有 dist 产物安装（冒烟仍做）
./dev-install.sh --no-smoke      # 安装后只查进程/版本
```

流程：`build-app.sh` → 把 `~/Applications/饭桶余额.app` 备份成 `.bak-pre-devinstall-<时间戳>` →
`ditto` 安装 → `launchctl bootout` + `bootstrap`/`kickstart -k` 重启 → 冒烟（进程 / Info.plist 版本 / 签名
`Maizi Local Code Signing` + `flags=0x0` / `panel.log` 新 `start` 行 / 定位器 detect 生效（`place src=detect` 或 `panel shown … src=detect/detect`））。

- 冒烟失败会**自动回滚**到安装前状态（备份移回并重新加载 launchd）；成功则保留备份，结尾打印手工回滚命令。
- 冒烟里的「定位器 detect 生效」（`place src=detect` 或 `panel shown … src=detect/detect`）需要屏幕录制授权；未授权时只有 `place src=fallback-*`，脚本记 WARN 并以退出码 3 结束
  （不是失败）。给「饭桶余额」授权后重跑 `./dev-install.sh --no-build` 即可复验。
- 本脚本**不改 LaunchAgent plist**：只有 plist 不存在时才报错并提示先跑 `./install.sh`。

## 启动方式

| 场景 | 命令 |
|---|---|
| 双击 | 访达里双击 `build/dist/饭桶余额.app` 或 `~/Applications/饭桶余额.app` |
| 命令行（本会话/终端） | `env -u ELECTRON_RUN_AS_NODE "build/dist/饭桶余额.app/Contents/MacOS/Electron"` |
| 已安装、用 open | `open ~/Applications/饭桶余额.app` |
| 登录自启 | `install.sh` 之后随登录自动起（LaunchAgent 直启 App，KeepAlive=true） |
| 退出 | 菜单栏小盆图标 → 「退出」；或 `env -u ELECTRON_RUN_AS_NODE "…/Contents/MacOS/Electron" --quit` |

> ⚠️ **在本 DSH 会话里必须 `env -u ELECTRON_RUN_AS_NODE`**：本会话的 shell 环境带 `ELECTRON_RUN_AS_NODE=1`（DSH 的工作变量），直接跑 Electron 会退化成纯 Node、报 `Cannot find module 'electron'`。
> **而且 `open` 也会继承当前 shell 的环境**（实测：不带 `env -u` 直接 `open` 会瞬间退出）→ 在本会话里要用 `env -u ELECTRON_RUN_AS_NODE open "…/饭桶余额.app"`。
> 老板从访达双击、或登录自启（launchd）环境干净，不受影响。
> 本仓库的 `install.sh` 写 LaunchAgent 时**绝不**把这个变量写进去（有自检拒绝）。

## 登录自启（LaunchAgent）

- 文件：`~/Library/LaunchAgents/com.gluttonbalance.panel.plist`
- 方案：**launchd 直启 App**（App 用本机自签证书签名、自己持屏幕录制授权；不再用 DeepSeek Harness 当载体）
- 关键项：`RunAtLoad=true`、`KeepAlive=true`、`ProgramArguments=[饭桶余额.app/Contents/MacOS/Electron, --autostart]`、`LimitLoadToSessionType=Aqua`、`ProcessType=Interactive`、`ThrottleInterval=10`
- 不写 `ELECTRON_RUN_AS_NODE`（那是 DSH 会话 shell 的开发变量，用户登录环境没有；install.sh 有自检拒绝）
- 加载方式：`launchctl bootstrap gui/$(id -u) <plist>`；卸载：`launchctl bootout gui/$(id -u)/com.gluttonbalance.panel`
- launchd 的 stdout/stderr：`~/Library/Logs/饭桶余额/launch.log` / `launch.err.log`（安装时自动建目录）
- 程序自己的运行日志：`~/.dsh/glutton-balance/panel.log`（256 KB 自动轮转）

## 卸载

```bash
./uninstall.sh              # 停自启 → 退程序 → 删 app；保留用户配置
./uninstall.sh --dry-run    # 干跑：只打印计划，不删任何东西
./uninstall.sh --keep-app   # 只删自启，保留 app
./uninstall.sh --purge      # 连用户配置一起删（需再输 YES 确认）
```

- 默认保留：`~/.dsh/glutton-balance/`（config.json、panel.log）、`~/Library/Application Support/饭桶余额/`、`~/Library/Logs/饭桶余额/`
- **不删系统权限记录**：屏幕录制授权要老板自己去「系统设置 → 隐私与安全性 → 屏幕录制」关掉
- 可回滚：卸载后重跑 `./install.sh` 即恢复

## 升级与改名兼容（2026-11-02）

- 标识：mac 包名 `glutton-balance-mac`；App bundle id 与 LaunchAgent label = `com.gluttonbalance.panel`（改名前的旧 label 不写入源码；本机如留有旧 plist 由老板手动删除，install/uninstall 只清理旧世代 ricebowl 的遗留）。
- 配置目录：默认 `~/.dsh/glutton-balance`；首次启动若新目录没有 `config.json` 且旧目录 `~/.dsh/pet-balance-panel/config.json` 存在，会自动复制 `config.json`、`bowls/`、`rice/` 到新目录（旧目录原样保留、幂等、不覆盖新文件；`panel.log` 记一行迁移说明）。
- 环境变量：新 `GLUTTONBALANCE_PANEL_DIR/CONFIG/LOG` 优先，旧 `PET_BALANCE_PANEL_*` 仍兼容（两种都生效）。
- 屏幕录制授权按 bundle id 记录：改 bundle id 后需要重新授权一次（步骤见 [PERMISSIONS.md](PERMISSIONS.md)）。

## 权限（老板必看）

第一次运行会弹「权限引导」小窗。**屏幕录制 = 必须；辅助功能 = 可选/本版不用。**
详细步骤、两个系统设置深链、常见问题 → 看 **[PERMISSIONS.md](PERMISSIONS.md)**（图文版 [permission-guide.html](permission-guide.html)）。

深链（给终端用）：
```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
```

> 规矩：**权限必须老板自己点「允许」**，程序/脚本/助手不代点、不绕过系统弹窗。

## 签名（本机自签证书；Gatekeeper 提示）

- 本包用 **本机自签证书 `Maizi Local Code Signing`** 签名（老板 2026-11-01 定的规矩），**不再用 ad-hoc**：
  `codesign --force --deep --sign "Maizi Local Code Signing" "<app>"`；打包后硬校验
  `codesign --verify --deep --strict` 退出码 0 + `Authority=Maizi Local Code Signing` + `flags=0x0`，**不满足就拒绝出包**。
- 为什么不用 ad-hoc：ad-hoc 只按 cdhash 认身份，每次重打包 TCC（屏幕录制）授权就失效、死循环；
  本机证书按「证书 + Bundle ID」认身份，重新打包身份不变，授权不再反复问。
- 本机构建、本机安装：一般直接能开（没有 quarantine 属性；`build-app.sh` 也会清掉）。
- 从别的机器拷来：自签证书不在对端钥匙串，第一次打开可能提示「无法打开，因为无法验证开发者」→
  去「系统设置 → 隐私与安全性」页面底部点 **「仍要打开」**，或终端 `xattr -dr com.apple.quarantine <app 路径>`。
- 正式对外分发需要：Apple 开发者证书（Developer ID）签名 + 公证（notarytool），本目录不做（无证书）。

## 包内容扫描（交付前必跑）

```bash
./scan-package.sh                    # 默认扫 dist/饭桶余额.app；退出码 0=干净
./scan-package.sh <某个.app>          # 指定目标
./scan-package.sh --strict           # 警告也算失败
```

查什么：本机绝对路径（用户主目录开头的路径）、用户名、工程内路径、`ELECTRON_RUN_AS_NODE` 残留、疑似 key/token/私钥、
`devDependencies`、`.DS_Store`/`node_modules`/`test`/`build` 等开发垃圾、包必备结构（Info.plist 关键字段、图标、
托盘模板图、`permission.html`、可执行且有签名的 `native/petprobe`）。
命中密钥只报位置、内容打码（不二次泄露）。白名单文件：`build/scan-allowlist.txt`（可选，每行一个正则）。

## 打包细节（build-app.sh 做了什么）

1. 复制 `tools/Electron.app` → `dist/饭桶余额.app`（ditto，保留符号链接/权限）
2. 注入 `Contents/Resources/app/`：`main.js`、`preload.js`、`permission.html`、`package.json`、`src/`、`renderer/`、`assets/`、`native/`
   —— **不带** `test/`、`build/`、`tools/`、`docs/`
3. 进包 `package.json` 用 jq 去掉 `devDependencies`/`optionalDependencies`/`peerDependencies`/`scripts`（开发字段与 `env -u …` 不该进包）
4. 拷图标：`app.icns` → `Contents/Resources/app.icns`；`trayTemplate*.png` → `app/assets/`
5. `native/petprobe` 补可执行位并**单独用本机自签证书签名**（Contents/Resources 里的独立可执行文件，`--deep` 不保证覆盖）
6. 改 Info.plist：
   `CFBundleName/CFBundleDisplayName=饭桶余额`、`CFBundleIdentifier=com.gluttonbalance.panel`、
   `CFBundleShortVersionString=0.0.4`（build-app.sh 常量 `APP_VERSION`，与 `package.json` 同号，发布新版改一处）、
   `CFBundleVersion=1`、`CFBundleIconFile=app.icns`、
   `LSUIElement=true`、`NSHighResolutionCapable=true`、`LSMinimumSystemVersion=14.0`
7. 用本机自签证书签名：先单独签 `native/petprobe` → 再 `codesign --force --deep --sign "Maizi Local Code Signing" "<app>"`；
   硬校验 `--verify --deep --strict` + `Authority=Maizi Local Code Signing` + `flags=0x0`（不通过就 die、不出包）→ 写 `dist/build-report.txt`
8. 构建/签名/硬校验统一在 `$TMPDIR`（非 iCloud 同步目录）暂存目录完成，最后 `ditto` 交付到 `build/dist/`：
   本工作区在 `~/Documents`（iCloud 同步），同步服务会持续给包内文件重新注入 FinderInfo / FileProvider 扩展属性，
   在同步目录里 in-place 跑 `codesign` 会随机报 `resource fork, Finder information, or similar detritus not allowed`。

自测（打包链路，不依赖主程序）：`./build-app.sh --dummy` → 产物 `dist/打包链路自测.app`
（源码在 `build/dummy/`，验证「复制运行时 → 注入 → 改 plist → 图标 → 签名 → 真机启动出图」全链路）。

## 排错

| 现象 | 处理 |
|---|---|
| 启动报 `Cannot find module 'electron'` | 忘了 `env -u ELECTRON_RUN_AS_NODE`（本会话环境变量），或改用 `open` |
| 双击提示「无法验证开发者」 | 见上面 Gatekeeper 段：系统设置里「仍要打开」 |
| 菜单栏没有小盆图标 | 确认 `app/assets/trayTemplate.png` 在（`ls dist/饭桶余额.app/Contents/Resources/app/assets/`）；看 `panel.log` 里 `tray skipped` |
| 不跟着桌宠动 | 屏幕录制没授权（看 panel.log 的 `permDenied`）；见 PERMISSIONS.md |
| 安装后登录不自启 | `launchctl print gui/$(id -u)/com.gluttonbalance.panel`；看 `~/Library/Logs/饭桶余额/launch.err.log` |
| 扫描报问题 | 按 `dist/package-scan.txt` 的「文件:行」改源码（路径用相对 `__dirname`/`process.resourcesPath`，密钥只从环境变量或 `~/.dsh` 读） |
| 复验报 `resource fork, Finder information, or similar detritus not allowed` | 工作区在 iCloud 同步目录，同步服务给包内文件注入了 FinderInfo；**签名本身有效**（构建时已在非同步暂存目录 `--verify --deep --strict` 通过）。复验方法：`ditto dist/饭桶余额.app /tmp/x.app && xattr -cr /tmp/x.app && codesign --verify --deep --strict /tmp/x.app` |
| 复验报 `Authority=` 不是 `Maizi Local Code Signing` | 误用了 ad-hoc（`-s -`）出包；老板 2026-11-01 规矩要求一律本机自签证书，重跑 `./build-app.sh` |

## 目录

```
build/
├─ build-app.sh          打包（Electron 运行时 + app 源码 → 饭桶余额.app）
├─ dev-install.sh        本地开发一键闭环（打包+备份+安装+重启+冒烟；--dry-run/--no-build/--no-smoke）
├─ install.sh            首次安装 / 重设登录自启（--no-autostart/--no-start）
├─ uninstall.sh          卸载（--keep-app/--purge，默认保留用户配置）
├─ scan-package.sh       包内容安全扫描 → dist/package-scan.txt
├─ permission-guide.html 首次权限引导（浏览器可看）
├─ PERMISSIONS.md        权限文字版
├─ INTEGRATION.md        主程序接入点（Lead 看）
├─ icon/                 make-icon.sh / make-icon.py / app.icns / tray/
├─ dummy/                打包链路自测用最小 app（不进正式包）
└─ dist/                 产物：饭桶余额.app / build-report.txt / package-scan.txt
```
