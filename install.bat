@echo off
echo ===================================================
echo     Arivu-Lens Automated Setup & Launch Script     
echo ===================================================
echo.

:: Check for Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in your PATH.
    echo Please install Python 3.9 or newer before continuing.
    pause
    exit /b 1
)

:: Check for Node
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in your PATH.
    echo Please install Node.js 18 or newer before continuing.
    pause
    exit /b 1
)

echo [1/3] Setting up Backend dependencies...
pushd backend
python -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [WARNING] Backend dependency install failed or completed with warnings.
)
echo Starting Backend server in a new window...
start "Arivu-Lens Backend" cmd /c "uvicorn app.main:app --reload --port 11411"
popd

echo.
echo [2/3] Setting up Frontend dependencies...
pushd frontend
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Frontend dependency installation failed.
    popd
    pause
    exit /b 1
)

echo.
echo [3/3] Starting Frontend Development Server...
echo Launching browser to http://localhost:5173/landing.html ...
start http://localhost:5173/landing.html
call npm run dev
popd

pause
