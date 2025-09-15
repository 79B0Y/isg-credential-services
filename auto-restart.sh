#!/bin/bash

# Auto-restart script for Credential Service
# Monitors the service and restarts it automatically if it crashes

SERVICE_NAME="Credential Service"
SCRIPT_PATH="server.js"
LOG_FILE="logs/auto-restart.log"
PID_FILE="logs/service.pid"
MAX_RESTARTS=5
RESTART_WINDOW=300  # 5 minutes
RESTART_DELAY=10    # 10 seconds between restarts

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Ensure logs directory exists
mkdir -p logs

# Function to log messages
log_message() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} - ${message}" | tee -a "$LOG_FILE"
}

# Function to check if service is running
is_service_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0
        else
            rm -f "$PID_FILE"
            return 1
        fi
    fi
    return 1
}

# Function to start service
start_service() {
    log_message "${GREEN}Starting $SERVICE_NAME...${NC}"
    
    # Start with garbage collection enabled and increased memory
    node --expose-gc --max-old-space-size=1024 "$SCRIPT_PATH" &
    local pid=$!
    echo $pid > "$PID_FILE"
    
    # Wait a moment to check if it started successfully
    sleep 3
    if ps -p "$pid" > /dev/null 2>&1; then
        log_message "${GREEN}$SERVICE_NAME started with PID $pid${NC}"
        return 0
    else
        log_message "${RED}Failed to start $SERVICE_NAME${NC}"
        rm -f "$PID_FILE"
        return 1
    fi
}

# Function to stop service
stop_service() {
    if is_service_running; then
        local pid=$(cat "$PID_FILE")
        log_message "${YELLOW}Stopping $SERVICE_NAME (PID: $pid)...${NC}"
        
        # Send SIGTERM for graceful shutdown
        kill -TERM "$pid" 2>/dev/null
        
        # Wait up to 10 seconds for graceful shutdown
        for i in {1..10}; do
            if ! ps -p "$pid" > /dev/null 2>&1; then
                log_message "${GREEN}$SERVICE_NAME stopped gracefully${NC}"
                rm -f "$PID_FILE"
                return 0
            fi
            sleep 1
        done
        
        # Force kill if still running
        log_message "${YELLOW}Forcing $SERVICE_NAME to stop...${NC}"
        kill -KILL "$pid" 2>/dev/null
        rm -f "$PID_FILE"
        log_message "${GREEN}$SERVICE_NAME stopped${NC}"
    fi
}

# Function to restart service
restart_service() {
    log_message "${BLUE}Restarting $SERVICE_NAME...${NC}"
    stop_service
    sleep $RESTART_DELAY
    start_service
}

# Function to check service health
check_service_health() {
    # Check if HTTP endpoint responds
    if curl -s --connect-timeout 5 http://localhost:3000/health > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Main monitoring loop
monitor_service() {
    local restart_count=0
    local restart_window_start=$(date +%s)
    
    log_message "${BLUE}Starting auto-restart monitor for $SERVICE_NAME${NC}"
    
    # Initial start
    if ! is_service_running; then
        start_service
        if [ $? -ne 0 ]; then
            log_message "${RED}Failed to start $SERVICE_NAME initially${NC}"
            exit 1
        fi
    else
        log_message "${GREEN}$SERVICE_NAME is already running${NC}"
    fi
    
    # Monitor loop
    while true; do
        sleep 30  # Check every 30 seconds
        
        # Reset restart counter if enough time has passed
        local current_time=$(date +%s)
        if [ $((current_time - restart_window_start)) -gt $RESTART_WINDOW ]; then
            restart_count=0
            restart_window_start=$current_time
        fi
        
        # Check if service is running
        if ! is_service_running; then
            log_message "${RED}$SERVICE_NAME is not running${NC}"
            
            # Check restart limit
            if [ $restart_count -ge $MAX_RESTARTS ]; then
                log_message "${RED}Maximum restart attempts ($MAX_RESTARTS) reached in $RESTART_WINDOW seconds${NC}"
                log_message "${RED}Stopping auto-restart to prevent infinite loop${NC}"
                exit 1
            fi
            
            restart_count=$((restart_count + 1))
            log_message "${YELLOW}Restart attempt $restart_count/$MAX_RESTARTS${NC}"
            
            restart_service
            if [ $? -eq 0 ]; then
                log_message "${GREEN}$SERVICE_NAME restarted successfully${NC}"
            else
                log_message "${RED}Failed to restart $SERVICE_NAME${NC}"
            fi
            
            continue
        fi
        
        # Check service health
        if ! check_service_health; then
            log_message "${YELLOW}$SERVICE_NAME health check failed${NC}"
            
            # Give it another chance
            sleep 10
            if ! check_service_health; then
                log_message "${RED}$SERVICE_NAME health check failed twice, restarting...${NC}"
                
                # Check restart limit
                if [ $restart_count -ge $MAX_RESTARTS ]; then
                    log_message "${RED}Maximum restart attempts reached${NC}"
                    exit 1
                fi
                
                restart_count=$((restart_count + 1))
                restart_service
            fi
        fi
    done
}

# Handle script arguments
case "${1:-monitor}" in
    start)
        start_service
        ;;
    stop)
        stop_service
        ;;
    restart)
        restart_service
        ;;
    status)
        if is_service_running; then
            local pid=$(cat "$PID_FILE")
            echo -e "${GREEN}$SERVICE_NAME is running (PID: $pid)${NC}"
            
            # Check health
            if check_service_health; then
                echo -e "${GREEN}Service health: OK${NC}"
            else
                echo -e "${YELLOW}Service health: DEGRADED${NC}"
            fi
        else
            echo -e "${RED}$SERVICE_NAME is not running${NC}"
        fi
        ;;
    monitor)
        monitor_service
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|monitor}"
        echo ""
        echo "Commands:"
        echo "  start    - Start the service"
        echo "  stop     - Stop the service"
        echo "  restart  - Restart the service"
        echo "  status   - Show service status"
        echo "  monitor  - Start auto-restart monitoring (default)"
        exit 1
        ;;
esac