const https = require('https');
const http = require('http');

/**
 * BasicInfoModule - Home Assistant基础信息管理模块
 * 负责获取配置信息、Access Token信息和实体状态
 */
class BasicInfoModule {
    constructor(logger, baseModule) {
        this.logger = logger;
        this.baseModule = baseModule;
        this.defaultTimeout = 10000;
    }

    /**
     * 调用Home Assistant API
     */
    async callHomeAssistantAPI(accessToken, baseUrl, endpoint, method = 'GET', data = null) {
        return new Promise((resolve, reject) => {
            const url = baseUrl.endsWith('/') ? baseUrl + endpoint.substring(1) : baseUrl + endpoint;
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            const headers = {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'CredentialService/1.0'
            };

            const postData = data ? JSON.stringify(data) : null;
            if (postData) {
                headers['Content-Length'] = Buffer.byteLength(postData);
            }

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: method,
                headers: headers,
                timeout: this.defaultTimeout,
                // 允许自签名证书（适用于本地Home Assistant）
                rejectUnauthorized: false
            };

            const req = httpModule.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            let result = responseData;
                            try {
                                result = JSON.parse(responseData);
                            } catch (parseError) {
                                // 如果不是JSON，返回原始字符串
                            }
                            resolve(result);
                        } else {
                            this.logger.error(`[BASIC-INFO] HTTP ${res.statusCode}: ${responseData}`);
                            resolve({
                                error: `HTTP ${res.statusCode}: ${res.statusMessage}`,
                                details: {
                                    statusCode: res.statusCode,
                                    statusMessage: res.statusMessage,
                                    body: responseData
                                }
                            });
                        }
                    } catch (error) {
                        this.logger.error('[BASIC-INFO] Response处理错误:', error);
                        resolve({
                            error: 'Response parsing error',
                            details: { message: error.message }
                        });
                    }
                });
            });

            req.on('error', (error) => {
                this.logger.error('[BASIC-INFO] Request错误:', error);
                resolve({
                    error: 'Request failed',
                    details: {
                        message: error.message,
                        code: error.code
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy();
                this.logger.error('[BASIC-INFO] Request超时');
                resolve({
                    error: 'Request timeout',
                    details: { timeout: this.defaultTimeout }
                });
            });

            if (postData) {
                req.write(postData);
            }

            req.end();
        });
    }

    /**
     * 获取Home Assistant配置信息
     */
    async getConfig(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            this.logger.info('[BASIC-INFO] 获取Home Assistant配置信息');
            const result = await this.callHomeAssistantAPI(access_token, base_url, '/api/config');

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            return {
                success: true,
                data: {
                    config: result,
                    retrieved_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[BASIC-INFO] 获取配置失败:', error);
            return {
                success: false,
                error: 'Failed to get config',
                details: { message: error.message }
            };
        }
    }

    /**
     * 获取Access Token信息
     */
    async getTokenInfo(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            this.logger.info('[BASIC-INFO] 获取Access Token信息');

            // 通过调用认证端点获取token信息
            const result = await this.callHomeAssistantAPI(access_token, base_url, '/api/');

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            // 尝试获取更详细的认证信息
            let authInfo = null;
            try {
                const authResult = await this.callHomeAssistantAPI(access_token, base_url, '/api/auth/current');
                if (!authResult.error) {
                    authInfo = authResult;
                }
            } catch (error) {
                this.logger.warn('[BASIC-INFO] 无法获取详细认证信息:', error.message);
            }

            // Token基础信息分析
            const tokenInfo = {
                token_length: access_token.length,
                token_prefix: access_token.substring(0, Math.min(20, access_token.length)) + '...',
                full_token: access_token,  // 添加完整token
                base_url: base_url,
                is_valid: true,
                api_message: result.message || 'API running',
                auth_details: authInfo
            };

            return {
                success: true,
                data: {
                    token_info: tokenInfo,
                    retrieved_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[BASIC-INFO] 获取Token信息失败:', error);
            return {
                success: false,
                error: 'Failed to get token info',
                details: { message: error.message }
            };
        }
    }

    /**
     * 获取所有实体状态
     */
    async getStates(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            this.logger.info('[BASIC-INFO] 获取所有实体状态');
            const result = await this.callHomeAssistantAPI(access_token, base_url, '/api/states');

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            return {
                success: true,
                data: {
                    states: result,
                    count: Array.isArray(result) ? result.length : 0,
                    retrieved_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[BASIC-INFO] 获取状态失败:', error);
            return {
                success: false,
                error: 'Failed to get states',
                details: { message: error.message }
            };
        }
    }

    /**
     * 根据实体ID获取特定实体状态
     */
    async getEntityStates(entityIds, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            if (!Array.isArray(entityIds) || entityIds.length === 0) {
                return { success: false, error: 'Entity IDs array is required' };
            }

            this.logger.info(`[BASIC-INFO] 获取 ${entityIds.length} 个实体的状态`);

            const states = [];
            const errors = [];

            // 并行获取所有实体状态
            const promises = entityIds.map(async (entityId) => {
                try {
                    const state = await this.callHomeAssistantAPI(
                        access_token,
                        base_url,
                        `/api/states/${entityId}`,
                        'GET'
                    );

                    if (state && !state.error) {
                        return {
                            entity_id: entityId,
                            state: state.state,
                            attributes: state.attributes,
                            last_changed: state.last_changed,
                            last_updated: state.last_updated
                        };
                    } else {
                        errors.push({
                            entity_id: entityId,
                            error: state.error || 'Unknown error'
                        });
                        return null;
                    }
                } catch (error) {
                    errors.push({
                        entity_id: entityId,
                        error: error.message
                    });
                    return null;
                }
            });

            const results = await Promise.all(promises);

            // 过滤掉null结果
            const validStates = results.filter(state => state !== null);

            return {
                success: true,
                data: {
                    states: validStates,
                    requested_count: entityIds.length,
                    success_count: validStates.length,
                    error_count: errors.length,
                    errors: errors,
                    retrieved_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[BASIC-INFO] 获取实体状态失败:', error);
            return {
                success: false,
                error: 'Failed to get entity states',
                details: { message: error.message }
            };
        }
    }

    /**
     * 测试API连接
     */
    async testConnection(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            this.logger.info('[BASIC-INFO] 测试API连接');

            // 获取基础API信息
            const apiResult = await this.callHomeAssistantAPI(access_token, base_url, '/api/');
            if (apiResult.error) {
                return {
                    success: false,
                    error: 'API connection failed',
                    details: apiResult.details
                };
            }

            // 获取配置信息
            let configInfo = null;
            try {
                const configResult = await this.getConfig(credentials);
                if (configResult.success) {
                    configInfo = configResult.data.config;
                }
            } catch (error) {
                this.logger.warn('[BASIC-INFO] 无法获取配置信息:', error.message);
            }

            // 获取状态统计
            let statesCount = 0;
            try {
                const statesResult = await this.getStates(credentials);
                if (statesResult.success && Array.isArray(statesResult.data.states)) {
                    statesCount = statesResult.data.states.length;
                }
            } catch (error) {
                this.logger.warn('[BASIC-INFO] 无法获取状态数量:', error.message);
            }

            return {
                success: true,
                message: 'Home Assistant API connection successful',
                data: {
                    api_info: apiResult,
                    config: configInfo ? {
                        location_name: configInfo.location_name,
                        version: configInfo.version,
                        elevation: configInfo.elevation,
                        unit_system: configInfo.unit_system,
                        time_zone: configInfo.time_zone
                    } : null,
                    entities_count: statesCount,
                    base_url: base_url,
                    tested_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[BASIC-INFO] 连接测试失败:', error);
            return {
                success: false,
                error: 'Connection test failed',
                details: { message: error.message }
            };
        }
    }

    /**
     * 获取系统概览信息
     */
    async getSystemOverview(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            this.logger.info('[BASIC-INFO] 获取系统概览信息');

            // 并行获取所有信息
            const [configResult, tokenResult, statesResult] = await Promise.all([
                this.getConfig(credentials),
                this.getTokenInfo(credentials),
                this.getStates(credentials)
            ]);

            // 统计实体类型
            let entityTypeStats = {};
            if (statesResult.success && Array.isArray(statesResult.data.states)) {
                statesResult.data.states.forEach(state => {
                    const domain = state.entity_id.split('.')[0];
                    entityTypeStats[domain] = (entityTypeStats[domain] || 0) + 1;
                });
            }

            return {
                success: true,
                data: {
                    config: configResult.success ? configResult.data.config : null,
                    token_info: tokenResult.success ? tokenResult.data.token_info : null,
                    states_summary: {
                        total_entities: statesResult.success ? statesResult.data.count : 0,
                        entity_types: entityTypeStats,
                        last_retrieved: statesResult.success ? statesResult.data.retrieved_at : null
                    },
                    overview_generated_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[BASIC-INFO] 获取系统概览失败:', error);
            return {
                success: false,
                error: 'Failed to get system overview',
                details: { message: error.message }
            };
        }
    }
}

module.exports = BasicInfoModule;