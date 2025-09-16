/**
 * Termux Environment Helper
 * Detects Termux environment and provides optimization settings
 */

class TermuxHelper {
    static isTermux() {
        return process.env.PREFIX && process.env.PREFIX.includes('com.termux');
    }

    static isProot() {
        return process.env.PROOT_TMP_DIR || process.env.PROOT;
    }

    static getOptimizedConfig() {
        const isTermux = this.isTermux();
        const isProot = this.isProot();

        return {
            isTermux,
            isProot,
            memory: {
                maxFileSize: isTermux ? 10 * 1024 * 1024 : 25 * 1024 * 1024, // 10MB vs 25MB
                maxMessageHistory: isTermux ? 50 : 1000,
                gcInterval: isTermux ? 30000 : 60000 // More frequent GC in Termux
            },
            network: {
                timeout: isTermux ? 20000 : 30000,
                retries: isTermux ? 1 : 3,
                keepAlive: !isTermux, // Disable keep-alive in Termux
                pollingInterval: isTermux ? 5000 : 300
            },
            features: {
                autoStartPolling: !isTermux, // Disable auto-start in Termux
                webSocket: !isProot, // Disable WebSocket in proot
                formDataCleanup: isTermux // Enable aggressive cleanup
            }
        };
    }

    static logEnvironmentInfo(logger) {
        const config = this.getOptimizedConfig();
        logger.info('[TERMUX-HELPER] Environment detection:', {
            isTermux: config.isTermux,
            isProot: config.isProot,
            platform: process.platform,
            arch: process.arch,
            memoryLimitMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            optimizations: config.features
        });
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
}

module.exports = TermuxHelper;