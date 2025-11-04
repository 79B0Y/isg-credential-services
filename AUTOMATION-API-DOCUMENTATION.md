# Home Assistant 自动化管理 API 文档

本文档描述了 Home Assistant 模块的自动化管理 API 端点。

## 目录

1. [获取自动化列表](#1-获取自动化列表)
2. [获取单个自动化详情](#2-获取单个自动化详情)
3. [创建自动化](#3-创建自动化)
4. [删除自动化](#4-删除自动化)
5. [启用自动化](#5-启用自动化)
6. [禁用自动化](#6-禁用自动化)
7. [触发自动化](#7-触发自动化)
8. [重新加载自动化配置](#8-重新加载自动化配置)

---

## 1. 获取自动化列表

获取 Home Assistant 中所有自动化的列表。

### 请求

```
GET /api/home_assistant/home_assistant/automations
```

### 响应

```json
{
  "success": true,
  "data": {
    "automations": [
      {
        "entity_id": "automation.morning_lights",
        "name": "早晨开灯",
        "state": "on",
        "enabled": true,
        "last_triggered": "2025-10-28T08:00:00.000Z",
        "mode": "single",
        "current": 0,
        "max": 10,
        "icon": "mdi:lightbulb-on",
        "last_changed": "2025-10-27T10:30:00.000Z",
        "last_updated": "2025-10-28T08:00:00.000Z",
        "attributes": { ... }
      }
    ],
    "total_count": 15,
    "enabled_count": 12,
    "disabled_count": 3,
    "retrieved_at": "2025-10-28T10:00:00.000Z"
  }
}
```

---

## 2. 获取单个自动化详情

获取指定自动化的详细信息。

### 请求

```
GET /api/home_assistant/home_assistant/automation/:automation_id
```

### 参数

- `automation_id` (路径参数): 自动化的实体 ID，如 `automation.morning_lights` 或简短 ID `morning_lights`

### 响应

```json
{
  "success": true,
  "data": {
    "entity_id": "automation.morning_lights",
    "name": "早晨开灯",
    "state": "on",
    "enabled": true,
    "last_triggered": "2025-10-28T08:00:00.000Z",
    "mode": "single",
    "current": 0,
    "max": 10,
    "icon": "mdi:lightbulb-on",
    "last_changed": "2025-10-27T10:30:00.000Z",
    "last_updated": "2025-10-28T08:00:00.000Z",
    "attributes": { ... }
  }
}
```

---

## 3. 创建自动化

创建一个新的自动化。

### 请求

```
POST /api/home_assistant/home_assistant/automation/create
Content-Type: application/json
```

### 请求体

```json
{
  "id": "morning_routine",
  "alias": "早晨例行程序",
  "description": "每天早上7点开启客厅灯和咖啡机",
  "trigger": [
    {
      "platform": "time",
      "at": "07:00:00"
    }
  ],
  "condition": [
    {
      "condition": "state",
      "entity_id": "binary_sensor.workday",
      "state": "on"
    }
  ],
  "action": [
    {
      "service": "light.turn_on",
      "target": {
        "entity_id": "light.living_room"
      },
      "data": {
        "brightness": 200
      }
    },
    {
      "service": "switch.turn_on",
      "target": {
        "entity_id": "switch.coffee_maker"
      }
    }
  ],
  "mode": "single"
}
```

### 参数说明

- `id` (可选): 自动化的唯一标识符，如果不提供则自动生成
- `alias` (必需): 自动化的友好名称
- `description` (可选): 自动化的描述
- `trigger` (必需): 触发器数组，至少需要一个触发器
- `condition` (可选): 条件数组
- `action` (必需): 动作数组，至少需要一个动作
- `mode` (可选): 运行模式，可选值：`single`, `restart`, `queued`, `parallel`，默认为 `single`

### 响应

```json
{
  "success": true,
  "data": {
    "automation_id": "morning_routine",
    "entity_id": "automation.morning_routine",
    "alias": "早晨例行程序",
    "result": { ... },
    "created_at": "2025-10-28T10:00:00.000Z"
  }
}
```

---

## 4. 删除自动化

删除指定的自动化。

### 请求

```
DELETE /api/home_assistant/home_assistant/automation/:automation_id
```

### 参数

- `automation_id` (路径参数): 自动化的 ID（不含 `automation.` 前缀）或完整实体 ID

### 响应

```json
{
  "success": true,
  "data": {
    "automation_id": "morning_routine",
    "entity_id": "automation.morning_routine",
    "deleted_at": "2025-10-28T10:00:00.000Z"
  }
}
```

---

## 5. 启用自动化

启用一个已禁用的自动化。

### 请求

```
POST /api/home_assistant/home_assistant/automation/:automation_id/enable
```

### 参数

- `automation_id` (路径参数): 自动化的实体 ID

### 响应

```json
{
  "success": true,
  "data": {
    "entity_id": "automation.morning_routine",
    "state": "on",
    "enabled_at": "2025-10-28T10:00:00.000Z"
  }
}
```

---

## 6. 禁用自动化

禁用一个正在运行的自动化。

### 请求

```
POST /api/home_assistant/home_assistant/automation/:automation_id/disable
```

### 参数

- `automation_id` (路径参数): 自动化的实体 ID

### 响应

```json
{
  "success": true,
  "data": {
    "entity_id": "automation.morning_routine",
    "state": "off",
    "disabled_at": "2025-10-28T10:00:00.000Z"
  }
}
```

---

## 7. 触发自动化

手动触发一个自动化的执行（不管触发条件是否满足）。

### 请求

```
POST /api/home_assistant/home_assistant/automation/:automation_id/trigger
```

### 参数

- `automation_id` (路径参数): 自动化的实体 ID

### 响应

```json
{
  "success": true,
  "data": {
    "entity_id": "automation.morning_routine",
    "triggered_at": "2025-10-28T10:00:00.000Z"
  }
}
```

---

## 8. 重新加载自动化配置

重新加载所有自动化的配置（用于在修改配置文件后刷新）。

### 请求

```
POST /api/home_assistant/home_assistant/automations/reload
```

### 响应

```json
{
  "success": true,
  "data": {
    "reloaded_at": "2025-10-28T10:00:00.000Z"
  }
}
```

---

## 错误响应

所有 API 在出错时都会返回以下格式的错误响应：

```json
{
  "success": false,
  "error": "错误消息",
  "details": {
    "statusCode": 400,
    "message": "详细错误信息"
  }
}
```

常见的错误码：

- `400` - 请求参数错误
- `404` - 模块或资源未找到
- `500` - 服务器内部错误

---

## 触发器类型示例

### 时间触发器

```json
{
  "platform": "time",
  "at": "07:00:00"
}
```

### 状态触发器

```json
{
  "platform": "state",
  "entity_id": "binary_sensor.motion_living_room",
  "to": "on"
}
```

### 日出/日落触发器

```json
{
  "platform": "sun",
  "event": "sunset",
  "offset": "-00:30:00"
}
```

### 数值状态触发器

```json
{
  "platform": "numeric_state",
  "entity_id": "sensor.temperature",
  "above": 25
}
```

---

## 条件类型示例

### 状态条件

```json
{
  "condition": "state",
  "entity_id": "person.home",
  "state": "home"
}
```

### 时间条件

```json
{
  "condition": "time",
  "after": "07:00:00",
  "before": "23:00:00"
}
```

### 数值状态条件

```json
{
  "condition": "numeric_state",
  "entity_id": "sensor.temperature",
  "below": 20
}
```

---

## 动作类型示例

### 调用服务

```json
{
  "service": "light.turn_on",
  "target": {
    "entity_id": "light.living_room"
  },
  "data": {
    "brightness": 255,
    "color_temp": 300
  }
}
```

### 延迟

```json
{
  "delay": "00:05:00"
}
```

### 通知

```json
{
  "service": "notify.mobile_app",
  "data": {
    "message": "自动化已触发",
    "title": "通知"
  }
}
```

---

## 测试

要测试自动化 API，可以运行提供的测试脚本：

```bash
node test-automation-api.js
```

该脚本会：
1. 获取现有自动化列表
2. 创建一个测试自动化
3. 获取自动化详情
4. 禁用自动化
5. 启用自动化
6. 触发自动化
7. 重新加载配置
8. 删除测试自动化

---

## 注意事项

1. **权限要求**: 需要 Home Assistant 的长期访问令牌 (Long-Lived Access Token)
2. **实体 ID 格式**: 自动化的实体 ID 始终以 `automation.` 开头
3. **配置持久性**: 通过 API 创建的自动化会保存到 Home Assistant 的配置中
4. **运行模式**: 
   - `single`: 如果自动化已在运行，新触发会被忽略
   - `restart`: 如果自动化已在运行，重新开始执行
   - `queued`: 排队执行
   - `parallel`: 并行执行多个实例

---

## 相关链接

- [Home Assistant 自动化文档](https://www.home-assistant.io/docs/automation/)
- [Home Assistant API 文档](https://developers.home-assistant.io/docs/api/rest/)

