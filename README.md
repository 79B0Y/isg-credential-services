# Credential Service

A comprehensive credential management service with support for multiple AI services, smart home integration, and messaging platforms.

## 🚀 Features

- **🔐 Credential Management**: Secure storage and management for various services
- **🤖 AI Integration**: Support for OpenAI, Google Gemini, and Claude
- **🏠 Smart Home**: Home Assistant integration with intelligent device matching
- **📱 Messaging**: Telegram and WhatsApp integration with WebSocket support
- **⚡ High Performance**: Caching system for fast API responses
- **🌐 Web Interface**: Complete web-based management and API documentation
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

### Configuration

1. **Create data directories**
   ```bash
   mkdir -p data/{openai,gemini,claude,home_assistant,telegram,whatsapp}
   mkdir -p logs
   ```

2. **Configure credentials for each service you want to use**

   **OpenAI Example** (`data/openai/credentials.json`):
   ```json
   {
     "api_key": "sk-your-openai-api-key-here"
   }
   ```

   **Home Assistant Example** (`data/home_assistant/credentials.json`):
   ```json
   {
     "access_token": "your-home-assistant-long-lived-token",
     "base_url": "http://your-ha-instance:8123"
   }
   ```

   **Telegram Example** (`data/telegram/credentials.json`):
   ```json
   {
     "bot_token": "your-telegram-bot-token",
     "chat_id": "your-chat-id"
   }
   ```

   **Google Gemini Example** (`data/gemini/credentials.json`):
   ```json
   {
     "api_key": "your-gemini-api-key"
   }
   ```

## 🎮 Usage

### Web Interface

Visit `http://localhost:3000` to access the main dashboard where you can:

- ✅ View service status
- 🔧 Manage credentials
- 📚 Access API documentation
- 🧪 Test APIs interactively

### API Documentation

Each service has dedicated API documentation:

- **Home Assistant**: `http://localhost:3000/home-assistant-api-docs.html`
- **OpenAI**: `http://localhost:3000/openai-api-docs.html`
- **Gemini**: `http://localhost:3000/gemini-api-docs.html`

### Service Management

Use the included management script:

```bash
# Start service
./manage-service.sh start

# Stop service
./manage-service.sh stop

# Restart service
./manage-service.sh restart

# Check status
./manage-service.sh status
```

## 🔌 API Examples

### Home Assistant Device Control

```bash
# Match devices based on intent
curl -X POST http://localhost:3000/api/home_assistant/home_assistant/match-control-devices \
  -H "Content-Type: application/json" \
  -d '{
    "intent": "Control Device",
    "devices": [{
      "room_name": "Living Room",
      "device_type": "light",
      "device_name": "灯",
      "action": "关掉"
    }]
  }'

# Get enhanced states with caching
curl http://localhost:3000/api/home_assistant/home_assistant/enhanced-states
```

### OpenAI Integration

```bash
# Chat completion
curl -X POST http://localhost:3000/api/openai/openai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ]
  }'

# Audio transcription
curl -X POST http://localhost:3000/api/openai/openai/transcribe \
  -F "audio=@audio.mp3"
```

### Telegram WebSocket

```javascript
// Connect to Telegram message stream
const ws = new WebSocket('ws://localhost:3000/telegram/messages');
ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('New message:', message);
});
```

## ⚡ Performance Features

### Caching System

The Home Assistant module includes an intelligent caching system:

- **Automatic Updates**: Cache refreshes every minute
- **Fast Responses**: API calls respond in ~1ms from cache
- **Cache Monitoring**: `/api/home_assistant/home_assistant/cache-status`

### WebSocket Support

Real-time message streaming for:
- Telegram message updates
- Live service monitoring

## 🧪 Development

### Running Tests

```bash
npm test
```

### Project Structure

```
credential-service/
├── core/                 # Core framework
├── modules/             # Service modules
│   ├── openai/         # OpenAI integration
│   ├── gemini/         # Google Gemini
│   ├── home_assistant/ # Smart home control
│   ├── telegram/       # Telegram messaging
│   └── ...
├── public/             # Web interface
├── tests/              # Test suite
├── config/             # Global configuration
└── data/               # Runtime data (gitignored)
```

### Adding New Services

1. Create a new module in `modules/your-service/`
2. Extend `BaseCredentialModule`
3. Define JSON schema for credentials
4. Add API routes in `server.js`
5. Create documentation in `public/`

## 🔒 Security

- **Credential Isolation**: Each service stores credentials separately
- **No Logging**: Sensitive data is never logged
- **Local Storage**: All credentials stored locally
- **API Key Protection**: Built-in API key validation

## 🐛 Troubleshooting

### Common Issues

1. **Port 3000 in use**
   ```bash
   # Change port in config/environment.json
   {"port": 3001}
   ```

2. **Service not responding**
   ```bash
   # Check logs
   tail -f logs/service.log
   
   # Restart service
   ./manage-service.sh restart
   ```

3. **Cache issues**
   ```bash
   # Check cache status
   curl http://localhost:3000/api/home_assistant/home_assistant/cache-status
   ```

### Logs

- **Service logs**: `logs/service.log`
- **Startup logs**: `logs/startup.log`
- **Module logs**: Individual module logging

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

[Add your license here]

## 🆘 Support

- **Issues**: [GitHub Issues](link-to-issues)
- **Documentation**: Built-in web documentation
- **API Reference**: Available at `/api-docs` endpoints

---

## 🚀 Quick Setup Examples

### OpenAI + Home Assistant Setup

1. **Install and start**
   ```bash
   npm install && npm start
   ```

2. **Configure OpenAI**
   ```bash
   echo '{"api_key":"sk-your-key"}' > data/openai/credentials.json
   ```

3. **Configure Home Assistant**
   ```bash
   echo '{"access_token":"your-token","base_url":"http://ha:8123"}' > data/home_assistant/credentials.json
   ```

4. **Test integration**
   ```bash
   curl http://localhost:3000/api/home_assistant/home_assistant/enhanced-states
   ```

### Node-RED Integration

Connect to Telegram WebSocket for real-time automation:

```javascript
// In Node-RED function node
msg.url = 'ws://localhost:3000/telegram/messages';
return msg;
```

---

**Ready to use!** 🎉 Visit `http://localhost:3000` to get started.
