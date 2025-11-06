#!/bin/bash

# 色温控制测试脚本
# 用于验证 warm white 和 cool white 设置是否正常工作

echo "🧪 色温控制测试脚本"
echo "===================="
echo ""

# 配置
API_URL="http://localhost:3000/api/home_assistant/home_assistant/batch-control"
ENTITY_ID="light.light_02"  # 请根据实际情况修改

echo "📋 测试配置:"
echo "  API URL: $API_URL"
echo "  实体 ID: $ENTITY_ID"
echo ""

# 测试 1: 设置为暖白色
echo "🧪 测试 1: 设置为暖白色 (Warm White - 333 mireds)"
echo "----------------------------------------"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "[{
    \"entity_id\": \"$ENTITY_ID\",
    \"service\": \"light.turn_on\",
    \"service_data\": {
      \"color_temp\": 333
    }
  }]" 2>/dev/null | jq -r '.data.results[0].current_state.attributes | "  色温: \(.color_temp) mireds ≈ \(.color_temp_kelvin)K"'

echo ""
sleep 2

# 测试 2: 设置为冷白色
echo "🧪 测试 2: 设置为冷白色 (Cool White - 153 mireds)"
echo "----------------------------------------"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "[{
    \"entity_id\": \"$ENTITY_ID\",
    \"service\": \"light.turn_on\",
    \"service_data\": {
      \"color_temp\": 153
    }
  }]" 2>/dev/null | jq -r '.data.results[0].current_state.attributes | "  色温: \(.color_temp) mireds ≈ \(.color_temp_kelvin)K"'

echo ""
sleep 2

# 测试 3: 设置为中性白
echo "🧪 测试 3: 设置为中性白 (Neutral White - 250 mireds)"
echo "----------------------------------------"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "[{
    \"entity_id\": \"$ENTITY_ID\",
    \"service\": \"light.turn_on\",
    \"service_data\": {
      \"color_temp\": 250
    }
  }]" 2>/dev/null | jq -r '.data.results[0].current_state.attributes | "  色温: \(.color_temp) mireds ≈ \(.color_temp_kelvin)K"'

echo ""
echo "✅ 测试完成！"
echo ""
echo "📊 色温对照表:"
echo "  • Warm White (暖白):   333 mireds ≈ 3000K"
echo "  • Neutral White (中性): 250 mireds ≈ 4000K"
echo "  • Cool White (冷白):    153 mireds ≈ 6500K"

