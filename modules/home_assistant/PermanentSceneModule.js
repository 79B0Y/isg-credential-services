const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');

/**
 * 简单的YAML序列化器（用于场景配置）
 */
function yamlStringify(scenes) {
    if (!Array.isArray(scenes)) {
        scenes = [scenes];
    }
    
    const lines = [];
    
    scenes.forEach((scene, index) => {
        // 场景开始
        lines.push(`- id: '${scene.id}'`);
        lines.push(`  name: ${scene.name}`);
        
        // 图标（可选）
        if (scene.icon) {
            lines.push(`  icon: ${scene.icon}`);
        }
        
        // entities
        lines.push(`  entities:`);
        Object.entries(scene.entities).forEach(([entityId, config]) => {
            lines.push(`    ${entityId}:`);
            Object.entries(config).forEach(([key, value]) => {
                if (Array.isArray(value)) {
                    lines.push(`      ${key}:`);
                    value.forEach(item => {
                        lines.push(`      - ${typeof item === 'string' ? item : JSON.stringify(item)}`);
                    });
                } else if (typeof value === 'string') {
                    lines.push(`      ${key}: ${value}`);
                } else {
                    lines.push(`      ${key}: ${value}`);
                }
            });
        });
        
        // metadata
        if (scene.metadata && Object.keys(scene.metadata).length > 0) {
            lines.push(`  metadata:`);
            Object.entries(scene.metadata).forEach(([entityId, meta]) => {
                lines.push(`    ${entityId}:`);
                Object.entries(meta).forEach(([key, value]) => {
                    lines.push(`      ${key}: ${value}`);
                });
            });
        }
    });
    
    return lines.join('\n');
}

/**
 * 简单的YAML解析器（用于读取场景配置）
 */
function yamlParse(content) {
    if (!content || content.trim() === '') {
        return [];
    }
    
    const lines = content.split('\n');
    const scenes = [];
    let currentScene = null;
    let currentEntity = null;
    let currentSection = null; // 'entities' or 'metadata'
    let currentMetadataEntity = null;
    
    lines.forEach(line => {
        const trimmed = line.trim();
        
        // 跳过空行和注释
        if (!trimmed || trimmed.startsWith('#')) {
            return;
        }
        
        // 新场景开始
        if (line.startsWith('- id:')) {
            if (currentScene) {
                scenes.push(currentScene);
            }
            currentScene = {
                id: trimmed.match(/id:\s*['"](.+)['"]/)?.[1] || '',
                entities: {},
                metadata: {}
            };
            currentSection = null;
            currentEntity = null;
            currentMetadataEntity = null;
        }
        else if (currentScene) {
            // 场景属性
            if (line.startsWith('  name:')) {
                currentScene.name = trimmed.replace('name:', '').trim();
            }
            else if (line.startsWith('  icon:')) {
                currentScene.icon = trimmed.replace('icon:', '').trim();
            }
            else if (line.startsWith('  entities:')) {
                currentSection = 'entities';
                currentEntity = null;
            }
            else if (line.startsWith('  metadata:')) {
                currentSection = 'metadata';
                currentMetadataEntity = null;
            }
            // 实体或metadata实体
            else if (line.startsWith('    ') && !line.startsWith('      ')) {
                const match = line.match(/^\s{4}([a-z_]+\.[a-z0-9_]+):/);
                if (match) {
                    if (currentSection === 'entities') {
                        currentEntity = match[1];
                        currentScene.entities[currentEntity] = {};
                    } else if (currentSection === 'metadata') {
                        currentMetadataEntity = match[1];
                        currentScene.metadata[currentMetadataEntity] = {};
                    }
                }
            }
            // 实体属性或metadata属性
            else if (line.startsWith('      ') && currentEntity && currentSection === 'entities') {
                const match = trimmed.match(/^([a-z_]+):\s*(.+)$/);
                if (match) {
                    const key = match[1];
                    let value = match[2];
                    
                    // 类型转换
                    if (value === 'true') value = true;
                    else if (value === 'false') value = false;
                    else if (!isNaN(value) && value !== '') value = Number(value);
                    
                    currentScene.entities[currentEntity][key] = value;
                }
            }
            else if (line.startsWith('      ') && currentMetadataEntity && currentSection === 'metadata') {
                const match = trimmed.match(/^([a-z_]+):\s*(.+)$/);
                if (match) {
                    const key = match[1];
                    let value = match[2];
                    
                    // 类型转换
                    if (value === 'true') value = true;
                    else if (value === 'false') value = false;
                    else if (!isNaN(value) && value !== '') value = Number(value);
                    
                    currentScene.metadata[currentMetadataEntity][key] = value;
                }
            }
        }
    });
    
    // 添加最后一个场景
    if (currentScene) {
        scenes.push(currentScene);
    }
    
    return scenes;
}

/**
 * PermanentSceneModule - 永久场景管理模块
 * 通过写入scene.yaml文件创建永久场景
 */
class PermanentSceneModule {
    constructor(logger, baseModule) {
        this.logger = logger;
        this.baseModule = baseModule;
        this.defaultTimeout = 30000;
    }

    /**
     * 调用Home Assistant API
     */
    async callHomeAssistantAPI(accessToken, baseUrl, endpoint, method = 'GET', data = null) {
        return new Promise((resolve, reject) => {
            const url = baseUrl.endsWith('/') ? baseUrl + endpoint.substring(1) : baseUrl + endpoint;
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            const headers = {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'CredentialService/1.0'
            };

            const postData = data ? JSON.stringify(data) : null;
            if (postData) {
                headers['Content-Length'] = Buffer.byteLength(postData);
            }

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: method,
                headers: headers,
                timeout: this.defaultTimeout,
                rejectUnauthorized: false
            };

            const req = httpModule.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            let result = responseData;
                            try {
                                result = JSON.parse(responseData);
                            } catch (parseError) {
                                // 如果不是JSON，返回原始字符串
                            }
                            resolve(result);
                        } else {
                            this.logger.error(`[PERMANENT-SCENE] HTTP ${res.statusCode}: ${responseData}`);
                            resolve({
                                error: `HTTP ${res.statusCode}: ${res.statusMessage}`,
                                details: {
                                    statusCode: res.statusCode,
                                    statusMessage: res.statusMessage,
                                    body: responseData
                                }
                            });
                        }
                    } catch (error) {
                        this.logger.error('[PERMANENT-SCENE] Response处理错误:', error);
                        resolve({
                            error: 'Response parsing error',
                            details: { message: error.message }
                        });
                    }
                });
            });

            req.on('error', (error) => {
                this.logger.error('[PERMANENT-SCENE] Request错误:', error);
                resolve({
                    error: 'Request failed',
                    details: {
                        message: error.message,
                        code: error.code
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy();
                this.logger.error('[PERMANENT-SCENE] Request超时');
                resolve({
                    error: 'Request timeout',
                    details: { timeout: this.defaultTimeout }
                });
            });

            if (postData) {
                req.write(postData);
            }

            req.end();
        });
    }

    /**
     * 获取Home Assistant配置路径
     */
    async getConfigPath(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            
            this.logger.info('[PERMANENT-SCENE] 读取Home Assistant配置路径');
            
            const config = await this.callHomeAssistantAPI(access_token, base_url, '/api/config');
            
            if (config.error) {
                return { success: false, error: config.error, details: config.details };
            }

            const configDir = config.config_dir || '/config';
            
            // 优先使用scenes.yaml（复数），如果不存在则使用scene.yaml（单数）
            const scenesYamlPath = path.join(configDir, 'scenes.yaml');
            const sceneYamlPath = path.join(configDir, 'scene.yaml');
            
            // 检查哪个文件存在或应该使用
            let targetPath = scenesYamlPath; // 默认使用scenes.yaml
            
            this.logger.info(`[PERMANENT-SCENE] 配置目录: ${configDir}`);
            this.logger.info(`[PERMANENT-SCENE] 场景配置路径: ${targetPath}`);

            return {
                success: true,
                data: {
                    config_dir: configDir,
                    scene_yaml_path: targetPath,
                    version: config.version,
                    location_name: config.location_name
                }
            };

        } catch (error) {
            this.logger.error('[PERMANENT-SCENE] 获取配置路径失败:', error);
            return {
                success: false,
                error: 'Failed to get config path',
                details: { message: error.message }
            };
        }
    }

    /**
     * 读取现有的scene.yaml文件
     */
    async readSceneYaml(sceneYamlPath) {
        try {
            const content = await fs.readFile(sceneYamlPath, 'utf-8');
            const scenes = yamlParse(content) || [];
            
            this.logger.info(`[PERMANENT-SCENE] 读取到 ${scenes.length} 个现有场景`);
            
            return {
                success: true,
                data: { scenes, content }
            };
        } catch (error) {
            if (error.code === 'ENOENT') {
                // 文件不存在，返回空数组
                this.logger.info('[PERMANENT-SCENE] scene.yaml不存在，将创建新文件');
                return {
                    success: true,
                    data: { scenes: [], content: '' }
                };
            }
            
            this.logger.error('[PERMANENT-SCENE] 读取scene.yaml失败:', error);
            return {
                success: false,
                error: 'Failed to read scene.yaml',
                details: { message: error.message }
            };
        }
    }

    /**
     * 获取实体的完整状态
     */
    async getEntityState(entityId, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return null;
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            
            const state = await this.callHomeAssistantAPI(
                access_token, 
                base_url, 
                `/api/states/${entityId}`
            );
            
            if (state.error) {
                this.logger.warn(`[PERMANENT-SCENE] 获取实体状态失败: ${entityId}`);
                return null;
            }
            
            return state;
        } catch (error) {
            this.logger.error(`[PERMANENT-SCENE] 获取实体状态异常: ${entityId}`, error);
            return null;
        }
    }

    /**
     * 生成场景配置（包含完整的设备属性）
     */
    async generateSceneConfig(sceneData, matchedDevices, credentials = null) {
        const sceneId = sceneData.scene_id || `${Date.now()}`;
        const sceneName = sceneData.scene_name || sceneData.name || 'New Scene';
        
        const sceneConfig = {
            id: sceneId,
            name: sceneName,
            entities: {},
            metadata: {}
        };

        // 添加图标（如果提供）
        if (sceneData.icon) {
            sceneConfig.icon = sceneData.icon;
        }

        // 处理每个设备
        if (matchedDevices && Array.isArray(matchedDevices)) {
            for (const device of matchedDevices) {
                if (!device.entity_id) {
                    continue;
                }

                const entityId = device.entity_id;
                const serviceData = device.service_data || {};
                const domain = entityId.split('.')[0];

                // 获取实体的完整状态（包含所有属性）
                const entityState = await this.getEntityState(entityId, credentials);
                
                if (!entityState) {
                    this.logger.warn(`[PERMANENT-SCENE] 无法获取实体状态: ${entityId}，使用基本配置`);
                    continue;
                }

                const attributes = entityState.attributes || {};
                const currentState = entityState.state;

                // 根据设备类型生成配置
                if (domain === 'light') {
                    const lightConfig = {};
                    
                    // 添加设备属性（与HA UI生成的格式一致）
                    if (attributes.min_color_temp_kelvin) {
                        lightConfig.min_color_temp_kelvin = attributes.min_color_temp_kelvin;
                    }
                    if (attributes.max_color_temp_kelvin) {
                        lightConfig.max_color_temp_kelvin = attributes.max_color_temp_kelvin;
                    }
                    if (attributes.min_mireds) {
                        lightConfig.min_mireds = attributes.min_mireds;
                    }
                    if (attributes.max_mireds) {
                        lightConfig.max_mireds = attributes.max_mireds;
                    }
                    if (attributes.friendly_name) {
                        lightConfig.friendly_name = attributes.friendly_name;
                    }
                    if (attributes.supported_features !== undefined) {
                        lightConfig.supported_features = attributes.supported_features;
                    }
                    
                    // 添加控制属性（用户指定的状态）
                    lightConfig.state = serviceData.state || currentState;
                    
                    if (serviceData.brightness !== undefined && serviceData.brightness !== null) {
                        lightConfig.brightness = serviceData.brightness;
                    } else if (attributes.brightness !== undefined) {
                        lightConfig.brightness = attributes.brightness;
                    }
                    
                    if (serviceData.color_temp !== undefined && serviceData.color_temp !== null) {
                        lightConfig.color_temp = serviceData.color_temp;
                    } else if (attributes.color_temp !== undefined) {
                        lightConfig.color_temp = attributes.color_temp;
                    }
                    
                    if (serviceData.hs_color) {
                        lightConfig.hs_color = serviceData.hs_color;
                    } else if (attributes.hs_color) {
                        lightConfig.hs_color = attributes.hs_color;
                    }
                    
                    if (serviceData.rgb_color) {
                        lightConfig.rgb_color = serviceData.rgb_color;
                    } else if (attributes.rgb_color) {
                        lightConfig.rgb_color = attributes.rgb_color;
                    }
                    
                    sceneConfig.entities[entityId] = lightConfig;
                    
                } else if (domain === 'climate') {
                    const climateConfig = {};
                    
                    // 添加设备属性
                    if (attributes.min_temp !== undefined) {
                        climateConfig.min_temp = attributes.min_temp;
                    }
                    if (attributes.max_temp !== undefined) {
                        climateConfig.max_temp = attributes.max_temp;
                    }
                    if (attributes.target_temp_step !== undefined) {
                        climateConfig.target_temp_step = attributes.target_temp_step;
                    }
                    if (attributes.current_temperature !== undefined) {
                        climateConfig.current_temperature = attributes.current_temperature;
                    }
                    if (attributes.friendly_name) {
                        climateConfig.friendly_name = attributes.friendly_name;
                    }
                    if (attributes.supported_features !== undefined) {
                        climateConfig.supported_features = attributes.supported_features;
                    }
                    
                    // 添加控制属性
                    climateConfig.state = serviceData.state || serviceData.hvac_mode || currentState;
                    
                    if (serviceData.temperature !== undefined) {
                        climateConfig.temperature = serviceData.temperature;
                    } else if (attributes.temperature !== undefined) {
                        climateConfig.temperature = attributes.temperature;
                    }
                    
                    if (serviceData.fan_mode) {
                        climateConfig.fan_mode = serviceData.fan_mode;
                    } else if (attributes.fan_mode) {
                        climateConfig.fan_mode = attributes.fan_mode;
                    }
                    
                    sceneConfig.entities[entityId] = climateConfig;
                    
                } else {
                    // 其他设备类型
                    const deviceConfig = {};
                    
                    // 复制所有属性
                    if (attributes.friendly_name) {
                        deviceConfig.friendly_name = attributes.friendly_name;
                    }
                    if (attributes.supported_features !== undefined) {
                        deviceConfig.supported_features = attributes.supported_features;
                    }
                    
                    // 添加状态
                    deviceConfig.state = serviceData.state || currentState;
                    
                    // 复制service_data中的其他属性
                    Object.keys(serviceData).forEach(key => {
                        if (key !== 'state' && serviceData[key] !== null && serviceData[key] !== undefined) {
                            deviceConfig[key] = serviceData[key];
                        }
                    });
                    
                    sceneConfig.entities[entityId] = deviceConfig;
                }

                // 添加metadata
                sceneConfig.metadata[entityId] = { entity_only: true };
            }
        }

        return sceneConfig;
    }

    /**
     * 写入scene.yaml文件
     */
    async writeSceneYaml(sceneYamlPath, scenes) {
        try {
            const yamlContent = yamlStringify(scenes);

            await fs.writeFile(sceneYamlPath, yamlContent, 'utf-8');
            
            this.logger.info(`[PERMANENT-SCENE] 成功写入 ${scenes.length} 个场景到 ${sceneYamlPath}`);
            
            return { success: true };
        } catch (error) {
            this.logger.error('[PERMANENT-SCENE] 写入scene.yaml失败:', error);
            return {
                success: false,
                error: 'Failed to write scene.yaml',
                details: { message: error.message }
            };
        }
    }

    /**
     * 检查配置合法性
     */
    async checkConfig(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            
            this.logger.info('[PERMANENT-SCENE] 检查配置合法性');
            
            const result = await this.callHomeAssistantAPI(
                access_token,
                base_url,
                '/api/config/core/check_config',
                'POST'
            );

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            this.logger.info('[PERMANENT-SCENE] 配置检查结果:', JSON.stringify(result));

            return {
                success: true,
                data: result
            };

        } catch (error) {
            this.logger.error('[PERMANENT-SCENE] 配置检查失败:', error);
            return {
                success: false,
                error: 'Failed to check config',
                details: { message: error.message }
            };
        }
    }

    /**
     * 重载配置和场景
     */
    async reloadConfig(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            
            this.logger.info('[PERMANENT-SCENE] 重载核心配置');
            
            // 1. 重载核心配置
            const coreReload = await this.callHomeAssistantAPI(
                access_token,
                base_url,
                '/api/services/homeassistant/reload_core_config',
                'POST'
            );

            if (coreReload.error) {
                this.logger.warn('[PERMANENT-SCENE] 核心配置重载失败:', coreReload.error);
            }

            // 2. 重载场景
            this.logger.info('[PERMANENT-SCENE] 重载场景配置');
            
            const sceneReload = await this.callHomeAssistantAPI(
                access_token,
                base_url,
                '/api/services/scene/reload',
                'POST'
            );

            if (sceneReload.error) {
                return { success: false, error: sceneReload.error, details: sceneReload.details };
            }

            this.logger.info('[PERMANENT-SCENE] 配置重载成功');

            return {
                success: true,
                data: {
                    core_reload: coreReload,
                    scene_reload: sceneReload
                }
            };

        } catch (error) {
            this.logger.error('[PERMANENT-SCENE] 配置重载失败:', error);
            return {
                success: false,
                error: 'Failed to reload config',
                details: { message: error.message }
            };
        }
    }

    /**
     * 创建永久场景（完整流程）
     */
    async createPermanentScene(sceneData, matchedDevices, credentials = null) {
        try {
            this.logger.info('[PERMANENT-SCENE] 开始创建永久场景');

            // 1. 获取配置路径
            const pathResult = await this.getConfigPath(credentials);
            if (!pathResult.success) {
                return pathResult;
            }

            const sceneYamlPath = pathResult.data.scene_yaml_path;

            // 2. 读取现有场景
            const readResult = await this.readSceneYaml(sceneYamlPath);
            if (!readResult.success) {
                return readResult;
            }

            const existingScenes = readResult.data.scenes;

            // 3. 生成新场景配置（获取完整的设备属性）
            const newScene = await this.generateSceneConfig(sceneData, matchedDevices, credentials);
            
            this.logger.info('[PERMANENT-SCENE] 生成场景配置:', JSON.stringify(newScene, null, 2));

            // 4. 检查是否已存在同ID场景，如果存在则更新
            const existingIndex = existingScenes.findIndex(s => s.id === newScene.id);
            if (existingIndex >= 0) {
                this.logger.info(`[PERMANENT-SCENE] 更新现有场景: ${newScene.id}`);
                existingScenes[existingIndex] = newScene;
            } else {
                this.logger.info(`[PERMANENT-SCENE] 添加新场景: ${newScene.id}`);
                existingScenes.push(newScene);
            }

            // 5. 写入文件
            const writeResult = await this.writeSceneYaml(sceneYamlPath, existingScenes);
            if (!writeResult.success) {
                return writeResult;
            }

            // 6. 检查配置
            const checkResult = await this.checkConfig(credentials);
            if (!checkResult.success) {
                this.logger.warn('[PERMANENT-SCENE] 配置检查失败，但继续重载');
            }

            // 7. 重载配置
            const reloadResult = await this.reloadConfig(credentials);
            if (!reloadResult.success) {
                return {
                    success: false,
                    error: 'Scene created but failed to reload',
                    details: reloadResult
                };
            }

            this.logger.info('[PERMANENT-SCENE] 永久场景创建成功');

            return {
                success: true,
                message: 'Permanent scene created successfully',
                data: {
                    scene_id: newScene.id,
                    scene_name: newScene.name,
                    scene_yaml_path: sceneYamlPath,
                    entity_count: Object.keys(newScene.entities).length,
                    config: newScene,
                    created_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[PERMANENT-SCENE] 创建永久场景失败:', error);
            return {
                success: false,
                error: 'Failed to create permanent scene',
                details: { message: error.message }
            };
        }
    }

    /**
     * 使用 Home Assistant API 删除实体
     */
    async removeEntityFromHA(sceneId, credentials) {
        const removalResults = {
            entity_removed: { success: false }
        };

        try {
            const { access_token, base_url } = credentials;
            
            this.logger.info(`[PERMANENT-SCENE] 尝试通过API删除实体: ${sceneId}`);
            
            // 调用 homeassistant.remove_entity 服务
            const result = await this.callHomeAssistantAPI(
                access_token,
                base_url,
                '/api/services/homeassistant/remove_entity',
                'POST',
                {
                    entity_id: sceneId
                }
            );

            if (result && !result.error) {
                this.logger.info(`[PERMANENT-SCENE] 成功通过API删除实体: ${sceneId}`);
                removalResults.entity_removed = { success: true };
            } else {
                this.logger.warn(`[PERMANENT-SCENE] API删除实体失败或实体不存在: ${sceneId}`);
                removalResults.entity_removed = { success: false, message: 'Entity not found or already removed' };
            }
        } catch (error) {
            this.logger.warn(`[PERMANENT-SCENE] API删除实体异常: ${error.message}`);
            removalResults.entity_removed = { success: false, error: error.message };
        }

        return removalResults;
    }

    /**
     * 清理storage中的场景数据（谨慎操作）
     * 只删除与指定场景相关的数据，不影响其他数据
     * 注意：这是备份清理，主要通过 HA API 删除实体
     */
    async cleanupStorageForScene(sceneId, configDir) {
        const cleanupResults = {
            restore_state: { success: false, cleaned: false },
            entity_registry: { success: false, cleaned: false }
        };

        try {
            // 1. 清理 core.restore_state
            const restoreStatePath = path.join(configDir, '.storage', 'core.restore_state');
            try {
                const restoreStateContent = await fs.readFile(restoreStatePath, 'utf-8');
                const restoreState = JSON.parse(restoreStateContent);
                
                if (restoreState.data && restoreState.data.states) {
                    const originalCount = restoreState.data.states.length;
                    
                    // ⚠️ 只删除场景相关的状态，保留其他所有数据
                    restoreState.data.states = restoreState.data.states.filter(state => {
                        return state.entity_id !== sceneId;
                    });
                    
                    const newCount = restoreState.data.states.length;
                    const removedCount = originalCount - newCount;
                    
                    if (removedCount > 0) {
                        // 更新版本号
                        restoreState.version = (restoreState.version || 1) + 1;
                        
                        await fs.writeFile(restoreStatePath, JSON.stringify(restoreState, null, 2), 'utf-8');
                        this.logger.info(`[PERMANENT-SCENE] 从core.restore_state删除 ${removedCount} 条场景状态`);
                        cleanupResults.restore_state = { success: true, cleaned: true, removed_count: removedCount };
                    } else {
                        this.logger.info(`[PERMANENT-SCENE] core.restore_state中未找到场景状态`);
                        cleanupResults.restore_state = { success: true, cleaned: false };
                    }
                } else {
                    cleanupResults.restore_state = { success: true, cleaned: false, message: 'No states data' };
                }
            } catch (err) {
                if (err.code === 'ENOENT') {
                    this.logger.info(`[PERMANENT-SCENE] core.restore_state文件不存在，跳过清理`);
                    cleanupResults.restore_state = { success: true, cleaned: false, message: 'File not found' };
                } else {
                    this.logger.error(`[PERMANENT-SCENE] 清理core.restore_state失败:`, err);
                    cleanupResults.restore_state = { success: false, error: err.message };
                }
            }

            // 2. 清理 core.entity_registry（强制清理，确保彻底删除）
            const entityRegistryPath = path.join(configDir, '.storage', 'core.entity_registry');
            let entityCleanupAttempts = 0;
            let entityCleanupSuccess = false;
            
            // 尝试多次确保删除成功
            while (!entityCleanupSuccess && entityCleanupAttempts < 3) {
                entityCleanupAttempts++;
                this.logger.info(`[PERMANENT-SCENE] 尝试清理实体注册表 (第${entityCleanupAttempts}次)`);
                
                try {
                    const entityRegistryContent = await fs.readFile(entityRegistryPath, 'utf-8');
                    const entityRegistry = JSON.parse(entityRegistryContent);
                    
                    if (entityRegistry.data && entityRegistry.data.entities) {
                        const originalCount = entityRegistry.data.entities.length;
                        
                        // 查找要删除的实体
                        const entitiesToRemove = entityRegistry.data.entities.filter(entity => 
                            entity.entity_id === sceneId
                        );
                        
                        if (entitiesToRemove.length > 0) {
                            this.logger.info(`[PERMANENT-SCENE] 找到 ${entitiesToRemove.length} 个匹配的实体，准备删除`);
                            entitiesToRemove.forEach(entity => {
                                this.logger.info(`[PERMANENT-SCENE] 删除实体注册: ${entity.entity_id} (platform: ${entity.platform}, unique_id: ${entity.unique_id})`);
                            });
                            
                            // ⚠️ 只删除场景实体，保留其他所有实体（空间、设备等）
                            entityRegistry.data.entities = entityRegistry.data.entities.filter(entity => {
                                return entity.entity_id !== sceneId;
                            });
                            
                            const newCount = entityRegistry.data.entities.length;
                            const removedCount = originalCount - newCount;
                            
                            // 更新版本号和修改时间
                            entityRegistry.version = (entityRegistry.version || 1) + 1;
                            
                            // 写入文件
                            await fs.writeFile(entityRegistryPath, JSON.stringify(entityRegistry, null, 2), 'utf-8');
                            this.logger.info(`[PERMANENT-SCENE] ✅ 成功从core.entity_registry删除 ${removedCount} 个场景实体`);
                            
                            // 等待一下让文件系统同步
                            await new Promise(resolve => setTimeout(resolve, 100));
                            
                            // 验证删除
                            const verifyContent = await fs.readFile(entityRegistryPath, 'utf-8');
                            const verifyRegistry = JSON.parse(verifyContent);
                            const stillExists = verifyRegistry.data.entities.some(e => e.entity_id === sceneId);
                            
                            if (stillExists) {
                                this.logger.warn(`[PERMANENT-SCENE] ⚠️  验证失败：实体仍在注册表中，将重试`);
                            } else {
                                this.logger.info(`[PERMANENT-SCENE] ✅ 验证成功：实体已从注册表中删除`);
                                entityCleanupSuccess = true;
                                cleanupResults.entity_registry = { 
                                    success: true, 
                                    cleaned: true, 
                                    removed_count: removedCount,
                                    attempts: entityCleanupAttempts,
                                    verified: true
                                };
                            }
                        } else {
                            this.logger.info(`[PERMANENT-SCENE] core.entity_registry中未找到场景实体`);
                            entityCleanupSuccess = true;
                            cleanupResults.entity_registry = { success: true, cleaned: false };
                        }
                    } else {
                        entityCleanupSuccess = true;
                        cleanupResults.entity_registry = { success: true, cleaned: false, message: 'No entities data' };
                    }
                } catch (err) {
                    if (err.code === 'ENOENT') {
                        this.logger.info(`[PERMANENT-SCENE] core.entity_registry文件不存在，跳过清理`);
                        entityCleanupSuccess = true;
                        cleanupResults.entity_registry = { success: true, cleaned: false, message: 'File not found' };
                    } else {
                        this.logger.error(`[PERMANENT-SCENE] 清理core.entity_registry失败 (尝试${entityCleanupAttempts}):`, err);
                        if (entityCleanupAttempts >= 3) {
                            cleanupResults.entity_registry = { success: false, error: err.message, attempts: entityCleanupAttempts };
                        } else {
                            // 等待后重试
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    }
                }
            }

        } catch (error) {
            this.logger.error('[PERMANENT-SCENE] Storage清理过程异常:', error);
        }

        return cleanupResults;
    }

    /**
     * 删除永久场景（完整流程）
     * 支持通过entity_id、scene_id或friendly_name删除
     */
    async deletePermanentScene(sceneId, credentials = null) {
        try {
            this.logger.info(`[PERMANENT-SCENE] 开始删除永久场景: ${sceneId}`);

            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            // 规范化场景ID（移除scene.前缀用于yaml文件）
            const sceneIdForYaml = sceneId.startsWith('scene.') 
                ? sceneId.substring(6)
                : sceneId;
            
            const fullSceneId = sceneId.includes('.') ? sceneId : `scene.${sceneId}`;

            // 1. 从Home Assistant获取场景信息（获取friendly_name）
            const { access_token, base_url } = credentials;
            let sceneFriendlyName = null;
            
            try {
                const sceneState = await this.callHomeAssistantAPI(
                    access_token,
                    base_url,
                    `/api/states/${fullSceneId}`
                );
                
                if (sceneState && !sceneState.error) {
                    sceneFriendlyName = sceneState.attributes?.friendly_name;
                    this.logger.info(`[PERMANENT-SCENE] 从HA获取场景名称: ${sceneFriendlyName}`);
                }
            } catch (err) {
                this.logger.warn(`[PERMANENT-SCENE] 无法从HA获取场景信息: ${err.message}`);
            }

            // 2. 获取配置路径
            const pathResult = await this.getConfigPath(credentials);
            if (!pathResult.success) {
                return pathResult;
            }

            const sceneYamlPath = pathResult.data.scene_yaml_path;
            const configDir = pathResult.data.config_dir;

            // 3. 读取现有场景
            const readResult = await this.readSceneYaml(sceneYamlPath);
            if (!readResult.success) {
                return readResult;
            }

            const existingScenes = readResult.data.scenes;
            
            this.logger.info(`[PERMANENT-SCENE] scenes.yaml中共有 ${existingScenes.length} 个场景`);
            this.logger.info(`[PERMANENT-SCENE] 现有场景列表: ${existingScenes.map(s => `${s.id} (${s.name})`).join(', ')}`);

            // 4. 查找并删除场景（支持多种匹配方式）
            let sceneIndex = -1;
            let matchMethod = '';
            
            // 方法1: 通过ID精确匹配
            sceneIndex = existingScenes.findIndex(s => s.id === sceneIdForYaml);
            if (sceneIndex !== -1) {
                matchMethod = 'ID精确匹配';
            }
            
            // 方法2: 通过完整的entity_id匹配（带scene.前缀）
            if (sceneIndex === -1) {
                sceneIndex = existingScenes.findIndex(s => `scene.${s.id}` === fullSceneId);
                if (sceneIndex !== -1) {
                    matchMethod = 'Entity ID匹配';
                }
            }
            
            // 方法3: 通过friendly_name匹配yaml中的name字段（关键！）
            if (sceneIndex === -1 && sceneFriendlyName) {
                sceneIndex = existingScenes.findIndex(s => s.name === sceneFriendlyName);
                if (sceneIndex !== -1) {
                    matchMethod = 'Friendly Name匹配（HA场景名称与YAML name匹配）';
                    this.logger.info(`[PERMANENT-SCENE] 通过friendly_name匹配成功: "${sceneFriendlyName}" -> yaml id: "${existingScenes[sceneIndex].id}"`);
                }
            }
            
            // 方法4: 通过name字段直接匹配（传入的可能就是中文名）
            if (sceneIndex === -1) {
                sceneIndex = existingScenes.findIndex(s => {
                    // 比较name字段
                    if (s.name === sceneIdForYaml || s.name === fullSceneId || s.name === sceneId) {
                        return true;
                    }
                    return false;
                });
                if (sceneIndex !== -1) {
                    matchMethod = 'Name字段匹配';
                }
            }
            
            if (sceneIndex === -1) {
                this.logger.warn(`[PERMANENT-SCENE] 未在scenes.yaml中找到匹配的场景`);
                this.logger.warn(`[PERMANENT-SCENE] 查找的场景ID: ${sceneIdForYaml}, 完整ID: ${fullSceneId}`);
                this.logger.warn(`[PERMANENT-SCENE] Friendly Name: ${sceneFriendlyName || '未获取'}`);
                this.logger.warn(`[PERMANENT-SCENE] 请检查场景ID是否正确，或scenes.yaml中的场景配置`);
                
                return {
                    success: false,
                    error: 'Scene not found in scenes.yaml',
                    details: {
                        searched_id: sceneIdForYaml,
                        full_id: fullSceneId,
                        friendly_name: sceneFriendlyName,
                        available_scenes: existingScenes.map(s => ({
                            id: s.id,
                            name: s.name,
                            entity_id: `scene.${s.id}`
                        }))
                    }
                };
            }
            
            const deletedScene = existingScenes[sceneIndex];
            this.logger.info(`[PERMANENT-SCENE] 找到匹配场景（${matchMethod}）: ID=${deletedScene.id}, Name=${deletedScene.name}`);
            this.logger.info(`[PERMANENT-SCENE] 从scenes.yaml删除场景`);
            
            existingScenes.splice(sceneIndex, 1);

            // 5. 写入更新后的文件
            const writeResult = await this.writeSceneYaml(sceneYamlPath, existingScenes);
            if (!writeResult.success) {
                return writeResult;
            }

            // 6. 使用 Home Assistant API 删除实体（重要！）
            this.logger.info(`[PERMANENT-SCENE] 通过API删除实体: ${fullSceneId}`);
            const entityRemoval = await this.removeEntityFromHA(fullSceneId, credentials);

            // 7. 清理storage中的场景数据（在重载前清理，确保彻底）
            this.logger.info(`[PERMANENT-SCENE] 清理storage中的场景数据: ${fullSceneId}`);
            const storageCleanup = await this.cleanupStorageForScene(fullSceneId, configDir);

            // 8. 重载配置以应用更改
            this.logger.info(`[PERMANENT-SCENE] 重载Home Assistant配置`);
            const reloadResult = await this.reloadConfig(credentials);
            if (!reloadResult.success) {
                this.logger.warn('[PERMANENT-SCENE] 配置重载失败，但场景已从文件中删除');
            }

            // 记录删除完成
            this.logger.info('[PERMANENT-SCENE] ✅ 永久场景删除完成');
            
            // 检查实体注册表清理结果
            if (storageCleanup.entity_registry?.cleaned) {
                this.logger.info('[PERMANENT-SCENE] ⚠️  已修改实体注册表，建议重启Home Assistant以确保彻底生效');
            }

            // 构建返回消息
            let statusMessage = 'Permanent scene deleted successfully';
            let recommendation = null;
            
            if (storageCleanup.entity_registry?.cleaned) {
                recommendation = '已修改实体注册表，建议重启Home Assistant以确保场景彻底删除';
            }

            return {
                success: true,
                message: statusMessage,
                data: {
                    scene_id: fullSceneId,
                    deleted_scene: {
                        id: deletedScene.id,
                        name: deletedScene.name
                    },
                    match_method: matchMethod,
                    yaml_path: sceneYamlPath,
                    deleted_from_yaml: true,
                    entity_removal: entityRemoval,
                    storage_cleanup: storageCleanup,
                    remaining_scenes: existingScenes.length,
                    deleted_at: new Date().toISOString(),
                    recommendation: recommendation
                }
            };

        } catch (error) {
            this.logger.error('[PERMANENT-SCENE] 删除永久场景失败:', error);
            return {
                success: false,
                error: 'Failed to delete permanent scene',
                details: { message: error.message }
            };
        }
    }
}

module.exports = PermanentSceneModule;

