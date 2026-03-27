@echo off
REM Claude Web Search MCP Server - Quick Start Script
REM =================================================

cd /d "%~dp0"

echo.
echo [MCP] Starting Web Search Server...
echo.
echo Note: This MCP server is designed to run via Claude Desktop MCP integration.
echo For direct testing, use: npm run dev
echo.
echo To use with Claude Desktop:
echo 1. Add this server to your Claude Desktop config:
echo    %APPDATA%\Claude\claude_desktop_config.json
echo.
echo 2. Configuration:
echo    "command": "node"
echo    "args": ["C:/Users/Administrator/Desktop/claude-web-search-mcp/dist/index.js"]
echo.
echo Press any key to continue to dev mode, or Ctrl+C to exit...
pause >nul

npm run dev
