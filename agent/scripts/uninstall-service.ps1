# Removes the RAMS Connector's scheduled task (install-service.ps1). Its
# settings and logs in %ProgramData%\RAMS, and the folder C:\RAMS\Connector,
# are left in place; delete them by hand if they are no longer wanted.
#
#   powershell -ExecutionPolicy Bypass -File .\uninstall-service.ps1
$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName 'RAMS Connector' -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host 'The RAMS Connector task is not installed.'
  exit 0
}
Stop-ScheduledTask -TaskName 'RAMS Connector' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'RAMS Connector' -Confirm:$false
Write-Host 'The RAMS Connector task is removed. It no longer starts at sign-in.'
