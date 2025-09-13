#!/usr/bin/env node

/**
 * Home Assistant 工作进程
 * 独立进程处理内存密集型的Home Assistant API调用
 * 防止内存corruption影响主服务
 */

const https = require('https');
const http = require('http');
const path = require('path');

// 进程级内存限制
process.env.NODE_OPTIONS = '--max-old-space-size=128 --optimize-for-size';

// 工作进程状态
let isProcessing = false;
let requestCount = 0;
const MAX_REQUESTS = 10; // 处理10个请求后重启工作进程

// 内存监控
const monitorMemory = () => {
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    
    // 内存过高时立即退出，让主进程重启
    if (heapMB > 100 || rssMB > 120) {
        console.error(`[WORKER-MEMORY] 内存过高: 堆=${heapMB}MB, RSS=${rssMB}MB - 退出`);
        process.exit(2); // 内存问题退出码
    }
    
    return { heapMB, rssMB };
};

// HTTP请求函数 (简化版，专门用于API调用)
const makeRequest = (url, headers = {}) => {
    return new Promise((resolve, reject) => {
        const isHttps = url.startsWith('https:');
        const client = isHttps ? https : http;
        
        const options = {
            timeout: 15000,
            headers: {
                'User-Agent': 'HA-Worker/1.0',
                'Accept': 'application/json',
                ...headers
            }
        };
        
        const req = client.get(url, options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
                // 数据过大时停止
                if (data.length > 5 * 1024 * 1024) { // 5MB限制
                    req.destroy();
                    reject(new Error('Response too large'));
                    return;
                }
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    resolve({ status: res.statusCode, data: result });
                } catch (err) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
};

// 批量处理状态实体 - 超小批次
const processStatesInMicroBatches = (states, credentials) => {
    return new Promise((resolve, reject) => {
        const MICRO_BATCH_SIZE = 5; // 每次只处理5个实体
        const results = [];
        let processed = 0;
        
        const processBatch = async (startIndex) => {
            try {
                // 内存检查
                const { heapMB } = monitorMemory();
                if (heapMB > 80) {
                    console.warn(`[WORKER-BATCH] 内存使用${heapMB}MB，跳过批次 ${startIndex}`);
                    // 跳过当前批次，添加空结果
                    const batchSize = Math.min(MICRO_BATCH_SIZE, states.length - startIndex);
                    for (let i = 0; i < batchSize; i++) {
                        results.push({ entity_id: states[startIndex + i].entity_id, error: 'Memory limit' });
                    }
                    processed += batchSize;
                } else {
                    const batch = states.slice(startIndex, startIndex + MICRO_BATCH_SIZE);
                    console.log(`[WORKER-BATCH] 处理批次 ${startIndex}-${startIndex + batch.length - 1} (${batch.length}个实体)`);
                    
                    // 简单处理，只返回基本信息
                    for (const entity of batch) {
                        results.push({
                            entity_id: entity.entity_id,
                            state: entity.state,
                            friendly_name: entity.attributes?.friendly_name || entity.entity_id,
                            last_changed: entity.last_changed
                        });
                    }
                    processed += batch.length;
                }
                
                // 每个批次后强制GC
                if (global.gc && processed % MICRO_BATCH_SIZE === 0) {
                    global.gc();
                }
                
                // 处理下一批次
                const nextIndex = startIndex + MICRO_BATCH_SIZE;
                if (nextIndex < states.length) {
                    // 短暂延迟避免内存压力
                    setTimeout(() => processBatch(nextIndex), 50);
                } else {
                    // 完成所有处理
                    console.log(`[WORKER-BATCH] 完成处理 ${processed} 个实体`);
                    resolve(results);
                }
                
            } catch (error) {
                console.error(`[WORKER-BATCH] 批次处理错误:`, error.message);
                reject(error);
            }
        };
        
        // 开始处理第一批
        processBatch(0);
    });
};

// 处理Home Assistant API请求
const processHomeAssistantRequest = async (message) => {
    const { type, data } = message;
    
    try {
        isProcessing = true;
        requestCount++;
        
        console.log(`[WORKER] 开始处理请求: ${type} (第${requestCount}次请求)`);
        
        switch (type) {
            case 'get_states':
                const { credentials } = data;
                const url = `${credentials.home_assistant_url}/api/states`;
                const headers = {
                    'Authorization': `Bearer ${credentials.access_token}`,
                    'Content-Type': 'application/json'
                };
                
                console.log(`[WORKER] 获取状态数据...`);
                const response = await makeRequest(url, headers);
                
                if (response.status !== 200) {
                    throw new Error(`API返回状态: ${response.status}`);
                }
                
                const states = response.data;
                console.log(`[WORKER] 获得 ${states.length} 个状态实体`);
                
                // 使用微批次处理
                const processedStates = await processStatesInMicroBatches(states, credentials);
                
                return { success: true, data: processedStates };
                
            default:
                throw new Error(`未知请求类型: ${type}`);
        }
        
    } catch (error) {
        console.error(`[WORKER] 处理失败:`, error.message);
        return { success: false, error: error.message };
    } finally {
        isProcessing = false;
        
        // 检查是否需要重启工作进程
        if (requestCount >= MAX_REQUESTS) {
            console.log(`[WORKER] 达到最大请求数 ${MAX_REQUESTS}，退出以重启`);
            process.exit(0);
        }
        
        // 强制清理
        if (global.gc) {
            global.gc();
        }
    }
};

// 进程通信处理
process.on('message', async (message) => {
    try {
        if (isProcessing) {
            process.send({ error: 'Worker is busy' });
            return;
        }
        
        const result = await processHomeAssistantRequest(message);
        process.send(result);
        
    } catch (error) {
        console.error('[WORKER] 消息处理错误:', error);
        process.send({ success: false, error: error.message });
    }
});

// 工作进程异常处理
process.on('uncaughtException', (error) => {
    console.error('[WORKER] 未捕获异常:', error.message);
    // 通知主进程并退出
    if (process.send) {
        process.send({ success: false, error: 'Worker crashed: ' + error.message });
    }
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('[WORKER] 未处理的Promise拒绝:', reason);
    if (process.send) {
        process.send({ success: false, error: 'Worker promise rejection: ' + reason });
    }
    process.exit(1);
});

// 内存监控定时器
setInterval(monitorMemory, 10000);

// 只在作为子进程时启动
if (process.send) {
    // 启动时的内存状态
    const initialMem = monitorMemory();
    console.log(`[WORKER] 启动 - 初始内存: 堆=${initialMem.heapMB}MB, RSS=${initialMem.rssMB}MB`);

    // 通知主进程工作进程已准备就绪
    process.send({ type: 'ready' });
} else {
    console.log('[WORKER] 在非IPC模式下运行，不启动工作进程');
}