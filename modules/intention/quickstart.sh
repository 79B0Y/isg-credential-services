#!/bin/bash

# Intention Module Quick Start Guide

echo "🎯 Intention Module - Quick Start"
echo "=================================="
echo ""

# Check if server is running
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "✅ Server is running"
    echo ""
    echo "📍 Web Interface:"
    echo "   http://localhost:3000/intention-api-docs.html"
    echo ""
    echo "🧪 Test API:"
    echo '   curl -X POST http://localhost:3000/api/intention/intention/process \\'
    echo '     -H "Content-Type: application/json" \\'
    echo '     -d '"'"'{"type":"message","content":"打开所有灯","metadata":{},"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"}'\'
    echo ""
    echo "📚 More examples in modules/intention/README.md"
else
    echo "❌ Server is not running"
    echo ""
    echo "To start the server:"
    echo "   node server.js"
    echo ""
    echo "After starting, access:"
    echo "   http://localhost:3000/intention-api-docs.html"
fi

echo ""
echo "📖 Documentation: modules/intention/README.md"

