const fs = require('fs').promises;
const path = require('path');

/**
 * ModuleManager - 动态模块管理器
 * 负责模块的加载、注册、生命周期管理和统计信息
 */
class ModuleManager {
    constructor(modulesDir = './modules') {
        this.modulesDir = path.resolve(modulesDir);
        this.modules = new Map();
        this.moduleStats = new Map();
        
        // 错误边界和隔离
        this.errorBoundaries = new Map();
        this.isolationEnabled = true;
        
        // 日志系统
        this.logger = this.createLogger();
    }

    /**
     * 初始化模块管理器
     * 扫描和加载所有可用模块
     */
    async initialize() {
        try {
            this.logger.info('Initializing ModuleManager...');
            
            // 扫描模块目录
            const moduleNames = await this.scanModules();
            this.logger.info(`Found ${moduleNames.length} modules: ${moduleNames.join(', ')}`);
            
            // 加载所有模块
            const loadResults = await Promise.allSettled(
                moduleNames.map(name => this.loadModule(name))
            );
            
            // 统计加载结果
            let loadedCount = 0;
            let failedCount = 0;
            
            loadResults.forEach((result, index) => {
                const moduleName = moduleNames[index];
                if (result.status === 'fulfilled' && result.value.success) {
                    loadedCount++;
                    this.logger.info(`✓ Module ${moduleName} loaded successfully`);
                } else {
                    failedCount++;
                    const error = result.status === 'rejected' ? result.reason : result.value.error;
                    this.logger.error(`✗ Module ${moduleName} failed to load:`, error);
                }
            });
            
            this.logger.info(`ModuleManager initialized: ${loadedCount} loaded, ${failedCount} failed`);
            
            return {
                success: true,
                loaded: loadedCount,
                failed: failedCount,
                modules: Array.from(this.modules.keys())
            };
        } catch (error) {
            this.logger.error('Failed to initialize ModuleManager:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 扫描模块目录，查找所有模块
     */
    async scanModules() {
        try {
            const entries = await fs.readdir(this.modulesDir, { withFileTypes: true });
            const moduleNames = [];
            
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const moduleName = entry.name;
                    const moduleFile = path.join(this.modulesDir, moduleName, `${this.capitalizeFirst(moduleName)}Module.js`);
                    
                    try {
                        await fs.access(moduleFile);
                        moduleNames.push(moduleName);
                    } catch {
                        this.logger.warn(`Module ${moduleName} does not have a main file: ${moduleFile}`);
                    }
                }
            }
            
            return moduleNames;
        } catch (error) {
            this.logger.error('Failed to scan modules directory:', error);
            return [];
        }
    }

    /**
     * 加载单个模块
     */
    async loadModule(moduleName) {
        try {
            this.logger.info(`Loading module: ${moduleName}`);
            
            // 构建模块路径
            const moduleDir = path.join(this.modulesDir, moduleName);
            const moduleFile = path.join(moduleDir, `${this.capitalizeFirst(moduleName)}Module.js`);
            
            // 清除require缓存以支持热重载
            delete require.cache[require.resolve(moduleFile)];
            
            // 动态加载模块类
            const ModuleClass = require(moduleFile);
            
            // 创建模块实例
            const moduleInstance = new ModuleClass(moduleName, moduleDir);
            
            // 初始化模块（在错误边界内）
            const initResult = await this.executeInErrorBoundary(
                moduleName,
                () => moduleInstance.initialize()
            );
            
            if (initResult.success) {
                // 注册模块
                this.modules.set(moduleName, moduleInstance);
                this.initializeModuleStats(moduleName);
                
                this.logger.info(`Module ${moduleName} loaded and initialized`);
                return { success: true, module: moduleInstance };
            } else {
                this.logger.error(`Module ${moduleName} initialization failed:`, initResult.error);
                return { success: false, error: initResult.error };
            }
            
        } catch (error) {
            this.logger.error(`Failed to load module ${moduleName}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 卸载模块
     */
    async unloadModule(moduleName) {
        try {
            const module = this.modules.get(moduleName);
            if (!module) {
                return { success: false, error: 'Module not found' };
            }

            // 禁用模块
            await this.executeInErrorBoundary(
                moduleName,
                () => module.disable()
            );

            // 从注册表中移除
            this.modules.delete(moduleName);
            this.moduleStats.delete(moduleName);
            this.errorBoundaries.delete(moduleName);

            // 清除require缓存
            const moduleDir = path.join(this.modulesDir, moduleName);
            const moduleFile = path.join(moduleDir, `${this.capitalizeFirst(moduleName)}Module.js`);
            delete require.cache[require.resolve(moduleFile)];

            this.logger.info(`Module ${moduleName} unloaded`);
            return { success: true, message: 'Module unloaded' };
        } catch (error) {
            this.logger.error(`Failed to unload module ${moduleName}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 重载模块
     */
    async reloadModule(moduleName) {
        this.logger.info(`Reloading module: ${moduleName}`);
        
        // 先卸载
        await this.unloadModule(moduleName);
        
        // 再加载
        const result = await this.loadModule(moduleName);
        
        if (result.success) {
            this.logger.info(`Module ${moduleName} reloaded successfully`);
        } else {
            this.logger.error(`Failed to reload module ${moduleName}:`, result.error);
        }
        
        return result;
    }

    /**
     * 获取模块实例
     */
    getModule(moduleName) {
        return this.modules.get(moduleName);
    }

    /**
     * 获取所有模块列表
     */
    getAllModules() {
        return Array.from(this.modules.keys());
    }

    /**
     * 获取模块状态
     */
    async getModuleStatus(moduleName) {
        const module = this.modules.get(moduleName);
        if (!module) {
            return { success: false, error: 'Module not found' };
        }

        try {
            const status = await this.executeInErrorBoundary(
                moduleName,
                () => module.getStatus()
            );
            
            const stats = this.moduleStats.get(moduleName);
            const errorBoundary = this.errorBoundaries.get(moduleName);
            
            return {
                success: true,
                data: {
                    ...status,
                    stats,
                    errorBoundary: {
                        errors: errorBoundary ? errorBoundary.errors.length : 0,
                        lastError: errorBoundary && errorBoundary.errors.length > 0 
                            ? errorBoundary.errors[errorBoundary.errors.length - 1]
                            : null
                    }
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取所有模块状态
     */
    async getAllModulesStatus() {
        const statuses = {};
        
        for (const moduleName of this.modules.keys()) {
            const statusResult = await this.getModuleStatus(moduleName);
            statuses[moduleName] = statusResult;
        }
        
        return statuses;
    }

    /**
     * 启用模块
     */
    async enableModule(moduleName) {
        const module = this.modules.get(moduleName);
        if (!module) {
            return { success: false, error: 'Module not found' };
        }

        try {
            const result = await this.executeInErrorBoundary(
                moduleName,
                () => module.enable()
            );
            
            if (result.success) {
                this.updateModuleStats(moduleName, 'enabled');
            }
            
            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 禁用模块
     */
    async disableModule(moduleName) {
        const module = this.modules.get(moduleName);
        if (!module) {
            return { success: false, error: 'Module not found' };
        }

        try {
            const result = await this.executeInErrorBoundary(
                moduleName,
                () => module.disable()
            );
            
            if (result.success) {
                this.updateModuleStats(moduleName, 'disabled');
            }
            
            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 批量操作
     */
    async batchOperation(operation, moduleNames = null) {
        const targetModules = moduleNames || Array.from(this.modules.keys());
        const results = {};
        
        this.logger.info(`Performing batch ${operation} on modules: ${targetModules.join(', ')}`);
        
        for (const moduleName of targetModules) {
            try {
                let result;
                switch (operation) {
                    case 'enable':
                        result = await this.enableModule(moduleName);
                        break;
                    case 'disable':
                        result = await this.disableModule(moduleName);
                        break;
                    case 'reload':
                        result = await this.reloadModule(moduleName);
                        break;
                    case 'validate':
                        const module = this.getModule(moduleName);
                        result = module ? await module.validateCredentials() : { success: false, error: 'Module not found' };
                        break;
                    default:
                        result = { success: false, error: 'Unknown operation' };
                }
                results[moduleName] = result;
            } catch (error) {
                results[moduleName] = { success: false, error: error.message };
            }
        }
        
        return results;
    }

    /**
     * 获取统计信息
     */
    getStatistics() {
        const totalModules = this.modules.size;
        let enabledModules = 0;
        let initializedModules = 0;
        
        for (const module of this.modules.values()) {
            if (module.enabled) enabledModules++;
            if (module.initialized) initializedModules++;
        }
        
        return {
            totalModules,
            enabledModules,
            initializedModules,
            disabledModules: totalModules - enabledModules,
            moduleStats: Object.fromEntries(this.moduleStats),
            errorBoundaries: this.getErrorBoundaryStats()
        };
    }

    /**
     * 清除所有模块缓存
     */
    async clearAllCaches() {
        const results = {};
        
        for (const [moduleName, module] of this.modules) {
            try {
                const result = await this.executeInErrorBoundary(
                    moduleName,
                    () => module.clearCache()
                );
                results[moduleName] = result;
            } catch (error) {
                results[moduleName] = { success: false, error: error.message };
            }
        }
        
        return results;
    }

    // =================
    // 错误边界和隔离
    // =================

    /**
     * 在错误边界内执行操作
     */
    async executeInErrorBoundary(moduleName, operation) {
        if (!this.isolationEnabled) {
            return await operation();
        }

        try {
            const result = await operation();
            this.updateModuleStats(moduleName, 'success');
            return result;
        } catch (error) {
            this.recordError(moduleName, error);
            this.updateModuleStats(moduleName, 'error');
            
            // 返回安全的错误结果而不是抛出异常
            return { success: false, error: error.message };
        }
    }

    /**
     * 记录模块错误
     */
    recordError(moduleName, error) {
        if (!this.errorBoundaries.has(moduleName)) {
            this.errorBoundaries.set(moduleName, {
                errors: [],
                firstError: null,
                lastError: null,
                errorCount: 0
            });
        }
        
        const boundary = this.errorBoundaries.get(moduleName);
        const errorRecord = {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        };
        
        boundary.errors.push(errorRecord);
        boundary.lastError = errorRecord;
        boundary.errorCount++;
        
        if (!boundary.firstError) {
            boundary.firstError = errorRecord;
        }
        
        // 保持错误历史在合理范围内
        if (boundary.errors.length > 50) {
            boundary.errors = boundary.errors.slice(-25);
        }
        
        this.logger.error(`Error in module ${moduleName}:`, error);
    }

    /**
     * 获取错误边界统计
     */
    getErrorBoundaryStats() {
        const stats = {};
        for (const [moduleName, boundary] of this.errorBoundaries) {
            stats[moduleName] = {
                errorCount: boundary.errorCount,
                firstError: boundary.firstError,
                lastError: boundary.lastError,
                recentErrors: boundary.errors.slice(-5)
            };
        }
        return stats;
    }

    // =================
    // 辅助方法
    // =================

    /**
     * 初始化模块统计
     */
    initializeModuleStats(moduleName) {
        this.moduleStats.set(moduleName, {
            loadedAt: new Date().toISOString(),
            operations: {
                success: 0,
                error: 0,
                enabled: 0,
                disabled: 0,
                validated: 0
            },
            lastActivity: new Date().toISOString()
        });
    }

    /**
     * 更新模块统计
     */
    updateModuleStats(moduleName, operation) {
        const stats = this.moduleStats.get(moduleName);
        if (stats) {
            if (stats.operations[operation] !== undefined) {
                stats.operations[operation]++;
            }
            stats.lastActivity = new Date().toISOString();
        }
    }

    /**
     * 首字母大写
     */
    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * 创建日志器
     */
    createLogger() {
        return {
            info: (message, ...args) => {
                console.log(`[INFO][ModuleManager] ${message}`, ...args);
            },
            warn: (message, ...args) => {
                console.warn(`[WARN][ModuleManager] ${message}`, ...args);
            },
            error: (message, ...args) => {
                console.error(`[ERROR][ModuleManager] ${message}`, ...args);
            }
        };
    }
}

module.exports = ModuleManager;