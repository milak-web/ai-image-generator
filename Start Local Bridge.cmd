@echo off
setlocal
cd /d "%~dp0"

echo Starting local SD bridge on http://127.0.0.1:8000 ...
echo Backend target: http://127.0.0.1:9000
echo.

python local_sd_bridge.py
