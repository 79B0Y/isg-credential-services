# AI Enhanced Scene Module

🎬 智能场景管理模块 - 使用 AI 增强的场景执行、创建和删除功能

## 📋 概述

AI Enhanced Scene 模块是一个智能场景管理系统，它使用 AI 技术来智能匹配和管理 Home Assistant 场景。该模块支持三个主要功能：

1. **执行场景** - 智能匹配并执行 Home Assistant 场景
2. **创建场景** - 从设备当前状态创建新场景
3. **删除场景** - 智能匹配并删除场景

## 🌟 主要特性

- ✅ **智能匹配** - 使用 AI 进行场景名称的语义匹配
- ✅ **多语言支持** - 支持中文、英文等多种语言
- ✅ **可定制提示词** - 三个独立的 AI 提示词可自定义
- ✅ **多 AI 提供商** - 支持 Claude, OpenAI, Gemini, DeepSeek
- ✅ **完整 API** - RESTful API 和 Web 测试界面

## 📦 安装

模块已包含在系统中，无需额外安装。确保以下依赖模块已配置：

- `home_assistant` - Home Assistant 集成
- 至少一个 AI 提供商模块（`claude`, `openai`, `gemini`, 或 `deepseek`）

## 🚀 快速开始

### 1. 配置模块

模块会自动启用，默认配置为：

```json
{
  "aiProvider": "auto"
}
```

`aiProvider` 可以设置为：
- `auto` - 自动选择可用的 AI 提供商
- `claude` - 使用 Claude AI
- `openai` - 使用 OpenAI
- `gemini` - 使用 Google Gemini
- `deepseek` - 使用 DeepSeek

### 2. 访问 API 文档

打开浏览器访问：
```
http://localhost:3000/ai-enhanced-scene-api-docs.html
```

### 3. 测试模块

运行测试脚本：
```bash
node test-ai-enhanced-scene.js
```

## 📡 API 端点

### 执行场景

```http
POST /api/ai_enhanced_scene/ai_enhanced_scene/execute
Content-Type: application/json

{
  "success": true,
  "data": {
    "intent": "Control Scene",
    "user_input": "我回来了",
    "scene": {
      "scene_name": "回家模式",
      "scene_name_en": "arrival_home",
      "operation": "execute"
    }
  }
}
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "matched": true,
    "scene_id": "scene.arrival_home",
    "scene_name": "回家模式",
    "confidence": 0.95,
    "message": "正在为您执行回家模式场景...",
    "execution_result": {
      "success": true
    }
  }
}
```

### 创建场景

```http
POST /api/ai_enhanced_scene/ai_enhanced_scene/create
Content-Type: application/json

{
  "success": true,
  "data": {
    "intent": "Set Scene",
    "user_input": "读取客厅所有设备当前状态创建我回家了的场景",
    "scene": {
      "scene_name": "我回家了",
      "scene_name_en": "arrival_home",
      "operation": "add"
    },
    "matched_devices": [
      {
        "entity_id": "light.living_room",
        "service": "light.state"
      }
    ]
  }
}
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "scene_id": "scene.arrival_home",
    "scene_name": "我回家了",
    "snapshot_entities": ["light.living_room", "climate.living_room"],
    "message": "正在为您创建'我回家了'场景，包含客厅的2个设备..."
  }
}
```

### 删除场景

```http
POST /api/ai_enhanced_scene/ai_enhanced_scene/delete
Content-Type: application/json

{
  "success": true,
  "data": {
    "intent": "Set Scene",
    "user_input": "删除我回家场景",
    "scene": {
      "scene_name": "我回家场景",
      "scene_name_en": "arrival_home",
      "operation": "delete"
    }
  }
}
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "matched": true,
    "scene_id": "scene.arrival_home",
    "scene_name": "回家场景",
    "confidence": 0.92,
    "message": "正在为您删除回家场景...",
    "deletion_result": {
      "success": true
    }
  }
}
```

### 获取所有提示词

```http
GET /api/ai_enhanced_scene/ai_enhanced_scene/prompts
```

### 更新提示词

```http
PUT /api/ai_enhanced_scene/ai_enhanced_scene/prompt/:type
Content-Type: application/json

{
  "prompt": "你的自定义提示词内容..."
}
```

其中 `:type` 可以是：
- `execute` - 执行场景提示词
- `create` - 创建场景提示词
- `delete` - 删除场景提示词

### 获取模块信息

```http
GET /api/ai_enhanced_scene/ai_enhanced_scene/info
```

## 🔧 集成示例

### 与 Intention 模块集成

AI Enhanced Scene 模块设计用于与 Intention 模块配合使用：

1. **用户输入** → Intention 模块分类意图
2. **意图分类结果** → AI Enhanced Scene 模块处理
3. **场景操作** → Home Assistant 执行

```javascript
// 1. 使用 Intention 模块分类用户输入
const intentionResult = await fetch('/api/intention/intention/classify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_input: "我回来了" })
});

const intention = await intentionResult.json();

// 2. 如果是场景相关意图，传递给 AI Enhanced Scene
if (intention.data.intent === 'Control Scene') {
  const sceneResult = await fetch('/api/ai_enhanced_scene/ai_enhanced_scene/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(intention)
  });
  
  const result = await sceneResult.json();
  console.log(result.data.message); // "正在为您执行回家模式场景..."
}
```

## 🎨 自定义 AI 提示词

模块使用三个独立的提示词文件：

1. `data/ai_enhanced_scene/execute_prompt.txt` - 执行场景
2. `data/ai_enhanced_scene/create_prompt.txt` - 创建场景
3. `data/ai_enhanced_scene/delete_prompt.txt` - 删除场景

可以通过以下方式修改：

- **Web 界面**：访问 API 文档页面，使用提示词管理功能
- **API**：使用 PUT 请求更新提示词
- **直接编辑**：编辑数据目录中的文本文件

## 📊 工作流程

### 执行场景流程

```
用户输入 → AI 匹配场景 → 执行匹配的场景 → 返回结果
```

1. 接收来自 Intention 模块的输入
2. 从 Home Assistant 获取所有可用场景
3. 使用 AI 进行语义匹配
4. 如果匹配成功，执行场景
5. 返回执行结果和友好消息

### 创建场景流程

```
用户输入 → AI 整理设备 → 创建场景快照 → 返回结果
```

1. 接收场景数据和设备列表
2. 使用 AI 生成场景配置
3. 调用 Home Assistant 创建场景
4. 返回创建结果

### 删除场景流程

```
用户输入 → AI 匹配场景 → 删除匹配的场景 → 返回结果
```

1. 接收场景名称
2. 从 Home Assistant 获取所有场景
3. 使用 AI 匹配要删除的场景
4. 删除匹配的场景
5. 返回删除结果

## 🔍 故障排除

### 模块未启动

检查依赖：
```bash
# 确保 Home Assistant 模块已配置
curl http://localhost:3000/api/modules/home_assistant

# 确保至少有一个 AI 模块已配置
curl http://localhost:3000/api/modules/claude
```

### AI 不可用

检查 AI 提供商配置：
```bash
curl http://localhost:3000/api/ai_enhanced_scene/ai_enhanced_scene/info
```

查看 `ai_provider` 和 `configured` 字段。

### 场景未找到

确认场景存在于 Home Assistant：
```bash
curl http://localhost:3000/api/home_assistant/home_assistant/scenes
```

## 📝 开发建议

1. **提示词优化** - 根据实际使用情况调整 AI 提示词
2. **匹配阈值** - 默认置信度阈值为 0.6，可在提示词中调整
3. **错误处理** - 始终检查 API 响应中的 `success` 字段
4. **语言一致性** - AI 会自动匹配用户输入的语言

## 📚 相关文档

- [Home Assistant API 文档](http://localhost:3000/home-assistant-api-docs.html)
- [Intention API 文档](http://localhost:3000/intention-api-docs.html)
- [Scene Module 文档](../modules/home_assistant/SceneModule.js)

## 🤝 贡献

如有问题或建议，请通过 GitHub Issues 提交。

## 📄 许可

MIT License

