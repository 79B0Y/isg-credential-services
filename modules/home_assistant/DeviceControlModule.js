const https = require('https');
const http = require('http');

/**
 * DeviceControlModule - Home Assistant设备控制模块
 * 负责设备控制操作，支持JSON数组格式的批量控制
 */
class DeviceControlModule {
    constructor(logger, baseModule) {
        this.logger = logger;
        this.baseModule = baseModule;
        this.defaultTimeout = 10000;
        // Cache for HA service schemas to filter unsupported fields
        this.serviceSchemaCache = {
            map: null,         // { [domain]: { [service]: Set<string> } }
            fetchedAt: 0,
            ttlMs: 60 * 1000   // 60 seconds TTL
        };
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
                            this.logger.error(`[DEVICE-CONTROL] HTTP ${res.statusCode}: ${responseData}`);
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
                        this.logger.error('[DEVICE-CONTROL] Response处理错误:', error);
                        resolve({
                            error: 'Response parsing error',
                            details: { message: error.message }
                        });
                    }
                });
            });

            req.on('error', (error) => {
                this.logger.error('[DEVICE-CONTROL] Request错误:', error);
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
                this.logger.error('[DEVICE-CONTROL] Request超时');
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
     * 批量控制设备
     * 输入格式：[{"entity_id":"xxx","service":"turn_on","data":{"color_name":"red","brightness_pct":80}}]
     */
    async batchControlDevices(controlCommands, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            if (!controlCommands || !Array.isArray(controlCommands)) {
                return {
                    success: false,
                    error: 'Invalid control commands: array is required',
                    example: [{"entity_id":"light.living_room","service":"turn_on","data":{"color_name":"red","brightness_pct":80}}]
                };
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            this.logger.info(`[DEVICE-CONTROL] 开始批量控制 ${controlCommands.length} 个设备`);

            // 验证命令格式
            const validationErrors = this.validateControlCommands(controlCommands);
            if (validationErrors.length > 0) {
                return {
                    success: false,
                    error: 'Command validation failed',
                    validation_errors: validationErrors
                };
            }

            // 预取服务schema映射，用于过滤不支持的service_data字段
            let schemaMap = null;
            try {
                schemaMap = await this.getServiceSchemaMap(credentials);
            } catch (schemaErr) {
                this.logger.warn('[DEVICE-CONTROL] 获取服务Schema失败，将直接透传service_data:', schemaErr?.message || schemaErr);
            }

            // 并行执行所有控制命令
            const controlPromises = controlCommands.map(async (command, index) => {
                try {
                    const result = await this.executeControlCommand(command, access_token, base_url, schemaMap);
                    return {
                        index,
                        entity_id: command.entity_id,
                        service: command.service,
                        success: true,
                        result: result
                    };
                } catch (error) {
                    this.logger.error(`[DEVICE-CONTROL] 控制设备失败 ${command.entity_id}:`, error);
                    return {
                        index,
                        entity_id: command.entity_id,
                        service: command.service,
                        success: false,
                        error: error.message
                    };
                }
            });

            const results = await Promise.all(controlPromises);

            // 统计结果
            const successCount = results.filter(r => r.success).length;
            const failureCount = results.filter(r => !r.success).length;

            // 获取控制后所有设备的状态
            let deviceStates = [];
            let statesMap = new Map();
            try {
                const entityIds = controlCommands.map(cmd => cmd.entity_id);
                const statesResult = await this.baseModule.basicInfoModule.getEntityStates(entityIds, credentials);
                
                if (statesResult.success && statesResult.data && statesResult.data.states) {
                    deviceStates = statesResult.data.states;
                    // 创建状态映射以便快速查找
                    deviceStates.forEach(state => {
                        statesMap.set(state.entity_id, state);
                    });
                    this.logger.info(`[DEVICE-CONTROL] 成功获取 ${deviceStates.length} 个设备的状态`);
                } else {
                    this.logger.warn('[DEVICE-CONTROL] 获取设备状态失败:', statesResult.error);
                }
            } catch (error) {
                this.logger.error('[DEVICE-CONTROL] 获取设备状态时出错:', error);
            }

            // 为每个控制结果添加对应的设备状态
            const enhancedResults = results.map(result => {
                const deviceState = statesMap.get(result.entity_id);
                return {
                    ...result,
                    current_state: deviceState ? {
                        state: deviceState.state,
                        attributes: deviceState.attributes,
                        last_changed: deviceState.last_changed,
                        last_updated: deviceState.last_updated
                    } : null
                };
            });

            return {
                success: true,
                message: `Batch control completed: ${successCount} succeeded, ${failureCount} failed`,
                data: {
                    total_commands: controlCommands.length,
                    success_count: successCount,
                    failure_count: failureCount,
                    results: enhancedResults,
                    device_states: deviceStates,
                    executed_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[DEVICE-CONTROL] 批量控制失败:', error);
            return {
                success: false,
                error: 'Batch control failed',
                details: { message: error.message }
            };
        }
    }

    /**
     * 验证控制命令格式
     */
    validateControlCommands(commands) {
        const errors = [];

        commands.forEach((command, index) => {
            // 检查必需字段
            if (!command.entity_id) {
                errors.push({
                    index,
                    field: 'entity_id',
                    error: 'entity_id is required'
                });
            }

            if (!command.service) {
                errors.push({
                    index,
                    field: 'service',
                    error: 'service is required'
                });
            }

            // 检查entity_id格式
            if (command.entity_id && !command.entity_id.includes('.')) {
                errors.push({
                    index,
                    field: 'entity_id',
                    error: 'entity_id must be in format "domain.entity_name"'
                });
            }

            // 兼容校验：支持 data 或 service_data
            if (command.data && typeof command.data !== 'object') {
                errors.push({
                    index,
                    field: 'data',
                    error: 'data must be an object'
                });
            }
            if (command.service_data && typeof command.service_data !== 'object') {
                errors.push({
                    index,
                    field: 'service_data',
                    error: 'service_data must be an object'
                });
            }
        });

        return errors;
    }

    /**
     * 执行单个控制命令
     */
    async executeControlCommand(command, accessToken, baseUrl) {
        const { entity_id, service } = command;
        // 新格式优先：service_data，其次向后兼容 data
        const payloadData = (command.service_data !== undefined) ? (command.service_data || {}) : (command.data || {});

        if (!entity_id || !service) {
            throw new Error('Missing required fields: entity_id, service');
        }

        // 解析服务域与名称
        // 默认从 entity_id 推导 domain，若 service 形如 "domain.service" 则优先生效
        let domain = entity_id.split('.')[0];
        let serviceName = service;
        if (typeof service === 'string' && service.includes('.')) {
            const parts = service.split('.');
            if (parts.length === 2 && parts[0] && parts[1]) {
                domain = parts[0];
                serviceName = parts[1];
            }
        }

        // 构建服务调用数据（稍后基于schema过滤不支持的字段）
        let serviceData = { entity_id: entity_id, ...payloadData };

        // 尝试根据HA服务schema过滤不支持的字段
        try {
            const filtered = this.filterServiceDataBySchema(domain, serviceName, serviceData);
            if (filtered.filtered_out && filtered.filtered_out.length > 0) {
                this.logger.info(`[DEVICE-CONTROL] 过滤不支持的字段 ${domain}.${serviceName}: ${filtered.filtered_out.join(', ')}`);
            }
            serviceData = filtered.data;
        } catch (filterErr) {
            // 忽略过滤错误，直接使用原始数据
            this.logger.warn(`[DEVICE-CONTROL] 过滤服务数据失败，跳过过滤: ${filterErr?.message || filterErr}`);
        }

        this.logger.info(`[DEVICE-CONTROL] 执行服务调用: ${domain}.${serviceName} for ${entity_id}`);

        // 调用Home Assistant服务
        const result = await this.callHomeAssistantAPI(
            accessToken,
            baseUrl,
            `/api/services/${domain}/${serviceName}`,
            'POST',
            serviceData
        );

        if (result.error) {
            throw new Error(`Service call failed: ${result.error}`);
        }

        return {
            service_called: `${domain}.${service}`,
            service_data: serviceData,
            result: result
        };
    }

    /**
     * 获取服务Schema映射（带缓存）
     * 返回结构：{ [domain]: { [service]: Set<string> } }
     */
    async getServiceSchemaMap(credentials = null) {
        const now = Date.now();
        if (this.serviceSchemaCache.map && (now - this.serviceSchemaCache.fetchedAt) < this.serviceSchemaCache.ttlMs) {
            return this.serviceSchemaCache.map;
        }

        if (!credentials) {
            const credResult = await this.baseModule.getCredentials();
            if (!credResult.success) {
                throw new Error('No credentials found');
            }
            credentials = credResult.data;
        }

        const { access_token, base_url } = credentials;
        if (!access_token || !base_url) {
            throw new Error('Access token and base URL are required');
        }

        const raw = await this.callHomeAssistantAPI(access_token, base_url, '/api/services');
        if (raw && raw.error) {
            throw new Error(raw.error);
        }

        const map = {};

        // 支持两种可能的返回结构：对象或数组
        const entries = Array.isArray(raw)
            ? raw.map(item => [item.domain, item.services])
            : Object.entries(raw || {});

        for (const [domain, servicesObj] of entries) {
            if (!servicesObj || typeof servicesObj !== 'object') continue;
            map[domain] = map[domain] || {};
            for (const [svcName, svcInfo] of Object.entries(servicesObj)) {
                const fields = (svcInfo && svcInfo.fields && typeof svcInfo.fields === 'object') ? svcInfo.fields : {};
                const keys = new Set(Object.keys(fields));
                // 常见目标字段统一纳入白名单
                keys.add('entity_id');
                keys.add('entity_ids');
                keys.add('area_id');
                keys.add('device_id');
                map[domain][svcName] = keys;
            }
        }

        this.serviceSchemaCache.map = map;
        this.serviceSchemaCache.fetchedAt = now;
        return map;
    }

    /**
     * 按照Schema过滤服务数据中不被支持的字段
     * 若找不到对应schema，则原样返回
     */
    filterServiceDataBySchema(domain, serviceName, data) {
        const schemaMap = this.serviceSchemaCache.map;
        if (!schemaMap || !schemaMap[domain] || !schemaMap[domain][serviceName]) {
            return { data, filtered_out: [] };
        }
        const allowed = schemaMap[domain][serviceName];
        const filtered = { entity_id: data.entity_id }; // 始终保留 entity_id
        const removed = [];
        for (const [k, v] of Object.entries(data)) {
            if (k === 'entity_id') continue;
            if (allowed.has(k)) {
                filtered[k] = v;
            } else {
                removed.push(k);
            }
        }
        return { data: filtered, filtered_out: removed };
    }

    /**
     * 单个设备控制（简化接口）
     */
    async controlSingleDevice(entityId, service, data = {}, credentials = null) {
        const command = {
            entity_id: entityId,
            service: service,
            data: data
        };

        return await this.batchControlDevices([command], credentials);
    }

    /**
     * 常用设备控制方法
     */

    /**
     * 开启设备
     */
    async turnOn(entityId, options = {}, credentials = null) {
        return await this.controlSingleDevice(entityId, 'turn_on', options, credentials);
    }

    /**
     * 关闭设备
     */
    async turnOff(entityId, credentials = null) {
        return await this.controlSingleDevice(entityId, 'turn_off', {}, credentials);
    }

    /**
     * 设置亮度
     */
    async setBrightness(entityId, brightnessPct, credentials = null) {
        return await this.controlSingleDevice(entityId, 'turn_on', { brightness_pct: brightnessPct }, credentials);
    }

    /**
     * 设置颜色
     */
    async setColor(entityId, colorName, credentials = null) {
        return await this.controlSingleDevice(entityId, 'turn_on', { color_name: colorName }, credentials);
    }

    /**
     * 设置RGB颜色
     */
    async setRGBColor(entityId, rgb, credentials = null) {
        return await this.controlSingleDevice(entityId, 'turn_on', { rgb_color: rgb }, credentials);
    }

    /**
     * 设置温度
     */
    async setTemperature(entityId, temperature, credentials = null) {
        return await this.controlSingleDevice(entityId, 'set_temperature', { temperature: temperature }, credentials);
    }

    /**
     * 开启窗帘/百叶窗
     */
    async openCover(entityId, credentials = null) {
        return await this.controlSingleDevice(entityId, 'open_cover', {}, credentials);
    }

    /**
     * 关闭窗帘/百叶窗
     */
    async closeCover(entityId, credentials = null) {
        return await this.controlSingleDevice(entityId, 'close_cover', {}, credentials);
    }

    /**
     * 设置窗帘/百叶窗位置
     */
    async setCoverPosition(entityId, position, credentials = null) {
        return await this.controlSingleDevice(entityId, 'set_cover_position', { position: position }, credentials);
    }

    /**
     * 设置风扇速度
     */
    async setFanSpeed(entityId, speed, credentials = null) {
        return await this.controlSingleDevice(entityId, 'set_speed', { speed: speed }, credentials);
    }

    /**
     * 播放媒体
     */
    async playMedia(entityId, mediaContentId, mediaContentType, credentials = null) {
        return await this.controlSingleDevice(entityId, 'play_media', {
            media_content_id: mediaContentId,
            media_content_type: mediaContentType
        }, credentials);
    }

    /**
     * 获取支持的服务列表
     */
    async getSupportedServices(credentials = null) {
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

            this.logger.info('[DEVICE-CONTROL] 获取支持的服务列表');
            const result = await this.callHomeAssistantAPI(access_token, base_url, '/api/services');

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            // 整理服务信息
            const services = {};
            Object.keys(result).forEach(domain => {
                services[domain] = Object.keys(result[domain]);
            });

            return {
                success: true,
                data: {
                    services: services,
                    detailed_services: result,
                    retrieved_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[DEVICE-CONTROL] 获取服务列表失败:', error);
            return {
                success: false,
                error: 'Failed to get supported services',
                details: { message: error.message }
            };
        }
    }

    /**
     * 生成控制命令示例
     */
    getControlExamples() {
        return {
            success: true,
            data: {
                examples: [
                    {
                        description: "开启灯光并设置颜色和亮度",
                        command: {
                            entity_id: "light.living_room",
                            service: "turn_on",
                            service_data: {
                                color_name: "red",
                                brightness_pct: 80
                            }
                        }
                    },
                    {
                        description: "关闭灯光",
                        command: {
                            entity_id: "light.living_room",
                            service: "turn_off",
                            service_data: {}
                        }
                    },
                    {
                        description: "设置空调温度",
                        command: {
                            entity_id: "climate.living_room",
                            service: "set_temperature",
                            service_data: {
                                temperature: 25
                            }
                        }
                    },
                    {
                        description: "开启窗帘",
                        command: {
                            entity_id: "cover.living_room_curtain",
                            service: "open_cover",
                            service_data: {}
                        }
                    },
                    {
                        description: "设置风扇速度",
                        command: {
                            entity_id: "fan.bedroom",
                            service: "set_speed",
                            service_data: {
                                speed: "medium"
                            }
                        }
                    }
                ],
                batch_example: [
                    {
                        entity_id: "light.living_room",
                        service: "turn_on",
                        service_data: {
                            color_name: "blue",
                            brightness_pct: 70
                        }
                    },
                    {
                        entity_id: "light.bedroom",
                        service: "turn_off",
                        service_data: {}
                    },
                    {
                        entity_id: "climate.living_room",
                        service: "set_temperature",
                        service_data: {
                            temperature: 22
                        }
                    }
                ]
            }
        };
    }
}

module.exports = DeviceControlModule;
