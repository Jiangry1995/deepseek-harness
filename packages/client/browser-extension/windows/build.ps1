param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'out'),
  [switch]$RunTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

<# Resolve a C# compiler available from Visual Studio or the built-in .NET Framework. #>
function Resolve-CSharpCompiler {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }
  throw 'DeepSeek Harness companion build requires the Windows .NET Framework C# compiler.'
}

<# Resolve the framework assemblies used by the dependency-free companion. #>
function Resolve-FrameworkDirectory {
  $candidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath (Join-Path $candidate 'System.dll') -PathType Leaf) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }
  throw 'DeepSeek Harness companion build requires .NET Framework 4.x reference assemblies.'
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null
$compiler = Resolve-CSharpCompiler
$framework = Resolve-FrameworkDirectory
$sources = Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.cs' -File |
  Where-Object { $_.Name -ne 'DeepSeekHarness.Companion.Tests.cs' } |
  Sort-Object Name |
  Select-Object -ExpandProperty FullName
$testSource = Join-Path $PSScriptRoot 'DeepSeekHarness.Companion.Tests.cs'
$companion = Join-Path $resolvedOutput 'DeepSeekHarness.BrowserCompanion.exe'
$tests = Join-Path $resolvedOutput 'DeepSeekHarness.BrowserCompanion.Tests.exe'
$references = @(
  'System.dll',
  'System.Core.dll',
  'System.Drawing.dll',
  'System.Windows.Forms.dll',
  'System.Net.Http.dll',
  'System.Web.Extensions.dll',
  'System.Security.dll'
) | ForEach-Object { '/reference:' + (Join-Path $framework $_) }

& $compiler /nologo /target:winexe /platform:anycpu /optimize+ ('/out:' + $companion) @references @sources
if ($LASTEXITCODE -ne 0) {
  throw "Companion compilation failed with exit code $LASTEXITCODE."
}

if ($RunTests) {
  & $compiler /nologo /target:exe /platform:anycpu /optimize+ ('/out:' + $tests) ('/reference:' + $companion) @references $testSource
  if ($LASTEXITCODE -ne 0) {
    throw "Companion test compilation failed with exit code $LASTEXITCODE."
  }
  & $tests
  if ($LASTEXITCODE -ne 0) {
    throw "Companion tests failed with exit code $LASTEXITCODE."
  }
}

[pscustomobject]@{
  Companion = $companion
  Tests = if ($RunTests) { $tests } else { $null }
}
