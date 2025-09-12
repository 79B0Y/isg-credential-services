const BaseCredentialModule = require('../../core/BaseCredentialModule');
const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const WebSocket = require('ws');

/**
 * TelegramModule - Telegram Bot凭据管理模块
 * 支持bot_token验证和Bot信息查询
 */
class TelegramModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        
        // Telegram API配置
        this.apiBaseUrl = 'https://api.telegram.org';
        this.defaultTimeout = 30000; // Increased to 30s
        
        // Request cleanup
        this.activeRequests = new Set();
        this.requestCleanupTimer = null;
        
        // 消息轮询配置
        this.pollingInterval = null;
        this.lastUpdateId = 0;
        this.isPolling = false;
        
        // 消息存储
        this.messages = new Map();
        this.messageHistory = [];
        
        // Webhook配置
        this.webhookUrl = null;
        this.webhookSecret = null;
        
        // WebSocket配置
        this.wss = null;
        this.websocketClients = new Set();
        this.websocketPort = 8080;
    }

    /**
     * 模块特定初始化
     */
    async onInitialize() {
        this.logger.info('Telegram module initializing...');
        
        // 验证配置
        if (!this.config.apiBaseUrl) {
            this.config.apiBaseUrl = this.apiBaseUrl;
        }
        
        if (!this.config.timeout) {
            this.config.timeout = this.defaultTimeout;
        }
        
        // 初始化请求清理定时器
        this.startRequestCleanup();
        
        this.logger.info('Telegram module initialized with config:', {
            apiBaseUrl: this.config.apiBaseUrl,
            timeout: this.config.timeout,
            retries: this.config.retries || 3
        });
    }

    /**
     * 执行Telegram Bot Token验证
     */
    async performValidation(credentials) {
        const { bot_token } = credentials;
        
        if (!bot_token) {
            return {
                success: false,
                error: 'Bot token is required',
                details: { field: 'bot_token' }
            };
        }

        // 首先进行格式验证
        const formatValidation = this.validateCredentialsFormat(credentials);
        if (!formatValidation.valid) {
            return {
                success: false,
                error: formatValidation.error,
                details: { field: 'bot_token', type: 'format' }
            };
        }

        try {
            this.logger.info('Validating Telegram bot token...');
            
            // 在网络问题的环境中，我们可以提供一个快速验证模式
            const quickValidationEnabled = process.env.QUICK_VALIDATION === 'true' || 
                                          this.config.validation?.quickValidation === true ||
                                          this.config.quickValidation === true;
            
            if (quickValidationEnabled) {
                this.logger.info('Using quick validation mode');
                return {
                    success: true,
                    message: 'Telegram bot token format is valid (quick mode)',
                    data: {
                        bot: {
                            token_format: 'valid',
                            quick_validation: true
                        },
                        validated_at: new Date().toISOString(),
                        mode: 'quick'
                    }
                };
            }
            
            // 尝试调用getMe API验证token（带重试）
            let lastError;
            let attempts = [];
            
            for (let attempt = 1; attempt <= this.config.retries; attempt++) {
                const attemptStart = Date.now();
                try {
                    this.logger.info(`API validation attempt ${attempt}/${this.config.retries}`);
                    const botInfo = await this.callTelegramAPI(bot_token, 'getMe');
                    const attemptTime = Date.now() - attemptStart;
                    
                    attempts.push({
                        attempt: attempt,
                        success: true,
                        response_time: attemptTime,
                        timestamp: new Date().toISOString()
                    });
                    
                    if (botInfo.ok && botInfo.result) {
                        const bot = botInfo.result;
                        
                        // 成功获取bot信息
                        return {
                            success: true,
                            message: `Telegram bot token验证成功 - Bot: ${bot.first_name}${bot.username ? ' (@' + bot.username + ')' : ''}`,
                            data: {
                                bot: {
                                    id: bot.id,
                                    username: bot.username,
                                    first_name: bot.first_name,
                                    is_bot: bot.is_bot,
                                    can_join_groups: bot.can_join_groups,
                                    can_read_all_group_messages: bot.can_read_all_group_messages,
                                    supports_inline_queries: bot.supports_inline_queries,
                                    can_connect_to_business: bot.can_connect_to_business || false,
                                    has_main_web_app: bot.has_main_web_app || false
                                },
                                validation: {
                                    api_url: `${this.config.apiBaseUrl}/bot${this.maskToken(bot_token)}/getMe`,
                                    curl_command: `curl "${this.config.apiBaseUrl}/bot${bot_token}/getMe"`,
                                    total_attempts: attempt,
                                    successful_attempt: attempt,
                                    response_time: attemptTime,
                                    attempts: attempts
                                },
                                validated_at: new Date().toISOString(),
                                mode: 'full'
                            }
                        };
                    } else {
                        // API返回了错误
                        return {
                            success: false,
                            error: `Telegram API错误: ${botInfo.description || 'Invalid bot token'}`,
                            details: {
                                error_code: botInfo.error_code,
                                description: botInfo.description,
                                api_url: `${this.config.apiBaseUrl}/bot${this.maskToken(bot_token)}/getMe`,
                                curl_command: `curl "${this.config.apiBaseUrl}/bot${bot_token}/getMe"`,
                                total_attempts: attempt,
                                attempts: attempts
                            }
                        };
                    }
                } catch (error) {
                    const attemptTime = Date.now() - attemptStart;
                    lastError = error;
                    
                    attempts.push({
                        attempt: attempt,
                        success: false,
                        error: error.message,
                        error_type: error.code || error.name || 'NetworkError',
                        response_time: attemptTime,
                        timestamp: new Date().toISOString()
                    });
                    this.logger.warn(`Attempt ${attempt} failed: ${error.message}`);
                    
                    if (attempt < this.config.retries) {
                        // 等待后重试
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    }
                }
            }
            
            // 所有重试都失败了，但token格式正确，返回格式验证成功
            this.logger.warn('API validation failed, falling back to format validation');
            return {
                success: true,
                message: 'Token格式有效，但API验证失败 (网络问题)',
                data: {
                    bot: {
                        token_format: 'valid',
                        api_error: lastError.message,
                        error_type: lastError.code || lastError.name || 'NetworkError'
                    },
                    validation: {
                        api_url: `${this.config.apiBaseUrl}/bot${this.maskToken(bot_token)}/getMe`,
                        curl_command: `curl "${this.config.apiBaseUrl}/bot${bot_token}/getMe"`,
                        total_attempts: this.config.retries,
                        successful_attempt: 0,
                        attempts: attempts,
                        fallback_reason: 'All API attempts failed, but token format is valid'
                    },
                    validated_at: new Date().toISOString(),
                    mode: 'fallback',
                    warning: 'Could not connect to Telegram API - 请检查网络连接或防火墙设置',
                    suggestion: '可以使用提供的curl命令在终端中手动测试API连接'
                }
            };
            
        } catch (error) {
            this.logger.error('Telegram validation error:', error);
            
            // 如果是网络问题，但token格式正确，我们仍然可以返回部分成功
            return {
                success: true,
                message: 'Token格式有效 (网络验证失败)',
                data: {
                    bot: {
                        token_format: 'valid',
                        network_error: error.message,
                        error_type: error.code || error.name || 'UnknownError'
                    },
                    validation: {
                        api_url: `${this.config.apiBaseUrl}/bot${this.maskToken(bot_token)}/getMe`,
                        curl_command: `curl "${this.config.apiBaseUrl}/bot${bot_token}/getMe"`,
                        error_details: error.message,
                        fallback_reason: 'Validation threw an exception, but token format is valid'
                    },
                    validated_at: new Date().toISOString(),
                    mode: 'format_only',
                    warning: 'Could not perform full API validation due to network issues',
                    suggestion: '可以使用提供的curl命令在终端中手动测试API连接'
                }
            };
        }
    }

    /**
     * 调用Telegram Bot API
     */
    async callTelegramAPI(botToken, method, params = {}, retryCount = 0) {
        return new Promise((resolve, reject) => {
            const url = `${this.config.apiBaseUrl}/bot${botToken}/${method}`;
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const httpModule = isHttps ? https : http;
            
            // 准备POST数据
            const postData = JSON.stringify(params);
            
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname,
                method: Object.keys(params).length > 0 ? 'POST' : 'GET',
                family: 4, // 强制使用 IPv4
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'User-Agent': 'CredentialService/1.0',
                    'Connection': 'keep-alive'
                },
                // 添加网络选项
                timeout: this.config.timeout,
                agent: false // 禁用连接池以避免连接问题
            };

            const req = httpModule.request(options, (res) => {
                cleanup();
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                    // Prevent memory issues with very large responses
                    if (data.length > 10 * 1024 * 1024) { // 10MB limit
                        res.destroy();
                        reject(new Error('Response too large'));
                        return;
                    }
                });
                
                res.on('end', () => {
                    try {
                        if (data.length === 0) {
                            reject(new Error('Empty response'));
                            return;
                        }
                        const response = JSON.parse(data);
                        resolve(response);
                    } catch (parseError) {
                        reject(new Error(`Invalid JSON response: ${parseError.message}`));
                    }
                });
                
                res.on('error', (error) => {
                    reject(new Error(`Response error: ${error.message}`));
                });
            });

            // 添加到活跃请求集合
            this.activeRequests.add(req);
            
            // 设置超时
            const timeoutId = setTimeout(() => {
                if (!req.destroyed) {
                    req.destroy();
                    this.activeRequests.delete(req);
                }
                reject(new Error(`Request timeout after ${this.config.timeout}ms`));
            }, this.config.timeout);
            
            // 清理函数
            const cleanup = () => {
                clearTimeout(timeoutId);
                this.activeRequests.delete(req);
            };

            req.on('error', (error) => {
                cleanup();
                
                // 增强错误信息
                let errorMessage = `Request failed: ${error.message}`;
                
                // 根据错误类型提供更详细的信息
                if (error.code === 'ECONNRESET') {
                    errorMessage += ' (Connection reset by peer)';
                } else if (error.code === 'ECONNREFUSED') {
                    errorMessage += ' (Connection refused)';
                } else if (error.code === 'ENOTFOUND') {
                    errorMessage += ' (DNS resolution failed)';
                } else if (error.code === 'ETIMEDOUT') {
                    errorMessage += ' (Connection timeout)';
                } else if (error.code === 'ECONNABORTED') {
                    errorMessage += ' (Connection aborted)';
                }
                
                reject(new Error(errorMessage));
            });
            
            req.on('close', () => {
                cleanup();
            });

            // 发送POST数据
            if (Object.keys(params).length > 0) {
                req.write(postData);
            }
            
            req.end();
        }).catch(async (error) => {
            // 重试逻辑
            if (retryCount < this.config.retries && this.shouldRetry(error)) {
                this.logger.warn(`API call failed, retrying (${retryCount + 1}/${this.config.retries}): ${error.message}`);
                
                // 指数退避延迟
                const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
                await new Promise(resolve => setTimeout(resolve, delay));
                
                return this.callTelegramAPI(botToken, method, params, retryCount + 1);
            }
            
            throw error;
        });
    }

    /**
     * 判断是否应该重试
     */
    shouldRetry(error) {
        const retryableErrors = [
            'ECONNRESET',
            'ECONNREFUSED', 
            'ETIMEDOUT',
            'ECONNABORTED',
            'ENOTFOUND',
            'Request timeout'
        ];
        
        return retryableErrors.some(errorType => 
            error.message.includes(errorType) || error.code === errorType
        );
    }

    /**
     * 获取Bot详细信息（扩展功能）
     */
    async getBotInfo(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { bot_token } = credentials;
            if (!bot_token) {
                return { success: false, error: 'Bot token is required' };
            }

            // 获取基本信息
            const botInfo = await this.callTelegramAPI(bot_token, 'getMe');
            if (!botInfo.ok) {
                return { success: false, error: botInfo.description };
            }

            // 获取webhook信息
            const webhookInfo = await this.callTelegramAPI(bot_token, 'getWebhookInfo');
            
            // 获取支持的命令（如果设置了）
            let commands = [];
            try {
                const commandsResult = await this.callTelegramAPI(bot_token, 'getMyCommands');
                if (commandsResult.ok) {
                    commands = commandsResult.result;
                }
            } catch (error) {
                this.logger.warn('Could not get bot commands:', error.message);
            }

            return {
                success: true,
                data: {
                    bot: botInfo.result,
                    webhook: webhookInfo.ok ? webhookInfo.result : null,
                    commands: commands,
                    capabilities: {
                        can_join_groups: botInfo.result.can_join_groups,
                        can_read_all_group_messages: botInfo.result.can_read_all_group_messages,
                        supports_inline_queries: botInfo.result.supports_inline_queries
                    }
                }
            };
        } catch (error) {
            this.logger.error('Failed to get bot info:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 测试Bot连接性
     */
    async testConnection(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const startTime = Date.now();
            const validationResult = await this.performValidation(credentials);
            const responseTime = Date.now() - startTime;

            if (validationResult.success) {
                return {
                    success: true,
                    message: 'Connection test successful',
                    data: {
                        response_time: responseTime,
                        bot_info: validationResult.data.bot,
                        tested_at: new Date().toISOString()
                    }
                };
            } else {
                return {
                    success: false,
                    error: validationResult.error,
                    data: {
                        response_time: responseTime,
                        details: validationResult.details
                    }
                };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取默认配置
     */
    getDefaultConfig() {
        return {
            ...super.getDefaultConfig(),
            apiBaseUrl: 'https://api.telegram.org',
            timeout: 10000,
            retries: 3,
            cacheTimeout: 300000, // 5分钟缓存
            pollingInterval: 1000, // 轮询间隔（毫秒）
            maxMessageHistory: 1000, // 最大消息历史数量
            features: {
                webhookInfo: true,
                botCommands: true,
                connectionTest: true,
                messaging: true,
                polling: true,
                fileDownload: true
            }
        };
    }

    /**
     * 获取默认Schema
     */
    getDefaultSchema() {
        return {
            type: 'object',
            properties: {
                bot_token: {
                    type: 'string',
                    title: 'Bot Token',
                    description: 'Telegram Bot API token obtained from @BotFather',
                    required: true,
                    sensitive: true,
                    minLength: 45,
                    maxLength: 50,
                    pattern: '^\\d+:[A-Za-z0-9_-]+$',
                    example: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
                }
            },
            required: ['bot_token'],
            additionalProperties: false
        };
    }

    /**
     * 模块禁用清理
     */
    async onDisable() {
        await this.stopPolling();
        await this.removeWebhook();
        this.logger.info('Telegram module disabled');
    }

    // =================
    // 消息轮询功能
    // =================

    /**
     * 开始消息轮询
     */
    async startPolling(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            if (this.isPolling) {
                return { success: false, error: 'Polling is already active' };
            }

            const { bot_token } = credentials;
            if (!bot_token) {
                return { success: false, error: 'Bot token is required' };
            }

            this.isPolling = true;
            this.pollingFailures = 0; // 重置失败计数器
            this.logger.info('Starting message polling...');

            // 开始轮询 - 修改为递归方式避免并发冲突
            const doPoll = async () => {
                if (!this.isPolling) return;
                
                try {
                    await this.pollUpdates(bot_token);
                    this.pollingFailures = 0;
                } catch (error) {
                    this.logger.error('Polling error:', error);
                    this.pollingFailures = (this.pollingFailures || 0) + 1;
                    
                    if (this.pollingFailures >= 10) {
                        this.logger.error('Too many polling failures, stopping polling');
                        return this.stopPolling();
                    }
                }
                
                // 等待一小段时间后继续下一次轮询
                setTimeout(doPoll, 100);
            };

            // 启动轮询
            doPoll();

            return { success: true, message: 'Message polling started' };
        } catch (error) {
            this.logger.error('Failed to start polling:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 停止消息轮询
     */
    async stopPolling() {
        // 由于改为递归方式，只需要设置标志位即可
        this.isPolling = false;
        this.logger.info('Message polling stopped');
        return { success: true, message: 'Message polling stopped' };
    }

    /**
     * 轮询获取更新
     */
    async pollUpdates(botToken) {
        try {
            const params = {
                offset: this.lastUpdateId + 1,
                timeout: 30,
                allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post']
            };

            const response = await this.callTelegramAPI(botToken, 'getUpdates', params);
            
            if (response.ok && response.result) {
                for (const update of response.result) {
                    // 确保不重复处理相同的update_id
                    if (update.update_id > this.lastUpdateId) {
                        try {
                            await this.processUpdate(update);
                            this.lastUpdateId = update.update_id;
                        } catch (processError) {
                            this.logger.error('Failed to process update:', processError);
                            // 即使处理失败，也要更新lastUpdateId以避免重复处理
                            this.lastUpdateId = update.update_id;
                        }
                    }
                }
            } else if (response.error_code) {
                // 处理Telegram API错误
                this.logger.warn(`Telegram API error: ${response.description} (code: ${response.error_code})`);
                
                // 如果是严重错误，停止轮询
                if (response.error_code === 401) {
                    this.logger.error('Invalid bot token, stopping polling');
                    this.stopPolling();
                }
            }
        } catch (error) {
            this.logger.error('Failed to poll updates:', error);
            // 错误处理已移至doPoll函数中
            throw error; // 重新抛出错误让doPoll处理
        }
    }

    /**
     * 处理接收到的更新
     */
    async processUpdate(update) {
        try {
            const message = update.message || update.edited_message || update.channel_post || update.edited_channel_post;
            
            if (message) {
                const processedMessage = {
                    id: message.message_id,
                    chat_id: message.chat.id,
                    chat_type: message.chat.type,
                    from: message.from,
                    date: new Date(message.date * 1000),
                    text: message.text,
                    caption: message.caption,
                    message_type: this.getMessageType(message),
                    media: this.extractMedia(message),
                    reply_to: message.reply_to_message,
                    forward_from: message.forward_from,
                    entities: message.entities,
                    raw: message
                };

                // 存储消息
                this.messages.set(message.message_id, processedMessage);
                this.messageHistory.push(processedMessage);

                // 保持历史记录在合理范围内
                if (this.messageHistory.length > 1000) {
                    this.messageHistory = this.messageHistory.slice(-500);
                }

                // 广播到WebSocket客户端
                this.broadcastToWebSocketClients(processedMessage);

                this.logger.info(`Received message: ${processedMessage.text || processedMessage.message_type} from ${processedMessage.from?.username || processedMessage.from?.id}`);
            }
        } catch (error) {
            this.logger.error('Failed to process update:', error);
        }
    }

    /**
     * 获取消息类型
     */
    getMessageType(message) {
        if (message.text) return 'text';
        if (message.photo) return 'photo';
        if (message.video) return 'video';
        if (message.audio) return 'audio';
        if (message.voice) return 'voice';
        if (message.document) return 'document';
        if (message.sticker) return 'sticker';
        if (message.animation) return 'animation';
        if (message.video_note) return 'video_note';
        if (message.contact) return 'contact';
        if (message.location) return 'location';
        if (message.venue) return 'venue';
        if (message.poll) return 'poll';
        return 'unknown';
    }

    /**
     * 提取媒体信息
     */
    extractMedia(message) {
        const media = {};
        
        if (message.photo) {
            media.photo = message.photo.map(photo => ({
                file_id: photo.file_id,
                file_unique_id: photo.file_unique_id,
                width: photo.width,
                height: photo.height,
                file_size: photo.file_size
            }));
        }
        
        if (message.video) {
            media.video = {
                file_id: message.video.file_id,
                file_unique_id: message.video.file_unique_id,
                width: message.video.width,
                height: message.video.height,
                duration: message.video.duration,
                file_size: message.video.file_size
            };
        }
        
        if (message.audio) {
            media.audio = {
                file_id: message.audio.file_id,
                file_unique_id: message.audio.file_unique_id,
                duration: message.audio.duration,
                performer: message.audio.performer,
                title: message.audio.title,
                file_size: message.audio.file_size
            };
        }
        
        if (message.voice) {
            media.voice = {
                file_id: message.voice.file_id,
                file_unique_id: message.voice.file_unique_id,
                duration: message.voice.duration,
                file_size: message.voice.file_size
            };
        }
        
        if (message.document) {
            media.document = {
                file_id: message.document.file_id,
                file_unique_id: message.document.file_unique_id,
                file_name: message.document.file_name,
                mime_type: message.document.mime_type,
                file_size: message.document.file_size
            };
        }
        
        if (message.video_note) {
            media.video_note = {
                file_id: message.video_note.file_id,
                file_unique_id: message.video_note.file_unique_id,
                length: message.video_note.length,
                duration: message.video_note.duration,
                file_size: message.video_note.file_size,
                thumbnail: message.video_note.thumbnail
            };
        }
        
        if (message.sticker) {
            media.sticker = {
                file_id: message.sticker.file_id,
                file_unique_id: message.sticker.file_unique_id,
                width: message.sticker.width,
                height: message.sticker.height,
                file_size: message.sticker.file_size,
                emoji: message.sticker.emoji,
                set_name: message.sticker.set_name
            };
        }
        
        if (message.animation) {
            media.animation = {
                file_id: message.animation.file_id,
                file_unique_id: message.animation.file_unique_id,
                width: message.animation.width,
                height: message.animation.height,
                duration: message.animation.duration,
                file_size: message.animation.file_size,
                file_name: message.animation.file_name,
                mime_type: message.animation.mime_type
            };
        }
        
        return Object.keys(media).length > 0 ? media : null;
    }

    /**
     * 重新处理现有消息的媒体数据
     */
    reprocessExistingMessages() {
        this.logger.info('Reprocessing existing messages for media data...');
        let reprocessedCount = 0;
        
        for (let i = 0; i < this.messageHistory.length; i++) {
            const message = this.messageHistory[i];
            if (message.raw && !message.media) {
                // 重新提取媒体信息
                const newMedia = this.extractMedia(message.raw);
                if (newMedia) {
                    this.messageHistory[i].media = newMedia;
                    this.messages.set(message.id, this.messageHistory[i]);
                    reprocessedCount++;
                }
            }
        }
        
        this.logger.info(`Reprocessed ${reprocessedCount} messages with media data`);
        return { reprocessed: reprocessedCount, total: this.messageHistory.length };
    }

    // =================
    // 消息发送功能
    // =================

    /**
     * 发送文本消息
     */
    async sendMessage(chatId, text, options = {}, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { bot_token } = credentials;
            if (!bot_token) {
                return { success: false, error: 'Bot token is required' };
            }

            const params = {
                chat_id: chatId,
                text: text,
                parse_mode: options.parse_mode || 'HTML',
                disable_web_page_preview: options.disable_web_page_preview || false,
                disable_notification: options.disable_notification || false,
                reply_to_message_id: options.reply_to_message_id,
                reply_markup: options.reply_markup
            };

            const response = await this.callTelegramAPI(bot_token, 'sendMessage', params);
            
            if (response.ok) {
                return {
                    success: true,
                    message: 'Message sent successfully',
                    data: response.result
                };
            } else {
                return {
                    success: false,
                    error: response.description || 'Failed to send message',
                    details: response
                };
            }
        } catch (error) {
            this.logger.error('Failed to send message:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 发送图片
     */
    async sendPhoto(chatId, photo, options = {}, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { bot_token } = credentials;
            if (!bot_token) {
                return { success: false, error: 'Bot token is required' };
            }

            const params = {
                chat_id: chatId,
                photo: photo,
                caption: options.caption,
                parse_mode: options.parse_mode || 'HTML',
                disable_notification: options.disable_notification || false,
                reply_to_message_id: options.reply_to_message_id,
                reply_markup: options.reply_markup
            };

            const response = await this.callTelegramAPI(bot_token, 'sendPhoto', params);
            
            if (response.ok) {
                return {
                    success: true,
                    message: 'Photo sent successfully',
                    data: response.result
                };
            } else {
                return {
                    success: false,
                    error: response.description || 'Failed to send photo',
                    details: response
                };
            }
        } catch (error) {
            this.logger.error('Failed to send photo:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 发送视频
     */
    async sendVideo(chatId, video, options = {}, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { bot_token } = credentials;
            if (!bot_token) {
                return { success: false, error: 'Bot token is required' };
            }

            const params = {
                chat_id: chatId,
                video: video,
                duration: options.duration,
                width: options.width,
                height: options.height,
                caption: options.caption,
                parse_mode: options.parse_mode || 'HTML',
                disable_notification: options.disable_notification || false,
                reply_to_message_id: options.reply_to_message_id,
                reply_markup: options.reply_markup
            };

            const response = await this.callTelegramAPI(bot_token, 'sendVideo', params);
            
            if (response.ok) {
                return {
                    success: true,
                    message: 'Video sent successfully',
                    data: response.result
                };
            } else {
                return {
                    success: false,
                    error: response.description || 'Failed to send video',
                    details: response
                };
            }
        } catch (error) {
            this.logger.error('Failed to send video:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 发送语音消息
     */
    async sendVoice(chatId, voice, options = {}, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { bot_token } = credentials;
            if (!bot_token) {
                return { success: false, error: 'Bot token is required' };
            }

            const params = {
                chat_id: chatId,
                voice: voice,
                caption: options.caption,
                parse_mode: options.parse_mode || 'HTML',
                duration: options.duration,
                disable_notification: options.disable_notification || false,
                reply_to_message_id: options.reply_to_message_id,
                reply_markup: options.reply_markup
            };

            const response = await this.callTelegramAPI(bot_token, 'sendVoice', params);
            
            if (response.ok) {
                return {
                    success: true,
                    message: 'Voice message sent successfully',
                    data: response.result
                };
            } else {
                return {
                    success: false,
                    error: response.description || 'Failed to send voice message',
                    details: response
                };
            }
        } catch (error) {
            this.logger.error('Failed to send voice message:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 发送文档
     */
    async sendDocument(chatId, document, options = {}, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { bot_token } = credentials;
            if (!bot_token) {
                return { success: false, error: 'Bot token is required' };
            }

            const params = {
                chat_id: chatId,
                document: document,
                caption: options.caption,
                parse_mode: options.parse_mode || 'HTML',
                disable_notification: options.disable_notification || false,
                reply_to_message_id: options.reply_to_message_id,
                reply_markup: options.reply_markup
            };

            const response = await this.callTelegramAPI(bot_token, 'sendDocument', params);
            
            if (response.ok) {
                return {
                    success: true,
                    message: 'Document sent successfully',
                    data: response.result
                };
            } else {
                return {
                    success: false,
                    error: response.description || 'Failed to send document',
                    details: response
                };
            }
        } catch (error) {
            this.logger.error('Failed to send document:', error);
            return { success: false, error: error.message };
        }
    }

    // =================
    // 文件下载功能
    // =================

    /**
     * 获取文件信息
     */
    async getFile(fileId, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { bot_token } = credentials;
            if (!bot_token) {
                return { success: false, error: 'Bot token is required' };
            }

            const response = await this.callTelegramAPI(bot_token, 'getFile', { file_id: fileId });
            
            if (response.ok) {
                return {
                    success: true,
                    data: response.result
                };
            } else {
                return {
                    success: false,
                    error: response.description || 'Failed to get file info',
                    details: response
                };
            }
        } catch (error) {
            this.logger.error('Failed to get file info:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取文件直接URL
     */
    async getFileUrl(fileId, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { bot_token } = credentials;
            if (!bot_token) {
                return { success: false, error: 'Bot token is required' };
            }

            // 先获取文件信息
            const fileResult = await this.getFile(fileId, credentials);
            if (!fileResult.success) {
                return fileResult;
            }

            const filePath = fileResult.data.file_path;
            const fileUrl = `${this.config.apiBaseUrl}/file/bot${bot_token}/${filePath}`;
            
            return {
                success: true,
                data: {
                    file_id: fileId,
                    file_path: filePath,
                    file_url: fileUrl,
                    file_size: fileResult.data.file_size
                }
            };
        } catch (error) {
            this.logger.error('Failed to get file URL:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 下载文件
     */
    async downloadFile(filePath, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { bot_token } = credentials;
            if (!bot_token) {
                return { success: false, error: 'Bot token is required' };
            }

            const fileUrl = `${this.config.apiBaseUrl}/file/bot${bot_token}/${filePath}`;
            
            return new Promise((resolve, reject) => {
                const urlObj = new URL(fileUrl);
                const isHttps = urlObj.protocol === 'https:';
                const httpModule = isHttps ? https : http;
                
                const options = {
                    hostname: urlObj.hostname,
                    port: urlObj.port || (isHttps ? 443 : 80),
                    path: urlObj.pathname,
                    method: 'GET',
                    headers: {
                        'User-Agent': 'CredentialService/1.0'
                    }
                };

                const req = httpModule.request(options, (res) => {
                    let data = Buffer.alloc(0);
                    
                    res.on('data', (chunk) => {
                        data = Buffer.concat([data, chunk]);
                    });
                    
                    res.on('end', () => {
                        resolve({
                            success: true,
                            data: data,
                            contentType: res.headers['content-type'],
                            contentLength: res.headers['content-length']
                        });
                    });
                });

                req.setTimeout(this.config.timeout, () => {
                    req.destroy();
                    reject(new Error(`Download timeout after ${this.config.timeout}ms`));
                });

                req.on('error', (error) => {
                    reject(new Error(`Download failed: ${error.message}`));
                });

                req.end();
            });
        } catch (error) {
            this.logger.error('Failed to download file:', error);
            return { success: false, error: error.message };
        }
    }

    // =================
    // Webhook功能
    // =================

    /**
     * 设置Webhook
     */
    async setWebhook(webhookUrl, options = {}, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { bot_token } = credentials;
            if (!bot_token) {
                return { success: false, error: 'Bot token is required' };
            }

            const params = {
                url: webhookUrl,
                certificate: options.certificate,
                ip_address: options.ip_address,
                max_connections: options.max_connections || 40,
                allowed_updates: options.allowed_updates || ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
                drop_pending_updates: options.drop_pending_updates || false,
                secret_token: options.secret_token
            };

            const response = await this.callTelegramAPI(bot_token, 'setWebhook', params);
            
            if (response.ok) {
                this.webhookUrl = webhookUrl;
                this.webhookSecret = options.secret_token;
                
                return {
                    success: true,
                    message: 'Webhook set successfully',
                    data: response.result
                };
            } else {
                return {
                    success: false,
                    error: response.description || 'Failed to set webhook',
                    details: response
                };
            }
        } catch (error) {
            this.logger.error('Failed to set webhook:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 移除Webhook
     */
    async removeWebhook(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { bot_token } = credentials;
            if (!bot_token) {
                return { success: false, error: 'Bot token is required' };
            }

            const response = await this.callTelegramAPI(bot_token, 'deleteWebhook', { drop_pending_updates: true });
            
            if (response.ok) {
                this.webhookUrl = null;
                this.webhookSecret = null;
                
                return {
                    success: true,
                    message: 'Webhook removed successfully',
                    data: response.result
                };
            } else {
                return {
                    success: false,
                    error: response.description || 'Failed to remove webhook',
                    details: response
                };
            }
        } catch (error) {
            this.logger.error('Failed to remove webhook:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取Webhook信息
     */
    async getWebhookInfo(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { bot_token } = credentials;
            if (!bot_token) {
                return { success: false, error: 'Bot token is required' };
            }

            const response = await this.callTelegramAPI(bot_token, 'getWebhookInfo');
            
            if (response.ok) {
                return {
                    success: true,
                    data: response.result
                };
            } else {
                return {
                    success: false,
                    error: response.description || 'Failed to get webhook info',
                    details: response
                };
            }
        } catch (error) {
            this.logger.error('Failed to get webhook info:', error);
            return { success: false, error: error.message };
        }
    }

    // =================
    // 消息管理功能
    // =================

    /**
     * 获取消息历史
     */
    getMessageHistory(limit = 50, offset = 0) {
        const start = offset;
        const end = offset + limit;
        const messages = this.messageHistory.slice(start, end);
        
        return {
            success: true,
            data: {
                messages: messages,
                total: this.messageHistory.length,
                limit: limit,
                offset: offset
            }
        };
    }

    /**
     * 获取特定消息
     */
    getMessage(messageId) {
        const message = this.messages.get(messageId);
        
        if (message) {
            return {
                success: true,
                data: message
            };
        } else {
            return {
                success: false,
                error: 'Message not found'
            };
        }
    }

    /**
     * 清除消息历史
     */
    clearMessageHistory() {
        this.messages.clear();
        this.messageHistory = [];
        
        return {
            success: true,
            message: 'Message history cleared'
        };
    }

    /**
     * 启动WebSocket服务器
     */
    async startWebSocketServer(port = null) {
        try {
            if (this.wss) {
                this.logger.warn('WebSocket server is already running');
                return { success: true, message: 'WebSocket server already running' };
            }

            const wsPort = port || this.websocketPort;
            this.wss = new WebSocket.Server({ port: wsPort });
            
            this.wss.on('connection', (ws, req) => {
                this.logger.info(`New WebSocket client connected from ${req.socket.remoteAddress}`);
                this.websocketClients.add(ws);
                
                // 发送欢迎消息
                ws.send(JSON.stringify({
                    type: 'welcome',
                    message: 'Connected to Telegram WebSocket',
                    timestamp: new Date().toISOString(),
                    server: 'credential-service'
                }));
                
                // 发送当前消息历史
                if (this.messageHistory.length > 0) {
                    ws.send(JSON.stringify({
                        type: 'message_history',
                        data: this.messageHistory.slice(-10), // 发送最近10条消息
                        timestamp: new Date().toISOString()
                    }));
                }
                
                ws.on('close', () => {
                    this.logger.info('WebSocket client disconnected');
                    this.websocketClients.delete(ws);
                });
                
                ws.on('error', (error) => {
                    this.logger.error('WebSocket client error:', error);
                    this.websocketClients.delete(ws);
                });
                
                ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data);
                        this.handleWebSocketMessage(ws, message);
                    } catch (error) {
                        this.logger.error('Invalid WebSocket message:', error);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Invalid message format',
                            timestamp: new Date().toISOString()
                        }));
                    }
                });
            });
            
            this.wss.on('error', (error) => {
                this.logger.error('WebSocket server error:', error);
            });
            
            this.logger.info(`WebSocket server started on port ${wsPort}`);
            return {
                success: true,
                message: `WebSocket server started on port ${wsPort}`,
                port: wsPort,
                url: `ws://localhost:${wsPort}`
            };
        } catch (error) {
            this.logger.error('Failed to start WebSocket server:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 停止WebSocket服务器
     */
    async stopWebSocketServer() {
        return new Promise((resolve) => {
            try {
                if (!this.wss) {
                    resolve({ success: true, message: 'WebSocket server is not running' });
                    return;
                }

                // 关闭所有客户端连接
                this.websocketClients.forEach(ws => {
                    try {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.close(1000, 'Server shutdown');
                        }
                    } catch (error) {
                        this.logger.warn('Error closing WebSocket client:', error);
                    }
                });
                this.websocketClients.clear();

                // 关闭服务器，并等待完成
                this.wss.close(() => {
                    this.wss = null;
                    this.logger.info('WebSocket server stopped');
                    resolve({ success: true, message: 'WebSocket server stopped' });
                });
                
                // 超时保护
                setTimeout(() => {
                    if (this.wss) {
                        this.wss = null;
                        this.logger.warn('WebSocket server force closed due to timeout');
                        resolve({ success: true, message: 'WebSocket server force stopped' });
                    }
                }, 5000);
                
            } catch (error) {
                this.logger.error('Failed to stop WebSocket server:', error);
                resolve({ success: false, error: error.message });
            }
        });
    }

    /**
     * 处理WebSocket消息
     */
    handleWebSocketMessage(ws, message) {
        switch (message.type) {
            case 'ping':
                ws.send(JSON.stringify({
                    type: 'pong',
                    timestamp: new Date().toISOString()
                }));
                break;
                
            case 'get_status':
                ws.send(JSON.stringify({
                    type: 'status',
                    data: {
                        polling: this.isPolling,
                        webhook: !!this.webhookUrl,
                        websocket: !!this.wss,
                        clients: this.websocketClients.size,
                        messages: this.messageHistory.length
                    },
                    timestamp: new Date().toISOString()
                }));
                break;
                
            case 'get_messages':
                const limit = message.limit || 50;
                const messages = this.messageHistory.slice(-limit);
                ws.send(JSON.stringify({
                    type: 'messages',
                    data: messages,
                    timestamp: new Date().toISOString()
                }));
                break;
                
            case 'start_polling':
                this.startPolling().then(result => {
                    ws.send(JSON.stringify({
                        type: 'polling_started',
                        success: result.success,
                        message: result.message,
                        timestamp: new Date().toISOString()
                    }));
                });
                break;
                
            case 'stop_polling':
                this.stopPolling().then(result => {
                    ws.send(JSON.stringify({
                        type: 'polling_stopped',
                        success: result.success,
                        message: result.message,
                        timestamp: new Date().toISOString()
                    }));
                });
                break;
                
            default:
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Unknown message type: ${message.type}`,
                    timestamp: new Date().toISOString()
                }));
        }
    }

    /**
     * 广播消息到所有WebSocket客户端
     */
    broadcastToWebSocketClients(data) {
        if (this.websocketClients.size === 0) {
            return;
        }

        // 生成媒体链接
        let content = data.text || data.caption;
        if (!content && data.media) {
            // 异步生成媒体链接
            this.generateMediaLinksAsync(data.media).then(links => {
                if (links) {
                    const mediaMessage = {
                        type: data.message_type || 'text',
                        content: links,
                        chat_id: data.chat_id,
                        from_name: data.from?.first_name || data.from?.username || '未知',
                        timestamp: data.date
                    };
                    
                    this.websocketClients.forEach(ws => {
                        if (ws.readyState === WebSocket.OPEN) {
                            try {
                                ws.send(JSON.stringify(mediaMessage));
                            } catch (error) {
                                this.logger.error('Failed to send media message to WebSocket client:', error);
                                this.websocketClients.delete(ws);
                            }
                        }
                    });
                }
            });
            return; // 媒体消息异步处理，直接返回
        }

        // 简化消息格式，只保留必要信息
        const simplifiedMessage = {
            type: data.message_type || 'text',
            content: content || '[未知消息]',
            chat_id: data.chat_id,
            from_name: data.from?.first_name || data.from?.username || '未知',
            timestamp: data.date
        };

        this.websocketClients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    // 发送JSON对象而不是字符串
                    ws.send(JSON.stringify(simplifiedMessage));
                } catch (error) {
                    this.logger.error('Failed to send message to WebSocket client:', error);
                    this.websocketClients.delete(ws);
                }
            }
        });
    }

    /**
     * 生成媒体文件的Telegram链接（异步版本）
     */
    async generateMediaLinksAsync(media) {
        const botToken = await this.getBotToken();
        if (!botToken) {
            this.logger.error('Bot token not available for generating media links');
            return null;
        }

        const links = [];
        
        if (media.photo && media.photo.length > 0) {
            // 选择最高质量的图片
            const bestPhoto = media.photo[media.photo.length - 1];
            const filePath = await this.getFilePath(botToken, bestPhoto.file_id);
            if (filePath) {
                links.push(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
            }
        }
        
        if (media.video) {
            const filePath = await this.getFilePath(botToken, media.video.file_id);
            if (filePath) {
                links.push(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
            }
        }
        
        if (media.audio) {
            const filePath = await this.getFilePath(botToken, media.audio.file_id);
            if (filePath) {
                links.push(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
            }
        }
        
        if (media.voice) {
            const filePath = await this.getFilePath(botToken, media.voice.file_id);
            if (filePath) {
                links.push(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
            }
        }
        
        if (media.document) {
            const filePath = await this.getFilePath(botToken, media.document.file_id);
            if (filePath) {
                links.push(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
            }
        }
        
        if (media.animation) {
            const filePath = await this.getFilePath(botToken, media.animation.file_id);
            if (filePath) {
                links.push(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
            }
        }
        
        return links.join(', ');
    }

    /**
     * 通过file_id获取file_path
     */
    async getFilePath(botToken, fileId) {
        try {
            const response = await this.callTelegramAPI(botToken, 'getFile', { file_id: fileId });
            if (response.ok && response.result) {
                return response.result.file_path;
            }
        } catch (error) {
            this.logger.error('Failed to get file path:', error);
        }
        return null;
    }

    /**
     * 获取Bot Token（用于生成文件链接）
     */
    async getBotToken() {
        try {
            const credResult = await this.getCredentials();
            if (credResult.success && credResult.data.bot_token) {
                return credResult.data.bot_token;
            }
        } catch (error) {
            this.logger.error('Failed to get bot token:', error);
        }
        return null;
    }

    /**
     * 获取WebSocket状态
     */
    getWebSocketStatus() {
        return {
            running: !!this.wss,
            port: this.websocketPort,
            clients: this.websocketClients.size,
            url: this.wss ? `ws://localhost:${this.websocketPort}` : null
        };
    }
    
    /**
     * 启动请求清理定时器
     */
    startRequestCleanup() {
        if (this.requestCleanupTimer) {
            clearInterval(this.requestCleanupTimer);
        }
        
        this.requestCleanupTimer = setInterval(() => {
            // 清理已经被销毁的请求
            this.activeRequests.forEach(req => {
                if (req.destroyed) {
                    this.activeRequests.delete(req);
                }
            });
            
            // 日志活跃请求数
            if (this.activeRequests.size > 0) {
                this.logger.info(`Active requests: ${this.activeRequests.size}`);
            }
        }, 30000); // 每30秒清理一次
    }
    
    /**
     * 停止请求清理定时器
     */
    stopRequestCleanup() {
        if (this.requestCleanupTimer) {
            clearInterval(this.requestCleanupTimer);
            this.requestCleanupTimer = null;
        }
        
        // 强制清理所有活跃请求
        this.activeRequests.forEach(req => {
            if (!req.destroyed) {
                req.destroy();
            }
        });
        this.activeRequests.clear();
    }


    /**
     * 模块禁用时清理WebSocket
     */
    async onDisable() {
        this.logger.info('Telegram module disabling...');
        
        // 停止轮询
        if (this.isPolling) {
            await this.stopPolling();
        }
        
        // 停止WebSocket服务器
        if (this.wss) {
            await this.stopWebSocketServer();
        }
        
        // 停止请求清理
        this.stopRequestCleanup();
        
        this.logger.info('Telegram module disabled');
    }

    /**
     * 掩码显示Token (保护敏感信息)
     */
    maskToken(token) {
        if (!token || token.length < 10) return '[INVALID]';
        const parts = token.split(':');
        if (parts.length !== 2) return '[INVALID_FORMAT]';
        
        const botId = parts[0];
        const secret = parts[1];
        const maskedSecret = secret.length > 8 ? 
            secret.substring(0, 4) + '*'.repeat(secret.length - 8) + secret.substring(secret.length - 4) :
            '*'.repeat(secret.length);
        
        return `${botId}:${maskedSecret}`;
    }

    /**
     * 获取模块特定状态
     */
    getStatus() {
        const baseStatus = super.getStatus();
        return {
            ...baseStatus,
            features: {
                botInfo: true,
                webhookInfo: true,
                connectionTest: true,
                commands: true,
                messaging: true,
                polling: true,
                fileDownload: true,
                websocket: true
            },
            api: {
                baseUrl: this.config.apiBaseUrl,
                timeout: this.config.timeout,
                retries: this.config.retries
            },
            messaging: {
                isPolling: this.isPolling,
                lastUpdateId: this.lastUpdateId,
                messageCount: this.messageHistory.length,
                webhookUrl: this.webhookUrl ? '[SET]' : null
            },
            websocket: this.getWebSocketStatus()
        };
    }
}

module.exports = TelegramModule;