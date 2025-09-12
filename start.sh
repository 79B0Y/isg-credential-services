#!/bin/bash

# Credential Service Startup Script for Termux
# This script handles environment setup, dependency checking, and service startup

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SERVICE_NAME="Credential Service"
SERVICE_PORT=${CRED_SERVICE_SERVER_PORT:-3000}
SERVICE_HOST=${CRED_SERVICE_SERVER_HOST:-0.0.0.0}
LOG_FILE="./logs/startup.log"
PID_FILE="./credential-service.pid"

# Detect environment
IS_TERMUX=false
if [ -n "$PREFIX" ] && [ "$PREFIX" = "/data/data/com.termux/files/usr" ]; then
    IS_TERMUX=true
fi

# Logging function
log() {
    local level=$1
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Create log directory if it doesn't exist
    mkdir -p "$(dirname "$LOG_FILE")"
    
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

# Print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Print banner
print_banner() {
    print_status "$PURPLE" "
╔══════════════════════════════════════╗
║           🔐 Credential Service      ║
║         Node-RED Integration         ║
╚══════════════════════════════════════╝
"
}

# Check if running as root (not recommended)
check_root() {
    if [ "$EUID" -eq 0 ]; then
        print_status "$YELLOW" "⚠️  Warning: Running as root is not recommended for security reasons."
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# Check Node.js installation
check_node() {
    print_status "$BLUE" "🔍 Checking Node.js installation..."
    
    if ! command -v node &> /dev/null; then
        print_status "$RED" "❌ Node.js not found!"
        
        if [ "$IS_TERMUX" = true ]; then
            print_status "$YELLOW" "📦 Installing Node.js in Termux..."
            pkg update && pkg install nodejs npm -y
        else
            print_status "$RED" "Please install Node.js (version 14.0.0 or higher) from https://nodejs.org/"
            exit 1
        fi
    fi
    
    local node_version=$(node --version | sed 's/v//')
    local required_version="14.0.0"
    
    if [ "$(printf '%s\n' "$required_version" "$node_version" | sort -V | head -n1)" != "$required_version" ]; then
        print_status "$RED" "❌ Node.js version $node_version is too old. Minimum required: $required_version"
        exit 1
    fi
    
    print_status "$GREEN" "✅ Node.js $node_version found"
}

# Check npm installation
check_npm() {
    print_status "$BLUE" "🔍 Checking npm installation..."
    
    if ! command -v npm &> /dev/null; then
        print_status "$RED" "❌ npm not found!"
        
        if [ "$IS_TERMUX" = true ]; then
            print_status "$YELLOW" "📦 Installing npm in Termux..."
            pkg install npm -y
        else
            print_status "$RED" "Please install npm"
            exit 1
        fi
    fi
    
    print_status "$GREEN" "✅ npm $(npm --version) found"
}

# Install dependencies
install_dependencies() {
    print_status "$BLUE" "📦 Checking dependencies..."
    
    if [ ! -d "node_modules" ] || [ ! -f "package-lock.json" ]; then
        print_status "$YELLOW" "📥 Installing dependencies..."
        npm install --production
        
        if [ $? -eq 0 ]; then
            print_status "$GREEN" "✅ Dependencies installed successfully"
        else
            print_status "$RED" "❌ Failed to install dependencies"
            exit 1
        fi
    else
        print_status "$GREEN" "✅ Dependencies already installed"
    fi
}

# Setup Termux-specific configurations
setup_termux() {
    if [ "$IS_TERMUX" = true ]; then
        print_status "$CYAN" "🤖 Configuring for Termux environment..."
        
        # Request storage permissions
        if ! termux-setup-storage 2>/dev/null; then
            print_status "$YELLOW" "⚠️  Storage permissions not granted. Some features may be limited."
        else
            print_status "$GREEN" "✅ Storage permissions granted"
        fi
        
        # Set Termux-specific environment variables
        export TERMUX_ENVIRONMENT=true
        export CRED_SERVICE_DATA_DIR="$HOME/credential-service/data"
        
        # Create necessary directories
        mkdir -p "$HOME/credential-service/data"
        mkdir -p "$HOME/credential-service/logs"
        
        print_status "$GREEN" "✅ Termux environment configured"
    fi
}

# Check port availability
check_port() {
    print_status "$BLUE" "🔍 Checking port $SERVICE_PORT availability..."
    
    if command -v netstat &> /dev/null; then
        if netstat -tuln | grep -q ":$SERVICE_PORT "; then
            print_status "$YELLOW" "⚠️  Port $SERVICE_PORT is already in use"
            read -p "Try to find an available port automatically? (Y/n): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Nn]$ ]]; then
                exit 1
            else
                # Find available port
                for port in {3001..3099}; do
                    if ! netstat -tuln | grep -q ":$port "; then
                        SERVICE_PORT=$port
                        export CRED_SERVICE_SERVER_PORT=$port
                        print_status "$GREEN" "✅ Using port $port instead"
                        break
                    fi
                done
            fi
        else
            print_status "$GREEN" "✅ Port $SERVICE_PORT is available"
        fi
    else
        print_status "$YELLOW" "⚠️  Cannot check port availability (netstat not found)"
    fi
}

# Setup directories
setup_directories() {
    print_status "$BLUE" "📁 Setting up directories..."
    
    # Create necessary directories
    mkdir -p logs
    mkdir -p data
    mkdir -p config
    mkdir -p test-reports
    
    # Set proper permissions
    chmod 750 logs data config
    
    print_status "$GREEN" "✅ Directories created"
}

# Create systemd service (Linux only)
create_service() {
    if [ "$IS_TERMUX" = false ] && command -v systemctl &> /dev/null; then
        print_status "$BLUE" "🔧 Creating systemd service..."
        
        local service_file="/etc/systemd/system/credential-service.service"
        local working_dir=$(pwd)
        local user=$(whoami)
        
        if [ "$EUID" -eq 0 ]; then
            cat > "$service_file" << EOF
[Unit]
Description=Credential Service for Node-RED Integration
After=network.target

[Service]
Type=simple
User=$user
WorkingDirectory=$working_dir
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
            
            systemctl daemon-reload
            systemctl enable credential-service
            
            print_status "$GREEN" "✅ Systemd service created and enabled"
            print_status "$CYAN" "   Use 'sudo systemctl start credential-service' to start"
            print_status "$CYAN" "   Use 'sudo systemctl status credential-service' to check status"
        else
            print_status "$YELLOW" "⚠️  Run as root to create systemd service"
        fi
    fi
}

# Check if service is already running
check_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            print_status "$YELLOW" "⚠️  Service is already running (PID: $pid)"
            print_status "$CYAN" "   Access the web interface at: http://localhost:$SERVICE_PORT"
            print_status "$CYAN" "   API endpoint: http://localhost:$SERVICE_PORT/api"
            
            read -p "Stop the running service and restart? (y/N): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                print_status "$YELLOW" "🛑 Stopping service..."
                kill "$pid" 2>/dev/null || true
                sleep 2
                rm -f "$PID_FILE"
            else
                exit 0
            fi
        else
            rm -f "$PID_FILE"
        fi
    fi
}

# Start the service
start_service() {
    print_status "$BLUE" "🚀 Starting $SERVICE_NAME..."
    
    # Set environment variables
    export NODE_ENV=${NODE_ENV:-production}
    export CRED_SERVICE_SERVER_PORT=$SERVICE_PORT
    export CRED_SERVICE_SERVER_HOST=$SERVICE_HOST
    
    # Start the service in background
    nohup node server.js > "$LOG_FILE" 2>&1 &
    local pid=$!
    
    # Save PID
    echo "$pid" > "$PID_FILE"
    
    # Wait a moment and check if service started successfully
    sleep 2
    if ps -p "$pid" > /dev/null 2>&1; then
        print_status "$GREEN" "✅ $SERVICE_NAME started successfully!"
        print_status "$GREEN" "   PID: $pid"
        print_status "$GREEN" "   Port: $SERVICE_PORT"
        print_status "$GREEN" "   Host: $SERVICE_HOST"
        print_status "$CYAN" "   Web Interface: http://localhost:$SERVICE_PORT"
        print_status "$CYAN" "   API Endpoint: http://localhost:$SERVICE_PORT/api"
        print_status "$CYAN" "   Health Check: http://localhost:$SERVICE_PORT/health"
        
        # Show log tail
        print_status "$BLUE" "📋 Service logs (last 10 lines):"
        tail -n 10 "$LOG_FILE" 2>/dev/null || true
        
        print_status "$CYAN" "📄 View full logs: tail -f $LOG_FILE"
        print_status "$CYAN" "🛑 Stop service: kill $pid"
        
    else
        print_status "$RED" "❌ Failed to start service"
        print_status "$RED" "   Check the log file: $LOG_FILE"
        rm -f "$PID_FILE"
        exit 1
    fi
}

# Health check
health_check() {
    print_status "$BLUE" "🏥 Performing health check..."
    
    local max_attempts=10
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if command -v curl &> /dev/null; then
            if curl -s -f "http://localhost:$SERVICE_PORT/health" > /dev/null 2>&1; then
                print_status "$GREEN" "✅ Health check passed"
                return 0
            fi
        elif command -v wget &> /dev/null; then
            if wget -q --spider "http://localhost:$SERVICE_PORT/health" 2>/dev/null; then
                print_status "$GREEN" "✅ Health check passed"
                return 0
            fi
        else
            # Fallback to basic port check
            if netstat -tuln 2>/dev/null | grep -q ":$SERVICE_PORT "; then
                print_status "$GREEN" "✅ Service is listening on port $SERVICE_PORT"
                return 0
            fi
        fi
        
        print_status "$YELLOW" "⏳ Attempt $attempt/$max_attempts - waiting for service..."
        sleep 1
        attempt=$((attempt + 1))
    done
    
    print_status "$RED" "❌ Health check failed"
    return 1
}

# Cleanup function
cleanup() {
    print_status "$YELLOW" "🧹 Cleaning up..."
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            kill "$pid" 2>/dev/null || true
        fi
        rm -f "$PID_FILE"
    fi
}

# Signal handlers
trap cleanup EXIT INT TERM

# Main execution
main() {
    print_banner
    
    log "INFO" "Starting Credential Service setup and startup process"
    
    # System checks
    check_root
    check_node
    check_npm
    
    # Environment setup
    setup_termux
    setup_directories
    check_port
    check_running
    
    # Install dependencies
    install_dependencies
    
    # Service management
    create_service
    start_service
    
    # Health check
    if health_check; then
        print_status "$GREEN" "🎉 $SERVICE_NAME is ready!"
        
        if [ "$IS_TERMUX" = true ]; then
            print_status "$CYAN" "
📱 Termux Tips:
   • Keep Termux running in background
   • Use 'termux-wake-lock' to prevent sleep
   • Access via local network: http://$(hostname -I | awk '{print $1}'):$SERVICE_PORT
            "
        fi
        
        log "INFO" "Credential Service startup completed successfully"
        
        # Keep the script running to show real-time logs
        print_status "$BLUE" "📋 Following logs (Ctrl+C to detach):"
        tail -f "$LOG_FILE" 2>/dev/null || true
        
    else
        print_status "$RED" "❌ Service startup failed"
        log "ERROR" "Service startup failed"
        exit 1
    fi
}

# Help function
show_help() {
    echo "Credential Service Startup Script"
    echo
    echo "Usage: $0 [OPTION]"
    echo
    echo "Options:"
    echo "  -h, --help          Show this help message"
    echo "  -p, --port PORT     Set custom port (default: 3000)"
    echo "  -H, --host HOST     Set custom host (default: 0.0.0.0)"
    echo "  --dev               Run in development mode"
    echo "  --test              Run tests instead of starting service"
    echo "  --stop              Stop running service"
    echo "  --status            Show service status"
    echo "  --logs              Show service logs"
    echo
    echo "Examples:"
    echo "  $0                  Start service with default settings"
    echo "  $0 -p 8080         Start service on port 8080"
    echo "  $0 --dev           Start in development mode"
    echo "  $0 --test          Run test suite"
    echo "  $0 --stop          Stop running service"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -p|--port)
            SERVICE_PORT="$2"
            shift 2
            ;;
        -H|--host)
            SERVICE_HOST="$2"
            shift 2
            ;;
        --dev)
            export NODE_ENV=development
            export CRED_SERVICE_LOGGING_LEVEL=debug
            shift
            ;;
        --test)
            print_banner
            print_status "$BLUE" "🧪 Running test suite..."
            npm test
            exit $?
            ;;
        --stop)
            if [ -f "$PID_FILE" ]; then
                local pid=$(cat "$PID_FILE")
                if ps -p "$pid" > /dev/null 2>&1; then
                    print_status "$YELLOW" "🛑 Stopping service (PID: $pid)..."
                    kill "$pid"
                    rm -f "$PID_FILE"
                    print_status "$GREEN" "✅ Service stopped"
                else
                    print_status "$RED" "❌ Service not running"
                    rm -f "$PID_FILE"
                fi
            else
                print_status "$RED" "❌ PID file not found"
            fi
            exit 0
            ;;
        --status)
            if [ -f "$PID_FILE" ]; then
                local pid=$(cat "$PID_FILE")
                if ps -p "$pid" > /dev/null 2>&1; then
                    print_status "$GREEN" "✅ Service is running (PID: $pid)"
                    print_status "$CYAN" "   Port: $SERVICE_PORT"
                    print_status "$CYAN" "   Web: http://localhost:$SERVICE_PORT"
                else
                    print_status "$RED" "❌ Service not running (stale PID file)"
                    rm -f "$PID_FILE"
                fi
            else
                print_status "$RED" "❌ Service not running"
            fi
            exit 0
            ;;
        --logs)
            if [ -f "$LOG_FILE" ]; then
                tail -f "$LOG_FILE"
            else
                print_status "$RED" "❌ Log file not found: $LOG_FILE"
                exit 1
            fi
            ;;
        *)
            print_status "$RED" "❌ Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Run main function
main