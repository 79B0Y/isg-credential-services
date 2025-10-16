const BaseCredentialModule = require('../../core/BaseCredentialModule');
const https = require('https');
const http = require('http');
const WebSocket = require('ws');
const WorkerManager = require('../../lib/WorkerManager');

/**
 * Home_assistantModule - Home Assistant API凭据管理模块
 * 支持access_token和base_url验证
 */
class Home_assistantModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        
        // Home Assistant API配置
        this.defaultTimeout = 10000;
        
        // 增强状态数据缓存系统 - Termux环境优化（延长间隔减少内存压力）
        this.enhancedStatesCache = {
            data: null,
            lastUpdated: null,
            isUpdating: false,
            updateInterval: 180000, // 3分钟（大幅延长避免内存压力）
            maxAge: 360000, // 6分钟最大缓存时间
            staggerDelay: Math.floor(Math.random() * 30000) // 随机0-30秒初始延迟
        };
        
        // 缓存更新定时器
        this.cacheUpdateTimer = null;
        
        // 工作进程管理器 - 用于内存安全的API处理
        this.workerManager = null;
        this.workerInitialized = false;
    }

    /**
     * 模块特定初始化
     */
    async onInitialize() {
        this.logger.info('Home Assistant module initializing...');
        
        if (!this.config.timeout) {
            this.config.timeout = this.defaultTimeout;
        }
        
        // 初始化工作进程管理器
        try {
            this.workerManager = new WorkerManager(this.logger);
            await this.workerManager.startWorker();
            this.workerInitialized = true;
            this.logger.info('[WORKER-INIT] Home Assistant工作进程已启动');
        } catch (error) {
            this.logger.error('[WORKER-INIT] 工作进程启动失败:', error.message);
            this.workerInitialized = false;
        }
        
        // 启动增强状态数据缓存更新定时器
        this.startEnhancedStatesCacheUpdater();
        
        this.logger.info('Home Assistant module initialized with enhanced states cache and worker process');
    }

    /**
     * 执行Home Assistant API验证
     */
    async performValidation(credentials) {
        const { access_token, base_url } = credentials;
        
        if (!access_token) {
            return {
                success: false,
                error: 'Access token is required',
                details: { field: 'access_token' }
            };
        }

        if (!base_url) {
            return {
                success: false,
                error: 'Base URL is required',
                details: { field: 'base_url' }
            };
        }

        try {
            this.logger.info('Validating Home Assistant API credentials...');
            
            // 验证URL格式
            let baseUrl;
            try {
                baseUrl = new URL(base_url);
            } catch (urlError) {
                return {
                    success: false,
                    error: 'Invalid base URL format',
                    details: { field: 'base_url', message: urlError.message }
                };
            }

            // 调用API验证连接
            const apiResult = await this.callHomeAssistantAPI(access_token, base_url, '/api/');
            
            if (apiResult.error) {
                return {
                    success: false,
                    error: apiResult.error,
                    details: apiResult.details
                };
            }

            // 获取配置信息
            let configInfo = null;
            try {
                const configResult = await this.callHomeAssistantAPI(access_token, base_url, '/api/config');
                if (!configResult.error) {
                    configInfo = configResult;
                }
            } catch (error) {
                this.logger.warn('Could not get config info:', error.message);
            }

            // 获取状态统计
            let statesCount = 0;
            try {
                const statesResult = await this.callHomeAssistantAPI(access_token, base_url, '/api/states');
                if (!statesResult.error && Array.isArray(statesResult)) {
                    statesCount = statesResult.length;
                }
            } catch (error) {
                this.logger.warn('Could not get states count:', error.message);
            }

            return {
                success: true,
                message: 'Home Assistant API credentials are valid',
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
                    validated_at: new Date().toISOString()
                }
            };
        } catch (error) {
            this.logger.error('Home Assistant validation error:', error);
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
                timeout: this.config.timeout,
                // 允许自签名证书（适用于本地Home Assistant）
                rejectUnauthorized: false
            };

            const req = httpModule.request(options, (res) => {
                let responseData = '';
                
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                res.on('end', () => {
                    if (res.statusCode >= 400) {
                        let errorMessage = `HTTP ${res.statusCode}`;
                        try {
                            const errorData = JSON.parse(responseData);
                            errorMessage = errorData.message || errorMessage;
                        } catch (parseError) {
                            // 使用默认错误消息
                        }
                        
                        resolve({
                            error: errorMessage,
                            details: {
                                status: res.statusCode,
                                statusText: res.statusMessage
                            }
                        });
                        return;
                    }

                    try {
                        const response = JSON.parse(responseData);
                        resolve(response);
                    } catch (parseError) {
                        // 如果不是JSON，返回原始响应（某些API端点返回文本）
                        if (responseData.trim()) {
                            resolve({ message: responseData.trim() });
                        } else {
                            reject(new Error(`Invalid response: ${parseError.message}`));
                        }
                    }
                });
            });

            req.on('error', (error) => {
                let errorMessage = 'Connection failed';
                if (error.code === 'ECONNREFUSED') {
                    errorMessage = 'Connection refused - check if Home Assistant is running';
                } else if (error.code === 'ENOTFOUND') {
                    errorMessage = 'Host not found - check your base URL';
                } else if (error.code === 'ECONNRESET') {
                    errorMessage = 'Connection reset - check your network or SSL settings';
                }
                
                resolve({
                    error: errorMessage,
                    details: {
                        code: error.code,
                        message: error.message
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({
                    error: `Request timeout after ${this.config.timeout}ms`,
                    details: { timeout: this.config.timeout }
                });
            });

            if (postData) {
                req.write(postData);
            }
            
            req.end();
        });
    }

    /**
     * 获取实体状态
     */
    async getStates(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

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
            return { success: false, error: error.message };
        }
    }

    /**
     * 使用WebSocket API获取设备列表
     * @param {string} access_token - 访问令牌
     * @param {string} base_url - 基础URL
     * @returns {Promise<Object>} 设备列表
     */
    async getDevicesViaWebSocket(access_token, base_url) {
        return new Promise((resolve, reject) => {
            const wsUrl = base_url.replace('http://', 'ws://').replace('https://', 'wss://') + '/api/websocket';
            const ws = new WebSocket(wsUrl);
            let messageId = 1;
            let resolved = false;

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    ws.close();
                    reject(new Error('WebSocket request timeout'));
                }
            }, 10000);

            ws.on('open', () => {
                // 发送认证消息
                ws.send(JSON.stringify({
                    type: 'auth',
                    access_token: access_token
                }));
            });

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    
                    if (msg.type === 'auth_ok') {
                        // 请求设备注册表
                        ws.send(JSON.stringify({
                            id: messageId++,
                            type: 'config/device_registry/list'
                        }));
                    } else if (msg.type === 'result' && msg.success) {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            ws.close();
                            resolve({
                                success: true,
                                data: {
                                    devices: msg.result,
                                    count: Array.isArray(msg.result) ? msg.result.length : 0,
                                    retrieved_at: new Date().toISOString()
                                }
                            });
                        }
                    } else if (msg.type === 'result' && !msg.success) {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            ws.close();
                            reject(new Error(msg.error?.message || 'WebSocket request failed'));
                        }
                    }
                } catch (error) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        ws.close();
                        reject(error);
                    }
                }
            });

            ws.on('error', (error) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(error);
                }
            });

            ws.on('close', () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(new Error('WebSocket connection closed'));
                }
            });
        });
    }

    /**
     * 使用WebSocket API获取楼层列表
     * @param {string} access_token - 访问令牌
     * @param {string} base_url - 基础URL
     * @returns {Promise<Object>} 楼层列表
     */
    async getFloorsViaWebSocket(access_token, base_url) {
        return new Promise((resolve, reject) => {
            const wsUrl = base_url.replace('http://', 'ws://').replace('https://', 'wss://') + '/api/websocket';
            const ws = new WebSocket(wsUrl);
            let messageId = 1;
            let resolved = false;

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    ws.close();
                    reject(new Error('WebSocket request timeout'));
                }
            }, 10000);

            ws.on('open', () => {
                // 发送认证消息
                ws.send(JSON.stringify({
                    type: 'auth',
                    access_token: access_token
                }));
            });

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    
                    if (msg.type === 'auth_ok') {
                        // 请求楼层注册表
                        ws.send(JSON.stringify({
                            id: messageId++,
                            type: 'config/floor_registry/list'
                        }));
                    } else if (msg.type === 'result' && msg.success) {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            ws.close();
                            resolve({
                                success: true,
                                data: {
                                    floors: msg.result,
                                    count: Array.isArray(msg.result) ? msg.result.length : 0,
                                    retrieved_at: new Date().toISOString()
                                }
                            });
                        }
                    } else if (msg.type === 'result' && !msg.success) {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            ws.close();
                            reject(new Error(msg.error?.message || 'WebSocket request failed'));
                        }
                    }
                } catch (error) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        ws.close();
                        reject(error);
                    }
                }
            });

            ws.on('error', (error) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(error);
                }
            });

            ws.on('close', () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(new Error('WebSocket connection closed'));
                }
            });
        });
    }

    /**
     * 使用WebSocket API获取实体注册表列表
     * @param {string} access_token - 访问令牌
     * @param {string} base_url - 基础URL
     * @returns {Promise<Object>} 实体注册表列表
     */
    async getEntityRegistryViaWebSocket(access_token, base_url) {
        return new Promise((resolve, reject) => {
            const wsUrl = base_url.replace('http://', 'ws://').replace('https://', 'wss://') + '/api/websocket';
            const ws = new WebSocket(wsUrl);
            let messageId = 1;
            let resolved = false;

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    ws.close();
                    reject(new Error('WebSocket request timeout'));
                }
            }, 10000);

            ws.on('open', () => {
                // 发送认证消息
                ws.send(JSON.stringify({
                    type: 'auth',
                    access_token: access_token
                }));
            });

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    
                    if (msg.type === 'auth_ok') {
                        // 请求实体注册表
                        ws.send(JSON.stringify({
                            id: messageId++,
                            type: 'config/entity_registry/list'
                        }));
                    } else if (msg.type === 'result' && msg.success) {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            ws.close();
                            resolve({
                                success: true,
                                data: {
                                    entities: msg.result,
                                    count: Array.isArray(msg.result) ? msg.result.length : 0,
                                    retrieved_at: new Date().toISOString()
                                }
                            });
                        }
                    } else if (msg.type === 'result' && !msg.success) {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            ws.close();
                            reject(new Error(msg.error?.message || 'WebSocket request failed'));
                        }
                    }
                } catch (error) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        ws.close();
                        reject(error);
                    }
                }
            });

            ws.on('error', (error) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(error);
                }
            });

            ws.on('close', () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(new Error('WebSocket connection closed'));
                }
            });
        });
    }

    /**
     * 使用WebSocket API获取区域列表
     * @param {string} access_token - 访问令牌
     * @param {string} base_url - 基础URL
     * @returns {Promise<Object>} 区域列表
     */
    async getRoomsViaWebSocket(access_token, base_url) {
        return new Promise((resolve, reject) => {
            const wsUrl = base_url.replace('http://', 'ws://').replace('https://', 'wss://') + '/api/websocket';
            const ws = new WebSocket(wsUrl);
            let messageId = 1;
            let resolved = false;

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    ws.close();
                    reject(new Error('WebSocket request timeout'));
                }
            }, 10000);

            ws.on('open', () => {
                // 发送认证消息
                ws.send(JSON.stringify({
                    type: 'auth',
                    access_token: access_token
                }));
            });

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    
                    if (msg.type === 'auth_ok') {
                        // 请求区域注册表
                        ws.send(JSON.stringify({
                            id: messageId++,
                            type: 'config/area_registry/list'
                        }));
                    } else if (msg.type === 'result' && msg.success) {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            ws.close();
                            
                            // 返回完整的房间信息，包括floor_id
                            const rooms = Array.isArray(msg.result) ? msg.result : [];
                            const processedRooms = rooms.map(room => {
                                // 确保room是对象且有必要的属性
                                if (typeof room === 'object' && room !== null) {
                                    return {
                                        area_id: room.area_id || room.id || null,
                                        name: room.name || room.friendly_name || 'Unknown Room',
                                        floor_id: room.floor_id || null,
                                        icon: room.icon || null,
                                        aliases: room.aliases || []
                                    };
                                }
                                return {
                                    area_id: null,
                                    name: 'Unknown Room',
                                    floor_id: null,
                                    icon: null,
                                    aliases: []
                                };
                            }).filter(room => room.name && room.name !== 'Unknown Room');
                            
                            resolve({
                                success: true,
                                data: {
                                    rooms: processedRooms,
                                    count: processedRooms.length,
                                    retrieved_at: new Date().toISOString()
                                }
                            });
                        }
                    } else if (msg.type === 'result' && !msg.success) {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            ws.close();
                            reject(new Error(msg.error?.message || 'WebSocket request failed'));
                        }
                    }
                } catch (error) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        ws.close();
                        reject(error);
                    }
                }
            });

            ws.on('error', (error) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(error);
                }
            });

            ws.on('close', () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(new Error('WebSocket connection closed'));
                }
            });
        });
    }

    /**
     * 高级设备查询 - 支持按楼层、房间、设备类型筛选
     * @param {Object} filters - 筛选条件
     * @param {string} filters.floor_id - 楼层ID
     * @param {string} filters.area_id - 房间/区域ID
     * @param {string} filters.device_type - 设备类型
     * @param {string} filters.manufacturer - 制造商
     * @param {string} filters.model - 型号
     * @param {boolean} filters.enabled_only - 仅显示启用的设备
     * @param {Object} credentials - 凭据对象
     * @returns {Promise<Object>} 筛选后的设备列表
     */
    async searchDevices(filters = {}, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            // 首先获取所有设备
            const devicesResult = await this.getDevices(credentials);
            if (!devicesResult.success) {
                return devicesResult;
            }

            let devices = devicesResult.data.devices || [];

            // 应用筛选条件
            if (filters.floor_id) {
                // 需要获取房间信息来匹配楼层
                const roomsResult = await this.getRooms(credentials);
                if (roomsResult.success) {
                    const rooms = roomsResult.data.rooms || [];
                    const floorRooms = rooms.filter(room => room.floor_id === filters.floor_id);
                    const floorRoomIds = floorRooms.map(room => room.area_id);
                    devices = devices.filter(device => floorRoomIds.includes(device.area_id));
                }
            }

            if (filters.area_id) {
                devices = devices.filter(device => device.area_id === filters.area_id);
            }

            if (filters.device_type) {
                devices = devices.filter(device => {
                    const deviceType = this.getDeviceType(device);
                    return deviceType && deviceType.toLowerCase().includes(filters.device_type.toLowerCase());
                });
            }

            if (filters.manufacturer) {
                devices = devices.filter(device => 
                    device.manufacturer && 
                    device.manufacturer.toLowerCase().includes(filters.manufacturer.toLowerCase())
                );
            }

            if (filters.model) {
                devices = devices.filter(device => 
                    device.model && 
                    device.model.toLowerCase().includes(filters.model.toLowerCase())
                );
            }

            if (filters.enabled_only) {
                devices = devices.filter(device => !device.disabled_by);
            }

            return {
                success: true,
                data: {
                    devices: devices,
                    count: devices.length,
                    filters: filters,
                    retrieved_at: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取设备类型（基于设备信息推断）
     * @param {Object} device - 设备对象
     * @returns {string} 设备类型
     */
    getDeviceType(device) {
        if (!device.identifiers || !Array.isArray(device.identifiers)) {
            return 'unknown';
        }

        // 基于identifiers推断设备类型
        for (const identifier of device.identifiers) {
            if (Array.isArray(identifier) && identifier.length > 0) {
                const domain = identifier[0];
                switch (domain) {
                    case 'homekit':
                        return 'homekit';
                    case 'hacs':
                        return 'integration';
                    case 'mqtt':
                        return 'mqtt_device';
                    case 'mobile_app':
                        return 'mobile_device';
                    case 'backup':
                        return 'backup_system';
                    case 'sun':
                        return 'sensor';
                    case 'met':
                        return 'weather_sensor';
                    default:
                        return domain;
                }
            }
        }

        return 'unknown';
    }

    /**
     * 获取设备列表
     */
    async getDevices(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            // 首先尝试WebSocket API
            let rawDevices = [];
            try {
                const result = await this.getDevicesViaWebSocket(access_token, base_url);
                if (result.success && Array.isArray(result.data.devices)) {
                    rawDevices = result.data.devices;
                }
            } catch (wsError) {
                console.log('WebSocket API failed, trying REST API:', wsError.message);
            }

            // 如果WebSocket失败，尝试REST API端点
            if (rawDevices.length === 0) {
                let result = await this.callHomeAssistantAPI(access_token, base_url, '/api/config/device_registry/list');
                
                if (result.error) {
                    result = await this.callHomeAssistantAPI(access_token, base_url, '/api/config/device_registry');
                }
                
                if (result.error) {
                    result = await this.callHomeAssistantAPI(access_token, base_url, '/api/devices');
                }
                
                if (!result.error && Array.isArray(result)) {
                    rawDevices = result;
                }
            }

            // 过滤和优化设备列表
            const filteredDevices = this.filterAndOptimizeDevices(rawDevices);
            
            return {
                success: true,
                data: {
                    devices: filteredDevices,
                    count: filteredDevices.length,
                    total_raw: rawDevices.length,
                    filtered_out: rawDevices.length - filteredDevices.length,
                    retrieved_at: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 过滤和优化设备列表
     */
    filterAndOptimizeDevices(rawDevices) {
        if (!Array.isArray(rawDevices)) {
            return [];
        }

        return rawDevices
            .filter(device => {
                // 过滤掉无用的设备
                if (!device || typeof device !== 'object') return false;
                
                // 过滤掉虚拟设备和服务
                const virtualDomains = ['sun', 'moon', 'person', 'zone', 'timer', 'counter', 'input_boolean', 'input_text', 'input_number', 'input_select', 'input_datetime', 'schedule', 'scene', 'script', 'automation', 'group', 'zone', 'weather', 'calendar', 'timer', 'counter', 'input_boolean', 'input_text', 'input_number', 'input_select', 'input_datetime', 'schedule', 'scene', 'script', 'automation', 'group', 'zone', 'weather', 'calendar'];
                
                // 过滤掉HACS集成和服务
                const serviceDomains = ['hacs', 'backup', 'met', 'config_editor'];
                
                if (device.identifiers && Array.isArray(device.identifiers)) {
                    for (const identifier of device.identifiers) {
                        if (Array.isArray(identifier) && identifier.length > 0) {
                            const domain = identifier[0];
                            if (virtualDomains.includes(domain) || serviceDomains.includes(domain)) {
                                return false;
                            }
                        }
                    }
                }
                
                // 过滤掉服务类型的设备，但保留HomeKit设备
                if (device.entry_type === 'service') {
                    // 检查是否是HomeKit设备
                    const isHomeKit = device.identifiers && device.identifiers.some(id => 
                        Array.isArray(id) && id.length > 0 && id[0] === 'homekit'
                    );
                    if (!isHomeKit) {
                        return false;
                    }
                }
                
                // 过滤掉没有名称且没有实体的设备
                if (!device.name && (!device.identifiers || device.identifiers.length === 0)) {
                    return false;
                }
                
                // 过滤掉被禁用的设备
                if (device.disabled_by) {
                    return false;
                }
                
                // 过滤掉集成设备（HACS等）
                if (device.manufacturer && device.model === 'integration') {
                    return false;
                }
                
                // 过滤掉插件设备
                if (device.model === 'plugin') {
                    return false;
                }
                
                // 只保留真正的物理设备，但允许未知类型的设备（如WiZ等）
                const physicalDeviceTypes = ['homekit', 'mqtt_device', 'mobile_device', 'zigbee', 'z-wave', 'bluetooth', 'wifi', 'ethernet', 'unknown'];
                const deviceType = this.getDeviceType(device);
                
                // 如果设备有制造商信息，即使类型未知也保留
                if (device.manufacturer && device.manufacturer !== 'Unknown') {
                    return true;
                }
                
                // 如果设备有名称，即使类型未知也保留
                if (device.name || device.name_by_user) {
                    return true;
                }
                
                // 其他情况按类型过滤
                if (!physicalDeviceTypes.includes(deviceType)) {
                    return false;
                }
                
                return true;
            })
            .map(device => {
                // 优化设备信息，只保留有用的字段
                return {
                    device_id: device.id,
                    device_name: device.name_by_user || device.name || this.generateDeviceName(device),
                    name_by_user: device.name_by_user || null,
                    manufacturer: device.manufacturer || 'Unknown',
                    model: device.model || 'Unknown',
                    area_id: device.area_id || null,
                    area_name: device.area_id || null, // 稍后会通过房间信息填充
                    device_type: this.getDeviceType(device),
                    sw_version: device.sw_version || null,
                    hw_version: device.hw_version || null,
                    entry_type: device.entry_type || null,
                    identifiers: device.identifiers || [],
                    connections: device.connections || [],
                    created_at: device.created_at ? new Date(device.created_at * 1000).toISOString() : null,
                    modified_at: device.modified_at ? new Date(device.modified_at * 1000).toISOString() : null,
                    configuration_url: device.configuration_url || null,
                    disabled_by: device.disabled_by || null
                };
            })
            .sort((a, b) => {
                // 按名称排序
                const nameA = a.name || '';
                const nameB = b.name || '';
                return nameA.localeCompare(nameB);
            });
    }

    /**
     * 生成设备名称（当设备没有名称时）
     */
    generateDeviceName(device) {
        if (device.name) return device.name;
        
        // 基于制造商和型号生成名称
        if (device.manufacturer && device.model) {
            return `${device.manufacturer} ${device.model}`;
        }
        
        if (device.manufacturer) {
            return `${device.manufacturer} Device`;
        }
        
        // 基于设备类型生成名称
        const deviceType = this.getDeviceType(device);
        if (deviceType !== 'unknown') {
            return `${deviceType.charAt(0).toUpperCase() + deviceType.slice(1)} Device`;
        }
        
        return 'Unknown Device';
    }

    /**
     * 获取楼层列表
     */
    async getFloors(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            // 首先尝试WebSocket API
            try {
                const result = await this.getFloorsViaWebSocket(access_token, base_url);
                return result;
            } catch (wsError) {
                console.log('WebSocket API failed, trying REST API:', wsError.message);
            }

            // 如果WebSocket失败，尝试REST API端点
            let result = await this.callHomeAssistantAPI(access_token, base_url, '/api/config/floor_registry/list');
            
            // 如果失败，尝试其他可能的端点
            if (result.error) {
                result = await this.callHomeAssistantAPI(access_token, base_url, '/api/config/floor_registry');
            }
            
            // 如果还是失败，尝试简化的端点
            if (result.error) {
                result = await this.callHomeAssistantAPI(access_token, base_url, '/api/floors');
            }

            if (result.error) {
                return { success: false, error: result.error };
            }

            return {
                success: true,
                data: {
                    floors: result.data || result,
                    count: Array.isArray(result.data || result) ? (result.data || result).length : 0,
                    retrieved_at: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取实体注册表列表
     */
    async getEntityRegistry(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            // 首先尝试WebSocket API
            try {
                const result = await this.getEntityRegistryViaWebSocket(access_token, base_url);
                return result;
            } catch (wsError) {
                console.log('WebSocket API failed, trying REST API:', wsError.message);
            }

            // 如果WebSocket失败，尝试REST API端点
            let result = await this.callHomeAssistantAPI(access_token, base_url, '/api/config/entity_registry/list');
            
            // 如果失败，尝试其他可能的端点
            if (result.error) {
                result = await this.callHomeAssistantAPI(access_token, base_url, '/api/config/entity_registry');
            }
            
            // 如果还是失败，尝试简化的端点
            if (result.error) {
                result = await this.callHomeAssistantAPI(access_token, base_url, '/api/entities');
            }

            if (result.error) {
                return { success: false, error: result.error };
            }

            return {
                success: true,
                data: {
                    entities: result.data || result,
                    count: Array.isArray(result.data || result) ? (result.data || result).length : 0,
                    retrieved_at: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取房间列表（简化版，只返回房间名称）
     */
    async getRooms(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            // 首先尝试WebSocket API
            try {
                const result = await this.getRoomsViaWebSocket(access_token, base_url);
                return result;
            } catch (wsError) {
                console.log('WebSocket API failed, trying REST API:', wsError.message);
            }

            // 如果WebSocket失败，尝试REST API端点
            let result = await this.callHomeAssistantAPI(access_token, base_url, '/api/config/area_registry/list');
            
            // 如果失败，尝试其他可能的端点
            if (result.error) {
                result = await this.callHomeAssistantAPI(access_token, base_url, '/api/config/area_registry');
            }
            
            // 如果还是失败，尝试简化的端点
            if (result.error) {
                result = await this.callHomeAssistantAPI(access_token, base_url, '/api/areas');
            }
            
            // 如果还是失败，尝试使用states端点来获取区域信息
            if (result.error) {
                const statesResult = await this.callHomeAssistantAPI(access_token, base_url, '/api/states');
                if (!statesResult.error && Array.isArray(statesResult)) {
                    // 从实体状态中提取区域信息
                    const areas = new Map();
                    statesResult.forEach(state => {
                        if (state.attributes && state.attributes.area_id) {
                            const areaId = state.attributes.area_id;
                            if (!areas.has(areaId)) {
                                areas.set(areaId, {
                                    area_id: areaId,
                                    name: state.attributes.area_name || state.attributes.friendly_name || 'Unknown Area',
                                    entities: []
                                });
                            }
                            areas.get(areaId).entities.push(state.entity_id);
                        }
                    });
                    result = Array.from(areas.values());
                }
            }

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            // 返回完整的房间信息，包括floor_id
            const rooms = Array.isArray(result) ? result : [];
            const processedRooms = rooms.map(room => {
                // 确保room是对象且有必要的属性
                if (typeof room === 'object' && room !== null) {
                    return {
                        area_id: room.area_id || room.id || null,
                        name: room.name || room.friendly_name || 'Unknown Room',
                        floor_id: room.floor_id || null,
                        icon: room.icon || null,
                        aliases: room.aliases || []
                    };
                }
                return {
                    area_id: null,
                    name: 'Unknown Room',
                    floor_id: null,
                    icon: null,
                    aliases: []
                };
            }).filter(room => room.name && room.name !== 'Unknown Room');

            return {
                success: true,
                data: {
                    rooms: processedRooms,
                    count: processedRooms.length,
                    retrieved_at: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 根据房间名称、设备名称和设备类型匹配实体
     */
    async matchEntitiesByRoomAndDevice(intentData, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            // 获取所有设备、区域和实体数据
            const [devicesResult, areasResult, entitiesResult] = await Promise.all([
                this.getDevices(credentials),
                this.getRooms(credentials),
                this.getEntityRegistry(credentials)
            ]);

            if (!devicesResult.success || !areasResult.success || !entitiesResult.success) {
                return { 
                    success: false, 
                    error: 'Failed to fetch Home Assistant data',
                    details: {
                        devices: devicesResult.success,
                        areas: areasResult.success,
                        entities: entitiesResult.success
                    }
                };
            }

            const devices = devicesResult.data.devices || [];
            const areas = areasResult.data.rooms || []; // 注意：这里rooms是简化的房间名称数组
            const entities = entitiesResult.data.entities || [];

            // 创建房间名称到区域ID的映射
            const roomNameToAreaId = new Map();
            // 由于areas现在是简化的房间名称数组，我们需要从设备数据中获取房间映射
            devices.forEach(device => {
                if (device.area_id && device.area_name) {
                    roomNameToAreaId.set(device.area_name, device.area_id);
                }
            });

            // 添加从简化房间名称到区域ID的映射
            areas.forEach(roomName => {
                // 查找匹配的区域ID
                for (const [areaName, areaId] of roomNameToAreaId.entries()) {
                    if (this.normalizeRoomName(roomName) === this.normalizeRoomName(areaName)) {
                        roomNameToAreaId.set(roomName, areaId);
                        break;
                    }
                }
            });

            // 处理每个设备，匹配实体
            const processedDevices = intentData.devices.map(deviceInfo => {
                const matchedEntities = [];
                
                // 查找匹配的房间
                const roomName = deviceInfo.room_name;
                const deviceType = deviceInfo.device_type;
                const deviceName = deviceInfo.device_name;

                // 通过房间名称找到区域ID
                let areaId = null;
                const normalizedRoomName = this.normalizeRoomName(roomName);
                
                for (const [areaName, id] of roomNameToAreaId.entries()) {
                    const normalizedAreaName = this.normalizeRoomName(areaName);
                    if (normalizedRoomName === normalizedAreaName || 
                        normalizedAreaName.includes(normalizedRoomName) ||
                        normalizedRoomName.includes(normalizedAreaName)) {
                        areaId = id;
                        break;
                    }
                }

                if (areaId) {
                    // 查找该区域下的设备
                    const areaDevices = devices.filter(device => device.area_id === areaId);
                    
                    // 根据设备名称和类型匹配设备 - 优先名称匹配，其次类型匹配
                    let matchedDevices = [];
                    
                    // 1. 首先尝试根据设备名称匹配
                    if (deviceName) {
                        matchedDevices = areaDevices.filter(device => {
                            const deviceNameMatch = (device.name && device.name.toLowerCase().includes(deviceName.toLowerCase())) ||
                                                  (device.name_by_user && device.name_by_user.toLowerCase().includes(deviceName.toLowerCase()));
                            return deviceNameMatch;
                        });
                    }
                    
                    // 2. 如果没有找到名称匹配的设备，则使用设备类型匹配
                    if (matchedDevices.length === 0) {
                        matchedDevices = areaDevices.filter(device => {
                            // 改进设备类型匹配逻辑
                            if (deviceType === 'light') {
                                // 对于light类型，匹配mqtt_device或包含light的设备类型
                                return device.device_type === 'light' || 
                                       device.device_type === 'mqtt_device' ||
                                       (device.device_type && device.device_type.toLowerCase().includes('light'));
                            } else if (deviceType === 'climate') {
                                // 对于climate类型，匹配climate或包含climate的设备类型
                                return device.device_type === 'climate' || 
                                       (device.device_type && device.device_type.toLowerCase().includes('climate'));
                            } else {
                                // 其他类型使用原来的匹配逻辑
                                return device.device_type === deviceType || 
                                       (device.device_type && device.device_type.toLowerCase().includes(deviceType.toLowerCase()));
                            }
                        });
                    }

                    // 为每个匹配的设备查找相关实体
                    const processedEntityIds = new Set(); // 避免重复添加实体
                    
                    matchedDevices.forEach(device => {
                        const deviceEntities = entities.filter(entity => {
                            const entityDomain = entity.entity_id.split('.')[0];
                            
                            // 只匹配正确类型的实体
                            if (entityDomain !== deviceType) {
                                return false;
                            }
                            
                            // 优先通过设备ID匹配
                            if (entity.device_id === device.id) {
                                return true;
                            }
                            
                            return false;
                        });

                        deviceEntities.forEach(entity => {
                            // 避免重复添加相同的实体
                            if (!processedEntityIds.has(entity.entity_id)) {
                                processedEntityIds.add(entity.entity_id);
                                const entityDomain = entity.entity_id.split('.')[0];
                                matchedEntities.push({
                                    entity_id: entity.entity_id,
                                    name: entity.name || entity.original_name,
                                    domain: entityDomain,
                                    device_class: entity.device_class,
                                    capabilities: this.getEntityCapabilities(entity),
                                    state: entity.state || 'unknown',
                                    attributes: entity.attributes || {}
                                });
                            }
                        });
                    });

                    // 只有在真的没有找到任何实体时，才尝试fallback逻辑
                    if (matchedEntities.length === 0 && matchedDevices.length === 0) {
                        const areaEntities = entities.filter(entity => {
                            const entityDomain = entity.entity_id.split('.')[0];
                            // 只匹配正确类型的实体，并且在该区域内
                            return entityDomain === deviceType && entity.area_id === areaId;
                        });
                        
                        // 限制每个房间最多返回3个实体，避免返回太多
                        const limitedEntities = areaEntities.slice(0, 3);
                        
                        limitedEntities.forEach(entity => {
                            const entityDomain = entity.entity_id.split('.')[0];
                            matchedEntities.push({
                                entity_id: entity.entity_id,
                                name: entity.name || entity.original_name,
                                domain: entityDomain,
                                device_class: entity.device_class,
                                capabilities: this.getEntityCapabilities(entity),
                                state: entity.state || 'unknown',
                                attributes: entity.attributes || {}
                            });
                        });
                    }
                }

                return {
                    ...deviceInfo,
                    entities: matchedEntities,
                    matched_count: matchedEntities.length
                };
            });

            return {
                success: true,
                data: {
                    intent: intentData.intent,
                    confidence: intentData.confidence,
                    user_input: intentData.user_input,
                    matched_rooms: intentData.matched_rooms,
                    device_types: intentData.device_types,
                    devices: processedDevices,
                    total_entities: processedDevices.reduce((sum, device) => sum + device.matched_count, 0),
                    retrieved_at: new Date().toISOString()
                }
            };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 标准化房间名称用于匹配
     */
    normalizeRoomName(roomName) {
        if (!roomName) return '';
        return roomName.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, '_');
    }

    /**
     * 获取实体功能列表
     */
    getEntityCapabilities(entity) {
        const capabilities = [];
        const domain = entity.platform;
        const deviceClass = entity.device_class;

        // 根据域和设备类推断功能
        switch (domain) {
            case 'light':
                capabilities.push('turn_on', 'turn_off');
                if (entity.attributes && entity.attributes.brightness !== undefined) {
                    capabilities.push('set_brightness');
                }
                if (entity.attributes && entity.attributes.color_temp !== undefined) {
                    capabilities.push('set_color_temp');
                }
                if (entity.attributes && entity.attributes.rgb_color !== undefined) {
                    capabilities.push('set_color');
                }
                break;
            case 'climate':
                capabilities.push('turn_on', 'turn_off');
                capabilities.push('set_temperature');
                if (entity.attributes && entity.attributes.hvac_modes) {
                    capabilities.push('set_hvac_mode');
                }
                if (entity.attributes && entity.attributes.fan_modes) {
                    capabilities.push('set_fan_mode');
                }
                break;
            case 'switch':
                capabilities.push('turn_on', 'turn_off');
                break;
            case 'fan':
                capabilities.push('turn_on', 'turn_off');
                if (entity.attributes && entity.attributes.speed !== undefined) {
                    capabilities.push('set_speed');
                }
                break;
            case 'cover':
                capabilities.push('open_cover', 'close_cover', 'stop_cover');
                break;
            case 'media_player':
                capabilities.push('turn_on', 'turn_off');
                capabilities.push('play_media', 'pause', 'stop');
                break;
            default:
                capabilities.push('turn_on', 'turn_off');
        }

        return capabilities;
    }

    /**
     * 获取当前配置的access_token
     */
    async getAccessToken(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            // 返回完整的access_token信息
            return {
                success: true,
                data: {
                    access_token: access_token,
                    base_url: base_url,
                    token_length: access_token.length,
                    has_credentials: true,
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
                        version: validationResult.data.config?.version,
                        location: validationResult.data.config?.location_name,
                        entities_count: validationResult.data.entities_count,
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
     * 智能设备匹配 - 根据OpenAI返回的结构化数据匹配Home Assistant设备
     */
    async matchDevicesByIntent(intentData, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            if (!intentData || !intentData.devices || !Array.isArray(intentData.devices)) {
                return { success: false, error: 'Invalid intent data: devices array is required' };
            }

            // 获取所有设备和区域数据
            const [devicesResult, areasResult, entitiesResult] = await Promise.all([
                this.getDevices(credentials),
                this.getRooms(credentials),
                this.getEntityRegistry(credentials)
            ]);

            if (!devicesResult.success || !areasResult.success || !entitiesResult.success) {
                return { 
                    success: false, 
                    error: 'Failed to fetch Home Assistant data',
                    details: {
                        devices: devicesResult.success,
                        areas: areasResult.success,
                        entities: entitiesResult.success
                    }
                };
            }

            const devices = devicesResult.data.devices || [];
            const areas = areasResult.data.areas || [];
            const entities = entitiesResult.data.entities || [];

            // 构建匹配结果
            const matchedDevices = [];

            for (const intentDevice of intentData.devices) {
                const matched = await this.matchSingleDevice(intentDevice, devices, areas, entities);
                if (matched.length > 0) {
                    matchedDevices.push(...matched);
                }
            }

            return {
                success: true,
                data: {
                    matched_devices: matchedDevices,
                    total_matched: matchedDevices.length,
                    intent_devices: intentData.devices.length,
                    match_rate: intentData.devices.length > 0 ? 
                        (matchedDevices.length / intentData.devices.length * 100).toFixed(1) + '%' : '0%',
                    matched_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('Failed to match devices by intent:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 匹配单个设备
     */
    async matchSingleDevice(intentDevice, devices, areas, entities) {
        const { space_name, space_type, device_name, device_type, action } = intentDevice;
        const matched = [];

        // 1. 首先匹配空间（area）
        let matchedArea = null;
        
        // 精确匹配空间名称
        matchedArea = areas.find(area => 
            area.name && area.name.toLowerCase().includes(space_name.toLowerCase())
        );
        
        // 如果精确匹配失败，尝试类型匹配
        if (!matchedArea) {
            matchedArea = areas.find(area => 
                area.name && area.name.toLowerCase().includes(space_type.toLowerCase())
            );
        }

        if (!matchedArea) {
            this.logger.warn(`No area found for space: ${space_name} (${space_type})`);
            return matched;
        }

        // 2. 在该空间下查找设备
        const areaDevices = devices.filter(device => 
            device.area_id === matchedArea.area_id
        );

        // 3. 匹配设备
        let matchedDevice = null;
        
        // 精确匹配设备名称
        matchedDevice = areaDevices.find(device => 
            device.name && device.name.toLowerCase().includes(device_name.toLowerCase())
        );
        
        // 如果精确匹配失败，尝试类型匹配
        if (!matchedDevice) {
            matchedDevice = areaDevices.find(device => 
                this.matchDeviceType(device, device_type)
            );
        }

        if (!matchedDevice) {
            this.logger.warn(`No device found for: ${device_name} (${device_type}) in area: ${matchedArea.name}`);
            return matched;
        }

        // 4. 查找该设备相关的实体
        const deviceEntities = entities.filter(entity => 
            entity.device_id === matchedDevice.id
        );

        // 5. 为每个实体构建结果
        for (const entity of deviceEntities) {
            const entityFunctions = this.getEntityFunctions(entity, action);
            
            matched.push({
                entity_id: entity.entity_id,
                entity_name: entity.name || entity.original_name || entity.entity_id,
                entity_functions: entityFunctions,
                device_name: matchedDevice.name || matchedDevice.name_by_user || 'Unknown Device',
                device_type: this.getDeviceTypeName(matchedDevice),
                space_name: matchedArea.name,
                space_type: matchedArea.name, // Home Assistant中area没有type字段
                action: action,
                confidence: this.calculateMatchConfidence(intentDevice, matchedDevice, matchedArea)
            });
        }

        return matched;
    }

    /**
     * 匹配设备类型
     */
    matchDeviceType(device, targetType) {
        if (!device || !targetType) return false;
        
        const deviceName = (device.name || '').toLowerCase();
        const deviceType = this.getDeviceTypeName(device).toLowerCase();
        const target = targetType.toLowerCase();

        // 类型映射
        const typeMappings = {
            'light': ['light', 'lamp', 'bulb', '灯', '照明'],
            'air_conditioner': ['air', 'conditioner', 'ac', '空调', '冷气'],
            'switch': ['switch', 'switch', '开关'],
            'fan': ['fan', '风扇', '风机'],
            'sensor': ['sensor', '传感器', '感应器'],
            'camera': ['camera', '摄像头', '监控'],
            'lock': ['lock', 'lock', '锁', '门锁'],
            'cover': ['cover', 'blind', 'curtain', '窗帘', '百叶窗']
        };

        // 检查直接匹配
        if (deviceName.includes(target) || deviceType.includes(target)) {
            return true;
        }

        // 检查类型映射
        for (const [key, values] of Object.entries(typeMappings)) {
            if (values.some(v => v.includes(target))) {
                if (values.some(v => deviceName.includes(v) || deviceType.includes(v))) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * 获取设备类型名称
     */
    getDeviceTypeName(device) {
        if (!device) return 'Unknown';
        
        // 从设备信息中推断类型
        const name = (device.name || '').toLowerCase();
        const model = (device.model || '').toLowerCase();
        const manufacturer = (device.manufacturer || '').toLowerCase();

        if (name.includes('light') || name.includes('灯') || name.includes('照明')) {
            return 'Light';
        }
        if (name.includes('air') || name.includes('conditioner') || name.includes('空调')) {
            return 'Air Conditioner';
        }
        if (name.includes('switch') || name.includes('开关')) {
            return 'Switch';
        }
        if (name.includes('fan') || name.includes('风扇')) {
            return 'Fan';
        }
        if (name.includes('camera') || name.includes('摄像头')) {
            return 'Camera';
        }
        if (name.includes('lock') || name.includes('锁')) {
            return 'Lock';
        }
        if (name.includes('cover') || name.includes('窗帘')) {
            return 'Cover';
        }

        return 'Unknown';
    }

    /**
     * 获取实体功能
     */
    getEntityFunctions(entity, action) {
        const functions = [];
        const domain = entity.entity_id.split('.')[0];

        // 根据实体域和动作确定功能
        switch (domain) {
            case 'light':
                functions.push('turn_on', 'turn_off');
                if (action.includes('调') || action.includes('度') || action.includes('brightness')) {
                    functions.push('set_brightness');
                }
                if (action.includes('色') || action.includes('color')) {
                    functions.push('set_color');
                }
                break;
            case 'climate':
                functions.push('turn_on', 'turn_off', 'set_temperature');
                if (action.includes('调') || action.includes('度')) {
                    functions.push('set_temperature');
                }
                break;
            case 'switch':
                functions.push('turn_on', 'turn_off');
                break;
            case 'fan':
                functions.push('turn_on', 'turn_off', 'set_speed');
                break;
            case 'cover':
                functions.push('open_cover', 'close_cover', 'stop_cover');
                break;
            case 'lock':
                functions.push('lock', 'unlock');
                break;
            case 'camera':
                functions.push('turn_on', 'turn_off', 'snapshot');
                break;
            default:
                functions.push('turn_on', 'turn_off');
        }

        return functions;
    }

    /**
     * 计算匹配置信度
     */
    calculateMatchConfidence(intentDevice, matchedDevice, matchedArea) {
        let confidence = 0.5; // 基础置信度

        // 空间匹配加分
        if (matchedArea) {
            confidence += 0.2;
        }

        // 设备名称匹配加分
        if (matchedDevice.name && matchedDevice.name.toLowerCase().includes(intentDevice.device_name.toLowerCase())) {
            confidence += 0.3;
        }

        // 设备类型匹配加分
        if (this.matchDeviceType(matchedDevice, intentDevice.device_type)) {
            confidence += 0.2;
        }

        return Math.min(confidence, 1.0);
    }

    /**
     * 批量控制设备 - 根据OpenAI返回的命令执行设备控制
     */
    async batchControlDevices(controlCommands, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            if (!controlCommands || !Array.isArray(controlCommands)) {
                return { success: false, error: 'Invalid control commands: array is required' };
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            this.logger.info(`Starting batch control for ${controlCommands.length} devices`);

            // 并行执行所有控制命令
            const controlPromises = controlCommands.map(async (command, index) => {
                try {
                    const result = await this.executeControlCommand(command, access_token, base_url);
                    return {
                        index,
                        entity_id: command.entity_id,
                        success: true,
                        result: result
                    };
                } catch (error) {
                    this.logger.error(`Failed to control device ${command.entity_id}:`, error);
                    return {
                        index,
                        entity_id: command.entity_id,
                        success: false,
                        error: error.message
                    };
                }
            });

            const results = await Promise.all(controlPromises);

            // 统计结果
            const successful = results.filter(r => r.success);
            const failed = results.filter(r => !r.success);

            // 获取所有实体的当前状态
            const entityStates = await this.getEntityStates(access_token, base_url, controlCommands.map(c => c.entity_id));

            return {
                success: true,
                data: {
                    total_commands: controlCommands.length,
                    successful_commands: successful.length,
                    failed_commands: failed.length,
                    success_rate: controlCommands.length > 0 ? 
                        (successful.length / controlCommands.length * 100).toFixed(1) + '%' : '0%',
                    results: results,
                    entity_states: entityStates,
                    executed_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('Failed to batch control devices:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 执行单个控制命令
     */
    async executeControlCommand(command, accessToken, baseUrl) {
        const { entity_id, entity_functions, action, parameters = {} } = command;

        if (!entity_id || !entity_functions || !action) {
            throw new Error('Missing required fields: entity_id, entity_functions, action');
        }

        // 根据action和entity_functions确定要调用的服务
        const serviceCall = this.determineServiceCall(entity_id, entity_functions, action, parameters);

        if (!serviceCall) {
            throw new Error(`No suitable service found for action: ${action} on entity: ${entity_id}`);
        }

        // 调用Home Assistant服务
        const result = await this.callHomeAssistantAPI(
            accessToken,
            baseUrl,
            '/api/services/' + serviceCall.domain + '/' + serviceCall.service,
            'POST',
            serviceCall.data
        );

        if (result.error) {
            throw new Error(`Service call failed: ${result.error}`);
        }

        return {
            service_called: `${serviceCall.domain}.${serviceCall.service}`,
            service_data: serviceCall.data,
            result: result
        };
    }

    /**
     * 确定要调用的服务
     */
    determineServiceCall(entityId, entityFunctions, action, parameters) {
        const domain = entityId.split('.')[0];
        const actionLower = action.toLowerCase();

        // 根据动作和实体功能确定服务调用
        if (actionLower.includes('开') || actionLower.includes('on') || actionLower.includes('turn_on')) {
            if (entityFunctions.includes('turn_on')) {
                return {
                    domain: domain,
                    service: 'turn_on',
                    data: {
                        entity_id: entityId,
                        ...parameters
                    }
                };
            }
        }

        if (actionLower.includes('关') || actionLower.includes('off') || actionLower.includes('turn_off')) {
            if (entityFunctions.includes('turn_off')) {
                return {
                    domain: domain,
                    service: 'turn_off',
                    data: {
                        entity_id: entityId,
                        ...parameters
                    }
                };
            }
        }

        // 温度控制
        if (actionLower.includes('调') || actionLower.includes('度') || actionLower.includes('temperature')) {
            if (entityFunctions.includes('set_temperature')) {
                const temperature = this.extractTemperature(action, parameters);
                return {
                    domain: domain,
                    service: 'set_temperature',
                    data: {
                        entity_id: entityId,
                        temperature: temperature,
                        ...parameters
                    }
                };
            }
        }

        // 亮度控制
        if (actionLower.includes('亮度') || actionLower.includes('brightness')) {
            if (entityFunctions.includes('set_brightness')) {
                const brightness = this.extractBrightness(action, parameters);
                return {
                    domain: domain,
                    service: 'turn_on',
                    data: {
                        entity_id: entityId,
                        brightness_pct: brightness,
                        ...parameters
                    }
                };
            }
        }

        // 颜色控制
        if (actionLower.includes('色') || actionLower.includes('color')) {
            if (entityFunctions.includes('set_color')) {
                const color = this.extractColor(action, parameters);
                return {
                    domain: domain,
                    service: 'turn_on',
                    data: {
                        entity_id: entityId,
                        rgb_color: color,
                        ...parameters
                    }
                };
            }
        }

        // 风扇速度控制
        if (actionLower.includes('速度') || actionLower.includes('speed')) {
            if (entityFunctions.includes('set_speed')) {
                const speed = this.extractSpeed(action, parameters);
                return {
                    domain: domain,
                    service: 'set_speed',
                    data: {
                        entity_id: entityId,
                        speed: speed,
                        ...parameters
                    }
                };
            }
        }

        // 窗帘控制
        if (actionLower.includes('开') && (actionLower.includes('窗帘') || actionLower.includes('cover'))) {
            if (entityFunctions.includes('open_cover')) {
                return {
                    domain: domain,
                    service: 'open_cover',
                    data: {
                        entity_id: entityId,
                        ...parameters
                    }
                };
            }
        }

        if (actionLower.includes('关') && (actionLower.includes('窗帘') || actionLower.includes('cover'))) {
            if (entityFunctions.includes('close_cover')) {
                return {
                    domain: domain,
                    service: 'close_cover',
                    data: {
                        entity_id: entityId,
                        ...parameters
                    }
                };
            }
        }

        // 锁控制
        if (actionLower.includes('锁') || actionLower.includes('lock')) {
            if (actionLower.includes('开') || actionLower.includes('unlock')) {
                if (entityFunctions.includes('unlock')) {
                    return {
                        domain: domain,
                        service: 'unlock',
                        data: {
                            entity_id: entityId,
                            ...parameters
                        }
                    };
                }
            }
            if (actionLower.includes('关') || actionLower.includes('lock')) {
                if (entityFunctions.includes('lock')) {
                    return {
                        domain: domain,
                        service: 'lock',
                        data: {
                            entity_id: entityId,
                            ...parameters
                        }
                    };
                }
            }
        }

        // 默认开关控制
        if (entityFunctions.includes('turn_on') && (actionLower.includes('开') || actionLower.includes('on'))) {
            return {
                domain: domain,
                service: 'turn_on',
                data: {
                    entity_id: entityId,
                    ...parameters
                }
            };
        }

        if (entityFunctions.includes('turn_off') && (actionLower.includes('关') || actionLower.includes('off'))) {
            return {
                domain: domain,
                service: 'turn_off',
                data: {
                    entity_id: entityId,
                    ...parameters
                }
            };
        }

        return null;
    }

    /**
     * 提取温度值
     */
    extractTemperature(action, parameters) {
        // 从参数中获取温度
        if (parameters.temperature) {
            return parseFloat(parameters.temperature);
        }

        // 从动作中提取温度
        const tempMatch = action.match(/(\d+(?:\.\d+)?)度/);
        if (tempMatch) {
            return parseFloat(tempMatch[1]);
        }

        // 默认温度
        return 22;
    }

    /**
     * 提取亮度值
     */
    extractBrightness(action, parameters) {
        if (parameters.brightness) {
            return parseInt(parameters.brightness);
        }

        const brightnessMatch = action.match(/(\d+)%/);
        if (brightnessMatch) {
            return parseInt(brightnessMatch[1]);
        }

        return 50;
    }

    /**
     * 提取颜色值
     */
    extractColor(action, parameters) {
        if (parameters.rgb_color) {
            return parameters.rgb_color;
        }

        // 简单的颜色映射
        const colorMap = {
            '红': [255, 0, 0],
            '绿': [0, 255, 0],
            '蓝': [0, 0, 255],
            '白': [255, 255, 255],
            '黄': [255, 255, 0],
            '紫': [255, 0, 255],
            '青': [0, 255, 255]
        };

        for (const [color, rgb] of Object.entries(colorMap)) {
            if (action.includes(color)) {
                return rgb;
            }
        }

        return [255, 255, 255]; // 默认白色
    }

    /**
     * 提取速度值
     */
    extractSpeed(action, parameters) {
        if (parameters.speed) {
            return parameters.speed;
        }

        const speedMap = {
            '低': 'low',
            '中': 'medium',
            '高': 'high',
            '最高': 'max'
        };

        for (const [speed, value] of Object.entries(speedMap)) {
            if (action.includes(speed)) {
                return value;
            }
        }

        return 'medium';
    }

    /**
     * 获取实体状态
     */
    async getEntityStates(accessToken, baseUrl, entityIds) {
        try {
            const states = [];
            
            for (const entityId of entityIds) {
                try {
                    const state = await this.callHomeAssistantAPI(
                        accessToken,
                        baseUrl,
                        `/api/states/${entityId}`,
                        'GET'
                    );
                    
                    if (state && !state.error) {
                        states.push({
                            entity_id: entityId,
                            state: state.state,
                            attributes: state.attributes,
                            last_changed: state.last_changed,
                            last_updated: state.last_updated
                        });
                    } else {
                        states.push({
                            entity_id: entityId,
                            error: state.error || 'Unknown error'
                        });
                    }
                } catch (error) {
                    states.push({
                        entity_id: entityId,
                        error: error.message
                    });
                }
            }

            return states;
        } catch (error) {
            this.logger.error('Failed to get entity states:', error);
            return [];
        }
    }

    /**
     * 获取默认配置
     */
    getDefaultConfig() {
        return {
            ...super.getDefaultConfig(),
            timeout: 10000,
            retries: 3,
            cacheTimeout: 120000, // 2分钟缓存
            features: {
                states: true,
                config: true,
                connectionTest: true,
                services: true
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
                    description: 'Home Assistant long-lived access token',
                    required: true,
                    sensitive: true,
                    minLength: 100,
                    maxLength: 300,
                    example: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...'
                },
                base_url: {
                    type: 'string',
                    title: 'Base URL',
                    description: 'Home Assistant base URL (with protocol)',
                    required: true,
                    sensitive: false,
                    minLength: 10,
                    maxLength: 200,
                    pattern: '^https?://[^\\s/$.?#].[^\\s]*$',
                    example: 'http://homeassistant.local:8123'
                }
            },
            required: ['access_token', 'base_url'],
            additionalProperties: false
        };
    }

    /**
     * 获取增强的实体状态信息
     * 结合entity registry、devices和rooms信息
     * @param {Object} credentials - 凭据信息
     * @param {Array} areaNames - 按区域名称筛选
     * @param {Array} deviceTypes - 按设备类型筛选
     */
    async getEnhancedStates(credentials = null, areaNames = null, deviceTypes = null) {
        // 优先尝试从缓存获取数据
        const cachedResult = this.getCachedEnhancedStates(areaNames, deviceTypes);
        if (cachedResult) {
            this.logger.info(`Returning cached enhanced states, age: ${cachedResult.data.cache_age}ms`);
            return cachedResult;
        }

        // 缓存无效，从API获取新数据
        this.logger.info('Cache invalid or expired, fetching fresh enhanced states data');
        return await this.getEnhancedStatesInternal(credentials, areaNames, deviceTypes);
    }

    // 保留原来的方法作为内部实现
    async getEnhancedStatesOriginal(credentials = null, areaNames = null, deviceTypes = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            this.logger.info('Fetching enhanced states with entity registry, devices, and rooms data');

            // 并行获取所有必要的数据
            const [statesResult, entitiesResult, devicesResult, roomsResult, floorsResult] = await Promise.all([
                this.getStates(credentials),
                this.getEntityRegistry(credentials),
                this.getDevices(credentials),
                this.getRooms(credentials),
                this.getFloors(credentials)
            ]);

            if (!statesResult.success) {
                return { success: false, error: 'Failed to fetch states: ' + statesResult.error };
            }

            if (!entitiesResult.success) {
                return { success: false, error: 'Failed to fetch entity registry: ' + entitiesResult.error };
            }

            if (!devicesResult.success) {
                return { success: false, error: 'Failed to fetch devices: ' + devicesResult.error };
            }

            if (!roomsResult.success) {
                return { success: false, error: 'Failed to fetch rooms: ' + roomsResult.error };
            }

            if (!floorsResult.success) {
                return { success: false, error: 'Failed to fetch floors: ' + floorsResult.error };
            }

            const states = statesResult.data.states || [];
            const entities = entitiesResult.data.entities || [];
            const devices = devicesResult.data.devices || [];
            const rooms = roomsResult.data.rooms || [];
            const floors = floorsResult.data.floors || [];

            // 创建查找映射以提高性能 - 添加内存安全处理
            this.logger.info(`[MEMORY] 开始创建查找映射 - entities: ${entities.length}, devices: ${devices.length}, rooms: ${rooms.length}, floors: ${floors.length}`);
            
            let entityMap = null;
            let deviceMap = null; 
            let roomMap = null;
            let floorMap = null;
            
            try {
                entityMap = new Map();
                entities.forEach(entity => {
                    entityMap.set(entity.entity_id, entity);
                });
                this.logger.info(`[MEMORY] entityMap 创建完成, 大小: ${entityMap.size}`);

                deviceMap = new Map();
                devices.forEach(device => {
                    deviceMap.set(device.id, device);
                });
                this.logger.info(`[MEMORY] deviceMap 创建完成, 大小: ${deviceMap.size}`);

                roomMap = new Map();
                rooms.forEach(room => {
                    roomMap.set(room.area_id, room);
                });
                this.logger.info(`[MEMORY] roomMap 创建完成, 大小: ${roomMap.size}`);

                floorMap = new Map();
                floors.forEach(floor => {
                    floorMap.set(floor.floor_id, floor);
                });
                this.logger.info(`[MEMORY] floorMap 创建完成, 大小: ${floorMap.size}`);
                
                // 内存使用检查
                const memUsage = process.memoryUsage();
                this.logger.info(`[MEMORY] 映射创建后内存使用: ${Math.round(memUsage.heapUsed/1024/1024)}MB`);
                
            } catch (error) {
                this.logger.error(`[MEMORY] 创建映射时发生错误: ${error.message}`);
                // 清理已创建的映射
                if (entityMap) { entityMap.clear(); entityMap = null; }
                if (deviceMap) { deviceMap.clear(); deviceMap = null; }
                if (roomMap) { roomMap.clear(); roomMap = null; }
                if (floorMap) { floorMap.clear(); floorMap = null; }
                throw error;
            }

            // 增强每个状态信息
            const enhancedStates = states.map(state => {
                const enhancedState = {
                    ...state,
                    device_id: null,
                    device_name: null,
                    device_manufacturer: null,
                    device_model: null,
                    area_id: null,
                    area_name: null,
                    floor_id: null,
                    floor_name: null,
                    device_type: null
                };

                // 获取device_type：优先使用device_class，其次使用entity_id前缀
                if (state.attributes && state.attributes.device_class) {
                    enhancedState.device_type = state.attributes.device_class;
                } else {
                    // 从entity_id中提取前缀作为device_type
                    const entityIdParts = state.entity_id.split('.');
                    if (entityIdParts.length > 0) {
                        enhancedState.device_type = entityIdParts[0];
                    }
                }

                // 从entity registry获取device_id和area_id
                const entityInfo = entityMap.get(state.entity_id);
                if (entityInfo) {
                    enhancedState.device_id = entityInfo.device_id;
                    enhancedState.area_id = entityInfo.area_id;

                    // 如果有device_id，从devices获取设备信息
                    if (entityInfo.device_id) {
                        const deviceInfo = deviceMap.get(entityInfo.device_id);
                        if (deviceInfo) {
                            enhancedState.device_name = deviceInfo.name_by_user || deviceInfo.name || null;
                            enhancedState.device_manufacturer = deviceInfo.manufacturer || null;
                            enhancedState.device_model = deviceInfo.model || null;
                            
                            // 如果实体没有area_id，但设备有area_id，则使用设备的area_id
                            if (!enhancedState.area_id && deviceInfo.area_id) {
                                enhancedState.area_id = deviceInfo.area_id;
                            }
                        }
                    }

                    // 如果有area_id，从rooms获取房间和楼层信息
                    if (enhancedState.area_id) {
                        const roomInfo = roomMap.get(enhancedState.area_id);
                        if (roomInfo) {
                            enhancedState.area_name = roomInfo.name || null;
                            enhancedState.floor_id = roomInfo.floor_id || null;
                            
                            // 从楼层映射中获取楼层名称
                            if (roomInfo.floor_id) {
                                const floorInfo = floorMap.get(roomInfo.floor_id);
                                enhancedState.floor_name = floorInfo ? floorInfo.name : null;
                            } else {
                                enhancedState.floor_name = null;
                            }
                        } else {
                            // 如果rooms中没有找到，但设备有area_name，则使用设备的area_name
                            if (entityInfo.device_id) {
                                const deviceInfo = deviceMap.get(entityInfo.device_id);
                                if (deviceInfo && deviceInfo.area_name) {
                                    enhancedState.area_name = deviceInfo.area_name;
                                }
                            }
                        }
                        
                        // 如果还没有楼层信息，尝试从房间的floor_id获取
                        if (!enhancedState.floor_id && roomInfo && roomInfo.floor_id) {
                            enhancedState.floor_id = roomInfo.floor_id;
                            const floorInfo = floorMap.get(roomInfo.floor_id);
                            if (floorInfo) {
                                enhancedState.floor_name = floorInfo.name || null;
                            }
                        }
                    }
                }

                return enhancedState;
            });

            // 应用筛选条件
            let filteredStates = enhancedStates;
            
            // 按区域名称筛选
            if (areaNames && Array.isArray(areaNames) && areaNames.length > 0) {
                const normalizedAreaNames = areaNames.map(name => name.toLowerCase().trim()).filter(name => name);
                if (normalizedAreaNames.length > 0) {
                    filteredStates = filteredStates.filter(state => {
                        if (!state.area_name) return false;
                        const normalizedAreaName = state.area_name.toLowerCase().trim();
                        return normalizedAreaNames.some(filterName => 
                            normalizedAreaName.includes(filterName) || 
                            filterName.includes(normalizedAreaName)
                        );
                    });
                }
            }
            
            // 按设备类型筛选
            if (deviceTypes && Array.isArray(deviceTypes) && deviceTypes.length > 0) {
                const normalizedDeviceTypes = deviceTypes.map(type => type.toLowerCase().trim()).filter(type => type);
                if (normalizedDeviceTypes.length > 0) {
                    filteredStates = filteredStates.filter(state => {
                        if (!state.device_type) return false;
                        const normalizedDeviceType = state.device_type.toLowerCase().trim();
                        return normalizedDeviceTypes.some(filterType => 
                            normalizedDeviceType.includes(filterType) || 
                            filterType.includes(normalizedDeviceType)
                        );
                    });
                }
            }

            // 统计信息
            const stats = {
                total_states: filteredStates.length,
                total_states_before_filter: enhancedStates.length,
                with_device_info: filteredStates.filter(s => s.device_id).length,
                with_room_info: filteredStates.filter(s => s.area_id).length,
                with_floor_info: filteredStates.filter(s => s.floor_id).length,
                with_device_type: filteredStates.filter(s => s.device_type).length,
                unique_devices: new Set(filteredStates.filter(s => s.device_id).map(s => s.device_id)).size,
                unique_rooms: new Set(filteredStates.filter(s => s.area_id).map(s => s.area_id)).size,
                unique_floors: new Set(filteredStates.filter(s => s.floor_id).map(s => s.floor_id)).size,
                unique_device_types: new Set(filteredStates.filter(s => s.device_type).map(s => s.device_type)).size,
                // 筛选条件
                filters_applied: {
                    area_names: areaNames || [],
                    device_types: deviceTypes || []
                },
                // 新增：数据完整性统计
                device_registry_count: devices.length,
                entity_registry_count: entities.length,
                rooms_count: rooms.length,
                floors_count: floors.length,
                missing_devices: new Set(filteredStates.filter(s => s.device_id && !deviceMap.has(s.device_id)).map(s => s.device_id)).size,
                missing_rooms: new Set(filteredStates.filter(s => s.area_id && !roomMap.has(s.area_id)).map(s => s.area_id)).size,
                missing_floors: new Set(filteredStates.filter(s => s.floor_id && !floorMap.has(s.floor_id)).map(s => s.floor_id)).size
            };

            // 内存清理 - 防止内存泄漏
            const result = {
                success: true,
                data: {
                    states: filteredStates,
                    statistics: stats,
                    data_sources: {
                        states: statesResult.data.retrieved_at || new Date().toISOString(),
                        entity_registry: entitiesResult.data.retrieved_at || new Date().toISOString(),
                        devices: devicesResult.data.retrieved_at || new Date().toISOString(),
                        rooms: roomsResult.data.retrieved_at || new Date().toISOString(),
                        floors: floorsResult.data.retrieved_at || new Date().toISOString()
                    },
                    retrieved_at: new Date().toISOString()
                }
            };
            
            // 显式清理大型映射对象以防止内存泄漏
            try {
                if (entityMap) {
                    this.logger.info(`[MEMORY] 清理 entityMap, 大小: ${entityMap.size}`);
                    entityMap.clear();
                    entityMap = null;
                }
                if (deviceMap) {
                    this.logger.info(`[MEMORY] 清理 deviceMap, 大小: ${deviceMap.size}`);
                    deviceMap.clear();
                    deviceMap = null;
                }
                if (roomMap) {
                    this.logger.info(`[MEMORY] 清理 roomMap, 大小: ${roomMap.size}`);
                    roomMap.clear();
                    roomMap = null;
                }
                if (floorMap) {
                    this.logger.info(`[MEMORY] 清理 floorMap, 大小: ${floorMap.size}`);
                    floorMap.clear();
                    floorMap = null;
                }
                
                // 检查清理后的内存使用
                const memUsageAfter = process.memoryUsage();
                this.logger.info(`[MEMORY] 清理后内存使用: ${Math.round(memUsageAfter.heapUsed/1024/1024)}MB`);
                
                // 在 Termux 环境中，主动触发垃圾回收
                if (global.gc && process.env.NODE_ENV === 'production') {
                    global.gc();
                    this.logger.info(`[MEMORY] 已触发垃圾回收`);
                }
                
            } catch (cleanupError) {
                this.logger.error(`[MEMORY] 清理映射时发生错误: ${cleanupError.message}`);
            }
            
            return result;

        } catch (error) {
            this.logger.error('Failed to get enhanced states:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 基于意图数据匹配需要控制的设备
     * @param {Object} intentData - 意图数据
     * @param {Object} credentials - 凭据信息
     */
    async matchControlDevices(intentData, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            // 验证意图数据格式
            if (!intentData || !intentData.intent || !intentData.devices || !Array.isArray(intentData.devices)) {
                return { success: false, error: 'Invalid intent data format' };
            }

            // 获取增强状态数据（优先使用缓存）
            const enhancedStatesResult = await this.getEnhancedStates(credentials);
            if (!enhancedStatesResult.success) {
                return { success: false, error: 'Failed to get enhanced states: ' + enhancedStatesResult.error };
            }

            const allEntities = enhancedStatesResult.data.states;
            const isFromCache = enhancedStatesResult.data.from_cache || false;
            const matchedDevices = [];
            const matchedEntityIds = new Set(); // 防止重复匹配

            // 处理每个意图设备
            for (const intentDevice of intentData.devices) {
                const { room_name, device_type, device_name, action } = intentDevice;
                
                // 1. 基于entity_id模式匹配设备类型和房间
                const typeMatchedEntities = allEntities.filter(entity => {
                    // 首先按设备类型筛选（基于entity_id前缀）
                    const entityDomain = entity.entity_id.split('.')[0];
                    if (!this.matchEntityDomainToDeviceType(entityDomain, device_type)) {
                        return false;
                    }
                    
                    // 检查房间匹配 - 优先使用area_name，其次使用entity_id模式和friendly_name
                    if (entity.area_name) {
                        return this.normalizeRoomName(entity.area_name) === this.normalizeRoomName(room_name);
                    } else {
                        // 如果room_name是"any"或为空，返回所有该类型的设备
                        if (!room_name || room_name.toLowerCase() === 'any') {
                            return true;
                        }
                        // 基于entity_id中的房间名称进行匹配
                        const entityIdMatch = this.matchRoomFromEntityId(entity.entity_id, room_name);
                        if (entityIdMatch) {
                            return true;
                        }
                        // 如果entity_id匹配失败，尝试从friendly_name匹配
                        const friendlyName = entity.attributes?.friendly_name || '';
                        if (friendlyName) {
                            return this.matchRoomFromFriendlyName(friendlyName, room_name);
                        }
                        return false;
                    }
                });

                if (typeMatchedEntities.length === 0) {
                    this.logger.warn(`No entities with device type '${device_type}' found for room: ${room_name}`);
                    continue;
                }

                // 3. 在类型匹配的基础上，进一步按设备名称匹配
                let matchedEntities = [];
                
                if (device_name) {
                    // 尝试按设备名称匹配
                    matchedEntities = typeMatchedEntities.filter(entity => {
                        const entityDeviceName = entity.device_name || '';
                        const normalizedEntityName = this.normalizeDeviceName(entityDeviceName);
                        const normalizedIntentName = this.normalizeDeviceName(device_name);
                        
                        return normalizedEntityName.includes(normalizedIntentName) || 
                               normalizedIntentName.includes(normalizedEntityName) ||
                               this.matchDeviceNameByType(entityDeviceName, device_name, device_type);
                    });
                }

                // 如果没有设备名称或设备名称匹配失败，使用所有类型匹配的实体
                if (matchedEntities.length === 0) {
                    matchedEntities = typeMatchedEntities;
                }

                // 4. 为匹配的实体添加动作信息，避免重复
                matchedEntities.forEach(entity => {
                    // 避免同一个实体被重复添加
                    if (!matchedEntityIds.has(entity.entity_id)) {
                        matchedEntityIds.add(entity.entity_id);
                        
                        // 增强实体数据结构
                        const enhancedEntity = {
                            ...entity, // 保留所有原始字段
                            // 添加增强字段
                            friendly_name: entity.attributes?.friendly_name || entity.entity_id,
                            area_name: entity.area_name || this.extractRoomFromEntityId(entity.entity_id),
                            device_type: entity.device_type || entity.entity_id.split('.')[0],
                            device_name: entity.attributes?.friendly_name || entity.entity_id,
                            // 添加意图和动作字段
                            action: action,
                            intent_room: room_name,
                            intent_device_type: device_type,
                            intent_device_name: device_name,
                            match_confidence: this.calculateMatchConfidenceFromEntityId(intentDevice, entity)
                        };
                        
                        matchedDevices.push(enhancedEntity);
                    }
                });

                this.logger.info(`Matched ${matchedEntities.length} entities for ${room_name} ${device_name || device_type}`);
            }

            // 统计信息
            const stats = {
                total_intent_devices: intentData.devices.length,
                matched_entities: matchedDevices.length,
                unique_rooms: new Set(matchedDevices.map(d => d.area_name)).size,
                unique_device_types: new Set(matchedDevices.map(d => d.device_type)).size,
                actions: [...new Set(matchedDevices.map(d => d.action))],
                confidence_scores: {
                    high: matchedDevices.filter(d => d.match_confidence >= 0.8).length,
                    medium: matchedDevices.filter(d => d.match_confidence >= 0.5 && d.match_confidence < 0.8).length,
                    low: matchedDevices.filter(d => d.match_confidence < 0.5).length
                }
            };

            return {
                success: true,
                data: {
                    matched_devices: matchedDevices,
                    statistics: stats,
                    intent_data: intentData,
                    from_cache: isFromCache,
                    cache_age: enhancedStatesResult.data.cache_age || null,
                    retrieved_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('Failed to match control devices:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 标准化房间名称
     */
    normalizeRoomName(roomName) {
        if (!roomName) return '';
        return roomName.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, '_');
    }

    /**
     * 标准化设备名称
     */
    normalizeDeviceName(deviceName) {
        if (!deviceName) return '';
        return deviceName.toLowerCase().trim().replace(/[^\w\s]/g, '');
    }

    /**
     * 根据设备类型匹配设备名称
     */
    matchDeviceNameByType(entityName, intentName, deviceType) {
        const typeMappings = {
            'light': ['light', 'lamp', 'bulb', '灯', '照明', 'lighting'],
            'climate': ['air', 'conditioner', 'ac', '空调', '冷气', 'heating', 'cooling'],
            'switch': ['switch', 'switch', '开关', 'button'],
            'fan': ['fan', '风扇', '风机', 'blower'],
            'sensor': ['sensor', '传感器', '感应器', 'detector'],
            'camera': ['camera', '摄像头', '监控', 'cam'],
            'lock': ['lock', 'lock', '锁', '门锁', 'door'],
            'cover': ['cover', 'blind', 'curtain', '窗帘', '百叶窗', 'shade']
        };

        const normalizedEntity = this.normalizeDeviceName(entityName);
        const normalizedIntent = this.normalizeDeviceName(intentName);
        
        // 检查直接匹配
        if (normalizedEntity.includes(normalizedIntent) || normalizedIntent.includes(normalizedEntity)) {
            return true;
        }

        // 检查类型映射
        const typeKeywords = typeMappings[deviceType] || [];
        return typeKeywords.some(keyword => 
            normalizedEntity.includes(keyword) || normalizedIntent.includes(keyword)
        );
    }

    /**
     * 严格匹配设备类型（只匹配确切的类型）
     */
    strictDeviceTypeMatch(entityType, targetType) {
        if (!entityType || !targetType) return false;
        
        // 直接类型匹配
        if (entityType === targetType) return true;
        
        // 严格的类型映射，只允许明确相关的类型
        const strictTypeMappings = {
            'light': ['light'],
            'climate': ['climate'],
            'switch': ['switch'],
            'fan': ['fan'],
            'sensor': ['sensor', 'binary_sensor'],
            'camera': ['camera'],
            'lock': ['lock'],
            'cover': ['cover']
        };

        const allowedTypes = strictTypeMappings[targetType] || [];
        return allowedTypes.includes(entityType);
    }

    /**
     * 匹配设备类型（保留原有的宽松匹配逻辑）
     */
    matchDeviceType(entity, targetType) {
        if (!entity || !targetType) return false;
        
        const entityType = entity.device_type;
        const typeMappings = {
            'light': ['light', 'lamp', 'bulb'],
            'climate': ['climate', 'air_conditioner', 'heater', 'thermostat'],
            'switch': ['switch', 'button'],
            'fan': ['fan'],
            'sensor': ['sensor', 'binary_sensor'],
            'camera': ['camera'],
            'lock': ['lock'],
            'cover': ['cover', 'blind', 'curtain']
        };

        // 直接匹配
        if (entityType === targetType) return true;

        // 类型映射匹配
        const mappedTypes = typeMappings[targetType] || [];
        return mappedTypes.includes(entityType);
    }

    /**
     * 计算匹配置信度
     */
    calculateMatchConfidence(intentDevice, entity) {
        let confidence = 0;

        // 房间匹配 (40%)
        if (entity.area_name && this.normalizeRoomName(entity.area_name) === this.normalizeRoomName(intentDevice.room_name)) {
            confidence += 0.4;
        }

        // 设备类型匹配 (30%)
        if (entity.device_type === intentDevice.device_type) {
            confidence += 0.3;
        }

        // 设备名称匹配 (30%)
        if (intentDevice.device_name && entity.device_name) {
            const entityName = this.normalizeDeviceName(entity.device_name);
            const intentName = this.normalizeDeviceName(intentDevice.device_name);
            
            if (entityName === intentName) {
                confidence += 0.3;
            } else if (entityName.includes(intentName) || intentName.includes(entityName)) {
                confidence += 0.2;
            } else if (this.matchDeviceNameByType(entity.device_name, intentDevice.device_name, intentDevice.device_type)) {
                confidence += 0.15;
            }
        }

        return Math.min(confidence, 1.0);
    }

    /**
     * 启动增强状态数据缓存更新定时器 - 使用错峰调度避免冲突
     */
    startEnhancedStatesCacheUpdater() {
        // 清除现有定时器
        if (this.cacheUpdateTimer) {
            clearInterval(this.cacheUpdateTimer);
        }

        const { updateInterval, staggerDelay } = this.enhancedStatesCache;
        
        this.logger.info(`[TIMING-OPT] 启动错峰缓存更新: 初始延迟 ${Math.round(staggerDelay/1000)}s, 间隔 ${Math.round(updateInterval/1000)}s`);

        // 使用错峰延迟避免与Telegram操作冲突
        setTimeout(() => {
            // 首次执行更新
            this.updateEnhancedStatesCache().catch(error => {
                this.logger.error('[TIMING-OPT] 初始缓存更新失败:', error);
            });

            // 设置定时更新（使用错峰间隔）
            this.cacheUpdateTimer = setInterval(() => {
                // 检查当前是否有高负载操作
                const currentMemory = process.memoryUsage().heapUsed / 1024 / 1024;
                const activeRequestCount = global.telegramModule ? global.telegramModule.activeRequests.size : 0;
                
                // 如果系统负载过高，延迟此次更新
                if (currentMemory > 180 || activeRequestCount > 3) {
                    this.logger.warn(`[TIMING-OPT] 系统负载高 (内存: ${Math.round(currentMemory)}MB, 请求: ${activeRequestCount})，延迟缓存更新`);
                    
                    // 延迟15-30秒后重试
                    const retryDelay = 15000 + Math.random() * 15000;
                    setTimeout(() => {
                        if (!this.enhancedStatesCache.isUpdating) {
                            this.updateEnhancedStatesCache().catch(error => {
                                this.logger.error('[TIMING-OPT] 延迟缓存更新失败:', error);
                            });
                        }
                    }, retryDelay);
                    
                    return;
                }

                // 正常执行缓存更新
                this.updateEnhancedStatesCache().catch(error => {
                    this.logger.error('[TIMING-OPT] 定时缓存更新失败:', error);
                });
                
            }, updateInterval);

            this.logger.info(`[TIMING-OPT] 错峰缓存更新已启动`);
            
        }, staggerDelay);
    }

    /**
     * 停止增强状态数据缓存更新定时器
     */
    stopEnhancedStatesCacheUpdater() {
        if (this.cacheUpdateTimer) {
            clearInterval(this.cacheUpdateTimer);
            this.cacheUpdateTimer = null;
            this.logger.info('Enhanced states cache updater stopped');
        }
    }

    /**
     * 更新增强状态数据缓存 - 使用原子锁机制防止竞争条件
     */
    async updateEnhancedStatesCache() {
        // 使用原子锁机制
        if (this.enhancedStatesCache.isUpdating) {
            this.logger.info('Enhanced states cache update already in progress, skipping');
            return;
        }

        // 记录开始时间用于超时保护
        const startTime = Date.now();
        const TIMEOUT_MS = 30000; // 30秒超时
        let timeoutId = null;

        try {
            this.enhancedStatesCache.isUpdating = true;
            this.logger.info(`[CACHE-ATOMIC] 开始缓存更新 - 时间戳: ${startTime}`);

            // 设置超时保护
            timeoutId = setTimeout(() => {
                this.logger.error(`[CACHE-ATOMIC] 缓存更新超时 (${TIMEOUT_MS}ms)，强制释放锁`);
                this.enhancedStatesCache.isUpdating = false;
            }, TIMEOUT_MS);

            // 内存使用情况记录
            const memBefore = process.memoryUsage();
            this.logger.info(`[CACHE-ATOMIC] 更新前内存: 堆=${Math.round(memBefore.heapUsed/1024/1024)}MB`);

            // 获取凭据
            const credResult = await this.getCredentials();
            if (!credResult.success) {
                this.logger.warn('[CACHE-ATOMIC] Failed to get credentials for cache update:', credResult.error);
                return;
            }

            // 获取增强状态数据
            const enhancedStatesResult = await this.getEnhancedStatesInternal(credResult.data);
            if (enhancedStatesResult.success) {
                // 原子性更新缓存数据
                const oldData = this.enhancedStatesCache.data;
                this.enhancedStatesCache.data = enhancedStatesResult.data;
                this.enhancedStatesCache.lastUpdated = Date.now();
                
                // 显式清理旧数据
                if (oldData && oldData.states) {
                    this.logger.info(`[CACHE-ATOMIC] 清理旧缓存数据: ${oldData.states.length} 条记录`);
                    oldData.states = null;
                }

                // 内存使用情况记录
                const memAfter = process.memoryUsage();
                const memDiff = memAfter.heapUsed - memBefore.heapUsed;
                this.logger.info(`[CACHE-ATOMIC] 缓存更新完成: ${enhancedStatesResult.data.states.length} 实体, 内存变化: ${Math.round(memDiff/1024/1024)}MB`);

                // 强制垃圾回收（如果可用）
                if (global.gc && Math.abs(memDiff) > 10 * 1024 * 1024) { // 内存变化超过10MB时
                    this.logger.info('[CACHE-ATOMIC] 触发垃圾回收');
                    global.gc();
                }
            } else {
                this.logger.error('[CACHE-ATOMIC] Failed to update enhanced states cache:', enhancedStatesResult.error);
            }

            // 清除超时定时器
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }

        } catch (error) {
            this.logger.error('[CACHE-ATOMIC] Error updating enhanced states cache:', error);
            
            // 记录详细错误信息
            if (error.message && error.message.includes('out of memory')) {
                const mem = process.memoryUsage();
                this.logger.error(`[CACHE-ATOMIC] 内存不足错误 - 当前内存: 堆=${Math.round(mem.heapUsed/1024/1024)}MB, RSS=${Math.round(mem.rss/1024/1024)}MB`);
            }
        } finally {
            // 确保总是释放锁
            this.enhancedStatesCache.isUpdating = false;
            
            // 清除超时定时器
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            
            const endTime = Date.now();
            const duration = endTime - startTime;
            this.logger.info(`[CACHE-ATOMIC] 缓存更新完成 - 耗时: ${duration}ms`);
        }
    }

    /**
     * 获取缓存的增强状态数据
     */
    getCachedEnhancedStates(areaNames = null, deviceTypes = null) {
        const now = Date.now();
        const cache = this.enhancedStatesCache;

        // 检查缓存是否有效
        if (!cache.data || !cache.lastUpdated || (now - cache.lastUpdated) > cache.maxAge) {
            this.logger.warn('Enhanced states cache is invalid or expired');
            return null;
        }

        // 如果没有筛选条件，直接返回缓存数据
        if (!areaNames && !deviceTypes) {
            this.logger.info('Returning cached enhanced states without filters');
            return {
                success: true,
                data: {
                    ...cache.data,
                    from_cache: true,
                    cache_age: now - cache.lastUpdated
                }
            };
        }

        // 应用筛选条件
        let filteredStates = cache.data.states;

        // 按区域名称筛选
        if (areaNames && Array.isArray(areaNames) && areaNames.length > 0) {
            const normalizedAreaNames = areaNames.map(name => name.toLowerCase().trim()).filter(name => name);
            if (normalizedAreaNames.length > 0) {
                filteredStates = filteredStates.filter(state => {
                    if (!state.area_name) return false;
                    const normalizedAreaName = state.area_name.toLowerCase().trim();
                    return normalizedAreaNames.some(filterName =>
                        normalizedAreaName.includes(filterName) ||
                        filterName.includes(normalizedAreaName)
                    );
                });
            }
        }

        // 按设备类型筛选
        if (deviceTypes && Array.isArray(deviceTypes) && deviceTypes.length > 0) {
            const normalizedDeviceTypes = deviceTypes.map(type => type.toLowerCase().trim()).filter(type => type);
            if (normalizedDeviceTypes.length > 0) {
                filteredStates = filteredStates.filter(state => {
                    if (!state.device_type) return false;
                    const normalizedDeviceType = state.device_type.toLowerCase().trim();
                    return normalizedDeviceTypes.some(filterType =>
                        normalizedDeviceType.includes(filterType) ||
                        filterType.includes(normalizedDeviceType)
                    );
                });
            }
        }

        // 更新统计信息
        const originalStats = cache.data.statistics;
        const filteredStats = {
            ...originalStats,
            total_states: filteredStates.length,
            total_states_before_filter: cache.data.states.length,
            filters_applied: {
                area_names: areaNames,
                device_types: deviceTypes
            }
        };

        this.logger.info(`Returning filtered cached enhanced states: ${filteredStates.length} entities`);

        return {
            success: true,
            data: {
                states: filteredStates,
                statistics: filteredStats,
                from_cache: true,
                cache_age: now - cache.lastUpdated,
                retrieved_at: new Date().toISOString()
            }
        };
    }

    /**
     * 内部方法：获取增强状态数据（不使用缓存）
     */
    async getEnhancedStatesInternal(credentials, areaNames = null, deviceTypes = null) {
        // 使用工作进程进行内存安全的增强状态处理 - 防止内存corruption
        const startTime = Date.now();
        
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            // 检查工作进程状态
            if (!this.workerInitialized || !this.workerManager) {
                this.logger.warn('[WORKER-SAFE] 工作进程未初始化，尝试启动...');
                try {
                    this.workerManager = new WorkerManager(this.logger);
                    await this.workerManager.startWorker();
                    this.workerInitialized = true;
                    this.logger.info('[WORKER-SAFE] 工作进程启动成功');
                } catch (workerError) {
                    this.logger.error('[WORKER-SAFE] 工作进程启动失败，使用降级处理:', workerError.message);
                    return this.getEnhancedStatesLegacy(credentials, areaNames, deviceTypes);
                }
            }

            // 内存检查 - 如果主进程内存已经很高，必须使用工作进程
            const memBefore = process.memoryUsage();
            const heapMB = Math.round(memBefore.heapUsed / 1024 / 1024);
            
            this.logger.info(`[WORKER-SAFE] 开始工作进程状态处理 - 主进程堆内存: ${heapMB}MB`);
            
            if (heapMB > 120) {
                this.logger.warn(`[WORKER-SAFE] 主进程内存使用过高 (${heapMB}MB), 强制使用工作进程`);
            }

            // 使用工作进程处理状态数据
            this.logger.info('[WORKER-SAFE] 向工作进程发送状态处理请求...');
            
            const workerResult = await this.workerManager.sendRequest('get_states', {
                credentials: {
                    home_assistant_url: credentials.base_url,
                    access_token: credentials.access_token
                }
            });

            if (!workerResult || workerResult.length === 0) {
                this.logger.warn('[WORKER-SAFE] 工作进程返回空结果，使用降级处理');
                return this.getEnhancedStatesLegacy(credentials, areaNames, deviceTypes);
            }

            // 应用过滤器
            let filteredStates = workerResult;
            
            if (areaNames && Array.isArray(areaNames) && areaNames.length > 0) {
                filteredStates = filteredStates.filter(state => 
                    areaNames.some(areaName => 
                        state.area_name && state.area_name.toLowerCase().includes(areaName.toLowerCase())
                    )
                );
            }

            if (deviceTypes && Array.isArray(deviceTypes) && deviceTypes.length > 0) {
                filteredStates = filteredStates.filter(state => 
                    deviceTypes.includes(state.domain) ||
                    deviceTypes.some(deviceType => 
                        state.entity_id.startsWith(deviceType + '.')
                    )
                );
            }

            const processingTime = Date.now() - startTime;
            this.logger.info(`[WORKER-SAFE] 工作进程处理完成 - 处理时间: ${processingTime}ms, 结果: ${filteredStates.length} 个状态`);

            return {
                success: true,
                data: {
                    states: filteredStates,
                    metadata: {
                        total_states: workerResult.length,
                        filtered_states: filteredStates.length,
                        processing_time_ms: processingTime,
                        processed_by: 'worker_process',
                        timestamp: new Date().toISOString()
                    }
                }
            };

        } catch (error) {
            this.logger.error('[WORKER-SAFE] 工作进程处理失败:', error.message);
            
            // 工作进程失败时使用降级处理
            this.logger.warn('[WORKER-SAFE] 切换到降级处理模式');
            return this.getEnhancedStatesLegacy(credentials, areaNames, deviceTypes);
        }
    }

    /**
     * 降级处理方法：不使用工作进程的传统处理方式
     * 仅在工作进程失败时使用，具有更严格的内存限制
     */
    async getEnhancedStatesLegacy(credentials, areaNames = null, deviceTypes = null) {
        this.logger.warn('[TERMUX-SAFE] 使用Termux环境极致安全模式');
        
        const startTime = Date.now();
        const memBefore = process.memoryUsage();
        const heapMB = Math.round(memBefore.heapUsed / 1024 / 1024);
        
        // Termux环境极严格内存限制
        if (heapMB > 50) {
            this.logger.error(`[TERMUX-SAFE] Termux环境内存过高 (${heapMB}MB)，拒绝处理`);
            return { 
                success: false, 
                error: 'Memory too high for Termux environment',
                suggested_action: 'Wait for memory to decrease or restart'
            };
        }

        try {
            // Termux环境：只获取最基础状态数据，完全避免任何映射处理
            this.logger.info('[TERMUX-SAFE] 获取基础状态数据...');
            const statesResult = await this.getStates(credentials);
            if (!statesResult.success) {
                return { success: false, error: 'Failed to get states: ' + statesResult.error };
            }

            const states = statesResult.data.states || [];
            this.logger.info(`[TERMUX-SAFE] 获取到 ${states.length} 个状态实体`);

            // Termux环境：超简化处理 - 不创建任何新对象，避免内存分配
            let filteredStates = states;
            
            // 只进行最基本的过滤，不修改对象结构
            if (deviceTypes && Array.isArray(deviceTypes) && deviceTypes.length > 0) {
                filteredStates = [];
                for (let i = 0; i < states.length; i++) {
                    const state = states[i];
                    const domain = state.entity_id.split('.')[0];
                    if (deviceTypes.includes(domain)) {
                        // 直接使用原始对象，不创建新对象
                        filteredStates.push(state);
                    }
                }
            }

            // 强制垃圾回收
            if (global.gc) {
                global.gc();
            }

            const processingTime = Date.now() - startTime;
            const memAfter = process.memoryUsage();
            const finalHeapMB = Math.round(memAfter.heapUsed / 1024 / 1024);
            
            this.logger.info(`[LEGACY-SAFE] 降级处理完成 - 内存: ${heapMB}MB -> ${finalHeapMB}MB, 耗时: ${processingTime}ms`);

            return {
                success: true,
                data: {
                    states: filteredStates,
                    metadata: {
                        total_states: states.length,
                        filtered_states: filteredStates.length,
                        processing_time_ms: processingTime,
                        processed_by: 'legacy_fallback',
                        memory_usage_mb: finalHeapMB,
                        timestamp: new Date().toISOString(),
                        note: 'Simplified processing due to memory constraints'
                    }
                }
            };

        } catch (error) {
            this.logger.error('[LEGACY-SAFE] 降级处理也失败:', error.message);
            return { 
                success: false, 
                error: 'Both worker and legacy processing failed: ' + error.message 
            };
        }
    }

    /**
     * 匹配实体域到设备类型
     */
    matchEntityDomainToDeviceType(entityDomain, deviceType) {
        const domainMappings = {
            'light': ['light'],
            'switch': ['switch'],
            'fan': ['fan'],
            'climate': ['climate'],
            'cover': ['cover'],
            'lock': ['lock'],
            'camera': ['camera'],
            'sensor': ['sensor'],
            'binary_sensor': ['sensor'],
            'media_player': ['media_player']
        };

        const allowedDomains = domainMappings[deviceType] || [];
        return allowedDomains.includes(entityDomain);
    }

    /**
     * 从entity_id中匹配房间名称
     */
    matchRoomFromEntityId(entityId, roomName) {
        const normalizedEntityId = entityId.toLowerCase().replace(/[_-]/g, '');
        const normalizedRoomName = this.normalizeRoomName(roomName);
        
        // 常见房间名称映射 - 使用正确的normalized key格式
        const roomMappings = {
            'guest_bedroom': ['guest', 'guestbedroom', 'guestroom'],
            'jaydens_bedroom': ['jayden', 'jaydenbedroom', 'jaydens'],
            'jacquelyns_bedroom': ['jacquelyn', 'jacquelynbedroom', 'jacquelyns'],
            'master_bedroom': ['master', 'masterbedroom'],
            'living_room': ['living', 'livingroom'],
            'kitchen': ['kitchen'],
            'dining_room': ['dining', 'diningroom'],
            'tv_room': ['tv', 'tvroom'],
            'study_room': ['study', 'studyroom'],
            // 添加更多变体
            'guest bedroom': ['guest', 'guestbedroom', 'guestroom'],
            'jaydens bedroom': ['jayden', 'jaydenbedroom', 'jaydens'],
            'jacquelyns bedroom': ['jacquelyn', 'jacquelynbedroom', 'jacquelyns'],
            'master bedroom': ['master', 'masterbedroom'],
            'living room': ['living', 'livingroom'],
            'dining room': ['dining', 'diningroom'],
            'tv room': ['tv', 'tvroom'],
            'study room': ['study', 'studyroom']
        };

        const roomKeywords = roomMappings[normalizedRoomName] || roomMappings[normalizedRoomName.toLowerCase()] || [normalizedRoomName];
        
        return roomKeywords.some(keyword => normalizedEntityId.includes(keyword));
    }

    /**
     * 从friendly_name中匹配房间名称
     */
    matchRoomFromFriendlyName(friendlyName, roomName) {
        const normalizedFriendlyName = friendlyName.toLowerCase().replace(/[_-]/g, '');
        const normalizedRoomName = this.normalizeRoomName(roomName);
        
        // 房间名称映射（与entity_id匹配相同）
        const roomMappings = {
            'guest_bedroom': ['guest', 'guestbedroom', 'guestroom'],
            'jaydens_bedroom': ['jayden', 'jaydenbedroom', 'jaydens'],
            'jacquelyns_bedroom': ['jacquelyn', 'jacquelynbedroom', 'jacquelyns'],
            'master_bedroom': ['master', 'masterbedroom'],
            'living_room': ['living', 'livingroom'],
            'kitchen': ['kitchen'],
            'dining_room': ['dining', 'diningroom'],
            'tv_room': ['tv', 'tvroom'],
            'study_room': ['study', 'studyroom'],
            // 添加更多变体
            'guest bedroom': ['guest', 'guestbedroom', 'guestroom'],
            'jaydens bedroom': ['jayden', 'jaydenbedroom', 'jaydens'],
            'jacquelyns bedroom': ['jacquelyn', 'jacquelynbedroom', 'jacquelyns'],
            'master bedroom': ['master', 'masterbedroom'],
            'living room': ['living', 'livingroom'],
            'dining room': ['dining', 'diningroom'],
            'tv room': ['tv', 'tvroom'],
            'study room': ['study', 'studyroom']
        };

        const roomKeywords = roomMappings[normalizedRoomName] || roomMappings[normalizedRoomName.toLowerCase()] || [normalizedRoomName];
        
        return roomKeywords.some(keyword => normalizedFriendlyName.includes(keyword));
    }

    /**
     * 从entity_id提取房间名称
     */
    extractRoomFromEntityId(entityId) {
        const id = entityId.toLowerCase();
        
        // 房间关键词映射
        const roomPatterns = {
            'master': 'Master Bedroom',
            'jayden': 'Jayden\'s Bedroom', 
            'jacquelyn': 'Jacquelyn\'s Bedroom',
            'guest': 'Guest Bedroom',
            'living': 'Living Room',
            'kitchen': 'Kitchen',
            'dining': 'Dining Room',
            'tv': 'TV Room',
            'study': 'Study Room'
        };

        for (const [keyword, roomName] of Object.entries(roomPatterns)) {
            if (id.includes(keyword)) {
                return roomName;
            }
        }

        return 'Unknown Room';
    }

    /**
     * 基于entity_id计算匹配置信度
     */
    calculateMatchConfidenceFromEntityId(intentDevice, entity) {
        let confidence = 0;

        // 设备类型匹配 (40%)
        const entityDomain = entity.entity_id.split('.')[0];
        if (this.matchEntityDomainToDeviceType(entityDomain, intentDevice.device_type)) {
            confidence += 0.4;
        }

        // 房间匹配 (40%)
        if (this.matchRoomFromEntityId(entity.entity_id, intentDevice.room_name)) {
            confidence += 0.4;
        }

        // 设备名称匹配 (20%)
        if (intentDevice.device_name && entity.attributes?.friendly_name) {
            const entityName = this.normalizeDeviceName(entity.attributes.friendly_name);
            const intentName = this.normalizeDeviceName(intentDevice.device_name);
            
            if (entityName.includes(intentName) || intentName.includes(entityName)) {
                confidence += 0.2;
            }
        } else {
            // 如果没有设备名称，给予部分分数
            confidence += 0.1;
        }

        return Math.max(0, Math.min(1, confidence));
    }

    /**
     * 清理工作进程和相关资源
     */
    async cleanup() {
        try {
            if (this.workerManager) {
                await this.workerManager.cleanup();
                this.workerManager = null;
                this.workerInitialized = false;
                this.logger.info('[CLEANUP] Home Assistant工作进程已清理');
            }
        } catch (error) {
            this.logger.error('[CLEANUP] 清理工作进程失败:', error.message);
        }

        // 清理定时器
        if (this.cacheUpdateTimer) {
            clearInterval(this.cacheUpdateTimer);
            this.cacheUpdateTimer = null;
            this.logger.info('[CLEANUP] 缓存更新定时器已清理');
        }
    }
}

module.exports = Home_assistantModule;
