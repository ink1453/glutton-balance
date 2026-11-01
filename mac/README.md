# 饭桶余额 · macOS 显示窗（源码 · v0.1.0）

macOS 版的「饭桶余额」显示窗：在 Coopanion 桌宠头顶摆一排小饭桶，桶里米饭多少 = 余额还剩多少。本目录是它的**源码 + 构建/安装脚本**，用 Electron 实现，和仓库根目录的 Windows 版（.NET）是两套独立程序，共用同一个 Coopanion 扩展（`pet-balance-world`）与同一份 `config.json` 配置格式。

> 版本：macOS 显示窗自身版本 **0.1.0**；随仓库 `v0.0.1` 一起公开。许可：MIT（与仓库一致）。

## 与 Windows 版的差异

| 项 | Windows 版 | macOS 版（本目录） |
|---|---|---|
| 技术栈 | C# / .NET Framework 4.8，本机 `csc.exe` 编译 | Electron 38.8.6（arm64），复制官方运行时打包 |
| 摆放形态 | 头顶 / 脚下两态（脚下可抬升桌宠、有轮子彩蛋） | **固定头顶**（脚下形态在 macOS 上不适用，代码保留不可选） |
| 盆宽口径 | 设计像素 × DPI | **按桌宠实测宽度匹配**（约 0.8 倍），拖拽时冻结采样防抖 |
| 运行时 | 系统自带 .NET（Windows 10/11） | 需自备 **Electron 38.8.6 arm64 运行时**（不进仓库） |
| 系统要求 | Windows 10 / 11 64 位 | **macOS 14+ / Apple 芯片（arm64）** |
| 签名 | 未签名（SmartScreen 提示） | **ad-hoc 未签名**（首次右键「打开」；换机分发前建议签名/公证） |
| 启停 | 扩展设置页「启停显示窗」 | 菜单栏图标管理；**扩展设置页在 macOS 上不能启停显示窗** |
| 登录自启 | `install.ps1` 写注册表自启 | `install.sh` 写 LaunchAgent，默认借助本机 **DeepSeek Harness** 当载体以继承「屏幕录制」权限 |

## 目录结构

```
main.js / preload.js / permission.html   主程序、预加载、权限引导页
src/                                     配置、布局、定位、取数、日志等模块
renderer/                                面板渲染（Canvas）
assets/                                  内置饭桶 / 米饭 / 托盘素材 + 配置示例
native/petprobe(.swift)                  桌宠窗口定位器（需可执行文件；源码用于重编译）
build/build-app.sh                       打包成「饭桶余额.app」
build/install.sh / uninstall.sh          安装 / 卸载（含登录自启）
build/scan-package.sh                    包内容安全扫描（本机路径 / 密钥 / 开发垃圾）
build/runtime-package.json               打包时精简后的 package.json（无 jq 时兜底）
test/                                    布局自检、拖拽冻结仿真、冒烟测试与配置夹具
```

## 快速开始

```bash
# 1) 自备 Electron 38.8.6 arm64 运行时，放到 mac/tools/Electron.app
#    （下载 electron-v38.8.6-darwin-arm64.zip 解压即可；也可用 --electron-src=<路径> 指定）
# 2) 打包
./build/build-app.sh
# 3) 安装（装到 ~/Applications + 登录自启；没有 DeepSeek Harness 可加 --no-autostart）
./build/install.sh
```

详细前置条件、权限、配置与卸载见 [INSTALL.md](INSTALL.md)。

## 配置

- 配置文件：`~/.dsh/pet-balance-panel/config.json`（与 Windows 版同一格式；可用环境变量 `PET_BALANCE_PANEL_DIR` / `PET_BALANCE_PANEL_CONFIG` 改位置）。
- 首次运行会写入默认配置；余额来源在 Coopanion 的「饭桶余额」扩展设置页里填写并保存，显示窗约 5 秒内热载生效。
- `keySource` 的路径支持 `~`、`$VAR`、`%VAR%` 展开；**Windows 示例里的 `%USERPROFILE%` 在 macOS 上请改成 `~/.dsh/.env` 之类的路径**。
- 日志：`~/.dsh/pet-balance-panel/panel.log`。

## 本地自测（可选，需要 Node.js）

```bash
node src/layout.js                 # 布局自检（输出 JSON）
node test/scale-freeze-sim.js      # 拖拽冻结仿真（回放真实轨迹，验证拖拽不抖）
node test/main-selftest-smoke.js   # 主程序无头冒烟（假 Electron 模块，不建窗口）
```

## 已知限制

- ad-hoc 未签名：换机器分发会被 Gatekeeper 拦，需右键「打开」或自行签名/公证。
- 仅 Apple 芯片（arm64）；Intel Mac 需自行换 arm64→x64 的 Electron 运行时与 `native/petprobe`（未适配）。
- 固定头顶形态；多显示器 / 外接屏未实测。
- 登录自启默认依赖本机安装 **DeepSeek Harness**（用它当载体继承屏幕录制授权）；没有 DSH 时用 `--no-autostart` 手动启动，权限需自行在「系统设置 → 隐私与安全性 → 屏幕录制」里授予。
- 电量与模型无关：只读余额接口，不调模型、不扣额度、不上报数据。

## 许可

MIT（见仓库根 [LICENSE](../LICENSE)）。
