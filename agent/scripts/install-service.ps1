# Sets up the RAMS Connector on the office PC (M8). Run once, from the packaged
# folder (npm run package), in PowerShell, as the Windows user who runs Tally:
#
#   powershell -ExecutionPolicy Bypass -File .\install-service.ps1
#
# It:
#   1. checks Node 20+ is installed
#   2. copies this folder to C:\RAMS\Connector (a new version replaces the old)
#   3. creates %ProgramData%\RAMS\connector.json from the template if it is
#      missing -- put the Connector token an Admin gives you in it
#   4. adds a scheduled task "RAMS Connector" that starts `run` when this user
#      signs in, and restarts it if it stops
#
# The Connector only reads Tally. To remove it: uninstall-service.ps1.
param(
  [string]$InstallDir = 'C:\RAMS\Connector',
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'

$nodeVersion = $null
try { $nodeVersion = (& node --version) } catch { }
if (-not $nodeVersion -or [int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 20) {
  Write-Host 'Node 20 or newer is needed. Install the LTS from https://nodejs.org, then run this again.' -ForegroundColor Red
  exit 1
}
Write-Host "Node $nodeVersion found."

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if ((Resolve-Path $here).Path -ne (New-Item -ItemType Directory -Force $InstallDir).FullName) {
  $task = Get-ScheduledTask -TaskName 'RAMS Connector' -ErrorAction SilentlyContinue
  if ($task) { Stop-ScheduledTask -TaskName 'RAMS Connector' -ErrorAction SilentlyContinue }
  Get-ChildItem $InstallDir -Force | Remove-Item -Recurse -Force
  Copy-Item -Path (Join-Path $here '*') -Destination $InstallDir -Recurse -Force
  Write-Host "Copied to $InstallDir."
}

$settingsDir = Join-Path $env:ProgramData 'RAMS'
New-Item -ItemType Directory -Force $settingsDir | Out-Null
$settings = Join-Path $settingsDir 'connector.json'
if (-not (Test-Path $settings)) {
  Copy-Item (Join-Path $InstallDir 'connector.example.json') $settings
  Write-Host "Created $settings. Put the Connector token in it (an Admin makes one), then run this again." -ForegroundColor Yellow
  notepad $settings
  exit 0
}
if ((Get-Content $settings -Raw) -match '"token"\s*:\s*"rams_\.\.\.') {
  Write-Host "$settings still has the example token. Put the real one in, then run this again." -ForegroundColor Yellow
  exit 1
}

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$InstallDir\rams-connector.cmd`" run" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$options = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'RAMS Connector' -Action $action -Trigger $trigger -Settings $options `
  -Description 'RAMS Connector: reads Tally (never writes to it) and syncs it into RAMS.' -Force | Out-Null
Write-Host 'Scheduled task "RAMS Connector" added: it starts when you sign in.'

if (-not $NoStart) {
  Start-ScheduledTask -TaskName 'RAMS Connector'
  Write-Host 'Started. Check it with:' -NoNewline
  Write-Host "  $InstallDir\rams-connector.cmd status" -ForegroundColor Cyan
}
Write-Host "Logs: $settingsDir\logs"
