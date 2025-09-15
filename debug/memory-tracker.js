/**
 * 内存追踪和诊断工具
 * 专为查找 "double free or corruption" 错误设计
 */

class MemoryTracker {
    constructor() {
        this.objectCounts = new Map();
        this.allocationStack = new Map();
        this.gcCount = 0;
        this.lastMemoryCheck = Date.now();
        
        // 追踪的对象类型
        this.trackedTypes = ['Map', 'Set', 'Array', 'Object', 'Buffer'];
        
        this.startTracking();
    }

    startTracking() {
        console.log('[MEMORY-TRACKER] 开始内存追踪...');
        
        // 重写 Map 构造函数
        this.wrapConstructor('Map', global.Map);
        this.wrapConstructor('Set', global.Set);
        
        // 监控 GC
        if (global.gc) {
            const originalGc = global.gc;
            global.gc = () => {
                this.gcCount++;
                const memBefore = process.memoryUsage();
                console.log(`[MEMORY-TRACKER] GC #${this.gcCount} 开始 - 堆内存: ${Math.round(memBefore.heapUsed/1024/1024)}MB`);
                
                try {
                    const result = originalGc();
                    const memAfter = process.memoryUsage();
                    const freed = memBefore.heapUsed - memAfter.heapUsed;
                    console.log(`[MEMORY-TRACKER] GC #${this.gcCount} 完成 - 释放: ${Math.round(freed/1024/1024)}MB, 剩余: ${Math.round(memAfter.heapUsed/1024/1024)}MB`);
                    return result;
                } catch (error) {
                    console.error(`[MEMORY-TRACKER] GC #${this.gcCount} 错误:`, error.message);
                    throw error;
                }
            };
        }

        // 定期内存检查
        setInterval(() => {
            this.performMemoryCheck();
        }, 5000);

        // 监控进程事件
        process.on('beforeExit', () => {
            console.log('[MEMORY-TRACKER] 进程即将退出，生成内存报告...');
            this.generateReport();
        });

        process.on('uncaughtException', (error) => {
            console.error('[MEMORY-TRACKER] 捕获到未处理异常:', error.message);
            console.error('[MEMORY-TRACKER] 错误栈:', error.stack);
            this.generateReport();
            
            // 检查是否是内存相关错误
            if (error.message.includes('out of memory') || 
                error.message.includes('heap') ||
                error.message.includes('allocation')) {
                console.error('[MEMORY-TRACKER] 检测到内存错误！');
                this.dumpMemoryState();
            }
        });
    }

    wrapConstructor(name, Constructor) {
        const tracker = this;
        const OriginalConstructor = Constructor;
        
        global[name] = function(...args) {
            const instance = new OriginalConstructor(...args);
            
            // 记录创建
            const count = tracker.objectCounts.get(name) || 0;
            tracker.objectCounts.set(name, count + 1);
            
            // 记录调用栈 (简化版)
            const stack = new Error().stack.split('\n').slice(1, 4).join('\n');
            tracker.allocationStack.set(instance, {
                type: name,
                timestamp: Date.now(),
                stack: stack
            });
            
            console.log(`[MEMORY-TRACKER] 创建 ${name} #${count + 1}, 总计: ${tracker.getTotalObjects()}`);
            
            return instance;
        };
        
        // 保持原型链
        global[name].prototype = OriginalConstructor.prototype;
        global[name].prototype.constructor = global[name];
    }

    getTotalObjects() {
        let total = 0;
        for (const count of this.objectCounts.values()) {
            total += count;
        }
        return total;
    }

    performMemoryCheck() {
        const now = Date.now();
        const mem = process.memoryUsage();
        const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
        const externalMB = Math.round(mem.external / 1024 / 1024);
        
        console.log(`[MEMORY-TRACKER] 内存检查 - 堆: ${heapMB}MB, 外部: ${externalMB}MB, 对象总数: ${this.getTotalObjects()}`);
        
        // 内存使用过高警告
        if (heapMB > 200) {
            console.warn(`[MEMORY-TRACKER] ⚠️  内存使用较高: ${heapMB}MB`);
            this.generateReport();
            
            if (global.gc) {
                console.log('[MEMORY-TRACKER] 执行强制垃圾回收...');
                global.gc();
            }
        }

        // 检查内存增长趋势
        if (this.lastMemoryUsage && (heapMB - this.lastMemoryUsage) > 50) {
            console.warn(`[MEMORY-TRACKER] 🔥 内存快速增长: +${heapMB - this.lastMemoryUsage}MB`);
        }
        
        this.lastMemoryUsage = heapMB;
        this.lastMemoryCheck = now;
    }

    generateReport() {
        console.log('\n=== MEMORY TRACKER 报告 ===');
        console.log(`GC 次数: ${this.gcCount}`);
        console.log(`追踪的对象类型:`);
        
        for (const [type, count] of this.objectCounts.entries()) {
            console.log(`  ${type}: ${count}`);
        }
        
        const mem = process.memoryUsage();
        console.log(`\n内存使用:`);
        console.log(`  堆已用: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`);
        console.log(`  堆总量: ${Math.round(mem.heapTotal / 1024 / 1024)}MB`);
        console.log(`  外部: ${Math.round(mem.external / 1024 / 1024)}MB`);
        console.log(`  RSS: ${Math.round(mem.rss / 1024 / 1024)}MB`);
        console.log('=========================\n');
    }

    dumpMemoryState() {
        console.log('\n=== 内存状态转储 ===');
        
        // 显示最近的分配记录
        console.log('最近的对象分配:');
        let count = 0;
        for (const [obj, info] of this.allocationStack.entries()) {
            if (count++ > 10) break;
            console.log(`  ${info.type} @ ${new Date(info.timestamp).toISOString()}`);
            console.log(`    ${info.stack.split('\n')[0]}`);
        }
        
        console.log('==================\n');
    }

    // 手动触发内存分析
    analyze() {
        this.performMemoryCheck();
        this.generateReport();
        
        if (global.gc) {
            console.log('[MEMORY-TRACKER] 执行垃圾回收进行分析...');
            global.gc();
            setTimeout(() => {
                this.performMemoryCheck();
            }, 1000);
        }
    }
}

module.exports = MemoryTracker;