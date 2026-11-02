# 卸载饭桶余额（GluttonBalance）
#   - 通知 panel.exe --quit 退出（再按进程名兜底）
#   - 删除开机自启 Run 键与开始菜单快捷方式（新名 GluttonBalance；兼容清理旧名 PetBalancePanel）
#   - 可选 -PurgeFiles 删除程序文件（默认保留 config.json 方便重装）
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
#       powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1 -PurgeFiles
param(
    [switch]$PurgeFiles
)
$ErrorActionPreference = 'Continue'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $here 'panel.exe'

# 1) 先礼后兵：让显示窗自己退出
if (Test-Path $exe) {
    try { & $exe --quit | Out-Null } catch { }
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-Process -Name panel -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 300
    }
}
# 2) 兜底：只结束本程序自己的 panel.exe 进程
Get-Process -Name panel -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host '[1/4] 显示窗进程已退出'

# 3) 删除开机自启（新名 + 升级兼容：旧名 PetBalancePanel）
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (Get-ItemProperty -Path $runKey -Name 'GluttonBalance' -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $runKey -Name 'GluttonBalance' -ErrorAction SilentlyContinue
    Write-Host '[2/4] 已删除开机自启 Run 键 GluttonBalance'
} else {
    Write-Host '[2/4] 开机自启本来就没有（GluttonBalance）'
}
if (Get-ItemProperty -Path $runKey -Name 'PetBalancePanel' -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $runKey -Name 'PetBalancePanel' -ErrorAction SilentlyContinue
    Write-Host '[2/4] 已兼容清理改名前的旧 Run 键 PetBalancePanel'
}

# 4) 删除开始菜单快捷方式（新名 + 升级兼容：旧名 PetBalancePanel.lnk）
$startDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$lnkPath = Join-Path $startDir 'GluttonBalance.lnk'
if (Test-Path $lnkPath) {
    Remove-Item $lnkPath -Force -ErrorAction SilentlyContinue
    Write-Host "[3/4] 已删除开始菜单快捷方式：$lnkPath"
} else {
    Write-Host '[3/4] 开始菜单快捷方式本来就没有（GluttonBalance.lnk）'
}
$legacyLnk = Join-Path $startDir 'PetBalancePanel.lnk'
if (Test-Path $legacyLnk) {
    Remove-Item $legacyLnk -Force -ErrorAction SilentlyContinue
    Write-Host "[3/4] 已兼容清理改名前的旧快捷方式：$legacyLnk"
}

# 5) 可选：删除程序文件（保留 config.json）
#    升级兼容：改名前的旧安装目录 %USERPROFILE%\.dsh\pet-balance-panel 里的程序文件一并清理
#    （旧目录里的 config.json / bowls / rice 保留，重装/回滚仍可用）
$legacyDir = Join-Path $env:USERPROFILE '.dsh\pet-balance-panel'
if ($PurgeFiles) {
    $targets = @('panel.exe', 'panel-hidden.vbs', 'panel.log')
    foreach ($name in $targets) {
        $p = Join-Path $here $name
        if (Test-Path $p) { Remove-Item $p -Force -ErrorAction SilentlyContinue; Write-Host "  已删除 $p" }
    }
    if ((Test-Path $legacyDir) -and ($legacyDir.TrimEnd('\') -ne $here.TrimEnd('\'))) {
        foreach ($name in $targets) {
            $p = Join-Path $legacyDir $name
            if (Test-Path $p) { Remove-Item $p -Force -ErrorAction SilentlyContinue; Write-Host "  已删除旧安装目录程序文件 $p" }
        }
        Write-Host "  旧安装目录仍保留（配置/素材未删）：$legacyDir"
    }
    Write-Host "[4/4] 程序文件已删除（保留 config.json）"
} else {
    Write-Host '[4/4] 未加 -PurgeFiles，程序文件保留'
    if (Test-Path $legacyDir) {
        Write-Host "提示：检测到改名前的旧安装目录：$legacyDir（默认保留，便于回滚；不需要可手动删除）"
    }
}
Write-Host "完成。安装目录：$here"
