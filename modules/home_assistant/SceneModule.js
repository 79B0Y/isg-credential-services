const https = require('https');
const http = require('http');

/**
 * SceneModule - Home Assistant场景管理模块
 * 负责场景查询、执行和创建操作
 */
class SceneModule {
    constructor(logger, baseModule) {
        this.logger = logger;
        this.baseModule = baseModule;
        this.defaultTimeout = 10000;
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
                            // 尝试解析JSON错误响应
                            let errorBody = responseData;
                            try {
                                errorBody = JSON.parse(responseData);
                            } catch (e) {
                                // 保持原始字符串
                            }
                            
                            this.logger.error(`[SCENE] HTTP ${res.statusCode}: ${responseData}`);
                            this.logger.error(`[SCENE] Response headers:`, JSON.stringify(res.headers, null, 2));
                            
                            resolve({
                                error: `HTTP ${res.statusCode}: ${res.statusMessage}`,
                                details: {
                                    statusCode: res.statusCode,
                                    statusMessage: res.statusMessage,
                                    body: errorBody,
                                    headers: res.headers
                                }
                            });
                        }
                    } catch (error) {
                        this.logger.error('[SCENE] Response处理错误:', error);
                        resolve({
                            error: 'Response parsing error',
                            details: { message: error.message }
                        });
                    }
                });
            });

            req.on('error', (error) => {
                this.logger.error('[SCENE] Request错误:', error);
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
                this.logger.error('[SCENE] Request超时');
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
     * 获取所有场景列表
     * 通过获取所有实体状态，过滤出domain为scene的实体
     */
    async getScenes(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            this.logger.info('[SCENE] 获取场景列表');

            // 获取所有实体状态
            const statesResult = await this.callHomeAssistantAPI(access_token, base_url, '/api/states');

            if (statesResult.error) {
                return { success: false, error: statesResult.error, details: statesResult.details };
            }

            // 过滤出场景实体
            const scenes = Array.isArray(statesResult) 
                ? statesResult.filter(entity => entity.entity_id && entity.entity_id.startsWith('scene.'))
                : [];

            // 整理场景信息
            const sceneList = scenes.map(scene => ({
                entity_id: scene.entity_id,
                name: scene.attributes?.friendly_name || scene.entity_id.replace('scene.', ''),
                state: scene.state,
                icon: scene.attributes?.icon || null,
                last_changed: scene.last_changed,
                last_updated: scene.last_updated,
                attributes: scene.attributes
            }));

            return {
                success: true,
                data: {
                    scenes: sceneList,
                    total_count: sceneList.length,
                    retrieved_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[SCENE] 获取场景列表失败:', error);
            return {
                success: false,
                error: 'Failed to get scenes',
                details: { message: error.message }
            };
        }
    }

    /**
     * 执行场景
     * @param {string} sceneId - 场景ID，格式如 "scene.romantic_lights"
     */
    async activateScene(sceneId, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            if (!sceneId) {
                return { success: false, error: 'Scene ID is required' };
            }

            // 验证场景ID格式
            if (!sceneId.includes('.')) {
                // 如果没有域前缀，自动添加
                sceneId = `scene.${sceneId}`;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            this.logger.info(`[SCENE] 执行场景: ${sceneId}`);

            // 调用 scene.turn_on 服务来激活场景
            const result = await this.callHomeAssistantAPI(
                access_token,
                base_url,
                '/api/services/scene/turn_on',
                'POST',
                { entity_id: sceneId }
            );

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            return {
                success: true,
                message: `Scene ${sceneId} activated successfully`,
                data: {
                    scene_id: sceneId,
                    result: result,
                    executed_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[SCENE] 执行场景失败:', error);
            return {
                success: false,
                error: 'Failed to activate scene',
                details: { message: error.message }
            };
        }
    }

    /**
     * 创建场景
     * @param {object} sceneData - 场景配置数据
     * @param {string} sceneData.scene_id - 场景ID（可选，自动生成）
     * @param {string} sceneData.name - 场景名称（可选）
     * @param {object} sceneData.entities - 实体状态配置
     * @param {boolean} sceneData.editable_in_ui - 是否需要在UI中可编辑（默认false）
     */
    async createScene(sceneData, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            if (!sceneData || typeof sceneData !== 'object') {
                return { 
                    success: false, 
                    error: 'Scene data is required',
                    example: {
                        scene_id: "scene.my_scene",
                        snapshot_entities: ["light.living_room", "light.bedroom"]
                    }
                };
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            this.logger.info('[SCENE] 创建场景');

            // 构建场景创建数据
            const createData = {};

            // 场景ID - Home Assistant的scene.create服务不需要scene.前缀，只需要场景名称
            if (sceneData.scene_id) {
                // 移除 scene. 前缀（如果存在）
                const sceneIdWithoutPrefix = sceneData.scene_id.startsWith('scene.') 
                    ? sceneData.scene_id.substring(6)  // 移除 'scene.' 前缀
                    : sceneData.scene_id;
                
                createData.scene_id = sceneIdWithoutPrefix;
                
                // 注意：scene.create API 不支持 unique_id 参数
                // unique_id 只能通过配置文件设置
            }

            // 场景友好名称 (Friendly Name)
            // 注意: Home Assistant的scene.create API不支持直接设置friendly_name
            // friendly_name会由Home Assistant根据scene_id自动生成
            // 我们保存这个值供AI Enhanced Scene模块使用
            if (sceneData.friendly_name) {
                this.logger.info(`[SCENE] 记录场景友好名称（供本地使用）: ${sceneData.friendly_name}`);
                // 不添加到createData中，因为API不支持
            }

            // 优先使用 entities（手动指定状态）模式 - 更精确
            if (sceneData.entities && Object.keys(sceneData.entities).length > 0) {
                createData.entities = sceneData.entities;
                this.logger.info('[SCENE] 使用 entities 模式（精确状态）');
                this.logger.info(`[SCENE] 包含 ${Object.keys(sceneData.entities).length} 个设备的精确状态`);
                
                // 记录每个设备的状态
                Object.entries(sceneData.entities).forEach(([entityId, state]) => {
                    this.logger.info(`[SCENE]   - ${entityId}: ${JSON.stringify(state)}`);
                });
            }
            // 如果没有 entities，则使用 snapshot_entities（快照模式）
            else if (sceneData.snapshot_entities) {
                // 验证并过滤有效的实体ID
                const validEntities = sceneData.snapshot_entities.filter(entityId => {
                    if (typeof entityId !== 'string' || !entityId.includes('.')) {
                        this.logger.warn(`[SCENE] 忽略无效的实体ID: ${entityId}`);
                        return false;
                    }
                    return true;
                });
                
                if (validEntities.length === 0) {
                    return {
                        success: false,
                        error: 'No valid entities to snapshot',
                        details: {
                            original_count: sceneData.snapshot_entities.length,
                            valid_count: 0
                        }
                    };
                }
                
                createData.snapshot_entities = validEntities;
                this.logger.info('[SCENE] 使用 snapshot_entities 模式（自动捕获当前状态）');
                this.logger.info(`[SCENE] 快照实体数量: ${validEntities.length}/${sceneData.snapshot_entities.length}`);
            }
            
            // 至少需要指定 entities 或 snapshot_entities 之一
            if (!createData.entities && !createData.snapshot_entities) {
                return {
                    success: false,
                    error: 'Either snapshot_entities or entities must be provided',
                    example: {
                        scene_id: "scene.my_scene",
                        snapshot_entities: ["light.living_room", "light.bedroom"]
                    }
                };
            }

            this.logger.info('[SCENE] 准备创建场景，数据:', JSON.stringify(createData, null, 2));

            // 调用 scene.create 服务
            const result = await this.callHomeAssistantAPI(
                access_token,
                base_url,
                '/api/services/scene/create',
                'POST',
                createData
            );

            this.logger.info('[SCENE] Home Assistant 返回结果:', JSON.stringify(result, null, 2));

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            return {
                success: true,
                message: 'Scene created successfully with precise device states',
                data: {
                    scene_data: createData,
                    friendly_name: sceneData.friendly_name || null,  // 返回请求的friendly_name
                    result: result,
                    created_at: new Date().toISOString(),
                    mode: createData.entities ? 'entities (precise)' : 'snapshot',
                    entity_count: createData.entities ? Object.keys(createData.entities).length : createData.snapshot_entities?.length || 0,
                    editable_in_ui: false,
                    note: createData.entities 
                        ? 'Scene created with precise device states from matched_devices data'
                        : 'Scene created with snapshot_entities (Home Assistant captures current state)'
                }
            };

        } catch (error) {
            this.logger.error('[SCENE] 创建场景失败:', error);
            return {
                success: false,
                error: 'Failed to create scene',
                details: { message: error.message }
            };
        }
    }

    /**
     * 批量执行场景
     * @param {array} sceneIds - 场景ID数组
     */
    async activateScenes(sceneIds, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            if (!Array.isArray(sceneIds) || sceneIds.length === 0) {
                return {
                    success: false,
                    error: 'Scene IDs array is required',
                    example: ["scene.romantic_lights", "scene.movie_time"]
                };
            }

            this.logger.info(`[SCENE] 批量执行 ${sceneIds.length} 个场景`);

            // 并行执行所有场景
            const results = await Promise.all(
                sceneIds.map(async (sceneId) => {
                    try {
                        const result = await this.activateScene(sceneId, credentials);
                        return {
                            scene_id: sceneId,
                            success: result.success,
                            result: result.success ? result.data : null,
                            error: result.success ? null : result.error
                        };
                    } catch (error) {
                        return {
                            scene_id: sceneId,
                            success: false,
                            error: error.message
                        };
                    }
                })
            );

            const successCount = results.filter(r => r.success).length;
            const failureCount = results.filter(r => !r.success).length;

            return {
                success: true,
                message: `Batch scene activation completed: ${successCount} succeeded, ${failureCount} failed`,
                data: {
                    total_scenes: sceneIds.length,
                    success_count: successCount,
                    failure_count: failureCount,
                    results: results,
                    executed_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[SCENE] 批量执行场景失败:', error);
            return {
                success: false,
                error: 'Failed to activate scenes',
                details: { message: error.message }
            };
        }
    }

    /**
     * 删除场景
     * @param {string} sceneId - 场景ID，格式如 "scene.my_scene"
     */
    async deleteScene(sceneId, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            if (!sceneId) {
                return { success: false, error: 'Scene ID is required' };
            }

            // 验证场景ID格式
            if (!sceneId.includes('.')) {
                // 如果没有域前缀，自动添加
                sceneId = `scene.${sceneId}`;
            }

            const { access_token, base_url } = credentials;
            if (!access_token || !base_url) {
                return { success: false, error: 'Access token and base URL are required' };
            }

            this.logger.info(`[SCENE] 删除场景: ${sceneId}`);

            // Home Assistant 删除场景的方式：
            // 1. 对于动态创建的场景（通过 scene.create），直接调用 scene.reload 后场景会消失
            // 2. 通过删除实体的状态来"隐藏"场景
            // 注意：Home Assistant 不提供直接删除场景的 API，这里我们尝试通过删除状态来实现
            
            // 方法1: 尝试使用 homeassistant.remove_entity（仅对支持的实体类型有效）
            let result = await this.callHomeAssistantAPI(
                access_token,
                base_url,
                '/api/services/homeassistant/remove_entity',
                'POST',
                { entity_id: sceneId }
            );
            
            // 如果方法1失败，尝试方法2: 直接删除实体状态
            if (result.error || (result.details && result.details.statusCode >= 400)) {
                this.logger.info(`[SCENE] 尝试通过删除状态来移除场景: ${sceneId}`);
                result = await this.callHomeAssistantAPI(
                    access_token,
                    base_url,
                    `/api/states/${sceneId}`,
                    'DELETE'
                );
            }

            if (result.error) {
                return { success: false, error: result.error, details: result.details };
            }

            return {
                success: true,
                message: `Scene ${sceneId} deleted successfully`,
                data: {
                    scene_id: sceneId,
                    result: result,
                    deleted_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[SCENE] 删除场景失败:', error);
            return {
                success: false,
                error: 'Failed to delete scene',
                details: { message: error.message }
            };
        }
    }

    /**
     * 批量删除场景
     * @param {array} sceneIds - 场景ID数组
     */
    async deleteScenes(sceneIds, credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.baseModule.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            if (!Array.isArray(sceneIds) || sceneIds.length === 0) {
                return {
                    success: false,
                    error: 'Scene IDs array is required',
                    example: ["scene.my_scene_1", "scene.my_scene_2"]
                };
            }

            this.logger.info(`[SCENE] 批量删除 ${sceneIds.length} 个场景`);

            // 并行删除所有场景
            const results = await Promise.all(
                sceneIds.map(async (sceneId) => {
                    try {
                        const result = await this.deleteScene(sceneId, credentials);
                        return {
                            scene_id: sceneId,
                            success: result.success,
                            result: result.success ? result.data : null,
                            error: result.success ? null : result.error
                        };
                    } catch (error) {
                        return {
                            scene_id: sceneId,
                            success: false,
                            error: error.message
                        };
                    }
                })
            );

            const successCount = results.filter(r => r.success).length;
            const failureCount = results.filter(r => !r.success).length;

            return {
                success: true,
                message: `Batch scene deletion completed: ${successCount} succeeded, ${failureCount} failed`,
                data: {
                    total_scenes: sceneIds.length,
                    success_count: successCount,
                    failure_count: failureCount,
                    results: results,
                    deleted_at: new Date().toISOString()
                }
            };

        } catch (error) {
            this.logger.error('[SCENE] 批量删除场景失败:', error);
            return {
                success: false,
                error: 'Failed to delete scenes',
                details: { message: error.message }
            };
        }
    }

    /**
     * 获取场景示例
     */
    getSceneExamples() {
        return {
            success: true,
            data: {
                query_example: "GET /api/home_assistant/home_assistant/scenes",
                activate_example: {
                    description: "执行单个场景",
                    endpoint: "POST /api/home_assistant/home_assistant/scene/activate",
                    body: {
                        scene_id: "scene.romantic_lights"
                    }
                },
                create_snapshot_example: {
                    description: "从当前设备状态创建场景（快照模式）",
                    endpoint: "POST /api/home_assistant/home_assistant/scene/create",
                    body: {
                        scene_id: "scene.my_custom_scene",
                        snapshot_entities: [
                            "light.living_room",
                            "light.bedroom",
                            "climate.living_room"
                        ]
                    }
                },
                create_manual_example: {
                    description: "手动指定设备状态创建场景",
                    endpoint: "POST /api/home_assistant/home_assistant/scene/create",
                    body: {
                        scene_id: "scene.movie_time",
                        entities: {
                            "light.living_room": {
                                "state": "on",
                                "brightness": 50,
                                "rgb_color": [255, 0, 0]
                            },
                            "light.bedroom": {
                                "state": "off"
                            }
                        }
                    }
                },
                batch_activate_example: {
                    description: "批量执行多个场景",
                    endpoint: "POST /api/home_assistant/home_assistant/scenes/activate",
                    body: [
                        "scene.romantic_lights",
                        "scene.movie_time"
                    ]
                },
                delete_example: {
                    description: "删除单个场景",
                    endpoint: "DELETE /api/home_assistant/home_assistant/scene/:scene_id",
                    path_params: {
                        scene_id: "scene.my_scene"
                    }
                },
                batch_delete_example: {
                    description: "批量删除多个场景",
                    endpoint: "POST /api/home_assistant/home_assistant/scenes/delete",
                    body: [
                        "scene.my_scene_1",
                        "scene.my_scene_2"
                    ]
                }
            }
        };
    }
}

module.exports = SceneModule;

