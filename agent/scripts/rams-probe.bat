@echo off
rem RAMS Connector - Phase 0 probe, for the PC that runs TallyPrime.
rem
rem Reads Tally only. Nothing is written to Tally, and no password is needed or stored.
rem Before running: open TallyPrime, load all three Roymax companies (MH, HR, WB),
rem and turn on F1 Help > Settings > Connectivity > "TallyPrime acts as" Both, port 9000.
rem Run it after office hours: Tally can be slow for the accountant while it answers.
rem
rem Usage:  rams-probe.bat [first voucher date, YYYY-MM-DD]   e.g.  rams-probe.bat 2026-04-01

setlocal
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or later is needed: https://nodejs.org  ^(LTS, Windows installer^)
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing the Connector's libraries, one time...
  call npm install --omit=dev --no-fund --no-audit || (pause & exit /b 1)
)

set OUT=out\rams-probe
if exist "%OUT%" rmdir /s /q "%OUT%"
if "%~1"=="" (
  node src\cli.js probe --out "%OUT%"
) else (
  node src\cli.js probe --from %1 --out "%OUT%"
)
if errorlevel 1 (
  echo.
  echo The probe stopped - see the message above.
  pause
  exit /b 1
)

rem Zip the report and the extracted data (no raw Tally exports, no credentials).
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set STAMP=%%i
powershell -NoProfile -Command "Compress-Archive -Path '%OUT%\*' -DestinationPath 'rams-probe-%STAMP%.zip' -Force"
echo.
echo Done. Send this file to the RAMS developer:
echo   %CD%\rams-probe-%STAMP%.zip
pause
