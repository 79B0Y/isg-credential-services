# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Running the Service
```bash
npm start              # Start the main service
npm run dev            # Start in development mode
npm run health         # Check service health
```

### Testing
```bash
npm test               # Run full test suite
npm run test:telegram  # Test Telegram module specifically
npm run test:quick     # Skip integration tests
npm run test:parallel  # Run tests in parallel
npm run test:module    # Test specific modules (append module name)
```

### Service Management
```bash
./manage-service.sh start     # Start service with monitoring
./manage-service.sh stop      # Stop service
./manage-service.sh restart   # Restart service
./manage-service.sh status    # Check service status
./manage-service.sh logs      # View service logs
```

## Architecture Overview

### Core Framework
- **BaseCredentialModule** (`core/BaseCredentialModule.js`): Abstract base class that all service modules extend
- **ModuleManager** (`core/ModuleManager.js`): Handles module lifecycle, loading, and coordination
- **ConfigManager** (`core/ConfigManager.js`): Centralized configuration management with environment support

### Modular Design
Each service integration is implemented as a module in `/modules/[service]/`:
- **Module Implementation**: `[Service]Module.js` extends BaseCredentialModule
- **Configuration**: `config.json` defines module settings
- **Schema**: `schema.json` defines credential validation rules

### Key Service Modules
- **OpenAI**: Chat completions, audio transcription (Whisper), model management
- **Google Gemini**: Chat completions, multi-modal AI capabilities  
- **Claude**: Chat completions and content generation
- **Home Assistant**: Device control with intelligent entity matching and caching
- **Telegram**: Messaging, media handling, WebSocket streaming, polling/webhook modes
- **WhatsApp**: Message management integration

### Data Storage & Security
- Credentials stored in `/data/[module]/credentials.json`
- Automatic encryption for sensitive data using module-specific keys
- Validation caching to improve performance
- Structured logging with module isolation

## API Architecture

### REST API Pattern
All modules follow consistent API patterns:
```
GET    /api/[module]/[module]/[endpoint]     # Data retrieval
POST   /api/[module]/[module]/[endpoint]     # Actions/commands
PUT    /api/credentials/[module]             # Update credentials
DELETE /api/cache/[module]                   # Clear cache
```

### Home Assistant Integration
Advanced device matching with caching:
- `POST /api/home_assistant/home_assistant/match-control-devices` - Intent-based device control
- `GET /api/home_assistant/home_assistant/enhanced-states` - Cached state with area/device metadata
- `GET /api/home_assistant/home_assistant/cache-status` - Monitor caching performance

### Real-time Features
- **Telegram WebSocket**: Live message streaming at `/telegram/messages`
- **Home Assistant Caching**: Automatic 1-minute refresh cycle for ~1ms API responses
- **Service Monitoring**: Real-time status dashboard

## Development Guidelines

### Adding New Service Modules
1. Create module directory: `modules/[service]/`
2. Extend BaseCredentialModule in `[Service]Module.js`
3. Define `schema.json` for credential validation
4. Add API routes in `server.js` following existing patterns
5. Create web documentation in `public/[service]-api-docs.html`

### Testing
The project uses a custom test framework:
- `TestRunner.js` orchestrates all module tests
- Each module can have dedicated test files like `TelegramModuleTest.js`
- Tests support integration testing with real APIs
- Use `npm run test:quick` for rapid iteration

### Configuration Management
- Global config in `config/global.json`
- Environment-specific overrides in `config/environment.json`
- Module-specific config in `modules/[module]/config.json`
- Runtime data storage in `data/[module]/` (gitignored)

### Credential Handling
- Never log sensitive credentials
- Use module's built-in encryption for sensitive data
- Validate credentials against JSON schemas
- Implement `testConnection()` methods for connectivity verification

### WebSocket Integration
For real-time features:
- Telegram module provides WebSocket server for message streaming
- Home Assistant uses intelligent caching to provide near-instant responses
- WebSocket endpoints follow pattern: `ws://localhost:3000/[module]/[stream]`

## Performance Considerations

### Caching Strategy
- Home Assistant implements sophisticated state caching (1-minute refresh)
- Validation results are cached to avoid redundant API calls
- Cache management APIs available for all modules

### Node-RED Integration
Designed for Node-RED compatibility:
- RESTful API endpoints for all operations
- WebSocket streams for real-time data
- Consistent response formats across modules
- Service discovery via `/api/modules` endpoint

### Mobile/Termux Support
- Configured for Android Termux compatibility
- Lightweight dependencies and efficient resource usage
- Local-first architecture reduces external dependencies