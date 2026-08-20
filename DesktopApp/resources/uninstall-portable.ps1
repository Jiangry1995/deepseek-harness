# 绿色包卸载：删除快捷方式、「应用和功能」条目和本文件夹。
# 不删除用户目录下的 .dsh（对话、设置、凭据）。
param(
  [switch]$Silent
)

$ErrorActionPreference = 'Stop'
$installDir = $PSScriptRoot
$exeName = 'DeepSeek Harness.exe'
$shortcutName = 'DeepSeek Harness.lnk'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ai.deepseek.harness.desktop'

if (-not $Silent) {
  $answer = Read-Host '卸载 DeepSeek Harness？将删除本文件夹和快捷方式，不会删除用户目录 .dsh 中的对话。输入 Y 确认'
  if ($answer -ne 'Y' -and $answer -ne 'y') {
    exit 0
  }
}

$exePath = Join-Path $installDir $exeName
Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -eq $exePath -or $_.ProcessName -eq 'DeepSeek Harness'
} | Stop-Process -Force -ErrorAction SilentlyContinue

$taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
if (Test-Path $exePath) {
  & $taskkill /IM $exeName /T /F 2>$null | Out-Null
}

$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
foreach ($path in @(
  (Join-Path $desktop $shortcutName),
  (Join-Path $startMenu $shortcutName)
)) {
  if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Force
  }
}

if (Test-Path $uninstallKey) {
  Remove-Item -LiteralPath $uninstallKey -Recurse -Force
}

# 脚本位于即将删除的目录里，延迟到进程退出后再删文件夹。
$quoted = $installDir.Replace('"', '""')
Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\cmd.exe') -ArgumentList @(
  '/c',
  "ping 127.0.0.1 -n 3 >nul & rmdir /s /q `"$quoted`""
) -WindowStyle Hidden
