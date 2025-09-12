#!/bin/bash

# Credential Service 管理脚本

SERVICE_NAME="Credential Service"
PORT=3000

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 显示帮助信息
show_help() {
    echo -e "${BLUE}📋 $SERVICE_NAME 管理脚本${NC}"
    echo ""
    echo "使用方法: $0 [命令]"
    echo ""
    echo "命令:"
    echo "  start     启动服务"
    echo "  stop      停止服务"
    echo "  restart   重启服务"
    echo "  status    检查服务状态"
    echo "  logs      查看服务日志"
    echo "  test      测试服务功能"
    echo "  clean     清理端口占用"
    echo "  help      显示此帮助信息"
    echo ""
}

# 检查端口是否被占用
check_port() {
    local pid=$(lsof -ti:$PORT 2>/dev/null)
    if [ -n "$pid" ]; then
        echo -e "${YELLOW}⚠️  端口 $PORT 被进程 $pid 占用${NC}"
        return 0
    else
        echo -e "${GREEN}✅ 端口 $PORT 可用${NC}"
        return 1
    fi
}

# 启动服务
start_service() {
    echo -e "${BLUE}🚀 启动 $SERVICE_NAME...${NC}"
    
    if check_port; then
        echo -e "${RED}❌ 端口 $PORT 已被占用，请先停止现有服务${NC}"
        echo "使用 '$0 stop' 或 '$0 clean' 来清理端口"
        return 1
    fi
    
    cd "$(dirname "$0")"
    nohup ./start-with-telegram.sh > service.log 2>&1 &
    local pid=$!
    
    echo -e "${GREEN}✅ 服务已启动，PID: $pid${NC}"
    echo -e "${BLUE}📊 Web界面: http://localhost:$PORT${NC}"
    echo -e "${BLUE}🔧 API端点: http://localhost:$PORT/api${NC}"
    echo -e "${BLUE}📱 Telegram消息管理: http://localhost:$PORT${NC}"
    echo ""
    echo "查看日志: $0 logs"
    echo "检查状态: $0 status"
}

# 停止服务
stop_service() {
    echo -e "${YELLOW}⏹️  停止 $SERVICE_NAME...${NC}"
    
    local pids=$(lsof -ti:$PORT 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "找到进程: $pids"
        kill -TERM $pids 2>/dev/null
        sleep 2
        
        # 如果进程还在运行，强制终止
        local remaining=$(lsof -ti:$PORT 2>/dev/null)
        if [ -n "$remaining" ]; then
            echo -e "${YELLOW}强制终止进程...${NC}"
            kill -9 $remaining 2>/dev/null
        fi
        
        echo -e "${GREEN}✅ 服务已停止${NC}"
    else
        echo -e "${YELLOW}⚠️  没有找到运行中的服务${NC}"
    fi
}

# 重启服务
restart_service() {
    echo -e "${BLUE}🔄 重启 $SERVICE_NAME...${NC}"
    stop_service
    sleep 2
    start_service
}

# 检查服务状态
check_status() {
    echo -e "${BLUE}📊 检查 $SERVICE_NAME 状态...${NC}"
    
    if check_port; then
        local pid=$(lsof -ti:$PORT)
        echo -e "${GREEN}✅ 服务正在运行 (PID: $pid)${NC}"
        
        # 测试API
        echo -e "${BLUE}🔍 测试API连接...${NC}"
        local response=$(curl -s -w "%{http_code}" http://localhost:$PORT/api/health -o /dev/null)
        if [ "$response" = "200" ]; then
            echo -e "${GREEN}✅ API响应正常${NC}"
        else
            echo -e "${RED}❌ API响应异常 (HTTP $response)${NC}"
        fi
        
        # 检查Telegram模块
        echo -e "${BLUE}🤖 检查Telegram模块...${NC}"
        local telegram_status=$(curl -s http://localhost:$PORT/api/modules/telegram | jq -r '.data.enabled // false' 2>/dev/null)
        if [ "$telegram_status" = "true" ]; then
            echo -e "${GREEN}✅ Telegram模块已启用${NC}"
        else
            echo -e "${YELLOW}⚠️  Telegram模块未启用${NC}"
        fi
    else
        echo -e "${RED}❌ 服务未运行${NC}"
    fi
}

# 查看日志
show_logs() {
    echo -e "${BLUE}📋 显示服务日志...${NC}"
    
    if [ -f "service.log" ]; then
        tail -f service.log
    else
        echo -e "${YELLOW}⚠️  日志文件不存在${NC}"
    fi
}

# 测试服务功能
test_service() {
    echo -e "${BLUE}🧪 测试 $SERVICE_NAME 功能...${NC}"
    
    if ! check_port; then
        echo -e "${RED}❌ 服务未运行，请先启动服务${NC}"
        return 1
    fi
    
    echo -e "${BLUE}1. 测试健康检查...${NC}"
    curl -s http://localhost:$PORT/api/health | jq .
    
    echo -e "\n${BLUE}2. 测试模块列表...${NC}"
    curl -s http://localhost:$PORT/api/modules | jq '.data | keys'
    
    echo -e "\n${BLUE}3. 测试Telegram模块...${NC}"
    curl -s http://localhost:$PORT/api/modules/telegram | jq '.data | {name, enabled, initialized, messaging}'
    
    echo -e "\n${BLUE}4. 测试Telegram消息API...${NC}"
    curl -s http://localhost:$PORT/api/telegram/telegram/messages | jq .
    
    echo -e "\n${GREEN}✅ 功能测试完成${NC}"
}

# 清理端口占用
clean_port() {
    echo -e "${YELLOW}🧹 清理端口 $PORT 占用...${NC}"
    
    local pids=$(lsof -ti:$PORT 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "找到占用端口的进程: $pids"
        kill -9 $pids 2>/dev/null
        echo -e "${GREEN}✅ 端口已清理${NC}"
    else
        echo -e "${GREEN}✅ 端口未被占用${NC}"
    fi
}

# 主函数
main() {
    case "${1:-help}" in
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
            check_status
            ;;
        logs)
            show_logs
            ;;
        test)
            test_service
            ;;
        clean)
            clean_port
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            echo -e "${RED}❌ 未知命令: $1${NC}"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# 运行主函数
main "$@"

