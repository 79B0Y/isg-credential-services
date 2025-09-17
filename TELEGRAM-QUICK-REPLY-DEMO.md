# Telegram 快速回复功能演示

## 功能概述

新增了Telegram模块的快速回复功能，可以自动使用最近一次接收到的消息的chat_id进行回复，无需每次手动指定chat_id。

## 新增功能

### 1. 自动记录最近聊天ID
- 当接收到任何消息时，系统会自动记录该消息的chat_id和聊天信息
- 支持私聊、群聊等所有类型的聊天

### 2. 快速回复API
- **端点**: `POST /api/telegram/telegram/reply/last`
- **功能**: 使用最近的chat_id发送消息，无需指定chat_id

### 3. 最近聊天信息查询API
- **端点**: `GET /api/telegram/telegram/last-chat-info`
- **功能**: 查看当前记录的最近聊天信息

## API使用示例

### 1. 查看最近聊天信息
```bash
curl "http://localhost:3000/api/telegram/telegram/last-chat-info"
```

**响应示例**（没有最近聊天时）:
```json
{
  "success": true,
  "data": {
    "last_chat_id": null,
    "last_chat_info": null,
    "has_recent_chat": false
  }
}
```

**响应示例**（有最近聊天时）:
```json
{
  "success": true,
  "data": {
    "last_chat_id": 123456789,
    "last_chat_info": {
      "chat_id": 123456789,
      "chat_type": "private",
      "chat_title": null,
      "chat_username": "username",
      "chat_first_name": "用户名",
      "chat_last_name": null,
      "updated_at": "2025-09-15T12:00:00.000Z"
    },
    "has_recent_chat": true
  }
}
```

### 2. 快速回复消息
```bash
curl -X POST "http://localhost:3000/api/telegram/telegram/reply/last" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "这是一条快速回复消息",
    "options": {
      "parse_mode": "HTML",
      "disable_web_page_preview": true
    }
  }'
```

**成功响应**:
```json
{
  "success": true,
  "message": "Message sent successfully",
  "data": {
    "message_id": 123,
    "from": {...},
    "chat": {...},
    "date": 1694781234,
    "text": "这是一条快速回复消息"
  }
}
```

**错误响应**（没有最近聊天时）:
```json
{
  "success": false,
  "error": "No recent chat found. Please receive a message first or use sendMessage with specific chat_id."
}
```

## 使用流程

### 正常使用流程:
1. **启动Bot轮询**: 确保Telegram Bot正在接收消息
2. **发送消息给Bot**: 任何用户向Bot发送消息
3. **系统自动记录**: 系统自动记录最近的chat_id
4. **快速回复**: 使用快速回复API无需指定chat_id

### 测试步骤:
```bash
# 1. 首先检查最近聊天信息（应该为空）
curl "http://localhost:3000/api/telegram/telegram/last-chat-info"

# 2. 发送消息给你的Bot（通过Telegram客户端）
# 向你的Bot发送任意消息，比如 "Hello"

# 3. 再次检查最近聊天信息（应该有数据）
curl "http://localhost:3000/api/telegram/telegram/last-chat-info"

# 4. 使用快速回复
curl -X POST "http://localhost:3000/api/telegram/telegram/reply/last" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello! 这是自动回复"}'
```

## 技术实现

### 核心功能
- **自动记录**: 在`processUpdate`方法中自动更新`lastChatId`和`lastChatInfo`
- **快速回复**: `replyToLastChat`方法内部调用`sendMessage`，使用记录的chat_id
- **信息查询**: `getLastChatInfo`方法返回当前记录的聊天信息

### 数据存储
- `lastChatId`: 最近的聊天ID
- `lastChatInfo`: 完整的聊天信息，包含聊天类型、用户名等

### 兼容性
- 完全兼容现有的`sendMessage`API
- 新功能不影响原有功能
- 支持所有消息选项（parse_mode、reply_markup等）

## 使用场景

1. **客服机器人**: 快速回复客户消息
2. **通知系统**: 向最近联系的用户发送通知
3. **交互式Bot**: 简化用户交互流程
4. **自动回复**: 实现自动回复功能

## 注意事项

1. **重启后清空**: 服务重启后最近聊天记录会清空
2. **并发处理**: 如果有多个用户同时发送消息，会记录最后一个
3. **群聊支持**: 支持群聊，会记录群聊的chat_id
4. **权限要求**: 需要Bot有发送消息的权限

## 错误处理

- 没有最近聊天时会返回明确的错误提示
- 保持与原有sendMessage相同的错误处理逻辑
- 支持所有Telegram API的错误状态