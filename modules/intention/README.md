# Intention Module 使用文档

## 概述

Intention模块是一个智能意图识别与处理系统，能够接收用户的自然语言指令，通过AI分析后转换为结构化的Home Assistant服务调用指令。

## 功能特性

1. **意图处理** - 接收JSON格式的意图数据，解析用户指令
2. **AI自动选择** - 自动选择可用的AI提供商（Claude、OpenAI、Gemini、DeepSeek）
3. **系统提示词管理** - 支持自定义系统提示词
4. **历史记录** - 保存最近100条处理记录
5. **可视化管理** - 提供完整的Web界面进行配置和测试

## 模块结构

```
modules/intention/
├── IntentionModule.js    # 主模块文件
├── config.json           # 配置文件
├── schema.json           # JSON Schema定义
└── flows.json           # Node-RED工作流定义（参考）

data/intention/
├── intentions.json      # 历史记录
└── custom_prompt.txt    # 自定义提示词（可选）

public/
└── intention-api-docs.html  # API文档和测试界面
```

## API 端点

### 1. 处理用户意图

**端点:** `POST /api/intention/intention/process`

**请求示例:**
```json
{
  "type": "message",
  "content": "打开所有灯",
  "metadata": {},
  "timestamp": "2025-10-25T15:28:01.491Z"
}
```

**响应示例:**
```json
{
  "success": true,
  "data": {
    "user_input": "打开所有灯",
    "intent": "Control Device",
    "devices": [{
      "floor_name": "",
      "floor_name_en": "",
      "floor_type": "",
      "room_type": "",
      "room_name": "",
      "room_name_en": "",
      "device_type": "light",
      "device_name": "",
      "device_name_en": "",
      "service": "light.turn_on",
      "service_data": {}
    }],
    "confidence": 0.95,
    "user_responds": "好的，即将为您打开所有灯光",
    "ai_provider": "gemini",
    "processed_at": "2025-10-25T15:28:02.000Z"
  }
}
```

### 2. 获取历史记录

**端点:** `GET /api/intention/intention/history?limit=50`

**响应:**
```json
{
  "success": true,
  "data": {
    "total": 10,
    "intentions": [...]
  }
}
```

### 3. 系统提示词管理

**获取提示词:** `GET /api/intention/intention/prompt`

**保存提示词:** `PUT /api/intention/intention/prompt`
```json
{
  "prompt": "Your custom system prompt..."
}
```

**删除自定义提示词:** `DELETE /api/intention/intention/prompt`

### 4. AI提供商配置

**获取配置:** `GET /api/intention/intention/ai-provider`

**设置提供商:** `POST /api/intention/intention/ai-provider`
```json
{
  "provider": "auto"  // auto | claude | openai | gemini | deepseek
}
```

## 使用方法

### 1. 启动服务

```bash
cd /Users/bo/credential-services
node server.js
```

### 2. 访问Web界面

打开浏览器访问：
```
http://localhost:3000/intention-api-docs.html
```

### 3. 使用curl测试

```bash
# 处理意图
curl -X POST http://localhost:3000/api/intention/intention/process \
  -H "Content-Type: application/json" \
  -d '{
    "type": "message",
    "content": "打开客厅的灯",
    "metadata": {},
    "timestamp": "2025-10-25T15:28:01.491Z"
  }'

# 获取历史记录
curl http://localhost:3000/api/intention/intention/history?limit=10

# 获取AI提供商配置
curl http://localhost:3000/api/intention/intention/ai-provider
```

## 配置说明

### config.json

```json
{
  "aiProvider": "auto"  // 可选值: auto, claude, openai, gemini, deepseek
}
```

- **auto**: 自动选择第一个可用的AI提供商
- **指定提供商**: 强制使用特定的AI提供商（需要该提供商已配置凭据）

## 意图分类

系统支持6种意图类型：

1. **Query Device Status** - 查询设备状态
2. **Control Device** - 控制设备
3. **Control Scene** - 场景控制
4. **Set Scene** - 设定场景
5. **Set Automation** - 设定自动化
6. **Other** - 其他

## 输出格式

每个处理请求返回的设备数组包含以下字段：

- `floor_name`: 楼层中文名称
- `floor_name_en`: 楼层英文名称
- `floor_type`: 楼层类型代码
- `room_type`: 房间类型代码（如：living_room）
- `room_name`: 房间中文名称
- `room_name_en`: 房间英文名称
- `device_type`: 设备类型（HA域名，如：light）
- `device_name`: 设备中文名称
- `device_name_en`: 设备英文名称
- `service`: Home Assistant服务名称（如：light.turn_on）
- `service_data`: 服务参数对象
- `confidence`: 置信度（0.0-1.0）
- `user_responds`: 给用户的响应文本

## 系统提示词

系统提示词定义了AI如何理解和解析用户意图。默认提示词包含：

- 意图分类规则
- 房间类型映射（中英文）
- 设备类型映射
- Home Assistant服务调用规则
- 输出格式定义

可以通过Web界面或API自定义提示词以适应特定需求。

## 故障排查

### 1. "No AI provider available" 错误

**原因:** 没有配置任何AI提供商的凭据

**解决方法:**
- 确保至少配置了一个AI提供商（claude/openai/gemini/deepseek）
- 通过各自的API页面配置凭据

### 2. "Failed to parse AI response" 错误

**原因:** AI返回的内容不是有效的JSON

**解决方法:**
- 检查系统提示词是否正确
- 尝试使用其他AI提供商
- 查看历史记录中AI的原始响应

### 3. 模块未加载

**原因:** 服务器启动时未找到模块

**解决方法:**
- 确保文件结构正确
- 重启服务器
- 检查server.js中的路由配置

## 与Node-RED集成

intention模块的工作流参考了Node-RED的设计。可以在`flows.json`中查看原始的Node-RED工作流定义。

主要流程：
1. 接收HTTP请求（意图数据）
2. 构建系统提示词和用户输入
3. 调用AI API（自动选择可用提供商）
4. 解析JSON响应
5. 返回结构化结果

## 开发说明

### 添加新的意图类型

在系统提示词中添加新的意图类型定义即可。

### 自定义输出格式

修改系统提示词中的"JSON输出格式"部分。

### 扩展设备类型

在系统提示词的"设备类型映射"部分添加新的设备类型。

## 性能优化

- 历史记录自动限制为最近100条
- AI响应超时设置为合理值
- 使用异步处理避免阻塞

## 安全注意事项

- API端点未实现身份验证，建议在生产环境中添加
- 用户输入未做SQL注入防护（当前使用文件存储）
- 建议限制历史记录访问权限

## 许可证

与主项目保持一致

