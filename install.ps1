# 安装饭桶余额（GluttonBalance）
#   - 写开机自启（HKCU Run 键 GluttonBalance，wscript //B //Nologo 隐藏启动，无黑框）
#   - 创建开始菜单快捷方式（桌面零文件）
#   - 立即隐藏启动 panel.exe
# 推荐安装目录：%USERPROFILE%\.dsh\glutton-balance（本脚本按所在目录就地安装；放别处也能用）
# 升级兼容：顺手清理改名前的旧名（Run 键 PetBalancePanel、快捷方式 PetBalancePanel.lnk）；
#           旧安装目录 %USERPROFILE%\.dsh\pet-balance-panel 保留，配置由 panel.exe 首次启动自动迁移。
# 不写桌面、不改系统目录。用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -NoStart   # 只装不启动
param(
    [switch]$NoStart
)
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $here 'panel.exe'
$vbs = Join-Path $here 'panel-hidden.vbs'
if (-not (Test-Path $exe)) { throw "未找到 panel.exe，请先运行 build.ps1 编译：$exe" }
if (-not (Test-Path $vbs)) { throw "未找到 panel-hidden.vbs：$vbs" }

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
New-Item -Path $runKey -Force | Out-Null

# 0) 升级兼容：清理改名前的旧 Run 键与旧快捷方式（旧名 PetBalancePanel）
if (Get-ItemProperty -Path $runKey -Name 'PetBalancePanel' -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $runKey -Name 'PetBalancePanel' -ErrorAction SilentlyContinue
    Write-Host '[0/3] 已清理改名前的旧开机自启 Run 键 PetBalancePanel'
}
$legacyLnk = Join-Path $startDir 'PetBalancePanel.lnk'
if (Test-Path $legacyLnk) {
    Remove-Item $legacyLnk -Force -ErrorAction SilentlyContinue
    Write-Host '[0/3] 已清理改名前的旧开始菜单快捷方式 PetBalancePanel.lnk'
}

# 1) 开机自启
$cmd = 'wscript.exe //B //Nologo "{0}"' -f $vbs
Set-ItemProperty -Path $runKey -Name 'GluttonBalance' -Value $cmd
Write-Host "[1/3] 已写开机自启（GluttonBalance）：$cmd"

# 2) 开始菜单快捷方式
$lnkPath = Join-Path $startDir 'GluttonBalance.lnk'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($lnkPath)
$lnk.TargetPath = $wscript
$lnk.Arguments = '//B //Nologo "{0}"' -f $vbs
$lnk.WorkingDirectory = $here
$lnk.Description = 'GluttonBalance'
$lnk.Save()
Write-Host "[2/3] 已创建开始菜单快捷方式：$lnkPath"

# 3) 隐藏启动
if (-not $NoStart) {
    Start-Process -FilePath 'wscript.exe' -ArgumentList @('//B', '//Nologo', $vbs) -WindowStyle Hidden
    Write-Host '[3/3] 已隐藏启动 panel.exe'
} else {
    Write-Host '[3/3] 已按 -NoStart 跳过启动'
}

$configPath = Join-Path $here 'config.json'
if (-not (Test-Path $configPath)) {
    Write-Host "提示：首次启动 panel.exe 会生成默认配置：$configPath"
}
Write-Host "完成。安装目录：$here"
$defaultDir = Join-Path $env:USERPROFILE '.dsh\glutton-balance'
if ($here.TrimEnd('\') -ne $defaultDir.TrimEnd('\')) {
    Write-Host "提示：新版推荐安装目录为 $defaultDir（放别处也能用，只是文档默认位置不同）"
}
