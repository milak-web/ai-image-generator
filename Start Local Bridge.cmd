@echo off
setlocal
cd /d "%~dp0"

set BRIDGE_HOST=127.0.0.1
set BRIDGE_PORT=8000
set BRIDGE_CORS_ALLOW_ORIGIN=https://milak-web.github.io

echo Starting local SD relay on http://%BRIDGE_HOST%:%BRIDGE_PORT%
echo This relay lets the GitHub Pages app talk to localhost, LAN, and CORS-blocked SD targets.
echo.

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 local_sd_bridge.py
    goto :eof
)

python local_sd_bridge.py
