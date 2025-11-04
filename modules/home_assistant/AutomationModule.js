const https = require('https');
const http = require('http');

/**
 * AutomationModule - Home Assistant自动化管理模块
 * 负责自动化的查询、创建、删除、启用和禁用操作
 */
class AutomationModule {
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
                            // 尝试解析JSON错误响应
                            let errorBody = responseData;
                            try {
                                errorBody = JSON.parse(responseData);
                            } catch (e) {
                                // 保持原始字符串
                            }
                            
                            this.logger.error(`[AUTOMATION] HTTP ${res.statusCode}: ${responseData}`);
                            this.logger.error(`[AUTOMATION] Response headers:`, JSON.stringify(res.headers, null, 2));
                            
                            resolve({
                                error: `HTTP ${res.statusCode}: ${res.statusMessage}`,
                                details: {
                                    statusCode: res.statusCode,
                                    statusMessage: res.statusMessage,
                                    body: errorBody,
                                    headers: res.headers
                                }
                            });
                        }
                    } catch (error) {
                        this.logger.error('[AUTOMATION] Response处理错误:', error);
                        resolve({
                            error: 'Response parsing error',
                            details: { message: error.message }
                        });
                    }
                });
            });

            req.on('error', (error) => {
                this.logger.error('[AUTOMATION] Request错误:', error);
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
                this.logger.error('[AUTOMATION] Request超时');
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
     * 获取所有自动化列表
     * 通过获取所有实体状态，过滤出domain为automation的实体，并获取完整配置
     */
    async getAutomations(credentials = null) {
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

            this.logger.info('[AUTOMATION] 获取自动化列表');

            // 获取所有实体状态
            const statesResult = await this.callHomeAssistantAPI(access_token, base_url, '/api/states');

            if (statesResult.error) {
                return { success: false, error: statesResult.error, details: statesResult.details };
            }

            // 过滤出自动化实体
            const automations = Array.isArray(statesResult) 
                ? statesResult.filter(entity => entity.entity_id && entity.entity_id.startsWith('automation.'))
                : [];

            // 整理自动化信息，包含 trigger、condition、action 详细信息
            const automationList = await Promise.all(automations.map(async (automation) => {
                const attrs = automation.attributes || {};
                
                // 尝试从配置 API 获取完整配置
                // 注意：必须使用数字 ID (attributes.id)，不是 entity_id
                const numericId = attrs.id;
                let fullConfig = null;
                
                if (numericId) {
                    try {
                        const configResult = await this.callHomeAssistantAPI(
                            access_token, 
                            base_url, 
                            `/api/config/automation/config/${numericId}`
                        );
                        
                        this.logger.info(`[AUTOMATION] Config API response for ${numericId}:`, JSON.stringify(configResult).substring(0, 200));
                        
                        if (configResult && !configResult.error && !configResult.message) {
                            fullConfig = configResult;
                            this.logger.info(`[AUTOMATION] Got config for ${automation.entity_id}, triggers: ${fullConfig?.triggers?.length || 0}, actions: ${fullConfig?.actions?.length || 0}`);
                        } else {
                            this.logger.warn(`[AUTOMATION] Config API failed for ${numericId}:`, configResult?.error || configResult?.message);
                        }
                    } catch (e) {
                        this.logger.warn(`[AUTOMATION] Failed to get config for ${numericId}:`, e.message);
                    }
                } else {
                    this.logger.warn(`[AUTOMATION] No numeric ID found for ${automation.entity_id}`);
                }
                
                return {
                    entity_id: automation.entity_id,
                    name: attrs.friendly_name || automation.entity_id.replace('automation.', ''),
                    state: automation.state, // 'on' 表示启用，'off' 表示禁用
                    enabled: automation.state === 'on',
                    last_triggered: attrs.last_triggered || null,
                    mode: fullConfig?.mode || attrs.mode || null,
                    current: attrs.current || 0,
                    max: fullConfig?.max || attrs.max || 10,
                    icon: attrs.icon || null,
                    last_changed: automation.last_changed,
                    last_updated: automation.last_updated,
                    // 配置 API 使用复数形式：triggers, conditions, actions
                    trigger: fullConfig?.triggers || fullConfig?.trigger || this.extractTriggers(attrs),
                    condition: fullConfig?.conditions || fullConfig?.condition || this.extractConditions(attrs),
                    action: fullConfig?.actions || fullConfig?.action || this.extractActions(attrs),
                    description: fullConfig?.description || attrs.description || null,
                    alias: fullConfig?.alias || attrs.friendly_name || null,
                    id: numericId,
                    attributes: attrs
                };
            }));

            return {
                success: true,
                data: {
                    automations: automationList,
                    total_count: automationList.length,
                    enabled_count: automationList.filter(a => a.enabled).length,
                    disabled_count: automationList.filter(a => !a.enabled).length,
                    retrieved_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[AUTOMATION] 获取自动化列表失败:', error);
            return {
                success: false,
                error: 'Failed to get automations',
                details: { message: error.message }
            };
        }
    }

    /**
     * 创建自动化
     * @param {Object} automationConfig - 自动化配置对象
     * 
     * automationConfig 示例:
     * {
     *   "id": "my_automation_1",  // 可选，系统会自动生成
     *   "alias": "Turn on lights at sunset",
     *   "description": "Automatically turn on lights when sun sets",
     *   "trigger": [
     *     {
     *       "platform": "sun",
     *       "event": "sunset"
     *     }
     *   ],
     *   "condition": [],
     *   "action": [
     *     {
     *       "service": "light.turn_on",
     *       "target": {
     *         "entity_id": "light.living_room"
     *       }
     *     }
     *   ],
     *   "mode": "single"
     * }
     */
    async createAutomation(automationConfig, credentials = null) {
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

            // 验证必需字段
            if (!automationConfig) {
                return { success: false, error: 'Automation configuration is required' };
            }

            if (!automationConfig.alias) {
                return { success: false, error: 'Automation alias (name) is required' };
            }

            if (!automationConfig.trigger || !Array.isArray(automationConfig.trigger) || automationConfig.trigger.length === 0) {
                return { success: false, error: 'At least one trigger is required' };
            }

            if (!automationConfig.action || !Array.isArray(automationConfig.action) || automationConfig.action.length === 0) {
                return { success: false, error: 'At least one action is required' };
            }

            // 如果没有提供 id，生成一个
            if (!automationConfig.id) {
                automationConfig.id = 'automation_' + Date.now();
            }

            this.logger.info('[AUTOMATION] 创建自动化:', automationConfig.alias);

            // 使用 Home Assistant 的配置 API 创建自动化
            // 注意：这需要使用 /api/config/automation/config/{id} endpoint
            const result = await this.callHomeAssistantAPI(
                access_token, 
                base_url, 
                `/api/config/automation/config/${automationConfig.id}`,
                'POST',
                automationConfig
            );

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            this.logger.info('[AUTOMATION] 自动化创建成功:', automationConfig.id);

            return {
                success: true,
                data: {
                    automation_id: automationConfig.id,
                    entity_id: `automation.${automationConfig.id}`,
                    alias: automationConfig.alias,
                    result: result,
                    created_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[AUTOMATION] 创建自动化失败:', error);
            return {
                success: false,
                error: 'Failed to create automation',
                details: { message: error.message }
            };
        }
    }

    /**
     * 删除自动化
     * @param {string} automationId - 自动化ID（entity_id或数字ID）
     */
    async deleteAutomation(automationId, credentials = null) {
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

            if (!automationId) {
                return { success: false, error: 'Automation ID is required' };
            }

            // 移除 "automation." 前缀（如果存在）
            const cleanId = automationId.replace(/^automation\./, '');

            this.logger.info('[AUTOMATION] 删除自动化:', cleanId);

            // 如果ID不是纯数字，需要先获取数字ID
            let numericId = cleanId;
            let automationName = cleanId; // 用于消息显示
            
            if (!/^\d+$/.test(cleanId)) {
                // 不是纯数字，需要通过entity_id获取数字ID
                const entityId = automationId.startsWith('automation.') 
                    ? automationId 
                    : `automation.${automationId}`;
                
                this.logger.info('[AUTOMATION] 非数字ID，查询实体状态获取数字ID...');
                
                const stateResult = await this.callHomeAssistantAPI(
                    access_token, 
                    base_url, 
                    `/api/states/${entityId}`
                );
                
                if (stateResult.error) {
                    return { 
                        success: false, 
                        error: 'Failed to get automation state', 
                        details: stateResult.details 
                    };
                }
                
                // 从attributes中获取数字ID和友好名称
                numericId = stateResult.attributes?.id;
                automationName = stateResult.attributes?.friendly_name || cleanId;
                
                if (!numericId) {
                    return { 
                        success: false, 
                        error: 'Could not find numeric ID for automation',
                        details: { 
                            entity_id: entityId,
                            message: 'The automation does not have a numeric ID in its attributes'
                        }
                    };
                }
                
                this.logger.info(`[AUTOMATION] 找到数字ID: ${numericId}, 名称: ${automationName}`);
            }

            // 使用数字ID删除自动化
            const result = await this.callHomeAssistantAPI(
                access_token, 
                base_url, 
                `/api/config/automation/config/${numericId}`,
                'DELETE'
            );

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            this.logger.info('[AUTOMATION] 自动化删除成功:', numericId);

            // 检测语言：如果名称包含中文字符，使用中文消息；否则使用英文消息
            const hasChinese = /[\u4e00-\u9fa5]/.test(automationName);
            const messageContent = hasChinese 
                ? `自动化${automationName}已删除`
                : `Automation ${automationName} has been deleted`;

            return {
                success: true,
                data: {
                    automation_id: cleanId,
                    numeric_id: numericId,
                    entity_id: `automation.${cleanId}`,
                    deleted_at: new Date().toISOString(),
                    message: {
                        type: "notification",
                        content: messageContent,
                        source: "external_system"
                    }
                }
            };

        } catch (error) {
            this.logger.error('[AUTOMATION] 删除自动化失败:', error);
            return {
                success: false,
                error: 'Failed to delete automation',
                details: { message: error.message }
            };
        }
    }

    /**
     * 启用自动化
     * @param {string} automationId - 自动化实体ID，格式如 "automation.my_automation"
     */
    async enableAutomation(automationId, credentials = null) {
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

            if (!automationId) {
                return { success: false, error: 'Automation ID is required' };
            }

            // 确保 ID 包含 "automation." 前缀
            const entityId = automationId.startsWith('automation.') 
                ? automationId 
                : `automation.${automationId}`;

            this.logger.info('[AUTOMATION] 启用自动化:', entityId);

            // 调用 automation.turn_on 服务
            const result = await this.callHomeAssistantAPI(
                access_token, 
                base_url, 
                '/api/services/automation/turn_on',
                'POST',
                { entity_id: entityId }
            );

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            this.logger.info('[AUTOMATION] 自动化启用成功:', entityId);

            return {
                success: true,
                data: {
                    entity_id: entityId,
                    state: 'on',
                    enabled_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[AUTOMATION] 启用自动化失败:', error);
            return {
                success: false,
                error: 'Failed to enable automation',
                details: { message: error.message }
            };
        }
    }

    /**
     * 禁用自动化
     * @param {string} automationId - 自动化实体ID，格式如 "automation.my_automation"
     */
    async disableAutomation(automationId, credentials = null) {
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

            if (!automationId) {
                return { success: false, error: 'Automation ID is required' };
            }

            // 确保 ID 包含 "automation." 前缀
            const entityId = automationId.startsWith('automation.') 
                ? automationId 
                : `automation.${automationId}`;

            this.logger.info('[AUTOMATION] 禁用自动化:', entityId);

            // 调用 automation.turn_off 服务
            const result = await this.callHomeAssistantAPI(
                access_token, 
                base_url, 
                '/api/services/automation/turn_off',
                'POST',
                { entity_id: entityId }
            );

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            this.logger.info('[AUTOMATION] 自动化禁用成功:', entityId);

            return {
                success: true,
                data: {
                    entity_id: entityId,
                    state: 'off',
                    disabled_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[AUTOMATION] 禁用自动化失败:', error);
            return {
                success: false,
                error: 'Failed to disable automation',
                details: { message: error.message }
            };
        }
    }

    /**
     * 触发自动化（手动执行）
     * @param {string} automationId - 自动化实体ID，格式如 "automation.my_automation"
     */
    async triggerAutomation(automationId, credentials = null) {
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

            if (!automationId) {
                return { success: false, error: 'Automation ID is required' };
            }

            // 确保 ID 包含 "automation." 前缀
            const entityId = automationId.startsWith('automation.') 
                ? automationId 
                : `automation.${automationId}`;

            this.logger.info('[AUTOMATION] 触发自动化:', entityId);

            // 调用 automation.trigger 服务
            const result = await this.callHomeAssistantAPI(
                access_token, 
                base_url, 
                '/api/services/automation/trigger',
                'POST',
                { entity_id: entityId }
            );

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            this.logger.info('[AUTOMATION] 自动化触发成功:', entityId);

            return {
                success: true,
                data: {
                    entity_id: entityId,
                    triggered_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[AUTOMATION] 触发自动化失败:', error);
            return {
                success: false,
                error: 'Failed to trigger automation',
                details: { message: error.message }
            };
        }
    }

    /**
     * 获取单个自动化详情
     * @param {string} automationId - 自动化实体ID，格式如 "automation.my_automation"
     */
    async getAutomation(automationId, credentials = null) {
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

            if (!automationId) {
                return { success: false, error: 'Automation ID is required' };
            }

            // 确保 ID 包含 "automation." 前缀
            const entityId = automationId.startsWith('automation.') 
                ? automationId 
                : `automation.${automationId}`;

            this.logger.info('[AUTOMATION] 获取自动化详情:', entityId);

            // 获取实体状态
            const result = await this.callHomeAssistantAPI(
                access_token, 
                base_url, 
                `/api/states/${entityId}`
            );

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            // 尝试从配置 API 获取完整配置
            // 注意：必须使用数字 ID (attributes.id)，不是 entity_id
            const attrs = result.attributes || {};
            const numericId = attrs.id;
            let fullConfig = null;
            
            if (numericId) {
                try {
                    const configResult = await this.callHomeAssistantAPI(
                        access_token, 
                        base_url, 
                        `/api/config/automation/config/${numericId}`
                    );
                    
                    if (configResult && !configResult.error && !configResult.message) {
                        fullConfig = configResult;
                        this.logger.info(`[AUTOMATION] Got config for ${entityId}`);
                    }
                } catch (e) {
                    this.logger.warn(`[AUTOMATION] Failed to get config for ${numericId}:`, e.message);
                }
            }

            // 整理自动化信息，包含详细配置
            const automationInfo = {
                entity_id: result.entity_id,
                name: attrs.friendly_name || result.entity_id.replace('automation.', ''),
                state: result.state,
                enabled: result.state === 'on',
                last_triggered: attrs.last_triggered || null,
                mode: fullConfig?.mode || attrs.mode || null,
                current: attrs.current || 0,
                max: fullConfig?.max || attrs.max || 10,
                icon: attrs.icon || null,
                last_changed: result.last_changed,
                last_updated: result.last_updated,
                // 配置 API 使用复数形式：triggers, conditions, actions
                trigger: fullConfig?.triggers || fullConfig?.trigger || this.extractTriggers(attrs),
                condition: fullConfig?.conditions || fullConfig?.condition || this.extractConditions(attrs),
                action: fullConfig?.actions || fullConfig?.action || this.extractActions(attrs),
                description: fullConfig?.description || attrs.description || null,
                alias: fullConfig?.alias || attrs.friendly_name || null,
                id: numericId,
                attributes: attrs
            };

            return {
                success: true,
                data: automationInfo
            };

        } catch (error) {
            this.logger.error('[AUTOMATION] 获取自动化详情失败:', error);
            return {
                success: false,
                error: 'Failed to get automation',
                details: { message: error.message }
            };
        }
    }

    /**
     * 重新加载自动化配置
     * 用于在修改自动化配置文件后重新加载
     */
    async reloadAutomations(credentials = null) {
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

            this.logger.info('[AUTOMATION] 重新加载自动化配置');

            // 调用 automation.reload 服务
            const result = await this.callHomeAssistantAPI(
                access_token, 
                base_url, 
                '/api/services/automation/reload',
                'POST',
                {}
            );

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            this.logger.info('[AUTOMATION] 自动化配置重新加载成功');

            return {
                success: true,
                data: {
                    reloaded_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[AUTOMATION] 重新加载自动化配置失败:', error);
            return {
                success: false,
                error: 'Failed to reload automations',
                details: { message: error.message }
            };
        }
    }

    /**
     * 从 attributes 中提取 trigger 信息
     */
    extractTriggers(attributes) {
        // Home Assistant 在 attributes 中可能存储 trigger 信息
        // 不同版本可能位于不同字段
        if (attributes.trigger) {
            return Array.isArray(attributes.trigger) ? attributes.trigger : [attributes.trigger];
        }
        
        // 有些版本可能存储在 triggers 中
        if (attributes.triggers) {
            return Array.isArray(attributes.triggers) ? attributes.triggers : [attributes.triggers];
        }
        
        return [];
    }

    /**
     * 从 attributes 中提取 condition 信息
     */
    extractConditions(attributes) {
        // Home Assistant 在 attributes 中可能存储 condition 信息
        if (attributes.condition) {
            return Array.isArray(attributes.condition) ? attributes.condition : [attributes.condition];
        }
        
        // 有些版本可能存储在 conditions 中
        if (attributes.conditions) {
            return Array.isArray(attributes.conditions) ? attributes.conditions : [attributes.conditions];
        }
        
        return [];
    }

    /**
     * 从 attributes 中提取 action 信息
     */
    extractActions(attributes) {
        // Home Assistant 在 attributes 中可能存储 action 信息
        if (attributes.action) {
            return Array.isArray(attributes.action) ? attributes.action : [attributes.action];
        }
        
        // 有些版本可能存储在 actions 中
        if (attributes.actions) {
            return Array.isArray(attributes.actions) ? attributes.actions : [attributes.actions];
        }
        
        return [];
    }
}

module.exports = AutomationModule;

