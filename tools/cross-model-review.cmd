@echo off
REM Cross-model adversarial review of the progress scoreboard.
REM Builds its prompt FRESH from tasks\progress.md every run, so the prompt
REM can never drift out of sync with the scoreboard it is reviewing.
setlocal
cd /d "%~dp0.."
set GEMINI_CLI_TRUST_WORKSPACE=true

where gemini >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Gemini CLI is not on PATH for this shell.
  echo   Try:  npm install -g @google/gemini-cli
  echo.
  pause
  exit /b 1
)

if not exist "tasks\progress.md" (
  echo   tasks\progress.md is missing. Run from inside the repo.
  pause
  exit /b 1
)

set PROMPT=%TEMP%\rms-doubt-prompt.md
( type "tools\cross-model-review-header.md" & type "tasks\progress.md" ) > "%PROMPT%"

echo.
echo   Reviewing tasks\progress.md. This takes a minute or two.
echo   Output: tasks\cross-model-review.md
echo.

gemini --approval-mode plan -p "" < "%PROMPT%" > "tasks\cross-model-review.md" 2>&1
set RC=%ERRORLEVEL%
del "%PROMPT%" >nul 2>nul

if not "%RC%"=="0" (
  echo   Gemini exited with an error. See tasks\cross-model-review.md for the message.
) else (
  echo   Done. Wrote tasks\cross-model-review.md
)
echo.
pause
