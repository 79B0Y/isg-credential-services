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

// 进程级内存保护监控
const startMemoryMonitoring = () => {
    let lastHeapUsed = 0;
    let memoryWarningCount = 0;
    let lastGcTime = Date.now();
    const MEMORY_THRESHOLD_MB = 200; // 内存警告阈值
    const CRITICAL_THRESHOLD_MB = 240; // 严重内存阈值
    const MAX_WARNINGS = 3; // 最大警告次数
    
    const checkMemory = () => {
        const mem = process.memoryUsage();
        const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        const externalMB = Math.round(mem.external / 1024 / 1024);
        
        console.log(`[MEMORY-PROTECT] 堆: ${heapMB}MB, RSS: ${rssMB}MB, 外部: ${externalMB}MB`);
        
        // 内存增长速度检测
        const memoryGrowth = heapMB - lastHeapUsed;
        if (memoryGrowth > 20) {
            console.warn(`[MEMORY-PROTECT] ⚠️  内存快速增长: +${memoryGrowth}MB`);
            memoryWarningCount++;
        }

        // 分级内存保护
        if (heapMB > CRITICAL_THRESHOLD_MB) {
            console.error(`[MEMORY-PROTECT] 🚨 严重内存警告: ${heapMB}MB (临界值: ${CRITICAL_THRESHOLD_MB}MB)`);
            
            // 紧急内存清理
            if (global.gc) {
                console.log('[MEMORY-PROTECT] 执行紧急垃圾回收...');
                global.gc();
                global.gc(); // 连续执行两次GC
                lastGcTime = Date.now();
            }

            // 记录详细内存信息
            const memAfterGc = process.memoryUsage();
            const freedMB = Math.round((mem.heapUsed - memAfterGc.heapUsed) / 1024 / 1024);
            console.log(`[MEMORY-PROTECT] GC释放内存: ${freedMB}MB`);

            // 内存仍然过高，考虑重启
            if (memAfterGc.heapUsed / 1024 / 1024 > CRITICAL_THRESHOLD_MB - 20) {
                console.error('[MEMORY-PROTECT] 🔥 内存无法有效释放，建议重启服务');
                memoryWarningCount = MAX_WARNINGS; // 触发保护机制
            }

        } else if (heapMB > MEMORY_THRESHOLD_MB) {
            console.warn(`[MEMORY-PROTECT] ⚠️  内存使用过高: ${heapMB}MB`);
            memoryWarningCount++;
            
            // 预防性垃圾回收
            const timeSinceLastGc = Date.now() - lastGcTime;
            if (global.gc && timeSinceLastGc > 30000) { // 30秒间隔
                console.log('[MEMORY-PROTECT] 预防性垃圾回收...');
                global.gc();
                lastGcTime = Date.now();
            }
        } else {
            // 内存正常，重置警告计数
            if (memoryWarningCount > 0) {
                memoryWarningCount = Math.max(0, memoryWarningCount - 1);
            }
        }

        // 连续内存警告保护机制
        if (memoryWarningCount >= MAX_WARNINGS) {
            console.error(`[MEMORY-PROTECT] 🚨 连续内存警告 (${memoryWarningCount})，激活保护机制`);
            
            // 尝试强制清理
            if (global.memoryTracker) {
                console.log('[MEMORY-PROTECT] 生成内存泄漏报告...');
                global.memoryTracker.generateReport();
            }

            // 清理活跃请求（如果存在Telegram模块）
            try {
                // 通过全局变量访问模块实例
                if (global.telegramModule && global.telegramModule.forceCleanupRequests) {
                    console.log('[MEMORY-PROTECT] 清理Telegram活跃请求...');
                    global.telegramModule.forceCleanupRequests();
                }
            } catch (cleanupError) {
                console.warn('[MEMORY-PROTECT] 请求清理失败:', cleanupError.message);
            }

            // 最后手段：延迟重启（给用户时间保存数据）
            if (memoryWarningCount >= MAX_WARNINGS + 2) {
                console.error('[MEMORY-PROTECT] 🔥 内存问题严重，5秒后自动重启...');
                setTimeout(() => {
                    console.error('[MEMORY-PROTECT] 执行保护性重启');
                    process.exit(2); // 特殊退出码表示内存问题
                }, 5000);
            }
        }
        
        lastHeapUsed = heapMB;
    };
    
    // 每30秒检查一次内存
    setInterval(checkMemory, 30000);
    
    // 更频繁的快速检查（仅检查关键指标）
    setInterval(() => {
        const mem = process.memoryUsage();
        const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
        
        // 只在内存过高时进行快速干预
        if (heapMB > CRITICAL_THRESHOLD_MB + 20) { // 260MB以上紧急干预
            console.error(`[MEMORY-PROTECT-FAST] 🚨 紧急内存干预: ${heapMB}MB`);
            if (global.gc) {
                global.gc();
                console.log('[MEMORY-PROTECT-FAST] 紧急GC执行');
            }
        }
    }, 10000); // 每10秒快速检查
    
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

// 使用 TermuxHelper 进行环境检测和内存保护
const TermuxHelper = require('./lib/termux-helper.js');

// 检测环境并设置内存保护
console.log('🤖 检测到 Termux 环境，启用内存优化...');
TermuxHelper.setupMemoryProtection({
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`)
});

// 启动内存监控（作为备用）
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

// 启动主服务
try {
    const CredentialService = require('./server.js');
    const service = new CredentialService();

    // 优雅关闭处理
    process.on('SIGINT', async () => {
        console.log('\n⏹️ 正在优雅关闭...');
        await service.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n⏹️ 正在优雅关闭...');
        await service.stop();
        process.exit(0);
    });

    // 启动服务
    service.start().then(() => {
        console.log('✅ 服务启动成功');
    }).catch(error => {
        console.error('❌ 服务启动失败:', error.message);
        console.error('📍 错误详情:', error.stack);
        process.exit(1);
    });
} catch (error) {
    console.error('❌ 服务初始化失败:', error.message);
    console.error('📍 错误详情:', error.stack);
    process.exit(1);
}