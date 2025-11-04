const fs = require('fs').promises;
const path = require('path');
const BaseCredentialModule = require('../../core/BaseCredentialModule');

class AiEnhancedSceneModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        this.executePromptFile = path.join(this.dataDir, 'execute_prompt.txt');
        this.createPromptFile = path.join(this.dataDir, 'create_prompt.txt');
        this.deletePromptFile = path.join(this.dataDir, 'delete_prompt.txt');
        this.sceneConfigsFile = path.join(this.dataDir, 'scene_configs.json');
    }

    getDefaultConfig() {
        return {
            aiProvider: 'auto', // auto, claude, openai, gemini, deepseek
        };
    }

    getDefaultSchema() {
        return {
            type: 'object',
            properties: {},
        };
    }

    async onInitialize() {
        // Ensure data directory exists
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
        } catch (e) {
            this.logger.warn('Failed to create data directory:', e.message);
        }

        // Create default prompts if they don't exist
        await this.ensureDefaultPrompts();
        
        // Ensure scene configs file exists
        await this.ensureSceneConfigsFile();
    }

    /**
     * Ensure default prompts exist
     */
    async ensureDefaultPrompts() {
        const prompts = {
            [this.executePromptFile]: this.getDefaultExecutePrompt(),
            [this.createPromptFile]: this.getDefaultCreatePrompt(),
            [this.deletePromptFile]: this.getDefaultDeletePrompt()
        };

        for (const [file, content] of Object.entries(prompts)) {
            try {
                await fs.access(file);
            } catch {
                await fs.writeFile(file, content, 'utf-8');
                this.logger.info(`Created default prompt file: ${file}`);
            }
        }
    }

    /**
     * Ensure scene configs file exists
     */
    async ensureSceneConfigsFile() {
        try {
            await fs.access(this.sceneConfigsFile);
        } catch {
            const defaultConfig = {
                scenes: {},
                metadata: {
                    created_at: new Date().toISOString(),
                    last_updated: new Date().toISOString(),
                    version: '1.0.0'
                }
            };
            await fs.writeFile(this.sceneConfigsFile, JSON.stringify(defaultConfig, null, 2), 'utf-8');
            this.logger.info(`Created scene configs file: ${this.sceneConfigsFile}`);
        }
    }

    /**
     * Load scene configs from file
     */
    async loadSceneConfigs() {
        try {
            const content = await fs.readFile(this.sceneConfigsFile, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            this.logger.error('[AI Enhanced Scene] Failed to load scene configs:', error);
            return {
                scenes: {},
                metadata: {
                    created_at: new Date().toISOString(),
                    last_updated: new Date().toISOString(),
                    version: '1.0.0'
                }
            };
        }
    }

    /**
     * Save scene configs to file
     */
    async saveSceneConfigs(configs) {
        try {
            configs.metadata.last_updated = new Date().toISOString();
            await fs.writeFile(this.sceneConfigsFile, JSON.stringify(configs, null, 2), 'utf-8');
            return { success: true };
        } catch (error) {
            this.logger.error('[AI Enhanced Scene] Failed to save scene configs:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Save scene configuration
     */
    async saveSceneConfig(sceneId, config) {
        try {
            const configs = await this.loadSceneConfigs();
            
            configs.scenes[sceneId] = {
                ...config,
                last_modified: new Date().toISOString()
            };
            
            const saveResult = await this.saveSceneConfigs(configs);
            if (!saveResult.success) {
                return { success: false, error: saveResult.error };
            }
            
            this.logger.info(`[AI Enhanced Scene] Saved config for scene: ${sceneId}`);
            return { success: true, config: configs.scenes[sceneId] };
        } catch (error) {
            this.logger.error('[AI Enhanced Scene] Failed to save scene config:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get scene configuration
     */
    async getSceneConfig(sceneId) {
        try {
            const configs = await this.loadSceneConfigs();
            const config = configs.scenes[sceneId];
            
            if (config) {
                return { success: true, data: config };
            } else {
                return { success: false, error: 'Scene config not found' };
            }
        } catch (error) {
            this.logger.error('[AI Enhanced Scene] Failed to get scene config:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete scene configuration
     */
    async deleteSceneConfig(sceneId) {
        try {
            const configs = await this.loadSceneConfigs();
            
            if (configs.scenes[sceneId]) {
                delete configs.scenes[sceneId];
                const saveResult = await this.saveSceneConfigs(configs);
                
                if (!saveResult.success) {
                    return { success: false, error: saveResult.error };
                }
                
                this.logger.info(`[AI Enhanced Scene] Deleted config for scene: ${sceneId}`);
                return { success: true };
            } else {
                return { success: false, error: 'Scene config not found' };
            }
        } catch (error) {
            this.logger.error('[AI Enhanced Scene] Failed to delete scene config:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get default execute scene prompt
     */
    getDefaultExecutePrompt() {
        return `你是一个智能家居场景执行助手。你的任务是根据用户输入和可用场景列表，找到最匹配的场景并生成执行响应。

输入信息：
1. user_input: 用户的原始输入
2. scene_data: 从用户意图解析出的场景信息（包含场景名称、英文名称等）
3. available_scenes: Home Assistant中所有可用的场景列表

你需要：
1. 分析用户输入和scene_data中的场景信息
2. 在available_scenes中找到最匹配的场景
3. 如果找到匹配的场景，返回场景ID和友好的执行确认消息
4. 如果没有找到匹配的场景，返回友好的建议消息

输出格式（JSON）：
{
  "matched": true/false,
  "scene_id": "scene.xxx",  // 如果matched为true
  "scene_name": "场景名称",
  "confidence": 0.95,       // 匹配置信度 0-1
  "message": "已为您执行回家模式场景" // 或 "很抱歉，系统还没有找到该场景..."
}

注意：
- **重要**：message必须与用户输入的语言保持一致
  * 如果用户输入是中文（如"执行回家场景"），message必须是中文（如"已为您执行回家模式场景"）
  * 如果用户输入是英文（如"Execute home scene"），message必须是英文（如"Home scene has been executed successfully"）
  * 检测user_input中的语言特征来决定message的语言
- 如果没有找到场景，建议用户如何创建场景
- 匹配时考虑场景的friendly_name和entity_id
- 置信度低于0.6时应该返回matched=false

语言示例：
中文输入 → 中文输出：
- user_input: "执行回家场景"
- message: "已为您执行回家模式场景"

英文输入 → 英文输出：
- user_input: "Execute home scene"
- message: "Home scene has been executed successfully"`;
    }

    /**
     * Get default create scene prompt
     */
    getDefaultCreatePrompt() {
        return `你是一个智能家居场景创建助手。你的任务是根据用户输入和设备状态，创建一个新的场景。

输入信息：
1. user_input: 用户的原始输入
2. scene_data: 从用户意图解析出的场景信息（包含场景名称、英文名称、描述等）
3. matched_devices: 需要包含在场景中的设备及其当前状态
4. actions: 设备控制动作列表

你需要：
1. 分析场景数据，确定场景的ID和名称
2. 整理设备列表，准备用于创建场景的snapshot_entities
3. 生成友好的创建确认消息
4. 如果设备列表为空，提供友好的错误提示

输出格式（JSON）：
{
  "scene_id": "scene.xxx",
  "scene_name": "场景名称",
  "snapshot_entities": ["light.xxx", "climate.xxx", ...],
  "message": "已为您创建'我回家了'场景，包含客厅的3个设备",
  "ready": true/false  // 是否准备好创建
}

注意：
- 场景ID需要使用英文和下划线，符合Home Assistant命名规范
- snapshot_entities只包含entity_id数组
- **重要**：message必须与用户输入的语言保持一致
  * 如果用户输入是中文（如"创建回家场景"），message必须是中文（如"已为您创建'回家'场景，包含客厅的3个设备"）
  * 如果用户输入是英文（如"Create home scene"），message必须是英文（如"Home scene has been created with 3 devices in living room"）
  * 检测user_input中的语言特征来决定message的语言
- 如果没有设备，ready应该为false并说明原因

语言示例：
中文输入 → 中文输出：
- user_input: "创建回家场景，包含客厅灯和空调"
- message: "已为您创建'回家'场景，包含客厅的2个设备"

英文输入 → 英文输出：
- user_input: "Create home scene with living room lights and AC"
- message: "Home scene has been created with 2 devices in living room"`;
    }

    /**
     * Get default delete scene prompt
     */
    getDefaultDeletePrompt() {
        return `你是一个智能家居场景删除助手。你的任务是根据用户输入和可用场景列表，找到需要删除的场景。

输入信息：
1. user_input: 用户的原始输入
2. scene_data: 从用户意图解析出的场景信息（包含场景名称等）
3. available_scenes: Home Assistant中所有可用的场景列表

你需要：
1. 分析用户输入和scene_data中的场景信息
2. 在available_scenes中找到最匹配的场景
3. 如果找到匹配的场景，返回场景ID和友好的删除确认消息
4. 如果没有找到匹配的场景，返回友好的提示消息

输出格式（JSON）：
{
  "matched": true/false,
  "scene_id": "scene.xxx",  // 如果matched为true
  "scene_name": "场景名称",
  "confidence": 0.95,       // 匹配置信度 0-1
  "message": "已为您删除回家场景" // 或 "很抱歉，系统还没有该场景，无需删除"
}

注意：
- **重要**：message必须与用户输入的语言保持一致
  * 如果用户输入是中文（如"删除回家场景"），message必须是中文（如"已为您删除'回家'场景"）
  * 如果用户输入是英文（如"Delete home scene"），message必须是英文（如"Home scene has been deleted successfully"）
  * 检测user_input中的语言特征来决定message的语言
- 如果没有找到场景，提供友好的提示
- 匹配时考虑场景的friendly_name和entity_id
- 置信度低于0.6时应该返回matched=false

语言示例：
中文输入 → 中文输出：
- user_input: "删除回家场景"
- message: "已为您删除'回家'场景"

英文输入 → 英文输出：
- user_input: "Delete home scene"
- message: "Home scene has been deleted successfully"`;
    }

    /**
     * Get prompt from file
     */
    async getPromptFromFile(promptFile, defaultPrompt) {
        try {
            const content = await fs.readFile(promptFile, 'utf-8');
            return { success: true, data: { prompt: content } };
        } catch (error) {
            this.logger.warn(`Failed to read prompt file ${promptFile}, using default`);
            return { success: true, data: { prompt: defaultPrompt } };
        }
    }

    /**
     * Update prompt file
     */
    async updatePromptFile(promptFile, content) {
        try {
            await fs.writeFile(promptFile, content, 'utf-8');
            return { success: true, message: 'Prompt updated successfully' };
        } catch (error) {
            this.logger.error(`Failed to update prompt file ${promptFile}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all prompts
     */
    async getAllPrompts() {
        try {
            const executePrompt = await this.getPromptFromFile(this.executePromptFile, this.getDefaultExecutePrompt());
            const createPrompt = await this.getPromptFromFile(this.createPromptFile, this.getDefaultCreatePrompt());
            const deletePrompt = await this.getPromptFromFile(this.deletePromptFile, this.getDefaultDeletePrompt());

            return {
                success: true,
                data: {
                    execute_prompt: executePrompt.data.prompt,
                    create_prompt: createPrompt.data.prompt,
                    delete_prompt: deletePrompt.data.prompt
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Update specific prompt
     */
    async updatePrompt(promptType, content) {
        const promptFiles = {
            'execute': this.executePromptFile,
            'create': this.createPromptFile,
            'delete': this.deletePromptFile
        };

        const promptFile = promptFiles[promptType];
        if (!promptFile) {
            return { success: false, error: 'Invalid prompt type. Use: execute, create, or delete' };
        }

        return await this.updatePromptFile(promptFile, content);
    }

    /**
     * Auto select AI provider
     */
    async autoSelectAI(preferredProvider = 'auto') {
        const providers = ['claude', 'deepseek', 'gemini', 'openai'];
        const targetProviders = preferredProvider === 'auto' ? providers : [preferredProvider];

        for (const providerName of targetProviders) {
            const module = global.moduleManager?.getModule(providerName);
            if (module) {
                try {
                    // Check if module has credentials
                    const credResult = await module.getCredentials();
                    if (credResult.success && credResult.data) {
                        // Check if has sendSimpleChat method
                        if (typeof module.sendSimpleChat === 'function') {
                            return { success: true, provider: providerName, module };
                        }
                    }
                } catch (error) {
                    // Skip this provider if error
                    continue;
                }
            }
        }

        return { success: false, error: 'No AI provider available' };
    }

    /**
     * Call AI with prompt
     */
    async callAI(systemPrompt, userMessage, aiProvider = 'auto') {
        const aiRes = await this.autoSelectAI(aiProvider);
        if (!aiRes.success) {
            return { success: false, error: aiRes.error };
        }

        const aiOptions = {
            model: aiRes.provider === 'deepseek' 
                ? 'deepseek-chat' 
                : ['gemini-2.0-flash-exp', 'gpt-4o-mini', 'gpt-3.5-turbo'],
            temperature: 0.3,
            max_tokens: 1000
        };

        const aiResult = await aiRes.module.sendSimpleChat(systemPrompt, userMessage, aiOptions);
        
        if (!aiResult.success) {
            return { success: false, error: aiResult.error || 'AI call failed' };
        }

        // Extract AI response
        let aiContent = aiResult.data?.message?.content 
            || aiResult.data?.response_text 
            || aiResult.data?.content 
            || aiResult.data?.text
            || '';

        return { 
            success: true, 
            data: { 
                content: aiContent,
                provider: aiRes.provider,
                usage: aiResult.data?.usage || {}
            } 
        };
    }

    /**
     * Parse JSON from AI response
     */
    parseAIResponse(content) {
        try {
            // Try to find JSON in markdown code blocks
            const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1]);
            }
            
            // Try to parse directly
            const jsonStart = content.indexOf('{');
            const jsonEnd = content.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                return JSON.parse(content.substring(jsonStart, jsonEnd + 1));
            }

            throw new Error('No JSON found in response');
        } catch (error) {
            throw new Error(`Failed to parse AI response: ${error.message}`);
        }
    }

    /**
     * Convert color name to RGB
     */
    colorNameToRGB(colorName) {
        if (!colorName) return null;
        
        const colorMap = {
            // English color names
            'red': [255, 0, 0],
            'green': [0, 255, 0],
            'blue': [0, 0, 255],
            'white': [255, 255, 255],
            'yellow': [255, 255, 0],
            'cyan': [0, 255, 255],
            'magenta': [255, 0, 255],
            'orange': [255, 165, 0],
            'purple': [128, 0, 128],
            'pink': [255, 192, 203],
            'brown': [165, 42, 42],
            'gray': [128, 128, 128],
            'grey': [128, 128, 128],
            'lime': [0, 255, 0],
            'indigo': [75, 0, 130],
            'violet': [238, 130, 238],
            'turquoise': [64, 224, 208],
            'teal': [0, 128, 128],
            'navy': [0, 0, 128],
            'maroon': [128, 0, 0],
            'olive': [128, 128, 0],
            'silver': [192, 192, 192],
            'gold': [255, 215, 0],
            
            // Chinese color names
            '红': [255, 0, 0],
            '红色': [255, 0, 0],
            '绿': [0, 255, 0],
            '绿色': [0, 255, 0],
            '蓝': [0, 0, 255],
            '蓝色': [0, 0, 255],
            '白': [255, 255, 255],
            '白色': [255, 255, 255],
            '黄': [255, 255, 0],
            '黄色': [255, 255, 0],
            '青': [0, 255, 255],
            '青色': [0, 255, 255],
            '紫': [255, 0, 255],
            '紫色': [255, 0, 255],
            '橙': [255, 165, 0],
            '橙色': [255, 165, 0],
            '粉': [255, 192, 203],
            '粉色': [255, 192, 203],
            '棕': [165, 42, 42],
            '棕色': [165, 42, 42],
            '灰': [128, 128, 128],
            '灰色': [128, 128, 128]
        };
        
        const lowerColorName = colorName.toLowerCase().trim();
        return colorMap[lowerColorName] || null;
    }

    /**
     * Get Home Assistant scenes
     */
    async getHomeAssistantScenes() {
        const haModule = global.moduleManager?.getModule('home_assistant');
        if (!haModule) {
            return { success: false, error: 'Home Assistant module not found' };
        }

        // Get scenes using SceneModule
        if (haModule.sceneModule) {
            return await haModule.sceneModule.getScenes();
        }

        return { success: false, error: 'Scene module not available' };
    }

    /**
     * Execute scene (智能匹配场景并执行)
     */
    async executeScene(inputData) {
        const startTime = Date.now();
        
        try {
            // Validate input
            if (!inputData || !inputData.data) {
                return { success: false, error: 'Invalid input data format' };
            }

            const { user_input, scene } = inputData.data;
            
            if (!user_input || !scene) {
                return { success: false, error: 'user_input and scene data are required' };
            }

            // Get available scenes from Home Assistant
            const scenesResult = await this.getHomeAssistantScenes();
            if (!scenesResult.success) {
                return { 
                    success: false, 
                    error: 'Failed to get scenes from Home Assistant',
                    details: scenesResult.error 
                };
            }

            const availableScenes = scenesResult.data.scenes || [];

            // Get execute prompt
            const promptRes = await this.getPromptFromFile(
                this.executePromptFile, 
                this.getDefaultExecutePrompt()
            );
            const systemPrompt = promptRes.data.prompt;

            // Prepare AI input
            const aiInput = JSON.stringify({
                user_input,
                scene_data: scene,
                available_scenes: availableScenes.map(s => ({
                    entity_id: s.entity_id,
                    name: s.name,
                    friendly_name: s.attributes?.friendly_name || s.name
                }))
            }, null, 2);

            // Call AI
            const aiResult = await this.callAI(systemPrompt, aiInput, this.config.aiProvider);
            if (!aiResult.success) {
                return { success: false, error: aiResult.error };
            }

            // Parse AI response
            let matchResult;
            try {
                matchResult = this.parseAIResponse(aiResult.data.content);
            } catch (error) {
                return { 
                    success: false, 
                    error: 'Failed to parse AI response',
                    details: error.message,
                    raw_response: aiResult.data.content
                };
            }

            // If matched, execute the scene
            let executionResult = null;
            if (matchResult.matched && matchResult.scene_id) {
                const haModule = global.moduleManager?.getModule('home_assistant');
                if (haModule && haModule.sceneModule) {
                    executionResult = await haModule.sceneModule.activateScene(matchResult.scene_id);
                }
            }

            const duration = Date.now() - startTime;

            return {
                success: true,
                data: {
                    matched: matchResult.matched,
                    scene_id: matchResult.scene_id,
                    scene_name: matchResult.scene_name,
                    confidence: matchResult.confidence,
                    message: {
                        type: "notification",
                        content: matchResult.message,
                        source: "external_system"
                    },
                    execution_result: executionResult,
                    ai_provider: aiResult.data.provider,
                    processing_time_ms: duration
                }
            };

        } catch (error) {
            this.logger.error('[AI Enhanced Scene] Execute scene failed:', error);
            return {
                success: false,
                error: 'Failed to execute scene',
                details: error.message
            };
        }
    }

    /**
     * Create scene (从设备状态创建场景)
     */
    async createScene(inputData) {
        const startTime = Date.now();
        
        try {
            // Validate input
            if (!inputData || !inputData.data) {
                return { success: false, error: 'Invalid input data format' };
            }

            const { user_input, scene, matched_devices, actions } = inputData.data;
            
            if (!user_input || !scene) {
                return { success: false, error: 'user_input and scene data are required' };
            }

            // Get create prompt
            const promptRes = await this.getPromptFromFile(
                this.createPromptFile, 
                this.getDefaultCreatePrompt()
            );
            const systemPrompt = promptRes.data.prompt;

            // Prepare AI input
            const aiInput = JSON.stringify({
                user_input,
                scene_data: scene,
                matched_devices: matched_devices || [],
                actions: actions || []
            }, null, 2);

            // Call AI
            const aiResult = await this.callAI(systemPrompt, aiInput, this.config.aiProvider);
            if (!aiResult.success) {
                return { success: false, error: aiResult.error };
            }

            // Parse AI response
            let createData;
            try {
                createData = this.parseAIResponse(aiResult.data.content);
            } catch (error) {
                return { 
                    success: false, 
                    error: 'Failed to parse AI response',
                    details: error.message,
                    raw_response: aiResult.data.content
                };
            }

            // Check if ready to create
            if (!createData.ready) {
                return {
                    success: false,
                    error: createData.message || 'Not ready to create scene',
                    data: createData
                };
            }

            // 判断使用哪种模式创建场景
            // 模式1: snapshot_entities - 快照当前状态（如果没有service_data或service_data为空）
            // 模式2: entities - 使用精确的状态数据（如果有service_data）
            // 模式3: 混合模式 - climate使用snapshot，其他使用entities
            
            let useSnapshotMode = false;
            let snapshotEntities = [];
            let entities = {};
            let climateEntities = [];  // 需要snapshot的climate设备
            
            if (matched_devices && Array.isArray(matched_devices)) {
                // 检查是否所有设备都没有service_data或service_data为空
                const allDevicesWithoutStates = matched_devices.every(device => {
                    if (!device.entity_id) return true; // 跳过无效设备
                    const hasServiceData = device.service_data && 
                                          typeof device.service_data === 'object' && 
                                          Object.keys(device.service_data).length > 0;
                    return !hasServiceData;
                });
                
                if (allDevicesWithoutStates) {
                    // 使用 snapshot_entities 模式
                    useSnapshotMode = true;
                    snapshotEntities = matched_devices
                        .filter(device => device.entity_id)
                        .map(device => device.entity_id);
                    
                    this.logger.info('[AI Enhanced Scene] 使用 snapshot_entities 模式');
                    this.logger.info(`[AI Enhanced Scene] Snapshot entities: ${snapshotEntities.join(', ')}`);
                } else {
                    // 使用 entities 模式 - 构建精确状态
                    // ⚠️ 注意：climate设备不支持entities模式，需要使用snapshot
                    matched_devices.forEach(device => {
                        if (device.entity_id && device.service_data) {
                            const entityId = device.entity_id;
                            const serviceData = device.service_data;
                            
                            // 根据设备类型转换为 scene entities 格式
                            const domain = entityId.split('.')[0];
                            
                            // ⚠️ Climate设备不支持entities模式，使用snapshot代替
                            if (domain === 'climate') {
                                climateEntities.push(entityId);
                                this.logger.info(`[AI Enhanced Scene] Climate设备 ${entityId} 将使用snapshot模式`);
                                return; // 跳过，稍后添加到snapshot_entities
                            }
                            
                            if (domain === 'light') {
                                // Light 设备必须包含 state 字段
                                const lightState = {
                                    state: serviceData.state || 'on'  // 使用实际状态，默认为打开
                                };
                                
                                // 处理亮度：支持 brightness (0-255) 和 brightness_pct (0-100)
                                if (serviceData.brightness !== undefined && serviceData.brightness !== null) {
                                    // 直接使用 brightness (0-255)
                                    lightState.brightness = serviceData.brightness;
                                } else if (serviceData.brightness_pct !== undefined) {
                                    // 转换 brightness_pct (0-100) 为 brightness (0-255)
                                    lightState.brightness = Math.round(serviceData.brightness_pct * 255 / 100);
                                }
                                
                                // 处理颜色模式
                                if (serviceData.color_mode) {
                                    lightState.color_mode = serviceData.color_mode;
                                }
                                
                                // 处理颜色：优先使用rgb_color，如果没有则尝试转换color_name
                                if (serviceData.rgb_color) {
                                    // 已有RGB颜色，直接使用
                                    lightState.rgb_color = serviceData.rgb_color;
                                } else if (serviceData.color_name) {
                                    // 尝试将颜色名称转换为RGB
                                    const rgbColor = this.colorNameToRGB(serviceData.color_name);
                                    if (rgbColor) {
                                        lightState.rgb_color = rgbColor;
                                        this.logger.info(`[AI Enhanced Scene] 颜色转换: ${serviceData.color_name} -> [${rgbColor.join(', ')}]`);
                                    } else {
                                        // 如果转换失败，保留color_name（某些系统可能支持）
                                        lightState.color_name = serviceData.color_name;
                                        this.logger.warn(`[AI Enhanced Scene] 无法转换颜色名称: ${serviceData.color_name}`);
                                    }
                                }
                                
                                // 保留其他颜色属性
                                if (serviceData.hs_color) {
                                    lightState.hs_color = serviceData.hs_color;
                                }
                                if (serviceData.xy_color) {
                                    lightState.xy_color = serviceData.xy_color;
                                }
                                if (serviceData.color_temp) {
                                    lightState.color_temp = serviceData.color_temp;
                                }
                                
                                entities[entityId] = lightState;
                            } else {
                                // 其他设备类型：提取state和其他属性
                                const deviceState = {};
                                if (serviceData.state) {
                                    deviceState.state = serviceData.state;
                                }
                                // 复制其他属性
                                Object.keys(serviceData).forEach(key => {
                                    if (key !== 'state') {
                                        deviceState[key] = serviceData[key];
                                    }
                                });
                                entities[entityId] = deviceState;
                            }
                        }
                    });
                    
                    this.logger.info('[AI Enhanced Scene] 使用 entities 模式（精确状态）');
                    this.logger.info('[AI Enhanced Scene] Building scene with entities:', JSON.stringify(entities, null, 2));
                    
                    if (climateEntities.length > 0) {
                        this.logger.info(`[AI Enhanced Scene] Climate设备将使用snapshot模式: ${climateEntities.join(', ')}`);
                    }
                }
            }

            // Create scene in Home Assistant
            let creationResult = null;
            const entityCount = useSnapshotMode ? snapshotEntities.length : (Object.keys(entities).length + climateEntities.length);
            
            if (createData.scene_id && entityCount > 0) {
                const haModule = global.moduleManager?.getModule('home_assistant');
                if (haModule && haModule.permanentSceneModule) {
                    // 使用永久场景创建模块
                    const permanentSceneData = {
                        scene_id: createData.scene_id || `${Date.now()}`,
                        scene_name: scene.scene_name, // 使用原始中文名称
                        name: scene.scene_name,
                        icon: scene.icon || 'mdi:lightbulb-group-outline'
                    };
                    
                    // 准备matched_devices数据（包含完整的service_data）
                    const matchedDevicesForScene = [];
                    
                    if (useSnapshotMode) {
                        // snapshot模式：使用所有设备的当前状态
                        matched_devices.forEach(device => {
                            if (device.service_data && Object.keys(device.service_data).length > 0) {
                                matchedDevicesForScene.push({
                                    entity_id: device.entity_id,
                                    service_data: device.service_data
                                });
                            }
                        });
                    } else {
                        // entities模式或混合模式
                        matched_devices.forEach(device => {
                            if (device.service_data && Object.keys(device.service_data).length > 0) {
                                matchedDevicesForScene.push({
                                    entity_id: device.entity_id,
                                    service_data: device.service_data
                                });
                            }
                        });
                    }
                    
                    this.logger.info('[AI Enhanced Scene] 准备创建永久场景，设备数:', matchedDevicesForScene.length);
                    
                    creationResult = await haModule.permanentSceneModule.createPermanentScene(
                        permanentSceneData,
                        matchedDevicesForScene
                    );
                    
                    // Save scene configuration to local storage
                    if (creationResult?.success) {
                        const sceneConfig = {
                            scene_id: createData.scene_id,
                            scene_name: createData.scene_name,
                            friendly_name: scene.scene_name,  // 保存用户指定的场景名称作为friendly_name
                            mode: useSnapshotMode ? 'snapshot' : (climateEntities.length > 0 ? 'hybrid' : 'precise'),
                            created_at: new Date().toISOString(),
                            created_by: 'ai_enhanced_scene',
                            user_input: user_input,
                            metadata: {
                                entity_count: entityCount,
                                climate_count: climateEntities.length,
                                precise_count: Object.keys(entities).length,
                                ai_provider: aiResult.data.provider
                            }
                        };
                        
                        // 保存配置数据
                        if (useSnapshotMode) {
                            sceneConfig.snapshot_entities = snapshotEntities;
                        } else {
                            if (Object.keys(entities).length > 0) {
                                sceneConfig.entities_config = entities;
                            }
                            if (climateEntities.length > 0) {
                                sceneConfig.climate_snapshot = climateEntities;
                            }
                        }
                        
                        await this.saveSceneConfig(createData.scene_id, sceneConfig);
                        this.logger.info(`[AI Enhanced Scene] Saved local config for scene: ${createData.scene_id}`);
                        this.logger.info(`[AI Enhanced Scene] Scene friendly_name: ${scene.scene_name}`);
                        this.logger.info(`[AI Enhanced Scene] Scene mode: ${sceneConfig.mode}`);
                    }
                }
            }

            const duration = Date.now() - startTime;

            return {
                success: creationResult?.success || false,
                data: {
                    scene_id: createData.scene_id,
                    scene_name: createData.scene_name,
                    mode: useSnapshotMode ? 'snapshot' : (climateEntities.length > 0 ? 'hybrid' : 'precise'),
                    snapshot_entities: useSnapshotMode ? snapshotEntities : (climateEntities.length > 0 ? climateEntities : undefined),
                    entities: (!useSnapshotMode && Object.keys(entities).length > 0) ? entities : undefined,
                    entity_count: entityCount,
                    climate_count: climateEntities.length,
                    message: {
                        type: "notification",
                        content: createData.message,
                        source: "external_system"
                    },
                    creation_result: creationResult,
                    ai_provider: aiResult.data.provider,
                    processing_time_ms: duration,
                    note: climateEntities.length > 0 ? 
                        `Climate devices use snapshot mode (captures current state), other devices use precise state` : 
                        undefined
                }
            };

        } catch (error) {
            this.logger.error('[AI Enhanced Scene] Create scene failed:', error);
            return {
                success: false,
                error: 'Failed to create scene',
                details: error.message
            };
        }
    }

    /**
     * Delete scene (智能匹配场景并删除)
     */
    async deleteScene(inputData) {
        const startTime = Date.now();
        
        try {
            // Validate input
            if (!inputData || !inputData.data) {
                return { success: false, error: 'Invalid input data format' };
            }

            const { user_input, scene } = inputData.data;
            
            if (!user_input || !scene) {
                return { success: false, error: 'user_input and scene data are required' };
            }

            // Get available scenes from Home Assistant (内存中的场景)
            const scenesResult = await this.getHomeAssistantScenes();
            const haScenes = scenesResult.success ? (scenesResult.data.scenes || []) : [];
            
            // Get scenes from yaml file (配置文件中的场景)
            let yamlScenes = [];
            const haModule = global.moduleManager?.getModule('home_assistant');
            if (haModule && haModule.permanentSceneModule) {
                try {
                    const pathResult = await haModule.permanentSceneModule.getConfigPath();
                    if (pathResult.success) {
                        const readResult = await haModule.permanentSceneModule.readSceneYaml(pathResult.data.scene_yaml_path);
                        if (readResult.success && readResult.data.scenes) {
                            yamlScenes = readResult.data.scenes.map(s => ({
                                entity_id: `scene.${s.id}`,
                                name: s.name,
                                friendly_name: s.name,
                                source: 'yaml'
                            }));
                        }
                    }
                } catch (err) {
                    this.logger.warn('[AI Enhanced Scene] Failed to read yaml scenes:', err.message);
                }
            }
            
            // 合并HA中的场景和yaml中的场景（去重）
            const sceneMap = new Map();
            
            // 添加HA中的场景
            haScenes.forEach(s => {
                sceneMap.set(s.entity_id, {
                    entity_id: s.entity_id,
                    name: s.name,
                    friendly_name: s.attributes?.friendly_name || s.name,
                    source: 'ha'
                });
            });
            
            // 添加yaml中的场景（如果HA中没有）
            yamlScenes.forEach(s => {
                if (!sceneMap.has(s.entity_id)) {
                    sceneMap.set(s.entity_id, s);
                }
            });
            
            const availableScenes = Array.from(sceneMap.values());
            
            this.logger.info(`[AI Enhanced Scene] 总共找到 ${availableScenes.length} 个场景 (HA: ${haScenes.length}, YAML: ${yamlScenes.length})`);
            
            if (availableScenes.length === 0) {
                return {
                    success: false,
                    error: '未找到任何场景',
                    message: {
                        type: "notification",
                        content: user_input.includes('delete') || user_input.includes('删除') 
                            ? "系统中没有可删除的场景" 
                            : "系统中没有可用的场景",
                        source: "external_system"
                    }
                };
            }

            // Get delete prompt
            const promptRes = await this.getPromptFromFile(
                this.deletePromptFile, 
                this.getDefaultDeletePrompt()
            );
            const systemPrompt = promptRes.data.prompt;

            // Prepare AI input
            const aiInput = JSON.stringify({
                user_input,
                scene_data: scene,
                available_scenes: availableScenes.map(s => ({
                    entity_id: s.entity_id,
                    name: s.name,
                    friendly_name: s.friendly_name,
                    source: s.source  // 'ha' 或 'yaml'
                }))
            }, null, 2);

            // Call AI
            const aiResult = await this.callAI(systemPrompt, aiInput, this.config.aiProvider);
            if (!aiResult.success) {
                return { success: false, error: aiResult.error };
            }

            // Parse AI response
            let matchResult;
            try {
                matchResult = this.parseAIResponse(aiResult.data.content);
            } catch (error) {
                return { 
                    success: false, 
                    error: 'Failed to parse AI response',
                    details: error.message,
                    raw_response: aiResult.data.content
                };
            }

            // Delete the scene completely
            let deletionResults = {
                temporary_scene: null,
                permanent_scene: null,
                local_config: null
            };
            
            // 如果AI匹配到场景，执行完整删除流程
            if (matchResult.matched && matchResult.scene_id) {
                if (haModule) {
                    // 1. 删除临时场景（内存中的场景）
                    if (haModule.sceneModule) {
                        this.logger.info(`[AI Enhanced Scene] 删除临时场景: ${matchResult.scene_id}`);
                        deletionResults.temporary_scene = await haModule.sceneModule.deleteScene(matchResult.scene_id);
                    }
                    
                    // 2. 删除永久场景（scenes.yaml文件中的场景）
                    if (haModule.permanentSceneModule) {
                        this.logger.info(`[AI Enhanced Scene] 删除永久场景: ${matchResult.scene_id}`);
                        deletionResults.permanent_scene = await haModule.permanentSceneModule.deletePermanentScene(matchResult.scene_id);
                    }
                }
                
                // 3. 删除本地配置文件中的场景配置
                this.logger.info(`[AI Enhanced Scene] 删除本地配置: ${matchResult.scene_id}`);
                deletionResults.local_config = await this.deleteSceneConfig(matchResult.scene_id);
            }
            // 如果AI没有匹配到，但用户提供了场景英文名，也尝试删除（可能yaml中有但HA中没有）
            else if (!matchResult.matched && scene.scene_name_en) {
                this.logger.warn(`[AI Enhanced Scene] AI未匹配到场景，尝试使用英文名直接删除: ${scene.scene_name_en}`);
                
                if (haModule && haModule.permanentSceneModule) {
                    // 尝试从yaml中删除（使用英文名）
                    this.logger.info(`[AI Enhanced Scene] 尝试从yaml删除: ${scene.scene_name_en}`);
                    deletionResults.permanent_scene = await haModule.permanentSceneModule.deletePermanentScene(scene.scene_name_en);
                    
                    // 如果yaml删除成功，更新匹配结果
                    if (deletionResults.permanent_scene?.success) {
                        matchResult.matched = true;
                        matchResult.scene_id = scene.scene_name_en;
                        matchResult.scene_name = scene.scene_name;
                        matchResult.message = `已从配置文件中删除'${scene.scene_name}'场景`;
                        this.logger.info(`[AI Enhanced Scene] 成功从yaml删除场景: ${scene.scene_name_en}`);
                    }
                }
                
                // 尝试删除本地配置
                if (scene.scene_name_en) {
                    this.logger.info(`[AI Enhanced Scene] 删除本地配置: ${scene.scene_name_en}`);
                    deletionResults.local_config = await this.deleteSceneConfig(scene.scene_name_en);
                }
            }

            const duration = Date.now() - startTime;

            // 判断整体删除是否成功（至少有一个删除操作成功）
            const overallSuccess = matchResult.matched && (
                (deletionResults.temporary_scene?.success) ||
                (deletionResults.permanent_scene?.success) ||
                (deletionResults.local_config?.success)
            );

            return {
                success: overallSuccess || !matchResult.matched,
                data: {
                    matched: matchResult.matched,
                    scene_id: matchResult.scene_id,
                    scene_name: matchResult.scene_name,
                    confidence: matchResult.confidence,
                    message: {
                        type: "notification",
                        content: matchResult.message,
                        source: "external_system"
                    },
                    deletion_details: {
                        temporary_scene_deleted: deletionResults.temporary_scene?.success || false,
                        permanent_scene_deleted: deletionResults.permanent_scene?.success || false,
                        local_config_deleted: deletionResults.local_config?.success || false,
                        results: deletionResults
                    },
                    ai_provider: aiResult.data.provider,
                    processing_time_ms: duration,
                    note: '场景已从所有位置删除：临时场景、scenes.yaml配置文件、本地配置'
                }
            };

        } catch (error) {
            this.logger.error('[AI Enhanced Scene] Delete scene failed:', error);
            return {
                success: false,
                error: 'Failed to delete scene',
                details: error.message
            };
        }
    }

    /**
     * Detect language from user input
     */
    detectLanguage(userInput) {
        if (!userInput || typeof userInput !== 'string') {
            return 'zh'; // default to Chinese
        }
        
        // Simple language detection: check for Chinese characters
        const hasChinese = /[\u4e00-\u9fa5]/.test(userInput);
        return hasChinese ? 'zh' : 'en';
    }

    /**
     * Generate message in appropriate language
     */
    generateMessage(language, messageType, sceneCount = 0, sceneNames = []) {
        const messages = {
            zh: {
                list_success: sceneNames.length > 0 
                    ? `找到 ${sceneCount} 个可用场景：${sceneNames.join('、')}`
                    : `找到 ${sceneCount} 个可用场景`,
                no_scenes: '暂无可用场景',
                list_error: '获取场景列表失败'
            },
            en: {
                list_success: sceneNames.length > 0
                    ? `Found ${sceneCount} available scene${sceneCount !== 1 ? 's' : ''}: ${sceneNames.join(', ')}`
                    : `Found ${sceneCount} available scene${sceneCount !== 1 ? 's' : ''}`,
                no_scenes: 'No scenes available',
                list_error: 'Failed to retrieve scene list'
            }
        };
        
        const lang = language === 'en' ? 'en' : 'zh';
        return messages[lang][messageType] || messages.zh[messageType];
    }

    /**
     * List all available scenes (查看所有可用场景)
     */
    async listScenes(inputData) {
        const startTime = Date.now();
        
        try {
            // Extract user_input if provided
            let userInput = '';
            if (inputData && inputData.data && inputData.data.user_input) {
                userInput = inputData.data.user_input;
            } else if (typeof inputData === 'string') {
                userInput = inputData;
            }

            // Detect language from user input
            const language = this.detectLanguage(userInput);

            // Get available scenes from Home Assistant
            const scenesResult = await this.getHomeAssistantScenes();
            if (!scenesResult.success) {
                return {
                    success: false,
                    error: this.generateMessage(language, 'list_error'),
                    details: scenesResult.error,
                    message: {
                        type: "notification",
                        content: this.generateMessage(language, 'list_error'),
                        source: "external_system"
                    }
                };
            }

            const scenes = scenesResult.data.scenes || [];
            const sceneCount = scenes.length;

            // Load local scene configs
            const localConfigs = await this.loadSceneConfigs();

            // Format scenes data and merge with local configs
            const formattedScenes = scenes.map(scene => {
                const baseInfo = {
                    scene_id: scene.entity_id,
                    scene_name: scene.name || scene.entity_id,
                    friendly_name: scene.attributes?.friendly_name || scene.name,
                    entity_id: scene.entity_id,
                    icon: scene.icon || scene.attributes?.icon || null,
                    entities: scene.attributes?.entity_id || []
                };

                // Try to get local config for this scene
                const localConfig = localConfigs.scenes[scene.entity_id];
                
                if (localConfig && localConfig.entities_config) {
                    // Scene has local config with entity states
                    // 优先使用本地保存的friendly_name
                    return {
                        ...baseInfo,
                        friendly_name: localConfig.friendly_name || baseInfo.friendly_name,  // 优先使用本地配置的friendly_name
                        has_config: true,
                        entities_config: localConfig.entities_config,
                        created_at: localConfig.created_at,
                        created_by: localConfig.created_by,
                        last_modified: localConfig.last_modified,
                        metadata: localConfig.metadata
                    };
                } else {
                    // Scene doesn't have local config
                    return {
                        ...baseInfo,
                        has_config: false,
                        config_note: language === 'zh' 
                            ? '此场景未通过AI增强创建，无详细配置信息'
                            : 'Scene config not available (not created via AI Enhanced Scene)'
                    };
                }
            });

            // Extract scene names for message
            const sceneNames = formattedScenes.map(scene => scene.friendly_name || scene.scene_name);

            const duration = Date.now() - startTime;

            // Generate appropriate message based on language and scene count
            const messageContent = sceneCount > 0
                ? this.generateMessage(language, 'list_success', sceneCount, sceneNames)
                : this.generateMessage(language, 'no_scenes');

            return {
                success: true,
                data: {
                    scenes: formattedScenes,
                    total: sceneCount,
                    with_config: formattedScenes.filter(s => s.has_config).length,
                    without_config: formattedScenes.filter(s => !s.has_config).length,
                    message: {
                        type: "notification",
                        content: messageContent,
                        source: "external_system"
                    },
                    language: language,
                    processing_time_ms: duration
                }
            };

        } catch (error) {
            this.logger.error('[AI Enhanced Scene] List scenes failed:', error);
            
            // Detect language from input for error message
            let userInput = '';
            if (inputData && inputData.data && inputData.data.user_input) {
                userInput = inputData.data.user_input;
            } else if (typeof inputData === 'string') {
                userInput = inputData;
            }
            const language = this.detectLanguage(userInput);
            
            return {
                success: false,
                error: this.generateMessage(language, 'list_error'),
                details: error.message,
                message: {
                    type: "notification",
                    content: this.generateMessage(language, 'list_error'),
                    source: "external_system"
                }
            };
        }
    }

    /**
     * Get module info
     */
    async getInfo() {
        return {
            success: true,
            data: {
                name: 'AI Enhanced Scene',
                version: '1.0.0',
                description: 'AI-powered scene management with intelligent matching',
                features: [
                    'Intelligent scene matching and execution',
                    'Scene creation from device states',
                    'Scene deletion with AI matching',
                    'List all available scenes',
                    'Customizable AI prompts',
                    'Multi-AI provider support',
                    'Multi-language support (Chinese/English)'
                ],
                ai_provider: this.config.aiProvider,
                configured: true
            }
        };
    }
}

module.exports = AiEnhancedSceneModule;

