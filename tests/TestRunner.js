const path = require('path');
const fs = require('fs').promises;

// 测试类导入
const TelegramModuleTest = require('./TelegramModuleTest');

/**
 * TestRunner - 测试运行器
 * 执行所有模块测试并生成综合报告
 */
class TestRunner {
    constructor() {
        this.testClasses = new Map();
        this.testResults = [];
        this.startTime = null;
        this.endTime = null;
        
        // 注册测试类
        this.registerTestClasses();
        
        // 日志系统
        this.logger = this.createLogger();
    }

    /**
     * 注册所有测试类
     */
    registerTestClasses() {
        // 注册已实现的测试类
        this.testClasses.set('telegram', TelegramModuleTest);
        
        // TODO: 添加其他模块的测试类
        // this.testClasses.set('openai', OpenaiModuleTest);
        // this.testClasses.set('claude', ClaudeModuleTest);
        // this.testClasses.set('whatsapp', WhatsappModuleTest);
        // this.testClasses.set('home_assistant', HomeAssistantModuleTest);
    }

    /**
     * 运行所有测试
     */
    async runAllTests(options = {}) {
        this.logger.info('🚀 Starting comprehensive test suite...\n');
        this.startTime = Date.now();
        this.testResults = [];

        const {
            modules = null,  // 指定要测试的模块，null表示测试所有模块
            skipIntegration = false,  // 是否跳过集成测试
            parallel = false,  // 是否并行运行测试
            outputDir = './test-reports',  // 测试报告输出目录
            verbose = true  // 详细输出
        } = options;

        // 确定要测试的模块
        const modulesToTest = modules ? modules.filter(m => this.testClasses.has(m)) : Array.from(this.testClasses.keys());
        
        if (modulesToTest.length === 0) {
            throw new Error('No valid modules to test');
        }

        this.logger.info(`📋 Testing modules: ${modulesToTest.join(', ')}`);
        this.logger.info(`⚙️  Configuration: ${skipIntegration ? 'Skip integration' : 'Include integration'}, ${parallel ? 'Parallel' : 'Sequential'}\n`);

        // 运行测试
        if (parallel && modulesToTest.length > 1) {
            await this.runTestsInParallel(modulesToTest, { skipIntegration, verbose });
        } else {
            await this.runTestsSequentially(modulesToTest, { skipIntegration, verbose });
        }

        this.endTime = Date.now();

        // 生成综合报告
        const comprehensiveReport = this.generateComprehensiveReport();
        
        // 保存报告
        const reportPath = await this.saveComprehensiveReport(comprehensiveReport, outputDir);
        
        // 输出总结
        this.printTestSummary(comprehensiveReport);

        return {
            report: comprehensiveReport,
            reportPath: reportPath
        };
    }

    /**
     * 顺序运行测试
     */
    async runTestsSequentially(modules, options) {
        for (const moduleName of modules) {
            await this.runModuleTest(moduleName, options);
        }
    }

    /**
     * 并行运行测试
     */
    async runTestsInParallel(modules, options) {
        const testPromises = modules.map(moduleName => this.runModuleTest(moduleName, options));
        await Promise.allSettled(testPromises);
    }

    /**
     * 运行单个模块的测试
     */
    async runModuleTest(moduleName, options = {}) {
        const TestClass = this.testClasses.get(moduleName);
        if (!TestClass) {
            this.logger.error(`❌ Test class not found for module: ${moduleName}`);
            return;
        }

        try {
            this.logger.info(`\n🧪 Testing ${moduleName} module...`);
            this.logger.info('='.repeat(50));
            
            const testInstance = new TestClass();
            
            // 设置测试配置
            if (options.skipIntegration) {
                testInstance.testConfig.skipIntegrationTests = true;
            }

            // 运行测试
            const report = await testInstance.runAllTests();
            this.testResults.push(report);

            // 保存单独的测试报告
            await testInstance.saveTestReport(report);

            this.logger.info('='.repeat(50));
            
            if (report.summary.failed === 0) {
                this.logger.info(`✅ ${moduleName} - All tests passed!`);
            } else {
                this.logger.error(`❌ ${moduleName} - ${report.summary.failed} test(s) failed`);
            }

        } catch (error) {
            this.logger.error(`❌ Failed to run tests for ${moduleName}:`, error.message);
            
            // 创建失败报告
            const failureReport = {
                module: moduleName,
                summary: {
                    total: 0,
                    passed: 0,
                    failed: 1,
                    success_rate: 0,
                    duration: 0
                },
                results: [{
                    name: 'Test Execution',
                    status: 'failed',
                    duration: 0,
                    error: error.message
                }],
                timestamp: new Date().toISOString()
            };
            
            this.testResults.push(failureReport);
        }
    }

    /**
     * 生成综合测试报告
     */
    generateComprehensiveReport() {
        const totalDuration = this.endTime - this.startTime;
        
        // 计算总体统计
        let totalTests = 0;
        let totalPassed = 0;
        let totalFailed = 0;
        const moduleResults = {};

        for (const moduleReport of this.testResults) {
            totalTests += moduleReport.summary.total;
            totalPassed += moduleReport.summary.passed;
            totalFailed += moduleReport.summary.failed;
            
            moduleResults[moduleReport.module] = {
                summary: moduleReport.summary,
                status: moduleReport.summary.failed === 0 ? 'passed' : 'failed'
            };
        }

        const overallSuccessRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;

        return {
            overview: {
                total_modules: this.testResults.length,
                total_tests: totalTests,
                total_passed: totalPassed,
                total_failed: totalFailed,
                overall_success_rate: overallSuccessRate,
                total_duration: totalDuration,
                start_time: new Date(this.startTime).toISOString(),
                end_time: new Date(this.endTime).toISOString()
            },
            modules: moduleResults,
            detailed_results: this.testResults,
            environment: {
                node_version: process.version,
                platform: process.platform,
                arch: process.arch,
                memory_usage: process.memoryUsage(),
                cwd: process.cwd()
            },
            timestamp: new Date().toISOString()
        };
    }

    /**
     * 保存综合测试报告
     */
    async saveComprehensiveReport(report, outputDir) {
        try {
            await fs.mkdir(outputDir, { recursive: true });
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `comprehensive-test-report-${timestamp}.json`;
            const filepath = path.join(outputDir, filename);
            
            await fs.writeFile(filepath, JSON.stringify(report, null, 2));
            
            // 同时保存HTML报告
            const htmlReport = this.generateHTMLReport(report);
            const htmlFilename = `comprehensive-test-report-${timestamp}.html`;
            const htmlFilepath = path.join(outputDir, htmlFilename);
            await fs.writeFile(htmlFilepath, htmlReport);
            
            this.logger.info(`\n📁 Comprehensive reports saved:`);
            this.logger.info(`   JSON: ${filepath}`);
            this.logger.info(`   HTML: ${htmlFilepath}`);
            
            return filepath;
        } catch (error) {
            this.logger.error('Failed to save comprehensive report:', error);
            return null;
        }
    }

    /**
     * 生成HTML报告
     */
    generateHTMLReport(report) {
        const moduleRows = Object.entries(report.modules).map(([name, result]) => `
            <tr class="${result.status}">
                <td>${name}</td>
                <td>${result.summary.total}</td>
                <td>${result.summary.passed}</td>
                <td>${result.summary.failed}</td>
                <td>${result.summary.success_rate}%</td>
                <td>${result.summary.duration}ms</td>
                <td><span class="status ${result.status}">${result.status.toUpperCase()}</span></td>
            </tr>
        `).join('');

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Credential Service - Test Report</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
                .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .header { text-align: center; margin-bottom: 30px; }
                .header h1 { color: #333; margin-bottom: 5px; }
                .header p { color: #666; }
                .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
                .summary-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
                .summary-card h3 { margin: 0; color: #666; font-size: 14px; text-transform: uppercase; }
                .summary-card .value { font-size: 24px; font-weight: bold; margin: 10px 0; }
                .success { color: #28a745; }
                .danger { color: #dc3545; }
                .info { color: #17a2b8; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
                th { background-color: #f8f9fa; font-weight: 600; }
                .status { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
                .status.passed { background-color: #d4edda; color: #155724; }
                .status.failed { background-color: #f8d7da; color: #721c24; }
                .passed td { background-color: rgba(40, 167, 69, 0.05); }
                .failed td { background-color: rgba(220, 53, 69, 0.05); }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🔐 Credential Service Test Report</h1>
                    <p>Generated on ${new Date(report.timestamp).toLocaleString()}</p>
                </div>
                
                <div class="summary">
                    <div class="summary-card">
                        <h3>Total Modules</h3>
                        <div class="value info">${report.overview.total_modules}</div>
                    </div>
                    <div class="summary-card">
                        <h3>Total Tests</h3>
                        <div class="value info">${report.overview.total_tests}</div>
                    </div>
                    <div class="summary-card">
                        <h3>Passed</h3>
                        <div class="value success">${report.overview.total_passed}</div>
                    </div>
                    <div class="summary-card">
                        <h3>Failed</h3>
                        <div class="value danger">${report.overview.total_failed}</div>
                    </div>
                    <div class="summary-card">
                        <h3>Success Rate</h3>
                        <div class="value ${report.overview.overall_success_rate === 100 ? 'success' : 'danger'}">${report.overview.overall_success_rate}%</div>
                    </div>
                    <div class="summary-card">
                        <h3>Duration</h3>
                        <div class="value info">${report.overview.total_duration}ms</div>
                    </div>
                </div>
                
                <h2>Module Results</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Module</th>
                            <th>Total Tests</th>
                            <th>Passed</th>
                            <th>Failed</th>
                            <th>Success Rate</th>
                            <th>Duration</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${moduleRows}
                    </tbody>
                </table>
                
                <div style="margin-top: 30px; padding: 15px; background-color: #f8f9fa; border-radius: 8px; font-size: 12px; color: #666;">
                    <strong>Environment:</strong> Node.js ${report.environment.node_version} on ${report.environment.platform} (${report.environment.arch})<br>
                    <strong>Working Directory:</strong> ${report.environment.cwd}<br>
                    <strong>Memory Usage:</strong> RSS: ${Math.round(report.environment.memory_usage.rss / 1024 / 1024)}MB, 
                    Heap Used: ${Math.round(report.environment.memory_usage.heapUsed / 1024 / 1024)}MB
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * 打印测试总结
     */
    printTestSummary(report) {
        const { overview } = report;
        
        this.logger.info('\n' + '='.repeat(80));
        this.logger.info('🎯 COMPREHENSIVE TEST SUMMARY');
        this.logger.info('='.repeat(80));
        
        this.logger.info(`📊 Overall Results:`);
        this.logger.info(`   Modules Tested: ${overview.total_modules}`);
        this.logger.info(`   Total Tests: ${overview.total_tests}`);
        this.logger.info(`   Passed: ${overview.total_passed} ✅`);
        this.logger.info(`   Failed: ${overview.total_failed} ❌`);
        this.logger.info(`   Success Rate: ${overview.overall_success_rate}%`);
        this.logger.info(`   Total Duration: ${(overview.total_duration / 1000).toFixed(2)}s`);
        
        this.logger.info(`\n📋 Module Breakdown:`);
        Object.entries(report.modules).forEach(([name, result]) => {
            const statusIcon = result.status === 'passed' ? '✅' : '❌';
            const rate = result.summary.success_rate;
            this.logger.info(`   ${statusIcon} ${name.padEnd(15)} ${result.summary.passed}/${result.summary.total} (${rate}%)`);
        });
        
        if (overview.total_failed > 0) {
            this.logger.info(`\n⚠️  Some tests failed. Check the detailed report for more information.`);
        } else {
            this.logger.info(`\n🎉 All tests passed! Your credential service is working perfectly.`);
        }
        
        this.logger.info('='.repeat(80));
    }

    /**
     * 运行特定模块的测试
     */
    async runModuleTests(moduleNames) {
        return this.runAllTests({ modules: moduleNames });
    }

    /**
     * 运行快速测试（跳过集成测试）
     */
    async runQuickTests() {
        return this.runAllTests({ skipIntegration: true });
    }

    /**
     * 创建日志器
     */
    createLogger() {
        return {
            info: (message, ...args) => {
                console.log(`[TEST-RUNNER] ${message}`, ...args);
            },
            warn: (message, ...args) => {
                console.warn(`[TEST-RUNNER] ${message}`, ...args);
            },
            error: (message, ...args) => {
                console.error(`[TEST-RUNNER] ${message}`, ...args);
            }
        };
    }
}

// 命令行接口
if (require.main === module) {
    const args = process.argv.slice(2);
    const testRunner = new TestRunner();
    
    // 解析命令行参数
    const options = {
        modules: null,
        skipIntegration: args.includes('--skip-integration'),
        parallel: args.includes('--parallel'),
        verbose: !args.includes('--quiet')
    };
    
    // 检查是否指定了特定模块
    const moduleArg = args.find(arg => arg.startsWith('--modules='));
    if (moduleArg) {
        options.modules = moduleArg.split('=')[1].split(',');
    }
    
    // 运行测试
    testRunner.runAllTests(options)
        .then(({ report }) => {
            const exitCode = report.overview.total_failed > 0 ? 1 : 0;
            process.exit(exitCode);
        })
        .catch(error => {
            console.error('❌ Test execution failed:', error);
            process.exit(1);
        });
}

module.exports = TestRunner;