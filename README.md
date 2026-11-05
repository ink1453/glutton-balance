# 饭桶余额 · GluttonBalance

在 Coopanion 桌宠头顶（或脚下）按每家 AI 服务摆一只小饭桶：桶里米饭多少 = 余额还剩多少，一眼看出哪家快见底。

![9 家金字塔](screenshots/05-panel-pyramid-dark.png)

> **当前版本：v0.0.5（2026-11-05 已发布）**（Coopanion 扩展 `glutton-balance`（旧包名「pet-balance-world」已弃用）、macOS 显示窗、Windows 显示窗源码同号 0.0.5；上一个已发布版本为 0.0.4；GitHub Release / npm / 市场均已上线并通过 R-48 双端双网核对）。

> 🤖 **AI 一键安装（把这条链接交给你的 AI 助手）**：<https://raw.githubusercontent.com/ink1453/glutton-balance/main/AI-INSTALL.md>
> 说明见 [`AI-INSTALL.md`](AI-INSTALL.md)（扩展 + Windows/macOS 两版显示窗的安装/验证/回滚步骤，不碰密钥）；备用下载入口：[Releases](https://github.com/ink1453/glutton-balance/releases/latest)。

> **两套显示窗，各自安装**：本仓库同时包含 **Windows 版**（`Panel.cs` / `Panel.V3.cs`，C# / .NET Framework 4.8）与 **macOS 版**（[`mac/`](mac/README.md)，Electron 38 / macOS 14+ / Apple 芯片）显示窗源码。两版共用同一个 Coopanion 扩展（设置页）和同一份 `config.json` 配置格式，但构建与安装方式不同、互不依赖。

## 关于这个项目

这是一个「零代码」项目：老板没有任何编程经验，也没写过一行代码。从最初的想法、饭桶长什么样，到写代码、调试、打包、写文档，全部由 DeepSeek Harness（DSH）里的两个 AI 伙伴完成——Windows 侧的「墨墨」负责显示窗、Coopanion 扩展、测试与打包，macOS 侧的「麦麦」负责 Mac 端适配与发布。老板只提供了两样东西：灵感思路，和管够的「大白饭」（token）。

## 仓库内容

```
Panel.cs / Panel.V3.cs / build.ps1 …   Windows 显示窗源码与构建/安装脚本（.NET Framework 4.8）
mac/                                    macOS 显示窗源码与构建/安装脚本（Electron）
docs/PANEL-TECH.md                      Windows 版技术说明（配置字段、定位算法、渲染与调试）
INSTALL.md                              Windows 版安装步骤
mac/INSTALL.md                          macOS 版安装步骤
AI-INSTALL.md                           给 AI 助手的一键安装说明（扩展 + 显示窗，含验证/回滚）
bowls/  rice/                           显示窗内置饭桶与米饭素材
screenshots/                            扩展设置页 / 显示窗截图
```

## 功能

- **一眼看余额**：每家 AI 服务一只小饭桶，米饭量 = 余额 ÷ 你设的「满盆金额」。低额薄薄一层、中档到桶口、满盆冒出桶沿，还有小绿点 / 红点当提示灯。
- **最多 9 家**：DeepSeek 官方余额接口、new-api 中转站（自动换算额度与汇率）、自定义接口 + JSON 取值路径、智谱 GLM 预设（官方暂未开放余额查询接口，按「大白饭 / 满盆」显示、只校验 Key）；另有一档「大白饭」不联网、永远满盆，适合演示。
- **外貌可换**：白瓷 / 黑陶 / 不锈钢三款圆柱饭桶，数值样式三款（桶沿小字 / 饭票小旗 / 桶沿木牌）；也能导入自己画的饭桶（设置页内置绘制模板）。旧配置里的「搪瓷」外观已删除，会自动回退白瓷。
- **晃晕唤出（macOS，0.0.4 起）**：在桌面上快速晃两下鼠标（2 秒内左右反转 ≥4 次）即可唤出 / 收起明细面板，误触保护四重；Windows 版仍用热键与点击展开。
- **失败提示更清楚（0.0.4 起）**：余额查询失败按 18 类原因给中文提示（密钥无效 / 网络不通 / 额度不足等），托盘「测试余额连接…」可当场测一次；日志轮转保留、密钥二次脱敏，明细卡与日志都不显示完整密钥。
- **桌宠隐藏 → 饭桶自动隐藏（0.0.5 起，Windows + macOS）**：桌宠被隐藏或退出后，显示窗约 1 秒内自动隐藏；桌宠回来自动显示并恢复跟随，不再一直悬浮在桌面。
- **点击 / 右击桌宠不再变大（0.0.5 修复）**：以前点击桌宠弹出右键菜单时，菜单态的桌宠宽度尖刺会被误当成真实尺寸变化、把饭桶放大（最多 2 倍）并长时间不回缩；0.0.5 起缩放冻结期间不再重定基准，真实的改缩放 / 换皮肤仍按比例重新匹配。
- **密钥更好填（0.0.5 起）**：扩展设置页密钥来源旁新增「从剪切板导入」（把剪贴板里的密钥写进本机凭据文件，界面不显示密钥）与「删除密钥」（只删凭据文件里那一行变量，不动配置）。
- **跟着桌宠走**：随桌宠移动、缩放自动调整，不压任务栏，不抢焦点、不进 Alt+Tab；点击穿透默认开启。
- **9 家排法**：金字塔（默认）/ 一排 / 两排，家数多了自动收紧。
- **手动保存**：改完点「保存」才写入（不自动写盘，防误改）；每家可单独设提示灯阈值与刷新间隔（10–3600 秒）。
- **隐私**：只读余额查询接口，不调用模型、不扣额度、不上报任何数据；密钥由用户在本机自行填写，面板不显示、不修改、不上报。

两版在摆放形态上有差异：**Windows 版**支持头顶 / 脚下两态（脚下可抬升桌宠、有轮子彩蛋）；**macOS 版**当前固定头顶形态、盆宽按桌宠实际宽度自动匹配（脚下形态在 macOS 上不适用）。

## 安装（Windows）

1. 在 Coopanion 扩展市场安装并启用「饭桶余额」（本条目为「需另装」类型）。
2. 到本仓库 Releases 下载 Windows 显示窗源码包（0.0.5 为 `glutton-balance-x-0.0.5-src.zip`；当前已发布资产见 Releases），按包内 `INSTALL.md` 用系统自带的 .NET Framework 4.8 编译，再运行 `install.ps1` 完成安装（装到用户主目录 `.dsh/glutton-balance`，写开机自启与开始菜单快捷方式，桌面零文件）。
3. 打开「饭桶余额」设置页，填余额来源，保存后约 5 秒生效。

> 显示窗为源码自建、**未签名**，若出现「Windows 已保护你的电脑」提示属正常，点「更多信息 → 仍要运行」即可。

## 安装（macOS）

> 详细分步说明、权限与卸载见 [mac/INSTALL.md](mac/INSTALL.md)。

1. 前置：**macOS 14+ / Apple 芯片（arm64）**、Coopanion 0.2.16+，并已在 Coopanion 里安装启用「饭桶余额」扩展。
2. 到本仓库 Releases 下载 macOS 显示窗源码包（0.0.5 为 `glutton-balance-mac-0.0.5-src.zip`；当前已发布资产见 Releases），或直接使用本仓库 [`mac/`](mac/) 目录。
3. 下载 Electron 38.8.6 arm64 运行时（官方 `Electron.app`），放到 `mac/tools/Electron.app`，或用 `--electron-src=<路径>` 指定（运行时不进仓库）。
4. 构建并安装：

   ```bash
   cd mac
   ./build/build-app.sh     # 产物：build/dist/饭桶余额.app
   ./build/install.sh       # 装到 ~/Applications + 写登录自启
   ```

5. 打开「饭桶余额」设置页，填余额来源，保存后约 5 秒生效。

> macOS 版同样**未签名（ad-hoc）**：首次从 Finder 打开需右键 →「打开」；换机器分发前建议自行签名 / 公证。显示窗需要「屏幕录制」权限识别桌宠位置；登录自启默认借助本机 DeepSeek Harness 当载体以继承该权限（没装 DSH 可用 `./build/install.sh --no-autostart` 手动启动，权限需自行授予）。macOS 扩展设置页可以打开和保存配置，0.0.4 起也可在设置页启停显示窗（首次需允许「屏幕录制」权限），菜单栏图标同样可管理。

## 截图

| | |
|---|---|
| ![设置页首屏](screenshots/01-settings-home.png) | ![饭桶外观](screenshots/02-bowl-appearance.png) |
| ![供应商与阈值](screenshots/03-providers-thresholds.png) | ![显示窗设置](screenshots/04-window-settings.png) |
| ![9 家金字塔](screenshots/05-panel-pyramid-dark.png) | ![四态](screenshots/06-panel-four-states.png) |
| ![明暗主题](screenshots/07-panel-themes.png) | |

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)（当前 **v0.0.5（已发布）**：桌宠隐藏后饭桶自动隐藏、桌宠回来自动显示（双端）、修复点击 / 右击桌宠后饭桶变大、智谱 GLM 预设与密钥导入 / 删除按钮）。

## 许可

[MIT](LICENSE)

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai) —— 墨墨（Windows）与麦麦（macOS）
- [Coopanion](https://github.com/Pal-AI-Lab/Coopanion) 桌宠
- [Electron](https://www.electronjs.org/) —— macOS 显示窗运行时
