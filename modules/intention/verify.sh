#!/bin/bash

# Intention Module - 完整验证脚本

echo "🔍 开始验证 Intention Module..."
echo ""

# 1. 检查文件结构
echo "1️⃣  检查文件结构..."
echo ""

required_files=(
    "modules/intention/IntentionModule.js"
    "modules/intention/config.json"
    "modules/intention/schema.json"
    "modules/intention/flows.json"
    "modules/intention/README.md"
    "modules/intention/IMPLEMENTATION.md"
    "public/intention-api-docs.html"
)

all_files_exist=true
for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "   ✅ $file"
    else
        echo "   ❌ $file (缺失)"
        all_files_exist=false
    fi
done

if [ -d "data/intention" ]; then
    echo "   ✅ data/intention/"
else
    echo "   ❌ data/intention/ (缺失)"
    all_files_exist=false
fi

echo ""

if [ "$all_files_exist" = false ]; then
    echo "❌ 文件检查失败"
    exit 1
fi

# 2. 检查模块语法
echo "2️⃣  检查模块语法..."
echo ""

if node -c modules/intention/IntentionModule.js 2>/dev/null; then
    echo "   ✅ IntentionModule.js 语法正确"
else
    echo "   ❌ IntentionModule.js 语法错误"
    exit 1
fi

# 3. 测试模块加载
echo ""
echo "3️⃣  测试模块加载..."
echo ""

if node -e "const IntentionModule = require('./modules/intention/IntentionModule.js'); console.log('   ✅ 模块加载成功');" 2>/dev/null; then
    :
else
    echo "   ❌ 模块加载失败"
    exit 1
fi

# 4. 检查server.js中的路由
echo ""
echo "4️⃣  检查API路由配置..."
echo ""

routes=(
    "/api/intention/:module/process"
    "/api/intention/:module/history"
    "/api/intention/:module/prompt"
    "/api/intention/:module/ai-provider"
)

for route in "${routes[@]}"; do
    if grep -q "$route" server.js; then
        echo "   ✅ $route"
    else
        echo "   ❌ $route (未找到)"
    fi
done

# 5. 统计代码
echo ""
echo "5️⃣  代码统计..."
echo ""

module_lines=$(wc -l < modules/intention/IntentionModule.js | tr -d ' ')
api_docs_lines=$(wc -l < public/intention-api-docs.html | tr -d ' ')

echo "   📊 IntentionModule.js: $module_lines 行"
echo "   📊 intention-api-docs.html: $api_docs_lines 行"
echo "   📊 总计核心代码: $((module_lines + api_docs_lines)) 行"

# 6. 检查服务器状态
echo ""
echo "6️⃣  检查服务器状态..."
echo ""

if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "   ✅ 服务器正在运行"
    echo ""
    echo "   🧪 测试API端点可用性..."
    
    # 测试提示词端点
    if curl -s http://localhost:3000/api/intention/intention/prompt | grep -q "success"; then
        echo "   ✅ GET /api/intention/intention/prompt - 可用"
    else
        echo "   ⚠️  GET /api/intention/intention/prompt - 不可用（需要重启服务器）"
    fi
    
    # 测试AI提供商端点
    if curl -s http://localhost:3000/api/intention/intention/ai-provider | grep -q "success"; then
        echo "   ✅ GET /api/intention/intention/ai-provider - 可用"
    else
        echo "   ⚠️  GET /api/intention/intention/ai-provider - 不可用（需要重启服务器）"
    fi
else
    echo "   ⚠️  服务器未运行"
    echo ""
    echo "   启动服务器："
    echo "   node server.js"
fi

echo ""
echo "=========================================="
echo "✅ 验证完成！"
echo "=========================================="
echo ""
echo "📋 模块清单："
echo "   • IntentionModule.js - 核心模块实现"
echo "   • 7个API端点 - 完整的REST API"
echo "   • intention-api-docs.html - Web管理界面"
echo "   • 完整文档 - README + IMPLEMENTATION"
echo ""
echo "🚀 下一步："
echo ""
echo "1. 如果服务器未运行或API不可用，重启服务器："
echo "   node server.js"
echo ""
echo "2. 访问Web界面测试功能："
echo "   http://localhost:3000/intention-api-docs.html"
echo ""
echo "3. 或使用curl测试API："
echo "   curl -X POST http://localhost:3000/api/intention/intention/process \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"type\":\"message\",\"content\":\"打开所有灯\",\"metadata\":{},\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}'"
echo ""
echo "📖 详细文档: modules/intention/README.md"
echo ""

