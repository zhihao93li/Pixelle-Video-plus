@echo off
chcp 65001 >nul 2>&1

echo 🚀 Building Pixelle React Console...
echo.

pushd apps\console
call npm run build
if errorlevel 1 (
    popd
    goto :error
)
popd

echo 🌐 Starting Pixelle at http://127.0.0.1:8000/#/board
uv run uvicorn api.app:app --host 127.0.0.1 --port 8000

if errorlevel 1 goto :error
goto :eof

:error
echo.
echo ========================================
echo   [ERROR] Failed to Start
echo ========================================
echo.
echo Verify Node.js, npm, uv, and backend dependencies are installed.
echo For the portable package, download the one-click release instead.
echo.
pause
exit /b 1
