> 本文件是 Windows 显示窗程序的技术参考：配置字段、定位算法、渲染与调试工具。
> 安装与构建步骤见仓库根目录 [README.md](../README.md) 与 [INSTALL.md](../INSTALL.md)。
> **版本口径：0.0.4（开发中，尚未发布）** —— 内置外观为三款（白瓷 / 黑陶 / 不锈钢）；「搪瓷（`enamel`）」外观自 0.0.4 起整套删除，旧配置自动回退白瓷（详见下文 `display.bowlStyle` 与「饭桶资源」两节）。

# 饭桶余额（GluttonBalance）· 技术说明

> **v3（2026-10-31）：形态改为「白饭桶」** —— 桌宠脚下每家一只小盆，盆里白饭 = 余额 ÷ 满盆金额（每家一盆）。v2 的胶囊形态保留为可回退（`display.style: "capsule"`）。详见文末「v3 白饭桶」。

在 Coopanion 桌宠**头顶（默认）或脚下**、任务栏上沿常驻显示各家用余额（默认每家一只小盆：盆里白饭越多=余额越多）。点击穿透、不抢焦点、不进 Alt+Tab。

本目录是显示窗本体（X）。配置入口是配套的 Coopanion World 扩展 `glutton-balance`（Y），也可以直接改 `config.json`。

## 组成

| 文件 | 说明 |
|---|---|
| `Panel.cs` | 显示窗源码（C# 5 / Win32 + GDI+，无第三方依赖） |
| `Panel.V3.cs` | v3 白饭桶渲染 / 主题联动 / 布局 / `--selftest` / `--demo --shot`（与 Panel.cs 一起编译） |
| `panel.exe` | 编译产物（运行 `build.ps1` 生成；本源码包不自带 exe） |
| `build.ps1` | 用 Windows 自带 .NET Framework 4.8 的 `csc.exe` 重新编译（可 `-Out panel.dev.exe` 编译到别的文件名） |
| `config.json` | 运行配置（UTF-8 无 BOM；首次运行 panel.exe 会自动生成） |
| `config.example.json` | 配置样例（A6 的 a6User 留空，由用户填） |
| `panel-hidden.vbs` | 纯 ASCII 的隐藏启动器（wscript //B //Nologo，无黑框） |
| `install.ps1` | 安装：开机自启（HKCU Run）+ 开始菜单快捷方式 |
| `uninstall.ps1` | 卸载：停进程、删自启与快捷方式；`-PurgeFiles` 连程序文件一起删 |
| `panel.log` | 运行日志（只记金额/状态/定位，绝不记密钥） |


## 快速开始

把本目录放到默认位置 `%USERPROFILE%\.dsh\glutton-balance`（配套扩展从这里找显示窗；其他位置可用环境变量 `GLUTTONBALANCE_PANEL_DIR` 指定；旧变量 `PET_BALANCE_PANEL_DIR` 仍兼容，新变量优先）。

```powershell
# 1) 编译（必做；本源码包不自带 exe）
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1

# 2) 安装并隐藏启动（写自启 + 开始菜单快捷方式，桌面零文件）
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

# 3) 卸载
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

不想装自启，只临时看效果：双击或命令行运行 `wscript.exe //B //Nologo panel-hidden.vbs`；退出用 `panel.exe --quit`。

## 配置说明（`config.json`）

配置没有 UI 也能改：保存后 **5 秒内自动热载**（按文件修改时间检测，原子保存）。

```json
{
  "version": 1,
  "enabled": true,
  "clickThrough": true,
  "refreshSeq": 1,
  "hotkey": { "enabled": true, "combo": "Ctrl+Alt+Shift+R" },
  "position": {
    "mode": "under-feet",
    "bottomGap": 8,
    "offsetX": 0,
    "offsetY": 0,
    "zOrder": "topmost",
    "petPort": 7797,
    "clampMargin": 8
  },
  "providers": [
    {
      "id": "deepseek",
      "name": "DeepSeek",
      "type": "deepseek",
      "endpoint": "https://api.deepseek.com/user/balance",
      "keySource": { "kind": "dotenv", "file": "%USERPROFILE%\\.dsh\\.env", "var": "DEEPSEEK_OFFICIAL_API_KEY" },
      "threshold": 5,
      "intervalSec": 60,
      "enabled": true
    },
    {
      "id": "a6",
      "name": "A6",
      "type": "a6_newapi",
      "endpoint": "https://a6api.vip/api/user/self",
      "statusEndpoint": "https://a6api.vip/api/status",
      "a6User": "",
      "keySource": { "kind": "file", "file": "%USERPROFILE%\\.dsh\\secrets\\a6-console.txt", "var": "A6_CONSOLE_TOKEN" },
      "threshold": 5,
      "intervalSec": 60,
      "enabled": true
    }
  ]
}
```

### 顶层字段

| 字段 | 说明 |
|---|---|
| `enabled` | 显示窗总开关 |
| `clickThrough` | 点击穿透，默认开；关掉后窗口会接收鼠标（但不会抢焦点） |
| `refreshSeq` | 配置入口用它通知显示窗"立即刷新"：每次保存时自增 |
| `hotkey` | `Ctrl+Alt+Shift+R`（可改；避开背光灯占用的 U/J/B）立即刷新 |
| `position.mode` | `under-feet`：胶囊顶=角色脚底、压任务栏（推荐，需 `zOrder: topmost` 才看得见）；`hug-taskbar`：胶囊底=工作区底-8px |
| `position.bottomGap` | 仅 hug-taskbar：胶囊底距工作区底像素数 |
| `position.offsetX/offsetY` | 位置微调（正数向右/向下） |
| `position.zOrder` | `topmost`：最上层（压任务栏时用）；`below-pet`：插在桌宠窗口之后，角色永不遮挡 |
| `position.petPort` | Coopanion 桌宠 `/api/state` 端口 |
| `position.clampMargin` | 水平 clamp 时左右保留的最小边距 |
| `providers` | 最多 9 家 |

### 每家 provider

| 字段 | 说明 |
|---|---|
| `name` | 胶囊上显示的名字（自定义） |
| `type` | `deepseek` 或 `a6_newapi` |
| `endpoint` | 余额接口地址 |
| `statusEndpoint` | 仅 a6_newapi：换算参数接口（`quota_per_unit` / `payment_fx_rate_cny_per_usd` 动态取） |
| `a6User` | 仅 a6_newapi：`New-Api-User` 头。**留空时**会从 `keySource.file` 里读 `A6_ACCOUNT_ID`，再退到环境变量 `A6_ACCOUNT_ID` |
| `keySource` | `kind`: `dotenv`（读取 `var` 指定的环境变量行）或 `file`（读取 `var` 指定的键；单行文件则整行就是密钥）；`file` 支持 `%VAR%` 环境变量与 `~` |
| `threshold` | 低于该值 → 红点 + 红字；`null`/省略 = 不提醒 |
| `intervalSec` | 刷新间隔，10–3600 秒，默认 60 |

失败退避：连续失败按 10s → 30s → 60s → 300s 退避，恢复后回到设定间隔；数值没变化不重绘。失败的那一枚显示灰点 +「连接失败」，另一枚不受影响。

## 安全

- 只读余额接口，不调用任何模型，0 token、不扣额度；不向任何第三方上报数据。
- 密钥运行时从本机文件读取，只在内存里用：**不打印、不写日志、不上屏、不通过网络以外的地方传输**。
- 日志只记录金额、状态、定位与错误摘要（错误信息里的密钥会被替换成 `***`）。

## 定位（v2 实时跟随 + 桌宠上移）

- **实时位置**：每 250ms（`liveFollow.detectMs` 默认 250，可调）对「Cortico 桌宠」透明覆盖窗做一次 `PrintWindow(PW_RENDERFULLCONTENT)` 抓图，只扫**地面带**（窗口高-2 往上 230px，避开头顶气泡/悬停按钮）：逐列统计 RGB max>24 的像素数 → 连续列簇（宽 60–450）→ 取像素量最大的簇 → `角色中心 x = 窗口 Left + 簇中心`。
- **平滑跟随**：面板窗口 x 用 60fps 定时器（16ms/帧）按**每帧 25% 指数缓动**逼近目标位置，误差 <0.5px 停；不再出现每 2 秒跳一格。内容（金额/状态）不变时只挪窗口、不重绘位图。
- **兜底**：连续 3 次检测失败、或检测结果 1.5 秒未更新时，退回 `/api/state` 的 `startX × 窗口宽` 估位置（`/api/state` 的 startX 是 Coopanion 上次保存的位置，拖动后不实时变，所以只作兜底）。
- **桌宠上移（v2）**：每 tick 把桌宠透明覆盖窗顶边设为 `baseTop − lift`（`lift = 6 + 胶囊总高`，缓动约 300–450ms；`petLift.enabled` 可关）。这样角色被整体顶起，脚下留出正好放下整列胶囊的空间；窗口尺寸不变（2560×1437），退出/停用时恢复 `baseTop`。已被 Coopanion 重置时每 tick 自动校正。
- **位置**：整列胶囊底边 = 工作区底 − `position.bottomGap`（默认 8，即任务栏上沿上方 8px，**绝不压任务栏**），水平居中于角色中心并 clamp（左右 `clampMargin`）。
- **任务栏**：胶囊底=1384 < 任务栏上沿 1392，任务栏整条露出；每 500ms 重设 `HWND_TOPMOST|NOACTIVATE` 防止被任务栏压到后面。
- 显示器工作区按「桌宠窗口所在显示器」取（换屏/125%、150% 缩放时仍算对）。

## v2 竖排胶囊与类型体系（2026-10-31）

- 胶囊 200×30（圆角 15）、状态点 8px、名称 12px、金额 16px；同一竖直列**竖排重叠**，每枚下移 `capsule.height − capsule.overlap = 24px`，最多 `capsule.maxProviders=9` 枚（总高 = 30+(n-1)×24；`providers[0]` 在最上、贴角色脚底，绘制从最下开始、最上最后画，上层盖住下层顶部 6px）。
- 余额来源按 `type` 分三类（`preset` 决定解析规则）：
  - **official 官方**：`preset` 五选一，选了自动用对应接口与解析规则 ——
    - `deepseek`：`https://api.deepseek.com/user/balance`，`balance_infos[]` 里 CNY 的 `total_balance`
    - `kimi`：`https://api.moonshot.cn/v1/users/me/balance`，`data.available_balance`（注意 .cn 与 .ai 的 key 不互通）
    - `siliconflow`：`https://api.siliconflow.cn/v1/user/info`，`data.totalBalance`
    - `stepfun`：`https://api.stepfun.com/v1/accounts`，`balance`
    - `openrouter`：`https://openrouter.ai/api/v1/credits`，`data.total_credits − data.total_usage`（USD；**需 management key**，普通 key 会 403）
  - **relay 中转站**（new-api 系，A6 / One-API / New-API / Veloera / VoAPI 等）：站点地址 + `a6User`（New-Api-User，可空 → 回退凭据文件/环境变量 `A6_ACCOUNT_ID`）+ 状态接口（默认 `{站点}/api/status`）；余额 = `quota / quota_per_unit × payment_fx_rate_cny_per_usd`（CNY，两个换算参数从状态接口动态取）。
  - **custom 自定义**：接口地址 + Bearer + `jsonPath`（如 `data.totalBalance`）+ `currency`（CNY/USD），给长尾服务。
- 兼容旧配置：旧 `type: "deepseek"` → official+preset deepseek；旧 `type: "a6_newapi"` → relay(newapi)。旧 config 没有 `capsule/liveFollow/petLift` 段时用默认值（200×30、250ms、开）。

## 已知边界

- Windows 限定（读注册表自启、Win32 分层窗口、Coopanion 桌宠窗口发现）。
- 100% 缩放设计；`125%/150%` 时按 DPI 等比放大胶囊与字号。
- Coopanion 未运行时用上次读到的角色位置兜底。
- 角色被其它窗口完全遮挡时 PrintWindow 仍能抓到自身内容（不受遮挡影响）；若桌宠窗口本身被最小化/隐藏，则退回 `startX` 兜底。
- 桌宠上移是对 Coopanion 桌宠窗口做 `SetWindowPos`；Coopanion 自己改布局时会每 tick 自动校正，panel 退出/停用恢复原顶边。

## v3 白饭桶（2026-10-31，`display.style: "ricebowl"` 默认）

**一家一只小盆**并排摆在桌宠脚下：盆里白饭量 = `clamp(余额 ÷ 该家满盆金额, 0, 1)`；饭面三档直观——低额≈盆底一层、中档≈饭到盆口、满盆≈堆出尖冒出盆沿。盆身铭牌显示「状态点 + 名称 + ¥金额」；低额 = 红点红字+饭少，断线 = 空盆 + 灰字「连接失败」，其余盆不受影响。新增「大白饭」档（`provider.type: "rice"`）：啥都不用填、不联网不查余额，永远满满一盆的摆件彩蛋。

| 新配置字段 | 说明 |
|---|---|
| `display.style` | `ricebowl`（默认，白饭桶）/ `capsule`（旧胶囊回退） |
| `display.bowlStyle` | `porcelain` 白瓷饭桶（默认）/ `black` 黑陶饭桶 / `steel` 不锈钢饭桶；自定义 `custom:<名字>`（导入说明见下文「饭桶资源」）。**0.0.4 起删除 `enamel` 搪瓷外观：旧配置写 `enamel` 会自动回退 `porcelain`（白瓷）** |
| `display.nineLayout` | 家数 > `compactAfter` 时的排法：`pyramid` **金字塔（默认：底 4 / 中 3 / 顶 2，3 排完整可读，最底排最前）** / `row` 一排 9 只 / `twoRows` 两排（前 5 后 4，旧行为保留）。**旧值 `row9` 自动迁移为 `pyramid`**（旧默认值，仅内存归一，不改 config 字节）；显式 `row`/`twoRows` 保留 |
| `display.compactAfter` | 超过多少家进入紧凑模式，默认 5 |
| `display.refYuan` | 全兜底满盆金额（provider 没填 fullAmount 时用），默认 100 |
| `display.wheels` | **隐藏彩蛋**：仅 `display.wear=feet`（脚下）时生效，每家盆底两枚小轮、移动时旋转；默认 false；`head` 强制无轮。设置页开关已隐藏，字段保留兼容 |
| `display.wear` | **饭桶位置**：`head` **头顶（新默认）** / `feet` 脚下；`head` 时锚点=角色头顶、桌宠不抬升、水平跟随角色本体中心，并**强制隐藏轮子**（`display.wheels` 的值保留，切回 feet 恢复）。**缺省/空/未知值按 `head`**（旧 config 没写该字段，换新 panel.exe 后即默认头顶，不需要改 config）；显式 `feet` 保留 |
| `provider.fullAmount` | **每家单独填的满盆金额**（默认 100，可由扩展设置页修改）|
| `provider.type: "rice"` | 大白饭档（免 endpoint/key/阈值/刷新） |
| `theme.follow / port / statePort` | 主题联动：读 Coopanion `/api/state` + `/api/theme`，默认 true / 17788 / 7797 |
| `theme.force` | 测试用：`dark` / `light` / 空=跟随（测试暗浅对比用，临时改记得恢复） |
| `theme.pollMs` | 主题轮询间隔，默认 3000ms，接口失败回退 v2 深色配色 |
| `interaction.expandOnClick` | `clickThrough=false` 时点面板展开余额明细（阈值/刷新间隔/最近刷新），再点收起；默认 true |
| `position.monitorFollow` | 面板跟随桌宠所在显示器的工作区与 DPI（Per-Monitor V2），默认 true |

- **布局与几何**：2 家盆 90×52、间距 8（组宽 188、组高 62）；**默认头顶（`display.wear=head`）**：盆组底=角色头顶+3×dpi、桌宠不抬升、贴边 clamp；切 `feet` 时盆底固定 `工作区底 − bottomGap(8) = 1384`、桌宠上移脚底踩盆沿（误差 ≤2px）。9 家 `pyramid` 金字塔三排完整可读（底 4/中 3/顶 2，排间纵向错位 = 桶高 + 米堆余量，不遮后排名牌），组更窄更高，`--selftest layoutProbe` 有逐槽几何。
- **主题联动**：盆体材质（钢/陶瓷）不跟主题变；铭牌底色、描边、名称/金额/状态点/阴影颜色跟随 Coopanion dark/light 主题（浅色自动浅色），每 3s 或主题变化时刷新。**Mac 0.0.3 起：主题来源改为 macOS 系统深浅色（Electron `nativeTheme` + `updated` 事件），系统外观切换即时生效；`theme.force` 手设优先级保留。**
- **动效**：60fps 弹簧缓动（到点轻微回弹）+ 静止 1px 内浮动；`display.wheels=true` 且 `wear=feet` 时盆底双轮随位移按速度旋转（轮子角度连续累计，不跳帧）、静止停转；`wear=head` 强制无轮（隐藏彩蛋口径）。**Mac 0.0.3 起：改为临界阻尼跟随（无过冲、按真实 dt 积分）、取消静止浮动、改尺寸按底边中点锚定、定位与尺寸就绪后才显示；Win 端未移植（0.0.4 仍未同步，属已知差异，不算回归）。**
- **无窗口工具**（给测试/出图，不建窗口、不打扰正在运行的面板）：
  - `panel.exe --selftest <out.json>`：输出 env（显示器/工作区/DPI 感知/`wear`+`wearRaw`/`nineLayout`+`nineLayoutRaw`）+ `ricebowl`/`capsule` 两种形态 × 2..9 家 × dpiScale 1.0/1.25/1.5 的几何（宽/高/step/组高/组顶/组底/居中/lift/compact/`pyramid`/`rowCounts`）+ **`layoutProbe{}`**（pyramid 6..9 家 × 四档缩放逐槽几何、row/twoRows 兼容、可读性对比）。
  - `panel.exe --demo N [--shot <png>] [--label L1|L2|L3] [--wear head|feet] [--layout pyramid|row|twoRows] [--theme dark|light] [--scale 0.5|1|1.5|2] [--state normal|low|offline|rice]`：N 家演示数据（前 2 家真实样例 + 其余用「大白饭」档凑数）；带 `--shot` 时按给定组合渲染 PNG 后退出，不开窗口、不写 config。
- **日志键**（`panel.log`，不含任何密钥）：`theme apply src= theme= selectedId=`、`dpi ... monitor=`、`config loaded ... wear= nineLayout=`、`display style= bowl= labelStyle= wear= count= compact= layout= pyramid= twoRows= rows= groupW= groupH= lift= expanded=`、`lift target= ... feetScreen=`、`interact expand/collapse source=click`、`transition providers=..->.. groupH=..->..`、`shot saved ... layout= rows= wear= theme= petScale= state=`。



## v3 资源化渲染（2026-10-31 晚）

- **尺寸跟随桌宠**：`graphicsScale = clamp(/api/state 的 petScale ÷ display.petScaleRef, display.graphicsMin, display.graphicsMax)`；默认 `petScaleRef=1.05`（100% 时 scale=1.05）。盆宽 = `77px × 0.80 × graphicsScale × dpiScale`（77px=100% 时实测角色像素宽），盆高/组高/米饭窗口/标签字号全部同比例；盆底固定 1384，桌宠 `lift = 6×graphicsScale + 组高`，角色大小变化时平滑过渡。100%（盆 62px/角色 77px）与 200%（盆 117px/角色 150px）比例偏差 <4%（误差 ±10%）。
- **配置字段**：`display.bowlStyle`（预设 **`porcelain` 白瓷饭桶（默认）** / `black` 黑陶饭桶 / `steel` 不锈钢饭桶；自定义 `custom:<名字>`；**0.0.4 起 `enamel` 搪瓷外观已删除，旧值自动回退 `porcelain`**）、`display.labelStyle`（**`L3` 盆沿木牌（默认）** / `L1` 盆沿小字 / `L2` 饭票小旗）、`display.wear`（`head` 头顶（默认）/ `feet` 脚下）、`display.nineLayout`（`pyramid` 金字塔（默认）/ `row` 一排 / `twoRows` 两排）、`display.petScaleRef/graphicsMin/graphicsMax`。
- **饭桶资源（PNG+JSON）**：内置在 `bowls/`（black/porcelain/steel，随包发布、不含本机内容）；用户自定义放 `%USERPROFILE%\.dsh\glutton-balance\bowls\`；加载顺序：用户目录 → 内置，缺字段/损坏回退内置黑盆并在日志记 `WARN bowl load failed ... fallback=black`。
  - PNG：PNG-32 带透明通道、透明背景、只画空碗、碗居中、碗底贴图片底边；推荐 2x（内置为 400×340）。可选 `back` 字段指定内壁层（先画内壁→米饭→再画壳/前沿，实现「米盛在碗里」）。
  - 同名 JSON：`{"name":"白瓷碗","rice":{"x":90,"y":40,"w":220,"h":260},"rimY":160,"anchor":"bottom-center","scaleHint":1.0}`；`rice`=米饭可绘制矩形（图片坐标），米饭按 fill 0→1 从底往上长、可堆出沿；`rimY`=碗沿 y；`anchor` 默认 `bottom-center`；`scaleHint` 预留。
- **米饭渲染**：预渲染 **11 档 fill（0..1）米粒位图** 缓存（`RiceCache`），60fps 只做 blit；米饭按碗内沿铺满、先米后碗（碗沿压住米下缘）、蓬松微起伏堆顶、浅灰米粒缝隙、无底部阴影；低额薄层/中档到盆口/满盆堆尖。
- **日志键新增**：`bowl load ok id=.. name=.. source=builtin|custom`、`WARN bowl load failed ... fallback=black`、`scale apply petScale=.. petScaleRef=.. graphicsScale=..`。
- **`--selftest` 新增字段**：env 里 `petScale/petScaleRef/graphicsScale/bowlStyle/labelStyle`，`bowls[]` 皮肤清单（id/name/source/ok），`layouts[]` 含 `petScale`（1.05/2.0）× dpiScale（1.0/1.25/1.5）× 2..9 家几何。

- **放大上限（graphicsMax）**：`graphicsMax=2.0` 表示饭桶/木牌/米饭最多放大到 100% 基准的 200%；桌宠继续放大（如 1000%）时饭桶**不再变大**（尺寸封顶 200%），只保持位置跟随。改 `display.graphicsMax` 可调整上限（0.3~4.0）。
- **热替换饭桶**：面板加载饭桶 PNG/JSON 后即释放文件句柄，并按 mtime 每 5s 扫描；在扩展设置页「打开饭桶目录」里替换/新增后无需重启面板即可生效（日志 \owl reload id=... reason=mtime\），删除则回退内置黑盆。

- **可读下限（2026-10-31 定档）**：为保证「金额字号 ≥9px、家名 ≥8px」在任何桌宠档位都可读，display.graphicsMin 默认 **0.95**（50% 档时盆保持约 100% 设计尺寸，不再继续缩小）；graphicsMax=2.0（200% 上限）。


## v3-C 桶形版（2026-10-31 晚，第三次改版）

- **圆柱饭桶**：3 个内置预设（`porcelain` 白瓷桶（默认）/ `black` 深色饭桶 / `steel` 不锈钢饭桶；0.0.4 起删除 `enamel` 搪瓷桶，旧配置回退白瓷）同一「直筒略收底 + 平口椭圆桶沿 + 1~2 圈桶箍 + 竖向高光」造型，材质配色不同；资源 320×400 PNG+back+JSON（1:1 桶约 62×74px，桶身正面直上直下）。
- **分层**：`back`（内壁+后桶沿，无任何描边线）→ 米饭贴图 → `front`（桶身轮廓+前桶沿+桶箍+高光）。JSON 字段：`name / rice{x,y,w,h} / rimY（桶沿中心）/ rimBottom（前桶沿最低点）/ back / anchor / scaleHint`。
- **米饭**：AI 米堆贴图；溢出高度 = fill × 45% 桶前脸（桶底−前桶沿最低点），fill≥0.8 溢出 ≥30%、fill=1 视觉 40~50%；桶组顶部预留 18% 高度避免堆顶裁平；米堆圆润、可略宽于桶口。
- **木牌（L3）**：只含「绿点（左上角）+ ¥金额」，宽 ≈78% 桶宽（`0.78×BowlW`，且不小于 `36×scale`、不超桶宽−`2×scale`，随桌宠档位等比放大；原固定 40px 在 200% 档会遮不住金额）、高 13×scale（1:1 13px）、上沿 = 前桶沿最低点 +1px；金额 ≥9px 完整不省略。
- **木牌颜色跟随 dark/light 主题**：牌底色/描边/投影改为读 Coopanion 主题 palettes（`paper`/`sheet` 纸色与 `warn` 木色混合 + 两条木纹）——暗色主题=深胡桃木牌+浅色金额，浅色主题=浅桦木牌+深色金额；金额/低额红字/断线灰字/大白饭金色分别取主题 `ink`/`danger`/`ink-dim`/`chart-miss` 并按牌底色补足对比度（≥4.5）。主题切换时铭牌亮度差实测 ≥0.30（测试 THEME-12），牌体仍保留木色与木纹，不是纯黑/纯白方块。
- **名称刻字**：木牌下方桶身，`8px×scale`，暗+亮双偏移刻痕；可用宽 = 桶身宽×0.92（再夹到可用带内并留左右 ≥1px 与刻痕阴影余量），超长自动缩字号（下限 `7px×scale`），仍放不下则中间省略「…」（保留头尾、省略后左右仍 ≥1px）；下缘距桶底 ≥4×scale。`--selftest` 的 sizeScan 增出 `nameFitPx/nameFitW/nameMinPx/nameShrunk/nameEllipsized/nameDrawText` 交付数字，另含 `nameFit[]` 长名四档与 `themePlaque{}` 木牌亮度离线证明。

- **可读下限**：`display.graphicsMin=0.95`（50% 档桶保持约 100% 设计尺寸，保证金额≥9px/家名≥8px）；`graphicsMax=2.0`（200% 上限）。
- **selftest sizeScan**：`petScale=0.5/1.0/1.5/2.0` 逐档输出 `graphicsScale/clampedMin/clampedMax/bowlW/bowlH/groupW/groupH/compact/lift/rimY/bowlBottom/frontFace/plaqueY/plaqueH/plaqueW/frontPct/plaqueNoRimOverlap/amountPx/namePx/nameY/nameH/nameTextW/nameMaxW/nameFits/nameBottomGap/nameContrast/dotVisible/heapOverflowPct/plaqueOnlyAmount`，供 LABEL-02/07/08、RICE-OVERFLOW 判据。

## v4 数值样式统一 + 饭桶位置两态（2026-11-01）

- **三款数值样式统一（L1/L2/L3）**：共用一套视觉令牌——名称 `max(8, 8×scale)`px、数值 `max(9, 9×scale)`px、绿点直径 `4×scale`（与 L3 同款暗影+亮边+高光）、三段顺序固定「名称 → 绿点 → 数值」且水平居中。**L1 盆沿小字**直接复用 L3 三条带几何（名称/绿点/金额与木牌同高，不再名字偏高、绿点偏左）；**L2 饭票小旗**旗宽按文字自适应（上限 98% 桶宽）、文字先缩字号保完整（下限 7px×scale），旗底不越过前桶沿上沿线；**L3 木牌外观保持定稿不变（像素级零变化）**。
- **饭桶位置（`display.wear`）**：`head` **头顶（2026-11-01 起默认）**：盆组底=角色头顶+3×dpi、桌宠不抬升、水平跟随角色本体中心、贴屏幕上下边 clamp、缩放/穿透/主题全沿用、**强制无轮子**；`feet` 脚下（显式配置才用）：盆底=工作区底−bottomGap、桌宠抬升使脚底踩盆沿。面板每 5s 热载 config，改 `display.wear` 后自动切换，无需重启面板。
- **无窗口工具新增**：`--shot <png> --demo N [--label L1|L2|L3] [--wear feet|head]`（覆盖出图用的数值样式/位置，不写 config）；`--selftest` 新增 `env.wear`、`labelStyles[]`（三款×四档位置/字号/对比度/完整度）、`wearProbe{}`（两态几何：feet lift、head 定位公式、贴边 clamp 样本、四档尺寸、轮子互斥），供 LABEL-11/12/13、WEAR 测试组使用。
- **日志键新增**：`config loaded ... wear=feet|head`、`display ... wear=..`、`place ... wear=.. headY=..`。

## v5 默认头顶 + 金字塔排法 + 隐藏轮子彩蛋（2026-11-01）

- **默认形态改头顶**：`DisplayConfig.Wear` 默认 `head`；`ConfigStore.Load` 缺省/空/未知值一律归一化 `head`（旧 config 没写 `wear` 字段 → 部署新 exe 即头顶，**不改 config 字节**）；`--selftest env.wear=env.wearRaw=""` 证明「缺省→head」迁移。
- **新增 9 家金字塔排法并设为默认**：`display.nineLayout=pyramid` —— 底 4 / 中 3 / 顶 2，每排水平居中、纵向错位 = 桶高 + 米堆余量（三排都完整可读，前排不遮后排名牌/数值），桶宽按两排同档 0.92 不缩小（比一排 0.80 大 15%）；n=6/7/8 自动 3/2/1、4/3、4/3/1。**旧默认值 `row9` 迁移成 `pyramid`**；一排新值为 `row`；`twoRows` 保留旧行为。selftest 新增 `layoutProbe{}`（pyramid 6..9 家 × 四档缩放逐槽几何 + row/twoRows 兼容 + 可读性 `pyramidVsRowPct`），测试新增 LAYOUT 组。
- **轮子彩蛋隐藏**：仅 `wear=feet` 生效（`head` 强制 `WheelH=0`）；`display.wheels` 保留默认 false，设置页开关已隐藏；README/`--shot` 出图口径同步。
- **`--shot` 组合出图参数**：新增 `[--layout pyramid|row|twoRows] [--theme dark|light] [--scale 0.5|1|1.5|2] [--state normal|low|offline|rice]`，用于 3 样式×3 排法×2 形态×2 主题×4 缩放全组合效果图（组合图索引随交付附带）。
- **兼容**：L3 单排（2 家）渲染与上一版 exe **逐像素 0 差异**（L1/L2 同）；`config.example.json` / `WriteDefault` 同步 `wear:"head"` + `nineLayout:"pyramid"`。
