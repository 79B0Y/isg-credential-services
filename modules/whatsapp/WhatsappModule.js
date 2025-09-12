const BaseCredentialModule = require('../../core/BaseCredentialModule');
const https = require('https');

/**
 * WhatsappModule - WhatsApp Business API凭据管理模块
 * 支持access_token和phone_number_id验证
 */
class WhatsappModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        
        // WhatsApp API配置
        this.apiBaseUrl = 'https://graph.facebook.com';
        this.apiVersion = 'v18.0';
        this.defaultTimeout = 12000;
    }

    /**
     * 模块特定初始化
     */
    async onInitialize() {
        this.logger.info('WhatsApp module initializing...');
        
        if (!this.config.apiBaseUrl) {
            this.config.apiBaseUrl = this.apiBaseUrl;
        }
        
        if (!this.config.apiVersion) {
            this.config.apiVersion = this.apiVersion;
        }
        
        if (!this.config.timeout) {
            this.config.timeout = this.defaultTimeout;
        }
        
        this.logger.info('WhatsApp module initialized');
    }

    /**
     * 执行WhatsApp Business API验证
     */
    async performValidation(credentials) {
        const { access_token, phone_number_id } = credentials;
        
        if (!access_token) {
            return {
                success: false,
                error: 'Access token is required',
                details: { field: 'access_token' }
            };
        }

        if (!phone_number_id) {
            return {
                success: false,
                error: 'Phone number ID is required',
                details: { field: 'phone_number_id' }
            };
        }

        try {
            this.logger.info('Validating WhatsApp Business API credentials...');
            
            // 验证phone_number_id
            const phoneInfo = await this.callWhatsAppAPI(
                access_token,
                `/${this.config.apiVersion}/${phone_number_id}`
            );
            
            if (phoneInfo.error) {
                return {
                    success: false,
                    error: phoneInfo.error.message || 'Invalid credentials',
                    details: {
                        error_code: phoneInfo.error.code,
                        error_subcode: phoneInfo.error.error_subcode,
                        type: phoneInfo.error.type
                    }
                };
            }

            // 获取消息模板（如果可用）
            let templates = null;
            try {
                const templatesResult = await this.callWhatsAppAPI(
                    access_token,
                    `/${this.config.apiVersion}/${phone_number_id}/message_templates`
                );
                if (!templatesResult.error) {
                    templates = templatesResult.data || [];
                }
            } catch (error) {
                this.logger.warn('Could not get message templates:', error.message);
            }

            return {
                success: true,
                message: 'WhatsApp Business API credentials are valid',
                data: {
                    phone_info: {
                        id: phoneInfo.id,
                        display_phone_number: phoneInfo.display_phone_number,
                        verified_name: phoneInfo.verified_name,
                        quality_rating: phoneInfo.quality_rating
                    },
                    templates: templates ? {
                        count: templates.length,
                        templates: templates.slice(0, 3) // 返回前3个模板
                    } : null,
                    validated_at: new Date().toISOString()
                }
            };
        } catch (error) {
            this.logger.error('WhatsApp validation error:', error);
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
     * 调用WhatsApp Business API
     */
    async callWhatsAppAPI(accessToken, endpoint, method = 'GET', data = null) {
        return new Promise((resolve, reject) => {
            const url = `${this.config.apiBaseUrl}${endpoint}`;
            const urlObj = new URL(url);
            
            // 添加access_token参数
            urlObj.searchParams.append('access_token', accessToken);

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
     * 获取消息模板
     */
    async getMessageTemplates(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, phone_number_id } = credentials;
            if (!access_token || !phone_number_id) {
                return { success: false, error: 'Access token and phone number ID are required' };
            }

            const result = await this.callWhatsAppAPI(
                access_token,
                `/${this.config.apiVersion}/${phone_number_id}/message_templates`
            );

            if (result.error) {
                return { success: false, error: result.error.message };
            }

            return {
                success: true,
                data: {
                    templates: result.data || [],
                    count: result.data ? result.data.length : 0,
                    retrieved_at: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
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
                        phone_number: validationResult.data.phone_info.display_phone_number,
                        verified_name: validationResult.data.phone_info.verified_name,
                        quality_rating: validationResult.data.phone_info.quality_rating,
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
            apiBaseUrl: 'https://graph.facebook.com',
            apiVersion: 'v18.0',
            timeout: 12000,
            retries: 3,
            cacheTimeout: 300000, // 5分钟缓存
            features: {
                messageTemplates: true,
                connectionTest: true,
                phoneInfo: true
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
                access_token: {
                    type: 'string',
                    title: 'Access Token',
                    description: 'WhatsApp Business API access token',
                    required: true,
                    sensitive: true,
                    minLength: 50,
                    maxLength: 300,
                    example: 'EAABsbCS1iHgBAxxxxxxxxxxxxxxxxxxxxxxxx'
                },
                phone_number_id: {
                    type: 'string',
                    title: 'Phone Number ID',
                    description: 'WhatsApp Business phone number ID',
                    required: true,
                    sensitive: false,
                    minLength: 10,
                    maxLength: 20,
                    pattern: '^\\d+$',
                    example: '1234567890123456'
                }
            },
            required: ['access_token', 'phone_number_id'],
            additionalProperties: false
        };
    }
}

module.exports = WhatsappModule;