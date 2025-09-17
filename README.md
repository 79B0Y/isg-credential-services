# Credential Service

A comprehensive credential management service with support for multiple AI services, smart home integration, and messaging platforms.

## 🚀 Features

- **🔐 Credential Management**: Secure storage and management for various services
- **🤖 AI Integration**: Support for OpenAI, Google Gemini, and Claude
- **🏠 Smart Home**: Home Assistant integration with intelligent device matching
- **📱 Messaging**: Telegram and WhatsApp integration with WebSocket support
- **⚡ High Performance**: Caching system for fast API responses
- **🌐 Web Interface**: Complete web-based management
- **📊 Real-time Monitoring**: Service status and cache monitoring

## 📋 Supported Services

### AI Services
- **OpenAI**: Chat completions, audio transcription (Whisper), model management
- **Google Gemini**: Chat completions, multi-modal capabilities, model management
- **Claude**: Chat completions and content generation

### Smart Home
- **Home Assistant**: Device control, entity matching, enhanced state data with caching

### Messaging
- **Telegram**: Message sending, media handling, WebSocket streaming
- **WhatsApp**: Message management and integration

## 🛠️ Installation

### Prerequisites

- **Node.js** (v16 or higher)
- **npm** (v7 or higher)

### Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd credential-service
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the service**
   ```bash
   npm start
   ```

4. **Access the web interface**
   ```
   http://localhost:3000
   ```

## 🎛️ Management & CLI Tools

### Service Management Script

The `manage-service.sh` script provides comprehensive service management:

```bash
# 启动服务
./manage-service.sh start

# 停止服务
./manage-service.sh stop

# 重启服务
./manage-service.sh restart

# 检查服务状态
./manage-service.sh status

# 查看服务日志
./manage-service.sh logs

# 测试服务功能
./manage-service.sh test

# 清理端口占用
./manage-service.sh clean

# 显示版本信息
./manage-service.sh version

# 卸载服务
./manage-service.sh uninstall

# 查询模块状态
./manage-service.sh modules

# 显示帮助信息
./manage-service.sh help
```

### CLI Tool

The `cli.js` provides a command-line interface for advanced management:

```bash
# 显示服务状态
node cli.js status

# 列出所有模块
node cli.js modules

# 显示特定模块信息
node cli.js module telegram

# 启用/禁用模块
node cli.js enable telegram
node cli.js disable telegram

# 验证模块凭据
node cli.js validate telegram

# 测试模块连接
node cli.js test-connection telegram

# 获取模块凭据
node cli.js credentials telegram

# 重载模块
node cli.js reload telegram

# 健康检查
node cli.js health

# 显示版本信息
node cli.js version
```

### NPM Scripts

Convenient npm scripts for common operations:

```bash
# CLI commands
npm run cli                    # Open CLI help
npm run cli:modules           # List all modules
npm run cli:status            # Show service status
npm run cli:health            # Health check
npm run cli:version           # Show version info

# Service management
npm run status                # Check service status
npm run stop                  # Stop service
npm run restart               # Restart service
```

## 📝 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
