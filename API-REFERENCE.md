# API Reference

完整的 API 接口文档，包含所有模块的详细使用说明。

---

## 目录

- [AI 服务](#ai-服务)
  - [OpenAI](#openai)
  - [Gemini](#gemini)
  - [DeepSeek](#deepseek)
  - [Claude](#claude)
- [智能家居](#智能家居)
  - [Home Assistant](#home-assistant)
- [消息服务](#消息服务)
  - [Telegram](#telegram)
- [工作流](#工作流)
  - [Node-RED](#node-red)
- [WebSocket 实时接口](#websocket-实时接口)

---

## AI 服务

### OpenAI

#### Simple Chat (推荐)
**端点**: `POST /api/openai/openai/simple-chat`

简化的聊天接口，自动处理模型选择和输出清理。

**请求**:
```json
{
  "system_prompt": "你是一个AI助手",
  "user_prompt": "你好",
  "options": {
    "model": ["gemini-2.5-flash", "gpt-3.5-turbo", "deepseek-chat"],
    "temperature": 0.7,
    "max_tokens": 2000
  }
}
```

**响应**: 直接返回内容（自动解析 JSON）
```json
{
  "response": "你好！我是AI助手，有什么可以帮你的吗？"
}
```

#### 语音转文字
**端点**: `POST /api/openai/openai/transcribe-url`

使用 Whisper API 转录音频。

**请求**:
```json
{
  "audio_url": "https://example.com/audio.mp3",
  "language": "zh"
}
```

---

### Gemini

#### Simple Chat
**端点**: `POST /api/gemini/gemini/simple-chat`

与 OpenAI 兼容的聊天接口。

**自动模型选择**: 从数组中自动选择包含 "gemini" 的模型。

**请求格式**: 与 OpenAI 相同

---

### DeepSeek

#### Simple Chat
**端点**: `POST /api/deepseek/deepseek/simple-chat`

高性价比的聊天接口，适合中文对话和代码生成。

**自动模型选择**: 从数组中自动选择包含 "deepseek" 的模型。

**默认模型**: `deepseek-chat`

**特性**:
- 自动清理 Markdown 代码块标记（```json```）
- 自动解析 JSON 输出
- 与 OpenAI/Gemini 完全兼容

**示例**:
```bash
curl -X POST http://localhost:3000/api/deepseek/deepseek/simple-chat \
  -H "Content-Type: application/json" \
  -d '{
    "system_prompt": "你是一个 JSON 生成器",
    "user_prompt": "生成用户信息",
    "options": {
      "model": ["deepseek-chat"],
      "temperature": 0.3
    }
  }'
```

---

### Claude

#### Chat
**端点**: `POST /api/claude/claude/chat`

Anthropic Claude 聊天接口。

---

## 智能家居

### Home Assistant

#### 获取增强实体列表
**端点**: `GET /api/home_assistant/home_assistant/enhanced-list`

返回包含楼层、房间信息的完整实体列表。

**响应**:
```json
{
  "success": true,
  "data": {
    "entities": [
      {
        "entity_id": "light.living_room",
        "device_name": "客厅灯",
        "device_type": "light",
        "floor_name": "一楼",
        "floor_name_en": "First Floor",
        "room_name": "客厅",
        "room_name_en": "living_room",
        "state": "on"
      }
    ],
    "total": 50,
    "cached": true
  }
}
```

#### 批量控制设备
**端点**: `POST /api/home_assistant/home_assistant/batch-control`

一次请求控制多个设备。

**请求**:
```json
[
  {
    "entity_id": "light.living_room",
    "service": "turn_on",
    "service_data": {
      "brightness_pct": 80,
      "color_name": "blue"
    }
  },
  {
    "entity_id": "climate.bedroom",
    "service": "set_temperature",
    "service_data": {
      "temperature": 26
    }
  }
]
```

**支持的服务**:
- `light.turn_on` - 开灯 (brightness_pct, color_name, rgb_color)
- `light.turn_off` - 关灯
- `climate.set_temperature` - 设置温度
- `climate.set_hvac_mode` - 设置模式 (heat, cool, auto)
- `fan.turn_on` - 开风扇
- `cover.open_cover` - 打开窗帘
- `cover.close_cover` - 关闭窗帘

#### 批量获取状态
**端点**: `POST /api/home_assistant/home_assistant/batch-states`

批量查询多个实体的状态。

**请求**:
```json
{
  "entity_ids": ["light.living_room", "climate.bedroom"]
}
```

#### 智能设备匹配
**端点**: `POST /api/home_assistant/home_assistant/match-control-devices`

基于自然语言意图匹配设备。

**请求**:
```json
{
  "intent": "Control Device",
  "devices": [
    {
      "floor_name": "二楼",
      "room_name": "卧室",
      "device_type": "light",
      "service": "turn_on"
    }
  ]
}
```

#### 获取空间列表
**端点**: `GET /api/home_assistant/home_assistant/spaces`

获取所有楼层和房间信息。

**响应**:
```json
{
  "success": true,
  "data": {
    "floors": [
      {
        "floor_name": "一楼",
        "floor_name_en": "First Floor",
        "floor_type": "first_floor",
        "level": 1,
        "rooms": [
          {
            "name": "客厅",
            "name_en": "living_room",
            "type": "living_room"
          }
        ]
      }
    ]
  }
}
```

---

## 消息服务

### Telegram

#### 发送消息
**端点**: `POST /api/telegram/telegram/send/message`

**请求**:
```json
{
  "chat_id": "123456789",
  "text": "Hello!"
}
```

#### 获取消息历史
**端点**: `GET /api/telegram/telegram/messages`

**查询参数**:
- `limit` - 返回消息数量（默认 50）

#### 快速回复
**端点**: `POST /api/telegram/telegram/send/quick-reply`

发送带快速回复按钮的消息。

**请求**:
```json
{
  "chat_id": "123456789",
  "text": "请选择操作：",
  "buttons": [
    {"text": "开灯", "callback_data": "light_on"},
    {"text": "关灯", "callback_data": "light_off"}
  ]
}
```

#### 智能文本提取
**端点**: `GET /api/telegram/telegram/get-last-message-text`

自动提取最后一条消息的文本内容，支持：
- 文本消息：直接返回文本
- 语音消息：自动转录为文字

---

## 工作流

### Node-RED

#### 获取流程列表
**端点**: `GET /api/nodered/nodered/flows`

#### 部署流程
**端点**: `POST /api/nodered/nodered/flows`

#### 验证流程
**端点**: `POST /api/nodered/nodered/validate`

---

## WebSocket 实时接口

### Communication 模块
**端点**: `ws://localhost:8082`

实时通信和消息推送。

**连接示例**:
```javascript
const ws = new WebSocket('ws://localhost:8082');

ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('收到消息:', message);
});
```

**消息格式**:
```json
{
  "id": 12345,
  "from": {
    "id": 123456789,
    "first_name": "张三"
  },
  "text": "你好",
  "date": 1234567890,
  "isTranscribed": false
}
```

### Home Assistant 空间监控
**端点**: `ws://localhost:8081`

实时接收楼层和房间变化通知。

**连接示例**:
```javascript
const ws = new WebSocket('ws://localhost:8081');

ws.on('message', (data) => {
  const spaces = JSON.parse(data);
  console.log('空间更新:', spaces.data.floors);
});
```

**消息格式**:
```json
{
  "success": true,
  "data": {
    "floors": [...]
  }
}
```

---

## 自动模型选择

所有 AI 服务的 `simple-chat` 接口都支持自动模型选择。

**输入**:
```json
{
  "options": {
    "model": ["gemini-2.5-flash", "gpt-3.5-turbo", "deepseek-chat"]
  }
}
```

**选择规则**:
- OpenAI: 选择包含 "gpt" 或 "turbo" 的模型
- Gemini: 选择包含 "gemini" 的模型
- DeepSeek: 选择包含 "deepseek" 的模型

**如果没有匹配**:
- OpenAI: 使用 `gpt-3.5-turbo`
- Gemini: 使用 `gemini-2.5-flash`
- DeepSeek: 使用 `deepseek-chat`

---

## 输出格式清理

DeepSeek 和 Gemini 会自动清理 Markdown 代码块标记。

**AI 可能返回**:
```
```json
{"action": "turn_on", "device": "light"}
```
```

**自动清理后**:
```json
{"action": "turn_on", "device": "light"}
```

---

## 错误处理

所有 API 在失败时返回统一格式：

```json
{
  "success": false,
  "error": "错误描述"
}
```

**常见错误码**:
- `400` - 请求参数错误
- `401` - 未授权（缺少凭据）
- `404` - 接口或模块不存在
- `500` - 服务器内部错误

---

## 性能优化

### 缓存机制
Home Assistant 实体列表每分钟自动刷新，API 响应时间 ~1ms。

### WebSocket 心跳
所有 WebSocket 连接每 30 秒自动 ping/pong，保持连接活跃。

---

## 安全说明

1. **本地部署**: 所有服务运行在本地，不传输凭据到外部
2. **凭据隔离**: 每个服务的凭据独立存储
3. **敏感数据**: 不记录 API Key 等敏感信息

---

更多详细信息请访问 Web 界面：`http://localhost:3000`

