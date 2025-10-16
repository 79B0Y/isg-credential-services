# Credential Service 安装指南

## 📦 安装包信息

- **文件名**: `credential-service-clean-v1.0.0.tar.gz`
- **大小**: 124KB
- **文件数量**: 70个文件
- **版本**: 1.0.0

## 🚀 快速安装

### 1. 解压安装包
```bash
tar -xzf credential-service-clean-v1.0.0.tar.gz
cd credential-service-clean-v1.0.0
```

### 2. 安装依赖
```bash
npm install
```

### 3. 启动服务
```bash
npm start
```

### 4. 访问Web界面
打开浏览器访问: `http://localhost:3000`

## 🎛️ 管理工具

### 服务管理脚本
```bash
# 启动服务
./manage-service.sh start

# 停止服务
./manage-service.sh stop

# 重启服务
./manage-service.sh restart

# 检查状态
./manage-service.sh status

# 查看版本
./manage-service.sh version

# 查询模块状态
./manage-service.sh modules

# 卸载服务
./manage-service.sh uninstall
```

### CLI工具
```bash
# 显示帮助
node cli.js help

# 列出所有模块
node cli.js modules

# 验证模块凭据
node cli.js validate telegram

# 测试模块连接
node cli.js test-connection telegram
```

## 📋 支持的模块

- **OpenAI**: Chat completions, audio transcription
- **Google Gemini**: Chat completions, multi-modal capabilities  
- **Claude**: Chat completions and content generation
- **Home Assistant**: Device control, entity matching
- **Telegram**: Message sending, media handling
- **WhatsApp**: Message management

## 🔧 配置说明

1. 启动服务后，通过Web界面配置各模块的凭据
2. 每个模块都有独立的配置页面
3. 支持实时验证和连接测试
4. 所有凭据都经过加密存储

## 📞 技术支持

如有问题，请查看README.md文件或使用管理工具进行诊断。

## ✅ 安装完成

安装完成后，您将拥有一个完整的凭据管理服务，支持多种AI服务和智能家居平台。

