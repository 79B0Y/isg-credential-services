const BaseCredentialModule = require('../../core/BaseCredentialModule');
const https = require('https');

/**
 * DeepseekModule - DeepSeek API凭据管理模块
 * 支持API key验证和聊天功能
 */
class DeepseekModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        
        // DeepSeek API配置
        this.apiBaseUrl = 'https://api.deepseek.com';
        this.defaultTimeout = 30000; // DeepSeek可能需要更长的响应时间
    }

    /**
     * 模块特定初始化
     */
    async onInitialize() {
        this.logger.info('DeepSeek module initializing...');
        
        if (!this.config.apiBaseUrl) {
            this.config.apiBaseUrl = this.apiBaseUrl;
        }
        
        if (!this.config.timeout) {
            this.config.timeout = this.defaultTimeout;
        }
        
        this.logger.info('DeepSeek module initialized');
    }

    /**
     * 执行DeepSeek API Key验证
     */
    async performValidation(credentials) {
        const { api_key } = credentials;
        
        if (!api_key) {
            return {
                success: false,
                error: 'API key is required',
                details: { field: 'api_key' }
            };
        }

        try {
            this.logger.info('Validating DeepSeek API key...');
            
            // 调用models API验证key
            const modelsResult = await this.callDeepSeekAPI(api_key, '/v1/models');
            
            if (modelsResult.error) {
                return {
                    success: false,
                    error: modelsResult.error.message || 'Invalid API key',
                    details: {
                        type: modelsResult.error.type,
                        code: modelsResult.error.code
                    }
                };
            }

            return {
                success: true,
                message: 'DeepSeek API key is valid',
                data: {
                    models: modelsResult.data ? modelsResult.data.slice(0, 5) : [],
                    total_models: modelsResult.data ? modelsResult.data.length : 0,
                    validated_at: new Date().toISOString()
                }
            };
        } catch (error) {
            this.logger.error('DeepSeek validation error:', error);
            return {
                success: false,
                error: 'Validation failed',
                details: {
                    message: error.message,
                    code: error.code
                }
            };
        }
    }

    /**
     * 调用DeepSeek API
     */
    async callDeepSeekAPI(apiKey, endpoint, method = 'GET', data = null) {
        return new Promise((resolve, reject) => {
            const url = `${this.config.apiBaseUrl}${endpoint}`;
            const urlObj = new URL(url);
            
            const headers = {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'CredentialService/1.0'
            };

            const postData = data ? JSON.stringify(data) : null;
            if (postData) {
                headers['Content-Length'] = Buffer.byteLength(postData);
            }

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || 443,
                path: urlObj.pathname + urlObj.search,
                method: method,
                headers: headers,
                timeout: this.config.timeout
            };

            const req = https.request(options, (res) => {
                let responseData = '';
                
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const response = JSON.parse(responseData);
                        resolve(response);
                    } catch (parseError) {
                        reject(new Error(`Invalid JSON response: ${parseError.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Request failed: ${error.message}`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Request timeout after ${this.config.timeout}ms`));
            });

            if (postData) {
                req.write(postData);
            }
            
            req.end();
        });
    }

    /**
     * 获取可用模型列表
     */
    async getModels(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { api_key } = credentials;
            if (!api_key) {
                return { success: false, error: 'API key is required' };
            }

            const result = await this.callDeepSeekAPI(api_key, '/v1/models');
            
            if (result.error) {
                return { success: false, error: result.error.message };
            }

            return {
                success: true,
                data: {
                    models: result.data,
                    count: result.data.length,
                    retrieved_at: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 发送聊天消息到DeepSeek
     */
    async sendChatMessage(messages, options = {}, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { api_key } = credentials;
            if (!api_key) {
                return { success: false, error: 'API key is required' };
            }

            // 验证消息格式
            if (!Array.isArray(messages) || messages.length === 0) {
                return { success: false, error: 'Messages array is required and cannot be empty' };
            }

            // 验证消息结构
            for (const message of messages) {
                if (!message.role || !message.content) {
                    return { success: false, error: 'Each message must have role and content' };
                }
                if (!['system', 'user', 'assistant'].includes(message.role)) {
                    return { success: false, error: 'Message role must be system, user, or assistant' };
                }
            }

            // 构建请求数据
            const requestData = {
                model: options.model || 'deepseek-chat',
                messages: messages,
                temperature: options.temperature !== undefined ? options.temperature : 0.7,
                max_tokens: options.max_tokens || 2000,
                top_p: options.top_p !== undefined ? options.top_p : 1,
                frequency_penalty: options.frequency_penalty !== undefined ? options.frequency_penalty : 0,
                presence_penalty: options.presence_penalty !== undefined ? options.presence_penalty : 0
            };

            // 添加可选参数
            if (options.stream !== undefined) {
                requestData.stream = options.stream;
            }
            if (options.stop) {
                requestData.stop = options.stop;
            }

            this.logger.info(`Sending chat message to DeepSeek with model: ${requestData.model}`);

            const result = await this.callDeepSeekAPI(api_key, '/v1/chat/completions', 'POST', requestData);
            
            if (result.error) {
                return { 
                    success: false, 
                    error: result.error.message || 'Chat completion failed',
                    details: result.error
                };
            }

            return {
                success: true,
                data: {
                    id: result.id,
                    model: result.model,
                    choices: result.choices,
                    usage: result.usage,
                    created: result.created,
                    finish_reason: result.choices[0]?.finish_reason,
                    message: result.choices[0]?.message,
                    response_text: result.choices[0]?.message?.content,
                    total_tokens: result.usage?.total_tokens,
                    prompt_tokens: result.usage?.prompt_tokens,
                    completion_tokens: result.usage?.completion_tokens,
                    retrieved_at: new Date().toISOString()
                }
            };
        } catch (error) {
            this.logger.error('DeepSeek chat error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 发送简单聊天消息（系统提示词 + 用户提示词）
     */
    async sendSimpleChat(systemPrompt, userPrompt, options = {}, credentials = null) {
        const messages = [];
        
        if (systemPrompt && systemPrompt.trim()) {
            messages.push({
                role: 'system',
                content: systemPrompt.trim()
            });
        }
        
        if (userPrompt && userPrompt.trim()) {
            messages.push({
                role: 'user',
                content: userPrompt.trim()
            });
        }

        if (messages.length === 0) {
            return { success: false, error: 'At least one prompt (system or user) is required' };
        }

        return await this.sendChatMessage(messages, options, credentials);
    }

    /**
     * 测试API连接性
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
                        models_count: validationResult.data.total_models,
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
            apiBaseUrl: 'https://api.deepseek.com',
            timeout: 30000,
            retries: 3,
            cacheTimeout: 600000, // 10分钟缓存
            features: {
                models: true,
                connectionTest: true
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
                api_key: {
                    type: 'string',
                    title: 'API Key',
                    description: 'DeepSeek API key from your account dashboard',
                    required: true,
                    sensitive: true,
                    minLength: 32,
                    maxLength: 200,
                    pattern: '^sk-[A-Za-z0-9-]+$',
                    example: 'sk-abcdef1234567890abcdef1234567890abcdef12'
                }
            },
            required: ['api_key'],
            additionalProperties: false
        };
    }
}

module.exports = DeepseekModule;

