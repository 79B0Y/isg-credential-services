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
    echo "  version   显示版本信息"
    echo "  uninstall 卸载服务"
    echo "  modules   查询模块状态"
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
    nohup ./start.sh > service.log 2>&1 &
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

# 显示版本信息
show_version() {
    echo -e "${BLUE}📦 $SERVICE_NAME 版本信息${NC}"
    echo ""
    
    # 获取package.json中的版本信息
    if [ -f "package.json" ]; then
        local version=$(grep '"version"' package.json | sed 's/.*"version": *"\([^"]*\)".*/\1/')
        local name=$(grep '"name"' package.json | sed 's/.*"name": *"\([^"]*\)".*/\1/')
        local description=$(grep '"description"' package.json | sed 's/.*"description": *"\([^"]*\)".*/\1/')
        
        echo -e "${GREEN}服务名称:${NC} $name"
        echo -e "${GREEN}版本号:${NC} $version"
        echo -e "${GREEN}描述:${NC} $description"
        echo ""
        
        # 显示Node.js版本
        echo -e "${GREEN}Node.js版本:${NC} $(node --version)"
        echo -e "${GREEN}NPM版本:${NC} $(npm --version)"
        echo ""
        
        # 显示安装路径
        echo -e "${GREEN}安装路径:${NC} $(pwd)"
        echo -e "${GREEN}启动脚本:${NC} $0"
        echo ""
        
        # 显示服务状态
        if check_port; then
            echo -e "${GREEN}服务状态:${NC} ${GREEN}运行中${NC}"
            local pid=$(lsof -ti:$PORT)
            echo -e "${GREEN}进程ID:${NC} $pid"
        else
            echo -e "${GREEN}服务状态:${NC} ${RED}未运行${NC}"
        fi
        
        # 显示端口信息
        echo -e "${GREEN}服务端口:${NC} $PORT"
        echo -e "${GREEN}Web界面:${NC} http://localhost:$PORT"
        echo -e "${GREEN}API端点:${NC} http://localhost:$PORT/api"
        
    else
        echo -e "${RED}❌ 未找到package.json文件${NC}"
        echo "请确保在正确的目录中运行此脚本"
    fi
}

# 卸载服务
uninstall_service() {
    echo -e "${RED}🗑️  卸载 $SERVICE_NAME...${NC}"
    echo ""
    
    # 确认卸载
    echo -e "${YELLOW}⚠️  这将完全删除 $SERVICE_NAME 及其所有数据${NC}"
    echo -e "${YELLOW}包括:${NC}"
    echo "  - 服务文件"
    echo "  - 配置文件"
    echo "  - 凭据数据"
    echo "  - 日志文件"
    echo ""
    
    read -p "确定要卸载吗? (输入 'yes' 确认): " confirm
    if [ "$confirm" != "yes" ]; then
        echo -e "${GREEN}✅ 取消卸载${NC}"
        return 0
    fi
    
    echo -e "${YELLOW}正在停止服务...${NC}"
    stop_service
    
    echo -e "${YELLOW}正在删除文件...${NC}"
    
    # 删除主要文件
    local files_to_remove=(
        "server.js"
        "package.json"
        "package-lock.json"
        "start.sh"
        "start-termux.js"
        "auto-restart.sh"
        "manage-service.sh"
        "clean-for-release.sh"
        "prepare-release.sh"
        "install.sh"
    )
    
    for file in "${files_to_remove[@]}"; do
        if [ -f "$file" ]; then
            rm -f "$file"
            echo "  删除: $file"
        fi
    done
    
    # 删除目录
    local dirs_to_remove=(
        "core"
        "modules"
        "config"
        "data"
        "public"
        "lib"
        "workers"
        "debug"
        "logs"
        "tests"
        "examples"
        "node_modules"
    )
    
    for dir in "${dirs_to_remove[@]}"; do
        if [ -d "$dir" ]; then
            rm -rf "$dir"
            echo "  删除目录: $dir"
        fi
    done
    
    # 删除其他文件
    local other_files=(
        "README.md"
        "CHANGELOG.md"
        "CLAUDE.md"
        "INSTALL.md"
        "TELEGRAM-QUICK-REPLY-DEMO.md"
        "TERMUX-README.md"
        ".gitignore"
        "credential-service-v1.0.0.tar.gz"
        "service.log"
    )
    
    for file in "${other_files[@]}"; do
        if [ -f "$file" ]; then
            rm -f "$file"
            echo "  删除: $file"
        fi
    done
    
    echo ""
    echo -e "${GREEN}✅ $SERVICE_NAME 已成功卸载${NC}"
    echo -e "${BLUE}💡 提示: 如需重新安装，请运行安装脚本${NC}"
}

# 查询模块状态
query_modules() {
    echo -e "${BLUE}🔍 查询模块状态...${NC}"
    echo ""
    
    if ! check_port; then
        echo -e "${RED}❌ 服务未运行，请先启动服务${NC}"
        echo "使用 '$0 start' 启动服务"
        return 1
    fi
    
    echo -e "${BLUE}📊 获取模块列表...${NC}"
    local modules_response=$(curl -s http://localhost:$PORT/api/modules 2>/dev/null)
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ 无法连接到服务API${NC}"
        return 1
    fi
    
    # 检查响应是否有效
    if ! echo "$modules_response" | jq . >/dev/null 2>&1; then
        echo -e "${RED}❌ API响应格式错误${NC}"
        echo "响应内容: $modules_response"
        return 1
    fi
    
    # 解析模块数据
    local module_names=$(echo "$modules_response" | jq -r '.data | keys[]' 2>/dev/null)
    
    if [ -z "$module_names" ]; then
        echo -e "${YELLOW}⚠️  未找到任何模块${NC}"
        return 0
    fi
    
    echo -e "${GREEN}找到以下模块:${NC}"
    echo ""
    
    for module_name in $module_names; do
        echo -e "${BLUE}📦 模块: $module_name${NC}"
        
        # 获取详细模块信息
        local module_info=$(curl -s http://localhost:$PORT/api/modules/$module_name 2>/dev/null)
        
        if echo "$module_info" | jq . >/dev/null 2>&1; then
            local enabled=$(echo "$module_info" | jq -r '.data.enabled // false' 2>/dev/null)
            local initialized=$(echo "$module_info" | jq -r '.data.initialized // false' 2>/dev/null)
            local name=$(echo "$module_info" | jq -r '.data.name // "N/A"' 2>/dev/null)
            local version=$(echo "$module_info" | jq -r '.data.version // "N/A"' 2>/dev/null)
            
            echo "  状态: $([ "$enabled" = "true" ] && echo -e "${GREEN}已启用${NC}" || echo -e "${RED}已禁用${NC}")"
            echo "  初始化: $([ "$initialized" = "true" ] && echo -e "${GREEN}已初始化${NC}" || echo -e "${RED}未初始化${NC}")"
            echo "  名称: $name"
            echo "  版本: $version"
            
            # 测试连接状态
            echo -e "  ${BLUE}连接测试:${NC}"
            local test_result=$(curl -s http://localhost:$PORT/api/test-connection/$module_name -X POST -H "Content-Type: application/json" -d '{}' 2>/dev/null)
            
            if echo "$test_result" | jq -e '.success == true' >/dev/null 2>&1; then
                echo "    连接: ${GREEN}正常${NC}"
            else
                echo "    连接: ${RED}异常${NC}"
                local error_msg=$(echo "$test_result" | jq -r '.error // "Unknown error"' 2>/dev/null)
                if [ "$error_msg" != "null" ] && [ -n "$error_msg" ]; then
                    echo "    原因: $error_msg"
                fi
            fi
            
            # 验证凭据
            echo -e "  ${BLUE}凭据验证:${NC}"
            local validate_result=$(curl -s http://localhost:$PORT/api/validate/$module_name -X POST -H "Content-Type: application/json" -d '{"credentials": null}' 2>/dev/null)
            
            if echo "$validate_result" | jq -e '.success == true' >/dev/null 2>&1; then
                echo "    凭据: ${GREEN}有效${NC}"
            else
                echo "    凭据: ${RED}无效或缺失${NC}"
                local error_msg=$(echo "$validate_result" | jq -r '.error // "Unknown error"' 2>/dev/null)
                if [ "$error_msg" != "null" ] && [ -n "$error_msg" ]; then
                    echo "    原因: $error_msg"
                fi
            fi
            
        else
            echo "  状态: ${RED}获取信息失败${NC}"
        fi
        
        echo ""
    done
    
    echo -e "${GREEN}✅ 模块状态查询完成${NC}"
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
        version)
            show_version
            ;;
        uninstall)
            uninstall_service
            ;;
        modules)
            query_modules
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

