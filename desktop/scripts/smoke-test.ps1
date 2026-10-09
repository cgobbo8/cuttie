<#
  Installs the built Cuttie silently for the current user, then runs it in
  smoke-test mode (no window): Python modules installed, API and worker
  started, ffmpeg and yt-dlp found; -Full also runs the GPU and Whisper check
  (on the CPU without an NVIDIA GPU, the 1.5 GB model is downloaded once).
  Writes smoke-report.json and copies the app's log (cuttie.log) to the
  current folder. Exit code 0 when everything passed.

  CI: .github/workflows/desktop.yml. On a Windows PC or VM, by hand:
    powershell -ExecutionPolicy Bypass -File smoke-test.ps1 -Full -Installer .\Cuttie-Setup-0.1.0.exe
#>
param(
  [switch]$Full,
  [string]$Installer
)

$ErrorActionPreference = "Stop"

if (-not $Installer) {
  $Installer = (Get-ChildItem (Join-Path $PSScriptRoot "..\dist\Cuttie-Setup-*.exe") | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
}
Write-Host "Installing $Installer"
$setup = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
if ($setup.ExitCode -ne 0) { throw "The installer exited with code $($setup.ExitCode)" }

# Per-user install: %LOCALAPPDATA%\Programs\cuttie\Cuttie.exe
$exe = Join-Path $env:LOCALAPPDATA "Programs\cuttie\Cuttie.exe"
if (-not (Test-Path $exe)) {
  $found = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs") -Recurse -Filter "Cuttie.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $found) { throw "Cuttie.exe not found under $env:LOCALAPPDATA\Programs" }
  $exe = $found.FullName
}

$report = Join-Path (Get-Location) "smoke-report.json"
$mode = if ($Full) { "--smoke-test=full" } else { "--smoke-test" }
Write-Host "Running $exe $mode"
$started = Get-Date
$app = Start-Process -FilePath $exe -ArgumentList $mode, "--smoke-report=`"$report`"" -PassThru
$null = $app.Handle  # keeps the exit code readable once it's done
if (-not $app.WaitForExit(60 * 60 * 1000)) {
  $app.Kill()
  throw "The smoke test did not finish within an hour"
}
Write-Host ("Finished in {0:N0} s, exit code {1}" -f ((Get-Date) - $started).TotalSeconds, $app.ExitCode)

Copy-Item (Join-Path $env:LOCALAPPDATA "Cuttie\data\logs\cuttie.log") -Destination (Get-Location) -ErrorAction SilentlyContinue
if (Test-Path $report) { Get-Content $report } else { Write-Host "No report written" }
if ($app.ExitCode -ne 0) { throw "The smoke test failed (see smoke-report.json and cuttie.log)" }
