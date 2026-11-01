@echo off
setlocal
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\self-work-station.vbs" echo CreateObject("WScript.Shell").Run "wscript ""%ROOT%\scripts\windows\start-workbench.vbs""", 0, False
wscript "%ROOT%\scripts\windows\start-workbench.vbs"
echo.
echo Done. The workbench server now starts automatically at login.
echo Open http://127.0.0.1:8000 in Edge, then install it as an app.
echo To undo: delete "%STARTUP%\self-work-station.vbs"
pause
