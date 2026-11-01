# 安装饭桶余额
#   - 写开机自启（HKCU Run 键，wscript //B //Nologo 隐藏启动，无黑框）
#   - 创建开始菜单快捷方式（桌面零文件）
#   - 立即隐藏启动 panel.exe
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

# 1) 开机自启
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$cmd = 'wscript.exe //B //Nologo "{0}"' -f $vbs
New-Item -Path $runKey -Force | Out-Null
Set-ItemProperty -Path $runKey -Name 'PetBalancePanel' -Value $cmd
Write-Host "[1/3] 已写开机自启：$cmd"

# 2) 开始菜单快捷方式
$startDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$lnkPath = Join-Path $startDir 'PetBalancePanel.lnk'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($lnkPath)
$lnk.TargetPath = $wscript
$lnk.Arguments = '//B //Nologo "{0}"' -f $vbs
$lnk.WorkingDirectory = $here
$lnk.Description = 'Pet Balance Panel'
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
