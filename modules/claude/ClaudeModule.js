const BaseCredentialModule = require('../../core/BaseCredentialModule');
const https = require('https');

/**
 * ClaudeModule - Anthropic Claude API凭据管理模块
 * 支持Claude API key验证
 */
class ClaudeModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        
        // Claude API配置
        this.apiBaseUrl = 'https://api.anthropic.com';
        this.defaultTimeout = 15000;
    }

    /**
     * 模块特定初始化
     */
    async onInitialize() {
        this.logger.info('Claude module initializing...');
        
        if (!this.config.apiBaseUrl) {
            this.config.apiBaseUrl = this.apiBaseUrl;
        }
        
        if (!this.config.timeout) {
            this.config.timeout = this.defaultTimeout;
        }
        
        this.logger.info('Claude module initialized');
    }

    /**
     * 执行Claude API Key验证
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
            this.logger.info('Validating Claude API key...');
            
            // 使用一个简单的消息验证API key
            const testMessage = {
                model: "claude-3-haiku-20240307",
                max_tokens: 10,
                messages: [
                    {
                        role: "user",
                        content: "Hi"
                    }
                ]
            };
            
            const result = await this.callClaudeAPI(api_key, '/v1/messages', 'POST', testMessage);
            
            if (result.error) {
                return {
                    success: false,
                    error: result.error.message || 'Invalid API key',
                    details: {
                        type: result.error.type,
                        error_code: result.error.error_code
                    }
                };
            }

            return {
                success: true,
                message: 'Claude API key is valid',
                data: {
                    model: testMessage.model,
                    api_version: 'v1',
                    response_id: result.id,
                    validated_at: new Date().toISOString()
                }
            };
        } catch (error) {
            this.logger.error('Claude validation error:', error);
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
     * 调用Claude API
     */
    async callClaudeAPI(apiKey, endpoint, method = 'POST', data = null) {
        return new Promise((resolve, reject) => {
            const url = `${this.config.apiBaseUrl}${endpoint}`;
            const urlObj = new URL(url);
            
            const headers = {
                'x-api-key': apiKey,
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01',
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
                        model: validationResult.data.model,
                        api_version: validationResult.data.api_version,
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
     * 获取支持的模型信息
     */
    async getModelInfo() {
        return {
            success: true,
            data: {
                supported_models: [
                    {
                        name: "claude-3-opus-20240229",
                        description: "Most powerful model for highly complex tasks",
                        context_window: 200000
                    },
                    {
                        name: "claude-3-sonnet-20240229",
                        description: "Balanced performance for a wide range of tasks",
                        context_window: 200000
                    },
                    {
                        name: "claude-3-haiku-20240307",
                        description: "Fastest model for simple tasks and real-time interactions",
                        context_window: 200000
                    }
                ],
                api_version: "2023-06-01",
                retrieved_at: new Date().toISOString()
            }
        };
    }

    /**
     * 获取默认配置
     */
    getDefaultConfig() {
        return {
            ...super.getDefaultConfig(),
            apiBaseUrl: 'https://api.anthropic.com',
            timeout: 15000,
            retries: 3,
            cacheTimeout: 600000, // 10分钟缓存
            features: {
                models: true,
                connectionTest: true,
                streaming: false
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
                    description: 'Anthropic Claude API key from your account',
                    required: true,
                    sensitive: true,
                    minLength: 40,
                    maxLength: 120,
                    pattern: '^sk-ant-[A-Za-z0-9_-]+$',
                    example: 'sk-ant-api03-abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12'
                }
            },
            required: ['api_key'],
            additionalProperties: false
        };
    }
}

module.exports = ClaudeModule;