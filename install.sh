#!/bin/bash

# Credential Service Installation Script
echo "🚀 Installing Credential Service..."

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v16 or higher."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "❌ Node.js version $NODE_VERSION detected. Please upgrade to v16 or higher."
    exit 1
fi

echo "✅ Node.js version $(node -v) detected"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Create required directories
echo "📁 Creating required directories..."
mkdir -p data/{openai,gemini,claude,home_assistant,telegram,whatsapp}
mkdir -p logs
mkdir -p config

# Copy example configuration files
echo "📋 Setting up configuration examples..."
if [ ! -f "config/environment.json" ]; then
    echo '{"port": 3000, "host": "localhost"}' > config/environment.json
fi

if [ ! -f "config/global.json" ]; then
    echo '{"service_name": "credential-service", "version": "1.0.0"}' > config/global.json
fi

# Create example credential files (empty templates)
echo "🔐 Creating credential file templates..."

# Create empty credential files with comments
for service in openai gemini claude home_assistant telegram whatsapp; do
    if [ ! -f "data/$service/credentials.json" ]; then
        cat > "data/$service/credentials.json" << EOF
{
  "_comment": "Add your $service credentials here",
  "_example": "See README.md for configuration examples"
}
EOF
    fi
done

# Make scripts executable
chmod +x manage-service.sh
chmod +x start.sh

echo ""
echo "🎉 Installation completed successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Edit credential files in the data/ directory for services you want to use"
echo "2. Start the service with: npm start"
echo "3. Visit http://localhost:3000 to access the web interface"
echo ""
echo "📚 Configuration files to edit:"
echo "   • data/openai/credentials.json (for OpenAI integration)"
echo "   • data/home_assistant/credentials.json (for Home Assistant)"
echo "   • data/telegram/credentials.json (for Telegram)"
echo "   • data/gemini/credentials.json (for Google Gemini)"
echo "   • data/claude/credentials.json (for Claude)"
echo ""
echo "🔧 Service management:"
echo "   • Start: npm start or ./manage-service.sh start"
echo "   • Stop: ./manage-service.sh stop"
echo "   • Status: ./manage-service.sh status"
echo ""
echo "📖 Documentation: http://localhost:3000 (after starting)"
echo ""
