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
            
            // Set global moduleManager for cross-module access
            global.moduleManager = this.moduleManager;
            
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
        this.app.get('/api/telegram/:module/bot-info', this.handleGetBotInfo.bind(this));
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
        this.app.post('/api/telegram/:module/reply/last', this.handleReplyToLastChat.bind(this));
        this.app.get('/api/telegram/:module/last-chat-info', this.handleGetLastChatInfo.bind(this));
        this.app.post('/api/telegram/:module/transcribe-voice', this.handleTranscribeVoice.bind(this));
        this.app.post('/api/telegram/:module/transcribe-message', this.handleTranscribeMessage.bind(this));
        this.app.get('/api/telegram/:module/get-last-message-text', this.handleGetLastMessageText.bind(this));

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
        
        // Agent AI API
        this.app.post('/api/agent/:module/subscribe', this.handleAgentSubscribe.bind(this));
        this.app.post('/api/agent/:module/unsubscribe', this.handleAgentUnsubscribe.bind(this));
        this.app.get('/api/agent/:module/subscriptions', this.handleAgentGetSubscriptions.bind(this));
        this.app.post('/api/agent/:module/process', this.handleAgentProcessMessage.bind(this));
        this.app.get('/api/agent/:module/stats', this.handleAgentGetStats.bind(this));
        this.app.post('/api/agent/:module/context/clear', this.handleAgentClearContext.bind(this));
        this.app.get('/api/agent/:module/context', this.handleAgentGetContext.bind(this));
        this.app.get('/api/telegram/:module/download/:fileId', this.handleDownloadFile.bind(this));
        
        // Home Assistant API - core endpoints only
        this.app.get('/api/home_assistant/:module/config', this.handleGetHAConfig.bind(this));
        this.app.get('/api/home_assistant/:module/states', this.handleGetHAStates.bind(this));
        this.app.get('/api/home_assistant/:module/entity-registry', this.handleGetHAEntityRegistry.bind(this));
        this.app.get('/api/home_assistant/:module/device-registry', this.handleGetHADeviceRegistry.bind(this));
        this.app.get('/api/home_assistant/:module/spaces', this.handleHASpaces.bind(this));
        this.app.get('/api/home_assistant/:module/enhanced-entities', this.handleGetHAEnhancedEntities.bind(this));
        this.app.post('/api/home_assistant/:module/batch-control', this.handleHABatchControl.bind(this));
        this.app.post('/api/home_assistant/:module/batch-states', this.handleHABatchStates.bind(this));
        
        // Home Assistant WebSocket API
        this.app.post('/api/home_assistant/:module/websocket/start', this.handleStartHAWebSocket.bind(this));
        this.app.post('/api/home_assistant/:module/websocket/stop', this.handleStopHAWebSocket.bind(this));
        this.app.get('/api/home_assistant/:module/websocket/status', this.handleGetHAWebSocketStatus.bind(this));

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
        
        // DeepSeek API路由
        this.app.get('/api/deepseek/:module/models', this.handleGetDeepSeekModels.bind(this));
        this.app.post('/api/deepseek/:module/test-connection', this.handleDeepSeekTestConnection.bind(this));
        this.app.post('/api/deepseek/:module/chat', this.handleDeepSeekChat.bind(this));
        this.app.post('/api/deepseek/:module/simple-chat', this.handleDeepSeekSimpleChat.bind(this));
        
        // Node-RED API路由
        this.app.get('/api/nodered/:module/flows', this.handleNodeREDGetFlows.bind(this));
        this.app.post('/api/nodered/:module/flows', this.handleNodeREDDeployFlows.bind(this));
        this.app.post('/api/nodered/:module/upload', this.handleNodeREDUploadFlow.bind(this));
        this.app.post('/api/nodered/:module/validate', this.handleNodeREDValidateFlows.bind(this));
        this.app.get('/api/nodered/:module/backups', this.handleNodeREDGetBackups.bind(this));
        this.app.post('/api/nodered/:module/backup', this.handleNodeREDCreateBackup.bind(this));
        this.app.post('/api/nodered/:module/restore/:backupId', this.handleNodeREDRestoreBackup.bind(this));
        this.app.delete('/api/nodered/:module/backup/:backupId', this.handleNodeREDDeleteBackup.bind(this));
        
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

    /**
     * 清理 Markdown 代码块标记
     * 移除 ```json 和 ``` 标记，只保留 JSON 内容
     */
    cleanMarkdownCodeBlock(content) {
        if (typeof content !== 'string') {
            return content;
        }
        
        // 移除开头的 ```json 或 ``` 和结尾的 ```
        let cleaned = content.trim();
        
        // 匹配并移除 Markdown 代码块
        const codeBlockPattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
        const match = cleaned.match(codeBlockPattern);
        
        if (match) {
            cleaned = match[1].trim();
            this.logger.info('[Content Cleaner] Removed Markdown code block markers');
        }
        
        return cleaned;
    }

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
     * 获取 Telegram Bot 信息 (用于健康检查)
     */
    async handleGetBotInfo(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.getMe !== 'function') {
                return res.status(400).json({ success: false, error: 'Bot info not supported by this module' });
            }
            
            const result = await module.getMe();
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
     * 快速回复最后一条消息
     */
    async handleReplyToLastChat(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { text, options = {} } = req.body;

            if (!text) {
                return res.status(400).json({ success: false, error: 'text is required' });
            }

            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }

            if (typeof module.replyToLastChat !== 'function') {
                return res.status(400).json({ success: false, error: 'Reply to last chat not supported by this module' });
            }

            const result = await module.replyToLastChat(text, options);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取最后聊天信息
     */
    async handleGetLastChatInfo(req, res) {
        try {
            const { module: moduleName } = req.params;

            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }

            if (typeof module.getLastChatInfo !== 'function') {
                return res.status(400).json({ success: false, error: 'Get last chat info not supported by this module' });
            }

            const result = module.getLastChatInfo();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 语音转文字（通过文件 ID）
     */
    async handleTranscribeVoice(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { file_id, options = {} } = req.body;
            
            if (!file_id) {
                return res.status(400).json({ success: false, error: 'file_id is required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.transcribeVoice !== 'function') {
                return res.status(400).json({ success: false, error: 'Voice transcription not supported by this module' });
            }
            
            const result = await module.transcribeVoice(file_id, options);
            res.json(result);
        } catch (error) {
            this.logger.error('Transcribe voice error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 转换消息中的语音（通过消息 ID）
     */
    async handleTranscribeMessage(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { message_id, options = {} } = req.body;
            
            if (!message_id) {
                return res.status(400).json({ success: false, error: 'message_id is required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ success: false, error: 'Telegram module not found' });
            }
            
            if (typeof module.transcribeMessageVoice !== 'function') {
                return res.status(400).json({ success: false, error: 'Message transcription not supported by this module' });
            }
            
            // 查找消息
            const messages = module.messageHistory || [];
            const message = messages.find(m => m.message_id === message_id || m.id === message_id);
            
            if (!message) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Message not found',
                    message_id: message_id
                });
            }
            
            const result = await module.transcribeMessageVoice(message.raw || message, options);
            res.json(result);
        } catch (error) {
            this.logger.error('Transcribe message error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 智能获取最后一条消息的文字内容
     * - 如果是文字消息，直接返回文字
     * - 如果是语音消息，自动调用 Whisper 转换后返回文字
     */
    async handleGetLastMessageText(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { language } = req.query; // 可选的语言参数
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'telegram') {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Telegram module not found' 
                });
            }
            
            // 获取消息历史
            const messages = module.messageHistory || [];
            if (messages.length === 0) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'No messages found',
                    message: 'Please send a message to the bot first'
                });
            }
            
            // 获取最后一条消息（按 ID 或时间排序，取最新的）
            const lastMessage = messages.reduce((latest, current) => {
                const latestId = latest.id || latest.message_id || 0;
                const currentId = current.id || current.message_id || 0;
                return currentId > latestId ? current : latest;
            });
            
            const response = {
                success: true,
                message_id: lastMessage.id || lastMessage.message_id,
                message_type: lastMessage.message_type,
                date: lastMessage.date,
                chat_id: lastMessage.chat_id,
                from: lastMessage.from,
                text: null,
                raw_text: null,
                is_transcribed: false
            };
            
            // 判断消息类型
            if (lastMessage.message_type === 'text') {
                // 文字消息，直接返回
                response.text = lastMessage.text || '';
                response.raw_text = lastMessage.text || '';
                
            } else if (lastMessage.message_type === 'voice') {
                // 语音消息，调用 Whisper 转换
                if (!lastMessage.media || !lastMessage.media.voice || !lastMessage.media.voice.file_id) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Voice message has no file_id' 
                    });
                }
                
                if (typeof module.transcribeVoice !== 'function') {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Voice transcription not supported by this module' 
                    });
                }
                
                this.logger.info(`Transcribing voice message ${lastMessage.id}...`);
                
                // 调用语音转文字
                const transcribeOptions = {};
                if (language) {
                    transcribeOptions.language = language;
                }
                
                const transcribeResult = await module.transcribeVoice(
                    lastMessage.media.voice.file_id, 
                    transcribeOptions
                );
                
                if (transcribeResult.success && transcribeResult.text) {
                    response.text = transcribeResult.text;
                    response.is_transcribed = true;
                    response.transcription = {
                        language: transcribeResult.language,
                        duration: transcribeResult.duration,
                        file_size: transcribeResult.file_size
                    };
                } else {
                    return res.status(500).json({ 
                        success: false, 
                        error: 'Voice transcription failed',
                        details: transcribeResult.error || 'Unknown error'
                    });
                }
                
            } else if (lastMessage.text) {
                // 其他类型但有文字内容（如照片带标题）
                response.text = lastMessage.text;
                response.raw_text = lastMessage.text;
                
            } else {
                // 其他类型且没有文字内容
                return res.status(400).json({ 
                    success: false, 
                    error: `Message type '${lastMessage.message_type}' has no text content`,
                    message_type: lastMessage.message_type,
                    supported_types: ['text', 'voice']
                });
            }
            
            res.json(response);
            
        } catch (error) {
            this.logger.error('Get last message text error:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }

    /**
     * Agent: 订阅模块消息
     */
    async handleAgentSubscribe(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { target_module } = req.body;
            
            if (!target_module) {
                return res.status(400).json({ success: false, error: 'target_module is required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'agent') {
                return res.status(404).json({ success: false, error: 'Agent module not found' });
            }
            
            const result = await module.subscribeToModule(target_module);
            res.json(result);
        } catch (error) {
            this.logger.error('Agent subscribe error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Agent: 取消订阅模块
     */
    async handleAgentUnsubscribe(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { target_module } = req.body;
            
            if (!target_module) {
                return res.status(400).json({ success: false, error: 'target_module is required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'agent') {
                return res.status(404).json({ success: false, error: 'Agent module not found' });
            }
            
            const result = await module.unsubscribeFromModule(target_module);
            res.json(result);
        } catch (error) {
            this.logger.error('Agent unsubscribe error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Agent: 获取订阅列表
     */
    async handleAgentGetSubscriptions(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'agent') {
                return res.status(404).json({ success: false, error: 'Agent module not found' });
            }
            
            res.json({
                success: true,
                subscriptions: Array.from(module.subscriptions.keys()),
                count: module.subscriptions.size
            });
        } catch (error) {
            this.logger.error('Agent get subscriptions error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Agent: 手动处理消息
     */
    async handleAgentProcessMessage(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { message, source } = req.body;
            
            if (!message) {
                return res.status(400).json({ success: false, error: 'message is required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'agent') {
                return res.status(404).json({ success: false, error: 'Agent module not found' });
            }
            
            const result = await module.processManualMessage(message, source || 'manual');
            res.json(result);
        } catch (error) {
            this.logger.error('Agent process message error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Agent: 获取统计信息
     */
    async handleAgentGetStats(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'agent') {
                return res.status(404).json({ success: false, error: 'Agent module not found' });
            }
            
            const result = module.getStats();
            res.json(result);
        } catch (error) {
            this.logger.error('Agent get stats error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Agent: 清空对话上下文
     */
    async handleAgentClearContext(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'agent') {
                return res.status(404).json({ success: false, error: 'Agent module not found' });
            }
            
            const result = module.clearContext();
            res.json(result);
        } catch (error) {
            this.logger.error('Agent clear context error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Agent: 获取对话上下文
     */
    async handleAgentGetContext(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'agent') {
                return res.status(404).json({ success: false, error: 'Agent module not found' });
            }
            
            res.json({
                success: true,
                context: module.conversationContext,
                length: module.conversationContext.length
            });
        } catch (error) {
            this.logger.error('Agent get context error:', error);
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
     * 获取Home Assistant配置信息 (用于健康检查)
     */
    async handleGetHAConfig(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }
            
            if (typeof module.getConfig !== 'function') {
                return res.status(400).json({ success: false, error: 'Config not supported by this module' });
            }
            
            const result = await module.getConfig();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

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
     * 获取设备注册表
     */
    async handleGetHADeviceRegistry(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);

            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }

            if (typeof module.getDeviceRegistry !== 'function') {
                return res.status(400).json({ success: false, error: 'Device registry not supported by this module' });
            }

            const result = await module.getDeviceRegistry();
            res.json(result);
        } catch (error) {
            this.logger.error('Get HA device registry error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取空间列表（楼层 + 房间）
     */
    async handleHASpaces(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);

            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }

            if (typeof module.getSpaces !== 'function') {
                return res.status(400).json({ success: false, error: 'Spaces not supported by this module' });
            }

            const { op } = req.query;
            const result = await module.getSpaces(op || 'floors');
            res.json(result);
        } catch (error) {
            this.logger.error('Get HA spaces error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取增强实体信息（包含房间和楼层信息）
     */
    async handleGetHAEnhancedEntities(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);

            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }

            // 检查必要的方法是否存在
            if (typeof module.getStates !== 'function' ||
                typeof module.getEntityRegistry !== 'function' ||
                typeof module.getSpaces !== 'function') {
                return res.status(400).json({
                    success: false,
                    error: 'Required methods not available in this module'
                });
            }

            // 也尝试获取设备信息（如果可用）
            let devicesResult = { success: false, data: null };
            if (typeof module.infoListModule?.getDevicesViaWebSocket === 'function') {
                try {
                    const credentials = await module.getCredentials();
                    if (credentials.success) {
                        devicesResult = await module.infoListModule.getDevicesViaWebSocket(
                            credentials.data.access_token,
                            credentials.data.base_url
                        );
                    }
                } catch (error) {
                    console.log('Failed to get devices data:', error.message);
                }
            }

            // 获取实体状态
            const statesResult = await module.getStates();
            if (!statesResult.success) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to get entity states: ' + statesResult.error
                });
            }

            // 获取实体注册表
            const registryResult = await module.getEntityRegistry();
            if (!registryResult.success) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to get entity registry: ' + registryResult.error
                });
            }

            // 获取空间信息
            const spacesResult = await module.getSpaces('floors');
            if (!spacesResult.success) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to get spaces: ' + spacesResult.error
                });
            }

            // 创建映射表
            const entityToAreaMap = new Map();
            const areaToRoomMap = new Map();
            const areaToFloorMap = new Map();
            const deviceToAreaMap = new Map();

            // 建立设备ID到区域ID的映射（如果设备数据可用）
            if (devicesResult.success && devicesResult.data && devicesResult.data.devices && Array.isArray(devicesResult.data.devices)) {
                devicesResult.data.devices.forEach(device => {
                    if (device.area_id && device.id) {
                        deviceToAreaMap.set(device.id, device.area_id);
                    }
                });
            }

            // 建立实体ID到区域ID的映射
            if (registryResult.data && registryResult.data.entities && Array.isArray(registryResult.data.entities)) {
                registryResult.data.entities.forEach(entity => {
                    if (entity.area_id) {
                        // 实体直接分配到区域
                        entityToAreaMap.set(entity.entity_id, entity.area_id);
                    } else if (entity.device_id && deviceToAreaMap.has(entity.device_id)) {
                        // 实体没有直接分配区域，但其设备有分配区域
                        entityToAreaMap.set(entity.entity_id, deviceToAreaMap.get(entity.device_id));
                    }
                });
            }

            // 建立区域ID到房间和楼层的映射
            if (spacesResult.data && spacesResult.data.floors) {
                spacesResult.data.floors.forEach(floor => {
                    if (floor.rooms && Array.isArray(floor.rooms)) {
                        floor.rooms.forEach(room => {
                            areaToRoomMap.set(room.area_id, {
                                area_id: room.area_id,
                                area_name: room.name
                            });
                            areaToFloorMap.set(room.area_id, {
                                floor_id: floor.floor_id,
                                floor_name: floor.name
                            });
                        });
                    }
                });
            }

            // 增强实体信息
            const enhancedEntities = statesResult.data.states.map(entity => {
                const areaId = entityToAreaMap.get(entity.entity_id);
                let roomInfo = null;
                let floorInfo = null;

                if (areaId) {
                    roomInfo = areaToRoomMap.get(areaId);
                    floorInfo = areaToFloorMap.get(areaId);
                }

                // 提取设备名称（使用friendly_name）
                const deviceName = entity.attributes?.friendly_name || entity.entity_id;

                // 提取设备类型
                let deviceType = null;
                const domain = entity.entity_id.split('.')[0];

                if (domain === 'sensor' || domain === 'binary_sensor') {
                    // 对于传感器类型，使用device_class
                    deviceType = entity.attributes?.device_class || domain;
                } else {
                    // 对于执行类设备，使用域名
                    deviceType = domain;
                }

                return {
                    // 原始实体信息
                    entity_id: entity.entity_id,
                    state: entity.state,
                    attributes: entity.attributes,
                    last_changed: entity.last_changed,
                    last_updated: entity.last_updated,
                    context: entity.context,

                    // 增强信息
                    area_id: areaId || null,
                    room_id: roomInfo ? roomInfo.area_id : null,
                    room_name: roomInfo ? roomInfo.area_name : null,
                    floor_id: floorInfo ? floorInfo.floor_id : null,
                    floor_name: floorInfo ? floorInfo.floor_name : null,

                    // 新增设备信息
                    device_name: deviceName,
                    device_type: deviceType
                };
            });

            // 返回结果
            res.json({
                success: true,
                data: {
                    entities: enhancedEntities,
                    count: enhancedEntities.length,
                    summary: {
                        total_entities: enhancedEntities.length,
                        entities_with_area: enhancedEntities.filter(e => e.area_id).length,
                        entities_with_room: enhancedEntities.filter(e => e.room_name).length,
                        entities_with_floor: enhancedEntities.filter(e => e.floor_name).length
                    },
                    retrieved_at: new Date().toISOString()
                }
            });

        } catch (error) {
            this.logger.error('Get HA enhanced entities error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 批量控制设备
     * 接收格式: [{"entity_id":"xxx","service":"domain.action","service_data":{...}}]
     */
    /**
     * 处理相对调整值（支持 +/- 运算）
     */
    async processRelativeValues(serviceData, entityId, credentials, module) {
        const processedData = { ...serviceData };
        let needsCurrentState = false;

        // 检查是否有相对值（以 + 或 - 开头的字符串）
        for (const [key, value] of Object.entries(processedData)) {
            if (typeof value === 'string' && (value.startsWith('+') || value.startsWith('-'))) {
                needsCurrentState = true;
                break;
            }
        }

        if (!needsCurrentState) {
            return processedData;
        }

        // 获取当前状态
        const currentState = await module.basicInfoModule.callHomeAssistantAPI(
            credentials.access_token,
            credentials.base_url,
            `/api/states/${entityId}`,
            'GET'
        );

        if (currentState.error) {
            throw new Error(`Failed to get current state: ${currentState.error}`);
        }

        const attrs = currentState.attributes || {};

        // 处理各种相对值
        for (const [key, value] of Object.entries(processedData)) {
            if (typeof value === 'string' && (value.startsWith('+') || value.startsWith('-'))) {
                const delta = parseFloat(value);
                
                if (isNaN(delta)) {
                    continue;
                }

                // 根据不同的属性名处理
                switch (key) {
                    case 'brightness':
                        // brightness: 0-255
                        const currentBrightness = attrs.brightness || 0;
                        processedData[key] = Math.max(0, Math.min(255, currentBrightness + delta));
                        break;

                    case 'brightness_pct':
                        // brightness_pct: 0-100
                        const currentBrightnessPct = attrs.brightness ? Math.round((attrs.brightness / 255) * 100) : 0;
                        processedData[key] = Math.max(0, Math.min(100, currentBrightnessPct + delta));
                        break;

                    case 'temperature':
                        // 空调温度
                        const currentTemp = attrs.temperature || 20;
                        processedData[key] = Math.max(16, Math.min(30, currentTemp + delta));
                        break;

                    case 'color_temp':
                    case 'color_temp_kelvin':
                        // 色温
                        const currentColorTemp = attrs.color_temp || attrs.color_temp_kelvin || 4000;
                        const minTemp = attrs.min_color_temp_kelvin || 2000;
                        const maxTemp = attrs.max_color_temp_kelvin || 6500;
                        processedData[key] = Math.max(minTemp, Math.min(maxTemp, currentColorTemp + delta));
                        break;

                    case 'position':
                        // 窗帘位置: 0-100
                        const currentPosition = attrs.current_position || 0;
                        processedData[key] = Math.max(0, Math.min(100, currentPosition + delta));
                        break;

                    case 'volume_level':
                        // 音量: 0-1
                        const currentVolume = attrs.volume_level || 0;
                        const newVolume = currentVolume + (delta / 100); // 假设输入是百分比
                        processedData[key] = Math.max(0, Math.min(1, newVolume));
                        break;

                    default:
                        // 对于未知的属性，尝试从当前状态获取并相加
                        if (attrs[key] !== undefined && typeof attrs[key] === 'number') {
                            processedData[key] = attrs[key] + delta;
                        }
                }
            }
        }

        return processedData;
    }

    async handleHABatchControl(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);

            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }

            // 获取控制命令数组
            const commands = req.body;

            if (!Array.isArray(commands)) {
                return res.status(400).json({
                    success: false,
                    error: 'Request body must be an array of control commands'
                });
            }

            if (commands.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Control commands array cannot be empty'
                });
            }

            // 验证每个命令的格式
            for (let i = 0; i < commands.length; i++) {
                const cmd = commands[i];
                if (!cmd.entity_id || !cmd.service) {
                    return res.status(400).json({
                        success: false,
                        error: `Command at index ${i} is missing required fields: entity_id and service are required`
                    });
                }
            }

            // 获取凭据
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials found' });
            }

            // 检查模块是否支持API调用
            if (!module.basicInfoModule || typeof module.basicInfoModule.callHomeAssistantAPI !== 'function') {
                return res.status(400).json({ success: false, error: 'Batch control not supported by this module' });
            }

            // 执行批量控制
            const results = [];
            let successCount = 0;
            let failCount = 0;

            for (const cmd of commands) {
                try {
                    const { entity_id, service, service_data = {} } = cmd;

                    // 解析服务（格式: domain.service）
                    const [domain, serviceName] = service.includes('.') 
                        ? service.split('.') 
                        : [entity_id.split('.')[0], service];

                    // 处理相对值调整（如果有 +/- 符号）
                    let processedServiceData;
                    try {
                        processedServiceData = await this.processRelativeValues(
                            service_data, 
                            entity_id, 
                            credentials.data, 
                            module
                        );
                    } catch (relativeError) {
                        failCount++;
                        results.push({
                            entity_id: entity_id,
                            service: service,
                            success: false,
                            error: `Relative value processing failed: ${relativeError.message}`,
                            original_service_data: service_data
                        });
                        continue;
                    }

                    // 准备服务数据
                    const fullServiceData = {
                        ...processedServiceData,
                        entity_id: entity_id
                    };

                    // 调用Home Assistant API
                    const result = await module.basicInfoModule.callHomeAssistantAPI(
                        credentials.data.access_token,
                        credentials.data.base_url,
                        `/api/services/${domain}/${serviceName}`,
                        'POST',
                        fullServiceData
                    );

                    if (result.error) {
                        failCount++;
                        results.push({
                            entity_id: entity_id,
                            service: service,
                            success: false,
                            error: result.error,
                            details: result.details || null,
                            processed_data: fullServiceData
                        });
                    } else {
                        successCount++;
                        results.push({
                            entity_id: entity_id,
                            service: service,
                            success: true,
                            data: result,
                            processed_data: fullServiceData
                        });
                    }
                } catch (error) {
                    failCount++;
                    results.push({
                        entity_id: cmd.entity_id,
                        service: cmd.service,
                        success: false,
                        error: error.message
                    });
                }
            }

            // 返回批量控制结果
            res.json({
                success: true,
                data: {
                    total: commands.length,
                    success_count: successCount,
                    fail_count: failCount,
                    results: results
                },
                executed_at: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('Home Assistant batch control error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 批量获取实体状态
     * 接收格式: [{"entity_id":"xxx"}]
     * 返回清洗后的状态数据
     */
    async handleHABatchStates(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);

            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
            }

            // 获取实体ID列表
            const entities = req.body;

            if (!Array.isArray(entities)) {
                return res.status(400).json({
                    success: false,
                    error: 'Request body must be an array of entities'
                });
            }

            if (entities.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Entities array cannot be empty'
                });
            }

            // 验证每个实体对象必须有entity_id
            for (let i = 0; i < entities.length; i++) {
                const entity = entities[i];
                if (!entity.entity_id) {
                    return res.status(400).json({
                        success: false,
                        error: `Entity at index ${i} is missing required field: entity_id`
                    });
                }
            }

            // 获取凭据
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials found' });
            }

            // 检查模块是否支持API调用
            if (!module.basicInfoModule || typeof module.basicInfoModule.callHomeAssistantAPI !== 'function') {
                return res.status(400).json({ success: false, error: 'State retrieval not supported by this module' });
            }

            // 获取所有实体的状态
            const results = [];
            let successCount = 0;
            let failCount = 0;

            for (const entity of entities) {
                try {
                    const { entity_id } = entity;

                    // 调用Home Assistant API获取单个实体状态
                    const result = await module.basicInfoModule.callHomeAssistantAPI(
                        credentials.data.access_token,
                        credentials.data.base_url,
                        `/api/states/${entity_id}`,
                        'GET'
                    );

                    if (result.error) {
                        failCount++;
                        results.push({
                            entity_id: entity_id,
                            success: false,
                            error: result.error
                        });
                    } else {
                        successCount++;
                        // 清洗数据
                        const cleanedData = this.cleanEntityState(result);
                        results.push({
                            entity_id: entity_id,
                            success: true,
                            data: cleanedData
                        });
                    }
                } catch (error) {
                    failCount++;
                    results.push({
                        entity_id: entity.entity_id,
                        success: false,
                        error: error.message
                    });
                }
            }

            // 返回批量状态查询结果
            res.json({
                success: true,
                data: {
                    total: entities.length,
                    success_count: successCount,
                    fail_count: failCount,
                    results: results
                },
                retrieved_at: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error('Home Assistant batch states error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // ================================
    // Home Assistant WebSocket API Handlers
    // ================================

    /**
     * 启动Home Assistant WebSocket服务器
     */
    async handleStartHAWebSocket(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { port } = req.body;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
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
     * 停止Home Assistant WebSocket服务器
     */
    async handleStopHAWebSocket(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
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
     * 获取Home Assistant WebSocket状态
     */
    async handleGetHAWebSocketStatus(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'home_assistant') {
                return res.status(404).json({ success: false, error: 'Home Assistant module not found' });
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
     * 获取RGB颜色的描述
     */
    getRGBColorDescription(rgb) {
        if (!Array.isArray(rgb) || rgb.length !== 3) return null;
        
        const colorMap = {
            "255,255,255": "Pure White",
            "255,0,0": "Red",
            "0,255,0": "Green",
            "0,0,255": "Blue",
            "255,255,0": "Yellow",
            "255,0,255": "Magenta",
            "0,255,255": "Cyan",
            "255,165,0": "Orange",
            "255,192,203": "Pink",
            "128,0,128": "Purple",
            "255,255,224": "Light Yellow",
            "173,216,230": "Light Blue",
            "144,238,144": "Light Green",
            "255,182,193": "Light Pink"
        };
        
        const key = rgb.join(',');
        if (colorMap[key]) {
            return colorMap[key];
        }
        
        // 近似匹配
        const [r, g, b] = rgb;
        const threshold = 30;
        
        for (const [colorKey, colorName] of Object.entries(colorMap)) {
            const [cr, cg, cb] = colorKey.split(',').map(Number);
            if (Math.abs(r - cr) < threshold && 
                Math.abs(g - cg) < threshold && 
                Math.abs(b - cb) < threshold) {
                return colorName;
            }
        }
        
        return `RGB(${r},${g},${b})`;
    }

    /**
     * 获取色温的描述
     */
    getColorTempDescription(colorTemp) {
        if (!colorTemp) return null;
        
        const tempRanges = [
            { max: 250, desc: "Cool White" },
            { max: 350, desc: "Natural White" },
            { max: 450, desc: "Warm White" },
            { max: 9999, desc: "Extra Warm Light" }
        ];
        
        for (const range of tempRanges) {
            if (colorTemp <= range.max) {
                return range.desc;
            }
        }
        
        return "Warm Light";
    }

    /**
     * 生成用户友好的设备状态描述
     */
    generateDeviceDescription(entityData, cleanedData) {
        const domain = entityData.entity_id.split('.')[0];
        const attrs = entityData.attributes || {};
        const state = entityData.state;
        
        let description = '';
        
        switch (domain) {
            case 'light':
                // 灯光描述: 状态，亮度，颜色/色温
                const parts = [];
                parts.push(state === 'on' ? 'on' : 'off');
                
                if (state === 'on') {
                    // 亮度
                    if (attrs.brightness !== undefined && attrs.brightness !== null) {
                        const brightnessPercent = Math.round((attrs.brightness / 255) * 100);
                        parts.push(`brightness ${brightnessPercent}%`);
                    }
                    
                    // 色温优先：如果有色温，就只显示色温，不显示RGB颜色
                    if (attrs.color_temp) {
                        const tempDesc = this.getColorTempDescription(attrs.color_temp);
                        if (tempDesc) {
                            parts.push(tempDesc);
                        }
                    } else if (attrs.rgb_color) {
                        // 没有色温时才显示RGB颜色
                        const colorDesc = this.getRGBColorDescription(attrs.rgb_color);
                        if (colorDesc) {
                            parts.push(colorDesc);
                        }
                    }
                }
                
                description = parts.join(', ');
                break;
                
            case 'climate':
                // 空调描述: 关闭时只显示off，开启时显示详细信息
                if (state === 'off') {
                    description = 'off';
                } else {
                    const climateParts = ['on'];
                    
                    // 模式 (heat, cool, auto等)
                    if (attrs.hvac_mode && attrs.hvac_mode !== 'off') {
                        climateParts.push(attrs.hvac_mode);
                    }
                    
                    // 设置温度
                    if (attrs.temperature !== undefined && attrs.temperature !== null) {
                        climateParts.push(`${attrs.temperature}°C`);
                    }
                    
                    // 当前温度
                    if (attrs.current_temperature !== undefined && attrs.current_temperature !== null) {
                        climateParts.push(`(current: ${attrs.current_temperature}°C)`);
                    }
                    
                    // 风速
                    if (attrs.fan_mode) {
                        climateParts.push(`fan: ${attrs.fan_mode}`);
                    }
                    
                    description = climateParts.join(', ');
                }
                break;
                
            case 'sensor':
            case 'binary_sensor':
                // 传感器描述: 状态值 + 单位
                if (attrs.unit_of_measurement) {
                    description = `${state}${attrs.unit_of_measurement}`;
                } else {
                    description = state;
                }
                break;
                
            case 'cover':
                // 窗帘描述: 状态 + 位置
                if (attrs.current_position !== undefined && attrs.current_position !== null) {
                    description = `${state}, position ${attrs.current_position}%`;
                } else {
                    description = state;
                }
                break;
                
            case 'fan':
                // 风扇描述: 状态 + 速度
                const fanParts = [state];
                if (state === 'on' && attrs.percentage !== undefined && attrs.percentage !== null) {
                    fanParts.push(`${attrs.percentage}%`);
                }
                description = fanParts.join(', ');
                break;
                
            case 'media_player':
                // 媒体播放器描述: 状态 + 媒体信息
                const mediaParts = [state];
                if (attrs.media_title) {
                    mediaParts.push(attrs.media_title);
                }
                if (attrs.volume_level !== undefined && attrs.volume_level !== null) {
                    const volumePercent = Math.round(attrs.volume_level * 100);
                    mediaParts.push(`volume ${volumePercent}%`);
                }
                description = mediaParts.join(', ');
                break;
                
            default:
                description = state;
                break;
        }
        
        return description;
    }

    /**
     * 清洗实体状态数据
     * 只保留有用的信息
     */
    cleanEntityState(entityData) {
        const domain = entityData.entity_id.split('.')[0];
        const cleanedData = {
            entity_id: entityData.entity_id,
            friendly_name: entityData.attributes?.friendly_name || entityData.entity_id,
            state: entityData.state,
            attributes: {}
        };

        const attrs = entityData.attributes || {};

        // 根据设备类型提取有用属性
        switch (domain) {
            case 'light':
                // 灯光：亮度、颜色、色温
                if (attrs.brightness !== undefined && attrs.brightness !== null) {
                    cleanedData.attributes.brightness = attrs.brightness;
                }
                if (attrs.color_temp !== undefined && attrs.color_temp !== null) {
                    cleanedData.attributes.color_temp = attrs.color_temp;
                }
                if (attrs.rgb_color !== undefined && attrs.rgb_color !== null) {
                    cleanedData.attributes.rgb_color = attrs.rgb_color;
                }
                if (attrs.hs_color !== undefined && attrs.hs_color !== null) {
                    cleanedData.attributes.hs_color = attrs.hs_color;
                }
                if (attrs.color_name !== undefined && attrs.color_name !== null) {
                    cleanedData.attributes.color_name = attrs.color_name;
                }
                break;

            case 'climate':
                // 空调：设置温度、当前温度、模式、风速
                if (attrs.temperature !== undefined && attrs.temperature !== null) {
                    cleanedData.attributes.temperature = attrs.temperature;
                }
                if (attrs.current_temperature !== undefined && attrs.current_temperature !== null) {
                    cleanedData.attributes.current_temperature = attrs.current_temperature;
                }
                if (attrs.hvac_mode !== undefined && attrs.hvac_mode !== null) {
                    cleanedData.attributes.hvac_mode = attrs.hvac_mode;
                }
                if (attrs.fan_mode !== undefined && attrs.fan_mode !== null) {
                    cleanedData.attributes.fan_mode = attrs.fan_mode;
                }
                if (attrs.swing_mode !== undefined && attrs.swing_mode !== null) {
                    cleanedData.attributes.swing_mode = attrs.swing_mode;
                }
                break;

            case 'sensor':
            case 'binary_sensor':
                // 传感器：只输出当前状态值和单位
                if (attrs.unit_of_measurement !== undefined && attrs.unit_of_measurement !== null) {
                    cleanedData.attributes.unit_of_measurement = attrs.unit_of_measurement;
                }
                if (attrs.device_class !== undefined && attrs.device_class !== null) {
                    cleanedData.attributes.device_class = attrs.device_class;
                }
                break;

            case 'cover':
                // 窗帘/百叶窗：位置
                if (attrs.current_position !== undefined && attrs.current_position !== null) {
                    cleanedData.attributes.current_position = attrs.current_position;
                }
                break;

            case 'fan':
                // 风扇：速度、模式
                if (attrs.percentage !== undefined && attrs.percentage !== null) {
                    cleanedData.attributes.percentage = attrs.percentage;
                }
                if (attrs.preset_mode !== undefined && attrs.preset_mode !== null) {
                    cleanedData.attributes.preset_mode = attrs.preset_mode;
                }
                break;

            case 'media_player':
                // 媒体播放器：音量、播放状态、媒体信息
                if (attrs.volume_level !== undefined && attrs.volume_level !== null) {
                    cleanedData.attributes.volume_level = attrs.volume_level;
                }
                if (attrs.media_title !== undefined && attrs.media_title !== null) {
                    cleanedData.attributes.media_title = attrs.media_title;
                }
                if (attrs.media_artist !== undefined && attrs.media_artist !== null) {
                    cleanedData.attributes.media_artist = attrs.media_artist;
                }
                break;

            case 'lock':
                // 锁：状态
                // state已经包含了主要信息
                break;

            case 'switch':
            case 'input_boolean':
                // 开关：状态已经足够
                break;

            default:
                // 其他类型：保留常见的有用属性
                if (attrs.unit_of_measurement !== undefined && attrs.unit_of_measurement !== null) {
                    cleanedData.attributes.unit_of_measurement = attrs.unit_of_measurement;
                }
                if (attrs.device_class !== undefined && attrs.device_class !== null) {
                    cleanedData.attributes.device_class = attrs.device_class;
                }
                break;
        }

        // 添加用户友好的描述
        cleanedData.description = this.generateDeviceDescription(entityData, cleanedData);

        return cleanedData;
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
     * 输出清理：只返回 message.content，自动解析 JSON 字符串为对象
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
            
            // 处理 model 参数：自动识别 OpenAI 模型
            let finalOptions = { ...options };
            if (options.model) {
                if (Array.isArray(options.model)) {
                    // 从数组中选择 OpenAI 模型（gpt-开头的）
                    const openaiModel = options.model.find(m => 
                        m.startsWith('gpt-') || m.startsWith('GPT-') || m.includes('turbo')
                    );
                    if (openaiModel) {
                        finalOptions.model = openaiModel;
                        this.logger.info(`[OpenAI] Auto-selected model: ${openaiModel}`);
                    } else {
                        // 使用默认模型
                        finalOptions.model = 'gpt-3.5-turbo';
                        this.logger.info('[OpenAI] No OpenAI model found in array, using default');
                    }
                } else if (typeof options.model === 'object') {
                    // 从对象中提取 OpenAI 模型
                    const models = Object.keys(options.model).length > 0 ? 
                        Object.keys(options.model) : Object.values(options.model);
                    const openaiModel = models.find(m => 
                        m && (m.startsWith('gpt-') || m.startsWith('GPT-') || m.includes('turbo'))
                    );
                    if (openaiModel) {
                        finalOptions.model = openaiModel;
                        this.logger.info(`[OpenAI] Auto-selected model: ${openaiModel}`);
                    } else {
                        finalOptions.model = 'gpt-3.5-turbo';
                        this.logger.info('[OpenAI] No OpenAI model found in object, using default');
                    }
                }
                // 如果是字符串，保持不变
            }
            
            const result = await module.sendSimpleChat(system_prompt, user_prompt, finalOptions);
            
            if (result.success) {
                // 提取 content
                let content = result.data?.response_text || result.data?.message?.content || result.data?.content;
                
                if (!content) {
                    return res.status(500).json({
                        success: false,
                        error: 'No content in OpenAI response'
                    });
                }
                
                // 尝试将 content 解析为 JSON 对象
                let parsedContent;
                try {
                    parsedContent = JSON.parse(content);
                    this.logger.info('[Simple Chat] Content parsed as JSON object');
                } catch (e) {
                    // 如果不是 JSON，保持原字符串
                    parsedContent = content;
                    this.logger.info('[Simple Chat] Content is plain text');
                }
                
                // 只返回清理后的数据
                res.json(parsedContent);
            } else {
            res.json(result);
            }
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
     * 与 OpenAI simple-chat 接口兼容
     * 支持自动模型识别
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
            
            // 处理 model 参数：自动识别 Gemini 模型
            let finalOptions = { ...options };
            if (options.model) {
                if (Array.isArray(options.model)) {
                    // 从数组中选择 Gemini 模型
                    const geminiModel = options.model.find(m => 
                        m.includes('gemini') || m.includes('Gemini')
                    );
                    if (geminiModel) {
                        finalOptions.model = geminiModel;
                        this.logger.info(`[Gemini] Auto-selected model: ${geminiModel}`);
                    } else {
                        // 使用默认模型
                        finalOptions.model = 'gemini-2.5-flash';
                        this.logger.info('[Gemini] No Gemini model found in array, using default');
                    }
                } else if (typeof options.model === 'object') {
                    // 从对象中提取 Gemini 模型（支持 Set 格式）
                    const models = Object.keys(options.model).length > 0 ? 
                        Object.keys(options.model) : Object.values(options.model);
                    const geminiModel = models.find(m => 
                        m && (m.includes('gemini') || m.includes('Gemini'))
                    );
                    if (geminiModel) {
                        finalOptions.model = geminiModel;
                        this.logger.info(`[Gemini] Auto-selected model: ${geminiModel}`);
                    } else {
                        finalOptions.model = 'gemini-2.5-flash';
                        this.logger.info('[Gemini] No Gemini model found in object, using default');
                    }
                }
                // 如果是字符串，保持不变
            }
            
            const result = await module.sendSimpleChat(system_prompt, user_prompt, finalOptions);
            
            if (result.success) {
                // 提取 content，与 OpenAI 保持一致的输出格式
                let content = result.data?.response_text || result.data?.message?.content || result.data?.content;
                
                if (!content) {
                    return res.status(500).json({
                        success: false,
                        error: 'No content in Gemini response'
                    });
                }
                
                // 清理 Markdown 代码块标记
                content = this.cleanMarkdownCodeBlock(content);
                
                // 尝试将 content 解析为 JSON 对象
                let parsedContent;
                try {
                    parsedContent = JSON.parse(content);
                    this.logger.info('[Gemini Simple Chat] Content parsed as JSON object');
                } catch (e) {
                    // 如果不是 JSON，保持原字符串
                    parsedContent = content;
                    this.logger.info('[Gemini Simple Chat] Content is plain text');
                }
                
                // 只返回清理后的数据
                res.json(parsedContent);
            } else {
            res.json(result);
            }
        } catch (error) {
            this.logger.error('Gemini simple chat error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // =================
    // DeepSeek API Handlers
    // =================

    /**
     * 获取DeepSeek可用模型列表
     */
    async handleGetDeepSeekModels(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'deepseek') {
                return res.status(404).json({ success: false, error: 'DeepSeek module not found' });
            }
            
            if (typeof module.getModels !== 'function') {
                return res.status(400).json({ success: false, error: 'Models not supported by this module' });
            }
            
            const result = await module.getModels();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 测试DeepSeek连接
     */
    async handleDeepSeekTestConnection(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'deepseek') {
                return res.status(404).json({ success: false, error: 'DeepSeek module not found' });
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
     * DeepSeek聊天API（完整消息数组）
     */
    async handleDeepSeekChat(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'deepseek') {
                return res.status(404).json({ success: false, error: 'DeepSeek module not found' });
            }
            
            if (typeof module.sendChatMessage !== 'function') {
                return res.status(400).json({ success: false, error: 'Chat not supported by this module' });
            }
            
            const { messages, options } = req.body;
            
            if (!messages || !Array.isArray(messages)) {
                return res.status(400).json({ success: false, error: 'Messages array is required' });
            }
            
            const result = await module.sendChatMessage(messages, options || {});
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * DeepSeek简单聊天API（系统提示词 + 用户提示词）
     * 输出清理：只返回 message.content，自动解析 JSON 字符串为对象
     */
    async handleDeepSeekSimpleChat(req, res) {
        try {
            const { module: moduleName } = req.params;
            const module = this.moduleManager.getModule(moduleName);
            
            if (!module || moduleName !== 'deepseek') {
                return res.status(404).json({ success: false, error: 'DeepSeek module not found' });
            }
            
            if (typeof module.sendSimpleChat !== 'function') {
                return res.status(400).json({ success: false, error: 'Simple chat not supported by this module' });
            }
            
            const { system_prompt, user_prompt, options = {} } = req.body;
            
            if (!system_prompt && !user_prompt) {
                return res.status(400).json({ success: false, error: 'At least one prompt (system_prompt or user_prompt) is required' });
            }
            
            // 处理 model 参数：自动识别 DeepSeek 模型
            let finalOptions = { ...options };
            if (options.model) {
                if (Array.isArray(options.model)) {
                    // 从数组中选择 DeepSeek 模型
                    const deepseekModel = options.model.find(m => 
                        m.includes('deepseek') || m.includes('DeepSeek')
                    );
                    if (deepseekModel) {
                        finalOptions.model = deepseekModel;
                        this.logger.info(`[DeepSeek] Auto-selected model: ${deepseekModel}`);
                    } else {
                        // 使用默认模型
                        finalOptions.model = 'deepseek-chat';
                        this.logger.info('[DeepSeek] No DeepSeek model found in array, using default');
                    }
                } else if (typeof options.model === 'object') {
                    // 从对象中提取 DeepSeek 模型
                    const models = Object.keys(options.model).length > 0 ? 
                        Object.keys(options.model) : Object.values(options.model);
                    const deepseekModel = models.find(m => 
                        m && (m.includes('deepseek') || m.includes('DeepSeek'))
                    );
                    if (deepseekModel) {
                        finalOptions.model = deepseekModel;
                        this.logger.info(`[DeepSeek] Auto-selected model: ${deepseekModel}`);
                    } else {
                        finalOptions.model = 'deepseek-chat';
                        this.logger.info('[DeepSeek] No DeepSeek model found in object, using default');
                    }
                }
                // 如果是字符串，保持不变
            }
            
            const result = await module.sendSimpleChat(system_prompt, user_prompt, finalOptions);
            
            if (result.success) {
                // 提取 content，与 OpenAI/Gemini 保持一致的输出格式
                let content = result.data?.response_text || result.data?.message?.content || result.data?.content;
                
                if (!content) {
                    return res.status(500).json({
                        success: false,
                        error: 'No content in DeepSeek response'
                    });
                }
                
                // 清理 Markdown 代码块标记
                content = this.cleanMarkdownCodeBlock(content);
                
                // 尝试将 content 解析为 JSON 对象
                let parsedContent;
                try {
                    parsedContent = JSON.parse(content);
                    this.logger.info('[DeepSeek Simple Chat] Content parsed as JSON object');
                } catch (e) {
                    // 如果不是 JSON，保持原字符串
                    parsedContent = content;
                    this.logger.info('[DeepSeek Simple Chat] Content is plain text');
                }
                
                // 只返回清理后的数据
                res.json(parsedContent);
            } else {
            res.json(result);
            }
        } catch (error) {
            this.logger.error('DeepSeek simple chat error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // =================
    // Home Assistant API Handlers
    // =================

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

    /* ==================== Node-RED API Handlers ==================== */

    /**
     * 获取 Node-RED flows
     */
    async handleNodeREDGetFlows(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'nodered') {
                return res.status(404).json({ success: false, error: 'Node-RED module not found' });
            }
            
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials configured' });
            }
            
            const result = await module.getFlows(credentials.data);
            res.json(result);
        } catch (error) {
            this.logger.error('Get flows error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 部署 Node-RED flows
     */
    async handleNodeREDDeployFlows(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { flows } = req.body;
            
            if (!flows) {
                return res.status(400).json({ success: false, error: 'Flows data is required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'nodered') {
                return res.status(404).json({ success: false, error: 'Node-RED module not found' });
            }
            
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials configured' });
            }
            
            const result = await module.deployFlows(credentials.data, flows);
            res.json(result);
        } catch (error) {
            this.logger.error('Deploy flows error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 上传并部署 Node-RED flow 文件
     */
    async handleNodeREDUploadFlow(req, res) {
        try {
            const { module: moduleName } = req.params;
            const { flowData, filename } = req.body;
            
            if (!flowData) {
                return res.status(400).json({ success: false, error: 'Flow data is required' });
            }
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'nodered') {
                return res.status(404).json({ success: false, error: 'Node-RED module not found' });
            }
            
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials configured' });
            }
            
            // Parse flow data if it's a string
            let flows;
            try {
                flows = typeof flowData === 'string' ? JSON.parse(flowData) : flowData;
            } catch (error) {
                return res.status(400).json({ success: false, error: 'Invalid flow JSON format' });
            }
            
            // Deploy the flows
            const result = await module.deployFlows(credentials.data, flows);
            res.json(result);
        } catch (error) {
            this.logger.error('Upload flow error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 验证 Node-RED flows
     */
    async handleNodeREDValidateFlows(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'nodered') {
                return res.status(404).json({ success: false, error: 'Node-RED module not found' });
            }
            
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials configured' });
            }
            
            // Get current flows and validate
            const flowsResult = await module.getFlows(credentials.data);
            if (!flowsResult.success) {
                return res.json({ success: false, error: 'Failed to get flows', details: flowsResult.error });
            }
            
            const flows = flowsResult.data || [];
            const flowTabs = flows.filter(f => f.type === 'tab');
            const issues = [];
            
            // Basic validation
            flowTabs.forEach(tab => {
                const nodes = flows.filter(n => n.z === tab.id);
                if (nodes.length === 0) {
                    issues.push(`Flow "${tab.label || tab.id}" has no nodes`);
                }
                if (tab.disabled) {
                    issues.push(`Flow "${tab.label || tab.id}" is disabled`);
                }
            });
            
            res.json({
                success: true,
                data: {
                    valid: issues.length === 0,
                    flowCount: flowTabs.length,
                    totalNodes: flows.length,
                    issues: issues
                }
            });
        } catch (error) {
            this.logger.error('Validate flows error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 获取 Node-RED 备份列表
     */
    async handleNodeREDGetBackups(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'nodered') {
                return res.status(404).json({ success: false, error: 'Node-RED module not found' });
            }
            
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials configured' });
            }
            
            const result = await module.getBackups(credentials.data);
            res.json(result);
        } catch (error) {
            this.logger.error('Get backups error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 创建 Node-RED 备份
     */
    async handleNodeREDCreateBackup(req, res) {
        try {
            const { module: moduleName } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'nodered') {
                return res.status(404).json({ success: false, error: 'Node-RED module not found' });
            }
            
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials configured' });
            }
            
            const result = await module.backupFlows(credentials.data);
            res.json(result);
        } catch (error) {
            this.logger.error('Create backup error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 恢复 Node-RED 备份
     */
    async handleNodeREDRestoreBackup(req, res) {
        try {
            const { module: moduleName, backupId } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'nodered') {
                return res.status(404).json({ success: false, error: 'Node-RED module not found' });
            }
            
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials configured' });
            }
            
            const result = await module.restoreFlows(credentials.data, backupId);
            res.json(result);
        } catch (error) {
            this.logger.error('Restore backup error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * 删除 Node-RED 备份
     */
    async handleNodeREDDeleteBackup(req, res) {
        try {
            const { module: moduleName, backupId } = req.params;
            
            const module = this.moduleManager.getModule(moduleName);
            if (!module || moduleName !== 'nodered') {
                return res.status(404).json({ success: false, error: 'Node-RED module not found' });
            }
            
            const credentials = await module.getCredentials();
            if (!credentials.success) {
                return res.status(400).json({ success: false, error: 'No credentials configured' });
            }
            
            const result = await module.deleteBackup(credentials.data, backupId);
            res.json(result);
        } catch (error) {
            this.logger.error('Delete backup error:', error);
            res.status(500).json({ success: false, error: error.message });
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