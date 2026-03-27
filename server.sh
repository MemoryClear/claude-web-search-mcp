#!/bin/bash

# Claude Web Search MCP Server Manager
# Usage: ./server.sh [start|stop|restart|status|logs]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/server.log"
PID_FILE="$SCRIPT_DIR/.server.pid"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 获取服务状态
get_status() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p $pid > /dev/null 2>&1; then
            echo "running:$pid"
            return 0
        fi
    fi
    echo "stopped"
    return 1
}

# 启动服务
start() {
    echo ""
    echo "========================================"
    echo "  Start Claude Web Search MCP Server"
    echo "========================================"
    echo ""

    local status=$(get_status)
    if [[ $status == running:* ]]; then
        echo " [!] Server already running (PID: ${status#running:})"
        echo ""
        exit 0
    fi

    cd "$SCRIPT_DIR"
    
    # 后台启动
    nohup node dist/mcp-http-server.js >> "$LOG_FILE" 2>&1 &
    local pid=$!
    
    sleep 2
    
    if ps -p $pid > /dev/null 2>&1; then
        echo $pid > "$PID_FILE"
        echo " [OK] Server started"
        echo "   PID:     $pid"
        echo "   MCP:     http://localhost:3001/mcp"
        echo "   Health:  http://localhost:3001/health"
        echo "   Logs:    $LOG_FILE"
    else
        echo " [X] Failed to start, check logs:"
        tail -20 "$LOG_FILE"
    fi
    echo ""
}

# 停止服务
stop() {
    echo ""
    echo "========================================"
    echo "  Stop Claude Web Search MCP Server"
    echo "========================================"
    echo ""

    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p $pid > /dev/null 2>&1; then
            kill $pid 2>/dev/null
            sleep 1
            # 强制杀死
            if ps -p $pid > /dev/null 2>&1; then
                kill -9 $pid 2>/dev/null
            fi
            echo " [OK] Server stopped (PID: $pid)"
        else
            echo " [!] Process $pid not found"
        fi
        rm -f "$PID_FILE"
    else
        echo " [!] No PID file found"
    fi
    echo ""
}

# 重启服务
restart() {
    echo ""
    echo "========================================"
    echo "  Restart Claude Web Search MCP Server"
    echo "========================================"
    echo ""

    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p $pid > /dev/null 2>&1; then
            kill $pid 2>/dev/null
            echo " [OK] Old server stopped"
            sleep 1
        fi
        rm -f "$PID_FILE"
    fi

    cd "$SCRIPT_DIR"
    nohup node dist/mcp-http-server.js >> "$LOG_FILE" 2>&1 &
    local pid=$!
    
    sleep 2
    
    if ps -p $pid > /dev/null 2>&1; then
        echo $pid > "$PID_FILE"
        echo " [OK] Server restarted (PID: $pid)"
    else
        echo " [X] Restart failed"
    fi
    echo ""
}

# 查看状态
status() {
    echo ""
    echo "========================================"
    echo "  Claude Web Search MCP Server Status"
    echo "========================================"
    echo ""

    local result=$(get_status)
    if [[ $result == running:* ]]; then
        echo "   Status:  Running (PID: ${result#running:})"
    else
        echo "   Status:  Not running"
    fi

    echo ""
    
    # 健康检查
    local health=$(curl -s http://localhost:3001/health 2>/dev/null)
    if [ $? -eq 0 ]; then
        echo "   Health:  OK"
        echo "   $health"
    else
        echo "   Health:  FAIL"
    fi
    echo ""
}

# 查看日志
logs() {
    echo ""
    echo "========================================"
    echo "  Recent Logs (last 20 lines)"
    echo "========================================"
    echo ""

    if [ -f "$LOG_FILE" ]; then
        tail -20 "$LOG_FILE"
    else
        echo " [!] Log file not found"
    fi
    echo ""
}

# 使用帮助
usage() {
    echo ""
    echo "Usage: $0 [start|stop|restart|status|logs]"
    echo ""
}

# 主入口
case "$1" in
    start)   start ;;
    stop)    stop ;;
    restart) restart ;;
    status)  status ;;
    logs)    logs ;;
    *)       usage ;;
esac
