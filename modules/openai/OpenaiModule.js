const BaseCredentialModule = require('../../core/BaseCredentialModule');
const https = require('https');

/**
 * OpenaiModule - OpenAI API凭据管理模块
 * 支持API key和organization验证
 */
class OpenaiModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        
        // OpenAI API配置
        this.apiBaseUrl = 'https://api.openai.com';
        this.defaultTimeout = 15000;
    }

    /**
     * 模块特定初始化
     */
    async onInitialize() {
        this.logger.info('OpenAI module initializing...');
        
        if (!this.config.apiBaseUrl) {
            this.config.apiBaseUrl = this.apiBaseUrl;
        }
        
        if (!this.config.timeout) {
            this.config.timeout = this.defaultTimeout;
        }
        
        this.logger.info('OpenAI module initialized');
    }

    /**
     * 执行OpenAI API Key验证
     */
    async performValidation(credentials) {
        const { api_key, organization } = credentials;
        
        if (!api_key) {
            return {
                success: false,
                error: 'API key is required',
                details: { field: 'api_key' }
            };
        }

        try {
            this.logger.info('Validating OpenAI API key...');
            
            // 调用models API验证key
            const modelsResult = await this.callOpenAIAPI(api_key, organization, '/v1/models');
            
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

            // 获取账户信息（如果可能）
            let accountInfo = null;
            try {
                const accountResult = await this.callOpenAIAPI(api_key, organization, '/v1/usage');
                if (!accountResult.error) {
                    accountInfo = accountResult;
                }
            } catch (error) {
                this.logger.warn('Could not get account info:', error.message);
            }

            return {
                success: true,
                message: 'OpenAI API key is valid',
                data: {
                    models: modelsResult.data ? modelsResult.data.slice(0, 5) : [], // 返回前5个模型
                    total_models: modelsResult.data ? modelsResult.data.length : 0,
                    organization: organization || null,
                    account_info: accountInfo,
                    validated_at: new Date().toISOString()
                }
            };
        } catch (error) {
            this.logger.error('OpenAI validation error:', error);
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
     * 调用OpenAI API
     */
    async callOpenAIAPI(apiKey, organization, endpoint, method = 'GET', data = null) {
        return new Promise((resolve, reject) => {
            const url = `${this.config.apiBaseUrl}${endpoint}`;
            const urlObj = new URL(url);
            
            const headers = {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'CredentialService/1.0'
            };

            if (organization) {
                headers['OpenAI-Organization'] = organization;
            }

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
     * 调用OpenAI API（支持FormData）
     */
    async callOpenAIAPIWithFormData(apiKey, organization, endpoint, formData) {
        return new Promise((resolve, reject) => {
            const url = `${this.config.apiBaseUrl}${endpoint}`;
            const urlObj = new URL(url);
            
            const headers = {
                'Authorization': `Bearer ${apiKey}`,
                'User-Agent': 'CredentialService/1.0'
            };

            if (organization) {
                headers['OpenAI-Organization'] = organization;
            }

            // 获取FormData的headers
            const formHeaders = formData.getHeaders();
            Object.assign(headers, formHeaders);

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || 443,
                path: urlObj.pathname + urlObj.search,
                method: 'POST',
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

            // 发送FormData
            formData.pipe(req);
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

            const { api_key, organization } = credentials;
            if (!api_key) {
                return { success: false, error: 'API key is required' };
            }

            const result = await this.callOpenAIAPI(api_key, organization, '/v1/models');
            
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
     * 发送聊天消息到OpenAI
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

            const { api_key, organization } = credentials;
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
                model: options.model || 'gpt-3.5-turbo',
                messages: messages,
                temperature: options.temperature || 0.7,
                max_tokens: options.max_tokens || 1000,
                top_p: options.top_p || 1,
                frequency_penalty: options.frequency_penalty || 0,
                presence_penalty: options.presence_penalty || 0
            };

            // 添加可选参数
            if (options.stream !== undefined) {
                requestData.stream = options.stream;
            }
            if (options.stop) {
                requestData.stop = options.stop;
            }

            this.logger.info(`Sending chat message to OpenAI with model: ${requestData.model}`);

            const result = await this.callOpenAIAPI(api_key, organization, '/v1/chat/completions', 'POST', requestData);
            
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
            this.logger.error('OpenAI chat error:', error);
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
                        organization: validationResult.data.organization,
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
     * 音频转文字（使用Whisper API）
     */
    async transcribeAudio(audioFile, options = {}, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { api_key, organization } = credentials;
            if (!api_key) {
                return { success: false, error: 'API key is required' };
            }

            // 默认选项
            const defaultOptions = {
                model: 'whisper-1',
                language: null, // 自动检测
                prompt: null, // 可选的提示词
                response_format: 'json',
                temperature: 0.0
            };

            const finalOptions = { ...defaultOptions, ...options };

            this.logger.info('Transcribing audio with Whisper API...');

            // 准备表单数据
            const FormData = require('form-data');
            const form = new FormData();
            
            // 添加音频文件
            if (Buffer.isBuffer(audioFile)) {
                form.append('file', audioFile, {
                    filename: 'audio.mp3',
                    contentType: 'audio/mpeg'
                });
            } else if (typeof audioFile === 'string') {
                // 如果是文件路径
                const fs = require('fs');
                const audioBuffer = fs.readFileSync(audioFile);
                form.append('file', audioBuffer, {
                    filename: 'audio.mp3',
                    contentType: 'audio/mpeg'
                });
            } else {
                return { success: false, error: 'Invalid audio file format' };
            }

            // 添加选项
            form.append('model', finalOptions.model);
            if (finalOptions.language) {
                form.append('language', finalOptions.language);
            }
            if (finalOptions.prompt) {
                form.append('prompt', finalOptions.prompt);
            }
            form.append('response_format', finalOptions.response_format);
            form.append('temperature', finalOptions.temperature.toString());

            // 调用Whisper API
            const response = await this.callOpenAIAPIWithFormData(
                api_key,
                organization,
                '/v1/audio/transcriptions',
                form
            );

            if (response.text) {
                return {
                    success: true,
                    message: 'Audio transcribed successfully',
                    data: {
                        text: response.text,
                        model: finalOptions.model,
                        language: finalOptions.language || 'auto-detected',
                        transcribed_at: new Date().toISOString()
                    }
                };
            } else {
                return {
                    success: false,
                    error: 'Transcription failed',
                    details: response
                };
            }
        } catch (error) {
            this.logger.error('Failed to transcribe audio:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 从URL下载音频并转文字
     */
    async transcribeAudioFromUrl(audioUrl, options = {}, credentials = null) {
        try {
            this.logger.info('Downloading audio from URL...');
            
            // 下载音频文件
            const https = require('https');
            const http = require('http');
            const url = require('url');
            
            const audioBuffer = await new Promise((resolve, reject) => {
                const parsedUrl = url.parse(audioUrl);
                const httpModule = parsedUrl.protocol === 'https:' ? https : http;
                
                const req = httpModule.get(audioUrl, (res) => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                        return;
                    }
                    
                    const chunks = [];
                    res.on('data', chunk => chunks.push(chunk));
                    res.on('end', () => resolve(Buffer.concat(chunks)));
                });
                
                req.on('error', reject);
                req.setTimeout(this.config.timeout || 30000, () => {
                    req.destroy();
                    reject(new Error('Download timeout'));
                });
            });

            // 转文字
            return await this.transcribeAudio(audioBuffer, options, credentials);
        } catch (error) {
            this.logger.error('Failed to download and transcribe audio:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取默认配置
     */
    getDefaultConfig() {
        return {
            ...super.getDefaultConfig(),
            apiBaseUrl: 'https://api.openai.com',
            timeout: 15000,
            retries: 3,
            cacheTimeout: 600000, // 10分钟缓存
            features: {
                models: true,
                usage: true,
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
                    description: 'OpenAI API key from your account dashboard',
                    required: true,
                    sensitive: true,
                    minLength: 40,
                    maxLength: 60,
                    pattern: '^sk-[A-Za-z0-9]+$',
                    example: 'sk-abcdef1234567890abcdef1234567890abcdef12'
                },
                organization: {
                    type: 'string',
                    title: 'Organization ID',
                    description: 'OpenAI Organization ID (optional)',
                    required: false,
                    sensitive: false,
                    minLength: 20,
                    maxLength: 30,
                    pattern: '^org-[A-Za-z0-9]+$',
                    example: 'org-abcdef1234567890abcdef12'
                }
            },
            required: ['api_key'],
            additionalProperties: false
        };
    }
}

module.exports = OpenaiModule;