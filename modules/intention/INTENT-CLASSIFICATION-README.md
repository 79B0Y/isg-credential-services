# 意图分类子模块 (Intent Classification Sub-module)

## 概述

意图分类子模块是 Intention 模块的一个轻量级扩展，专门用于快速识别用户输入的意图类型，而不进行复杂的设备信息提取。

## 功能特性

- ✨ **快速分类**：只做意图识别，响应速度更快
- 🎯 **六种意图类型**：覆盖智能家居的主要使用场景
- 🤖 **AI 驱动**：自动选择可用的 AI 提供商
- 📊 **置信度评分**：返回分类的置信度
- 💬 **智能回应**：生成与输入语言一致的友好回应

## 支持的意图类型

| 意图类型 | 说明 | 示例 |
|---------|------|------|
| **Query Device Status** | 查询设备状态 | "客厅灯开着吗"、"温度是多少" |
| **Control Device** | 控制设备 | "打开客厅灯"、"关闭空调" |
| **Control Scene** | 场景控制 | "启动观影模式"、"执行睡眠场景" |
| **Set Scene** | 设定场景 | "创建一个观影场景" |
| **Set Automation** | 设定自动化 | "晚上7点自动开灯" |
| **Other** | 其他 | 不属于以上类型的输入 |

## API 使用

### 端点

```
POST /api/intention/intention/classify
```

### 请求格式

```json
{
  "user_input": "客厅温度和湿度是多少"
}
```

### 响应格式

```json
{
  "success": true,
  "data": {
    "user_input": "客厅温度和湿度是多少",
    "intent": "Query Device Status",
    "confidence": 0.9,
    "user_responds": "好的，我帮您查看客厅的温度和湿度",
    "ai_provider": "gemini",
    "classified_at": "2025-10-27T15:28:02.000Z"
  }
}
```

## 使用示例

### Node.js

```javascript
const response = await fetch('http://localhost:3000/api/intention/intention/classify', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        user_input: '客厅温度和湿度是多少'
    })
});

const data = await response.json();
console.log('意图:', data.data.intent);
console.log('置信度:', data.data.confidence);
```

### cURL

```bash
curl -X POST http://localhost:3000/api/intention/intention/classify \
  -H "Content-Type: application/json" \
  -d '{"user_input": "客厅温度和湿度是多少"}'
```

### Python

```python
import requests

response = requests.post(
    'http://localhost:3000/api/intention/intention/classify',
    json={'user_input': '客厅温度和湿度是多少'}
)

data = response.json()
print('意图:', data['data']['intent'])
print('置信度:', data['data']['confidence'])
```

## 测试

### Web 界面测试

访问 [http://localhost:3000/intention-api-docs.html](http://localhost:3000/intention-api-docs.html)，点击 **🎯 意图分类** 标签页进行测试。

### 命令行测试

```bash
node test-intention-classify.js
```

## 与完整意图处理的区别

| 特性 | 意图分类 | 完整意图处理 |
|------|---------|------------|
| **速度** | 快速 (约0.5-1秒) | 较慢 (约1-3秒) |
| **返回数据** | 意图类型 + 置信度 | 意图 + 设备信息 + HA 服务调用 |
| **用途** | 意图路由、决策 | 执行设备控制 |
| **Token 消耗** | 少 (约500 tokens) | 多 (约3500 tokens) |
| **适用场景** | 需要快速判断用户意图 | 需要执行具体的设备控制 |

## 应用场景

### 1. 意图路由

根据分类结果将请求路由到不同的处理模块：

```javascript
const result = await classifyIntention(userInput);

switch (result.intent) {
    case 'Query Device Status':
        return await queryDeviceStatus(userInput);
    case 'Control Device':
        return await controlDevice(userInput);
    case 'Control Scene':
        return await controlScene(userInput);
    // ...
}
```

### 2. 权限控制

在执行设备控制前，先确认用户意图：

```javascript
const classification = await classifyIntention(userInput);

if (classification.intent === 'Control Device' && 
    classification.confidence > 0.8) {
    // 执行设备控制
    await processIntention(userInput);
}
```

### 3. 用户反馈

快速给用户反馈：

```javascript
const result = await classifyIntention(userInput);
console.log(result.user_responds); // "好的，我帮您查看客厅的温度和湿度"
```

## 配置

意图分类使用 Intention 模块的全局配置：

```json
{
  "aiProvider": "auto"
}
```

支持的 AI 提供商：
- `auto` - 自动选择（推荐）
- `gemini` - Google Gemini
- `openai` - OpenAI GPT
- `deepseek` - DeepSeek
- `claude` - Anthropic Claude

## 性能优化

1. **温度设置**：意图分类使用较低的温度 (0.3)，确保分类结果稳定
2. **Token 限制**：最大 500 tokens，减少 API 消耗
3. **缓存建议**：可以对常见输入进行缓存，进一步提升性能

## 错误处理

```javascript
try {
    const response = await fetch('/api/intention/intention/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_input: userInput })
    });
    
    const data = await response.json();
    
    if (!data.success) {
        console.error('分类失败:', data.error);
    }
} catch (error) {
    console.error('请求失败:', error.message);
}
```

## 常见问题

### Q: 意图分类的准确率如何？

A: 在测试中，对于明确的智能家居指令，准确率通常在 85-95% 之间。置信度低于 0.7 的结果建议人工确认。

### Q: 可以自定义意图类型吗？

A: 当前版本支持固定的 6 种意图类型。如需自定义，可以修改 `IntentionModule.js` 中的 `getClassificationPrompt()` 方法。

### Q: 支持多语言吗？

A: 支持。AI 会根据输入语言自动生成对应语言的回应。

## 更新日志

### v1.0.0 (2025-10-27)
- ✨ 首次发布
- 🎯 支持 6 种意图类型
- 🤖 自动 AI 提供商选择
- 📊 置信度评分
- 💬 智能回应生成

## 技术支持

如有问题或建议，请在项目 GitHub 上提交 Issue。

