#!/usr/bin/env node

/**
 * Termux 环境启动脚本
 * 专为解决 "double free or corruption" 问题设计
 */

const fs = require('fs');
const path = require('path');

// 设置 Termux 环境变量
process.env.NODE_ENV = 'production';
process.env.UV_THREADPOOL_SIZE = '2';
process.env.TERMUX_ENV = 'true';

// 启用内存追踪（如果需要调试）
const enableMemoryTracking = process.argv.includes('--debug-memory');
if (enableMemoryTracking) {
    const MemoryTracker = require('./debug/memory-tracker.js');
    global.memoryTracker = new MemoryTracker();
    console.log('🔍 内存追踪已启用');
}

// 内存优化设置
const memorySettings = {
    maxOldSpaceSize: 256,           // 限制老年代内存为256MB
    maxSemiSpaceSize: 32,           // 限制半空间为32MB
    gcInterval: 100,                // 更频繁的GC
    optimizeForSize: true           // 优化内存使用而不是速度
};

console.log('🤖 Termux 环境启动器');
console.log('🔧 内存优化配置:');
console.log(`  - 最大堆内存: ${memorySettings.maxOldSpaceSize}MB`);
console.log(`  - 半空间大小: ${memorySettings.maxSemiSpaceSize}MB`);
console.log(`  - 线程池大小: ${process.env.UV_THREADPOOL_SIZE}`);

// 内存监控
const startMemoryMonitoring = () => {
    let lastHeapUsed = 0;
    
    const checkMemory = () => {
        const mem = process.memoryUsage();
        const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        
        console.log(`[MEMORY] 堆: ${heapMB}MB, RSS: ${rssMB}MB`);
        
        // 内存增长检测
        if (heapMB - lastHeapUsed > 20) {
            console.warn(`[MEMORY] ⚠️  内存快速增长: +${heapMB - lastHeapUsed}MB`);
        }
        
        // 内存过高警告
        if (heapMB > 200) {
            console.warn(`[MEMORY] 🔥 内存使用过高: ${heapMB}MB`);
            if (global.gc) {
                console.log('[MEMORY] 触发垃圾回收...');
                global.gc();
            }
        }
        
        lastHeapUsed = heapMB;
    };
    
    // 每30秒检查一次内存
    setInterval(checkMemory, 30000);
    
    // 初始检查
    checkMemory();
};

// 异常处理
process.on('uncaughtException', (error) => {
    console.error('💥 未捕获异常:', error.message);
    console.error('📍 错误位置:', error.stack);
    
    if (enableMemoryTracking && global.memoryTracker) {
        global.memoryTracker.generateReport();
    }
    
    // 检查是否是内存相关错误
    const isMemoryError = error.message.includes('out of memory') || 
                         error.message.includes('heap') ||
                         error.message.includes('allocation') ||
                         error.message.includes('corruption');
    
    if (isMemoryError) {
        console.error('🔥 检测到内存错误！');
        const mem = process.memoryUsage();
        console.error(`内存使用: 堆=${Math.round(mem.heapUsed/1024/1024)}MB, RSS=${Math.round(mem.rss/1024/1024)}MB`);
    }
    
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 未处理的 Promise 拒绝:', reason);
    console.error('📍 Promise:', promise);
    process.exit(1);
});

// SIGINT 处理 (Ctrl+C)
process.on('SIGINT', () => {
    console.log('\n🛑 收到停止信号，正在清理...');
    
    if (enableMemoryTracking && global.memoryTracker) {
        global.memoryTracker.generateReport();
    }
    
    process.exit(0);
});

// 启动服务
console.log('🚀 启动 Credential Service...');

// 启动内存监控
startMemoryMonitoring();

// 强制垃圾回收（如果可用）
if (global.gc) {
    console.log('✅ 垃圾回收可用');
    // 每2分钟强制GC一次
    setInterval(() => {
        try {
            const memBefore = process.memoryUsage();
            global.gc();
            const memAfter = process.memoryUsage();
            const freed = memBefore.heapUsed - memAfter.heapUsed;
            if (freed > 1024 * 1024) { // 只有释放超过1MB时才记录
                console.log(`[GC] 释放内存: ${Math.round(freed/1024/1024)}MB`);
            }
        } catch (gcError) {
            console.warn('[GC] 垃圾回收失败:', gcError.message);
        }
    }, 120000);
} else {
    console.warn('⚠️  垃圾回收不可用，建议使用 --expose-gc 标志启动');
}

// 加载主服务
try {
    require('./server.js');
    console.log('✅ 服务启动成功');
} catch (error) {
    console.error('❌ 服务启动失败:', error.message);
    console.error('📍 错误详情:', error.stack);
    process.exit(1);
}