const BaseModuleTest = require('./BaseModuleTest');
const TelegramModule = require('../modules/telegram/TelegramModule');

/**
 * TelegramModuleTest - Telegram模块特定测试
 */
class TelegramModuleTest extends BaseModuleTest {
    constructor() {
        super('telegram', TelegramModule);
    }

    /**
     * 运行Telegram特定测试
     */
    async runModuleSpecificTests() {
        const telegramTests = [
            { name: 'Bot Token Format Validation', test: () => this.testBotTokenFormat() },
            { name: 'API Call Structure', test: () => this.testApiCallStructure() },
            { name: 'Error Response Handling', test: () => this.testErrorResponseHandling() },
            { name: 'Bot Info Retrieval', test: () => this.testBotInfoRetrieval() },
            { name: 'Connection Test Functionality', test: () => this.testConnectionTestFunctionality() },
            { name: 'Webhook Info Support', test: () => this.testWebhookInfoSupport() }
        ];

        for (const testCase of telegramTests) {
            await this.runSingleTest(testCase.name, testCase.test);
        }
    }

    /**
     * 测试Bot Token格式验证
     */
    async testBotTokenFormat() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        // 测试有效的token格式
        const validTokens = [
            '7515466050:AAEoO05o3pM2tJ33DltWQgPCSJNpNSBGcvQ',
            '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
        ];
        
        for (const token of validTokens) {
            const result = this.moduleInstance.validateCredentialsFormat({ bot_token: token });
            this.assert(result.valid === true, `Valid token format should pass: ${token}`);
        }
        
        // 测试无效的token格式
        const invalidTokens = [
            'invalid-token',
            '123456789',
            'ABCdefGHIjklMNOpqrsTUVwxyz',
            '123456789:',
            ':ABCdefGHIjklMNOpqrsTUVwxyz',
            '123456789-ABCdefGHIjklMNOpqrsTUVwxyz'
        ];
        
        for (const token of invalidTokens) {
            const result = this.moduleInstance.validateCredentialsFormat({ bot_token: token });
            this.assert(result.valid === false, `Invalid token format should fail: ${token}`);
        }
    }

    /**
     * 测试API调用结构
     */
    async testApiCallStructure() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        // 检查API调用方法存在
        this.assert(typeof this.moduleInstance.callTelegramAPI === 'function', 'callTelegramAPI method should exist');
        
        // 检查默认配置
        const config = this.moduleInstance.config;
        this.assert(config.apiBaseUrl === 'https://api.telegram.org', 'API base URL should be set correctly');
        this.assert(typeof config.timeout === 'number', 'Timeout should be a number');
        this.assert(config.timeout > 0, 'Timeout should be positive');
    }

    /**
     * 测试错误响应处理
     */
    async testErrorResponseHandling() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        // 测试空token
        const emptyTokenResult = await this.moduleInstance.performValidation({});
        this.assert(emptyTokenResult.success === false, 'Empty credentials should fail');
        this.assert(emptyTokenResult.error === 'Bot token is required', 'Should show correct error message');
        this.assert(emptyTokenResult.details.field === 'bot_token', 'Should identify the missing field');
        
        // 测试格式错误的token
        const invalidTokenResult = await this.moduleInstance.performValidation({ bot_token: 'invalid' });
        this.assert(invalidTokenResult.success === false, 'Invalid token format should fail validation');
    }

    /**
     * 测试Bot信息获取功能
     */
    async testBotInfoRetrieval() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        // 检查getBotInfo方法存在
        this.assert(typeof this.moduleInstance.getBotInfo === 'function', 'getBotInfo method should exist');
        
        // 测试无凭据情况
        const noCreds = await this.moduleInstance.getBotInfo();
        this.assert(noCreds.success === false, 'getBotInfo without credentials should fail');
    }

    /**
     * 测试连接测试功能
     */
    async testConnectionTestFunctionality() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        // 检查testConnection方法存在
        this.assert(typeof this.moduleInstance.testConnection === 'function', 'testConnection method should exist');
        
        // 测试无凭据情况
        const noCredsResult = await this.moduleInstance.testConnection();
        this.assert(noCredsResult.success === false, 'Connection test without credentials should fail');
        this.assert(noCredsResult.error === 'No credentials found', 'Should show correct error message');
    }

    /**
     * 测试Webhook信息支持
     */
    async testWebhookInfoSupport() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        // 检查配置中是否启用了webhook功能
        const config = this.moduleInstance.config;
        this.assert(config.features !== undefined, 'Features configuration should exist');
        this.assert(config.features.webhookInfo === true, 'Webhook info feature should be enabled');
    }

    /**
     * 测试Schema结构
     */
    async testSchemaValidation() {
        await super.testSchemaValidation();
        
        // Telegram特定schema验证
        const schema = this.moduleInstance.getCredentialSchema();
        
        // 检查bot_token字段
        this.assert(schema.properties.bot_token !== undefined, 'Schema should define bot_token field');
        this.assert(schema.properties.bot_token.type === 'string', 'bot_token should be string type');
        this.assert(schema.properties.bot_token.required === true, 'bot_token should be required');
        this.assert(schema.properties.bot_token.sensitive === true, 'bot_token should be marked as sensitive');
        this.assert(schema.properties.bot_token.pattern !== undefined, 'bot_token should have pattern validation');
        
        // 检查必需字段
        this.assert(schema.required.includes('bot_token'), 'bot_token should be in required fields');
    }

    /**
     * 获取测试凭据
     */
    getTestCredentials() {
        // 使用真实的bot token进行测试
        return {
            bot_token: '7515466050:AAEoO05o3pM2tJ33DltWQgPCSJNpNSBGcvQ'
        };
    }

    /**
     * 获取无效测试凭据
     */
    getInvalidTestCredentials() {
        return {
            bot_token: 'invalid-token-format'
        };
    }

    /**
     * 检查是否有有效的测试凭据（现在使用真实token）
     */
    hasValidTestCredentials() {
        // 返回true，因为我们现在有真实的token可以进行API调用测试
        return true;
    }

    /**
     * 测试完整工作流程（重写以避免实际API调用）
     */
    async testFullWorkflow() {
        this.assert(this.moduleInstance !== null, 'Module instance must exist');
        
        // 1. 重新初始化
        const initResult = await this.moduleInstance.initialize();
        this.assert(initResult.success === true, 'Initialization should succeed');
        
        // 2. 启用模块
        const enableResult = await this.moduleInstance.enable();
        this.assert(enableResult.success === true, 'Module enabling should succeed');
        
        // 3. 设置凭据
        const testCredentials = this.getTestCredentials();
        const setResult = await this.moduleInstance.setCredentials(testCredentials);
        this.assert(setResult.success === true, 'Setting credentials should succeed');
        
        // 4. 获取凭据
        const getResult = await this.moduleInstance.getCredentials();
        this.assert(getResult.success === true, 'Getting credentials should succeed');
        this.assert(getResult.data.bot_token === testCredentials.bot_token, 'Retrieved credentials should match set credentials');
        
        // 5. 测试格式验证
        const formatResult = this.moduleInstance.validateCredentialsFormat(testCredentials);
        this.assert(formatResult.valid === true, 'Test credentials should pass format validation');
        
        // 6. 清除缓存
        const cacheResult = this.moduleInstance.clearCache();
        this.assert(cacheResult.success === true, 'Cache clearing should succeed');
        
        // 7. 禁用模块
        const disableResult = await this.moduleInstance.disable();
        this.assert(disableResult.success === true, 'Module disabling should succeed');
    }
}

// 如果直接运行此文件，执行测试
if (require.main === module) {
    const test = new TelegramModuleTest();
    
    test.runAllTests()
        .then(report => {
            console.log('\n🎉 Test completed!');
            
            // 保存测试报告
            test.saveTestReport(report)
                .then(filepath => {
                    if (filepath) {
                        console.log(`📄 Report saved to: ${filepath}`);
                    }
                    
                    // 退出进程，使用适当的退出码
                    process.exit(report.summary.failed > 0 ? 1 : 0);
                });
        })
        .catch(error => {
            console.error('❌ Test execution failed:', error);
            process.exit(1);
        });
}

module.exports = TelegramModuleTest;