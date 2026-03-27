@echo off
REM 生产环境启动脚本 - 安全加固版
REM =====================================

cd /d "%~dp0"

echo.
echo ========================================
echo  Claude Web Search MCP Server
echo  Production Startup (Security Hardened)
echo ========================================
echo.

REM 检查 API_KEY 环境变量
if "%API_KEY%"=="" (
    echo [ERROR] API_KEY environment variable is NOT set!
    echo.
    echo Please set a strong API key before starting:
    echo   Windows: set API_KEY=your-strong-random-key
    echo   Linux:   export API_KEY=$(openssl rand -hex 32)
    echo.
    pause
    exit /b 1
)

if "%API_KEY%"=="your-secret-api-key" (
    echo [WARNING] Using default API key - NOT recommended for production!
    echo.
)

REM 显示安全配置
echo [Config] Security Settings:
echo   API_KEY: ***configured***
if not "%ALLOWED_IPS%"=="" echo   IP Whitelist: %ALLOWED_IPS%
if not "%RATE_LIMIT_MAX%"=="" echo   Rate Limit: %RATE_LIMIT_MAX% req/min
if "%FORCE_HTTPS%"=="true" echo   Force HTTPS: enabled
echo.

REM 启动服务
echo [Starting] MCP HTTP Server on port %PORT:3001%...
echo.

node dist/mcp-http-server.js
