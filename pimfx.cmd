@echo off
rem Pi-MFX Windows menu. Same jobs as scripts/pimfx.sh on the Pi.
rem Login is asked and saved in .pimfx-remote (not on GitHub).
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pimfx-win.ps1" %*
echo.
pause
exit /b %ERRORLEVEL%
