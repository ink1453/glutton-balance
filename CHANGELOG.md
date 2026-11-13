# 更新日志

## 0.0.8（2026-11-13 发布）

金额一律去掉小数位；新增 `minicard`（面板）显示样式；恢复 / 新增 Qoder 供应商；积分单位符号 `₡` → `C `。Windows 显示窗 / macOS 显示窗同号 0.0.7。

### 通用（双端一致）

- **金额去掉小数位（双端口径逐条对齐）**：显示金额一律取整，`¥82.03` → `¥82`、`C 1528.44` → `C 1528`。三端口径完全一致，避免明细卡与主显示窗对同一笔余额显示不同数字：①**四舍五入**；②**负数远离零**（`-82.5` → `-83`，不是 `-82`）；③**`-0` 归一为 0**（`Math.round(-0.5)` 在 JS 里得到 `-0`，会显示成 `-0`）。实现：macOS 在 `main.js` 新增 `moneyText()`（`amountText()` / `detailSubText()` 统一走它），`renderer/renderer.js` 的 `moneyText()` 逐字同口径；Windows 在 `Panel.cs` 新增 `UnitFormat.Money()`（`UnitFormat.Format()` 统一走它）。**判断缓存指纹也按取整后的值算**，否则小数位抖动会触发无谓重绘、而屏幕上还是同一个数字。
- **新增 `minicard`（面板）显示样式**：除原有「饭桶」外新增**竖排小面板**形态——一行一家、左边家名、中间状态点（绿 `#30d158` / 橙 `#ff9f0a` / 红 `#ff453a`）、右边金额，macOS 圆角磨砂质感；适合小屏幕、省地方。`display.style` 新增合法值 `minicard`（大小写不敏感，未知值仍安全回退 `ricebowl`，旧值 `ricebowl` / `capsule` 行为完全不变）；`ricebowl` 有零变化双证据（951 组几何哈希全等 + 双窗口逐像素 A/B `PASS=66 FAIL=0`）。实现是**独立新增** `computeMinicard()`，由 `computeLayout()` 分派进入，主窗口逻辑不动。macOS 附 `build/switch-style.sh` 一键切换（无参数只看当前，自动备份配置 + 刷新面板）。
- **单位符号 `₡` → `C `**：Qoder 这类积分源原来显示 `₡2177`，其中 `U+20A1`（科朗符号）在中文字体（PingFang SC）里**缺字**，会掉到系统回退字体、字重明显不匹配；改为**字母 `C` + 空格**（`C 1528`）。积分源仍不是钱，不加 `¥` / `$`。
- **版本号**：macOS `package.json` 0.0.7、打包脚本 `APP_VERSION=0.0.7`（合法 semver）；Windows `0.0.7`（与 Mac 同号）。兼容：新增字段（`display.style` 的 `minicard`、供应商 `unit`）全部可选，旧 `config.json` 原样可用。

### macOS 显示窗（v0.0.8）

- **金额取整 + `C ` 单位**：`main.js` 新增 `moneyText()`，`amountText()` 改为 `¥82` / `$82` / `C 1528` 三口径；`detailSubText()` 的低额提醒阈值同口径（`低于 ¥5 变红` / `低于 5 Credits 变红`）；`renderer/renderer.js` 的 `CREDITS_SYMBOL` 由 `₡` 改为 `C `，木牌上不再写 "Credits" 字样。
- **minicard 缩放修正（`sizePct` 等比）**：整体缩放 `sizePct` 早先只作用在卡片**宽度**的 clamp 边界上，行高 / 内边距 / 圆角 / 状态点 / 字号全部没跟着缩，导致 `sizePct<100` 时「卡缩小、内容不缩」，家名列被挤到下限、`DeepSeek` 显示成 `Dek…`。现将行高 `rowH`、上下左右内边距 `padX`/`padY`、圆角 `radius`、状态点 `dotD`/`dotGap`、中缝 `midGap`、字号 `namePx`/`amountPx`、金额列宽 `amountMaxW` 全部乘 `K = sizePct/100`，卡宽基础值同样乘 `K` 并以内容需求宽度 `needW` 作为上下限的地板，`namePx`/`amountPx` 保留 `max(8*K, …)` 下限。验证：`sizePct` 50/70/85/100/130/200 六档 × 1~9 家 × DPI 1/2 共 60 组几何回归全绿；离屏渲染深/浅双主题 × 70%/100% 出图核对，真机截图确认 `DeepSeek` / `「中转站」` / `Qoder` 三行完整无省略号。
- **minicard 小面板**：见上「通用」。`src/layout.js` 新增 `isMinicard()` / `computeMinicard()`（小面板几何全由布局层算好，渲染层只读尺寸，不再自己算），`src/style.js` 新增 minicard 配色 token（**挂在独立子对象上，既有 30 个配色键一个都不动**），`renderer/renderer.js` 新增小面板绘制路径（`style !== 'minicard'` 时完全走原路径）。
- **Qoder 供应商**：`src/providers.js`（薄壳 → `shared/providers-core.js`）支持 Qoder 积分查询（PAT 换 jt- 票据 + 进程内缓存 + 401 强制重换一次）；配置预设新增 `qoder`（默认关闭、`unit: CREDITS`）；密钥只读 `~/.dsh/secrets/qoder-pat.txt`（`QODER_PAT`），日志与界面均不带密钥。

### Windows 显示窗（v0.0.8）

> **修复「面板 / 饭桶」切换后尺寸不对、饭桶完全不吃 sizePct（整体缩放）**
> 现象：Mac 上「整体缩放 70%」饭桶和面板都乖乖缩小，Win 上切到「饭桶」立刻弹回原尺寸 —— 同一份 `config.json`，Win 比 Mac 大一圈。
> 根因两处，都是**硬下限没跟着 K 缩放**（K = `display.sizePct / 100`）：
> ① `ScaleMath.GraphicsScale()` 完全没乘 K —— Mac 的 `graphicsScale()` 末尾有 `* k`，Win 漏了。于是 Win 只有 minicard 在 `McLayout` 内部单独乘了 K，**饭桶（ricebowl）这条路径 K 一次都没用上**，`sizePct` 设 40 或 200 都纹丝不动。
> ② `BowlLayout.Compute()` 里 `baseW < 46`、`baseW > 190`、`if (baseW < 40)`、`Math.Max(8, …)`、`Math.Max(4, …)` 全是**裸常数下限**；Mac 早就写成 `clamp(baseW, 46 * K, 190 * K)`、`max(8 * K, …)`、`max(4 * K, …)`。下限不乘 K 就会出现「碗按 K 缩了、下限却顶住」的挤压丑态。
> 修复：`GraphicsScale()` 末尾 `return gs * SizePctK(cfg)`（新增 `internal static double SizePctK(Config)`，非法/≤0 → 1.0 保证零变化）；`BowlLayout.Compute()` 的碗宽上下限、compact 下限、碗高下限、间隙下限全部改成 `常数 * K`。K 只作用于显示尺寸，不回写配置。
> 验证：`--shot` 用**与 Mac 完全相同的参数**（`petScale=1.5`、`dpiScale=1`、`count=2`、`display.wear=head`、`nineLayout=pyramid`）跑 2 形态 × 4 档共 8 组，与 Mac `layout.js` 逐格比对 **7/8 逐像素一致**（`ricebowl` 40/70/100/200 = 73×37 / 130×64 / 185×92 / 369×185，`minicard` 40/70/100 = 67×20 / 151×56 / 308×114 全等；`minicard` 200 为 1084 vs 1085，仅取整差 1px）。`ricebowl` 四档从「全部 185×92 恒定」变为线性 96→130→185→369。
> 真机：Win `panel.exe` 184,320 B / ver 0.0.7.0，pid 43600 Session 1，`refreshSeq=30`，三家余额正常（`deepseek 78.92` / `qoder 826.00 CREDITS` / `a6 33.78`）。

> **修复 Qoder 在 Windows 上「NETWORK (qoder.exchange)」连不上（TLS 版本）**
> 现象：Mac 端 Qoder 正常显示 `C 959`，Win 端日志一直 `balance id=qoder failed error=NETWORK (qoder.exchange)`，而 DeepSeek / A6 同时都正常。
> 根因：Win 端用 **.NET Framework 4.0 的 csc** 编译，其默认 `ServicePointManager.SecurityProtocol` 只有 **Ssl3 + Tls(1.0)**；`openapi.qoder.com.cn` 只接受 **TLS 1.2 以上**，握手直接失败 → `WebExceptionStatus.SecureChannelFailure` → 分类码落到 `NETWORK`。DeepSeek / A6 的服务器仍兼容 TLS 1.0，所以一直是好的，把问题掩盖了。
> **排障陷阱**：在 PowerShell 里手动 `Invoke-WebRequest` / `HttpWebRequest` 测同一个接口**全部返回 HTTP 200** —— 因为 PowerShell 跑在系统自带的新版 .NET 上，默认就开 TLS 1.2。必须用**与目标程序同一个 csc 编译**的 C# 探针复刻 `HttpRequest` 才能复现（探针打印 `SecurityProtocol=Ssl3, Tls` 即坐实）。
> 修复：`Panel.cs` 新增 `Program.EnableModernTls()`，在 `Main` 第一行调用，显式设置 `SecurityProtocol = 3072 | 768 | Tls`（Tls12 + Tls11 + Tls，用数值兜底避免老编译器没有 `Tls12` 枚举成员），不支持时静默回落 TLS 1.0，不影响 DeepSeek / A6。
> 验证：同一份 csc、同一 Session，加这一行前后对比 —— `SecureChannelFailure` → `HTTP 200 hasToken=True`；真机日志 `balance id=qoder ok amount=899.00 currency=CREDITS latencyMs=282`，三家全部正常（`deepseek 79.06` / `qoder 899.00 CREDITS` / `a6 33.78`），窗口 `w=216 h=110` 三行完整。

> **真机验证（2026-11-13，墨墨的 Win 机器）**：`panel.exe` 版本资源 `0.0.7.0`，编译零错误；真实 API 余额查询正常（`deepseek 79.28` / `a6 33.78`）；`minicard` 与 `ricebowl` 反复切换 4 次全部稳定，几何精确（`ricebowl` 185×92、`minicard` 308×114，2 家）；离屏出图核对 8 种状态（深/浅主题 × normal/credits/fail/stale/low/rice），CREDITS 显示 `C 1528`、失败显示「连接失败」+ 红点、断网韧性显示上次成功值灰字、低额显示橙点；浅色主题金额对比度 **20.82:1**、深色 **17.36:1**（WCAG AA 要求 4.5:1）。

> **真机验证补记（配色双端对齐）**：出图核对时发现 Win 的 `McRenderer` 直接复用了饭桶的**主题语义色**（`DotGreen` / `DotRed` / `LowColor` 等），画出来是青绿 + 砖红 + 土黄，而 macOS 的 minicard 用的是 **iOS 系统色**（绿 `rgb(48,209,88)` / 橙 `rgb(255,159,10)` / 红 `rgb(255,69,58)`）——两套不是一回事，肉眼可见不一致。已在 `McRenderer.RowColors()` 内按 `style.Light` 纯函数取色（不再依赖 `VisualStyle` 的 `Build()` / `FromPalette()` / `Fallback()` 三条构造路径，避免漏填字段拿到 `Color.Empty` 画成透明），逐条对齐 macOS `minicardRowColors()`：`rice → dotOk/amountRice`、`!hasResult||!ok → dotFail/amountFail`、`low → dotWarn/amountLow`、其余 `dotOk/amount`。

> **补齐 sizePct（Win 端整体缩放，两端终于一致）**
> 之前 Win 端的 `McLayout.SizeScaleOf()` 硬编码返回 `1.0`，而老板配置里 `display.sizePct` 是 **70** —— 结果同一份配置 Mac 画 302px 宽、Win 画 431px 宽，**Win 比 Mac 大 43%**，肉眼可见。
> 本轮把这条路彻底接通：`Panel.cs` 的 `DisplayConfig` 新增 `SizePct` 字段（默认 100），配置解析用 `Json.GetNumber(disp,"sizePct")` + `ClampDouble(v,40,200)` + `Math.Round` 取整（与 Mac `shared/config-core.js` 的 `clampNum(...,40,200)` + `int()` 逐条对齐）；`Panel.V3.cs` 的 `SizeScaleOf()` 改为读 `cfg.Display.SizePct/100.0`，非法值兜底 1.0。
> **实测四档全部线性**（Win 出图）：`100% → 308×114`、`70% → 216×80`、`40% → 123×46`、`200% → 616×230`，缩放精确到 0.1%。真机部署后日志确认窗口 `w=216 h=80`，与实际配置的 70% 吻合。
> **同时补上设置页控件**：此前 `world/dist/webui.js` 里 `sizePct` **一个字符都没有**，老板只能手改 `config.json`。现新增「整体缩放（%）」输入框（40–200，步进 5，默认 100），与「面板 / 饭桶」下拉同排；保存时做 `Math.round` + clamp 40..200，非法值回 100。

> **顺带修掉一个双端共有的对比度缺陷（低额金额）**：minicard 的「低额」金额原本用亮橙 `rgb(255,149,0)`，叠在浅色卡面（白底）上只有 **2.2:1**，远低于 WCAG AA 要求的 4.5:1——金额是文字，读不清就是缺陷（状态点是小色块、有背景衬托，保留亮橙以维持警示观感）。两端同步改为：**浅色主题金额用深橙 `rgb(166,88,0)`（5.01:1，实测出图 6.89:1）**，深色主题橙底本就够亮（9.39:1）保持原样。macOS 改 `src/style.js` 的 `buildMinicardStyle()`，Win 改 `McRenderer.RowColors()`。修复后实测：浅色正常 `20.13:1`、深色正常 `16.63:1`、浅色低额 `6.89:1`、深色低额 `9.39:1`、深色米饭 `13.93:1`，全部过 AA。


- **`UnitFormat` 取整 + 显示单位**：`Panel.cs` 新增 `UnitFormat` 静态类（`CNY` / `USD` / `CREDITS`，大小写不敏感；缺省按 preset 推导——`qoder`→`CREDITS`、`openrouter`→`USD`、其余 `CNY`）。`UnitFormat.Money()` 取整，口径与 macOS 逐条对齐（四舍五入 / 负数远离零 / `-0` 归一为 0）；`Format()` 输出 `¥12` / `$12` / `C 2177`（0.0.7 定稿：积分符号改成前缀 `C ` + 空格，**与 macOS `CREDITS_SYMBOL` 逐字一致**，不再输出 `2177 Credits` 这种带英文单位的旧写法；`Symbol()` / `Suffix()` 承担这一口径），`ThresholdText()` 明细卡阈值保留 `5 Credits` 旧写法（属配置说明文本、不是余额金额）。`Panel.V3.cs` 的 `AmountText()` 改为转调 `UnitFormat.Format()`，明细卡阈值行同步改用 `UnitFormat.ThresholdText()`。缓存指纹同样按取整后的值算。
- **minicard 支持（原生 GDI+ 实现）**：显示窗 `panel.exe` 是纯 Win32 + GDI+ 程序（不是 Electron），无法引用 `renderer/renderer.js`，故按 macOS 的几何与配色**逐项移植**为 C#：`Panel.V3.cs` 新增 `McLayout`（算几何，常量与 macOS `src/layout.js` 的 `computeMinicard()` 一一对应：`MC_RATIO=2.8`、`MC_ROW_H=30`、`MC_PAD_X/Y=16/10`、`MC_RADIUS=14`、`MC_NAME/AMOUNT_PX=13`、`MC_DOT=8`、`MC_MIN/MAX_W=168/460`）与 `McRenderer`（GDI+ 绘制，走既有 `RasterScale` 2× 超采样 + 预乘 alpha，与饭桶形态共用同一套抗锯齿管线）。`Panel.cs` 五处接线：`mini` 标志、`ComputePlacementLocked()` 优先分支、渲染派发优先分支、`ViewNamesForMini()` 辅助、配置解析白名单（`minicard` / `capsule` / 其余回退 `ricebowl`）。窗口尺寸与位图尺寸由**同一次** `McLayout.Compute()` 得出，`PaintLayered` 整幅 Blit 不会错位。**Win 0.0.7 只支持 `sizePct=100`**（`McLayout.SizeScaleOf()` 固定返回 1.0，留了接 `display.sizePct` 的注释位），整体缩放属后续版本。
- **`config.example.json` 增补 Qoder 预设**：`preset: "qoder"`、`unit: "CREDITS"`、PAT 走 `%USERPROFILE%\.dsh\secrets\qoder-pat.txt`（变量 `QODER_PAT`），默认 `enabled: false`。

## 0.0.6（2026-11-12 发布）

修复 macOS 显示窗「打游戏时桌宠说话 / 倾听气泡把饭桶放大」与「petprobe 挂死后面板消失」；仓库同步 Windows 端 2026-11-08 现网修复（字体 2× 超采样、断网韧性）。Windows 显示窗 / macOS 显示窗 / Coopanion 扩展同号 0.0.6（界面 / 市场显示 v0.06）。

### 通用（三端一致）

- **版本号**：`package.json` 0.0.6、界面 / 市场显示 **v0.06**；无配置字段变化，旧 `config.json` 原样可用。
- **仓库同步（Windows 端 2026-11-08 现网修复合并回仓库，随 0.0.6 重打包）**：此前 Windows 线上已有、但 macOS 仓库副本从未合并的两条修复——①**字体清晰度 2× 超采样**（`Panel.V3.cs`，高分屏字更清晰）；②**网络瞬断韧性**（`Panel.cs`：最后成功金额 10 分钟内灰字保留、失败按 3 / 8 / 20 / 60 秒退避）——本轮已同步进 `repo/`，Windows 0.0.6 源码包即该版本（**相对 0.0.5 发包多这两项已上线修复**；功能与 2026-11-08 现网版相同，只是源码与文档同号 0.0.6）。

### macOS 显示窗（v0.0.6）

- **说话 / 倾听气泡不再把饭桶放大（双门控）**：桌宠说话、倾听时气泡把角色包围盒撑宽（真机日志 191.5×174，宽 2.2×/高 1.6×），旧逻辑按宽度重定基准 → 饭桶被放大、窗口 145×72 跳变到 258×128 再缩回。修法：①**形状一致性门控**——重定基准前比对宽度倍率与「按宽度等比应有的高度」，宽高不等比（±10% 容差）判为气泡 / 遮挡帧、当帧丢弃不累计（持续 >2 分钟才当真实形状变化放行，避免误杀换宽扁皮肤）；②**Coopanion `/api/state` 桌宠尺寸 / 皮肤权威值校核**——只有官方尺寸真变了才接受。真实的改缩放 / 换皮肤仍按比例匹配。
- **petprobe 挂死自重启、面板不再消失**：打游戏时 `petprobe` 的 SCK 采图挂死（进程在、0% CPU、行号不推进），旧逻辑判「桌宠消失」把面板隐藏且不恢复。修法：新增**探针看门狗**（行号超时未推进即判定挂死并自动重启 petprobe）；「隐藏」判据由 5 秒兜底改为 **30 秒探针死透才隐藏**，恢复后面板自动回来。
- **米饭口径与本机 Windows 对齐（2026-11-10 修复）**：`renderer/renderer.js` 的 `drawRice()` 改回 Win 口径（master 整堆 + 溢出 0.45），米饭更饱满、满盆不再遮内壁；此前 0.0.5 发包时未含此改动。
- **回归**：离线仿真 `mac/test/scale-gate-sim.js`（不启动 GUI、不依赖 Electron）覆盖「气泡等比膨胀 / 不等比 / 真实缩放」三类 **6/6 PASS（双门控 6 场景）**；真机验证面板 **145×72 不变**、`SIGSTOP` 冻结探针实测约 **6 秒自动恢复**。

### Windows 显示窗（v0.0.6）

- 本版**无功能改动**（源码 = 2026-11-08 现网修复版，见上「仓库同步」）；随 0.0.6 统一版本号重打包，`INSTALL.md` / `README.md` 刷新为 0.0.6 口径。

### Coopanion 扩展（`glutton-balance` v0.0.6）

- 扩展代码无功能改动，只随发版改版本号（`WORLD_VERSION='0.0.6'`、`VERSION_LABEL='v0.06'`）；界面 / 市场显示 **v0.06**。

## 0.0.5（2026-11-05 发布）

桌宠隐藏 / 退出后饭桶自动隐藏、桌宠回来自动显示（Windows + macOS 双端，约 1 秒内）；修复「点击 / 右击桌宠后饭桶变大」；Coopanion 扩展新增智谱 GLM 预设与密钥导入 / 删除按钮。Windows 显示窗 / macOS 显示窗 / Coopanion 扩展同号 0.0.5。

### 通用（三端一致）

- **桌宠隐藏 / 退出 → 饭桶自动隐藏，桌宠回来自动显示（双端）**：桌宠被隐藏或退出后，显示窗约 1 秒内自动隐藏，不再一直悬浮在桌面；桌宠重新出现后自动显示并恢复跟随定位。
- **修复「点击 / 右击桌宠后饭桶变大」**：点击桌宠会弹出右键菜单，菜单态下采到的桌宠宽度出现稳定 2.2–3.5 秒的尖刺，旧逻辑把它当成真实尺寸变化重定基准、把面板放大（最多 2 倍）、窗口尺寸跳变。修法：缩放冻结期间不再重定基准；大变化（>1.25 倍）要求更长稳定期（约 8 秒级）且桌宠静止 ≥2 秒才接受；**真实的改缩放 / 换皮肤仍按比例重新匹配**，功能不回退。
- **明细卡自动收起口径更正**：晃晕唤出的余额明细卡为 **8 秒无操作自动收起（C 方案）**、再晃一次也可收起；此前 0.0.4 文档误写「不自动消失」，本版起文档与代码一致（代码 0.0.4 起即是 8 秒口径，本次只改文档）。
- **文档**：Windows 正式源码包内的 `CHANGELOG.md` / `README.md` / `INSTALL.md` 已同步刷新为 0.0.5 已发布口径（0.0.4 包内是历史发布快照）；版本号 `0.0.5`、界面 / 市场显示 **v0.05**。

### macOS 显示窗（v0.0.5）

- **桌宠隐藏 → 饭桶隐藏（快路）**：改按「桌宠窗口是否存在」判定，桌宠隐藏 / 退出后约 1.0 秒内隐藏显示窗（此前为 5 秒级）；桌宠回来约 0.9 秒内自动显示。启动 / 唤醒短时无采样时有宽限，避免误隐藏。
- **点击 / 右击不再变大**：缩放冻结期间不再把菜单态宽度尖刺当成真实尺寸变化重定基准；真实改缩放、换皮肤仍按比例匹配。

### Windows 显示窗（v0.0.5）

- **新增「桌宠隐藏 / 退出 → 饭桶隐藏」**：按桌宠手柄缺失判定（约 600ms）自动隐藏显示窗，桌宠回来自动显示；含启动 10 秒宽限，避免开机时桌宠还没起来就把饭桶隐藏。
- Windows 的缩放值来自扩展 `/api/state`（不是截图采样），点击 / 右击桌宠不会触发采样尖刺 → 真机点击回归无 «变大» 现象（随 R-48 留证）。

### Coopanion 扩展（`glutton-balance` v0.0.5）

- 厂商预设新增「**智谱 GLM**」：智谱官方暂未开放余额查询接口，选它按「大白饭 / 满盆」显示、只校验 Key 是否有效；新增「官方暂未开放余额查询接口」的中文失败分类提示。
- 密钥来源区改版：新增「**从剪切板导入**」（把剪贴板里的密钥写进凭据文件变量，界面不显示密钥）与「**删除密钥**」（只删凭据文件里对应变量，不动配置）按钮，并按 2026-11-03 设计图调整布局。
- 版本号 `package.json` 0.0.5、界面 / 市场显示 **v0.05**；无配置字段变化，旧 `config.json` 原样可用。

## 0.0.4（2026-11-02 已发布）

三套内置外观（**白瓷 / 黑陶 / 不锈钢**）、删除搪瓷外观；晃晕唤出、安全与失败提示优化、材质稿定稿。Windows 显示窗 / macOS 显示窗 / Coopanion 扩展同号 0.0.4。

### 通用（三端一致）

- **删除搪瓷外观（四款 → 三款）**：内置外观只保留 **白瓷 / 黑陶 / 不锈钢**；「复古蓝白搪瓷饭桶」从扩展设置页选项、自定义饭桶配色模板、两版显示窗内置资产中整套删除；`enamel` 不再是合法 `bowlStyle` 值。
- **兼容（旧配置自动回退）**：旧 `config.json` 里 `display.bowlStyle: "enamel"`（或其它未知值）在扩展读取、显示窗加载时自动归一化为 `porcelain`（白瓷），不报错、也不会显示成黑盆；用户导入的 `custom:<名字>` 饭桶不受影响。
- **材质稿定稿（P2-A 最终稿）**：黑陶改哑光深色、不锈钢加竖向拉丝与高光条、白瓷桶身不动只统一桶沿下沿水线；三套 front / back PNG 有观感更新（透明通道像素与 0.0.3 一致）。
- **文档**：README / INSTALL / 技术说明统一「三款外观 + 旧搪瓷配置回退白瓷」；发布截图已随本轮重拍（01–07，与扩展 world 包内截图逐字节一致）。

### 改名（0.0.4 起）

- **项目统一英文名 GluttonBalance / 标识 glutton-balance**：GitHub 仓库改为 `ink1453/glutton-balance`（旧仓库链接自动跳转）；npm 包名与 Coopanion 扩展 ID 由 `pet-balance-world` 改为 **`glutton-balance`**，旧包停在 0.0.3 并已弃用（老安装需重装新包）。
- **本机路径统一**：配置/安装目录 `~/.dsh/glutton-balance`（Windows `%USERPROFILE%\\.dsh\\glutton-balance`）；首次启动自动从旧目录 `~/.dsh/pet-balance-panel` 迁移 `config.json`/`bowls/`/`rice/`（旧目录原样保留）。环境变量 `GLUTTONBALANCE_PANEL_*` 优先，旧 `PET_BALANCE_PANEL_*` 仍兼容。
- **macOS 标识**：bundle id / LaunchAgent label 改为 `com.gluttonbalance.panel`；App 名仍「饭桶余额」，安装路径不变（改标识后需重新授权一次「屏幕录制」）。
- **Windows 标识**：开机自启键 `GluttonBalance`、开始菜单 `GluttonBalance.lnk`，安装目录 `%USERPROFILE%\\.dsh\\glutton-balance`；卸载/升级脚本兼容清理旧名。
- **Release 资产**：0.0.4 起为 `glutton-balance-x-<版本>-src.zip` / `glutton-balance-mac-<版本>-src.zip`；历史资产名保持不变。

### macOS 显示窗（v0.0.4）

- **晃晕唤出**：在桌面快速晃鼠标（2 秒内左右反转 ≥4 次）唤出明细面板；**8 秒无操作自动收起（C 方案），再晃一次也可收起**；带四重防误触（阈值/间隔/拖动/静止判定）。
- **安全三项**：余额查询失败按 18 类分类码给中文提示；密钥只做只读校验（不显示、不外传、不写日志）；日志每次写前轮转（保留 ≤3 份、权限 600、二次脱敏）。
- **失败提示接入用户可见面**：明细卡失败行显示「上次失败：<分类中文文案>」；托盘菜单新增「测试余额连接…」，当场测全部来源并弹 3 行摘要（不含密钥）。
- 三套材质资产与「删搪瓷、旧配置回退白瓷」同步；旧配置回退后的渲染结果与显式白瓷逐像素一致。

### Windows 显示窗（v0.0.4）

- **删除搪瓷外观**：`Panel.V3.cs` 内置外观 4 → 3、删除搪瓷材质定义；`Panel.cs` 加载旧配置时 `bowlStyle:"enamel"` 显式回退 `porcelain`（白瓷，不回退黑陶）；`bowls/` 由 12 文件（4 套）减为 9 文件（3 套）。
- **材质资产同步**：白瓷 / 黑陶 / 不锈钢按 A 最终稿更新（与 macOS 同一套素材）。
- 主题跟随 / 动画漂移等 macOS 侧改进仍未移植到 Windows 面板（已知差异，按 0.0.3 旧行为验收，不是回归）。

### Coopanion 扩展（`glutton-balance` v0.0.4 · 新名首发）

- 设置页外观选项 4 → 3（白瓷 / 黑陶 / 不锈钢）；读取旧配置时把 `enamel` 及未知值归一化为 `porcelain`，绝不把旧值传给显示窗。
- 扩展包内中英文简介同步「三款饭桶外观」；README / CHANGELOG 更新。

## 0.0.3

主题跟随、动画漂移、皮肤与文案更新；Coopanion 扩展同步 0.0.3。

### macOS 显示窗（v0.0.3）

- **主题跟随**：面板颜色改为跟随 macOS 系统深浅色（Electron `nativeTheme`），运行中切换系统外观即时生效；`theme.force` 手设优先级保留。
- **动画漂移修正**：临界阻尼跟随（无过冲）、取消静止浮动、目标 1px 死区、改尺寸按底边中点锚定、定位/尺寸就绪后再显示、跨屏直接吸附并重下发 DPR；启动不再从兜底位置飞入。
- **皮肤 P0**：主题感知桶身描边与落影、内壁压暗、满盆米山收窄+接触阴影、状态点 5pt+灯座、家名单遍反色描边、浅主题木牌加深、深主题黑陶提亮。
- **皮肤 P1（米饭口径）**：恢复 11 档帧按比例取用、`rice-master.png` 只用于满盆溢出小堆尖；满盆时桶口内壁可见一圈，低余额米尖随余额线性变化。
- **文案**：大白饭金额文字统一为「盆满钵满」；明细卡副标题改为「低于 ¥5.00 变红 · 每 60 秒刷新 · 上次成功」等（全选推荐版）。
- **图标**：Coopanion 扩展市场图标更新为「蓝色大肥鱼 · 大肥鱼捧蓝碗白饭」（由 dsh-meme 内置大肥鱼图库素材合成）。

### Coopanion 扩展（`pet-balance-world` v0.0.3）

- `package.json` 顶层简介改中文并置顶「🤖 AI 一键安装」标识；`locales.zh/en` 同步；README 加 AI 安装横幅。
- 新增 [`AI-INSTALL.md`](AI-INSTALL.md)：给 AI 助手直读的一键安装说明（扩展 + 两版显示窗的环境探测/安装/验证/回滚/安全边界，含机器可读 JSON）。
- 设置页文案同步「全选推荐」：大白饭「永远盆满钵满」、「满盆金额 ¥」、刷新间隔「60 秒」、「用这个默认值」等。
- 图标更新（256×256，蓝色大肥鱼 + 饭碗）；市场截图 05/06/07 重拍（新文案与新皮肤）。

## 0.0.2

两版显示窗（Windows + macOS）合并公开；**版本号统一**：Windows 显示窗、macOS 显示窗、Coopanion 扩展均为 `0.0.2`。

### Windows 显示窗（v0.0.2）

- 功能与 v0.0.1 一致；本版随两版并轨统一版本号，源码包为 `pet-balance-panel-x-0.0.2-src.zip`。

### macOS 显示窗（v0.0.2）

- **新增 macOS 版显示窗**（Electron 38.8.6 / macOS 14+ / Apple 芯片）：源码 + 构建 / 安装 / 卸载 / 包内容扫描脚本，位于仓库 `mac/`。
- 头顶形态；盆宽按桌宠实测宽度匹配；拖拽时冻结盆宽采样防抖；点击穿透；点击面板展开明细（默认关闭，见扩展设置页说明）；菜单栏图标管理。
- 登录自启：默认借助本机 DeepSeek Harness 当载体以继承「屏幕录制」权限，也可 `--no-autostart` 手动启动。
- ad-hoc 未签名：首次打开需右键「打开」；换机分发前建议自行签名 / 公证。

### Coopanion 扩展（`pet-balance-world` v0.0.2）

- **设置页精简**：「点击面板展开明细」开关从设置页移除、默认关闭；需要时手改 `config.json` 的 `interaction.expandOnClick` 为 `true`（且关闭「点击穿透」）。
- **文案**：Windows / macOS 两版显示窗口径同步（两版均可另装，源码 + 构建脚本在 GitHub 仓库）。

## 0.0.1

饭桶余额首个公开版本。

- **定名**：插件名为「饭桶余额」，一只饭桶对应一家 AI 服务。
- **外观**：四款圆柱饭桶（白瓷 / 黑陶 / 不锈钢 / 复古蓝白搪瓷），支持导入自定义饭桶；米饭按余额比例长高，满盆时堆出桶沿。
- **数值样式**：桶沿小字 / 饭票小旗 / 桶沿木牌（默认）三款，金额字号有可读下限；名字太长自动缩字，实在放不下中间省略。
- **摆放两态**：头顶 / 脚下可切，本次默认头顶；切到头顶时底部彩蛋小轮子自动隐藏。
- **9 家排法**：新增金字塔排法并设为默认（另有一排 / 两排），9 家也能看清每家金额。
- **设置页**：勾选项统一为 iOS 风格滑动开关；改完点底部「保存」才写入（不自动写盘，防误改），非法值不写入；「重新读取」可撤销未保存改动。
- **互斥防错**：点击穿透开着时「点面板展开明细」自动关闭并灰显，保存不会写出冲突组合。
- **自定义饭桶模板**：设置页内置「提示词模板」，一键复制绘制规范，照模板画就能导入。
- **主题**：自动跟随暗色 / 浅色，木牌与文字配色跟着变，桶身材质不变。
- **稳定性与跨平台**：修复设置页保存会把显示窗配置写回旧状态的问题；Mac 上设置页可正常打开和保存。
- **隐私**：只读余额接口、不调模型、不扣额度；密钥只留在本机，不显示、不上报。
