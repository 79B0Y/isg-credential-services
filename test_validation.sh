#!/bin/bash

echo "🔍 测试验证功能..."
echo ""

API_KEY="cred_tFixU2e1mMkz3WJfFsMskj7V5vdTzAsr"

echo "1️⃣ 测试 Telegram 模块验证："
curl -X POST http://localhost:3000/api/validate/telegram \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  | jq '.'

echo ""
echo "2️⃣ 测试 OpenAI 模块验证："
curl -X POST http://localhost:3000/api/validate/openai \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  | jq '.'

echo ""
echo "3️⃣ 测试 Claude 模块验证："
curl -X POST http://localhost:3000/api/validate/claude \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  | jq '.'

echo ""
echo "✅ 验证测试完成！"
