#!/bin/bash

# Prepare Release Script for Credential Service
echo "🚀 Preparing Credential Service for release..."

# Clean up any leftover files
echo "🧹 Cleaning up..."
rm -rf node_modules/
rm -rf logs/
rm -rf data/*/credentials.json
rm -f *.log
rm -f *.pid
rm -f debug-*.js test-*.js monitor-*.js quick-*.js
rm -f .DS_Store

# Create required directories
echo "📁 Creating directory structure..."
mkdir -p data/{openai,gemini,claude,home_assistant,telegram,whatsapp}
mkdir -p logs

# Test installation process
echo "🧪 Testing installation..."
npm install --production

if [ $? -ne 0 ]; then
    echo "❌ Installation test failed"
    exit 1
fi

# Clean up test installation
rm -rf node_modules/

echo "📦 Package contents:"
find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | sort

echo ""
echo "✅ Release preparation completed!"
echo ""
echo "📝 Ready for GitHub:"
echo "1. All test files removed"
echo "2. Runtime data cleaned"
echo "3. Example configurations created"
echo "4. Installation script ready"
echo ""
echo "🔗 To publish:"
echo "   git add ."
echo "   git commit -m 'Release: Clean credential service package'"
echo "   git push origin main"
echo ""
