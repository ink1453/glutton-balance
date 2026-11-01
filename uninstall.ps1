# 卸载饭桶余额
#   - 通知 panel.exe --quit 退出（再按进程名兜底）
#   - 删除开机自启 Run 键与开始菜单快捷方式
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

# 3) 删除开机自启
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (Get-ItemProperty -Path $runKey -Name 'PetBalancePanel' -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $runKey -Name 'PetBalancePanel' -ErrorAction SilentlyContinue
    Write-Host '[2/4] 已删除开机自启 Run 键 PetBalancePanel'
} else {
    Write-Host '[2/4] 开机自启本来就没有'
}

# 4) 删除开始菜单快捷方式
$startDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$lnkPath = Join-Path $startDir 'PetBalancePanel.lnk'
if (Test-Path $lnkPath) {
    Remove-Item $lnkPath -Force -ErrorAction SilentlyContinue
    Write-Host "[3/4] 已删除开始菜单快捷方式：$lnkPath"
} else {
    Write-Host '[3/4] 开始菜单快捷方式本来就没有'
}

# 5) 可选：删除程序文件（保留 config.json）
if ($PurgeFiles) {
    $targets = @('panel.exe', 'panel-hidden.vbs', 'panel.log')
    foreach ($name in $targets) {
        $p = Join-Path $here $name
        if (Test-Path $p) { Remove-Item $p -Force -ErrorAction SilentlyContinue; Write-Host "  已删除 $p" }
    }
    Write-Host "[4/4] 程序文件已删除（保留 config.json）"
} else {
    Write-Host '[4/4] 未加 -PurgeFiles，程序文件保留'
}
Write-Host "完成。安装目录：$here"
