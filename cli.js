#!/usr/bin/env node

/**
 * Credential Service CLI Tool
 * 提供命令行界面来管理凭据服务
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

class CredentialServiceCLI {
    constructor() {
        this.baseUrl = 'http://localhost:3000';
        this.colors = {
            reset: '\x1b[0m',
            bright: '\x1b[1m',
            red: '\x1b[31m',
            green: '\x1b[32m',
            yellow: '\x1b[33m',
            blue: '\x1b[34m',
            magenta: '\x1b[35m',
            cyan: '\x1b[36m'
        };
    }

    /**
     * 发送HTTP请求
     */
    async makeRequest(method, path, data = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.baseUrl);
            const options = {
                hostname: url.hostname,
                port: url.port || 3000,
                path: url.pathname + url.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            if (data) {
                const jsonData = JSON.stringify(data);
                options.headers['Content-Length'] = Buffer.byteLength(jsonData);
            }

            const req = http.request(options, (res) => {
                let responseData = '';
                
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        resolve({
                            statusCode: res.statusCode,
                            data: parsed
                        });
                    } catch (e) {
                        resolve({
                            statusCode: res.statusCode,
                            data: responseData
                        });
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            if (data) {
                req.write(JSON.stringify(data));
            }

            req.end();
        });
    }

    /**
     * 打印带颜色的文本
     */
    colorize(text, color) {
        return `${this.colors[color]}${text}${this.colors.reset}`;
    }

    /**
     * 显示帮助信息
     */
    showHelp() {
        console.log(this.colorize('🔐 Credential Service CLI Tool', 'bright'));
        console.log('');
        console.log('使用方法: node cli.js [命令] [选项]');
        console.log('');
        console.log('命令:');
        console.log('  status                   显示服务状态');
        console.log('  modules                  列出所有模块');
        console.log('  module <name>           显示特定模块信息');
        console.log('  enable <name>            启用模块');
        console.log('  disable <name>           禁用模块');
        console.log('  validate <name>          验证模块凭据');
        console.log('  test-connection <name>   测试模块连接');
        console.log('  credentials <name>       获取模块凭据');
        console.log('  set-credentials <name>   设置模块凭据');
        console.log('  reload <name>            重载模块');
        console.log('  health                   健康检查');
        console.log('  version                  显示版本信息');
        console.log('  help                     显示此帮助信息');
        console.log('');
        console.log('示例:');
        console.log('  node cli.js modules');
        console.log('  node cli.js module telegram');
        console.log('  node cli.js enable telegram');
        console.log('  node cli.js validate telegram');
        console.log('  node cli.js test-connection home_assistant');
    }

    /**
     * 显示服务状态
     */
    async showStatus() {
        try {
            console.log(this.colorize('📊 服务状态', 'blue'));
            console.log('');

            const response = await this.makeRequest('GET', '/api/status');
            
            if (response.statusCode === 200) {
                const status = response.data.data;
                
                console.log(this.colorize('服务信息:', 'green'));
                console.log(`  初始化状态: ${status.service.initialized ? this.colorize('已初始化', 'green') : this.colorize('未初始化', 'red')}`);
                console.log(`  运行时间: ${Math.floor(status.service.uptime)} 秒`);
                console.log(`  版本: ${status.service.version}`);
                console.log(`  内存使用: ${Math.round(status.service.memory.heapUsed / 1024 / 1024)} MB`);
                console.log('');

                console.log(this.colorize('模块管理器:', 'green'));
                console.log(`  总模块数: ${status.moduleManager.totalModules}`);
                console.log(`  已启用模块: ${status.moduleManager.enabledModules}`);
                console.log(`  已初始化模块: ${status.moduleManager.initializedModules}`);
                console.log('');

                console.log(this.colorize('配置管理器:', 'green'));
                console.log(`  状态: ${status.configManager.status}`);
            } else {
                console.log(this.colorize('❌ 无法获取服务状态', 'red'));
            }
        } catch (error) {
            console.log(this.colorize('❌ 连接服务失败:', 'red'), error.message);
        }
    }

    /**
     * 列出所有模块
     */
    async listModules() {
        try {
            console.log(this.colorize('📦 模块列表', 'blue'));
            console.log('');

            const response = await this.makeRequest('GET', '/api/modules');
            
            if (response.statusCode === 200) {
                const modules = response.data.data;
                const moduleNames = Object.keys(modules);
                
                if (moduleNames.length === 0) {
                    console.log(this.colorize('⚠️  未找到任何模块', 'yellow'));
                    return;
                }

                console.log(this.colorize(`找到 ${moduleNames.length} 个模块:`, 'green'));
                console.log('');

                for (const moduleName of moduleNames) {
                    const module = modules[moduleName];
                    const status = module.enabled ? this.colorize('已启用', 'green') : this.colorize('已禁用', 'red');
                    const initialized = module.initialized ? this.colorize('已初始化', 'green') : this.colorize('未初始化', 'red');
                    
                    console.log(`📦 ${this.colorize(moduleName, 'cyan')}`);
                    console.log(`   状态: ${status}`);
                    console.log(`   初始化: ${initialized}`);
                    console.log(`   名称: ${module.name || 'N/A'}`);
                    console.log(`   版本: ${module.version || 'N/A'}`);
                    console.log('');
                }
            } else {
                console.log(this.colorize('❌ 无法获取模块列表', 'red'));
            }
        } catch (error) {
            console.log(this.colorize('❌ 连接服务失败:', 'red'), error.message);
        }
    }

    /**
     * 显示特定模块信息
     */
    async showModule(moduleName) {
        try {
            console.log(this.colorize(`📦 模块信息: ${moduleName}`, 'blue'));
            console.log('');

            const response = await this.makeRequest('GET', `/api/modules/${moduleName}`);
            
            if (response.statusCode === 200) {
                const module = response.data.data;
                
                console.log(this.colorize('基本信息:', 'green'));
                console.log(`  名称: ${module.name || 'N/A'}`);
                console.log(`  版本: ${module.version || 'N/A'}`);
                console.log(`  状态: ${module.enabled ? this.colorize('已启用', 'green') : this.colorize('已禁用', 'red')}`);
                console.log(`  初始化: ${module.initialized ? this.colorize('已初始化', 'green') : this.colorize('未初始化', 'red')}`);
                console.log('');

                // 测试连接
                console.log(this.colorize('连接测试:', 'green'));
                try {
                    const testResponse = await this.makeRequest('POST', `/api/test-connection/${moduleName}`, {});
                    if (testResponse.statusCode === 200) {
                        console.log(`  连接: ${this.colorize('正常', 'green')}`);
                        if (testResponse.data.message) {
                            console.log(`  消息: ${testResponse.data.message}`);
                        }
                    } else {
                        console.log(`  连接: ${this.colorize('异常', 'red')} (HTTP ${testResponse.statusCode})`);
                    }
                } catch (error) {
                    console.log(`  连接: ${this.colorize('测试失败', 'red')} - ${error.message}`);
                }
                console.log('');

                // 验证凭据
                console.log(this.colorize('凭据验证:', 'green'));
                try {
                    const validateResponse = await this.makeRequest('POST', `/api/validate/${moduleName}`, {});
                    if (validateResponse.statusCode === 200) {
                        console.log(`  凭据: ${this.colorize('有效', 'green')}`);
                        if (validateResponse.data.message) {
                            console.log(`  消息: ${validateResponse.data.message}`);
                        }
                    } else {
                        console.log(`  凭据: ${this.colorize('无效或缺失', 'red')} (HTTP ${validateResponse.statusCode})`);
                    }
                } catch (error) {
                    console.log(`  凭据: ${this.colorize('验证失败', 'red')} - ${error.message}`);
                }

            } else if (response.statusCode === 404) {
                console.log(this.colorize(`❌ 模块 '${moduleName}' 不存在`, 'red'));
            } else {
                console.log(this.colorize('❌ 无法获取模块信息', 'red'));
            }
        } catch (error) {
            console.log(this.colorize('❌ 连接服务失败:', 'red'), error.message);
        }
    }

    /**
     * 启用模块
     */
    async enableModule(moduleName) {
        try {
            console.log(this.colorize(`🔧 启用模块: ${moduleName}`, 'blue'));
            
            const response = await this.makeRequest('PUT', `/api/modules/${moduleName}/enabled`, { enabled: true });
            
            if (response.statusCode === 200) {
                console.log(this.colorize('✅ 模块已启用', 'green'));
                if (response.data.message) {
                    console.log(`消息: ${response.data.message}`);
                }
            } else {
                console.log(this.colorize('❌ 启用模块失败', 'red'));
                if (response.data.error) {
                    console.log(`错误: ${response.data.error}`);
                }
            }
        } catch (error) {
            console.log(this.colorize('❌ 连接服务失败:', 'red'), error.message);
        }
    }

    /**
     * 禁用模块
     */
    async disableModule(moduleName) {
        try {
            console.log(this.colorize(`🔧 禁用模块: ${moduleName}`, 'blue'));
            
            const response = await this.makeRequest('PUT', `/api/modules/${moduleName}/enabled`, { enabled: false });
            
            if (response.statusCode === 200) {
                console.log(this.colorize('✅ 模块已禁用', 'green'));
                if (response.data.message) {
                    console.log(`消息: ${response.data.message}`);
                }
            } else {
                console.log(this.colorize('❌ 禁用模块失败', 'red'));
                if (response.data.error) {
                    console.log(`错误: ${response.data.error}`);
                }
            }
        } catch (error) {
            console.log(this.colorize('❌ 连接服务失败:', 'red'), error.message);
        }
    }

    /**
     * 验证模块凭据
     */
    async validateModule(moduleName) {
        try {
            console.log(this.colorize(`🔍 验证模块凭据: ${moduleName}`, 'blue'));
            
            const response = await this.makeRequest('POST', `/api/validate/${moduleName}`, { credentials: null });
            
            if (response.data.success) {
                console.log(this.colorize('✅ 凭据验证成功', 'green'));
                if (response.data.message) {
                    console.log(`消息: ${response.data.message}`);
                }
            } else {
                console.log(this.colorize('❌ 凭据验证失败', 'red'));
                if (response.data.error) {
                    console.log(`错误: ${response.data.error}`);
                }
            }
        } catch (error) {
            console.log(this.colorize('❌ 连接服务失败:', 'red'), error.message);
        }
    }

    /**
     * 测试模块连接
     */
    async testConnection(moduleName) {
        try {
            console.log(this.colorize(`🔗 测试模块连接: ${moduleName}`, 'blue'));
            
            const response = await this.makeRequest('POST', `/api/test-connection/${moduleName}`, {});
            
            if (response.data.success) {
                console.log(this.colorize('✅ 连接测试成功', 'green'));
                if (response.data.message) {
                    console.log(`消息: ${response.data.message}`);
                }
            } else {
                console.log(this.colorize('❌ 连接测试失败', 'red'));
                if (response.data.error) {
                    console.log(`错误: ${response.data.error}`);
                }
            }
        } catch (error) {
            console.log(this.colorize('❌ 连接服务失败:', 'red'), error.message);
        }
    }

    /**
     * 获取模块凭据
     */
    async getCredentials(moduleName) {
        try {
            console.log(this.colorize(`🔑 获取模块凭据: ${moduleName}`, 'blue'));
            
            const response = await this.makeRequest('GET', `/api/credentials/${moduleName}`);
            
            if (response.statusCode === 200) {
                console.log(this.colorize('✅ 凭据获取成功', 'green'));
                console.log('');
                console.log(this.colorize('凭据信息:', 'green'));
                
                // 隐藏敏感信息
                const credentials = response.data.data;
                const maskedCredentials = this.maskSensitiveData(credentials);
                
                console.log(JSON.stringify(maskedCredentials, null, 2));
            } else {
                console.log(this.colorize('❌ 凭据获取失败', 'red'));
                if (response.data.error) {
                    console.log(`错误: ${response.data.error}`);
                }
            }
        } catch (error) {
            console.log(this.colorize('❌ 连接服务失败:', 'red'), error.message);
        }
    }

    /**
     * 设置模块凭据
     */
    async setCredentials(moduleName, credentials) {
        try {
            console.log(this.colorize(`🔑 设置模块凭据: ${moduleName}`, 'blue'));
            
            const response = await this.makeRequest('PUT', `/api/credentials/${moduleName}`, credentials);
            
            if (response.statusCode === 200) {
                console.log(this.colorize('✅ 凭据设置成功', 'green'));
                if (response.data.message) {
                    console.log(`消息: ${response.data.message}`);
                }
            } else {
                console.log(this.colorize('❌ 凭据设置失败', 'red'));
                if (response.data.error) {
                    console.log(`错误: ${response.data.error}`);
                }
            }
        } catch (error) {
            console.log(this.colorize('❌ 连接服务失败:', 'red'), error.message);
        }
    }

    /**
     * 重载模块
     */
    async reloadModule(moduleName) {
        try {
            console.log(this.colorize(`🔄 重载模块: ${moduleName}`, 'blue'));
            
            const response = await this.makeRequest('POST', `/api/modules/${moduleName}/reload`);
            
            if (response.statusCode === 200) {
                console.log(this.colorize('✅ 模块重载成功', 'green'));
                if (response.data.message) {
                    console.log(`消息: ${response.data.message}`);
                }
            } else {
                console.log(this.colorize('❌ 模块重载失败', 'red'));
                if (response.data.error) {
                    console.log(`错误: ${response.data.error}`);
                }
            }
        } catch (error) {
            console.log(this.colorize('❌ 连接服务失败:', 'red'), error.message);
        }
    }

    /**
     * 健康检查
     */
    async healthCheck() {
        try {
            console.log(this.colorize('🏥 健康检查', 'blue'));
            console.log('');

            const response = await this.makeRequest('GET', '/api/health');
            
            if (response.statusCode === 200) {
                const health = response.data;
                console.log(this.colorize('✅ 服务健康', 'green'));
                console.log(`  状态: ${health.status}`);
                console.log(`  时间戳: ${health.timestamp}`);
                console.log(`  运行时间: ${Math.floor(health.uptime)} 秒`);
                console.log(`  版本: ${health.version}`);
                console.log(`  环境: ${health.environment}`);
            } else {
                console.log(this.colorize('❌ 服务不健康', 'red'));
            }
        } catch (error) {
            console.log(this.colorize('❌ 连接服务失败:', 'red'), error.message);
        }
    }

    /**
     * 显示版本信息
     */
    async showVersion() {
        try {
            console.log(this.colorize('📦 版本信息', 'blue'));
            console.log('');

            const response = await this.makeRequest('GET', '/api/health');
            
            if (response.statusCode === 200) {
                const health = response.data;
                console.log(`服务版本: ${health.version}`);
                console.log(`Node.js版本: ${process.version}`);
                console.log(`运行环境: ${health.environment}`);
            } else {
                console.log(this.colorize('❌ 无法获取版本信息', 'red'));
            }
        } catch (error) {
            console.log(this.colorize('❌ 连接服务失败:', 'red'), error.message);
        }
    }

    /**
     * 隐藏敏感数据
     */
    maskSensitiveData(data) {
        if (typeof data !== 'object' || data === null) {
            return data;
        }

        const masked = { ...data };
        const sensitiveKeys = ['password', 'token', 'key', 'secret', 'api_key', 'access_token', 'bot_token'];

        for (const key in masked) {
            if (sensitiveKeys.some(sensitiveKey => key.toLowerCase().includes(sensitiveKey))) {
                masked[key] = '***';
            } else if (typeof masked[key] === 'object') {
                masked[key] = this.maskSensitiveData(masked[key]);
            }
        }

        return masked;
    }

    /**
     * 运行CLI
     */
    async run() {
        const args = process.argv.slice(2);
        const command = args[0];

        if (!command || command === 'help') {
            this.showHelp();
            return;
        }

        switch (command) {
            case 'status':
                await this.showStatus();
                break;
            case 'modules':
                await this.listModules();
                break;
            case 'module':
                if (!args[1]) {
                    console.log(this.colorize('❌ 请指定模块名称', 'red'));
                    return;
                }
                await this.showModule(args[1]);
                break;
            case 'enable':
                if (!args[1]) {
                    console.log(this.colorize('❌ 请指定模块名称', 'red'));
                    return;
                }
                await this.enableModule(args[1]);
                break;
            case 'disable':
                if (!args[1]) {
                    console.log(this.colorize('❌ 请指定模块名称', 'red'));
                    return;
                }
                await this.disableModule(args[1]);
                break;
            case 'validate':
                if (!args[1]) {
                    console.log(this.colorize('❌ 请指定模块名称', 'red'));
                    return;
                }
                await this.validateModule(args[1]);
                break;
            case 'test-connection':
                if (!args[1]) {
                    console.log(this.colorize('❌ 请指定模块名称', 'red'));
                    return;
                }
                await this.testConnection(args[1]);
                break;
            case 'credentials':
                if (!args[1]) {
                    console.log(this.colorize('❌ 请指定模块名称', 'red'));
                    return;
                }
                await this.getCredentials(args[1]);
                break;
            case 'set-credentials':
                if (!args[1]) {
                    console.log(this.colorize('❌ 请指定模块名称', 'red'));
                    return;
                }
                // 这里需要从文件或标准输入读取凭据
                console.log(this.colorize('❌ 此功能需要从文件或标准输入读取凭据数据', 'red'));
                console.log('请使用Web界面或API来设置凭据');
                break;
            case 'reload':
                if (!args[1]) {
                    console.log(this.colorize('❌ 请指定模块名称', 'red'));
                    return;
                }
                await this.reloadModule(args[1]);
                break;
            case 'health':
                await this.healthCheck();
                break;
            case 'version':
                await this.showVersion();
                break;
            default:
                console.log(this.colorize(`❌ 未知命令: ${command}`, 'red'));
                console.log('');
                this.showHelp();
                break;
        }
    }
}

// 如果直接运行此文件，启动CLI
if (require.main === module) {
    const cli = new CredentialServiceCLI();
    cli.run().catch(error => {
        console.error('CLI运行失败:', error);
        process.exit(1);
    });
}

module.exports = CredentialServiceCLI;

