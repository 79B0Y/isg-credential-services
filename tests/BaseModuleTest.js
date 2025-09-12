const path = require('path');
const fs = require('fs').promises;

/**
 * BaseModuleTest - 模块测试基类
 * 提供标准化的测试接口和通用测试用例
 */
class BaseModuleTest {
    constructor(moduleName, ModuleClass) {
        this.moduleName = moduleName;
        this.ModuleClass = ModuleClass;
        this.moduleInstance = null;
        this.testResults = [];
        this.startTime = null;
        this.endTime = null;
        
        // 测试配置
        this.testConfig = {
            timeout: 10000,
            retries: 2,
            skipIntegrationTests: false
        };
        
        // 日志系统
        this.logger = this.createLogger();
    }

    /**
     * 运行所有测试
     */
    async runAllTests() {
        this.logger.info(`🧪 Starting tests for ${this.moduleName} module...`);
        this.startTime = Date.now();
        this.testResults = [];

        const tests = [
            { name: 'Module Creation', test: () => this.testModuleCreation() },
            { name: 'Module Initialization', test: () => this.testModuleInitialization() },
            { name: 'Configuration Loading', test: () => this.testConfigurationLoading() },
            { name: 'Schema Validation', test: () => this.testSchemaValidation() },
            { name: 'Credential Storage', test: () => this.testCredentialStorage() },
            { name: 'Credential Retrieval', test: () => this.testCredentialRetrieval() },
            { name: 'Credential Validation Format', test: () => this.testCredentialValidationFormat() },
            { name: 'Cache Functionality', test: () => this.testCacheFunctionality() },
            { name: 'Error Handling', test: () => this.testErrorHandling() },
            { name: 'State Management', test: () => this.testStateManagement() }
        ];

        // 运行基础测试
        for (const testCase of tests) {
            await this.runSingleTest(testCase.name, testCase.test);
        }

        // 运行模块特定测试
        await this.runModuleSpecificTests();

        // 运行集成测试
        if (!this.testConfig.skipIntegrationTests) {
            await this.runIntegrationTests();
        }

        this.endTime = Date.now();
        return this.generateTestReport();
    }

    /**
     * 运行单个测试
     */
    async runSingleTest(testName, testFunction, retries = 0) {
        const startTime = Date.now();
        try {
            this.logger.info(`  Running: ${testName}`);
            
            await Promise.race([
                testFunction(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Test timeout')), this.testConfig.timeout)
                )
            ]);
            
            const duration = Date.now() - startTime;
            this.testResults.push({
                name: testName,
                status: 'passed',
                duration,
                error: null
            });
            
            this.logger.info(`  ✅ ${testName} - PASSED (${duration}ms)`);
        } catch (error) {
            if (retries < this.testConfig.retries) {
                this.logger.warn(`  ⚠️  ${testName} - RETRY ${retries + 1}/${this.testConfig.retries}`);
                return this.runSingleTest(testName, testFunction, retries + 1);
            }
            
            const duration = Date.now() - startTime;
            this.testResults.push({
                name: testName,
                status: 'failed',
                duration,
                error: error.message
            });
            
            this.logger.error(`  ❌ ${testName} - FAILED: ${error.message}`);
        }
    }

    // =================
    // 基础测试用例
    // =================

    /**
     * 测试模块创建
     */
    async testModuleCreation() {
        const moduleDir = path.join(process.cwd(), 'modules', this.moduleName);
        this.moduleInstance = new this.ModuleClass(this.moduleName, moduleDir);
        
        this.assert(this.moduleInstance !== null, 'Module instance should be created');
        this.assert(this.moduleInstance.name === this.moduleName, 'Module name should be set correctly');
        this.assert(typeof this.moduleInstance.initialize === 'function', 'Module should have initialize method');
        this.assert(typeof this.moduleInstance.performValidation === 'function', 'Module should have performValidation method');
    }

    /**
     * 测试模块初始化
     */
    async testModuleInitialization() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        const result = await this.moduleInstance.initialize();
        
        this.assert(result.success === true, `Initialization should succeed: ${result.error || ''}`);
        this.assert(this.moduleInstance.initialized === true, 'Module should be marked as initialized');
    }

    /**
     * 测试配置加载
     */
    async testConfigurationLoading() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        this.assert(this.moduleInstance.initialized === true, 'Module must be initialized');
        
        const config = this.moduleInstance.config;
        this.assert(typeof config === 'object', 'Config should be an object');
        this.assert(config.timeout !== undefined, 'Config should have timeout setting');
        this.assert(config.retries !== undefined, 'Config should have retries setting');
    }

    /**
     * 测试Schema验证
     */
    async testSchemaValidation() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        const schema = this.moduleInstance.getCredentialSchema();
        this.assert(typeof schema === 'object', 'Schema should be an object');
        this.assert(schema.properties !== undefined, 'Schema should have properties');
        this.assert(typeof schema.properties === 'object', 'Schema properties should be an object');
        
        // 检查必需字段
        const requiredFields = schema.required || [];
        for (const field of requiredFields) {
            this.assert(schema.properties[field] !== undefined, `Required field ${field} should be defined in schema`);
        }
    }

    /**
     * 测试凭据存储
     */
    async testCredentialStorage() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        const testCredentials = this.getTestCredentials();
        const result = await this.moduleInstance.setCredentials(testCredentials);
        
        this.assert(result.success === true, `Credential storage should succeed: ${result.error || ''}`);
    }

    /**
     * 测试凭据检索
     */
    async testCredentialRetrieval() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        const result = await this.moduleInstance.getCredentials();
        
        this.assert(result.success === true, `Credential retrieval should succeed: ${result.error || ''}`);
        this.assert(typeof result.data === 'object', 'Retrieved credentials should be an object');
    }

    /**
     * 测试凭据格式验证
     */
    async testCredentialValidationFormat() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        // 测试空凭据
        const emptyResult = this.moduleInstance.validateCredentialsFormat({});
        if (this.moduleInstance.schema.required && this.moduleInstance.schema.required.length > 0) {
            this.assert(emptyResult.valid === false, 'Empty credentials should be invalid when required fields exist');
        }
        
        // 测试有效凭据
        const testCredentials = this.getTestCredentials();
        const validResult = this.moduleInstance.validateCredentialsFormat(testCredentials);
        this.assert(validResult.valid === true, `Valid credentials should pass format validation: ${validResult.error || ''}`);
        
        // 测试无效凭据
        const invalidCredentials = this.getInvalidTestCredentials();
        if (invalidCredentials) {
            const invalidResult = this.moduleInstance.validateCredentialsFormat(invalidCredentials);
            this.assert(invalidResult.valid === false, 'Invalid credentials should fail format validation');
        }
    }

    /**
     * 测试缓存功能
     */
    async testCacheFunctionality() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        // 清除缓存
        const clearResult = this.moduleInstance.clearCache();
        this.assert(clearResult.success === true, 'Cache clearing should succeed');
        
        // 检查缓存大小
        const initialCacheSize = this.moduleInstance.validationCache.size;
        this.assert(initialCacheSize === 0, 'Cache should be empty after clearing');
    }

    /**
     * 测试错误处理
     */
    async testErrorHandling() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        // 测试无效凭据验证
        try {
            const result = await this.moduleInstance.validateCredentials({ invalid: 'credentials' });
            this.assert(result.success === false, 'Invalid credentials should return failure result');
            this.assert(typeof result.error === 'string', 'Error message should be provided');
        } catch (error) {
            // 允许抛出异常，但应该有适当的错误信息
            this.assert(error.message !== undefined, 'Error should have a message');
        }
    }

    /**
     * 测试状态管理
     */
    async testStateManagement() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        // 测试启用/禁用
        const enableResult = await this.moduleInstance.enable();
        this.assert(enableResult.success === true, 'Module enabling should succeed');
        this.assert(this.moduleInstance.enabled === true, 'Module should be marked as enabled');
        
        const disableResult = await this.moduleInstance.disable();
        this.assert(disableResult.success === true, 'Module disabling should succeed');
        this.assert(this.moduleInstance.enabled === false, 'Module should be marked as disabled');
        
        // 测试状态获取
        const status = this.moduleInstance.getStatus();
        this.assert(typeof status === 'object', 'Status should be an object');
        this.assert(status.name === this.moduleName, 'Status should contain correct module name');
        this.assert(typeof status.enabled === 'boolean', 'Status should contain enabled flag');
        this.assert(typeof status.initialized === 'boolean', 'Status should contain initialized flag');
    }

    // =================
    // 集成测试
    // =================

    /**
     * 运行集成测试
     */
    async runIntegrationTests() {
        this.logger.info('🔄 Running integration tests...');
        
        const integrationTests = [
            { name: 'Full Workflow Test', test: () => this.testFullWorkflow() },
            { name: 'Concurrent Operations', test: () => this.testConcurrentOperations() },
            { name: 'Performance Test', test: () => this.testPerformance() }
        ];

        for (const testCase of integrationTests) {
            await this.runSingleTest(testCase.name, testCase.test);
        }
    }

    /**
     * 测试完整工作流程
     */
    async testFullWorkflow() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        // 1. 重新初始化
        await this.moduleInstance.initialize();
        
        // 2. 启用模块
        await this.moduleInstance.enable();
        
        // 3. 设置凭据
        const testCredentials = this.getTestCredentials();
        const setResult = await this.moduleInstance.setCredentials(testCredentials);
        this.assert(setResult.success === true, 'Setting credentials should succeed');
        
        // 4. 获取凭据
        const getResult = await this.moduleInstance.getCredentials();
        this.assert(getResult.success === true, 'Getting credentials should succeed');
        
        // 5. 验证凭据（如果有有效的测试凭据）
        if (this.hasValidTestCredentials()) {
            const validateResult = await this.moduleInstance.validateCredentials();
            this.assert(validateResult.success !== undefined, 'Validation should return a result');
        }
        
        // 6. 清除缓存
        this.moduleInstance.clearCache();
        
        // 7. 禁用模块
        await this.moduleInstance.disable();
    }

    /**
     * 测试并发操作
     */
    async testConcurrentOperations() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        // 并发获取凭据
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(this.moduleInstance.getCredentials());
        }
        
        const results = await Promise.all(promises);
        for (const result of results) {
            this.assert(result.success !== undefined, 'Concurrent operations should complete');
        }
    }

    /**
     * 测试性能
     */
    async testPerformance() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        const iterations = 10;
        const startTime = Date.now();
        
        for (let i = 0; i < iterations; i++) {
            await this.moduleInstance.getCredentials();
        }
        
        const endTime = Date.now();
        const avgTime = (endTime - startTime) / iterations;
        
        // 平均响应时间不应超过100ms
        this.assert(avgTime < 100, `Average response time (${avgTime}ms) should be under 100ms`);
    }

    // =================
    // 模块特定测试（子类可重写）
    // =================

    /**
     * 运行模块特定测试（子类应该重写此方法）
     */
    async runModuleSpecificTests() {
        this.logger.info('🎯 Running module-specific tests...');
        // 子类应该重写此方法来实现特定于模块的测试
    }

    /**
     * 获取测试凭据（子类应该重写此方法）
     */
    getTestCredentials() {
        // 子类应该重写此方法来提供有效的测试凭据
        return {};
    }

    /**
     * 获取无效测试凭据（子类可选重写此方法）
     */
    getInvalidTestCredentials() {
        // 子类可以重写此方法来提供无效的测试凭据
        return null;
    }

    /**
     * 检查是否有有效的测试凭据
     */
    hasValidTestCredentials() {
        const credentials = this.getTestCredentials();
        return credentials && Object.keys(credentials).length > 0;
    }

    // =================
    // 辅助方法
    // =================

    /**
     * 断言函数
     */
    assert(condition, message) {
        if (!condition) {
            throw new Error(message || 'Assertion failed');
        }
    }

    /**
     * 生成测试报告
     */
    generateTestReport() {
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.status === 'passed').length;
        const failedTests = this.testResults.filter(r => r.status === 'failed').length;
        const totalDuration = this.endTime - this.startTime;
        
        const report = {
            module: this.moduleName,
            summary: {
                total: totalTests,
                passed: passedTests,
                failed: failedTests,
                success_rate: Math.round((passedTests / totalTests) * 100),
                duration: totalDuration
            },
            results: this.testResults,
            timestamp: new Date().toISOString()
        };
        
        // 输出测试结果
        this.logger.info(`\n📊 Test Report for ${this.moduleName}:`);
        this.logger.info(`   Total Tests: ${totalTests}`);
        this.logger.info(`   Passed: ${passedTests} ✅`);
        this.logger.info(`   Failed: ${failedTests} ❌`);
        this.logger.info(`   Success Rate: ${report.summary.success_rate}%`);
        this.logger.info(`   Duration: ${totalDuration}ms\n`);
        
        if (failedTests > 0) {
            this.logger.error('Failed Tests:');
            this.testResults
                .filter(r => r.status === 'failed')
                .forEach(r => this.logger.error(`   - ${r.name}: ${r.error}`));
        }
        
        return report;
    }

    /**
     * 保存测试报告
     */
    async saveTestReport(report, outputDir = './test-reports') {
        try {
            await fs.mkdir(outputDir, { recursive: true });
            
            const filename = `${this.moduleName}-test-report-${Date.now()}.json`;
            const filepath = path.join(outputDir, filename);
            
            await fs.writeFile(filepath, JSON.stringify(report, null, 2));
            this.logger.info(`📁 Test report saved: ${filepath}`);
            
            return filepath;
        } catch (error) {
            this.logger.error('Failed to save test report:', error);
            return null;
        }
    }

    /**
     * 创建日志器
     */
    createLogger() {
        return {
            info: (message, ...args) => {
                console.log(`[TEST][${this.moduleName}] ${message}`, ...args);
            },
            warn: (message, ...args) => {
                console.warn(`[TEST][${this.moduleName}] ${message}`, ...args);
            },
            error: (message, ...args) => {
                console.error(`[TEST][${this.moduleName}] ${message}`, ...args);
            }
        };
    }
}

module.exports = BaseModuleTest;