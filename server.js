const express = require('express');
const path = require('path');
const cors = require('cors');

// 核心组件
const ModuleManager = require('./core/ModuleManager');
const ConfigManager = require('./core/ConfigManager');

/**
 * CredentialService - 主服务器
 * 提供RESTful API和Web管理界面
 */
class CredentialService {
    constructor() {
        this.app = express();
        this.server = null;
        this.moduleManager = null;
        this.configManager = null;
        
        // 中间件状态
        this.middlewareEnabled = {
            auth: false,
            rateLimit: false,
            cors: true
        };
        
        // 日志系统
        this.logger = this.createLogger();
        
        // 初始化标志
        this.initialized = false;
    }

    /**
     * 初始化服务
     */
    async initialize() {
        try {
            this.logger.info('Initializing Credential Service...');
            
            // 初始化配置管理器
            this.configManager = new ConfigManager();
            await this.configManager.initialize();
            
            // 初始化模块管理器
            this.moduleManager = new ModuleManager();
            await this.moduleManager.initialize();
            
            // 设置Express应用
            this.setupMiddleware();
            this.setupRoutes();
            this.setupErrorHandlers();
            
            this.initialized = true;
            this.logger.info('Credential Service initialized successfully');
            
            return { success: true, message: 'Service initialized' };
        } catch (error) {
            this.logger.error('Failed to initialize service:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 设置中间件
     */
    setupMiddleware() {
        // 基础中间件
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));
        
        // CORS中间件
        if (this.middlewareEnabled.cors) {
            const corsOptions = {
                origin: this.configManager.get('server.cors.origin', '*'),
                credentials: true,
                methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
                allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
            };
            this.app.use(cors(corsOptions));
        }
        
        // 请求日志中间件
        this.app.use((req, res, next) => {
            const start = Date.now();
            const originalSend = res.send;
            
            res.send = function(data) {
                const duration = Date.now() - start;
                console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
                originalSend.call(this, data);
            };
            
            next();
        });
        
        // API密钥认证中间件（可选启用）
        if (this.middlewareEnabled.auth) {
            this.app.use('/api', this.authMiddleware.bind(this));
        }
        
        // 静态文件服务
        this.app.use(express.static(path.join(__dirname, 'public')));
    }

    /**
     * 设置路由
     */
    setupRoutes() {
        // 健康检查
        this.app.get('/health', this.handleHealth.bind(this));
        this.app.get('/api/health', this.handleHealth.bind(this));
        
        // 模块管理API
        this.app.get('/api/modules', this.handleGetModules.bind(this));
        this.app.get('/api/modules/:name', this.handleGetModule.bind(this));
        this.app.put('/api/modules/:name/enabled', this.handleToggleModule.bind(this));
        this.app.post('/api/modules/:name/reload', this.handleReloadModule.bind(this));
        
        // 凭据管理API
        this.app.get('/api/credentials/:module', this.handleGetCredentials.bind(this));
        this.app.put('/api/credentials/:module', this.handleSetCredentials.bind(this));
        this.app.post('/api/credentials/batch', this.handleBatchGetCredentials.bind(this));
        
        // 验证API
        this.app.post('/api/validate/:module', this.handleValidateModule.bind(this));
        this.app.post('/api/validate-all', this.handleValidateAll.bind(this));
        this.app.post('/api/test-connection/:module', this.handleTestConnection.bind(this));
        
        // 缓存管理API
        this.app.delete('/api/cache/:module', this.handleClearCache.bind(this));
        this.app.delete('/api/cache', this.handleClearAllCaches.bind(this));
        
        // 系统信息API
        this.app.get('/api/status', this.handleGetStatus.bind(this));
        this.app.get('/api/statistics', this.handleGetStatistics.bind(this));
        
        // 配置管理API
        this.app.get('/api/config', this.handleGetConfig.bind(this));
        this.app.put('/api/config', this.handleSetConfig.bind(this));
        
        // Schema API
        this.app.get('/api/schema/:module', this.handleGetSchema.bind(this));
        
        // Telegram Messaging API
        this.app.post('/api/telegram/:module/polling/start', this.handleStartPolling.bind(this));
        this.app.post('/api/telegram/:module/polling/stop', this.handleStopPolling.bind(this));
        this.app.get('/api/telegram/:module/messages', this.handleGetMessages.bind(this));
        this.app.get('/api/telegram/:module/messages/:messageId', this.handleGetMessage.bind(this));
        this.app.delete('/api/telegram/:module/messages', this.handleClearMessages.bind(this));
        this.app.post('/api/telegram/:module/send/message', this.handleSendMessage.bind(this));
        this.app.post('/api/telegram/:module/send/photo', this.handleSendPhoto.bind(this));
        this.app.post('/api/telegram/:module/send/video', this.handleSendVideo.bind(this));
        this.app.post('/api/telegram/:module/send/voice', this.handleSendVoice.bind(this));
        this.app.post('/api/telegram/:module/send/document', this.handleSendDocument.bind(this));
        
        // Telegram WebSocket API
        this.app.post('/api/telegram/:module/websocket/start', this.handleStartTelegramWebSocket.bind(this));
        this.app.post('/api/telegram/:module/websocket/stop', this.handleStopTelegramWebSocket.bind(this));
        this.app.get('/api/telegram/:module/websocket/status', this.handleGetTelegramWebSocketStatus.bind(this));
        this.app.post('/api/telegram/:module/webhook/set', this.handleSetWebhook.bind(this));
        this.app.delete('/api/telegram/:module/webhook', this.handleRemoveWebhook.bind(this));
        this.app.get('/api/telegram/:module/webhook', this.handleGetWebhook.bind(this));
        this.app.post('/api/telegram/:module/webhook/receive', this.handleWebhookReceive.bind(this));
        this.app.get('/api/telegram/:module/file/:fileId', this.handleGetFile.bind(this));
        this.app.get('/api/telegram/:module/file-url/:fileId', this.handleGetFileUrl.bind(this));
        this.app.get('/api/telegram/:module/download/:fileId', this.handleDownloadFile.bind(this));
        
        // Home Assistant API
        this.app.get('/api/home_assistant/:module/states', this.handleGetHAStates.bind(this));
        this.app.get('/api/home_assistant/:module/enhanced-states', this.handleGetHAEnhancedStates.bind(this));
        this.app.get('/api/home_assistant/:module/config', this.handleGetHAConfig.bind(this));
        this.app.get('/api/home_assistant/:module/access-token', this.handleGetHAAccessToken.bind(this));
        this.app.post('/api/home_assistant/:module/test-connection', this.handleHATestConnection.bind(this));
        this.app.post('/api/home_assistant/:module/call-service', this.handleHACallService.bind(this));
        this.app.get('/api/home_assistant/:module/entities', this.handleGetHAEntities.bind(this));
        this.app.get('/api/home_assistant/:module/devices', this.handleGetHADevices.bind(this));
        this.app.get('/api/home_assistant/:module/rooms', this.handleGetHARooms.bind(this));
        this.app.get('/api/home_assistant/:module/floors', this.handleGetHAFloors.bind(this));
        this.app.get('/api/home_assistant/:module/entity-registry', this.handleGetHAEntityRegistry.bind(this));
        this.app.post('/api/home_assistant/:module/devices/search', this.handleSearchHADevices.bind(this));
        this.app.get('/api/home_assistant/:module/entity/:entityId', this.handleGetHAEntity.bind(this));
        this.app.post('/api/home_assistant/:module/entity/:entityId/turn_on', this.handleHATurnOn.bind(this));
        this.app.post('/api/home_assistant/:module/entity/:entityId/turn_off', this.handleHATurnOff.bind(this));
        this.app.post('/api/home_assistant/:module/entity/:entityId/set_state', this.handleHASetState.bind(this));
        this.app.post('/api/home_assistant/:module/match-devices', this.handleHAMatchDevices.bind(this));
        this.app.post('/api/home_assistant/:module/batch-control', this.handleHABatchControl.bind(this));
        this.app.post('/api/home_assistant/:module/match-entities', this.handleHAMatchEntities.bind(this));
        this.app.post('/api/home_assistant/:module/match-control-devices', this.handleHAMatchControlDevices.bind(this));
        this.app.get('/api/home_assistant/:module/cache-status', this.handleHACacheStatus.bind(this));

        // OpenAI API路由
        this.app.get('/api/openai/:module/models', this.handleGetOpenAIModels.bind(this));
        this.app.post('/api/openai/:module/test-connection', this.handleOpenAITestConnection.bind(this));
        this.app.post('/api/openai/:module/chat', this.handleOpenAIChat.bind(this));
        this.app.post('/api/openai/:module/simple-chat', this.handleOpenAISimpleChat.bind(this));
        this.app.post('/api/openai/:module/transcribe', this.handleOpenAITranscribe.bind(this));
        this.app.post('/api/openai/:module/transcribe-url', this.handleOpenAITranscribeUrl.bind(this));

        // Gemini API路由
        this.app.get('/api/gemini/:module/models', this.handleGetGeminiModels.bind(this));
        this.app.post('/api/gemini/:module/test-connection', this.handleGeminiTestConnection.bind(this));
        this.app.post('/api/gemini/:module/chat', this.handleGeminiChat.bind(this));
        this.app.post('/api/gemini/:module/simple-chat', this.handleGeminiSimpleChat.bind(this));
        
        // 主页路由
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
        
        // 404处理
        this.app.use('*', (req, res) => {
            res.status(404).json({
                success: false,
                error: 'Endpoint not found',
                path: req.originalUrl
            });
        });
    }

    /**
     * 设置错误处理器
     */
    setupErrorHandlers() {
        // 全局错误处理
        this.app.use((error, req, res, next) => {
            this.logger.error('Unhandled error:', error);
            
            if (res.headersSent) {
                return next(error);
            }
            
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        });
    }

    // =================
    // API处理器
    // =================

    // =================
    // Telegram Messaging API Handlers
    // =================

    /**
     * 开始消息轮询
     */
    async handleStartPolling(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.startPolling !== 'function') {
                return res.status(400).json({ success: false, error: 'Polling not supported by this module' });
            }
            
            const result = await module.startPolling();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 停止消息轮询
     */
    async handleStopPolling(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.stopPolling !== 'function') {
                return res.status(400).json({ success: false, error: 'Polling not supported by this module' });
            }
            
            const result = await module.stopPolling();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取消息历史
     */
    async handleGetMessages(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { limit = 50, offset = 0 } = req.query;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.getMessageHistory !== 'function') {
                return res.status(400).json({ success: false, error: 'Message history not supported by this module' });
            }
            
            const result = module.getMessageHistory(parseInt(limit), parseInt(offset));
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取特定消息
     */
    async handleGetMessage(req, res) {
        try {
            const { module: moduleName, messageId } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.getMessage !== 'function') {
                return res.status(400).json({ success: false, error: 'Message retrieval not supported by this module' });
            }
            
            const result = module.getMessage(parseInt(messageId));
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 清除消息历史
     */
    async handleClearMessages(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.clearMessageHistory !== 'function') {
                return res.status(400).json({ success: false, error: 'Message clearing not supported by this module' });
            }
            
            const result = module.clearMessageHistory();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 发送文本消息
     */
    async handleSendMessage(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { chat_id, text, options = {} } = req.body;
            
            if (!chat_id || !text) {
                return res.status(400).json({ success: false, error: 'chat_id and text are required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.sendMessage !== 'function') {
                return res.status(400).json({ success: false, error: 'Message sending not supported by this module' });
            }
            
            const result = await module.sendMessage(chat_id, text, options);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 发送图片
     */
    async handleSendPhoto(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { chat_id, photo, options = {} } = req.body;
            
            if (!chat_id || !photo) {
                return res.status(400).json({ success: false, error: 'chat_id and photo are required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.sendPhoto !== 'function') {
                return res.status(400).json({ success: false, error: 'Photo sending not supported by this module' });
            }
            
            const result = await module.sendPhoto(chat_id, photo, options);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 发送视频
     */
    async handleSendVideo(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { chat_id, video, options = {} } = req.body;
            
            if (!chat_id || !video) {
                return res.status(400).json({ success: false, error: 'chat_id and video are required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.sendVideo !== 'function') {
                return res.status(400).json({ success: false, error: 'Video sending not supported by this module' });
            }
            
            const result = await module.sendVideo(chat_id, video, options);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 发送语音消息
     */
    async handleSendVoice(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { chat_id, voice, options = {} } = req.body;
            
            if (!chat_id || !voice) {
                return res.status(400).json({ success: false, error: 'chat_id and voice are required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.sendVoice !== 'function') {
                return res.status(400).json({ success: false, error: 'Voice sending not supported by this module' });
            }
            
            const result = await module.sendVoice(chat_id, voice, options);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 发送文档
     */
    async handleSendDocument(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { chat_id, document, options = {} } = req.body;
            
            if (!chat_id || !document) {
                return res.status(400).json({ success: false, error: 'chat_id and document are required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.sendDocument !== 'function') {
                return res.status(400).json({ success: false, error: 'Document sending not supported by this module' });
            }
            
            const result = await module.sendDocument(chat_id, document, options);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 设置Webhook
     */
    async handleSetWebhook(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { webhook_url, options = {} } = req.body;
            
            if (!webhook_url) {
                return res.status(400).json({ success: false, error: 'webhook_url is required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.setWebhook !== 'function') {
                return res.status(400).json({ success: false, error: 'Webhook setting not supported by this module' });
            }
            
            const result = await module.setWebhook(webhook_url, options);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 移除Webhook
     */
    async handleRemoveWebhook(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.removeWebhook !== 'function') {
                return res.status(400).json({ success: false, error: 'Webhook removal not supported by this module' });
            }
            
            const result = await module.removeWebhook();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取Webhook信息
     */
    async handleGetWebhook(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.getWebhookInfo !== 'function') {
                return res.status(400).json({ success: false, error: 'Webhook info not supported by this module' });
            }
            
            const result = await module.getWebhookInfo();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 接收Webhook消息
     */
    async handleWebhookReceive(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            // 处理webhook消息
            const update = req.body;
            if (module.processUpdate) {
                await module.processUpdate(update);
            }
            
            res.json({ success: true, message: 'Webhook received' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取文件信息
     */
    async handleGetFile(req, res) {
        try {
            const { module: moduleName, fileId } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.getFile !== 'function') {
                return res.status(400).json({ success: false, error: 'File info not supported by this module' });
            }
            
            const result = await module.getFile(fileId);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async handleGetFileUrl(req, res) {
        try {
            const { module: moduleName, fileId } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.getFileUrl !== 'function') {
                return res.status(400).json({ success: false, error: 'File URL operations not supported by this module' });
            }
            
            const result = await module.getFileUrl(fileId);
            if (!result.success) {
                return res.status(404).json(result);
            }
            
            // 重定向到Telegram的文件URL
            res.redirect(result.data.file_url);
        } catch (error) {
            this.logger.error('Get file URL error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 下载文件
     */
    async handleDownloadFile(req, res) {
        try {
            const { module: moduleName, fileId } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.getFile !== 'function' || typeof module.downloadFile !== 'function') {
                return res.status(400).json({ success: false, error: 'File download not supported by this module' });
            }
            
            // 首先获取文件信息
            const fileInfo = await module.getFile(fileId);
            if (!fileInfo.success) {
                return res.status(404).json(fileInfo);
            }
            
            // 下载文件
            const downloadResult = await module.downloadFile(fileInfo.data.file_path);
            if (!downloadResult.success) {
                return res.status(500).json(downloadResult);
            }
            
            // 设置响应头
            res.set({
                'Content-Type': downloadResult.contentType || 'application/octet-stream',
                'Content-Length': downloadResult.contentLength || downloadResult.data.length,
                'Content-Disposition': `attachment; filename="file_${fileId}"`
            });
            
            res.send(downloadResult.data);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // =================
    // Home Assistant API Handlers
    // =================

    /**
     * 获取Home Assistant状态
     */
    async handleGetHAStates(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.getStates !== 'function') {
                return res.status(400).json({ success: false, error: 'States not supported by this module' });
            }
            
            const result = await module.getStates();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取增强的实体状态信息
     */
    async handleGetHAEnhancedStates(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.getEnhancedStates !== 'function') {
                return res.status(400).json({ success: false, error: 'Enhanced states not supported by this module' });
            }
            
            // 解析查询参数
            const { area_names, device_types } = req.query;
            
            // 解析JSON数组参数
            let areaNames = null;
            let deviceTypes = null;
            
            if (area_names) {
                try {
                    areaNames = JSON.parse(area_names);
                    if (!Array.isArray(areaNames)) {
                        areaNames = [area_names];
                    }
                } catch (e) {
                    areaNames = [area_names];
                }
            }
            
            if (device_types) {
                try {
                    deviceTypes = JSON.parse(device_types);
                    if (!Array.isArray(deviceTypes)) {
                        deviceTypes = [device_types];
                    }
                } catch (e) {
                    deviceTypes = [device_types];
                }
            }
            
            const result = await module.getEnhancedStates(null, areaNames, deviceTypes);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取Home Assistant配置
     */
    async handleGetHAConfig(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.callHomeAssistantAPI !== 'function') {
                return res.status(400).json({ success: false, error: 'API calls not supported by this module' });
            }
            
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials found' });
            }
            
            const result = await module.callHomeAssistantAPI(
                credentials.data.access_token,
                credentials.data.base_url,
                '/api/config'
            );
            
            if (result.error) {
                return res.status(500).json({ success: false, error: result.error });
            }
            
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取Home Assistant Access Token信息
     */
    async handleGetHAAccessToken(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.getAccessToken !== 'function') {
                return res.status(400).json({ success: false, error: 'Access token operations not supported by this module' });
            }
            
            const result = await module.getAccessToken();
            res.json(result);
        } catch (error) {
            this.logger.error('Get HA access token error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 测试Home Assistant连接
     */
    async handleHATestConnection(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.testConnection !== 'function') {
                return res.status(400).json({ success: false, error: 'Connection test not supported by this module' });
            }
            
            const result = await module.testConnection();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 调用Home Assistant服务
     */
    async handleHACallService(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { domain, service, entity_id, data = {} } = req.body;
            
            if (!domain || !service) {
                return res.status(400).json({ success: false, error: 'domain and service are required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.callHomeAssistantAPI !== 'function') {
                return res.status(400).json({ success: false, error: 'Service calls not supported by this module' });
            }
            
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials found' });
            }
            
            const serviceData = { ...data };
            if (entity_id) {
                serviceData.entity_id = entity_id;
            }
            
            const result = await module.callHomeAssistantAPI(
                credentials.data.access_token,
                credentials.data.base_url,
                `/api/services/${domain}/${service}`,
                'POST',
                serviceData
            );
            
            if (result.error) {
                return res.status(500).json({ success: false, error: result.error });
            }
            
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取Home Assistant实体列表
     */
    async handleGetHAEntities(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.getStates !== 'function') {
                return res.status(400).json({ success: false, error: 'Entities not supported by this module' });
            }
            
            const result = await module.getStates();
            if (!result.success) {
                return res.status(500).json(result);
            }
            
            // 从状态中提取实体信息
            const entities = result.data.states.map(state => ({
                entity_id: state.entity_id,
                state: state.state,
                attributes: state.attributes,
                last_changed: state.last_changed,
                last_updated: state.last_updated
            }));
            
            res.json({
                success: true,
                data: {
                    entities: entities,
                    count: entities.length,
                    retrieved_at: new Date().toISOString()
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取Home Assistant设备列表
     */
    async handleGetHADevices(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.getDevices !== 'function') {
                return res.status(400).json({ success: false, error: 'Devices not supported by this module' });
            }
            
            const result = await module.getDevices();
            res.json(result);
        } catch (error) {
            this.logger.error('Get HA devices error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取Home Assistant房间列表
     */
    async handleGetHARooms(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.getRooms !== 'function') {
                return res.status(400).json({ success: false, error: 'Rooms not supported by this module' });
            }
            
            const result = await module.getRooms();
            res.json(result);
        } catch (error) {
            this.logger.error('Get HA rooms error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取楼层列表
     */
    async handleGetHAFloors(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.getFloors !== 'function') {
                return res.status(400).json({ success: false, error: 'Floors not supported by this module' });
            }
            
            const result = await module.getFloors();
            res.json(result);
        } catch (error) {
            this.logger.error('Get HA floors error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取实体注册表列表
     */
    async handleGetHAEntityRegistry(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.getEntityRegistry !== 'function') {
                return res.status(400).json({ success: false, error: 'Entity registry not supported by this module' });
            }
            
            const result = await module.getEntityRegistry();
            res.json(result);
        } catch (error) {
            this.logger.error('Get HA entity registry error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 高级设备搜索
     */
    async handleSearchHADevices(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.searchDevices !== 'function') {
                return res.status(400).json({ success: false, error: 'Device search not supported by this module' });
            }
            
            const filters = req.body || {};
            
            // 验证筛选参数
            const validFilters = {};
            if (filters.floor_id) validFilters.floor_id = filters.floor_id;
            if (filters.area_id) validFilters.area_id = filters.area_id;
            if (filters.device_type) validFilters.device_type = filters.device_type;
            if (filters.manufacturer) validFilters.manufacturer = filters.manufacturer;
            if (filters.model) validFilters.model = filters.model;
            if (filters.enabled_only !== undefined) validFilters.enabled_only = Boolean(filters.enabled_only);
            
            const result = await module.searchDevices(validFilters);
            res.json(result);
        } catch (error) {
            this.logger.error('Search HA devices error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取OpenAI模型列表
     */
    async handleGetOpenAIModels(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'openai') {
                return res.status(404).json({ success: false, error: 'OpenAI module not found' });
            }
            
            if (typeof module.getModels !== 'function') {
                return res.status(400).json({ success: false, error: 'Models not supported by this module' });
            }
            
            const result = await module.getModels();
            res.json(result);
        } catch (error) {
            this.logger.error('Get OpenAI models error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 测试OpenAI连接
     */
    async handleOpenAITestConnection(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'openai') {
                return res.status(404).json({ success: false, error: 'OpenAI module not found' });
            }
            
            if (typeof module.testConnection !== 'function') {
                return res.status(400).json({ success: false, error: 'Connection test not supported by this module' });
            }
            
            const result = await module.testConnection();
            res.json(result);
        } catch (error) {
            this.logger.error('OpenAI connection test error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * OpenAI聊天API
     */
    async handleOpenAIChat(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'openai') {
                return res.status(404).json({ success: false, error: 'OpenAI module not found' });
            }
            
            if (typeof module.sendChatMessage !== 'function') {
                return res.status(400).json({ success: false, error: 'Chat not supported by this module' });
            }
            
            const { messages, options = {} } = req.body;
            
            if (!messages || !Array.isArray(messages)) {
                return res.status(400).json({ success: false, error: 'Messages array is required' });
            }
            
            const result = await module.sendChatMessage(messages, options);
            res.json(result);
        } catch (error) {
            this.logger.error('OpenAI chat error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * OpenAI简单聊天API（系统提示词 + 用户提示词）
     */
    async handleOpenAISimpleChat(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'openai') {
                return res.status(404).json({ success: false, error: 'OpenAI module not found' });
            }
            
            if (typeof module.sendSimpleChat !== 'function') {
                return res.status(400).json({ success: false, error: 'Simple chat not supported by this module' });
            }
            
            const { system_prompt, user_prompt, options = {} } = req.body;
            
            if (!system_prompt && !user_prompt) {
                return res.status(400).json({ success: false, error: 'At least one prompt (system_prompt or user_prompt) is required' });
            }
            
            const result = await module.sendSimpleChat(system_prompt, user_prompt, options);
            res.json(result);
        } catch (error) {
            this.logger.error('OpenAI simple chat error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 处理OpenAI音频转文字请求
     */
    async handleOpenAITranscribe(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'openai') {
                return res.status(404).json({ success: false, error: 'OpenAI module not found' });
            }
            
            if (typeof module.transcribeAudio !== 'function') {
                return res.status(400).json({ success: false, error: 'Audio transcription not supported by this module' });
            }
            
            // 处理multipart/form-data
            const multer = require('multer');
            const upload = multer({ storage: multer.memoryStorage() });
            
            upload.single('audio')(req, res, async (err) => {
                if (err) {
                    return res.status(400).json({ success: false, error: 'File upload error: ' + err.message });
                }
                
                if (!req.file) {
                    return res.status(400).json({ success: false, error: 'Audio file is required' });
                }
                
                const { model, language, prompt, temperature } = req.body;
                const options = {};
                
                if (model) options.model = model;
                if (language) options.language = language;
                if (prompt) options.prompt = prompt;
                if (temperature) options.temperature = parseFloat(temperature);
                
                const result = await module.transcribeAudio(req.file.buffer, options);
                res.json(result);
            });
        } catch (error) {
            this.logger.error('OpenAI transcribe error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 处理OpenAI URL音频转文字请求
     */
    async handleOpenAITranscribeUrl(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'openai') {
                return res.status(404).json({ success: false, error: 'OpenAI module not found' });
            }
            
            if (typeof module.transcribeAudioFromUrl !== 'function') {
                return res.status(400).json({ success: false, error: 'URL audio transcription not supported by this module' });
            }
            
            const { audio_url, model, language, prompt, temperature } = req.body;
            
            if (!audio_url) {
                return res.status(400).json({ success: false, error: 'audio_url is required' });
            }
            
            const options = {};
            if (model) options.model = model;
            if (language) options.language = language;
            if (prompt) options.prompt = prompt;
            if (temperature) options.temperature = parseFloat(temperature);
            
            const result = await module.transcribeAudioFromUrl(audio_url, options);
            res.json(result);
        } catch (error) {
            this.logger.error('OpenAI transcribe URL error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取Gemini模型列表
     */
    async handleGetGeminiModels(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'gemini') {
                return res.status(404).json({ success: false, error: 'Gemini module not found' });
            }
            
            if (typeof module.getModels !== 'function') {
                return res.status(400).json({ success: false, error: 'Models not supported by this module' });
            }
            
            const result = await module.getModels();
            res.json(result);
        } catch (error) {
            this.logger.error('Get Gemini models error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 测试Gemini连接
     */
    async handleGeminiTestConnection(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'gemini') {
                return res.status(404).json({ success: false, error: 'Gemini module not found' });
            }
            
            if (typeof module.testConnection !== 'function') {
                return res.status(400).json({ success: false, error: 'Connection test not supported by this module' });
            }
            
            const result = await module.testConnection();
            res.json(result);
        } catch (error) {
            this.logger.error('Gemini connection test error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Gemini聊天API
     */
    async handleGeminiChat(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'gemini') {
                return res.status(404).json({ success: false, error: 'Gemini module not found' });
            }
            
            if (typeof module.sendChatMessage !== 'function') {
                return res.status(400).json({ success: false, error: 'Chat not supported by this module' });
            }
            
            const { messages, options = {} } = req.body;
            
            if (!messages || !Array.isArray(messages)) {
                return res.status(400).json({ success: false, error: 'Messages array is required' });
            }
            
            const result = await module.sendChatMessage(messages, options);
            res.json(result);
        } catch (error) {
            this.logger.error('Gemini chat error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Gemini简单聊天API（系统提示词 + 用户提示词）
     */
    async handleGeminiSimpleChat(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'gemini') {
                return res.status(404).json({ success: false, error: 'Gemini module not found' });
            }
            
            if (typeof module.sendSimpleChat !== 'function') {
                return res.status(400).json({ success: false, error: 'Simple chat not supported by this module' });
            }
            
            const { system_prompt, user_prompt, options = {} } = req.body;
            
            if (!system_prompt && !user_prompt) {
                return res.status(400).json({ success: false, error: 'At least one prompt (system_prompt or user_prompt) is required' });
            }
            
            const result = await module.sendSimpleChat(system_prompt, user_prompt, options);
            res.json(result);
        } catch (error) {
            this.logger.error('Gemini simple chat error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取特定实体信息
     */
    async handleGetHAEntity(req, res) {
        try {
            const { module: moduleName, entityId } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.getStates !== 'function') {
                return res.status(400).json({ success: false, error: 'Entity info not supported by this module' });
            }
            
            const result = await module.getStates();
            if (!result.success) {
                return res.status(500).json(result);
            }
            
            const entity = result.data.states.find(state => state.entity_id === entityId);
            if (!entity) {
                return res.status(404).json({ success: false, error: 'Entity not found' });
            }
            
            res.json({
                success: true,
                data: {
                    entity_id: entity.entity_id,
                    state: entity.state,
                    attributes: entity.attributes,
                    last_changed: entity.last_changed,
                    last_updated: entity.last_updated
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 打开实体
     */
    async handleHATurnOn(req, res) {
        try {
            const { module: moduleName, entityId } = req.params;
            const { data = {} } = req.body;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.callHomeAssistantAPI !== 'function') {
                return res.status(400).json({ success: false, error: 'Service calls not supported by this module' });
            }
            
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials found' });
            }
            
            const [domain] = entityId.split('.');
            const serviceData = { ...data, entity_id: entityId };
            
            const result = await module.callHomeAssistantAPI(
                credentials.data.access_token,
                credentials.data.base_url,
                `/api/services/${domain}/turn_on`,
                'POST',
                serviceData
            );
            
            if (result.error) {
                return res.status(500).json({ success: false, error: result.error });
            }
            
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 关闭实体
     */
    async handleHATurnOff(req, res) {
        try {
            const { module: moduleName, entityId } = req.params;
            const { data = {} } = req.body;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.callHomeAssistantAPI !== 'function') {
                return res.status(400).json({ success: false, error: 'Service calls not supported by this module' });
            }
            
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials found' });
            }
            
            const [domain] = entityId.split('.');
            const serviceData = { ...data, entity_id: entityId };
            
            const result = await module.callHomeAssistantAPI(
                credentials.data.access_token,
                credentials.data.base_url,
                `/api/services/${domain}/turn_off`,
                'POST',
                serviceData
            );
            
            if (result.error) {
                return res.status(500).json({ success: false, error: result.error });
            }
            
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 设置实体状态
     */
    async handleHASetState(req, res) {
        try {
            const { module: moduleName, entityId } = req.params;
            const { state, attributes = {} } = req.body;
            
            if (state === undefined) {
                return res.status(400).json({ success: false, error: 'state is required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.callHomeAssistantAPI !== 'function') {
                return res.status(400).json({ success: false, error: 'State setting not supported by this module' });
            }
            
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials found' });
            }
            
            const stateData = {
                state: state,
                attributes: attributes
            };
            
            const result = await module.callHomeAssistantAPI(
                credentials.data.access_token,
                credentials.data.base_url,
                `/api/states/${entityId}`,
                'POST',
                stateData
            );
            
            if (result.error) {
                return res.status(500).json({ success: false, error: result.error });
            }
            
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 处理Home Assistant智能设备匹配请求
     */
    async handleHAMatchDevices(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.matchDevicesByIntent !== 'function') {
                return res.status(400).json({ success: false, error: 'Device matching not supported by this module' });
            }
            
            let intentData = req.body.intent_data || req.body;
            
            // 如果没有intent_data字段，尝试使用整个body作为intent数据
            if (!intentData || (!intentData.devices && !intentData.intent)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'intent_data is required. Expected format: {"intent_data": {...}} or direct intent object' 
                });
            }
            
            const result = await module.matchDevicesByIntent(intentData);
            res.json(result);
        } catch (error) {
            this.logger.error('Home Assistant match devices error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 处理Home Assistant实体匹配请求
     */
    async handleHAMatchEntities(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Home Assistant module not found' 
                });
            }

            const intentData = req.body;
            if (!intentData || !intentData.devices || !Array.isArray(intentData.devices)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'intent_data with devices array is required' 
                });
            }

            const result = await module.matchEntitiesByRoomAndDevice(intentData);
            res.json(result);

        } catch (error) {
            console.error('Error in handleHAMatchEntities:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Internal server error',
                details: error.message 
            });
        }
    }

    /**
     * 处理Home Assistant设备匹配请求（基于意图数据）
     */
    async handleHAMatchControlDevices(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Home Assistant module not found' 
                });
            }

            if (typeof module.matchControlDevices !== 'function') {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Device matching not supported by this module' 
                });
            }

            const intentData = req.body;
            if (!intentData || !intentData.intent || !intentData.devices || !Array.isArray(intentData.devices)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Invalid intent data format. Required: {intent, devices: []}' 
                });
            }

            const result = await module.matchControlDevices(intentData);
            res.json(result);

        } catch (error) {
            console.error('Error in handleHAMatchControlDevices:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Internal server error',
                details: error.message 
            });
        }
    }

    /**
     * 处理Home Assistant缓存状态查询请求
     */
    async handleHACacheStatus(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Home Assistant module not found' 
                });
            }

            if (!module.enhancedStatesCache) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Cache system not available' 
                });
            }

            const cache = module.enhancedStatesCache;
            const now = Date.now();
            
            const cacheStatus = {
                cache_enabled: true,
                cache_data_exists: !!cache.data,
                last_updated: cache.lastUpdated,
                last_updated_iso: cache.lastUpdated ? new Date(cache.lastUpdated).toISOString() : null,
                cache_age: cache.lastUpdated ? (now - cache.lastUpdated) : null,
                cache_age_minutes: cache.lastUpdated ? Math.round((now - cache.lastUpdated) / 60000) : null,
                is_updating: cache.isUpdating,
                update_interval: cache.updateInterval,
                update_interval_minutes: cache.updateInterval / 60000,
                max_age: cache.maxAge,
                max_age_minutes: cache.maxAge / 60000,
                is_valid: cache.data && cache.lastUpdated && (now - cache.lastUpdated) <= cache.maxAge,
                timer_active: !!module.cacheUpdateTimer,
                entities_count: cache.data ? (cache.data.states ? cache.data.states.length : 0) : 0,
                next_update_in: cache.lastUpdated ? Math.max(0, cache.updateInterval - (now - cache.lastUpdated)) : 0
            };

            res.json({
                success: true,
                data: cacheStatus,
                retrieved_at: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error in handleHACacheStatus:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Internal server error',
                details: error.message 
            });
        }
    }

    /**
     * 处理Home Assistant批量控制请求
     */
    async handleHABatchControl(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.batchControlDevices !== 'function') {
                return res.status(400).json({ success: false, error: 'Batch control not supported by this module' });
            }
            
            const { control_commands } = req.body;
            
            if (!control_commands || !Array.isArray(control_commands)) {
                return res.status(400).json({ success: false, error: 'control_commands array is required' });
            }
            
            // 验证控制命令格式
            for (const command of control_commands) {
                if (!command.entity_id || !command.entity_functions) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Each command must have entity_id and entity_functions' 
                    });
                }
            }
            
            const result = await module.batchControlDevices(control_commands);
            res.json(result);
        } catch (error) {
            this.logger.error('Home Assistant batch control error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // =================
    // Standard API Handlers
    // =================

    /**
     * 健康检查
     */
    async handleHealth(req, res) {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: require('./package.json').version || '1.0.0',
            environment: process.env.NODE_ENV || 'development'
        };
        
        res.json(health);
    }

    /**
     * 获取所有模块
     */
    async handleGetModules(req, res) {
        try {
            const statuses = await this.moduleManager.getAllModulesStatus();
            res.json({ success: true, data: statuses });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取单个模块信息
     */
    async handleGetModule(req, res) {
        try {
            const { name } = req.params;
            const status = await this.moduleManager.getModuleStatus(name);
            
            if (status.success) {
                res.json({ success: true, data: status.data });
            } else {
                res.status(404).json(status);
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 启用/禁用模块
     */
    async handleToggleModule(req, res) {
        try {
            const { name } = req.params;
            const { enabled } = req.body;
            
            let result;
            if (enabled) {
                result = await this.moduleManager.enableModule(name);
            } else {
                result = await this.moduleManager.disableModule(name);
            }
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(400).json(result);
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 重载模块
     */
    async handleReloadModule(req, res) {
        try {
            const { name } = req.params;
            const result = await this.moduleManager.reloadModule(name);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(400).json(result);
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取模块凭据
     */
    async handleGetCredentials(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module) {
                return res.status(404).json({ success: false, error: 'Module not found' });
            }
            
            const result = await module.getCredentials();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 设置模块凭据
     */
    async handleSetCredentials(req, res) {
        try {
            const { module: moduleName } = req.params;
            const credentials = req.body;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module) {
                return res.status(404).json({ success: false, error: 'Module not found' });
            }
            
            const result = await module.setCredentials(credentials);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(400).json(result);
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 批量获取凭据
     */
    async handleBatchGetCredentials(req, res) {
        try {
            const { modules } = req.body;
            const results = {};
            
            const targetModules = modules || this.moduleManager.getAllModules();
            
            for (const moduleName of targetModules) {
                const module = this.moduleManager.getModule(moduleName);
                if (module) {
                    results[moduleName] = await module.getCredentials();
                } else {
                    results[moduleName] = { success: false, error: 'Module not found' };
                }
            }
            
            res.json({ success: true, data: results });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 验证单个模块
     */
    async handleValidateModule(req, res) {
        try {
            const { module: moduleName } = req.params;
            const credentials = req.body.credentials;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module) {
                return res.status(404).json({ success: false, error: 'Module not found' });
            }
            
            const result = await module.validateCredentials(credentials);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 批量验证所有模块
     */
    async handleValidateAll(req, res) {
        try {
            const results = await this.moduleManager.batchOperation('validate');
            res.json({ success: true, data: results });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 测试连接
     */
    async handleTestConnection(req, res) {
        try {
            const { module: moduleName } = req.params;
            const credentials = req.body.credentials;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module) {
                return res.status(404).json({ success: false, error: 'Module not found' });
            }
            
            // 检查模块是否有testConnection方法
            if (typeof module.testConnection === 'function') {
                const result = await module.testConnection(credentials);
                res.json(result);
            } else {
                // 回退到普通验证
                const result = await module.validateCredentials(credentials);
                res.json({
                    ...result,
                    message: result.success ? 'Connection test successful (basic validation)' : result.error
                });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 清除单个模块缓存
     */
    async handleClearCache(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module) {
                return res.status(404).json({ success: false, error: 'Module not found' });
            }
            
            const result = module.clearCache();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 清除所有缓存
     */
    async handleClearAllCaches(req, res) {
        try {
            const results = await this.moduleManager.clearAllCaches();
            res.json({ success: true, data: results });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取系统状态
     */
    async handleGetStatus(req, res) {
        try {
            const status = {
                service: {
                    initialized: this.initialized,
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    version: require('./package.json').version || '1.0.0'
                },
                moduleManager: this.moduleManager.getStatistics(),
                configManager: this.configManager.getStatus()
            };
            
            res.json({ success: true, data: status });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取统计信息
     */
    async handleGetStatistics(req, res) {
        try {
            const statistics = this.moduleManager.getStatistics();
            res.json({ success: true, data: statistics });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取配置
     */
    async handleGetConfig(req, res) {
        try {
            const config = this.configManager.getAll();
            res.json({ success: true, data: config });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 设置配置
     */
    async handleSetConfig(req, res) {
        try {
            const { key, value, configType } = req.body;
            const result = await this.configManager.set(key, value, configType);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取模块Schema
     */
    async handleGetSchema(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module) {
                return res.status(404).json({ success: false, error: 'Module not found' });
            }
            
            const schema = module.getCredentialSchema();
            res.json({ success: true, data: schema });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // =================
    // 中间件
    // =================

    /**
     * API认证中间件
     */
    authMiddleware(req, res, next) {
        const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
        const expectedKey = this.configManager.get('api.key');
        
        if (!apiKey || apiKey.replace('Bearer ', '') !== expectedKey) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'Invalid API key'
            });
        }
        
        next();
    }

    // =================
    // 服务器管理
    // =================

    /**
     * 启动服务器
     */
    async start() {
        try {
            if (!this.initialized) {
                const initResult = await this.initialize();
                if (!initResult.success) {
                    throw new Error(`Initialization failed: ${initResult.error}`);
                }
            }
            
            const port = this.configManager.get('server.port', 3000);
            const host = this.configManager.get('server.host', '0.0.0.0');
            
            this.server = this.app.listen(port, host, () => {
                this.logger.info(`🚀 Credential Service started on ${host}:${port}`);
                this.logger.info(`📊 Management interface: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
                this.logger.info(`🔧 API endpoint: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/api`);
            });
            
            return { success: true, port, host };
        } catch (error) {
            this.logger.error('Failed to start server:', error);
            return { success: false, error: error.message };
        }
    }

    // Telegram WebSocket API Handlers
    // ================================

    /**
     * 启动Telegram WebSocket服务器
     */
    async handleStartTelegramWebSocket(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { port } = req.body;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.startWebSocketServer !== 'function') {
                return res.status(400).json({ success: false, error: 'WebSocket not supported by this module' });
            }
            
            const result = await module.startWebSocketServer(port);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 停止Telegram WebSocket服务器
     */
    async handleStopTelegramWebSocket(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.stopWebSocketServer !== 'function') {
                return res.status(400).json({ success: false, error: 'WebSocket not supported by this module' });
            }
            
            const result = await module.stopWebSocketServer();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取Telegram WebSocket状态
     */
    async handleGetTelegramWebSocketStatus(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.getWebSocketStatus !== 'function') {
                return res.status(400).json({ success: false, error: 'WebSocket not supported by this module' });
            }
            
            const status = module.getWebSocketStatus();
            res.json({ success: true, data: status });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 停止服务器
     */
    async stop() {
        try {
            if (this.server) {
                await new Promise((resolve) => {
                    this.server.close(resolve);
                });
                this.server = null;
            }
            
            // 清理配置管理器
            if (this.configManager) {
                await this.configManager.cleanup();
            }
            
            this.logger.info('Credential Service stopped');
            return { success: true, message: 'Service stopped' };
        } catch (error) {
            this.logger.error('Failed to stop server:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 创建日志器
     */
    createLogger() {
        return {
            info: (message, ...args) => {
                console.log(`[INFO][Server] ${message}`, ...args);
            },
            warn: (message, ...args) => {
                console.warn(`[WARN][Server] ${message}`, ...args);
            },
            error: (message, ...args) => {
                console.error(`[ERROR][Server] ${message}`, ...args);
            }
        };
    }
}

// 如果直接运行此文件，启动服务器
if (require.main === module) {
    const service = new CredentialService();
    
    // 优雅关闭处理
    process.on('SIGINT', async () => {
        console.log('\n⏹️  Shutting down gracefully...');
        await service.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n⏹️  Shutting down gracefully...');
        await service.stop();
        process.exit(0);
    });
    
    // 启动服务
    service.start().catch(error => {
        console.error('Failed to start service:', error);
        process.exit(1);
    });
}

module.exports = CredentialService;