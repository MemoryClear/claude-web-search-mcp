$PROJECT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$LOG_DIR = Join-Path $PROJECT_DIR "logs"
$LOG_FILE = Join-Path $LOG_DIR "server.log"
$ERR_FILE = Join-Path $LOG_DIR "error.log"
$PID_FILE = Join-Path $PROJECT_DIR ".server.pid"

if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR | Out-Null }

function Get-ServerStatus {
    $running = $false
    $procId = $null
    
    if (Test-Path $PID_FILE) {
        $procId = Get-Content $PID_FILE -Raw
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) { $running = $true }
    }
    
    return @{ Running = $running; PID = $procId }
}

switch ($args[0]) {
    "start" {
        Write-Host ""
        Write-Host "========================================"
        Write-Host "  Start Claude Web Search MCP Server"
        Write-Host "========================================"
        Write-Host ""
        
        $status = Get-ServerStatus
        if ($status.Running) {
            Write-Host " [!] Server already running (PID: $($status.PID))"
            Write-Host ""
            exit
        }
        
        Set-Location $PROJECT_DIR
        $p = Start-Process -FilePath "node" -ArgumentList "dist/mcp-http-server.js" -WorkingDirectory $PROJECT_DIR -WindowStyle Hidden -RedirectStandardOutput $LOG_FILE -RedirectStandardError $ERR_FILE -PassThru
        
        Start-Sleep -Seconds 3
        
        if ($p.Id) {
            $p.Id | Out-File -FilePath $PID_FILE -Encoding ascii
            Write-Host " [OK] Server started (hidden)"
            Write-Host "   PID:     $($p.Id)"
            Write-Host "   MCP:     http://localhost:3001/mcp"
            Write-Host "   Health:  http://localhost:3001/health"
            Write-Host "   Logs:    $LOG_FILE"
        } else {
            Write-Host " [X] Failed to start"
        }
        Write-Host ""
    }
    
    "stop" {
        Write-Host ""
        Write-Host "========================================"
        Write-Host "  Stop Claude Web Search MCP Server"
        Write-Host "========================================"
        Write-Host ""
        
        $status = Get-ServerStatus
        if ($status.PID) {
            Stop-Process -Id $status.PID -Force -ErrorAction SilentlyContinue
            Remove-Item $PID_FILE -Force -ErrorAction SilentlyContinue
            Write-Host " [OK] Server stopped (PID: $($status.PID))"
        } else {
            Write-Host " [!] No PID file found"
        }
        Write-Host ""
    }
    
    "restart" {
        Write-Host ""
        Write-Host "========================================"
        Write-Host "  Restart Claude Web Search MCP Server"
        Write-Host "========================================"
        Write-Host ""
        
        $status = Get-ServerStatus
        if ($status.Running) {
            Stop-Process -Id $status.PID -Force -ErrorAction SilentlyContinue
            Write-Host " [OK] Old server stopped"
            Start-Sleep -Seconds 1
        }
        
        Set-Location $PROJECT_DIR
        $p = Start-Process -FilePath "node" -ArgumentList "dist/mcp-http-server.js" -WorkingDirectory $PROJECT_DIR -WindowStyle Hidden -RedirectStandardOutput $LOG_FILE -RedirectStandardError $ERR_FILE -PassThru
        
        Start-Sleep -Seconds 3
        
        if ($p.Id) {
            $p.Id | Out-File -FilePath $PID_FILE -Encoding ascii
            Write-Host " [OK] Server restarted (PID: $($p.Id))"
        } else {
            Write-Host " [X] Restart failed"
        }
        Write-Host ""
    }
    
    "status" {
        Write-Host ""
        Write-Host "========================================"
        Write-Host "  Claude Web Search MCP Server Status"
        Write-Host "========================================"
        Write-Host ""
        
        $status = Get-ServerStatus
        if ($status.Running) {
            Write-Host "   Status:  Running (PID: $($status.PID))"
        } else {
            Write-Host "   Status:  Not running"
        }
        
        Write-Host ""
        
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -UseBasicParsing -TimeoutSec 2
            Write-Host "   Health:  OK"
            Write-Host $response.Content
        } catch {
            Write-Host "   Health:  FAIL"
        }
        Write-Host ""
    }
    
    "logs" {
        Write-Host ""
        Write-Host "========================================"
        Write-Host "  Recent Logs (last 20 lines)"
        Write-Host "========================================"
        Write-Host ""
        
        if (Test-Path $LOG_FILE) {
            Get-Content $LOG_FILE -Tail 20
        } else {
            Write-Host " [!] Log file not found"
        }
        Write-Host ""
    }
    
    default {
        Write-Host ""
        Write-Host "Usage: server.ps1 [start|stop|restart|status|logs]"
        Write-Host ""
    }
}
