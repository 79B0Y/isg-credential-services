# Installation Instructions

## Quick Start

1. **Extract the archive:**
   ```bash
   tar -xzf credential-service-v1.0.0.tar.gz
   cd credential-service
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the service:**
   ```bash
   npm start
   ```

4. **Access the web interface:**
   Open http://localhost:3000 in your browser

## Configuration

Edit credential files in the `data/` directory for services you want to use:

- `data/openai/credentials.json` - OpenAI API key
- `data/gemini/credentials.json` - Google Gemini API key  
- `data/claude/credentials.json` - Claude API key
- `data/home_assistant/credentials.json` - Home Assistant token and URL
- `data/telegram/credentials.json` - Telegram bot token
- `data/whatsapp/credentials.json` - WhatsApp API credentials

## Service Management

- **Start:** `npm start` or `./manage-service.sh start`
- **Stop:** `./manage-service.sh stop`
- **Status:** `./manage-service.sh status`

## Documentation

Full documentation is available at http://localhost:3000 after starting the service.

## Requirements

- Node.js v16 or higher
- npm v7 or higher
