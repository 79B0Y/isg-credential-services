# Termux 环境故障排查

## 问题：模块输入框不显示

### 症状
在 Termux/PRoot Ubuntu 环境下，某些模块（如 DeepSeek、Node-RED）的输入框不显示。

### 可能原因

1. **Schema 文件加载失败**
   - 模块的 `schema.json` 文件不存在或无法读取
   - 文件权限问题

2. **API 请求失败**
   - `/api/schema/{module}` 返回 404 或错误
   - 模块未正确初始化

3. **前端JavaScript 错误**
   - 浏览器控制台有 JavaScript 错误
   - 表单容器元素不存在

### 诊断步骤

#### 1. 检查浏览器控制台

打开浏览器开发者工具（F12），查看 Console 标签：

```
[LoadForm] Loading credentials form for deepseek
[LoadForm] deepseek schema: ['api_key']
[LoadForm] Existing credentials loaded for deepseek: ['api_key']
[LoadForm] deepseek form generated
```

如果看到错误，记录下来。

#### 2. 测试 API 接口

在 Termux 中运行：

```bash
# 检查 DeepSeek schema
curl http://localhost:3000/api/schema/deepseek | jq '.'

# 检查 Node-RED schema
curl http://localhost:3000/api/schema/nodered | jq '.'

# 检查 DeepSeek credentials
curl http://localhost:3000/api/credentials/deepseek | jq '.'
```

**正常响应**：
```json
{
  "success": true,
  "data": {
    "type": "object",
    "properties": {
      "api_key": {...}
    }
  }
}
```

#### 3. 检查文件权限

```bash
cd /data/data/com.termux/files/home/credential-services

# 检查 schema 文件
ls -la modules/deepseek/schema.json
ls -la modules/nodered/schema.json

# 应该显示可读权限（r--）
# 如果没有，修复权限：
chmod 644 modules/*/schema.json
chmod 644 modules/*/config.json
```

#### 4. 检查模块是否正确初始化

```bash
# 查看服务日志
tail -50 logs/service.log | grep -E "deepseek|nodered"

# 查看模块状态
curl http://localhost:3000/api/modules | jq '.data.deepseek, .data.nodered'
```

**正常状态**：
```json
{
  "enabled": false,
  "initialized": true
}
```

### 解决方案

#### 方案 1：重新加载模块

```bash
# 使用管理脚本
./manage-service.sh restart

# 或使用 API
curl -X POST http://localhost:3000/api/modules/deepseek/reload
curl -X POST http://localhost:3000/api/modules/nodered/reload
```

#### 方案 2：手动创建 schema 文件

如果 schema 文件丢失，可以手动创建：

**DeepSeek** (`modules/deepseek/schema.json`):
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "title": "DeepSeek API Credentials",
  "properties": {
    "api_key": {
      "type": "string",
      "title": "API Key",
      "description": "DeepSeek API key",
      "required": true,
      "sensitive": true,
      "minLength": 32,
      "ui": {
        "widget": "password",
        "placeholder": "Enter your DeepSeek API key"
      }
    }
  },
  "required": ["api_key"]
}
```

**Node-RED** (`modules/nodered/schema.json`):
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "title": "Node-RED Service",
  "properties": {
    "base_url": {
      "type": "string",
      "title": "Service URL",
      "description": "Node-RED service address",
      "required": true,
      "ui": {
        "widget": "url",
        "placeholder": "http://localhost:1880"
      }
    }
  },
  "required": ["base_url"]
}
```

#### 方案 3：修复文件权限

```bash
# 递归修复所有模块文件权限
chmod -R 755 modules/
chmod -R 644 modules/*/schema.json
chmod -R 644 modules/*/config.json
chmod -R 644 data/*/credentials.json
```

#### 方案 4：清除缓存重启

```bash
# 清除浏览器缓存
# 在浏览器中按 Ctrl+Shift+R 或 Cmd+Shift+R 强制刷新

# 清除服务端缓存
./manage-service.sh stop
rm -rf logs/*.log
./manage-service.sh start
```

### 验证修复

1. **打开浏览器开发者工具 (F12)**
2. **刷新页面 (Ctrl+Shift+R)**
3. **查看 Console 标签**，应该看到：
   ```
   [LoadForm] deepseek schema: ['api_key']
   [LoadForm] nodered schema: ['base_url']
   ```
4. **检查模块卡片**，输入框应该正常显示

### 常见错误信息及解决

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `Failed to load schema (404)` | Schema 文件不存在 | 手动创建 schema.json |
| `Failed to load schema (500)` | 服务器内部错误 | 检查服务日志 |
| `Container not found for deepseek` | DOM 元素不存在 | 清除缓存重启 |
| `no properties` | Schema 格式错误 | 检查 JSON 格式 |
| `ENOENT` | 文件不存在 | 检查文件路径和权限 |

### 联系支持

如果以上方法都无法解决问题，请提供：

1. 浏览器控制台的完整日志
2. 服务器日志：`tail -100 logs/service.log`
3. Schema API 响应：`curl http://localhost:3000/api/schema/deepseek`
4. 模块状态：`curl http://localhost:3000/api/modules | jq '.data.deepseek'`

---

**最后更新**: 2025-10-16
