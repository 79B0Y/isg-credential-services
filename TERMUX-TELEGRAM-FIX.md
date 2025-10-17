# Termux 环境 Telegram 连接问题修复

## 诊断结果

✅ **TLS 连接正常**：OpenSSL 测试成功，证书验证通过
- 协议: TLSv1.3
- 加密: TLS_AES_256_GCM_SHA384  
- 证书: 有效

## 已实施的优化

### 1. 简化 HTTPS 配置

移除了可能导致兼容性问题的选项：
- `agent: false`
- `family: 4`
- `Connection: 'close'`
- `secureOptions`
- `minVersion/maxVersion`

保留必要配置：
- `servername`: SNI 支持
- `rejectUnauthorized: true`: 严格证书验证

### 2. 增强重试策略

- **重试次数**: 3 → 5 次
- **超时时间**: 35s → 45s
- **轮询间隔**: 2s → 3s
- **重试延迟**: 指数退避 (1s, 2s, 4s, 8s, 16s)

### 3. 扩展错误处理

添加了 Termux 环境常见的错误类型：
- `EPROTO` - TLS/SSL 协议错误
- `socket disconnected` - Socket 断开
- `secure TLS connection` - TLS 连接失败

## 测试步骤

### 在 Termux 环境中运行：

```bash
cd /root/isg-credential-services

# 1. 测试 Node.js 的 HTTPS 连接
node test-telegram-connection.js YOUR_BOT_TOKEN

# 2. 如果测试成功，重启服务
./manage-service.sh restart

# 3. 监控日志
tail -f logs/telegram.log
```

## 测试脚本说明

`test-telegram-connection.js` 会测试三种配置：
1. **基础配置** - 最简单的 HTTPS 请求
2. **添加 SNI** - 包含服务器名称指示
3. **禁用证书验证** - 如果证书有问题

## 预期结果

如果测试成功，你会看到：

```
✅ 成功! (XXXms)
Bot: YourBotName (@yourbotusername)
状态码: 200
TLS 版本: TLSv1.3
加密套件: TLS_AES_256_GCM_SHA384
```

## 如果仍然失败

### 方案 1：使用环境变量

```bash
# 设置 Node.js 网络选项
export NODE_OPTIONS="--dns-result-order=ipv4first"
export UV_THREADPOOL_SIZE=16

# 重启服务
./manage-service.sh restart
```

### 方案 2：检查系统资源

```bash
# 检查内存
free -h

# 检查网络连接数
netstat -anp | grep node | wc -l

# 如果连接数过多，重启服务
./manage-service.sh restart
```

### 方案 3：使用 HTTP 代理

如果 HTTPS 持续失败，可以考虑使用 HTTP 代理：

```bash
# 安装 proxy
npm install -g http-proxy

# 启动本地代理
http-proxy --port 8888 --target https://api.telegram.org
```

然后修改配置使用代理。

## 常见问题

### Q: 为什么有时能连接，有时不能？

A: 可能原因：
- 移动网络不稳定
- Android 系统的后台限制
- Termux 的资源限制

**解决方案**: 
- 使用 WiFi 而不是移动数据
- 将 Termux 加入白名单，避免被系统杀死
- 定期重启服务

### Q: 轮询频率应该设置多少？

A: 建议配置：
- WiFi 环境: 2-3 秒
- 移动数据: 5-10 秒
- 省电模式: 30 秒或使用 Webhook

### Q: 如何减少内存使用？

A: 在 `config.json` 中：
```json
{
  "maxMessageHistory": 50,
  "cacheTimeout": 600000,
  "pollingInterval": 5000
}
```

## 下一步

如果问题解决，可以考虑：

1. **启用自动重启**
   ```bash
   # 添加到 crontab
   */30 * * * * cd /root/isg-credential-services && ./manage-service.sh status || ./manage-service.sh restart
   ```

2. **配置日志轮转**
   ```bash
   # 防止日志文件过大
   find logs/ -name "*.log" -size +100M -delete
   ```

3. **设置监控告警**
   使用 Telegram Bot 本身来发送服务状态通知

