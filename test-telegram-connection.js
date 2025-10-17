#!/usr/bin/env node

/**
 * Telegram API 连接测试脚本
 * 用于诊断 Termux/PRoot 环境中的连接问题
 */

const https = require('https');
const http = require('http');

// 从环境变量或命令行参数获取 bot token
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.argv[2];

if (!BOT_TOKEN) {
    console.error('❌ 错误：请提供 Telegram Bot Token');
    console.error('');
    console.error('用法：');
    console.error('  node test-telegram-connection.js YOUR_BOT_TOKEN');
    console.error('或：');
    console.error('  TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN node test-telegram-connection.js');
    process.exit(1);
}

console.log('🔍 Telegram API 连接测试');
console.log('='.repeat(60));
console.log('');

// 测试配置
const tests = [
    {
        name: '基础配置 (默认)',
        options: {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${BOT_TOKEN}/getMe`,
            method: 'GET',
            headers: {
                'User-Agent': 'CredentialService/1.0'
            }
        }
    },
    {
        name: '添加 SNI',
        options: {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${BOT_TOKEN}/getMe`,
            method: 'GET',
            headers: {
                'User-Agent': 'CredentialService/1.0'
            },
            servername: 'api.telegram.org'
        }
    },
    {
        name: '禁用证书验证',
        options: {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${BOT_TOKEN}/getMe`,
            method: 'GET',
            headers: {
                'User-Agent': 'CredentialService/1.0'
            },
            servername: 'api.telegram.org',
            rejectUnauthorized: false
        }
    }
];

async function testConnection(config) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        console.log(`📡 测试: ${config.name}`);
        console.log(`   配置: ${JSON.stringify(config.options, null, 2).split('\n').join('\n   ')}`);
        
        const req = https.request(config.options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                const duration = Date.now() - startTime;
                try {
                    const json = JSON.parse(data);
                    if (json.ok) {
                        console.log(`   ✅ 成功! (${duration}ms)`);
                        console.log(`   Bot: ${json.result.first_name} (@${json.result.username})`);
                        console.log(`   状态码: ${res.statusCode}`);
                        console.log(`   TLS 版本: ${res.socket.getProtocol ? res.socket.getProtocol() : 'N/A'}`);
                        console.log(`   加密套件: ${res.socket.getCipher ? res.socket.getCipher().name : 'N/A'}`);
                    } else {
                        console.log(`   ❌ API 错误: ${json.description}`);
                    }
                } catch (e) {
                    console.log(`   ⚠️  响应解析错误: ${e.message}`);
                    console.log(`   响应数据: ${data.substring(0, 100)}`);
                }
                resolve(true);
            });
        });
        
        req.on('error', (error) => {
            const duration = Date.now() - startTime;
            console.log(`   ❌ 连接失败! (${duration}ms)`);
            console.log(`   错误类型: ${error.code || error.name}`);
            console.log(`   错误信息: ${error.message}`);
            resolve(false);
        });
        
        req.on('timeout', () => {
            console.log(`   ⏱️  超时!`);
            req.destroy();
            resolve(false);
        });
        
        req.setTimeout(30000);
        req.end();
    });
}

async function runTests() {
    console.log('🚀 开始测试...');
    console.log('');
    
    let successCount = 0;
    
    for (const test of tests) {
        const result = await testConnection(test);
        if (result) successCount++;
        console.log('');
        
        // 等待一下再进行下一个测试
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('='.repeat(60));
    console.log(`📊 测试完成: ${successCount}/${tests.length} 成功`);
    console.log('');
    
    if (successCount === 0) {
        console.log('❌ 所有测试都失败了！');
        console.log('');
        console.log('💡 可能的原因：');
        console.log('   1. Bot Token 不正确');
        console.log('   2. 网络连接问题');
        console.log('   3. DNS 解析失败');
        console.log('   4. 防火墙阻止');
        console.log('');
        console.log('🔧 排查步骤：');
        console.log('   1. 检查网络: ping api.telegram.org');
        console.log('   2. 检查 DNS: nslookup api.telegram.org');
        console.log('   3. 测试 TLS: openssl s_client -connect api.telegram.org:443');
        console.log('   4. 检查 Bot Token 格式 (应该是 123456:ABC-DEF...)');
    } else if (successCount < tests.length) {
        console.log('⚠️  部分测试失败');
        console.log('   建议使用成功的配置');
    } else {
        console.log('✅ 所有测试都成功！');
        console.log('   Telegram API 连接正常');
    }
}

// 运行测试
runTests().catch(error => {
    console.error('');
    console.error('💥 测试过程出错:', error);
    process.exit(1);
});

