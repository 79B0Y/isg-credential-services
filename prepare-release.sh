#!/bin/bash

# Release Preparation Script
echo "🚀 Preparing release..."

# Get current version
VERSION=$(node -p "require('./package.json').version")
echo "📦 Current version: $VERSION"

# Clean project first
echo "🧹 Cleaning project..."
./clean-for-release.sh

# Run basic validation
echo "🔍 Validating project structure..."
if [ ! -f "package.json" ]; then
    echo "❌ package.json not found"
    exit 1
fi

if [ ! -f "server.js" ]; then
    echo "❌ server.js not found"
    exit 1
fi

if [ ! -d "core" ]; then
    echo "❌ core directory not found"
    exit 1
fi

if [ ! -d "modules" ]; then
    echo "❌ modules directory not found"
    exit 1
fi

if [ ! -d "public" ]; then
    echo "❌ public directory not found"
    exit 1
fi

echo "✅ Project structure validation passed"

# Create release archive
echo "📦 Creating release archive..."
ARCHIVE_NAME="credential-service-v$VERSION.tar.gz"

tar -czf "$ARCHIVE_NAME" \
    --exclude=node_modules \
    --exclude=.git \
    --exclude=*.log \
    --exclude=.DS_Store \
    --exclude=coverage \
    --exclude=.nyc_output \
    --exclude=dist \
    --exclude=build \
    --exclude=.vscode \
    --exclude=.idea \
    .

# Check archive size
ARCHIVE_SIZE=$(du -h "$ARCHIVE_NAME" | cut -f1)
echo "📊 Archive size: $ARCHIVE_SIZE"

# Create installation instructions
echo "📝 Creating installation instructions..."
cat > "INSTALL.md" << EOF
# Installation Instructions

## Quick Start

1. **Extract the archive:**
   \`\`\`bash
   tar -xzf credential-service-v$VERSION.tar.gz
   cd credential-service
   \`\`\`

2. **Install dependencies:**
   \`\`\`bash
   npm install
   \`\`\`

3. **Start the service:**
   \`\`\`bash
   npm start
   \`\`\`

4. **Access the web interface:**
   Open http://localhost:3000 in your browser

## Configuration

Edit credential files in the \`data/\` directory for services you want to use:

- \`data/openai/credentials.json\` - OpenAI API key
- \`data/gemini/credentials.json\` - Google Gemini API key  
- \`data/claude/credentials.json\` - Claude API key
- \`data/home_assistant/credentials.json\` - Home Assistant token and URL
- \`data/telegram/credentials.json\` - Telegram bot token
- \`data/whatsapp/credentials.json\` - WhatsApp API credentials

## Service Management

- **Start:** \`npm start\` or \`./manage-service.sh start\`
- **Stop:** \`./manage-service.sh stop\`
- **Status:** \`./manage-service.sh status\`

## Documentation

Full documentation is available at http://localhost:3000 after starting the service.

## Requirements

- Node.js v16 or higher
- npm v7 or higher
EOF

echo ""
echo "✅ Release prepared successfully!"
echo ""
echo "📦 Release archive: $ARCHIVE_NAME ($ARCHIVE_SIZE)"
echo "📝 Installation guide: INSTALL.md"
echo ""
echo "📋 Next steps:"
echo "1. Test the archive on a clean system"
echo "2. Verify all dependencies install correctly"
echo "3. Test the web interface"
echo "4. Tag the release in git"
echo "5. Upload to distribution platform"
echo ""
echo "🧪 To test the release:"
echo "   tar -xzf $ARCHIVE_NAME"
echo "   cd credential-service"
echo "   npm install"
echo "   npm start"
echo ""
