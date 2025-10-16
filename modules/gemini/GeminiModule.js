const BaseCredentialModule = require('../../core/BaseCredentialModule');
const https = require('https');

/**
 * GeminiModule - Google Gemini API凭据管理模块
 * 支持API key验证和聊天功能
 */
class GeminiModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        
        // Gemini API配置
        this.apiBaseUrl = 'https://generativelanguage.googleapis.com';
        this.defaultTimeout = 15000;
    }

    /**
     * 模块特定初始化
     */
    async onInitialize() {
        this.logger.info('Gemini module initializing...');
        
        if (!this.config.apiBaseUrl) {
            this.config.apiBaseUrl = this.apiBaseUrl;
        }
        
        if (!this.config.timeout) {
            this.config.timeout = this.defaultTimeout;
        }
        
        this.logger.info('Gemini module initialized');
    }

    /**
     * 执行Gemini API Key验证
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
            this.logger.info('Validating Gemini API key...');
            
            // 调用models API验证key
            const modelsResult = await this.callGeminiAPI(api_key, '/v1beta/models');
            
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
                message: 'Gemini API key is valid',
                data: {
                    models: modelsResult.models ? modelsResult.models.slice(0, 5) : [], // 返回前5个模型
                    total_models: modelsResult.models ? modelsResult.models.length : 0,
                    validated_at: new Date().toISOString()
                }
            };
        } catch (error) {
            this.logger.error('Gemini validation error:', error);
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
     * 调用Gemini API
     */
    async callGeminiAPI(apiKey, endpoint, method = 'GET', data = null) {
        return new Promise((resolve, reject) => {
            const url = `${this.config.apiBaseUrl}${endpoint}?key=${apiKey}`;
            const urlObj = new URL(url);
            
            const headers = {
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

            const result = await this.callGeminiAPI(api_key, '/v1beta/models');
            
            if (result.error) {
                return { success: false, error: result.error.message };
            }

            return {
                success: true,
                data: {
                    models: result.models || [],
                    count: result.models ? result.models.length : 0,
                    retrieved_at: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 发送聊天消息到Gemini
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
                if (!['user', 'model'].includes(message.role)) {
                    return { success: false, error: 'Message role must be user or model' };
                }
            }

            // 构建Gemini格式的请求数据
            const model = options.model || 'gemini-2.5-flash';
            const requestData = {
                contents: this.convertMessagesToGeminiFormat(messages),
                generationConfig: {
                    temperature: options.temperature || 0.7,
                    maxOutputTokens: options.max_tokens || 1000,
                    topP: options.top_p || 1,
                    topK: options.top_k || 40
                }
            };

            // 添加安全设置
            if (options.safety_settings !== false) {
                requestData.safetySettings = [
                    {
                        category: "HARM_CATEGORY_HARASSMENT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        category: "HARM_CATEGORY_HATE_SPEECH",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    }
                ];
            }

            this.logger.info(`Sending chat message to Gemini with model: ${model}`);

            const result = await this.callGeminiAPI(api_key, `/v1beta/models/${model}:generateContent`, 'POST', requestData);
            
            if (result.error) {
                return { 
                    success: false, 
                    error: result.error.message || 'Chat completion failed',
                    details: result.error
                };
            }

            // 提取响应内容
            const candidate = result.candidates && result.candidates[0];
            const content = candidate && candidate.content;
            const parts = content && content.parts;
            const text = parts && parts[0] && parts[0].text;

            return {
                success: true,
                data: {
                    id: result.candidates && result.candidates[0] && result.candidates[0].finishReason,
                    model: model,
                    response_text: text || '',
                    finish_reason: candidate && candidate.finishReason,
                    usage: result.usageMetadata ? {
                        prompt_tokens: result.usageMetadata.promptTokenCount || 0,
                        completion_tokens: result.usageMetadata.candidatesTokenCount || 0,
                        total_tokens: result.usageMetadata.totalTokenCount || 0
                    } : null,
                    safety_ratings: candidate && candidate.safetyRatings,
                    retrieved_at: new Date().toISOString()
                }
            };
        } catch (error) {
            this.logger.error('Gemini chat error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 发送简单聊天消息（系统提示词 + 用户提示词）
     */
    async sendSimpleChat(systemPrompt, userPrompt, options = {}, credentials = null) {
        const messages = [];
        
        // Gemini不支持系统提示词，将系统提示词合并到用户提示词中
        let fullUserPrompt = userPrompt;
        if (systemPrompt && systemPrompt.trim()) {
            fullUserPrompt = `${systemPrompt}\n\n${userPrompt}`;
        }
        
        if (fullUserPrompt && fullUserPrompt.trim()) {
            messages.push({
                role: 'user',
                content: fullUserPrompt.trim()
            });
        }

        if (messages.length === 0) {
            return { success: false, error: 'At least one prompt is required' };
        }

        return await this.sendChatMessage(messages, options, credentials);
    }

    /**
     * 将OpenAI格式的消息转换为Gemini格式
     */
    convertMessagesToGeminiFormat(messages) {
        const contents = [];
        let currentContent = null;

        for (const message of messages) {
            if (message.role === 'user') {
                if (currentContent) {
                    contents.push(currentContent);
                }
                currentContent = {
                    parts: [{ text: message.content }],
                    role: 'user'
                };
            } else if (message.role === 'model' || message.role === 'assistant') {
                if (currentContent) {
                    contents.push(currentContent);
                }
                currentContent = {
                    parts: [{ text: message.content }],
                    role: 'model'
                };
            } else if (message.role === 'system') {
                // Gemini不支持系统消息，将其合并到下一个用户消息中
                if (currentContent && currentContent.role === 'user') {
                    currentContent.parts[0].text = `${message.content}\n\n${currentContent.parts[0].text}`;
                }
            }
        }

        if (currentContent) {
            contents.push(currentContent);
        }

        return contents;
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
            apiBaseUrl: 'https://generativelanguage.googleapis.com',
            timeout: 15000,
            retries: 3,
            cacheTimeout: 600000, // 10分钟缓存
            features: {
                models: true,
                chat: true,
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
                    description: 'Google Gemini API key from Google AI Studio',
                    required: true,
                    sensitive: true,
                    minLength: 20,
                    maxLength: 200,
                    pattern: '^[A-Za-z0-9-_]+$',
                    example: 'AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                    ui: {
                        widget: 'password',
                        placeholder: 'Enter your Gemini API key',
                        help: 'Get your API key from https://aistudio.google.com/app/apikey'
                    }
                }
            },
            required: ['api_key'],
            additionalProperties: false
        };
    }

    /**
     * 简化的聊天接口（类似 OpenAI simple-chat）
     * 支持任意数据输入，自动转换为对话格式
     */
    async sendSimpleChat(system_prompt, user_prompt, options = {}, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            // 处理输入数据，转换为文本
            let userContent = '';
            let systemContent = system_prompt || '';

            if (user_prompt) {
                if (typeof user_prompt === 'string') {
                    userContent = user_prompt;
                } else if (typeof user_prompt === 'object') {
                    try {
                        userContent = JSON.stringify(user_prompt, null, 2);
                    } catch (e) {
                        userContent = String(user_prompt);
                    }
                } else {
                    userContent = String(user_prompt);
                }
            }

            // 构建消息数组（Gemini 格式）
            const messages = [];
            
            // Gemini 不支持 system role，将 system prompt 放在第一个 user 消息中
            if (systemContent && userContent) {
                messages.push({
                    role: 'user',
                    content: `${systemContent}\n\n${userContent}`
                });
            } else if (systemContent) {
                messages.push({
                    role: 'user',
                    content: systemContent
                });
            } else if (userContent) {
                messages.push({
                    role: 'user',
                    content: userContent
                });
            } else {
                return { success: false, error: 'No prompt provided' };
            }

            this.logger.info('Sending simple chat to Gemini');

            // 调用 sendChatMessage
            const result = await this.sendChatMessage(messages, options, credentials);

            if (result.success) {
                // 提取响应文本（注意 Gemini 返回的字段名）
                const responseText = result.data?.response_text || result.data?.message?.content || result.data?.content || '';
                
                return {
                    success: true,
                    data: {
                        response_text: responseText,
                        message: {
                            role: 'model',
                            content: responseText
                        },
                        usage: result.data?.usage,
                        model: result.data?.model || options.model || 'gemini-2.5-flash',
                        finish_reason: result.data?.finish_reason
                    }
                };
            } else {
                return result;
            }
        } catch (error) {
            this.logger.error('Simple chat error:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = GeminiModule;
