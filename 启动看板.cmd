@echo off
rem ============================================
rem  Task Dashboard one-click launcher
rem  Prefers PowerShell 7 (pwsh), falls back to Windows PowerShell 5.1.
rem  Usage: start.cmd [dev|prod|serve|stop|install|open|shortcut]
rem ============================================
setlocal
set "DIR=%~dp0"

where pwsh >nul 2>nul
if %errorlevel% equ 0 (
  pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%DIR%scripts\start.ps1" %*
) else (
  powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%DIR%scripts\start.ps1" %*
)

endlocal
