#!/bin/bash

echo "=========================================="
echo "🧪 测试前端 API 调用"
echo "=========================================="

echo ""
echo "1️⃣ 获取所有模块列表"
echo "----------------------------------------"
curl -s http://localhost:3000/api/modules | jq '.data | to_entries[] | {name: .key, enabled: .value.data.enabled, initialized: .value.data.initialized}'

echo ""
echo "2️⃣ 获取 DeepSeek Schema"
echo "----------------------------------------"
curl -s http://localhost:3000/api/schema/deepseek | jq '.'

echo ""
echo "3️⃣ 获取 DeepSeek 现有凭据"
echo "----------------------------------------"
curl -s http://localhost:3000/api/credentials/deepseek | jq '.'

echo ""
echo "4️⃣ 获取 Node-RED Schema"
echo "----------------------------------------"
curl -s http://localhost:3000/api/schema/nodered | jq '.'

echo ""
echo "5️⃣ 获取 Node-RED 现有凭据"
echo "----------------------------------------"
curl -s http://localhost:3000/api/credentials/nodered | jq '.'

echo ""
echo "=========================================="
echo "✅ 测试完成"
echo "=========================================="

