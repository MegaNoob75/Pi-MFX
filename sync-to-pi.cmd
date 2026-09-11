@echo off
rem One-click: copy this PC's Pi-MFX tree to the Raspberry Pi and rebuild there.
rem Double-click this file, or run it from a prompt. First run asks for pi@host.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\sync-to-pi.ps1" %*
set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
    echo Sync/rebuild did not finish.
) else (
    echo Sync/rebuild finished. Hard-refresh http://pimfx.local:8080
)
pause
exit /b %ERR%
