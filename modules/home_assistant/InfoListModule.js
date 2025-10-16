const WebSocket = require('ws');

/**
 * InfoListModule - Home Assistant信息列表管理模块
 * 负责获取和缓存实体列表、设备列表、房间列表、楼层列表
 */
class InfoListModule {
    constructor(logger, baseModule) {
        this.logger = logger;
        this.baseModule = baseModule;

        // 综合列表缓存系统
        this.enhancedListCache = {
            data: null,
            lastUpdated: null,
            isUpdating: false,
            updateInterval: 60000, // 1分钟更新间隔
            maxAge: 120000, // 2分钟最大缓存时间
        };

        // 缓存更新定时器
        this.cacheUpdateTimer = null;
    }

    /**
     * 启动综合列表缓存更新定时器
     */
    startEnhancedListCacheUpdater() {
        if (this.cacheUpdateTimer) {
            clearInterval(this.cacheUpdateTimer);
        }

        this.logger.info('[INFO-LIST] 启动综合列表缓存更新器，间隔1分钟');

        // 首次执行更新
        this.updateEnhancedListCache().catch(error => {
            this.logger.error('[INFO-LIST] 初始缓存更新失败:', error);
        });

        // 设置定时更新
        this.cacheUpdateTimer = setInterval(() => {
            this.updateEnhancedListCache().catch(error => {
                this.logger.error('[INFO-LIST] 定时缓存更新失败:', error);
            });
        }, this.enhancedListCache.updateInterval);
    }

    /**
     * 停止缓存更新定时器
     */
    stopEnhancedListCacheUpdater() {
        if (this.cacheUpdateTimer) {
            clearInterval(this.cacheUpdateTimer);
            this.cacheUpdateTimer = null;
        }
    }

    /**
     * 更新综合列表缓存
     */
    async updateEnhancedListCache() {
        if (this.enhancedListCache.isUpdating) {
            this.logger.info('[INFO-LIST] 缓存更新进行中，跳过');
            return;
        }

        try {
            this.enhancedListCache.isUpdating = true;
            this.logger.info('[INFO-LIST] 开始更新综合列表缓存');

            const credentials = await this.baseModule.getCredentials();
            if (!credentials.success) {
                throw new Error('获取凭据失败: ' + credentials.error);
            }

            const { access_token, base_url } = credentials.data;

            // 并行获取所有基础数据
            const [entitiesResult, devicesResult, roomsResult, floorsResult, statesResult] = await Promise.all([
                this.getEntityRegistryViaWebSocket(access_token, base_url),
                this.getDevicesViaWebSocket(access_token, base_url),
                this.getRoomsViaWebSocket(access_token, base_url),
                this.getFloorsViaWebSocket(access_token, base_url),
                this.baseModule.basicInfoModule.getStates(credentials.data)
            ]);

            if (!entitiesResult.success || !devicesResult.success || !roomsResult.success || !floorsResult.success) {
                throw new Error('获取基础数据失败');
            }

            // 构建状态映射
            const statesMap = new Map();
            if (statesResult.success && Array.isArray(statesResult.data.states)) {
                statesResult.data.states.forEach(state => {
                    statesMap.set(state.entity_id, state);
                });
            }

            // 构建综合列表
            const enhancedList = this.buildEnhancedList(
                entitiesResult.data.entities || [],
                devicesResult.data.devices || [],
                roomsResult.data.rooms || [],
                floorsResult.data.floors || [],
                statesMap
            );

            // 更新缓存
            this.enhancedListCache.data = enhancedList;
            this.enhancedListCache.lastUpdated = Date.now();

            this.logger.info(`[INFO-LIST] 缓存更新完成，包含 ${enhancedList.length} 个增强实体`);

        } catch (error) {
            this.logger.error('[INFO-LIST] 更新缓存失败:', error);
        } finally {
            this.enhancedListCache.isUpdating = false;
        }
    }

    /**
     * 构建综合列表 - 将实体信息与设备、房间、楼层信息结合
     */
    buildEnhancedList(entities, devices, rooms, floors, statesMap = new Map()) {
        const deviceMap = new Map(devices.map(d => [d.id, d]));
        const roomMap = new Map(rooms.map(r => [r.area_id, r]));
        const floorMap = new Map(floors.map(f => [f.floor_id, f]));

        return entities.map(entity => {
            const device = deviceMap.get(entity.device_id);
            // 优先使用实体自身的area_id，其次使用设备的area_id（修复area_id匹配错误的问题）
            let room = null;
            if (entity && entity.area_id && roomMap.has(entity.area_id)) {
                room = roomMap.get(entity.area_id);
                // 调试信息：记录使用实体area_id的情况
                if (['sensor.temp_01', 'sensor.humidity', 'light.light_test_001', 'climate.text_ac_01', 'climate.auto_ac_001'].includes(entity.entity_id)) {
                    this.logger.info(`[DEBUG] ${entity.entity_id} using entity area_id: ${entity.area_id} -> room: ${room ? room.name : 'null'}`);
                }
            } else if (device && device.area_id && roomMap.has(device.area_id)) {
                room = roomMap.get(device.area_id);
                // 调试信息：记录使用设备area_id的情况
                if (['sensor.temp_01', 'sensor.humidity', 'light.light_test_001', 'climate.text_ac_01', 'climate.auto_ac_001'].includes(entity.entity_id)) {
                    this.logger.info(`[DEBUG] ${entity.entity_id} using device area_id: ${device.area_id} -> room: ${room ? room.name : 'null'}`);
                }
            }
            const floor = room ? floorMap.get(room.floor_id) : null;
            const state = statesMap.get(entity.entity_id);
            const domain = entity.entity_id.split('.')[0];

            // 确定设备类型：优先使用device_class，没有则用domain
            let deviceType = domain; // 默认使用domain
            if (state && state.attributes && state.attributes.device_class) {
                deviceType = state.attributes.device_class;
            }

            // 获取映射表中的标准化字段
            const floorMapping = floor && this.parentModule ? this.parentModule.getFloorMappings()[floor.name] : null;
            const roomMapping = room && this.parentModule ? this.parentModule.getRoomMappings()[room.name] : null;
            
            return {
                // 实体基础信息
                entity_id: entity.entity_id,
                name: entity.name || entity.entity_id,
                platform: entity.platform,
                domain: domain,

                // 设备信息
                device_id: entity.device_id,
                device_name: device ? (device.name_by_user || device.name) : null,
                device_manufacturer: device ? device.manufacturer : null,
                device_model: device ? device.model : null,
                device_type: deviceType,

                // 房间信息
                room_id: room ? room.area_id : null,
                room_name: room ? room.name : null,

                // 楼层信息
                floor_id: floor ? floor.floor_id : null,
                floor_name: floor ? floor.name : null,
                
                // 标准化字段（来自 OpenAI 映射）
                floor_name_en: floorMapping ? floorMapping.floor_name_en : null,
                floor_type: floorMapping ? floorMapping.floor_type : null,
                level: floorMapping ? floorMapping.level : null,
                room_name_en: roomMapping ? roomMapping.room_name_en : null,
                room_type: roomMapping ? roomMapping.room_type : null,

                // 其他有用信息
                disabled: entity.disabled_by !== null,
                hidden: entity.hidden_by !== null,
                entity_category: entity.entity_category,
                icon: entity.icon,
                original_name: entity.original_name
            };
        });
    }

    /**
     * 组合楼层与房间，生成空间列表
     * @param {Array} floors 楼层列表
     * @param {Array} rooms 房间列表
     * @param {String} op 输出格式操作标识，支持：'floors'（默认，按楼层嵌套房间）
     */
    buildSpaces(floors = [], rooms = [], op = 'floors') {
        // 当前仅实现按楼层聚合房间
        if (op === 'floors') {
            const floorsWithRooms = (floors || []).map(floor => {
                const floorRooms = (rooms || []).filter(r => r.floor_id === floor.floor_id);
                return {
                    ...floor,
                    rooms: floorRooms
                };
            });
            return { floors: floorsWithRooms };
        }
        // 预留其他op实现
        return { floors: (floors || []).map(f => ({ ...f, rooms: [] })) };
    }

    /**
     * 获取空间列表（楼层 + 房间）
     */
    async getSpaces(op = 'floors', credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            const [floorsResult, roomsResult] = await Promise.all([
                this.getFloorsViaWebSocket(access_token, base_url),
                this.getRoomsViaWebSocket(access_token, base_url)
            ]);

            if (!floorsResult.success) {
                return floorsResult;
            }
            if (!roomsResult.success) {
                return roomsResult;
            }

            const data = this.buildSpaces(
                floorsResult.data.floors || [],
                roomsResult.data.rooms || [],
                op || 'floors'
            );

            return { success: true, data };
        } catch (error) {
            this.logger.error('[INFO-LIST] 获取空间列表失败:', error);
            return { success: false, error: 'Failed to get spaces', details: { message: error.message } };
        }
    }

    /**
     * 获取缓存的综合列表
     */
    getCachedEnhancedList(roomNames = null, deviceTypes = null) {
        const now = Date.now();
        const cache = this.enhancedListCache;

        if (!cache.data || !cache.lastUpdated || (now - cache.lastUpdated) > cache.maxAge) {
            this.logger.warn('[INFO-LIST] 缓存无效或已过期');
            return null;
        }

        let filteredList = cache.data;

        // 按房间名称过滤
        if (roomNames && roomNames.length > 0) {
            filteredList = filteredList.filter(item =>
                roomNames.includes(item.room_name)
            );
        }

        // 按设备类型过滤
        if (deviceTypes && deviceTypes.length > 0) {
            filteredList = filteredList.filter(item =>
                deviceTypes.includes(item.domain)
            );
        }

        return {
            success: true,
            data: {
                entities: filteredList,
                total_count: filteredList.length,
                cache_info: {
                    last_updated: new Date(cache.lastUpdated).toISOString(),
                    age_ms: now - cache.lastUpdated,
                    max_age_ms: cache.maxAge
                }
            }
        };
    }

    /**
     * 通过WebSocket获取实体注册表
     */
    async getEntityRegistryViaWebSocket(access_token, base_url) {
        return new Promise((resolve, reject) => {
            const url = base_url.replace(/^http/, 'ws') + '/api/websocket';
            let ws;
            let messageId = 1;
            const timeout = setTimeout(() => {
                if (ws) ws.close();
                reject(new Error('WebSocket连接超时'));
            }, 30000);

            try {
                ws = new WebSocket(url);

                ws.on('open', () => {
                    this.logger.info('[INFO-LIST] WebSocket连接已建立，获取实体注册表');
                });

                ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());

                        if (message.type === 'auth_required') {
                            ws.send(JSON.stringify({
                                type: 'auth',
                                access_token: access_token
                            }));
                        } else if (message.type === 'auth_ok') {
                            ws.send(JSON.stringify({
                                id: messageId++,
                                type: 'config/entity_registry/list'
                            }));
                        } else if (message.id && message.type === 'result') {
                            clearTimeout(timeout);
                            ws.close();
                            resolve({
                                success: true,
                                data: { entities: message.result || [] }
                            });
                        } else if (message.type === 'auth_invalid') {
                            clearTimeout(timeout);
                            ws.close();
                            resolve({
                                success: false,
                                error: 'WebSocket认证失败'
                            });
                        }
                    } catch (parseError) {
                        this.logger.error('[INFO-LIST] WebSocket消息解析错误:', parseError);
                    }
                });

                ws.on('error', (error) => {
                    clearTimeout(timeout);
                    this.logger.error('[INFO-LIST] WebSocket错误:', error);
                    resolve({
                        success: false,
                        error: 'WebSocket连接错误: ' + error.message
                    });
                });

                ws.on('close', () => {
                    clearTimeout(timeout);
                });

            } catch (error) {
                clearTimeout(timeout);
                resolve({
                    success: false,
                    error: 'WebSocket连接失败: ' + error.message
                });
            }
        });
    }

    /**
     * 通过WebSocket获取设备列表
     */
    async getDevicesViaWebSocket(access_token, base_url) {
        return new Promise((resolve, reject) => {
            const url = base_url.replace(/^http/, 'ws') + '/api/websocket';
            let ws;
            let messageId = 1;
            const timeout = setTimeout(() => {
                if (ws) ws.close();
                reject(new Error('WebSocket连接超时'));
            }, 30000);

            try {
                ws = new WebSocket(url);

                ws.on('open', () => {
                    this.logger.info('[INFO-LIST] WebSocket连接已建立，获取设备列表');
                });

                ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());

                        if (message.type === 'auth_required') {
                            ws.send(JSON.stringify({
                                type: 'auth',
                                access_token: access_token
                            }));
                        } else if (message.type === 'auth_ok') {
                            ws.send(JSON.stringify({
                                id: messageId++,
                                type: 'config/device_registry/list'
                            }));
                        } else if (message.id && message.type === 'result') {
                            clearTimeout(timeout);
                            ws.close();
                            resolve({
                                success: true,
                                data: { devices: message.result || [] }
                            });
                        } else if (message.type === 'auth_invalid') {
                            clearTimeout(timeout);
                            ws.close();
                            resolve({
                                success: false,
                                error: 'WebSocket认证失败'
                            });
                        }
                    } catch (parseError) {
                        this.logger.error('[INFO-LIST] WebSocket消息解析错误:', parseError);
                    }
                });

                ws.on('error', (error) => {
                    clearTimeout(timeout);
                    resolve({
                        success: false,
                        error: 'WebSocket连接错误: ' + error.message
                    });
                });

                ws.on('close', () => {
                    clearTimeout(timeout);
                });

            } catch (error) {
                clearTimeout(timeout);
                resolve({
                    success: false,
                    error: 'WebSocket连接失败: ' + error.message
                });
            }
        });
    }

    /**
     * 通过WebSocket获取房间列表
     */
    async getRoomsViaWebSocket(access_token, base_url) {
        return new Promise((resolve, reject) => {
            const url = base_url.replace(/^http/, 'ws') + '/api/websocket';
            let ws;
            let messageId = 1;
            const timeout = setTimeout(() => {
                if (ws) ws.close();
                reject(new Error('WebSocket连接超时'));
            }, 30000);

            try {
                ws = new WebSocket(url);

                ws.on('open', () => {
                    this.logger.info('[INFO-LIST] WebSocket连接已建立，获取房间列表');
                });

                ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());

                        if (message.type === 'auth_required') {
                            ws.send(JSON.stringify({
                                type: 'auth',
                                access_token: access_token
                            }));
                        } else if (message.type === 'auth_ok') {
                            ws.send(JSON.stringify({
                                id: messageId++,
                                type: 'config/area_registry/list'
                            }));
                        } else if (message.id && message.type === 'result') {
                            clearTimeout(timeout);
                            ws.close();
                            resolve({
                                success: true,
                                data: { rooms: message.result || [] }
                            });
                        } else if (message.type === 'auth_invalid') {
                            clearTimeout(timeout);
                            ws.close();
                            resolve({
                                success: false,
                                error: 'WebSocket认证失败'
                            });
                        }
                    } catch (parseError) {
                        this.logger.error('[INFO-LIST] WebSocket消息解析错误:', parseError);
                    }
                });

                ws.on('error', (error) => {
                    clearTimeout(timeout);
                    resolve({
                        success: false,
                        error: 'WebSocket连接错误: ' + error.message
                    });
                });

                ws.on('close', () => {
                    clearTimeout(timeout);
                });

            } catch (error) {
                clearTimeout(timeout);
                resolve({
                    success: false,
                    error: 'WebSocket连接失败: ' + error.message
                });
            }
        });
    }

    /**
     * 通过WebSocket获取楼层列表
     */
    async getFloorsViaWebSocket(access_token, base_url) {
        return new Promise((resolve, reject) => {
            const url = base_url.replace(/^http/, 'ws') + '/api/websocket';
            let ws;
            let messageId = 1;
            const timeout = setTimeout(() => {
                if (ws) ws.close();
                reject(new Error('WebSocket连接超时'));
            }, 30000);

            try {
                ws = new WebSocket(url);

                ws.on('open', () => {
                    this.logger.info('[INFO-LIST] WebSocket连接已建立，获取楼层列表');
                });

                ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());

                        if (message.type === 'auth_required') {
                            ws.send(JSON.stringify({
                                type: 'auth',
                                access_token: access_token
                            }));
                        } else if (message.type === 'auth_ok') {
                            ws.send(JSON.stringify({
                                id: messageId++,
                                type: 'config/floor_registry/list'
                            }));
                        } else if (message.id && message.type === 'result') {
                            clearTimeout(timeout);
                            ws.close();
                            resolve({
                                success: true,
                                data: { floors: message.result || [] }
                            });
                        } else if (message.type === 'auth_invalid') {
                            clearTimeout(timeout);
                            ws.close();
                            resolve({
                                success: false,
                                error: 'WebSocket认证失败'
                            });
                        }
                    } catch (parseError) {
                        this.logger.error('[INFO-LIST] WebSocket消息解析错误:', parseError);
                    }
                });

                ws.on('error', (error) => {
                    clearTimeout(timeout);
                    resolve({
                        success: false,
                        error: 'WebSocket连接错误: ' + error.message
                    });
                });

                ws.on('close', () => {
                    clearTimeout(timeout);
                });

            } catch (error) {
                clearTimeout(timeout);
                resolve({
                    success: false,
                    error: 'WebSocket连接失败: ' + error.message
                });
            }
        });
    }

    /**
     * 获取综合列表（带缓存）
     */
    async getEnhancedList(roomNames = null, deviceTypes = null) {
        // 尝试从缓存获取
        const cachedResult = this.getCachedEnhancedList(roomNames, deviceTypes);
        if (cachedResult) {
            return cachedResult;
        }

        // 缓存无效，强制更新
        this.logger.warn('[INFO-LIST] 缓存无效，执行强制更新');
        await this.updateEnhancedListCache();

        // 再次尝试从缓存获取
        return this.getCachedEnhancedList(roomNames, deviceTypes) || {
            success: false,
            error: '无法获取综合列表数据'
        };
    }

    /**
     * 获取缓存状态
     */
    getCacheStatus() {
        const cache = this.enhancedListCache;
        const now = Date.now();

        return {
            success: true,
            data: {
                cache_enabled: true,
                has_data: cache.data !== null,
                last_updated: cache.lastUpdated ? new Date(cache.lastUpdated).toISOString() : null,
                age_ms: cache.lastUpdated ? (now - cache.lastUpdated) : null,
                max_age_ms: cache.maxAge,
                is_updating: cache.isUpdating,
                is_expired: cache.lastUpdated ? (now - cache.lastUpdated) > cache.maxAge : true,
                update_interval_ms: cache.updateInterval,
                entity_count: cache.data ? cache.data.length : 0
            }
        };
    }

    /**
     * 获取带有设备信息的完整实体状态列表
     */
    async getEnhancedStates(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            this.logger.info('[INFO-LIST] 获取增强的实体状态列表');

            // 获取所有实体状态
            const statesResult = await this.baseModule.basicInfoModule.getStates(credentials);
            if (!statesResult.success) {
                return { success: false, error: 'Failed to get states: ' + statesResult.error };
            }

            // 获取增强列表来补充设备信息
            const enhancedListResult = await this.getEnhancedList();
            let enhancedMap = new Map();
            if (enhancedListResult.success && enhancedListResult.data && enhancedListResult.data.entities) {
                enhancedListResult.data.entities.forEach(entity => {
                    enhancedMap.set(entity.entity_id, entity);
                });
            }

            // 合并状态信息和设备信息
            const enhancedStates = statesResult.data.states.map(state => {
                const enhancedInfo = enhancedMap.get(state.entity_id) || {};
                return {
                    // 基础状态信息
                    entity_id: state.entity_id,
                    state: state.state,
                    attributes: state.attributes,
                    last_changed: state.last_changed,
                    last_updated: state.last_updated,

                    // 从增强列表获取的设备信息
                    name: enhancedInfo.name || state.entity_id,
                    domain: enhancedInfo.domain || state.entity_id.split('.')[0],
                    device_type: enhancedInfo.device_type || enhancedInfo.domain || state.entity_id.split('.')[0],
                    device_id: enhancedInfo.device_id || null,
                    device_name: enhancedInfo.device_name || null,
                    device_manufacturer: enhancedInfo.device_manufacturer || null,
                    device_model: enhancedInfo.device_model || null,
                    room_id: enhancedInfo.room_id || null,
                    room_name: enhancedInfo.room_name || null,
                    floor_id: enhancedInfo.floor_id || null,
                    floor_name: enhancedInfo.floor_name || null,
                    platform: enhancedInfo.platform || null,
                    disabled: enhancedInfo.disabled || false,
                    hidden: enhancedInfo.hidden || false,
                    entity_category: enhancedInfo.entity_category || null,
                    icon: enhancedInfo.icon || null
                };
            });

            return {
                success: true,
                data: {
                    states: enhancedStates,
                    total_count: enhancedStates.length,
                    retrieved_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[INFO-LIST] 获取增强状态列表失败:', error);
            return {
                success: false,
                error: 'Failed to get enhanced states',
                details: { message: error.message }
            };
        }
    }

    /**
     * 设备匹配 - 根据房间、设备类型、设备名称查找对应的entity_id
     * @param {Array} deviceCommands - 设备命令数组
     * @returns {Object} 匹配结果
     */
    matchDevices(deviceCommands) {
        try {
            if (!Array.isArray(deviceCommands)) {
                return {
                    success: false,
                    error: 'Device commands must be an array'
                };
            }

            if (!this.enhancedListCache.data || !Array.isArray(this.enhancedListCache.data)) {
                return {
                    success: false,
                    error: 'Enhanced list cache not available. Please try again later.'
                };
            }

            this.logger.info(`[INFO-LIST] 开始匹配 ${deviceCommands.length} 个设备命令`);

            const enhancedList = this.enhancedListCache.data;
            const matchedCommands = [];

            for (const command of deviceCommands) {
                const {
                    room_name,
                    device_type,
                    device_name,
                    action,
                    service
                } = command;
                // 兼容：同时支持 service_data 与旧字段 data
                const payloadData = (command && command.service_data !== undefined) ? (command.service_data || {}) : (command.data || {});

                // 验证必需字段
                if (!room_name || !device_type) {
                    matchedCommands.push({
                        ...command,
                        service_data: payloadData,
                        entity_id: null,
                        match_error: 'Missing required fields: room_name and device_type are required'
                    });
                    continue;
                }

                // 查找匹配的实体
                const matchedEntities = enhancedList.filter(entity => {
                    // 房间名称匹配（不区分大小写）
                    const roomMatch = entity.room_name && 
                        entity.room_name.toLowerCase() === room_name.toLowerCase();
                    
                    // 设备类型匹配（不区分大小写）
                    // 支持匹配domain（如sensor, binary_sensor）或device_type（如humidity, motion）
                    const typeMatch = (entity.device_type && 
                        entity.device_type.toLowerCase() === device_type.toLowerCase()) ||
                        (entity.domain && 
                        entity.domain.toLowerCase() === device_type.toLowerCase());

                    return roomMatch && typeMatch;
                });

                if (matchedEntities.length === 0) {
                    // 没有找到匹配的实体
                    matchedCommands.push({
                        ...command,
                        entity_id: null,
                        match_error: `No entities found for room: ${room_name}, device_type: ${device_type}`
                    });
                } else if (matchedEntities.length === 1) {
                    // 找到唯一匹配，判断匹配类型
                    let matchType = 'single_match';
                    if (device_name) {
                        const entity = matchedEntities[0];
                        const deviceNameMatch = entity.device_name && 
                            entity.device_name.toLowerCase() === device_name.toLowerCase();
                        const entityNameMatch = entity.name && 
                            entity.name.toLowerCase() === device_name.toLowerCase();
                        
                        if (deviceNameMatch && entityNameMatch) {
                            matchType = 'exact_device_and_entity_name_match';
                        } else if (deviceNameMatch) {
                            matchType = 'exact_device_name_match';
                        } else if (entityNameMatch) {
                            matchType = 'exact_entity_name_match';
                        } else {
                            matchType = 'single_match_no_name_match';
                        }
                    }
                    
                    matchedCommands.push({
                        ...command,
                        service_data: payloadData,
                        entity_id: matchedEntities[0].entity_id,
                        matched_entities: [{
                            entity_id: matchedEntities[0].entity_id,
                            name: matchedEntities[0].name,
                            device_name: matchedEntities[0].device_name,
                            room_name: matchedEntities[0].room_name,
                            device_type: matchedEntities[0].device_type
                        }],
                        match_type: matchType,
                        total_matched: 1
                    });
                } else {
                    // 找到多个匹配，需要进一步筛选
                    let selectedEntities = [];
                    let matchType = '';

                    if (device_name) {
                        // 如果指定了设备名称，优先匹配设备名称和entity名称
                        const nameMatch = matchedEntities.find(entity => {
                            // 匹配设备名称
                            const deviceNameMatch = entity.device_name && 
                                entity.device_name.toLowerCase() === device_name.toLowerCase();
                            
                            // 匹配entity名称
                            const entityNameMatch = entity.name && 
                                entity.name.toLowerCase() === device_name.toLowerCase();
                            
                            return deviceNameMatch || entityNameMatch;
                        });
                        
                        if (nameMatch) {
                            selectedEntities = [nameMatch];
                            // 判断匹配类型
                            const deviceNameMatch = nameMatch.device_name && 
                                nameMatch.device_name.toLowerCase() === device_name.toLowerCase();
                            const entityNameMatch = nameMatch.name && 
                                nameMatch.name.toLowerCase() === device_name.toLowerCase();
                            
                            if (deviceNameMatch && entityNameMatch) {
                                matchType = 'exact_device_and_entity_name_match';
                            } else if (deviceNameMatch) {
                                matchType = 'exact_device_name_match';
                            } else {
                                matchType = 'exact_entity_name_match';
                            }
                        } else {
                            // 没有找到设备名称或entity名称匹配，返回该房间下该类型的所有entities
                            selectedEntities = matchedEntities;
                            matchType = 'all_entities_no_name_match';
                        }
                    } else {
                        // 没有指定设备名称，返回该房间下该类型的所有entities
                        selectedEntities = matchedEntities;
                        matchType = 'all_entities_no_name_specified';
                    }

                    // 构建匹配结果
                    const matchedResult = {
                        ...command,
                        service_data: payloadData,
                        entity_id: selectedEntities.length === 1 ? selectedEntities[0].entity_id : null,
                        matched_entities: selectedEntities.map(entity => ({
                            entity_id: entity.entity_id,
                            name: entity.name,
                            device_name: entity.device_name,
                            room_name: entity.room_name,
                            device_type: entity.device_type
                        })),
                        match_type: matchType,
                        total_matched: selectedEntities.length
                    };

                    if (selectedEntities.length > 1) {
                        matchedResult.match_warning = `Found ${selectedEntities.length} entities for room: ${room_name}, device_type: ${device_type}${device_name ? `, device_name: ${device_name}` : ''}`;
                    }

                    matchedCommands.push(matchedResult);
                }
            }

            const successCount = matchedCommands.filter(cmd => cmd.matched_entities && cmd.matched_entities.length > 0).length;
            const errorCount = matchedCommands.filter(cmd => !cmd.matched_entities || cmd.matched_entities.length === 0).length;

            this.logger.info(`[INFO-LIST] 设备匹配完成: ${successCount} 成功, ${errorCount} 失败`);

            return {
                success: true,
                data: {
                    commands: matchedCommands,
                    summary: {
                        total: deviceCommands.length,
                        matched: successCount,
                        failed: errorCount,
                        success_rate: `${Math.round((successCount / deviceCommands.length) * 100)}%`
                    },
                    matched_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[INFO-LIST] 设备匹配失败:', error);
            return {
                success: false,
                error: 'Device matching failed',
                details: error.message
            };
        }
    }

    /**
     * 清理资源
     */
    cleanup() {
        this.stopEnhancedListCacheUpdater();
        this.enhancedListCache.data = null;
        this.logger.info('[INFO-LIST] 信息列表模块已清理');
    }
}

module.exports = InfoListModule;
