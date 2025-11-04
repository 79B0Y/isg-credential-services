# Intention API 输出示例

## 接口地址
`POST http://localhost:3000/api/intention/intention/process`

## 请求示例
```json
{
  "content": "打开客厅的灯",
  "type": "text",
  "metadata": {},
  "timestamp": "2025-11-04T10:00:00.000Z"
}
```

## 响应格式（完整字段输出）

### 成功响应
```json
{
  "success": true,
  "data": {
    "user_input": "打开客厅的灯",
    "intent": "Control Device",
    "devices": [
      {
        "floor_name": "",
        "floor_name_en": "",
        "floor_type": "",
        "room_type": "living_room",
        "room_name": "客厅",
        "room_name_en": "living_room",
        "device_type": "light",
        "device_name": "灯",
        "device_name_en": "light",
        "service": "light.turn_on",
        "service_data": {}
      }
    ],
    "confidence": 0.95,
    "user_responds": "好的，正在为您打开客厅灯",
    "ai_provider": "gemini",
    "processed_at": "2025-11-04T10:00:01.234Z"
  }
}
```

### 设备字段说明

每个设备对象都包含以下完整字段：

| 字段名 | 类型 | 说明 | 示例 |
|-------|------|------|------|
| `floor_name` | string | 楼层名称（用户输入的语言） | "一楼", "二楼", "" |
| `floor_name_en` | string | 楼层英文名称 | "First Floor", "Second Floor", "" |
| `floor_type` | string | 楼层类型代码 | "first_floor", "second_floor", "" |
| `room_type` | string | 房间类型代码 | "living_room", "bedroom", "" |
| `room_name` | string | 房间名称（用户输入的语言） | "客厅", "主卧", "" |
| `room_name_en` | string | 房间英文名称 | "living_room", "master_bedroom", "" |
| `device_type` | string | 设备类型（HA域名） | "light", "climate", "fan", "" |
| `device_name` | string | 设备名称（用户输入的语言） | "吊灯", "台灯", "" |
| `device_name_en` | string | 设备英文名称 | "ceiling_light", "table_lamp", "" |
| `service` | string | Home Assistant 服务名称 | "light.turn_on", "climate.set_temperature", "" |
| `service_data` | object | 服务参数对象 | `{"brightness_pct": 80}`, `{}` |

### 字段保证

- **所有字段都会输出**：即使某些字段为空，也会以空字符串 `""` 或空对象 `{}` 的形式返回
- **字段顺序固定**：按照上述表格的顺序输出
- **类型保证**：
  - 字符串字段默认为 `""`
  - `service_data` 对象默认为 `{}`
  - `devices` 数组默认为 `[]`

## 多设备示例

### 请求
```json
{
  "content": "一楼落地灯变成蓝色，二楼客房空调调成26度"
}
```

### 响应
```json
{
  "success": true,
  "data": {
    "user_input": "一楼落地灯变成蓝色，二楼客房空调调成26度",
    "intent": "Control Device",
    "devices": [
      {
        "floor_name": "一楼",
        "floor_name_en": "First Floor",
        "floor_type": "first_floor",
        "room_type": "",
        "room_name": "",
        "room_name_en": "",
        "device_type": "light",
        "device_name": "落地灯",
        "device_name_en": "floor_lamp",
        "service": "light.turn_on",
        "service_data": {
          "color_name": "blue"
        }
      },
      {
        "floor_name": "二楼",
        "floor_name_en": "Second Floor",
        "floor_type": "second_floor",
        "room_type": "guest_bedroom",
        "room_name": "客房",
        "room_name_en": "guest_bedroom",
        "device_type": "climate",
        "device_name": "空调",
        "device_name_en": "air_conditioner",
        "service": "climate.set_temperature",
        "service_data": {
          "temperature": 26
        }
      }
    ],
    "confidence": 0.9,
    "user_responds": "好的，正在为您执行灯光和空调的控制",
    "ai_provider": "gemini",
    "processed_at": "2025-11-04T10:00:01.234Z"
  }
}
```

## 查询状态示例

### 请求
```json
{
  "content": "客厅温度和湿度是多少"
}
```

### 响应
```json
{
  "success": true,
  "data": {
    "user_input": "客厅温度和湿度是多少",
    "intent": "Query Device Status",
    "devices": [
      {
        "floor_name": "",
        "floor_name_en": "",
        "floor_type": "",
        "room_type": "living_room",
        "room_name": "客厅",
        "room_name_en": "living_room",
        "device_type": "temperature",
        "device_name": "温度传感器",
        "device_name_en": "temperature_sensor",
        "service": "sensor.state",
        "service_data": {}
      },
      {
        "floor_name": "",
        "floor_name_en": "",
        "floor_type": "",
        "room_type": "living_room",
        "room_name": "客厅",
        "room_name_en": "living_room",
        "device_type": "humidity",
        "device_name": "湿度传感器",
        "device_name_en": "humidity_sensor",
        "service": "sensor.state",
        "service_data": {}
      }
    ],
    "confidence": 0.9,
    "user_responds": "好的，我帮您查看客厅的温度和湿度",
    "ai_provider": "gemini",
    "processed_at": "2025-11-04T10:00:01.234Z"
  }
}
```

## 错误响应

### AI Provider 不可用
```json
{
  "success": false,
  "error": "No AI provider available"
}
```

### 无效输入
```json
{
  "success": false,
  "error": "Invalid intention data: content is required"
}
```

### AI 解析失败
```json
{
  "success": false,
  "error": "Failed to parse AI response: Unexpected token..."
}
```

## 代码优化说明

### 1. 字段完整性保证
- 所有设备对象都会通过 map 函数规范化，确保包含所有11个字段
- 缺失的字段会自动填充为默认值（空字符串或空对象）

### 2. 数组保证
- 即使 AI 未返回 devices 数组，也会自动创建空数组 `[]`

### 3. 响应结构标准化
- 最终响应数据结构固定，包含所有必需字段
- 添加了 `ai_provider` 和 `processed_at` 等元信息

### 4. 日志记录
- 记录处理的设备数量，方便调试和监控

## 测试命令

```bash
# 基本测试
curl -X POST http://localhost:3000/api/intention/intention/process \
  -H "Content-Type: application/json" \
  -d '{"content": "打开客厅的灯"}' | jq

# 多设备测试
curl -X POST http://localhost:3000/api/intention/intention/process \
  -H "Content-Type: application/json" \
  -d '{"content": "一楼落地灯变成蓝色，二楼客房空调调成26度"}' | jq

# 查询状态测试
curl -X POST http://localhost:3000/api/intention/intention/process \
  -H "Content-Type: application/json" \
  -d '{"content": "客厅温度和湿度是多少"}' | jq
```

