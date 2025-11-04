# Node-RED 模块

Node-RED flow 管理和部署服务模块

## 功能特性

### 核心功能
- ✅ Flow 上传和部署
- ✅ Flow 格式验证
- ✅ 连接测试
- ✅ 自动备份与恢复
- ✅ **自动更新检查** 🆕

### 自动更新功能

模块会定期（默认每 3 分钟）自动检查 `/data/agent_flow/` 目录中的 flow 文件，并与 Node-RED 服务中的 flow 进行版本对比：

- **自动添加**：如果 Node-RED 服务中没有某个 flow，自动添加
- **自动更新**：如果本地 flow 版本号高于 Node-RED 服务中的版本，自动更新
- **智能对比**：支持标准 semver 版本号对比（如 v1.0.1 vs v1.0.0）

详细说明请查看 [AUTO_UPDATE_FEATURE.md](./AUTO_UPDATE_FEATURE.md)

## 配置

### 基础配置

在 `config.json` 中配置：

```json
{
  "name": "nodered",
  "displayName": "Node-RED",
  "apiBaseUrl": "http://localhost:1880",
  "timeout": 15000,
  "enabled": true
}
```

### Flow 管理配置

```json
{
  "flowManagement": {
    "autoBackup": true,              // 部署前自动备份
    "backupInterval": 3600000,       // 备份间隔（毫秒）
    "maxBackups": 10,                // 最大备份数量
    "validationTimeout": 30000,      // 验证超时时间
    "autoUpdate": true,              // 启用自动更新 🆕
    "autoUpdateInterval": 180000     // 更新检查间隔（3分钟）🆕
  }
}
```

## API 端点

模块提供以下 API 端点：

### 1. 获取 Flows
```http
GET /api/nodered/nodered/flows
```

### 2. 部署 Flows
```http
POST /api/nodered/nodered/deploy
Content-Type: application/json

{
  "flows": [...]
}
```

### 3. 验证 Flow
```http
POST /api/nodered/nodered/validate
Content-Type: application/json

{
  "flow": [...]
}
```

### 4. 上传 Flow 文件
```http
POST /api/nodered/nodered/upload
Content-Type: application/json

{
  "flowData": [...],
  "filename": "my-flow.json"
}
```

### 5. 备份管理
```http
POST /api/nodered/nodered/backup    # 创建备份
GET  /api/nodered/nodered/backups   # 获取备份列表
POST /api/nodered/nodered/restore   # 恢复备份
```

### 6. 连接测试
```http
POST /api/nodered/nodered/test
```

## Flow 文件格式

### 目录结构
```
/data/agent_flow/
  ├── Home-Automation-v1.0.1.json
  ├── Monitoring-v2.0.0.json
  └── ...
```

### 文件内容示例

```json
[
  {
    "id": "unique-tab-id",
    "type": "tab",
    "label": "Home Automation v1.0.1",
    "disabled": false,
    "info": "",
    "env": []
  },
  {
    "id": "node-id-1",
    "type": "inject",
    "z": "unique-tab-id",
    "name": "Trigger",
    "topic": "",
    "x": 100,
    "y": 100,
    "wires": [["node-id-2"]]
  }
]
```

### 版本号格式

支持以下版本号格式：

1. **Tab Label**（优先）
   - `"Home Automation v1.0.1"`
   - `"Home Automation 1.0.1"`

2. **文件名**（备用）
   - `Home-Automation-v1.0.1.json`
   - `Home-Automation-1.0.1.json`

版本号必须遵循 semver 格式：`major.minor.patch`（例如：1.0.0、2.1.3）

## 使用示例

### 1. 添加新 Flow

```bash
# 1. 创建 flow 文件
cat > /data/agent_flow/My-Flow-v1.0.0.json << 'EOF'
[
  {
    "id": "tab1",
    "type": "tab",
    "label": "My Flow v1.0.0"
  }
]
EOF

# 2. 等待自动更新（最多3分钟）
# 或者重启服务立即生效
```

### 2. 更新现有 Flow

```bash
# 1. 修改版本号（文件名和内容）
mv Home-Automation-v1.0.1.json Home-Automation-v1.0.2.json

# 2. 更新 tab label
# "label": "Home Automation v1.0.2"

# 3. 等待自动更新
```

### 3. 手动上传 Flow

```bash
curl -X POST http://localhost:3000/api/nodered/nodered/upload \
  -H "Content-Type: application/json" \
  -d '{
    "flowData": [...],
    "filename": "my-flow.json"
  }'
```

## 日志监控

查看自动更新日志：

```bash
tail -f logs/startup.log | grep "Node-RED"
```

典型日志输出：

```
[Node-RED] Starting auto-update check...
[Node-RED] Auto-update check started (interval: 180 seconds)
[Node-RED] Checking for flow updates...
[Node-RED] Flow "Home Automation" not found in Node-RED, adding...
[Node-RED] Successfully added flow "Home Automation" v1.0.1
[Node-RED] Local flow "Home Automation" (v1.0.2) is newer, updating...
[Node-RED] Successfully updated flow "Home Automation" to v1.0.2
```

## 故障排查

### 自动更新不工作

1. **检查配置**
   ```bash
   grep autoUpdate modules/nodered/config.json
   # 应该显示 "autoUpdate": true
   ```

2. **检查日志**
   ```bash
   tail -f logs/startup.log | grep -i error
   ```

3. **检查凭据**
   - 确保 Node-RED 凭据已配置
   - 测试连接：`POST /api/nodered/nodered/test`

4. **检查目录权限**
   ```bash
   ls -la data/agent_flow/
   ```

### 版本号不识别

- ✅ 正确：`"Home Automation v1.0.1"`
- ✅ 正确：`Home-Automation-v1.0.1.json`
- ❌ 错误：`"Home Automation 1.0"` （缺少 patch 版本）
- ❌ 错误：`Home-Automation.json` （没有版本号）

### Flow 更新失败

1. 检查 Node-RED 服务状态
2. 验证 flow 格式：`POST /api/nodered/nodered/validate`
3. 查看详细错误日志

## 测试

运行自动更新功能测试：

```bash
node test-nodered-auto-update.js
```

预期输出：

```
🧪 Starting Node-RED Auto-Update Tests
✅ PASS: Extract version from tab label
✅ PASS: Version comparison
✅ PASS: Flow matching
📊 Test Results: 17 passed, 0 failed
🎉 All tests passed!
```

## 安全注意事项

1. **认证**：确保 Node-RED 启用了认证
2. **备份**：建议启用 `autoBackup` 功能
3. **权限**：限制 `/data/agent_flow/` 目录的写入权限
4. **版本控制**：建议使用 git 管理 flow 文件

## 依赖

- Node.js >= 14
- Node-RED >= 1.0
- 网络访问到 Node-RED 服务

## 许可

MIT License

## 更新日志

### v1.1.0 (最新)
- ✨ 新增自动更新检查功能
- ✨ 支持版本号智能对比
- ✨ 自动添加缺失的 flow
- ✨ 可配置更新检查间隔

### v1.0.0
- ✅ Flow 上传和部署
- ✅ Flow 验证
- ✅ 备份和恢复
- ✅ 连接测试


