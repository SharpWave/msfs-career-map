@echo off
rem MSFS Career Map launcher: installs deps and builds on first run, starts the server
rem (or reuses one already running), then opens the app in the default browser.
setlocal
cd /d "%~dp0"
title MSFS Career Map
if not defined PORT set PORT=3080
rem Set CAREER_NO_BROWSER=1 to start the server without opening a browser tab.

where node >nul 2>nul || (
  echo Node.js was not found on PATH. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)

if not exist dist\index.html (
  echo Building the app...
  call npm run build || (pause & exit /b 1)
)

rem Already running? Just open the browser.
curl -s -o nul http://localhost:%PORT%/api/status 2>nul && (
  if not defined CAREER_NO_BROWSER start "" http://localhost:%PORT%/
  exit /b 0
)

echo Starting MSFS Career Map on http://localhost:%PORT% ...
echo Keep this window open while you use the app ^(close it to stop the server^).
start "" /b node --no-warnings=ExperimentalWarning --import tsx src/server/index.ts

rem Wait for the server, then open the browser.
set /a tries=0
:wait
set /a tries+=1
curl -s -o nul http://localhost:%PORT%/api/status 2>nul && goto up
if %tries% geq 60 (
  echo The server did not come up in time. Check the output above.
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait

:up
if not defined CAREER_NO_BROWSER start "" http://localhost:%PORT%/
rem Keep the console alive so the background node process keeps running.
echo.
echo Running. Close this window to stop the server.
:idle
timeout /t 3600 /nobreak >nul
goto idle
