#!/bin/bash

# Clean Script for Release Preparation
echo "🧹 Cleaning project for release..."

# Remove node_modules
if [ -d "node_modules" ]; then
    echo "📦 Removing node_modules..."
    rm -rf node_modules
fi

# Remove package-lock.json
if [ -f "package-lock.json" ]; then
    echo "🔒 Removing package-lock.json..."
    rm -f package-lock.json
fi

# Clean sensitive data files
echo "🔐 Cleaning sensitive data files..."
find data/ -name ".key" -delete 2>/dev/null || true
find data/ -name "credentials.json" -delete 2>/dev/null || true

# Clean log files
echo "📝 Cleaning log files..."
find logs/ -name "*.log" -delete 2>/dev/null || true
rm -f *.log 2>/dev/null || true

# Clean temporary files
echo "🗑️ Cleaning temporary files..."
find . -name ".DS_Store" -delete 2>/dev/null || true
find . -name "*.tmp" -delete 2>/dev/null || true
find . -name "*.temp" -delete 2>/dev/null || true
find . -name "*.cache" -delete 2>/dev/null || true
find . -name "*.pid" -delete 2>/dev/null || true

# Clean IDE files
echo "💻 Cleaning IDE files..."
rm -rf .vscode/ 2>/dev/null || true
rm -rf .idea/ 2>/dev/null || true
find . -name "*.swp" -delete 2>/dev/null || true
find . -name "*.swo" -delete 2>/dev/null || true

# Clean backup files
echo "💾 Cleaning backup files..."
find . -name "*.bak" -delete 2>/dev/null || true
find . -name "*.backup" -delete 2>/dev/null || true

# Clean test coverage
echo "📊 Cleaning test coverage..."
rm -rf coverage/ 2>/dev/null || true
rm -rf .nyc_output/ 2>/dev/null || true

# Clean build artifacts
echo "🔨 Cleaning build artifacts..."
rm -rf dist/ 2>/dev/null || true
rm -rf build/ 2>/dev/null || true

# Create empty directories structure
echo "📁 Creating clean directory structure..."
mkdir -p data/{openai,gemini,claude,home_assistant,telegram,whatsapp}
mkdir -p logs
mkdir -p config

# Create empty credential templates
echo "📋 Creating credential templates..."
for service in openai gemini claude home_assistant telegram whatsapp; do
    cat > "data/$service/credentials.json" << EOF
{
  "_comment": "Add your $service credentials here",
  "_example": "See README.md for configuration examples"
}
EOF
done

# Create basic config files
echo "⚙️ Creating basic config files..."
if [ ! -f "config/environment.json" ]; then
    cat > config/environment.json << EOF
{
  "port": 3000,
  "host": "0.0.0.0",
  "environment": "production"
}
EOF
fi

if [ ! -f "config/global.json" ]; then
    cat > config/global.json << EOF
{
  "service_name": "credential-service",
  "version": "1.0.0",
  "description": "Modular credential management service"
}
EOF
fi

# Make scripts executable
echo "🔧 Making scripts executable..."
chmod +x install.sh
chmod +x start.sh
chmod +x manage-service.sh
chmod +x prepare-release.sh

echo ""
echo "✅ Project cleaned successfully!"
echo ""
echo "📦 Ready for release. To install dependencies:"
echo "   npm install"
echo ""
echo "🚀 To start the service:"
echo "   npm start"
echo ""
echo "📖 Access the web interface at:"
echo "   http://localhost:3000"
echo ""
