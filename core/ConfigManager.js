const fs = require('fs').promises;
const path = require('path');

/**
 * ConfigManager - 统一配置管理器
 * 处理全局配置、环境变量、模块配置和热重载
 */
class ConfigManager {
    constructor(configDir = './config') {
        this.configDir = path.resolve(configDir);
        this.configs = new Map();
        this.watchers = new Map();
        this.subscribers = new Map();
        
        // 配置文件路径
        this.globalConfigPath = path.join(this.configDir, 'global.json');
        this.envConfigPath = path.join(this.configDir, 'environment.json');
        
        // 默认配置
        this.defaultConfig = this.getDefaultConfig();
        
        // 日志系统
        this.logger = this.createLogger();
        
        // 初始化标志
        this.initialized = false;
    }

    /**
     * 初始化配置管理器
     */
    async initialize() {
        try {
            this.logger.info('Initializing ConfigManager...');
            
            // 创建配置目录
            await fs.mkdir(this.configDir, { recursive: true });
            
            // 加载全局配置
            await this.loadGlobalConfig();
            
            // 加载环境配置
            await this.loadEnvironmentConfig();
            
            // 合并配置
            this.mergeConfigs();
            
            // 设置文件监听（用于热重载）
            await this.setupFileWatchers();
            
            this.initialized = true;
            this.logger.info('ConfigManager initialized successfully');
            
            return { success: true, message: 'ConfigManager initialized' };
        } catch (error) {
            this.logger.error('Failed to initialize ConfigManager:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 加载全局配置
     */
    async loadGlobalConfig() {
        try {
            const data = await fs.readFile(this.globalConfigPath, 'utf8');
            const config = JSON.parse(data);
            this.configs.set('global', config);
            this.logger.info('Global configuration loaded');
        } catch (error) {
            if (error.code === 'ENOENT') {
                // 创建默认全局配置
                const defaultGlobal = this.defaultConfig.global;
                await this.saveConfig('global', defaultGlobal);
                this.configs.set('global', defaultGlobal);
                this.logger.info('Created default global configuration');
            } else {
                this.logger.error('Failed to load global config:', error);
                throw error;
            }
        }
    }

    /**
     * 加载环境配置
     */
    async loadEnvironmentConfig() {
        try {
            const data = await fs.readFile(this.envConfigPath, 'utf8');
            const config = JSON.parse(data);
            this.configs.set('environment', config);
            this.logger.info('Environment configuration loaded');
        } catch (error) {
            if (error.code === 'ENOENT') {
                // 创建默认环境配置
                const defaultEnv = this.defaultConfig.environment;
                await this.saveConfig('environment', defaultEnv);
                this.configs.set('environment', defaultEnv);
                this.logger.info('Created default environment configuration');
            } else {
                this.logger.error('Failed to load environment config:', error);
                throw error;
            }
        }
    }

    /**
     * 合并所有配置
     */
    mergeConfigs() {
        // 基础配置优先级：默认 < 全局 < 环境变量 < 环境配置
        let mergedConfig = { ...this.defaultConfig.global };
        
        // 合并全局配置
        const globalConfig = this.configs.get('global') || {};
        mergedConfig = { ...mergedConfig, ...globalConfig };
        
        // 合并环境配置
        const envConfig = this.configs.get('environment') || {};
        const currentEnv = process.env.NODE_ENV || 'development';
        if (envConfig[currentEnv]) {
            mergedConfig = { ...mergedConfig, ...envConfig[currentEnv] };
        }
        
        // 合并环境变量
        const envOverrides = this.getEnvironmentVariableOverrides();
        mergedConfig = { ...mergedConfig, ...envOverrides };
        
        this.configs.set('merged', mergedConfig);
        this.logger.info(`Configuration merged for environment: ${currentEnv}`);
    }

    /**
     * 获取环境变量覆盖配置
     */
    getEnvironmentVariableOverrides() {
        const overrides = {};
        const prefix = 'CRED_SERVICE_';
        
        for (const [key, value] of Object.entries(process.env)) {
            if (key.startsWith(prefix)) {
                const configKey = key.slice(prefix.length).toLowerCase();
                const configPath = configKey.split('_');
                
                // 转换环境变量值
                let configValue = value;
                if (value.toLowerCase() === 'true') configValue = true;
                else if (value.toLowerCase() === 'false') configValue = false;
                else if (!isNaN(value)) configValue = Number(value);
                
                // 设置嵌套配置
                this.setNestedConfig(overrides, configPath, configValue);
            }
        }
        
        return overrides;
    }

    /**
     * 设置嵌套配置值
     */
    setNestedConfig(obj, path, value) {
        let current = obj;
        for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            if (!current[key]) current[key] = {};
            current = current[key];
        }
        current[path[path.length - 1]] = value;
    }

    /**
     * 获取配置值
     */
    get(key, defaultValue = null) {
        const mergedConfig = this.configs.get('merged') || {};
        return this.getNestedValue(mergedConfig, key) ?? defaultValue;
    }

    /**
     * 获取嵌套配置值
     */
    getNestedValue(obj, key) {
        if (typeof key === 'string') {
            const path = key.split('.');
            let current = obj;
            for (const segment of path) {
                if (current && typeof current === 'object' && segment in current) {
                    current = current[segment];
                } else {
                    return undefined;
                }
            }
            return current;
        }
        return obj[key];
    }

    /**
     * 设置配置值
     */
    async set(key, value, configType = 'global') {
        try {
            const config = this.configs.get(configType) || {};
            
            if (typeof key === 'string' && key.includes('.')) {
                const path = key.split('.');
                this.setNestedConfig(config, path, value);
            } else {
                config[key] = value;
            }
            
            this.configs.set(configType, config);
            
            // 保存到文件
            await this.saveConfig(configType, config);
            
            // 重新合并配置
            this.mergeConfigs();
            
            // 通知订阅者
            await this.notifySubscribers('config.changed', { key, value, configType });
            
            this.logger.info(`Configuration updated: ${key} in ${configType}`);
            return { success: true, message: 'Configuration updated' };
        } catch (error) {
            this.logger.error(`Failed to set configuration ${key}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 保存配置到文件
     */
    async saveConfig(configType, config) {
        let filePath;
        switch (configType) {
            case 'global':
                filePath = this.globalConfigPath;
                break;
            case 'environment':
                filePath = this.envConfigPath;
                break;
            default:
                throw new Error(`Unknown config type: ${configType}`);
        }
        
        await fs.writeFile(filePath, JSON.stringify(config, null, 2));
    }

    /**
     * 获取所有配置
     */
    getAll() {
        return {
            merged: this.configs.get('merged') || {},
            global: this.configs.get('global') || {},
            environment: this.configs.get('environment') || {},
            defaults: this.defaultConfig
        };
    }

    /**
     * 重载配置
     */
    async reload() {
        try {
            this.logger.info('Reloading configuration...');
            
            // 重新加载配置文件
            await this.loadGlobalConfig();
            await this.loadEnvironmentConfig();
            
            // 重新合并配置
            this.mergeConfigs();
            
            // 通知订阅者
            await this.notifySubscribers('config.reloaded');
            
            this.logger.info('Configuration reloaded successfully');
            return { success: true, message: 'Configuration reloaded' };
        } catch (error) {
            this.logger.error('Failed to reload configuration:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 订阅配置更改事件
     */
    subscribe(event, callback) {
        if (!this.subscribers.has(event)) {
            this.subscribers.set(event, new Set());
        }
        this.subscribers.get(event).add(callback);
        
        return () => {
            const callbacks = this.subscribers.get(event);
            if (callbacks) {
                callbacks.delete(callback);
            }
        };
    }

    /**
     * 通知订阅者
     */
    async notifySubscribers(event, data = null) {
        const callbacks = this.subscribers.get(event);
        if (callbacks) {
            const notifications = Array.from(callbacks).map(callback => {
                try {
                    return callback(data);
                } catch (error) {
                    this.logger.error(`Subscriber callback error for ${event}:`, error);
                    return Promise.resolve();
                }
            });
            
            await Promise.allSettled(notifications);
        }
    }

    /**
     * 设置文件监听
     */
    async setupFileWatchers() {
        if (!fs.watch) {
            this.logger.warn('File watching not supported in this environment');
            return;
        }
        
        const filesToWatch = [
            { path: this.globalConfigPath, type: 'global' },
            { path: this.envConfigPath, type: 'environment' }
        ];
        
        for (const { path: filePath, type } of filesToWatch) {
            try {
                const watcher = fs.watch(filePath, async (eventType) => {
                    if (eventType === 'change') {
                        this.logger.info(`Configuration file changed: ${filePath}`);
                        await this.debounce(`reload_${type}`, () => this.reload(), 1000);
                    }
                });
                
                this.watchers.set(type, watcher);
            } catch (error) {
                this.logger.warn(`Could not watch file ${filePath}:`, error.message);
            }
        }
    }

    /**
     * 防抖动执行
     */
    debounce(key, func, delay) {
        if (this.debounceTimers && this.debounceTimers[key]) {
            clearTimeout(this.debounceTimers[key]);
        }
        
        if (!this.debounceTimers) {
            this.debounceTimers = {};
        }
        
        this.debounceTimers[key] = setTimeout(() => {
            func();
            delete this.debounceTimers[key];
        }, delay);
    }

    /**
     * 验证配置
     */
    validateConfig(config) {
        const errors = [];
        
        // 检查必需的配置项
        const requiredFields = ['server.port', 'api.key'];
        for (const field of requiredFields) {
            if (this.getNestedValue(config, field) === undefined) {
                errors.push(`Missing required configuration: ${field}`);
            }
        }
        
        // 检查端口范围
        const port = this.getNestedValue(config, 'server.port');
        if (port && (port < 1 || port > 65535)) {
            errors.push('Server port must be between 1 and 65535');
        }
        
        // 检查API密钥长度
        const apiKey = this.getNestedValue(config, 'api.key');
        if (apiKey && apiKey.length < 16) {
            errors.push('API key must be at least 16 characters long');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * 获取配置状态
     */
    getStatus() {
        return {
            initialized: this.initialized,
            configTypes: Array.from(this.configs.keys()),
            watchers: Array.from(this.watchers.keys()),
            subscribers: Object.fromEntries(
                Array.from(this.subscribers.entries()).map(([event, callbacks]) => [
                    event,
                    callbacks.size
                ])
            ),
            currentEnvironment: process.env.NODE_ENV || 'development',
            configFiles: {
                global: this.globalConfigPath,
                environment: this.envConfigPath
            }
        };
    }

    /**
     * 清理资源
     */
    async cleanup() {
        // 关闭文件监听器
        for (const watcher of this.watchers.values()) {
            try {
                watcher.close();
            } catch (error) {
                this.logger.warn('Error closing file watcher:', error);
            }
        }
        this.watchers.clear();
        
        // 清空订阅者
        this.subscribers.clear();
        
        // 清空防抖定时器
        if (this.debounceTimers) {
            for (const timer of Object.values(this.debounceTimers)) {
                clearTimeout(timer);
            }
            this.debounceTimers = {};
        }
        
        this.logger.info('ConfigManager cleaned up');
    }

    /**
     * 获取默认配置
     */
    getDefaultConfig() {
        return {
            global: {
                server: {
                    port: 3000,
                    host: '0.0.0.0',
                    timeout: 30000,
                    cors: {
                        enabled: true,
                        origin: '*'
                    }
                },
                api: {
                    key: this.generateDefaultApiKey(),
                    rateLimit: {
                        enabled: true,
                        windowMs: 15 * 60 * 1000, // 15分钟
                        max: 100
                    }
                },
                modules: {
                    autoLoad: true,
                    hotReload: true,
                    isolation: true
                },
                cache: {
                    enabled: true,
                    ttl: 300000, // 5分钟
                    maxSize: 1000
                },
                logging: {
                    level: 'info',
                    file: {
                        enabled: true,
                        path: './logs/app.log',
                        maxSize: '10m',
                        maxFiles: 5
                    }
                },
                security: {
                    encryption: {
                        enabled: true,
                        algorithm: 'aes-256-cbc'
                    },
                    https: {
                        enabled: false,
                        cert: './certs/cert.pem',
                        key: './certs/key.pem'
                    }
                }
            },
            environment: {
                development: {
                    logging: { level: 'debug' },
                    api: { rateLimit: { enabled: false } }
                },
                production: {
                    logging: { level: 'warn' },
                    security: { https: { enabled: true } }
                },
                test: {
                    server: { port: 0 },
                    logging: { level: 'error' },
                    cache: { enabled: false }
                }
            }
        };
    }

    /**
     * 生成默认API密钥
     */
    generateDefaultApiKey() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = 'cred_';
        for (let i = 0; i < 32; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    /**
     * 创建日志器
     */
    createLogger() {
        return {
            info: (message, ...args) => {
                console.log(`[INFO][ConfigManager] ${message}`, ...args);
            },
            warn: (message, ...args) => {
                console.warn(`[WARN][ConfigManager] ${message}`, ...args);
            },
            error: (message, ...args) => {
                console.error(`[ERROR][ConfigManager] ${message}`, ...args);
            }
        };
    }
}

module.exports = ConfigManager;