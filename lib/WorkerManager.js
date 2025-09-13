const { fork } = require('child_process');
const path = require('path');

/**
 * 工作进程管理器
 * 管理Home Assistant API工作进程的生命周期
 * 实现进程隔离以防止内存corruption
 */
class WorkerManager {
    constructor(logger) {
        this.logger = logger;
        this.worker = null;
        this.isWorkerReady = false;
        this.pendingRequests = new Map();
        this.requestTimeout = 60000; // 1分钟超时
        this.maxRetries = 2;
        this.workerRestartCount = 0;
        this.lastRestartTime = 0;
        
        // 工作进程路径
        this.workerPath = path.join(__dirname, '../workers/home-assistant-worker.js');
    }
    
    /**
     * 启动工作进程
     */
    async startWorker() {
        try {
            if (this.worker) {
                this.logger.info('[WORKER-MANAGER] 关闭现有工作进程...');
                await this.stopWorker();
            }
            
            this.logger.info('[WORKER-MANAGER] 启动Home Assistant工作进程...');
            
            // 工作进程参数
            const workerArgs = [];
            const workerOptions = {
                stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
                env: {
                    ...process.env,
                    NODE_OPTIONS: '--expose-gc --max-old-space-size=128 --optimize-for-size',
                    NODE_PATH: process.cwd() + '/node_modules'
                },
                cwd: process.cwd(),
                silent: false
            };
            
            // 创建工作进程
            this.worker = fork(this.workerPath, workerArgs, workerOptions);
            this.isWorkerReady = false;
            this.workerRestartCount++;
            
            // 工作进程消息处理
            this.worker.on('message', (message) => {
                this.handleWorkerMessage(message);
            });
            
            // 工作进程退出处理
            this.worker.on('exit', (code, signal) => {
                this.logger.warn(`[WORKER-MANAGER] 工作进程退出: code=${code}, signal=${signal}`);
                this.isWorkerReady = false;
                this.worker = null;
                
                // 清理所有待处理的请求
                this.rejectAllPendingRequests(new Error('Worker process exited'));
                
                // 如果不是正常退出，尝试重启
                if (code !== 0 && code !== null) {
                    this.scheduleWorkerRestart();
                }
            });
            
            // 工作进程错误处理
            this.worker.on('error', (error) => {
                this.logger.error('[WORKER-MANAGER] 工作进程错误:', error.message);
                this.isWorkerReady = false;
            });
            
            // 等待工作进程就绪
            await this.waitForWorkerReady();
            
            this.logger.info(`[WORKER-MANAGER] 工作进程启动成功 (重启次数: ${this.workerRestartCount})`);
            
        } catch (error) {
            this.logger.error('[WORKER-MANAGER] 启动工作进程失败:', error.message);
            throw error;
        }
    }
    
    /**
     * 等待工作进程就绪
     */
    waitForWorkerReady(timeout = 30000) {
        return new Promise((resolve, reject) => {
            if (this.isWorkerReady) {
                resolve();
                return;
            }
            
            const startTime = Date.now();
            const checkReady = () => {
                if (this.isWorkerReady) {
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error('Worker ready timeout'));
                } else {
                    setTimeout(checkReady, 100);
                }
            };
            
            checkReady();
        });
    }
    
    /**
     * 停止工作进程
     */
    async stopWorker() {
        if (!this.worker) {
            return;
        }
        
        try {
            this.logger.info('[WORKER-MANAGER] 停止工作进程...');
            
            // 清理所有待处理的请求
            this.rejectAllPendingRequests(new Error('Worker is stopping'));
            
            // 发送终止信号
            this.worker.kill('SIGTERM');
            
            // 等待进程退出，如果超时则强制杀死
            await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    if (this.worker) {
                        this.logger.warn('[WORKER-MANAGER] 强制终止工作进程');
                        this.worker.kill('SIGKILL');
                    }
                    resolve();
                }, 5000);
                
                this.worker.once('exit', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
            
        } catch (error) {
            this.logger.error('[WORKER-MANAGER] 停止工作进程失败:', error.message);
        } finally {
            this.worker = null;
            this.isWorkerReady = false;
        }
    }
    
    /**
     * 处理工作进程消息
     */
    handleWorkerMessage(message) {
        try {
            // 工作进程就绪消息
            if (message.type === 'ready') {
                this.isWorkerReady = true;
                this.logger.info('[WORKER-MANAGER] 工作进程已就绪');
                return;
            }
            
            // 查找对应的请求
            const requestId = message.requestId;
            if (requestId && this.pendingRequests.has(requestId)) {
                const { resolve, reject, timeoutId } = this.pendingRequests.get(requestId);
                
                // 清理超时定时器
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                
                // 移除待处理的请求
                this.pendingRequests.delete(requestId);
                
                // 解析结果
                if (message.success) {
                    resolve(message.data);
                } else {
                    reject(new Error(message.error || 'Worker process error'));
                }
            }
            
        } catch (error) {
            this.logger.error('[WORKER-MANAGER] 处理工作进程消息失败:', error.message);
        }
    }
    
    /**
     * 向工作进程发送请求
     */
    async sendRequest(type, data, retryCount = 0) {
        try {
            // 检查工作进程状态
            if (!this.worker || !this.isWorkerReady) {
                if (retryCount < this.maxRetries) {
                    this.logger.warn(`[WORKER-MANAGER] 工作进程未就绪，尝试重启 (重试 ${retryCount + 1})`);
                    await this.startWorker();
                    return this.sendRequest(type, data, retryCount + 1);
                } else {
                    throw new Error('Worker process not available after retries');
                }
            }
            
            const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            return new Promise((resolve, reject) => {
                // 设置超时
                const timeoutId = setTimeout(() => {
                    this.pendingRequests.delete(requestId);
                    reject(new Error('Request timeout'));
                }, this.requestTimeout);
                
                // 保存待处理的请求
                this.pendingRequests.set(requestId, { resolve, reject, timeoutId });
                
                // 发送消息到工作进程
                const message = { requestId, type, data };
                this.worker.send(message);
                
                this.logger.info(`[WORKER-MANAGER] 发送请求到工作进程: ${type} (${requestId})`);
            });
            
        } catch (error) {
            this.logger.error('[WORKER-MANAGER] 发送请求失败:', error.message);
            
            // 如果是工作进程问题，尝试重启
            if (retryCount < this.maxRetries && 
                (error.message.includes('Worker') || error.message.includes('process'))) {
                this.logger.warn(`[WORKER-MANAGER] 尝试重启工作进程后重试 (重试 ${retryCount + 1})`);
                await this.startWorker();
                return this.sendRequest(type, data, retryCount + 1);
            }
            
            throw error;
        }
    }
    
    /**
     * 计划工作进程重启
     */
    scheduleWorkerRestart() {
        const now = Date.now();
        const timeSinceLastRestart = now - this.lastRestartTime;
        
        // 避免频繁重启
        if (timeSinceLastRestart < 30000) { // 30秒内不重复重启
            this.logger.warn('[WORKER-MANAGER] 跳过频繁重启');
            return;
        }
        
        // 如果重启次数过多，延长重启间隔
        const restartDelay = Math.min(5000 + (this.workerRestartCount * 2000), 30000);
        
        this.logger.info(`[WORKER-MANAGER] 计划 ${restartDelay}ms 后重启工作进程`);
        this.lastRestartTime = now;
        
        setTimeout(async () => {
            try {
                await this.startWorker();
            } catch (error) {
                this.logger.error('[WORKER-MANAGER] 计划重启失败:', error.message);
            }
        }, restartDelay);
    }
    
    /**
     * 拒绝所有待处理的请求
     */
    rejectAllPendingRequests(error) {
        for (const [requestId, { reject, timeoutId }] of this.pendingRequests) {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            reject(error);
        }
        this.pendingRequests.clear();
    }
    
    /**
     * 获取工作进程状态
     */
    getStatus() {
        return {
            isWorkerReady: this.isWorkerReady,
            pendingRequests: this.pendingRequests.size,
            restartCount: this.workerRestartCount,
            lastRestartTime: this.lastRestartTime
        };
    }
    
    /**
     * 清理资源
     */
    async cleanup() {
        try {
            await this.stopWorker();
            this.pendingRequests.clear();
            this.logger.info('[WORKER-MANAGER] 清理完成');
        } catch (error) {
            this.logger.error('[WORKER-MANAGER] 清理失败:', error.message);
        }
    }
}

module.exports = WorkerManager;