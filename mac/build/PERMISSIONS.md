# 饭桶余额 · 权限说明（首次使用必读）

> 给老板看的文字版；图和按钮版见同目录 `permission-guide.html`（双击用浏览器打开）。
> 程序自己弹的「权限引导」小窗内容与此一致。
> 授权对象：**「饭桶余额」App 本身**（launchd 直启，2026-11-01 第 11 轮起不再借 DeepSeek Harness 当载体）。
> 签名：本机自签证书 `Maizi Local Code Signing`（不是 ad-hoc）→ 重新打包/升级后系统不会再问一次。

## 一句话

只有 **屏幕录制** 是必须的；**辅助功能** 是可选、当前版本根本不用。

| 权限 | 必须吗 | 用来干什么 | 不给会怎样 |
|---|---|---|---|
| 屏幕录制 | ✅ 必须 | 截 Coopanion 桌宠窗口，算头顶/脚底位置，让饭桶贴对位置 | 找不到桌宠，饭桶不会跟着走（退到屏幕中间/上次位置） |
| 辅助功能 | ⬜ 可选 | 原计划用来把桌宠抬高。Mac 实测会被系统弹回，**本版不用** | 没有影响，不用也不用开 |

> 屏幕录制只用来读桌宠窗口画面，**不录屏、不上传、不保存图片**；程序只记金额/状态/位置，不记密钥。

## 怎么开（照做就行）

### 1) 屏幕录制（必须）

1. 点这个链接（或在浏览器里打开 `permission-guide.html` 点按钮）：
   ```
   x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture
   ```
   等效终端命令：
   ```bash
   open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
   ```
2. 在「系统设置 → 隐私与安全性 → 屏幕录制」列表里找到 **饭桶余额**，把开关打开。
3. 系统提示「要退出并重新打开」就点它；没提示就手动退出程序再打开一次。

> 列表里没有「饭桶余额」？先把程序启动一次；或点列表下方 **+** → 去「个人文件夹 → 应用程序」选 `饭桶余额.app` 加进来。

### 2) 辅助功能（可选，本版不用）

```
x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility
```
```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
```

## 必须老板亲自点（规矩）

- **程序/脚本/助手不会替老板点「允许」，也不会绕过系统弹窗。**
- 看到系统弹窗时，请老板本人点「允许」；拿不准就先停下问，别猜着点。
- 不是我们权限的（比如别的软件弹窗），一律不要动。

## 开完怎么确认生效

1. 屏幕上不再弹「权限引导」小窗。
2. 屏幕右上角菜单栏出现 **小盆图标**（白瓷饭桶剪影）。
3. Coopanion 桌宠旁边出现饭桶小窗，桌宠动它跟着动。

也可以用命令看程序自己的运行日志（有没有「权限没给」的记录）：
```bash
tail -n 50 ~/.dsh/pet-balance-panel/panel.log
```
看到 `permission`、`permDenied`、`screen` 之类的行，就对照上面的步骤检查授权。

## 撤销授权

「系统设置 → 隐私与安全性 → 屏幕录制」里把 **饭桶余额** 的开关关掉，或点 **−** 删掉。
卸载程序（`build/uninstall.sh`）**不会**自动清掉这条系统授权记录，需要的话按上面手动关。

## 常见问题

**Q：以前授权过，重新打包后又问一次？**
正常情况下**不会再问**：本 app 用本机自签证书 `Maizi Local Code Signing` 签名（不是 ad-hoc），重新打包只要 bundle id 和证书不变，macOS 认的还是同一个程序，屏幕录制授权继续有效。
如果确实又被问了一次，多半是换了证书 / 改了 bundle id / 把 app 换到别的目录——授权身份对不上，需要在系统设置里再允许一次。正式对外分发要 Apple 开发者签名 + 公证。

**Q：授权完还是没画面？**
① 确认勾的是「饭桶余额」；② 确认 Coopanion 在跑、桌宠在屏幕上；③ 把程序完全退出再打开（屏幕录制必须重启进程才生效）。

**Q：能不能不给屏幕录制、只显示个大概？**
不建议：定位不到桌宠，饭桶只能按上次保存的位置摆，跟不了桌宠。

## 程序内对应的系统设置链接（技术备注）

- 屏幕录制：`x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`
- 辅助功能：`x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`
- 程序内检测：`systemPreferences.getMediaAccessStatus('screen')`，只有 `granted` 才认为已授权。
