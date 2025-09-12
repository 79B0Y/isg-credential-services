const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * BaseCredentialModule - 凭据模块的基类
 * 提供标准化的模块接口、数据存储、缓存管理和安全功能
 */
class BaseCredentialModule {
    constructor(name, moduleDir) {
        this.name = name;
        this.moduleDir = moduleDir;
        this.dataDir = path.join(process.cwd(), 'data', name);
        this.configPath = path.join(moduleDir, 'config.json');
        this.schemaPath = path.join(moduleDir, 'schema.json');
        
        // 模块状态
        this.enabled = false;
        this.initialized = false;
        this.lastValidated = null;
        this.validationCache = new Map();
        this.config = {};
        this.schema = {};
        
        // 日志系统
        this.logger = this.createLogger();
        
        // 加密密钥（用于敏感数据）
        this.encryptionKey = this.getOrCreateEncryptionKey();
    }

    /**
     * 初始化模块
     * 创建数据目录、加载配置和schema
     */
    async initialize() {
        try {
            // 创建数据目录
            await fs.mkdir(this.dataDir, { recursive: true });
            
            // 加载配置文件
            await this.loadConfig();
            
            // 加载凭据schema
            await this.loadSchema();
            
            // 执行模块特定的初始化
            await this.onInitialize();
            
            this.initialized = true;
            this.logger.info(`Module ${this.name} initialized successfully`);
            
            return { success: true, message: 'Module initialized' };
        } catch (error) {
            this.logger.error(`Failed to initialize module ${this.name}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 加载模块配置
     */
    async loadConfig() {
        try {
            const configData = await fs.readFile(this.configPath, 'utf8');
            this.config = JSON.parse(configData);
        } catch (error) {
            // 使用默认配置
            this.config = this.getDefaultConfig();
            this.logger.warn(`Config file not found for ${this.name}, using defaults`);
        }
    }

    /**
     * 加载凭据schema
     */
    async loadSchema() {
        try {
            const schemaData = await fs.readFile(this.schemaPath, 'utf8');
            this.schema = JSON.parse(schemaData);
        } catch (error) {
            this.schema = this.getDefaultSchema();
            this.logger.warn(`Schema file not found for ${this.name}, using defaults`);
        }
    }

    /**
     * 获取凭据配置
     */
    async getCredentials() {
        try {
            const credentialsPath = path.join(this.dataDir, 'credentials.json');
            const data = await fs.readFile(credentialsPath, 'utf8');
            const encryptedCredentials = JSON.parse(data);
            
            // 解密敏感数据
            const credentials = this.decryptCredentials(encryptedCredentials);
            return { success: true, data: credentials };
        } catch (error) {
            if (error.code === 'ENOENT') {
                return { success: true, data: {} };
            }
            this.logger.error(`Failed to get credentials for ${this.name}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 保存凭据配置
     */
    async setCredentials(credentials) {
        try {
            // 验证凭据格式
            const validation = this.validateCredentialsFormat(credentials);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }

            // 加密敏感数据
            const encryptedCredentials = this.encryptCredentials(credentials);
            
            const credentialsPath = path.join(this.dataDir, 'credentials.json');
            await fs.writeFile(credentialsPath, JSON.stringify(encryptedCredentials, null, 2));
            
            // 清除验证缓存
            this.validationCache.clear();
            
            this.logger.info(`Credentials updated for ${this.name}`);
            return { success: true, message: 'Credentials saved' };
        } catch (error) {
            this.logger.error(`Failed to set credentials for ${this.name}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 验证凭据有效性
     */
    async validateCredentials(credentials = null, useCache = true) {
        try {
            // 如果没有提供凭据，从存储中读取
            if (!credentials) {
                const result = await this.getCredentials();
                if (!result.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = result.data;
            }

            // 检查缓存
            const cacheKey = this.generateCacheKey(credentials);
            if (useCache && this.validationCache.has(cacheKey)) {
                const cached = this.validationCache.get(cacheKey);
                const cacheAge = Date.now() - cached.timestamp;
                if (cacheAge < (this.config.cacheTimeout || 300000)) { // 默认5分钟缓存
                    return cached.result;
                }
            }

            // 执行实际验证
            const validationResult = await this.performValidation(credentials);
            
            // 更新缓存
            if (useCache) {
                this.validationCache.set(cacheKey, {
                    result: validationResult,
                    timestamp: Date.now()
                });
            }

            // 更新最后验证时间
            if (validationResult.success) {
                this.lastValidated = new Date().toISOString();
            }

            return validationResult;
        } catch (error) {
            this.logger.error(`Validation failed for ${this.name}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取模块状态信息
     */
    getStatus() {
        return {
            name: this.name,
            enabled: this.enabled,
            initialized: this.initialized,
            lastValidated: this.lastValidated,
            cacheSize: this.validationCache.size,
            hasCredentials: this.hasCredentials(),
            config: {
                ...this.config,
                // 隐藏敏感配置
                apiKey: this.config.apiKey ? '[REDACTED]' : undefined
            }
        };
    }

    /**
     * 启用模块
     */
    async enable() {
        if (!this.initialized) {
            const result = await this.initialize();
            if (!result.success) return result;
        }
        
        this.enabled = true;
        this.logger.info(`Module ${this.name} enabled`);
        return { success: true, message: 'Module enabled' };
    }

    /**
     * 禁用模块
     */
    async disable() {
        this.enabled = false;
        this.validationCache.clear();
        await this.onDisable();
        this.logger.info(`Module ${this.name} disabled`);
        return { success: true, message: 'Module disabled' };
    }

    /**
     * 重载模块
     */
    async reload() {
        await this.disable();
        this.initialized = false;
        return await this.initialize();
    }

    /**
     * 清除缓存
     */
    clearCache() {
        this.validationCache.clear();
        this.logger.info(`Cache cleared for ${this.name}`);
        return { success: true, message: 'Cache cleared' };
    }

    /**
     * 获取凭据schema
     */
    getCredentialSchema() {
        return this.schema;
    }

    // =================
    // 需要子类实现的方法
    // =================

    /**
     * 执行实际的凭据验证（子类必须实现）
     */
    async performValidation(credentials) {
        throw new Error(`performValidation method must be implemented by ${this.name} module`);
    }

    /**
     * 模块特定的初始化逻辑（子类可选实现）
     */
    async onInitialize() {
        // 子类可以重写此方法
    }

    /**
     * 模块禁用时的清理逻辑（子类可选实现）
     */
    async onDisable() {
        // 子类可以重写此方法
    }

    /**
     * 获取默认配置（子类可选实现）
     */
    getDefaultConfig() {
        return {
            timeout: 10000,
            retries: 3,
            cacheTimeout: 300000
        };
    }

    /**
     * 获取默认schema（子类必须实现）
     */
    getDefaultSchema() {
        throw new Error(`getDefaultSchema method must be implemented by ${this.name} module`);
    }

    // =================
    // 私有辅助方法
    // =================

    /**
     * 创建日志器
     */
    createLogger() {
        return {
            info: (message, ...args) => {
                console.log(`[INFO][${this.name}] ${message}`, ...args);
            },
            warn: (message, ...args) => {
                console.warn(`[WARN][${this.name}] ${message}`, ...args);
            },
            error: (message, ...args) => {
                console.error(`[ERROR][${this.name}] ${message}`, ...args);
            }
        };
    }

    /**
     * 获取或创建加密密钥
     */
    getOrCreateEncryptionKey() {
        const keyPath = path.join(this.dataDir, '.key');
        try {
            return require('fs').readFileSync(keyPath);
        } catch {
            const key = crypto.randomBytes(32);
            try {
                require('fs').writeFileSync(keyPath, key);
            } catch (error) {
                this.logger.warn('Could not save encryption key, using in-memory key');
            }
            return key;
        }
    }

    /**
     * 加密凭据中的敏感数据
     */
    encryptCredentials(credentials) {
        const encrypted = { ...credentials };
        const sensitiveFields = this.getSensitiveFields();
        
        for (const field of sensitiveFields) {
            if (credentials[field]) {
                encrypted[field] = this.encrypt(credentials[field]);
            }
        }
        
        return encrypted;
    }

    /**
     * 解密凭据中的敏感数据
     */
    decryptCredentials(encryptedCredentials) {
        const decrypted = { ...encryptedCredentials };
        const sensitiveFields = this.getSensitiveFields();
        
        for (const field of sensitiveFields) {
            if (encryptedCredentials[field]) {
                try {
                    decrypted[field] = this.decrypt(encryptedCredentials[field]);
                } catch (error) {
                    this.logger.error(`Failed to decrypt field ${field}:`, error);
                }
            }
        }
        
        return decrypted;
    }

    /**
     * 获取敏感字段列表
     */
    getSensitiveFields() {
        const sensitiveFields = [];
        if (this.schema.properties) {
            for (const [field, definition] of Object.entries(this.schema.properties)) {
                if (definition.sensitive === true) {
                    sensitiveFields.push(field);
                }
            }
        }
        return sensitiveFields;
    }

    /**
     * 加密文本
     */
    encrypt(text) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    }

    /**
     * 解密文本
     */
    decrypt(encryptedText) {
        const parts = encryptedText.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        
        const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    /**
     * 生成缓存键
     */
    generateCacheKey(credentials) {
        return crypto.createHash('sha256')
            .update(JSON.stringify(credentials))
            .digest('hex');
    }

    /**
     * 验证凭据格式
     */
    validateCredentialsFormat(credentials) {
        if (!this.schema.properties) {
            return { valid: true };
        }

        // 简单的schema验证
        for (const [field, definition] of Object.entries(this.schema.properties)) {
            const value = credentials[field];
            
            if (definition.required && (!value || value.trim() === '')) {
                return { valid: false, error: `Field ${field} is required` };
            }
            
            if (value && definition.minLength && value.length < definition.minLength) {
                return { valid: false, error: `Field ${field} is too short` };
            }
            
            if (value && definition.maxLength && value.length > definition.maxLength) {
                return { valid: false, error: `Field ${field} is too long` };
            }
            
            if (value && definition.pattern) {
                const regex = new RegExp(definition.pattern);
                if (!regex.test(value)) {
                    return { valid: false, error: `Field ${field} format is invalid` };
                }
            }
        }
        
        return { valid: true };
    }

    /**
     * 检查是否有凭据
     */
    async hasCredentials() {
        try {
            const credentialsPath = path.join(this.dataDir, 'credentials.json');
            await fs.access(credentialsPath);
            return true;
        } catch {
            return false;
        }
    }
}

module.exports = BaseCredentialModule;