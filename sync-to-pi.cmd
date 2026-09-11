@echo off
rem Copy this PC's Pi-MFX tree to the Pi and rebuild. For the full menu use pimfx.cmd.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pimfx-win.ps1" -Action CopyRebuild %*
set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
    echo Sync/rebuild did not finish.
) else (
    echo Sync/rebuild finished. Hard-refresh http://pimfx.local:8080
)
pause
exit /b %ERR%
