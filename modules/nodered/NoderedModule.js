const BaseCredentialModule = require('../../core/BaseCredentialModule');
const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const FormData = require('form-data');

/**
 * NodeRedModule - Node-RED flow management module
 * 支持flow上传、部署、验证和备份功能
 */
class NodeRedModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        
        // Node-RED API配置
        this.apiBaseUrl = 'http://localhost:1880';
        this.defaultTimeout = 15000;
        
        // Flow管理配置
        this.flows = new Map();
        this.backups = new Map();
        this.lastBackup = null;
        
        // 请求清理
        this.activeRequests = new Set();
        this.requestCleanupTimer = null;
    }

    /**
     * 模块特定初始化
     */
    async onInitialize() {
        this.logger.info('Node-RED module initializing...');
        
        if (!this.config.timeout) {
            this.config.timeout = this.defaultTimeout;
        }
        
        // 设置请求清理定时器
        this.setupRequestCleanup();
        
        this.logger.info('Node-RED module initialized');
    }

    /**
     * 执行Node-RED连接验证
     */
    async performValidation(credentials) {
        const { base_url, username, password, api_key } = credentials;
        
        if (!base_url) {
            return {
                success: false,
                error: 'Base URL is required',
                details: { field: 'base_url' }
            };
        }

        try {
            this.logger.info('Validating Node-RED connection...');
            
            // 测试连接
            const connectionTest = await this.testConnection(base_url, username, password, api_key);
            
            if (connectionTest.success) {
                return {
                    success: true,
                    message: 'Node-RED connection successful',
                    data: {
                        node_red: {
                            version: connectionTest.data.version,
                            connected: true,
                            authenticated: connectionTest.data.authenticated
                        },
                        validated_at: new Date().toISOString()
                    }
                };
            } else {
                return {
                    success: false,
                    error: connectionTest.error,
                    details: { connection: false }
                };
            }
        } catch (error) {
            this.logger.error('Node-RED validation failed:', error);
            return {
                success: false,
                error: `Validation failed: ${error.message}`,
                details: { error: error.message }
            };
        }
    }

    /**
     * 测试Node-RED连接
     */
    async testConnection(baseUrl, username, password, apiKey) {
        try {
            const url = new URL('/flows', baseUrl);
            const options = {
                method: 'GET',
                timeout: this.config.timeout,
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            // 添加认证
            if (apiKey) {
                options.headers['Authorization'] = `Bearer ${apiKey}`;
            } else if (username && password) {
                const auth = Buffer.from(`${username}:${password}`).toString('base64');
                options.headers['Authorization'] = `Basic ${auth}`;
            }

            const response = await this.makeRequest(url, options);
            
            if (response.statusCode === 200) {
                const data = JSON.parse(response.data);
                return {
                    success: true,
                    data: {
                        version: response.headers['x-node-red-version'] || 'unknown',
                        authenticated: true,
                        flows: data.length
                    }
                };
            } else if (response.statusCode === 401) {
                return {
                    success: false,
                    error: 'Authentication failed - check credentials'
                };
            } else {
                return {
                    success: false,
                    error: `Connection failed with status ${response.statusCode}`
                };
            }
        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                return {
                    success: false,
                    error: 'Cannot connect to Node-RED - is it running?'
                };
            }
            return {
                success: false,
                error: `Connection test failed: ${error.message}`
            };
        }
    }

    /**
     * 获取当前flows
     */
    async getFlows(credentials) {
        try {
            const { base_url, username, password, api_key } = credentials;
            const url = new URL('/flows', base_url);
            
            const options = {
                method: 'GET',
                timeout: this.config.timeout,
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            // 添加认证
            if (api_key) {
                options.headers['Authorization'] = `Bearer ${api_key}`;
            } else if (username && password) {
                const auth = Buffer.from(`${username}:${password}`).toString('base64');
                options.headers['Authorization'] = `Basic ${auth}`;
            }

            const response = await this.makeRequest(url, options);
            
            if (response.statusCode === 200) {
                const flows = JSON.parse(response.data);
                return {
                    success: true,
                    data: flows,
                    message: `Retrieved ${flows.length} flows`
                };
            } else {
                return {
                    success: false,
                    error: `Failed to get flows: ${response.statusCode}`
                };
            }
        } catch (error) {
            return {
                success: false,
                error: `Error getting flows: ${error.message}`
            };
        }
    }

    /**
     * 部署flows
     */
    async deployFlows(credentials, flows) {
        try {
            const { base_url, username, password, api_key } = credentials;
            
            // 自动备份
            if (this.config.flowManagement?.autoBackup) {
                await this.backupFlows(credentials);
            }
            
            const url = new URL('/flows', base_url);
            const options = {
                method: 'POST',
                timeout: this.config.timeout,
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            // 添加认证
            if (api_key) {
                options.headers['Authorization'] = `Bearer ${api_key}`;
            } else if (username && password) {
                const auth = Buffer.from(`${username}:${password}`).toString('base64');
                options.headers['Authorization'] = `Basic ${auth}`;
            }

            const response = await this.makeRequest(url, options, JSON.stringify(flows));
            
            if (response.statusCode === 200) {
                return {
                    success: true,
                    message: 'Flows deployed successfully',
                    data: {
                        deployed_at: new Date().toISOString(),
                        flow_count: flows.length
                    }
                };
            } else {
                return {
                    success: false,
                    error: `Deployment failed: ${response.statusCode}`
                };
            }
        } catch (error) {
            return {
                success: false,
                error: `Error deploying flows: ${error.message}`
            };
        }
    }

    /**
     * 验证flow格式
     */
    async validateFlow(flow) {
        try {
            // 基本格式验证
            if (!Array.isArray(flow)) {
                return {
                    success: false,
                    error: 'Flow must be an array of nodes'
                };
            }

            const errors = [];
            const warnings = [];

            for (let i = 0; i < flow.length; i++) {
                const node = flow[i];
                
                // 检查必需字段
                if (!node.id) {
                    errors.push(`Node ${i}: Missing id field`);
                }
                if (!node.type) {
                    errors.push(`Node ${i}: Missing type field`);
                }
                if (!node.x && node.x !== 0) {
                    errors.push(`Node ${i}: Missing x coordinate`);
                }
                if (!node.y && node.y !== 0) {
                    errors.push(`Node ${i}: Missing y coordinate`);
                }

                // 检查节点类型
                if (node.type && !node.type.includes('.')) {
                    warnings.push(`Node ${i}: Type "${node.type}" may not be a valid Node-RED node type`);
                }
            }

            if (errors.length > 0) {
                return {
                    success: false,
                    error: 'Flow validation failed',
                    details: { errors, warnings }
                };
            }

            return {
                success: true,
                message: 'Flow validation passed',
                data: {
                    node_count: flow.length,
                    warnings: warnings.length,
                    validated_at: new Date().toISOString()
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Validation error: ${error.message}`
            };
        }
    }

    /**
     * 备份flows
     */
    async backupFlows(credentials) {
        try {
            const flowsResult = await this.getFlows(credentials);
            
            if (!flowsResult.success) {
                return {
                    success: false,
                    error: 'Failed to get flows for backup'
                };
            }

            const backup = {
                flows: flowsResult.data,
                timestamp: new Date().toISOString(),
                version: '1.0'
            };

            const backupId = `backup_${Date.now()}`;
            this.backups.set(backupId, backup);
            this.lastBackup = backupId;

            // 保存到文件
            const backupDir = path.join(this.dataDir, 'backups');
            await fs.mkdir(backupDir, { recursive: true });
            
            const backupFile = path.join(backupDir, `${backupId}.json`);
            await fs.writeFile(backupFile, JSON.stringify(backup, null, 2));

            // 清理旧备份
            await this.cleanupOldBackups();

            return {
                success: true,
                message: 'Backup created successfully',
                data: {
                    backup_id: backupId,
                    flow_count: flowsResult.data.length,
                    timestamp: backup.timestamp
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Backup failed: ${error.message}`
            };
        }
    }

    /**
     * 恢复flows
     */
    async restoreFlows(credentials, backupId) {
        try {
            let backup;
            
            if (this.backups.has(backupId)) {
                backup = this.backups.get(backupId);
            } else {
                // 从文件加载
                const backupFile = path.join(this.dataDir, 'backups', `${backupId}.json`);
                const backupData = await fs.readFile(backupFile, 'utf8');
                backup = JSON.parse(backupData);
            }

            const deployResult = await this.deployFlows(credentials, backup.flows);
            
            if (deployResult.success) {
                return {
                    success: true,
                    message: 'Flows restored successfully',
                    data: {
                        backup_id: backupId,
                        restored_at: new Date().toISOString(),
                        flow_count: backup.flows.length
                    }
                };
            } else {
                return {
                    success: false,
                    error: `Restore failed: ${deployResult.error}`
                };
            }
        } catch (error) {
            return {
                success: false,
                error: `Restore error: ${error.message}`
            };
        }
    }

    /**
     * 上传flow文件
     */
    async uploadFlow(credentials, flowData, filename) {
        try {
            // 验证flow格式
            const validation = await this.validateFlow(flowData);
            if (!validation.success) {
                return {
                    success: false,
                    error: 'Flow validation failed',
                    details: validation.details
                };
            }

            // 部署flows
            const deployResult = await this.deployFlows(credentials, flowData);
            
            if (deployResult.success) {
                return {
                    success: true,
                    message: `Flow "${filename}" uploaded and deployed successfully`,
                    data: {
                        filename,
                        deployed_at: new Date().toISOString(),
                        flow_count: flowData.length,
                        validation: validation.data
                    }
                };
            } else {
                return {
                    success: false,
                    error: `Deployment failed: ${deployResult.error}`
                };
            }
        } catch (error) {
            return {
                success: false,
                error: `Upload error: ${error.message}`
            };
        }
    }

    /**
     * 获取备份列表
     */
    async getBackups() {
        try {
            const backupList = Array.from(this.backups.entries()).map(([id, backup]) => ({
                id,
                timestamp: backup.timestamp,
                flow_count: backup.flows.length,
                version: backup.version
            }));

            return {
                success: true,
                data: backupList,
                message: `Found ${backupList.length} backups`
            };
        } catch (error) {
            return {
                success: false,
                error: `Error getting backups: ${error.message}`
            };
        }
    }

    /**
     * 清理旧备份
     */
    async cleanupOldBackups() {
        try {
            const maxBackups = this.config.flowManagement?.maxBackups || 10;
            
            if (this.backups.size <= maxBackups) {
                return;
            }

            // 按时间排序，删除最旧的
            const sortedBackups = Array.from(this.backups.entries())
                .sort((a, b) => new Date(a[1].timestamp) - new Date(b[1].timestamp));

            const toDelete = sortedBackups.slice(0, this.backups.size - maxBackups);
            
            for (const [id] of toDelete) {
                this.backups.delete(id);
                
                // 删除文件
                const backupFile = path.join(this.dataDir, 'backups', `${id}.json`);
                try {
                    await fs.unlink(backupFile);
                } catch (error) {
                    this.logger.warn(`Failed to delete backup file ${backupFile}:`, error.message);
                }
            }

            this.logger.info(`Cleaned up ${toDelete.length} old backups`);
        } catch (error) {
            this.logger.error('Error cleaning up backups:', error);
        }
    }

    /**
     * 设置请求清理
     */
    setupRequestCleanup() {
        this.requestCleanupTimer = setInterval(() => {
            this.activeRequests.forEach((request, key) => {
                if (request.destroyed || request.complete) {
                    this.activeRequests.delete(key);
                }
            });
        }, 30000); // 每30秒清理一次
    }

    /**
     * 发起HTTP请求
     */
    makeRequest(url, options, data = null) {
        return new Promise((resolve, reject) => {
            const isHttps = url.protocol === 'https:';
            const httpModule = isHttps ? https : http;
            
            const request = httpModule.request(url, options, (response) => {
                let responseData = '';
                
                response.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                response.on('end', () => {
                    resolve({
                        statusCode: response.statusCode,
                        headers: response.headers,
                        data: responseData
                    });
                });
            });
            
            request.on('error', (error) => {
                reject(error);
            });
            
            request.on('timeout', () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });
            
            if (data) {
                request.write(data);
            }
            
            request.end();
            
            // 添加到活跃请求集合
            this.activeRequests.add(request);
        });
    }

    /**
     * 清理资源
     */
    async cleanup() {
        if (this.requestCleanupTimer) {
            clearInterval(this.requestCleanupTimer);
        }
        
        // 取消所有活跃请求
        this.activeRequests.forEach(request => {
            if (!request.destroyed) {
                request.destroy();
            }
        });
        this.activeRequests.clear();
    }
}

module.exports = NodeRedModule;
