@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   Pixelle-Video - Windows Launcher
echo ========================================
echo.

:: Set environment variables
set "PYTHON_HOME=%~dp0python\python311"
set "PATH=%PYTHON_HOME%;%PYTHON_HOME%\Scripts;%~dp0tools\ffmpeg\bin;%PATH%"
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0tools\playwright"
set "PROJECT_ROOT=%~dp0Pixelle-Video"

:: Change to project directory
cd /d "%PROJECT_ROOT%"

:: Set PYTHONPATH to project root for module imports
set "PYTHONPATH=%PROJECT_ROOT%"

:: Set PIXELLE_VIDEO_ROOT environment variable for reliable path resolution
set "PIXELLE_VIDEO_ROOT=%PROJECT_ROOT%"

:: Start the unified React console and API service
echo [Starting] Launching Pixelle React Console...
echo Browser will open after the service is healthy.
echo.
echo Note: Configure API keys and settings in the React Console.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

"%PYTHON_HOME%\python.exe" -c "import socket, sys; sys.exit(1 if socket.socket().connect_ex(('127.0.0.1', 8000)) == 0 else 0)"
if errorlevel 1 goto :port_in_use

start "" /b "%PYTHON_HOME%\python.exe" "%~dp0open_browser.py"
"%PYTHON_HOME%\python.exe" -m uvicorn api.app:app --host 127.0.0.1 --port 8000

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start. Please check:
    echo   1. Port 8000 is not already in use
    echo   2. Python and packaged dependencies are intact
    echo.
    pause
)

goto :eof

:port_in_use
echo.
echo [ERROR] Port 8000 is already in use. Stop the existing Pixelle/API process and retry.
echo.
pause
exit /b 1
