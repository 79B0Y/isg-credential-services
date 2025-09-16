const BaseCredentialModule = require('../../core/BaseCredentialModule');
const InfoListModule = require('./InfoListModule');
const BasicInfoModule = require('./BasicInfoModule');
const DeviceControlModule = require('./DeviceControlModule');

/**
 * Home_assistantModule - 重构后的Home Assistant API凭据管理模块
 * 使用模块化设计，分为三个子模块：信息列表、基础信息、设备控制
 */
class Home_assistantModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);

        // Home Assistant API配置
        this.defaultTimeout = 10000;

        // 初始化子模块
        this.infoListModule = null;
        this.basicInfoModule = null;
        this.deviceControlModule = null;
    }

    /**
     * 模块特定初始化
     */
    async onInitialize() {
        this.logger.info('Home Assistant module initializing with modular architecture...');

        if (!this.config.timeout) {
            this.config.timeout = this.defaultTimeout;
        }

        // 初始化子模块
        this.infoListModule = new InfoListModule(this.logger, this);
        this.basicInfoModule = new BasicInfoModule(this.logger, this);
        this.deviceControlModule = new DeviceControlModule(this.logger, this);

        // 启动信息列表缓存更新器
        this.infoListModule.startEnhancedListCacheUpdater();

        this.logger.info('Home Assistant module initialized with modular architecture');
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

            // 使用基础信息模块进行连接测试
            const testResult = await this.basicInfoModule.testConnection(credentials);

            if (!testResult.success) {
                return {
                    success: false,
                    error: testResult.error,
                    details: testResult.details
                };
            }

            return {
                success: true,
                message: 'Home Assistant API credentials are valid',
                data: testResult.data
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
     * 测试连接
     */
    async testConnection(credentials = null) {
        return await this.basicInfoModule.testConnection(credentials);
    }

    // ========== 信息列表相关方法 ==========

    /**
     * 获取综合列表（增强的实体列表，包含设备、房间、楼层信息）
     */
    async getEnhancedList(roomNames = null, deviceTypes = null, credentials = null) {
        return await this.infoListModule.getEnhancedList(roomNames, deviceTypes);
    }

    /**
     * 获取实体注册表
     */
    async getEntityRegistry(credentials = null) {
        const creds = credentials || (await this.getCredentials()).data;
        return await this.infoListModule.getEntityRegistryViaWebSocket(creds.access_token, creds.base_url);
    }

    /**
     * 获取设备列表
     */
    async getDevices(credentials = null) {
        const creds = credentials || (await this.getCredentials()).data;
        return await this.infoListModule.getDevicesViaWebSocket(creds.access_token, creds.base_url);
    }

    /**
     * 获取房间列表
     */
    async getRooms(credentials = null) {
        const creds = credentials || (await this.getCredentials()).data;
        return await this.infoListModule.getRoomsViaWebSocket(creds.access_token, creds.base_url);
    }

    /**
     * 获取楼层列表
     */
    async getFloors(credentials = null) {
        const creds = credentials || (await this.getCredentials()).data;
        return await this.infoListModule.getFloorsViaWebSocket(creds.access_token, creds.base_url);
    }

    /**
     * 获取缓存状态
     */
    getCacheStatus() {
        return this.infoListModule.getCacheStatus();
    }

    /**
     * 设备匹配 - 根据房间、设备类型、设备名称查找对应的entity_id
     */
    matchDevices(deviceCommands) {
        return this.infoListModule.matchDevices(deviceCommands);
    }

    /**
     * 清除缓存
     */
    clearCache() {
        this.infoListModule.enhancedListCache.data = null;
        this.infoListModule.enhancedListCache.lastUpdated = null;
        return {
            success: true,
            message: 'Cache cleared successfully'
        };
    }

    // ========== 基础信息相关方法 ==========

    /**
     * 获取Home Assistant配置信息
     */
    async getConfig(credentials = null) {
        return await this.basicInfoModule.getConfig(credentials);
    }

    /**
     * 获取Access Token信息
     */
    async getTokenInfo(credentials = null) {
        return await this.basicInfoModule.getTokenInfo(credentials);
    }

    /**
     * 获取所有实体状态
     */
    async getStates(credentials = null) {
        return await this.basicInfoModule.getStates(credentials);
    }

    /**
     * 根据实体ID获取特定实体状态
     */
    async getEntityStates(entityIds, credentials = null) {
        return await this.basicInfoModule.getEntityStates(entityIds, credentials);
    }

    /**
     * 获取系统概览信息
     */
    async getSystemOverview(credentials = null) {
        return await this.basicInfoModule.getSystemOverview(credentials);
    }

    // ========== 设备控制相关方法 ==========

    /**
     * 批量控制设备
     * 输入格式：[{"entity_id":"xxx","service":"turn_on","data":{"color_name":"red","brightness_pct":80}}]
     */
    async batchControlDevices(controlCommands, credentials = null) {
        return await this.deviceControlModule.batchControlDevices(controlCommands, credentials);
    }

    /**
     * 单个设备控制
     */
    async controlSingleDevice(entityId, service, data = {}, credentials = null) {
        return await this.deviceControlModule.controlSingleDevice(entityId, service, data, credentials);
    }

    /**
     * 开启设备
     */
    async turnOn(entityId, options = {}, credentials = null) {
        return await this.deviceControlModule.turnOn(entityId, options, credentials);
    }

    /**
     * 关闭设备
     */
    async turnOff(entityId, credentials = null) {
        return await this.deviceControlModule.turnOff(entityId, credentials);
    }

    /**
     * 设置亮度
     */
    async setBrightness(entityId, brightnessPct, credentials = null) {
        return await this.deviceControlModule.setBrightness(entityId, brightnessPct, credentials);
    }

    /**
     * 设置颜色
     */
    async setColor(entityId, colorName, credentials = null) {
        return await this.deviceControlModule.setColor(entityId, colorName, credentials);
    }

    /**
     * 设置RGB颜色
     */
    async setRGBColor(entityId, rgb, credentials = null) {
        return await this.deviceControlModule.setRGBColor(entityId, rgb, credentials);
    }

    /**
     * 设置温度
     */
    async setTemperature(entityId, temperature, credentials = null) {
        return await this.deviceControlModule.setTemperature(entityId, temperature, credentials);
    }

    /**
     * 开启窗帘/百叶窗
     */
    async openCover(entityId, credentials = null) {
        return await this.deviceControlModule.openCover(entityId, credentials);
    }

    /**
     * 关闭窗帘/百叶窗
     */
    async closeCover(entityId, credentials = null) {
        return await this.deviceControlModule.closeCover(entityId, credentials);
    }

    /**
     * 设置窗帘/百叶窗位置
     */
    async setCoverPosition(entityId, position, credentials = null) {
        return await this.deviceControlModule.setCoverPosition(entityId, position, credentials);
    }

    /**
     * 设置风扇速度
     */
    async setFanSpeed(entityId, speed, credentials = null) {
        return await this.deviceControlModule.setFanSpeed(entityId, speed, credentials);
    }

    /**
     * 播放媒体
     */
    async playMedia(entityId, mediaContentId, mediaContentType, credentials = null) {
        return await this.deviceControlModule.playMedia(entityId, mediaContentId, mediaContentType, credentials);
    }

    /**
     * 获取支持的服务列表
     */
    async getSupportedServices(credentials = null) {
        return await this.deviceControlModule.getSupportedServices(credentials);
    }

    /**
     * 获取控制命令示例
     */
    getControlExamples() {
        return this.deviceControlModule.getControlExamples();
    }

    /**
     * 获取带有设备信息的完整实体状态列表
     */
    async getEnhancedStatesList(credentials = null) {
        return await this.infoListModule.getEnhancedStates(credentials);
    }

    // ========== 兼容性方法（保持向后兼容） ==========

    /**
     * 获取增强状态数据（兼容原有接口）
     */
    async getEnhancedStates(credentials = null, areaNames = null, deviceTypes = null) {
        return await this.getEnhancedList(areaNames, deviceTypes, credentials);
    }

    /**
     * 搜索设备（基于综合列表）
     */
    async searchDevices(filters = {}, credentials = null) {
        try {
            const enhancedListResult = await this.getEnhancedList(null, null, credentials);
            if (!enhancedListResult.success) {
                return enhancedListResult;
            }

            let filteredDevices = enhancedListResult.data.entities;

            // 应用过滤器
            if (filters.name) {
                const nameFilter = filters.name.toLowerCase();
                filteredDevices = filteredDevices.filter(entity =>
                    entity.name.toLowerCase().includes(nameFilter) ||
                    entity.entity_id.toLowerCase().includes(nameFilter)
                );
            }

            if (filters.domain) {
                filteredDevices = filteredDevices.filter(entity =>
                    entity.domain === filters.domain
                );
            }

            if (filters.room_name) {
                filteredDevices = filteredDevices.filter(entity =>
                    entity.room_name === filters.room_name
                );
            }

            if (filters.floor_name) {
                filteredDevices = filteredDevices.filter(entity =>
                    entity.floor_name === filters.floor_name
                );
            }

            return {
                success: true,
                data: {
                    devices: filteredDevices,
                    total_count: filteredDevices.length,
                    filters_applied: filters,
                    searched_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('搜索设备失败:', error);
            return {
                success: false,
                error: 'Failed to search devices',
                details: { message: error.message }
            };
        }
    }

    /**
     * 模块清理
     */
    async cleanup() {
        if (this.infoListModule) {
            this.infoListModule.cleanup();
        }
        this.logger.info('Home Assistant module cleanup completed');
    }

    /**
     * 获取模块信息
     */
    getModuleInfo() {
        return {
            success: true,
            data: {
                module_name: 'Home Assistant Integration',
                version: '2.0.0',
                architecture: 'Modular',
                sub_modules: {
                    info_list: {
                        description: '信息列表管理：实体、设备、房间、楼层列表及综合列表缓存',
                        cache_enabled: true,
                        cache_interval: '1分钟'
                    },
                    basic_info: {
                        description: '基础信息管理：配置信息、Token信息、实体状态',
                        features: ['config', 'token_info', 'states', 'system_overview']
                    },
                    device_control: {
                        description: '设备控制：支持JSON数组格式的批量设备控制',
                        supported_formats: ['batch_control', 'single_control', 'convenience_methods']
                    }
                },
                features: {
                    websocket_support: true,
                    caching: true,
                    batch_control: true,
                    backward_compatibility: true
                }
            }
        };
    }
}

module.exports = Home_assistantModule;