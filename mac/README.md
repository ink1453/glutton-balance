# 饭桶余额 · macOS 显示窗（源码 · v0.0.6）

macOS 版的「饭桶余额」显示窗：在 Coopanion 桌宠头顶摆一排小饭桶，桶里米饭多少 = 余额还剩多少。本目录是它的**源码 + 构建/安装脚本**，用 Electron 实现，和仓库根目录的 Windows 版（.NET）是两套独立程序，共用同一个 Coopanion 扩展（`glutton-balance`）与同一份 `config.json` 配置格式。

> 版本：macOS 显示窗 **0.0.6**（与 Windows 显示窗、Coopanion 扩展、GitHub Release 同号）。许可：MIT（与仓库一致）。

## 与 Windows 版的差异

| 项 | Windows 版 | macOS 版（本目录） |
|---|---|---|
| 技术栈 | C# / .NET Framework 4.8，本机 `csc.exe` 编译 | Electron 38.8.6（arm64），复制官方运行时打包 |
| 摆放形态 | 头顶 / 脚下两态（脚下可抬升桌宠、有轮子彩蛋） | **固定头顶**（脚下形态在 macOS 上不适用，代码保留不可选） |
| 盆宽口径 | 设计像素 × DPI | **按桌宠实测宽度匹配**（约 0.8 倍），拖拽时冻结采样防抖 |
| 运行时 | 系统自带 .NET（Windows 10/11） | 需自备 **Electron 38.8.6 arm64 运行时**（不进仓库） |
| 系统要求 | Windows 10 / 11 64 位 | **macOS 14+ / Apple 芯片（arm64）** |
| 签名 | 未签名（SmartScreen 提示） | **本机自签证书签名**（默认 `Maizi Local Code Signing`，可用 `SIGN_IDENTITY` 覆盖；对外分发换 Developer ID + 公证） |
| 启停 | 扩展设置页「启停显示窗」 | 菜单栏图标管理；**扩展设置页在 macOS 上不能启停显示窗** |
| 登录自启 | `install.ps1` 写注册表自启 | `install.sh` 写 LaunchAgent，**launchd 直启 App**（KeepAlive=true；不依赖其它宿主程序） |

## 目录结构

```
main.js / preload.js / permission.html   主程序、预加载、权限引导页
src/                                     配置、布局、定位、取数、日志等模块
renderer/                                面板渲染（Canvas）
assets/                                  内置饭桶 / 米饭 / 托盘素材 + 配置示例
native/petprobe(.swift)                  桌宠窗口定位器（需可执行文件；源码用于重编译）
build/build-app.sh                       打包成「饭桶余额.app」
build/dev-install.sh                     本地开发一键闭环（打包+备份+安装+重启+冒烟）
build/install.sh / uninstall.sh          安装 / 卸载（含登录自启）
build/scan-package.sh                    包内容安全扫描（本机路径 / 密钥 / 开发垃圾）
build/runtime-package.json               打包时精简后的 package.json（无 jq 时兜底）
build/README.md / INTEGRATION.md / PERMISSIONS.md   打包、接入点、权限说明
test/                                    布局自检、拖拽冻结仿真、冒烟测试与配置夹具
```

## 快速开始

```bash
# 1) 自备 Electron 38.8.6 arm64 运行时，放到 tools/Electron.app
#    （下载 electron-v38.8.6-darwin-arm64.zip 解压即可；也可用 --electron-src=<路径> 指定）
# 2) 打包
./build/build-app.sh
# 3) 安装（装到 ~/Applications + 登录自启）
./build/install.sh
```

- 没有本机自签证书？打包脚本默认用证书名 `Maizi Local Code Signing`；用你自己的证书：
  `SIGN_IDENTITY="你的证书名" ./build/build-app.sh`。**不会退回 ad-hoc**（ad-hoc 每次重打包屏幕录制授权都会失效）。
- 日常开发改完代码要「重打 + 重装 + 重启显示窗 + 冒烟」：`./build/dev-install.sh`（细节见 [build/README.md](build/README.md)）。

详细前置条件、权限、配置与卸载见 [INSTALL.md](INSTALL.md)。

## 配置

- 配置文件：`~/.dsh/glutton-balance/config.json`（与 Windows 版同一格式；可用环境变量 `GLUTTONBALANCE_PANEL_DIR` / `GLUTTONBALANCE_PANEL_CONFIG` 改位置）。
- 改名兼容（2026-11-02）：新变量 `GLUTTONBALANCE_PANEL_*` 优先、旧变量 `PET_BALANCE_PANEL_*` 仍兼容；首次启动若新目录没有 `config.json` 且旧目录 `~/.dsh/pet-balance-panel/config.json` 存在，会自动迁移 `config.json`、`bowls/`、`rice/` 到新目录（旧目录保留、幂等、不覆盖）。
- 首次运行会写入默认配置；余额来源在 Coopanion 的「饭桶余额」扩展设置页里填写并保存，显示窗约 5 秒内热载生效。
- **内置饭桶外观三款**：白瓷（默认，`porcelain`）/ 黑陶（`black`）/ 不锈钢（`steel`）。旧版配置里的**搪瓷（`enamel`）已整套下线**，旧配置写 `"bowlStyle": "enamel"` 会**自动回退白瓷**（不崩、不报错；`panel.log` 会写一条 `WARN bowlStyle=enamel 已下线/未知 → 回退 porcelain`）。
- `keySource` 的路径支持 `~`、`$VAR`、`%VAR%` 展开；**Windows 示例里的 `%USERPROFILE%` 在 macOS 上请改成 `~/.dsh/.env` 之类的路径**。
- 日志：`~/.dsh/glutton-balance/panel.log`。

## 本地自测（可选，需要 Node.js）

```bash
node src/layout.js                 # 布局自检（输出 JSON）
node test/scale-freeze-sim.js      # 拖拽冻结仿真（回放真实轨迹，验证拖拽不抖）
node test/main-selftest-smoke.js   # 主程序无头冒烟（假 Electron 模块，不建窗口）
```

## 已知限制

- 本机自签 / 未公证：换机器分发会被 Gatekeeper 拦，需右键「打开」或自行换 Developer ID 签名 + 公证。
- 仅 Apple 芯片（arm64）；Intel Mac 需自行换 arm64→x64 的 Electron 运行时与 `native/petprobe`（未适配）。
- 固定头顶形态；多显示器 / 外接屏未实测。
- 登录自启由 launchd 直启 App；首次使用要给「饭桶余额」授一次**屏幕录制**权限（系统设置 → 隐私与安全性 → 屏幕录制），授权后重启 App 生效。
- 电量与模型无关：只读余额接口，不调模型、不扣额度、不上报数据。

## 许可

MIT（见仓库根 [LICENSE](../LICENSE)）。
