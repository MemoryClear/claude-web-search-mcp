@echo off
REM REST API Server 启动脚本
REM =====================================

cd /d "%~dp0"

echo.
echo [API] Starting Web Search REST API Server...
echo.

REM 设置环境变量
set PORT=3000
set API_KEY=your-secret-api-key

echo Note: API Key is currently set to default value.
echo Please change it by setting API_KEY environment variable.
echo.
echo Example:
echo   set API_KEY=your-secure-key && npm run start:server
echo.

npm run start:server
