# 编译饭桶余额（GluttonBalance）显示窗 panel.exe（WinExe，无控制台黑框）
# 依赖：Windows 自带的 .NET Framework 4.8 csc.exe，不需要装任何东西。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
#       -Out panel.v3.exe  编译到别的文件名（面板正在运行时不能覆盖 panel.exe）
param([string]$Out = '')
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) { throw "找不到 csc.exe（需要 .NET Framework 4.x）：$csc" }

$src = Join-Path $here 'Panel.cs'
$src2 = Join-Path $here 'Panel.V3.cs'
$out = if ($Out) { if ([System.IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $here $Out } } else { Join-Path $here 'panel.exe' }
if (-not (Test-Path $src)) { throw "找不到 Panel.cs：$src" }
if (-not (Test-Path $src2)) { throw "找不到 Panel.V3.cs：$src2" }

& $csc /nologo /target:winexe /optimize+ /platform:anycpu /out:"$out" `
    /r:System.dll /r:System.Drawing.dll /r:System.Core.dll "$src" "$src2"

if ($LASTEXITCODE -ne 0) { throw "编译失败，csc 退出码 $LASTEXITCODE" }
$fi = Get-Item $out
# 0.0.7：顺带打印 exe 版本资源，便于核对「同号 0.0.7」（版本元数据在 Panel.cs 的 assembly 属性里）
$ver = $fi.VersionInfo.FileVersion
Write-Host ("编译成功：{0}（{1:N0} 字节）版本 {2}" -f $fi.FullName, $fi.Length, $ver)
if ($ver -notlike '0.0.7*') { throw "版本资源异常：期望 0.0.7.x，实际 $ver" }
