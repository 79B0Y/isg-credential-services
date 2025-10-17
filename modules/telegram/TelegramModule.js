const BaseCredentialModule = require('../../core/BaseCredentialModule');
const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const WebSocket = require('ws');
const TermuxHelper = require('../../lib/termux-helper');
const EventEmitter = require('events');

/**
 * TelegramModule - Telegram Bot凭据管理模块
 * 支持bot_token验证和Bot信息查询
 * 支持 EventEmitter，可被 Agent 等模块订阅
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
        
        // 注册为全局模块以供内存保护访问
        global.telegramModule = this;
        
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

        // 最近聊天ID记录
        this.lastChatId = null;
        this.lastChatInfo = null;
        
        // EventEmitter 支持（用于 Agent 订阅）
        this.eventEmitter = new EventEmitter();
        this.eventEmitter.setMaxListeners(50); // 支持多个订阅者

        // 防止重复初始化的标志
        this.isInitializing = false;
        this.hasAutoStarted = false;

        // 轮询守护与校验状态
        this.pollingWatchdogTimer = null;
        this.lastPollingRestartAt = 0;
        this.tokenValidated = false;
    }

    /**
     * 模块特定初始化
     */
    async onInitialize() {
        this.logger.info('Telegram module initializing...');

        // Detect Termux environment and apply optimizations
        const termuxConfig = TermuxHelper.getOptimizedConfig();
        TermuxHelper.logEnvironmentInfo(this.logger);

        if (termuxConfig.isTermux) {
            this.logger.info('[TERMUX-OPT] Applying Termux optimizations...');

            // Override config for Termux
            this.config.timeout = termuxConfig.network.timeout;
            this.config.pollingInterval = termuxConfig.network.pollingInterval;
            this.config.maxMessageHistory = termuxConfig.memory.maxMessageHistory;

            // Disable features that cause issues in Termux
            if (termuxConfig.isProot) {
                this.config.messaging.autoStartPolling = false;
                this.logger.info('[TERMUX-OPT] Disabled auto-polling for proot environment');
            }
        }

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

        // 检查是否已有有效凭据，如果有则自动启动功能（但避免重复启动）
        if (!this.hasAutoStarted && !this.isInitializing) {
            this.isInitializing = true;
            try {
                const credentialsResult = await this.getCredentials();
                if (credentialsResult.success && credentialsResult.data.bot_token) {
                    this.logger.info('[AUTO-START] 发现已保存的凭据，验证并自动启动功能...');

                    // 验证现有凭据
                    const validationResult = await this.performValidation(credentialsResult.data);
                    if (validationResult.success) {
                        this.logger.info('[AUTO-START] 凭据验证成功，启动自动功能');

                        // 延迟启动，避免初始化冲突
                        setTimeout(async () => {
                            try {
                                // 启动WebSocket服务器（仅在Termux非proot环境下）
                                if (!this.wss && (!termuxConfig.isProot || !termuxConfig.isTermux)) {
                                    this.logger.info('[AUTO-START] 初始化时启动WebSocket服务器...');
                                    await this.startWebSocketServer();
                                    this.logger.info('[AUTO-START] ✅ WebSocket服务器启动成功');
                                } else if (termuxConfig.isProot) {
                                    this.logger.info('[AUTO-START] Termux proot环境，跳过WebSocket启动');
                                }

                                // 启动消息轮询
                                if (!this.isPolling) {
                                    this.logger.info('[AUTO-START] 初始化时启动消息轮询...');
                                    const pollingResult = await this.startPolling(credentialsResult.data);
                                    if (pollingResult.success) {
                                        this.logger.info('[AUTO-START] ✅ 消息轮询启动成功');
                                        this.hasAutoStarted = true; // 标记已成功自动启动
                                    } else {
                                        this.logger.warn('[AUTO-START] 消息轮询启动失败:', pollingResult.message);
                                    }
                                } else {
                                    this.logger.info('[AUTO-START] 消息轮询已在运行，跳过启动');
                                    this.hasAutoStarted = true;
                                }
                            } catch (autoStartError) {
                                this.logger.warn('[AUTO-START] 自动启动过程中出错:', autoStartError.message);
                            } finally {
                                this.isInitializing = false;
                            }
                        }, 2000); // 2秒延迟
                    } else {
                        this.logger.info('[AUTO-START] 凭据验证失败，跳过自动启动:', validationResult.error);
                        this.isInitializing = false;
                    }
                } else {
                    this.logger.info('[AUTO-START] 未找到有效凭据，等待用户配置');
                    this.isInitializing = false;
                }
            } catch (autoStartError) {
                this.logger.warn('[AUTO-START] 检查自动启动失败:', autoStartError.message);
                this.isInitializing = false;
            }
        } else if (this.hasAutoStarted) {
            this.logger.info('[AUTO-START] 已经自动启动过，跳过重复启动');
        } else if (this.isInitializing) {
            this.logger.info('[AUTO-START] 正在初始化中，跳过重复启动');
        }

        // 启动轮询守护，确保凭据有效时保持轮询活跃
        this.startPollingWatchdog();
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
            
            // 如果轮询正在运行，说明 token 有效
            if (this.isPolling) {
                this.logger.info('Bot is currently polling, token is valid');
                const result = {
                    success: true,
                    message: `Telegram bot token is valid (polling active, ${this.messageHistory.length} messages)`,
                    data: {
                        bot: {
                            polling_active: true,
                            message_count: this.messageHistory.length
                        },
                        validated_at: new Date().toISOString(),
                        mode: 'polling'
                    }
                };
                this.tokenValidated = true;
                return result;
            }
            
            // 在网络问题的环境中，我们可以提供一个快速验证模式
            const quickValidationEnabled = process.env.QUICK_VALIDATION === 'true' || 
                                          this.config.validation?.quickValidation === true ||
                                          this.config.quickValidation === true;
            
            if (quickValidationEnabled) {
                this.logger.info('Using quick validation mode');
                const result = {
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
                this.tokenValidated = true;
                return result;
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
                        const result = {
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
                        this.tokenValidated = true;
                        return result;
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
                        // 指数退避策略：2^attempt * 1000ms (1s, 2s, 4s, 8s, 16s)
                        const delay = Math.min(Math.pow(2, attempt) * 1000, 30000); // 最多 30 秒
                        this.logger.info(`等待 ${delay}ms 后重试...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
            
            // 所有重试都失败了，但token格式正确，返回格式验证成功
            this.logger.warn('API validation failed, falling back to format validation');
            const result = {
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
            this.tokenValidated = true;
            return result;
            
        } catch (error) {
            this.logger.error('Telegram validation error:', error);
            
            // 如果是网络问题，但token格式正确，我们仍然可以返回部分成功
            const result = {
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
            this.tokenValidated = true;
            return result;
        }
    }

    /**
     * 重写setCredentials方法 - 保存凭据后自动启动WebSocket和轮询
     */
    async setCredentials(credentials) {
        try {
            // 先调用父类的setCredentials方法保存凭据
            const saveResult = await super.setCredentials(credentials);
            
            if (!saveResult.success) {
                return saveResult;
            }

            this.logger.info('[AUTO-START] 凭据保存成功，准备自动启动WebSocket和轮询功能');

            // 验证凭据有效性
            const validationResult = await this.performValidation(credentials);
            if (!validationResult.success) {
                this.logger.warn('[AUTO-START] 凭据验证失败，不启动自动功能:', validationResult.error);
                return {
                    success: true,
                    message: 'Credentials saved but validation failed - auto-start skipped',
                    validation_error: validationResult.error
                };
            }

            this.logger.info('[AUTO-START] 凭据验证成功，开始自动启动功能');
            this.tokenValidated = true;

            // 自动启动WebSocket服务器
            try {
                if (!this.wss) {
                    this.logger.info('[AUTO-START] 启动WebSocket服务器...');
                    await this.startWebSocketServer();
                    this.logger.info('[AUTO-START] ✅ WebSocket服务器启动成功');
                } else {
                    this.logger.info('[AUTO-START] WebSocket服务器已在运行');
                }
            } catch (wsError) {
                this.logger.warn('[AUTO-START] WebSocket服务器启动失败:', wsError.message);
            }

            // 自动启动消息轮询
            try {
                if (!this.isPolling) {
                    this.logger.info('[AUTO-START] 启动消息轮询...');
                    const pollingResult = await this.startPolling(credentials);
                    if (pollingResult.success) {
                        this.logger.info('[AUTO-START] ✅ 消息轮询启动成功');
                    } else {
                        this.logger.warn('[AUTO-START] 消息轮询启动失败:', pollingResult.message);
                    }
                } else {
                    this.logger.info('[AUTO-START] 消息轮询已在运行');
                }
            } catch (pollError) {
                this.logger.warn('[AUTO-START] 消息轮询启动失败:', pollError.message);
            }

            // 确保守护进程在运行
            this.startPollingWatchdog();

            return {
                success: true,
                message: 'Credentials saved and auto-start features initiated',
                auto_start: {
                    websocket: this.wss ? 'started' : 'failed',
                    polling: this.isPolling ? 'started' : 'failed'
                }
            };

        } catch (error) {
            this.logger.error('[AUTO-START] setCredentials失败:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 启动轮询守护，保证凭据有效时轮询持续
     */
    startPollingWatchdog() {
        if (this.pollingWatchdogTimer) {
            return; // 已启动
        }
        this.logger.info('[WATCHDOG] 启动Telegram轮询守护');
        this.pollingWatchdogTimer = setInterval(async () => {
            try {
                // 在Termux proot环境下跳过守护以避免兼容性问题
                const termuxConfig = TermuxHelper.getOptimizedConfig();
                if (termuxConfig.isProot) return;

                if (!this.tokenValidated) return; // 未通过验证不启动
                if (this.isPolling) return; // 已在轮询

                const now = Date.now();
                if (now - this.lastPollingRestartAt < 30000) return; // 限制重启频率 30s

                const credResult = await this.getCredentials();
                if (credResult.success && credResult.data && credResult.data.bot_token) {
                    this.logger.info('[WATCHDOG] 轮询未运行，尝试重新启动...');
                    const res = await this.startPolling(credResult.data);
                    this.lastPollingRestartAt = now;
                    if (res.success) {
                        this.logger.info('[WATCHDOG] ✅ 轮询已重新启动');
                    } else {
                        this.logger.warn('[WATCHDOG] 轮询重启失败:', res.error || res.message);
                    }
                }
            } catch (e) {
                this.logger.warn('[WATCHDOG] 守护检查出错:', e.message);
            }
        }, 10000); // 每10秒检查一次
    }

    /**
     * 停止轮询守护
     */
    stopPollingWatchdog() {
        if (this.pollingWatchdogTimer) {
            clearInterval(this.pollingWatchdogTimer);
            this.pollingWatchdogTimer = null;
            this.logger.info('[WATCHDOG] 已停止Telegram轮询守护');
        }
    }

    /**
     * 调用Telegram Bot API - 完全重写请求管理机制
     */
    async callTelegramAPI(botToken, method, params = {}, retryCount = 0) {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = Date.now();
        
        this.logger.info(`[TELEGRAM-REQ] 开始请求 ${requestId} - 方法: ${method}, 重试: ${retryCount}`);

        return new Promise((resolve, reject) => {
            let isFinished = false;
            let req = null;
            let timeoutId = null;
            let responseSize = 0;
            const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB限制

            // 原子清理函数 - 确保所有资源被正确释放
            const atomicCleanup = () => {
                if (isFinished) return; // 防止重复清理
                isFinished = true;

                this.logger.info(`[TELEGRAM-REQ] 清理资源 ${requestId}`);

                // 清理超时定时器
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }

                // 安全销毁请求对象
                if (req) {
                    try {
                        if (!req.destroyed) {
                            req.destroy();
                        }
                    } catch (destroyError) {
                        this.logger.warn(`[TELEGRAM-REQ] 请求销毁错误 ${requestId}:`, destroyError.message);
                    }

                    // 从活跃请求集合中移除
                    if (this.activeRequests.has(req)) {
                        this.activeRequests.delete(req);
                    }

                    // 清理请求对象的自定义属性
                    req._created = null;
                    req._requestId = null;
                    req = null;
                }

                const duration = Date.now() - startTime;
                this.logger.info(`[TELEGRAM-REQ] 请求 ${requestId} 清理完成，耗时: ${duration}ms`);
            };

            try {
                const url = `${this.config.apiBaseUrl}/bot${botToken}/${method}`;
                const urlObj = new URL(url);
                const isHttps = urlObj.protocol === 'https:';
                const httpModule = isHttps ? https : http;
                
                // 准备POST数据
                const postData = JSON.stringify(params);
                
                // 基础配置
                const options = {
                    hostname: urlObj.hostname,
                    port: urlObj.port || (isHttps ? 443 : 80),
                    path: urlObj.pathname,
                    method: Object.keys(params).length > 0 ? 'POST' : 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData),
                        'User-Agent': 'CredentialService/1.0'
                    },
                    timeout: this.config.timeout
                };
                
                // HTTPS 特定配置
                if (isHttps) {
                    options.servername = urlObj.hostname; // SNI 支持
                    options.rejectUnauthorized = true; // 严格证书验证
                }

                // 创建请求对象
                req = httpModule.request(options, (res) => {
                    if (isFinished) return; // 防止重复处理

                    let data = '';
                    let chunks = [];
                    
                    res.on('data', (chunk) => {
                        if (isFinished) return;

                        responseSize += chunk.length;
                        
                        // 响应大小检查
                        if (responseSize > MAX_RESPONSE_SIZE) {
                            atomicCleanup();
                            reject(new Error(`[TELEGRAM-REQ] 响应过大 (${Math.round(responseSize/1024/1024)}MB) ${requestId}`));
                            return;
                        }

                        chunks.push(chunk);
                        data += chunk;
                    });
                    
                    res.on('end', () => {
                        if (isFinished) return;
                        
                        try {
                            // 立即清理chunks数组以释放内存
                            chunks = null;
                            
                            if (data.length === 0) {
                                atomicCleanup();
                                reject(new Error(`[TELEGRAM-REQ] 空响应 ${requestId}`));
                                return;
                            }

                            const response = JSON.parse(data);
                            
                            // 清理响应数据引用
                            data = null;
                            
                            atomicCleanup();
                            
                            const duration = Date.now() - startTime;
                            this.logger.info(`[TELEGRAM-REQ] 请求成功 ${requestId} - 耗时: ${duration}ms, 大小: ${Math.round(responseSize/1024)}KB`);
                            
                            resolve(response);
                        } catch (parseError) {
                            atomicCleanup();
                            reject(new Error(`[TELEGRAM-REQ] JSON解析失败 ${requestId}: ${parseError.message}`));
                        }
                    });
                    
                    res.on('error', (error) => {
                        if (isFinished) return;
                        atomicCleanup();
                        reject(new Error(`[TELEGRAM-REQ] 响应错误 ${requestId}: ${error.message}`));
                    });

                    res.on('close', () => {
                        if (!isFinished) {
                            // Response connection closed - no logging needed for normal operation
                        }
                    });
                });

                // 请求对象配置
                req._created = startTime;
                req._requestId = requestId;
                this.activeRequests.add(req);

                // 超时处理
                timeoutId = setTimeout(() => {
                    if (isFinished) return;
                    
                    this.logger.warn(`[TELEGRAM-REQ] 请求超时 ${requestId} (${this.config.timeout}ms) - 活跃请求: ${this.activeRequests.size}`);
                    atomicCleanup();
                    reject(new Error(`[TELEGRAM-REQ] 请求超时 ${requestId} after ${this.config.timeout}ms`));
                }, this.config.timeout);

                // 请求错误处理
                req.on('error', (error) => {
                    if (isFinished) return;
                    
                    this.logger.warn(`[TELEGRAM-REQ] 请求错误 ${requestId}:`, error.message);
                    
                    // 增强错误信息
                    let errorMessage = `请求失败 ${requestId}: ${error.message}`;
                    
                    // 根据错误类型提供更详细的信息
                    if (error.code === 'ECONNRESET') {
                        errorMessage += ' (连接被重置)';
                    } else if (error.code === 'ECONNREFUSED') {
                        errorMessage += ' (连接被拒绝)';
                    } else if (error.code === 'ENOTFOUND') {
                        errorMessage += ' (DNS解析失败)';
                    } else if (error.code === 'ETIMEDOUT') {
                        errorMessage += ' (连接超时)';
                    } else if (error.code === 'ECONNABORTED') {
                        errorMessage += ' (连接中断)';
                    }
                    
                    atomicCleanup();
                    reject(new Error(errorMessage));
                });
                
                req.on('close', () => {
                    if (!isFinished) {
                        // Request connection closed - normal cleanup will handle this
                        atomicCleanup();
                    }
                });

                req.on('timeout', () => {
                    if (isFinished) return;
                    this.logger.warn(`[TELEGRAM-REQ] 套接字超时 ${requestId}`);
                    atomicCleanup();
                    reject(new Error(`[TELEGRAM-REQ] 套接字超时 ${requestId}`));
                });

                // 发送POST数据
                try {
                    if (Object.keys(params).length > 0) {
                        req.write(postData);
                    }
                    req.end();
                    
                    this.logger.info(`[TELEGRAM-REQ] 请求已发送 ${requestId}`);
                } catch (sendError) {
                    atomicCleanup();
                    reject(new Error(`[TELEGRAM-REQ] 发送失败 ${requestId}: ${sendError.message}`));
                }
                
            } catch (initError) {
                atomicCleanup();
                reject(new Error(`[TELEGRAM-REQ] 初始化失败 ${requestId}: ${initError.message}`));
            }

        }).catch(async (error) => {
            // 重试逻辑 - 使用指数退避和最大并发控制
            if (retryCount < this.config.retries && this.shouldRetry(error)) {
                // 检查并发请求数量
                if (this.activeRequests.size > 5) {
                    this.logger.warn(`[TELEGRAM-REQ] 活跃请求过多 (${this.activeRequests.size})，延迟重试`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }

                this.logger.warn(`[TELEGRAM-REQ] 重试 ${retryCount + 1}/${this.config.retries}: ${error.message}`);
                
                // 指数退避延迟 + 随机抖动
                const baseDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);
                const jitter = Math.random() * 1000;
                const delay = baseDelay + jitter;
                
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
            'EPROTO', // TLS/SSL 协议错误
            'UNABLE_TO_VERIFY_LEAF_SIGNATURE', // SSL 证书验证错误
            'ERR_TLS_CERT_ALTNAME_INVALID', // SSL 主机名验证错误
            'socket disconnected', // Socket 断开连接
            'secure TLS connection', // TLS 连接失败（Termux 环境常见）
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
     * 获取Bot基本信息（用于健康检查）
     * 这是 getBotInfo 的简化版本，只返回基本的 bot 信息
     */
    async getMe(credentials = null) {
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

            // 调用 Telegram API getMe
            const botInfo = await this.callTelegramAPI(bot_token, 'getMe');
            if (!botInfo.ok) {
                return { success: false, error: botInfo.description || 'Failed to get bot info' };
            }

            return {
                success: true,
                data: botInfo.result
            };
        } catch (error) {
            this.logger.error('Failed to get bot info (getMe):', error);
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
            pollingInterval: 300, // 轮询间隔（毫秒）- Termux优化
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
        this.stopPollingWatchdog();
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

            // 开始轮询 - 修改为递归方式避免并发冲突，加强网络错误处理
            const doPoll = async () => {
                if (!this.isPolling) return;
                
                let retryDelay = 100; // 基础延迟
                
                try {
                    await this.pollUpdates(bot_token);
                    this.pollingFailures = 0; // 成功则重置失败计数
                } catch (error) {
                    this.pollingFailures = (this.pollingFailures || 0) + 1;
                    
                    // 判断错误类型决定重试策略
                    const isNetworkError = error.message.includes('超时') || 
                                         error.message.includes('timeout') ||
                                         error.code === 'ENOTFOUND' ||
                                         error.code === 'ECONNRESET' ||
                                         error.code === 'ETIMEDOUT';
                    
                    if (isNetworkError) {
                        // 网络错误使用指数退避，最大延迟30秒
                        retryDelay = Math.min(1000 * Math.pow(2, this.pollingFailures - 1), 30000);
                        this.logger.warn(`[NETWORK-ERROR] 网络连接问题 (失败${this.pollingFailures}次), ${retryDelay}ms后重试: ${error.message}`);
                    } else {
                        // 非网络错误
                        this.logger.error(`[POLLING-ERROR] 轮询错误 (失败${this.pollingFailures}次): ${error.message}`);
                    }
                    
                    // 超过阈值停止轮询 - 网络错误允许更多重试
                    const maxFailures = isNetworkError ? 20 : 10;
                    if (this.pollingFailures >= maxFailures) {
                        this.logger.error(`连续失败${this.pollingFailures}次，停止轮询`);
                        return this.stopPolling();
                    }
                }
                
                // 根据失败情况调整延迟
                setTimeout(doPoll, retryDelay);
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
            // 根据环境调整轮询超时
            const termuxConfig = TermuxHelper.getOptimizedConfig();
            const pollingTimeout = termuxConfig.isTermux ? 10 : 25; // Termux环境使用更短的超时

            const params = {
                offset: this.lastUpdateId + 1,
                timeout: pollingTimeout,
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
                    this.tokenValidated = false; // 令牌无效，停止守护自动重启
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

                // 更新最近聊天ID
                this.lastChatId = message.chat.id;
                this.lastChatInfo = {
                    chat_id: message.chat.id,
                    chat_type: message.chat.type,
                    chat_title: message.chat.title,
                    chat_username: message.chat.username,
                    chat_first_name: message.chat.first_name,
                    chat_last_name: message.chat.last_name,
                    updated_at: new Date()
                };

                // 保持历史记录在合理范围内（根据环境调整）
                const termuxConfig = TermuxHelper.getOptimizedConfig();
                const maxHistory = termuxConfig.memory.maxMessageHistory;

                if (this.messageHistory.length > maxHistory) {
                    const keepCount = Math.floor(maxHistory / 2);
                    this.messageHistory = this.messageHistory.slice(-keepCount);

                    // 同时清理messages Map以释放内存
                    if (termuxConfig.isTermux && this.messages.size > maxHistory) {
                        const messagesToDelete = this.messageHistory.slice(0, this.messageHistory.length - keepCount);
                        messagesToDelete.forEach(msg => this.messages.delete(msg.id));

                        // 强制垃圾回收
                        if (termuxConfig.features.formDataCleanup) {
                            TermuxHelper.forceGarbageCollection();
                        }
                    }
                }

                // 广播到WebSocket客户端（异步处理，不阻塞消息流）
                this.broadcastToWebSocketClients(processedMessage).catch(err => {
                    this.logger.error('Failed to broadcast to WebSocket clients:', err);
                });

                // 触发 message 事件（供 Agent 等模块订阅）
                this.emit('message', processedMessage);

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
     * 快速回复消息（使用最近的聊天ID）
     */
    async replyToLastChat(text, options = {}, credentials = null) {
        try {
            if (!this.lastChatId) {
                return {
                    success: false,
                    error: 'No recent chat found. Please receive a message first or use sendMessage with specific chat_id.'
                };
            }

            // 使用最近的聊天ID发送消息
            return await this.sendMessage(this.lastChatId, text, options, credentials);
        } catch (error) {
            this.logger.error('Failed to reply to last chat:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取最近聊天信息
     */
    getLastChatInfo() {
        return {
            success: true,
            data: {
                last_chat_id: this.lastChatId,
                last_chat_info: this.lastChatInfo,
                has_recent_chat: this.lastChatId !== null
            }
        };
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

    /**
     * 语音转文字（调用 OpenAI Whisper）
     * @param {string} fileId - Telegram 文件 ID (voice 或 audio)
     * @param {object} options - Whisper 选项 (language, prompt, etc.)
     * @returns {object} 转换结果
     */
    async transcribeVoice(fileId, options = {}, credentials = null) {
        try {
            // 获取 Telegram 凭据
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No Telegram credentials found' };
                }
                credentials = credResult.data;
            }

            // 获取文件信息
            const fileResult = await this.getFile(fileId, credentials);
            if (!fileResult.success) {
                return { success: false, error: `Failed to get file info: ${fileResult.error}` };
            }

            const filePath = fileResult.data.file_path;
            const fileSize = fileResult.data.file_size || 0;

            // 检查文件大小（Whisper 限制 25MB）
            if (fileSize > 25 * 1024 * 1024) {
                return { 
                    success: false, 
                    error: 'File too large for Whisper API (max 25MB)',
                    file_size: fileSize
                };
            }

            this.logger.info(`[WHISPER] Downloading voice file: ${filePath} (${fileSize} bytes)`);

            // 下载文件
            const downloadResult = await this.downloadFile(filePath, credentials);
            if (!downloadResult.success) {
                return { success: false, error: `Failed to download file: ${downloadResult.error}` };
            }

            // 获取 OpenAI 凭据
            // 通过 require 获取 ModuleManager 实例
            const moduleManagerPath = path.join(__dirname, '../../core/ModuleManager.js');
            let moduleManager;
            try {
                // 尝试从全局获取
                moduleManager = global.moduleManager;
                
                // 如果全局没有，尝试从父模块获取
                if (!moduleManager && this.parent && this.parent.moduleManager) {
                    moduleManager = this.parent.moduleManager;
                }
                
                // 如果还是没有，从缓存中查找已加载的实例
                if (!moduleManager) {
                    const cached = require.cache[require.resolve(moduleManagerPath)];
                    if (cached && cached.exports) {
                        // 这是一个类，需要找到已实例化的对象
                        // 暂时返回错误，提示用户配置
                        return { 
                            success: false, 
                            error: 'OpenAI module not accessible. Please ensure OpenAI credentials are configured.' 
                        };
                    }
                }
            } catch (err) {
                this.logger.error('[WHISPER] Failed to access module manager:', err);
                return { success: false, error: 'Failed to access OpenAI module' };
            }
            
            if (!moduleManager) {
                return { 
                    success: false, 
                    error: 'Module manager not available. Please ensure the service is properly initialized.' 
                };
            }
            
            const openaiModule = moduleManager.getModule('openai');
            if (!openaiModule) {
                return { success: false, error: 'OpenAI module not found. Please configure OpenAI credentials first.' };
            }

            const openaiCredResult = await openaiModule.getCredentials();
            if (!openaiCredResult.success) {
                return { success: false, error: 'No OpenAI credentials found' };
            }

            // 调用 Whisper API
            this.logger.info('[WHISPER] Calling OpenAI Whisper API...');
            
            if (typeof openaiModule.transcribeAudio !== 'function') {
                return { success: false, error: 'OpenAI transcribeAudio method not available' };
            }

            const whisperResult = await openaiModule.transcribeAudio(
                downloadResult.data,
                {
                    ...options,
                    filename: filePath.split('/').pop() || 'voice.ogg'
                }
            );

            if (whisperResult.success) {
                this.logger.info('[WHISPER] Transcription successful');
                this.logger.info('[WHISPER] Result:', {
                    text: whisperResult.text,
                    language: whisperResult.language,
                    duration: whisperResult.duration
                });
                
                const result = {
                    success: true,
                    text: whisperResult.text || whisperResult.data?.text || '',
                    language: whisperResult.language || whisperResult.data?.language,
                    duration: whisperResult.duration || whisperResult.data?.duration,
                    file_id: fileId,
                    file_size: fileSize
                };
                
                this.logger.info('[WHISPER] Returning result:', result);
                return result;
            } else {
                return whisperResult;
            }

        } catch (error) {
            this.logger.error('[WHISPER] Transcription error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 自动转换消息中的语音
     * @param {object} message - Telegram 消息对象
     * @param {object} options - Whisper 选项
     * @returns {object} 转换结果（如果消息包含语音）
     */
    async transcribeMessageVoice(message, options = {}) {
        try {
            let fileId = null;
            let fileType = null;

            // 检查是否有语音消息
            if (message.voice) {
                fileId = message.voice.file_id;
                fileType = 'voice';
            } else if (message.audio) {
                fileId = message.audio.file_id;
                fileType = 'audio';
            } else if (message.video_note) {
                fileId = message.video_note.file_id;
                fileType = 'video_note';
            }

            if (!fileId) {
                return { 
                    success: false, 
                    error: 'Message does not contain voice/audio',
                    has_voice: false
                };
            }

            this.logger.info(`[WHISPER] Transcribing ${fileType} from message ${message.message_id}`);

            const result = await this.transcribeVoice(fileId, options);
            
            if (result.success) {
                return {
                    ...result,
                    message_id: message.message_id,
                    chat_id: message.chat.id,
                    file_type: fileType,
                    from: message.from
                };
            }

            return result;

        } catch (error) {
            this.logger.error('[WHISPER] Message transcription error:', error);
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
                
                // 设置客户端为活跃状态
                ws.isAlive = true;
                
                // 监听 pong 响应
                ws.on('pong', () => {
                    ws.isAlive = true;
                });
                
                // 不发送欢迎消息（根据用户要求）
                // 只在有消息历史时发送历史记录
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
            
            // 启动心跳检测（每30秒）
            this.startWebSocketHeartbeat();
            
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
     * 启动 WebSocket 心跳检测
     */
    startWebSocketHeartbeat() {
        if (this.wsHeartbeatTimer) {
            clearInterval(this.wsHeartbeatTimer);
        }
        
        this.wsHeartbeatTimer = setInterval(() => {
            if (!this.wss) return;
            
            this.websocketClients.forEach((ws) => {
                if (ws.isAlive === false) {
                    this.logger.info('[WebSocket] Terminating inactive client');
                    this.websocketClients.delete(ws);
                    return ws.terminate();
                }
                
                ws.isAlive = false;
                ws.ping();
            });
        }, 30000); // 每30秒检测一次
    }
    
    /**
     * 停止 WebSocket 心跳检测
     */
    stopWebSocketHeartbeat() {
        if (this.wsHeartbeatTimer) {
            clearInterval(this.wsHeartbeatTimer);
            this.wsHeartbeatTimer = null;
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

                // 停止心跳检测
                this.stopWebSocketHeartbeat();

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
    async broadcastToWebSocketClients(data) {
        if (this.websocketClients.size === 0) {
            return;
        }

        let content = data.text || data.caption;
        let isTranscribed = false;
        
        // 如果是语音消息，自动转换成文字
        if (data.message_type === 'voice' && data.media?.voice?.file_id) {
            this.logger.info('[WebSocket] Detected voice message, transcribing...');
            try {
                const transcribeResult = await this.transcribeVoice(data.media.voice.file_id, { language: 'zh' });
                if (transcribeResult.success && transcribeResult.text) {
                    content = transcribeResult.text;
                    isTranscribed = true;
                    this.logger.info(`[WebSocket] Voice transcribed: "${content}"`);
                } else {
                    this.logger.warn('[WebSocket] Voice transcription failed:', transcribeResult.error);
                    content = '[语音消息 - 转换失败]';
                }
            } catch (error) {
                this.logger.error('[WebSocket] Voice transcription error:', error);
                content = '[语音消息 - 转换失败]';
            }
        }
        
        // 处理其他媒体消息
        if (!content && data.media) {
            // 异步生成媒体链接
            this.generateMediaLinksAsync(data.media).then(links => {
                if (links) {
                    const mediaMessage = {
                        type: data.message_type || 'text',
                        content: links,
                        chat_id: data.chat_id,
                        from_name: data.from?.first_name || data.from?.username || '未知',
                        timestamp: data.date,
                        message_id: data.id
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
            timestamp: data.date,
            message_id: data.id,
            is_transcribed: isTranscribed
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
     * 启动请求清理定时器 - 使用错峰调度避免与缓存更新冲突
     */
    startRequestCleanup() {
        if (this.requestCleanupTimer) {
            clearInterval(this.requestCleanupTimer);
        }
        
        // 错峰延迟：在Home Assistant缓存更新的时间间隙中执行
        const cleanupInterval = 20000; // 20秒间隔
        const staggerOffset = 5000; // 5秒偏移，避开缓存更新时间
        
        this.logger.info(`[TIMING-OPT] 启动错峰请求清理: 间隔 ${cleanupInterval/1000}s, 偏移 ${staggerOffset/1000}s`);
        
        setTimeout(() => {
            this.requestCleanupTimer = setInterval(() => {
                const startTime = Date.now();
                const sizeBefore = this.activeRequests.size;
                
                // 避免在高负载时进行清理
                const currentMemory = process.memoryUsage().heapUsed / 1024 / 1024;
                if (currentMemory > 200) {
                    this.logger.warn(`[TIMING-OPT] 内存负载高 (${Math.round(currentMemory)}MB)，跳过请求清理`);
                    return;
                }
                
                this.logger.info(`[TELEGRAM-CLEANUP] 开始请求清理 - 当前活跃: ${sizeBefore}`);
                
                // 清理已经被销毁的请求
                this.activeRequests.forEach(req => {
                    if (req.destroyed) {
                        this.activeRequests.delete(req);
                    }
                });
                
                // 强制清理长时间未完成的请求（防止内存泄漏）
                const now = Date.now();
                this.activeRequests.forEach(req => {
                    if (req._created && (now - req._created) > 120000) { // 超过2分钟
                        this.logger.warn(`[TELEGRAM-CLEANUP] 清理陈旧请求 ID:${req._requestId || 'unknown'} (存活: ${Math.round((now - req._created)/1000)}s)`);
                        if (!req.destroyed) {
                            req.destroy();
                        }
                        this.activeRequests.delete(req);
                    }
                });
                
                const cleaned = sizeBefore - this.activeRequests.size;
                const duration = Date.now() - startTime;
                
                // 日志活跃请求数和清理情况
                if (this.activeRequests.size > 0 || cleaned > 0) {
                    this.logger.info(`[TELEGRAM-CLEANUP] 活跃请求: ${this.activeRequests.size} (清理: ${cleaned}, 耗时: ${duration}ms)`);
                }
                
                // 内存压力检测 - 如果活跃请求过多，强制清理
                if (this.activeRequests.size > 8) { // 降低阈值，更积极清理
                    this.logger.error(`[TELEGRAM-CLEANUP] 活跃请求过多 (${this.activeRequests.size})，强制清理所有`);
                    this.forceCleanupAllRequests();
                }
                
            }, cleanupInterval);
            
        }, staggerOffset);
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
     * 强制清理所有活跃请求 - 用于内存压力情况
     */
    forceCleanupAllRequests() {
        const count = this.activeRequests.size;
        this.logger.error(`[MEMORY] Force cleaning up ${count} active requests due to memory pressure`);
        
        this.activeRequests.forEach(req => {
            if (!req.destroyed) {
                try {
                    req.destroy();
                } catch (error) {
                    // 忽略销毁错误
                    this.logger.warn(`[MEMORY] Error destroying request: ${error.message}`);
                }
            }
        });
        this.activeRequests.clear();
        
        // 强制垃圾回收
        if (global.gc) {
            this.logger.info('[MEMORY] Triggering garbage collection after request cleanup');
            global.gc();
        }
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

    /**
     * 订阅事件（EventEmitter 包装）
     */
    on(eventName, listener) {
        return this.eventEmitter.on(eventName, listener);
    }

    /**
     * 取消订阅事件
     */
    removeListener(eventName, listener) {
        return this.eventEmitter.removeListener(eventName, listener);
    }

    /**
     * 触发事件（内部使用）
     */
    emit(eventName, ...args) {
        return this.eventEmitter.emit(eventName, ...args);
    }
}

module.exports = TelegramModule;
