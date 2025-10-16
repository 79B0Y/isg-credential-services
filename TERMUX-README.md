# Termux 环境安装指南

## 问题诊断

在 Termux proot Ubuntu 环境中运行时出现 `double free or corruption (out)` 错误，这通常是由于：

1. **内存管理问题**: Node.js 在 Android 环境中的内存管理与标准 Linux 不同
2. **大量 Map/Set 对象**: Home Assistant 模块处理大数据集时创建大量映射对象
3. **垃圾回收不当**: 在内存受限环境中垃圾回收不够及时

## 解决方案

### 1. 使用优化的启动方式

```bash
# 方案一：使用内置优化启动器
node --expose-gc --max-old-space-size=256 --optimize-for-size start-termux.js

# 方案二：使用环境变量启动
TERMUX_ENV=true NODE_ENV=production node --expose-gc --max-old-space-size=256 server.js
```

### 2. 内存调试模式

如果仍然出现问题，启用内存追踪：

```bash
node --expose-gc --max-old-space-size=256 start-termux.js --debug-memory
```

### 3. 环境变量配置

在 `.bashrc` 或启动脚本中添加：

```bash
export TERMUX_ENV=true
export NODE_ENV=production
export UV_THREADPOOL_SIZE=2
export NODE_OPTIONS="--expose-gc --max-old-space-size=256 --optimize-for-size"
```

## 优化措施

### 已实施的内存优化

1. **显式内存清理**: Home Assistant 模块现在会主动清理大型 Map 对象
2. **内存使用监控**: 添加详细的内存使用日志
3. **分阶段对象创建**: 避免同时创建大量对象
4. **强制垃圾回收**: 在关键点触发 GC

### 调试日志说明

启动后会看到以下类型的日志：

```
[MEMORY] 开始创建查找映射 - entities: 269, devices: 45, rooms: 12, floors: 2
[MEMORY] entityMap 创建完成, 大小: 269
[MEMORY] deviceMap 创建完成, 大小: 45
[MEMORY] 映射创建后内存使用: 85MB
[MEMORY] 清理 entityMap, 大小: 269
[MEMORY] 清理后内存使用: 78MB
[MEMORY] 已触发垃圾回收
```

## 故障排除

### 1. 如果仍然崩溃

1. 降低内存限制：
```bash
node --expose-gc --max-old-space-size=128 start-termux.js
```

2. 启用详细调试：
```bash
node --expose-gc --max-old-space-size=256 start-termux.js --debug-memory
```

### 2. 性能问题

- 增加垃圾回收频率：修改 `start-termux.js` 中的 `setInterval(gc, 60000)` 为更小值
- 减少缓存时间：修改 Home Assistant 模块的缓存间隔

### 3. 内存泄漏检测

使用内存追踪器：

```javascript
// 在 node REPL 中
global.memoryTracker.analyze()
```

## 性能建议

### Termux 环境优化

1. **内存管理**:
   ```bash
   # 设置较小的堆内存限制
   export NODE_OPTIONS="--max-old-space-size=256"
   ```

2. **进程优先级**:
   ```bash
   # 提高进程优先级（需要 root）
   renice -10 $$
   ```

3. **系统配置**:
   ```bash
   # 增加文件描述符限制
   ulimit -n 1024
   ```

### 监控脚本

创建监控脚本 `monitor.sh`：

```bash
#!/bin/bash
while true; do
    echo "=== $(date) ==="
    ps aux | grep node
    echo "内存使用:"
    free -h
    echo "=================="
    sleep 30
done
```

## 已知限制

1. **内存限制**: 在 Termux 环境中建议不超过 256MB 堆内存
2. **并发限制**: 线程池大小限制为 2
3. **缓存限制**: Home Assistant 缓存间隔增加到 120 秒

## 已应用的修复

### Telegram模块优化
- **防重复启动**: 添加 `hasAutoStarted` 和 `isInitializing` 标志防止重复自动启动
- **轮询超时优化**: Termux环境下轮询超时从25秒降到10秒
- **内存清理**: 消息历史在Termux环境下限制为100条（原1000条）
- **WebSocket禁用**: 在proot环境下自动禁用WebSocket以避免内存问题

### OpenAI模块优化
- **文件大小限制**: Termux环境下音频文件限制为10MB（原25MB）
- **内存安全**: 添加buffer创建错误处理和FormData清理
- **下载保护**: 添加文件大小检查和内存溢出保护

### 系统级优化
- **环境检测**: 自动检测Termux和proot环境
- **内存管理**: 定期强制垃圾回收
- **启动优化**: 提供专用的 `start-termux.js` 启动器

## 使用建议

### 启动Telegram轮询
```bash
# 使用优化启动器（推荐）
node --expose-gc start-termux.js

# 手动控制轮询
curl -X POST http://localhost:3000/api/telegram/telegram/start-polling
curl -X POST http://localhost:3000/api/telegram/telegram/stop-polling
```

### 监控内存使用
```bash
# 查看实时内存使用（每分钟输出）
grep "Memory usage" <(tail -f logfile.log)

# 查看Telegram轮询状态
curl http://localhost:3000/api/telegram/telegram/polling-status
```

## 更新日志

- **v1.0.2**: 修复内存泄漏和重复启动问题，优化Termux环境支持
- **v1.0.1**: 添加 Termux 环境检测和内存优化
- **v1.0.0**: 初始版本，基本功能