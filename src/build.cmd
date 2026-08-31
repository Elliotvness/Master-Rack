@echo off
REM Build the blueprint from the section files. Double-click, or run from a prompt.
REM Requires Python 3 on PATH. Nothing else.

setlocal
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo Python was not found on PATH.
  echo Install Python 3, or run: py build.py
  pause
  exit /b 1
)

python build.py %*
set RC=%ERRORLEVEL%

echo.
if %RC%==0 (
  echo Build succeeded.
) else (
  echo Build reported problems - see above.
)
pause
exit /b %RC%
