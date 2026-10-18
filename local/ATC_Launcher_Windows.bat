@echo off
setlocal DisableDelayedExpansion
title ATC2.0 - Windows Launcher
set "ATC_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%ATC_POWERSHELL%" set "ATC_POWERSHELL=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%ATC_POWERSHELL%" goto :no_powershell
if not exist "%~dp0scripts\launch_windows.ps1" goto :missing_files
"%ATC_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch_windows.ps1" %*
set "ATC_EXIT_CODE=%errorlevel%"
if "%ATC_EXIT_CODE%"=="0" exit /b 0
if not "%ATC_NO_PAUSE%"=="1" pause
exit /b %ATC_EXIT_CODE%
:missing_files
echo [ERROR] Missing scripts\launch_windows.ps1.
echo Extract the WHOLE repository ZIP, then open local\ATC_Launcher_Windows.bat.
goto :failed
:no_powershell
echo [ERROR] Windows PowerShell was not found. This launcher requires Windows 10 or 11 (64-bit).
:failed
if not "%ATC_NO_PAUSE%"=="1" pause
exit /b 1
