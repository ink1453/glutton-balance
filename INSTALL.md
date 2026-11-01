# INSTALL · 饭桶余额 Windows 显示窗（源码包 · v0.0.2）

> **两版导航**：本文是 **Windows 版**显示窗的安装步骤；**macOS 版**的安装步骤见 [mac/INSTALL.md](mac/INSTALL.md)（源码在 [mac/](mac/) 目录）。两版各自独立安装，共用同一个 Coopanion 扩展与配置格式。

本包是「饭桶余额」的 **Windows 显示窗程序源码包**，配合 Coopanion 的 `pet-balance-world` 扩展使用。

> **本源码包不自带已编译的 `panel.exe`**：请按下面步骤在本机编译并安装。程序为源码自建、未签名，SmartScreen / 杀软可能提示，属正常现象（见 §5）。

## 1. 前置条件

- **Windows 10 / 11**（64 位）
- **.NET Framework 4.x**：Windows 自带 `csc.exe` 编译器（通常位于 `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`），不需要额外安装 .NET SDK
- **Coopanion 0.2.16+**（World API 6）
- 在 Coopanion 扩展市场安装并启用 **「饭桶余额」** 扩展（`pet-balance-world`）

## 2. 安装步骤（推荐顺序）

1. **解压**本源码包到任意目录。
2. **放到默认位置**（推荐）：把解压出的整个目录放到
   `%USERPROFILE%\.dsh\pet-balance-panel`
   扩展默认从这里查找显示窗；如放别处，请设置环境变量 `PET_BALANCE_PANEL_DIR` 指向该目录。
3. **编译**（在源码目录打开 PowerShell）：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
   ```

   成功后同目录生成 `panel.exe`（约 160 KB）。如面板正在运行、`panel.exe` 被占用，可编译到别的文件名：
   `powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 -Out panel.v3.exe`

4. **安装并启动**：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
   ```

   - 写开机自启（当前用户注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，隐藏启动）
   - 创建开始菜单快捷方式（**桌面零文件**）
   - 立即隐藏启动显示窗
   - 只装不启动：加 `-NoStart`

5. **在 Coopanion 里配置**：打开「饭桶余额」扩展的设置页 → 填写余额来源（官方余额接口 / new-api 中转站 / 自定义接口，或选「大白饭」演示档）→ 保存。显示窗约 5 秒内自动生效。

## 3. 配置说明（`config.json`）

- 首次启动 `panel.exe` 时会在安装目录自动生成默认 `config.json`。
- 可参考包内 `config.example.json`（示例里的 `a6User` 留空，由用户自行填写）。
- 配置修改后约 5 秒内自动热载，无需重启显示窗。
- 完整配置字段、命令行工具（`--selftest` / `--shot`）与日志说明见包内 `README.md`。

## 4. 退出 / 卸载

- **退出显示窗**：`panel.exe --quit`（或任务管理器结束 `panel.exe`）。
- **卸载**：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
  ```

  默认删除自启项与开始菜单快捷方式、停止显示窗，**保留 `config.json`** 方便重装；
  加 `-PurgeFiles` 连程序文件一起删除。

## 5. ⚠ 未签名提示（SmartScreen / 杀软）

本程序由源码在本机编译，**没有代码签名证书**，Windows 可能弹出安全提示：

- 出现「**Windows 已保护你的电脑**」→ 点「**更多信息**」→「**仍要运行**」；
- 杀毒软件若拦截（常见于自行编译的 exe），请自行判断后加信任 / 白名单；
- 不放心的话：先阅读包内源码（`Panel.cs` / `Panel.V3.cs`）或自行审查后再编译运行。

## 6. 隐私

- 显示窗只**读取**你配置的余额查询接口，不调用 AI 模型、不扣减额度、不上报任何数据。
- 密钥只从本机文件读取（如 `%USERPROFILE%\.dsh\.env`），**不显示、不写日志、不上传**。
- 日志 `panel.log` 只记录金额 / 状态 / 定位信息，不含密钥。

## 7. 已知限制

- 本包为 **Windows 版**显示窗（macOS 版见 [mac/INSTALL.md](mac/INSTALL.md)；Linux 只有扩展设置页可用）。
- 多显示器与 125% / 150% / 200% 系统缩放：建议按实际环境确认效果。
- 本包为**源码包**，需要本机编译；未签名（见 §5）。
- 最多支持 9 家余额来源。

## 8. 版本

- 版本：`0.0.2`（与 macOS 显示窗、Coopanion 扩展、GitHub Release 同号）
- 详细更新日志见 Coopanion 扩展市场「饭桶余额」条目与扩展包内 `CHANGELOG.md`。
