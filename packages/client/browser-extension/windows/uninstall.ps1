$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'DeepSeek Harness Browser Companion'
$nativeHostName = 'com.deepseek.dsh_browser_companion'
$installParent = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'DeepSeekHarness'))
$installRoot = [System.IO.Path]::GetFullPath((Join-Path $installParent 'BrowserCompanion'))
$companionTarget = [System.IO.Path]::GetFullPath((Join-Path $installRoot 'DeepSeekHarness.BrowserCompanion.exe'))
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\' + $nativeHostName

<# Prove recursive removal targets only the exact companion install directory. #>
function Assert-UninstallPath {
  $expected = [System.IO.Path]::GetFullPath((Join-Path $installParent 'BrowserCompanion'))
  if (-not [string]::Equals($installRoot, $expected, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Companion uninstall target changed unexpectedly: $installRoot"
  }
  $parentPrefix = $installParent.TrimEnd('\') + '\'
  if (-not $installRoot.StartsWith($parentPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Companion uninstall target escaped LocalAppData: $installRoot"
  }
}

<# Stop the task-owned tray and await its exact installed process path. #>
function Stop-InstalledCompanion {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -ne $task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $running = Get-CimInstance -ClassName Win32_Process |
      Where-Object { $_.ExecutablePath -and [string]::Equals(
        [System.IO.Path]::GetFullPath($_.ExecutablePath),
        $companionTarget,
        [System.StringComparison]::OrdinalIgnoreCase) }
    if ($null -eq $running) {
      return
    }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  foreach ($process in $running) {
    Stop-Process -Id $process.ProcessId -Force
  }
  $forceDeadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $remaining = Get-CimInstance -ClassName Win32_Process |
      Where-Object { $_.ExecutablePath -and [string]::Equals(
        [System.IO.Path]::GetFullPath($_.ExecutablePath),
        $companionTarget,
        [System.StringComparison]::OrdinalIgnoreCase) }
    if ($null -eq $remaining) {
      return
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $forceDeadline)
  throw "Installed companion processes did not exit after termination: $($remaining.ProcessId -join ', ')"
}

Assert-UninstallPath
Stop-InstalledCompanion
if ($null -ne (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
if (Test-Path -LiteralPath $registryPath) {
  Remove-Item -LiteralPath $registryPath -Force
}
if (Test-Path -LiteralPath $installRoot -PathType Container) {
  Remove-Item -LiteralPath $installRoot -Recurse -Force
}

[pscustomobject]@{
  RemovedTask = $taskName
  RemovedNativeHost = $nativeHostName
  RemovedDirectory = $installRoot
  LogsRemoved = $true
}
