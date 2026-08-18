param(
  [string]$RepositoryRoot = (Join-Path $PSScriptRoot '..\..\..\..')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'DeepSeek Harness Browser Companion'
$nativeHostName = 'com.deepseek.dsh_browser_companion'
$resolvedRepository = [System.IO.Path]::GetFullPath($RepositoryRoot)
$extensionRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestSource = Join-Path $extensionRoot 'extension\manifest.json'
$installParent = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'DeepSeekHarness'))
$installRoot = [System.IO.Path]::GetFullPath((Join-Path $installParent 'BrowserCompanion'))
$buildRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'out'))
$companionSource = Join-Path $buildRoot 'DeepSeekHarness.BrowserCompanion.exe'
$companionTarget = Join-Path $installRoot 'DeepSeekHarness.BrowserCompanion.exe'
$configTarget = Join-Path $installRoot 'companion.json'
$nativeManifestTarget = Join-Path $installRoot ($nativeHostName + '.json')
$logDirectory = Join-Path $installRoot 'logs'
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\' + $nativeHostName

<# Prove a resolved path remains inside one explicitly owned directory. #>
function Assert-OwnedPath {
  param(
    [Parameter(Mandatory)] [string]$Parent,
    [Parameter(Mandatory)] [string]$Path
  )
  $resolvedParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  if (-not $resolvedPath.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Companion path escaped its owned directory: $resolvedPath"
  }
}

<# Convert the manifest public key to Chrome's deterministic extension id. #>
function Get-ChromeExtensionId {
  param([Parameter(Mandatory)] [string]$PublicKey)
  try {
    $keyBytes = [Convert]::FromBase64String($PublicKey)
  }
  catch {
    throw 'Browser extension manifest key is not valid base64.'
  }
  $hash = [System.Security.Cryptography.SHA256]::HashData($keyBytes)
  $alphabet = 'abcdefghijklmnop'
  return -join ($hash[0..15] | ForEach-Object {
    $alphabet[($_ -shr 4)] + $alphabet[($_ -band 15)]
  })
}

<# Write UTF-8 JSON without a byte-order mark. #>
function Write-JsonFile {
  param(
    [Parameter(Mandatory)] [string]$Path,
    [Parameter(Mandatory)] [object]$Value
  )
  $json = $Value | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}

<# Stop the exact existing login task and wait for its installed executable to exit. #>
function Stop-ExistingCompanion {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -ne $task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $running = Get-CimInstance -ClassName Win32_Process |
      Where-Object { $_.ExecutablePath -and [string]::Equals(
        [System.IO.Path]::GetFullPath($_.ExecutablePath),
        [System.IO.Path]::GetFullPath($companionTarget),
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
        [System.IO.Path]::GetFullPath($companionTarget),
        [System.StringComparison]::OrdinalIgnoreCase) }
    if ($null -eq $remaining) {
      return
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $forceDeadline)
  throw "Existing companion processes did not exit after termination: $($remaining.ProcessId -join ', ')"
}

Assert-OwnedPath -Parent $installParent -Path $installRoot
Assert-OwnedPath -Parent $installRoot -Path $companionTarget
Assert-OwnedPath -Parent $installRoot -Path $configTarget
Assert-OwnedPath -Parent $installRoot -Path $nativeManifestTarget
if (-not (Test-Path -LiteralPath (Join-Path $resolvedRepository 'apps\cli\src\bin.ts') -PathType Leaf)) {
  throw "Repository root does not contain apps/cli/src/bin.ts: $resolvedRepository"
}
if (-not (Test-Path -LiteralPath $manifestSource -PathType Leaf)) {
  throw "Browser extension manifest is missing: $manifestSource"
}
$nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
$nodePath = [System.IO.Path]::GetFullPath($nodeCommand.Source)
$manifest = Get-Content -LiteralPath $manifestSource -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($manifest.key)) {
  throw 'Browser extension manifest must contain a stable development key.'
}
$extensionId = Get-ChromeExtensionId -PublicKey $manifest.key
$extensionOrigin = 'chrome-extension://' + $extensionId + '/'

& (Join-Path $PSScriptRoot 'build.ps1') -OutputDirectory $buildRoot
if (-not (Test-Path -LiteralPath $companionSource -PathType Leaf)) {
  throw "Companion build did not produce its executable: $companionSource"
}

[System.IO.Directory]::CreateDirectory($installRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($logDirectory) | Out-Null
Stop-ExistingCompanion
Copy-Item -LiteralPath $companionSource -Destination $companionTarget -Force
Write-JsonFile -Path $configTarget -Value ([ordered]@{
  repositoryRoot = $resolvedRepository
  nodePath = $nodePath
  origin = 'http://127.0.0.1:3080'
  extensionOrigin = $extensionOrigin
  logDirectory = $logDirectory
})
Write-JsonFile -Path $nativeManifestTarget -Value ([ordered]@{
  name = $nativeHostName
  description = 'DeepSeek Harness browser companion'
  path = $companionTarget
  type = 'stdio'
  allowed_origins = @($extensionOrigin)
})

New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $nativeManifestTarget

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $companionTarget -Argument '--tray --start-service' -WorkingDirectory $installRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
Register-ScheduledTask `
  -TaskName $taskName `
  -Description 'Starts the DeepSeek Harness tray companion and Web profile after interactive sign-in.' `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

[pscustomobject]@{
  Installed = $companionTarget
  ExtensionId = $extensionId
  ExtensionFolder = Join-Path $extensionRoot 'extension'
  ScheduledTask = $taskName
  NativeHost = $nativeHostName
  Logs = $logDirectory
}
