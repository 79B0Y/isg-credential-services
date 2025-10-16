/**
 * Termux Environment Helper
 * Detects Termux environment and provides optimization settings
 */

class TermuxHelper {
    static isTermux() {
        // 检测多种 Termux 环境标识
        return (
            (process.env.PREFIX && process.env.PREFIX.includes('com.termux')) ||
            (process.env.TERMUX_VERSION) ||
            (process.env.HOME && process.env.HOME.includes('com.termux')) ||
            (process.platform === 'linux' && process.env.ANDROID_ROOT) ||
            (process.env.TERMUX_APP_PID) ||
            // 检测 proot 环境中的 Termux
            (process.env.PROOT_TMP_DIR && process.env.PROOT_TMP_DIR.includes('termux'))
        );
    }

    static isProot() {
        return (
            process.env.PROOT_TMP_DIR || 
            process.env.PROOT ||
            process.env.PROOTED ||
            // 检测常见的 proot 环境变量
            (process.env.HOME && process.env.HOME.includes('proot')) ||
            (process.env.PWD && process.env.PWD.includes('proot'))
        );
    }

    static getOptimizedConfig() {
        const isTermux = this.isTermux();
        const isProot = this.isProot();
        
        // 智能检测受限环境
        const isRestrictedEnv = isTermux || isProot || this.isRestrictedEnvironment();
        
        // 获取可用的临时目录
        const tempDir = this.getSafeTempDir();
        const dataDir = this.getSafeDataDir();

        return {
            isTermux,
            isProot,
            isRestrictedEnv,
            paths: {
                tempDir,
                dataDir
            },
            memory: {
                maxFileSize: isRestrictedEnv ? 5 * 1024 * 1024 : 25 * 1024 * 1024, // 5MB vs 25MB
                maxMessageHistory: isRestrictedEnv ? 20 : 1000,
                gcInterval: isRestrictedEnv ? 15000 : 60000, // 更频繁的 GC
                maxHeapSize: isRestrictedEnv ? 128 * 1024 * 1024 : 512 * 1024 * 1024 // 128MB vs 512MB
            },
            network: {
                timeout: isRestrictedEnv ? 90000 : 30000, // 增加受限环境超时时间
                downloadTimeout: isRestrictedEnv ? 180000 : 60000, // 下载专用超时时间
                retries: isRestrictedEnv ? 5 : 3, // 增加重试次数
                keepAlive: !isRestrictedEnv, // 禁用 keep-alive
                pollingInterval: isRestrictedEnv ? 10000 : 300, // 减少轮询频率
                connectTimeout: isRestrictedEnv ? 45000 : 15000 // 连接超时时间
            },
            features: {
                autoStartPolling: !isRestrictedEnv, // 禁用自动启动
                webSocket: !isProot, // 禁用 WebSocket in proot
                formDataCleanup: isRestrictedEnv, // 启用积极清理
                aggressiveGC: isRestrictedEnv, // 启用积极垃圾回收
                memoryProtection: isRestrictedEnv // 启用内存保护
            }
        };
    }

    /**
     * 检测是否为受限环境
     */
    static isRestrictedEnvironment() {
        // 检测内存限制
        const totalMem = require('os').totalmem();
        const isLowMemory = totalMem < 2 * 1024 * 1024 * 1024; // 小于 2GB
        
        // 检测 CPU 核心数
        const cpuCount = require('os').cpus().length;
        const isLowCPU = cpuCount <= 2;
        
        // 检测是否为容器环境
        const isContainer = process.env.CONTAINER || process.env.DOCKER || 
                           (process.env.HOME && process.env.HOME.includes('container'));
        
        return isLowMemory || isLowCPU || isContainer;
    }

    /**
     * 获取安全的临时目录
     */
    static getSafeTempDir() {
        const isTermux = this.isTermux();
        const isProot = this.isProot();
        
        if (isTermux && process.env.PREFIX) {
            return `${process.env.PREFIX}/tmp`;
        } else if (isProot && process.env.PROOT_TMP_DIR) {
            return process.env.PROOT_TMP_DIR;
        } else {
            return require('os').tmpdir();
        }
    }

    /**
     * 获取安全的数据目录
     */
    static getSafeDataDir() {
        const isTermux = this.isTermux();
        const isProot = this.isProot();
        
        if (isTermux && process.env.PREFIX) {
            return `${process.env.PREFIX}/var/lib`;
        } else if (isProot) {
            return process.env.HOME || process.cwd();
        } else {
            return process.cwd();
        }
    }

    static logEnvironmentInfo(logger) {
        const config = this.getOptimizedConfig();
        const memUsage = process.memoryUsage();
        const totalMem = require('os').totalmem();
        const cpuCount = require('os').cpus().length;
        
        logger.info('[TERMUX-HELPER] Environment detection:', {
            isTermux: config.isTermux,
            isProot: config.isProot,
            isRestrictedEnv: config.isRestrictedEnv,
            platform: process.platform,
            arch: process.arch,
            paths: config.paths,
            memory: {
                heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
                externalMB: Math.round(memUsage.external / 1024 / 1024),
                totalSystemMB: Math.round(totalMem / 1024 / 1024),
                maxFileSizeMB: Math.round(config.memory.maxFileSize / 1024 / 1024),
                maxHeapSizeMB: Math.round(config.memory.maxHeapSize / 1024 / 1024)
            },
            cpu: {
                cores: cpuCount,
                isLowCPU: cpuCount <= 2
            },
            network: {
                timeout: config.network.timeout,
                downloadTimeout: config.network.downloadTimeout,
                retries: config.network.retries,
                pollingInterval: config.network.pollingInterval
            },
            optimizations: config.features,
            environment: {
                PREFIX: process.env.PREFIX,
                PROOT_TMP_DIR: process.env.PROOT_TMP_DIR,
                HOME: process.env.HOME,
                TERMUX_VERSION: process.env.TERMUX_VERSION
            }
        });
    }

    static getTempDir() {
        const config = this.getOptimizedConfig();
        return config.paths.tempDir;
    }

    static getDataDir() {
        const config = this.getOptimizedConfig();
        return config.paths.dataDir;
    }

    static forceGarbageCollection() {
        if (global.gc) {
            global.gc();
        } else {
            // Trigger GC indirectly
            const arr = new Array(1000000);
            arr.length = 0;
        }
    }

    /**
     * 内存保护机制
     */
    static setupMemoryProtection(logger) {
        const config = this.getOptimizedConfig();
        
        if (!config.features.memoryProtection) {
            return;
        }

        logger.info('[TERMUX-HELPER] Setting up memory protection...');
        
        // 设置内存限制
        if (process.setMaxListeners) {
            process.setMaxListeners(50); // 限制事件监听器数量
        }

        // 定期内存监控和清理
        const memoryMonitor = setInterval(() => {
            const memUsage = process.memoryUsage();
            const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
            const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
            const externalMB = Math.round(memUsage.external / 1024 / 1024);
            
            logger.info(`[MEMORY-PROTECT] 堆: ${heapUsedMB}MB, RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB, 外部: ${externalMB}MB`);
            
            // 如果内存使用过高，强制垃圾回收
            if (heapUsedMB > config.memory.maxHeapSize / 1024 / 1024 * 0.8) {
                logger.warn('[MEMORY-PROTECT] 内存使用过高，执行垃圾回收...');
                if (global.gc) {
                    global.gc();
                    logger.info('[GC] 释放内存:', Math.round((heapTotalMB - process.memoryUsage().heapTotal / 1024 / 1024)) + 'MB');
                }
            }
            
            // 如果外部内存过高，清理
            if (externalMB > 10) {
                logger.warn('[MEMORY-PROTECT] 外部内存过高，清理缓存...');
                // 清理全局缓存
                if (global.gc) {
                    global.gc();
                }
            }
        }, config.memory.gcInterval);

        // 进程退出时清理
        process.on('exit', () => {
            clearInterval(memoryMonitor);
        });

        process.on('SIGINT', () => {
            clearInterval(memoryMonitor);
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            clearInterval(memoryMonitor);
            process.exit(0);
        });
    }

    /**
     * 检查内存状态
     */
    static checkMemoryStatus() {
        const memUsage = process.memoryUsage();
        const config = this.getOptimizedConfig();
        
        return {
            heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
            rssMB: Math.round(memUsage.rss / 1024 / 1024),
            externalMB: Math.round(memUsage.external / 1024 / 1024),
            maxHeapMB: Math.round(config.memory.maxHeapSize / 1024 / 1024),
            isHighMemory: memUsage.heapUsed > config.memory.maxHeapSize * 0.8,
            isCriticalMemory: memUsage.heapUsed > config.memory.maxHeapSize * 0.95
        };
    }
}

module.exports = TermuxHelper;