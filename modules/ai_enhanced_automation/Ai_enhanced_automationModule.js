const fs = require('fs').promises;
const path = require('path');
const BaseCredentialModule = require('../../core/BaseCredentialModule');

/**
 * AI Enhanced Automation Module
 * 使用AI分析用户输入并创建智能家居自动化
 * 支持trigger、condition和action的智能解析
 */
class AiEnhancedAutomationModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        this.createPromptFile = path.join(this.dataDir, 'create_automation_prompt.txt');
        this.updatePromptFile = path.join(this.dataDir, 'update_automation_prompt.txt');
    }

    getDefaultConfig() {
        return {
            aiProvider: 'auto', // auto, claude, openai, gemini, deepseek
            defaultMode: 'single', // single, restart, queued, parallel
            enableConditions: true,
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
    }

    /**
     * Ensure default prompts exist
     */
    async ensureDefaultPrompts() {
        const prompts = {
            [this.createPromptFile]: this.getDefaultCreatePrompt(),
            [this.updatePromptFile]: this.getDefaultUpdatePrompt()
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
     * Get default create automation prompt
     */
    getDefaultCreatePrompt() {
        return `你是一个智能家居自动化创建助手。你的任务是根据用户输入和设备匹配信息，创建一个完整的Home Assistant自动化配置。

输入信息：
1. user_input: 用户的原始输入（例如："电视房没人的时候把灯关了"）
2. automation: 自动化基本信息（名称、英文名称、描述等）
3. matched_devices: 已匹配的设备列表，包含trigger和action设备

你需要：
1. 分析matched_devices中每个设备的automation字段（trigger/condition/action）
2. 将trigger设备转换为Home Assistant的trigger配置
3. 将condition设备转换为Home Assistant的condition配置（如果需要）
4. 将action设备转换为Home Assistant的action配置
5. 生成完整的自动化配置

Trigger类型示例：
- binary_sensor状态变化: {"platform": "state", "entity_id": "binary_sensor.motion_sensor_1", "to": "off"}
- 时间触发: {"platform": "time", "at": "18:00:00"}
- 设备状态持续: {"platform": "state", "entity_id": "binary_sensor.xxx", "to": "off", "for": {"minutes": 5}}

Condition类型示例：
- 状态条件: {"condition": "state", "entity_id": "sun.sun", "state": "below_horizon"}
- 时间条件: {"condition": "time", "after": "18:00:00", "before": "23:00:00"}
- 数值条件: {"condition": "numeric_state", "entity_id": "sensor.temperature", "below": 20}

Action类型示例：
- 服务调用: {"service": "light.turn_off", "target": {"entity_id": "light.color_light_3"}}
- 延迟: {"delay": {"seconds": 5}}
- 场景激活: {"service": "scene.turn_on", "target": {"entity_id": "scene.xxx"}}

输出格式（JSON）：
{
  "success": true,
  "automation_config": {
    "id": "自动生成的ID",
    "alias": "自动化名称",
    "description": "自动化描述",
    "trigger": [
      // trigger配置数组
    ],
    "condition": [
      // condition配置数组（可选）
    ],
    "action": [
      // action配置数组
    ],
    "mode": "single"  // single, restart, queued, parallel
  },
  "analysis": "对自动化逻辑的分析说明",
  "warnings": []  // 任何需要注意的警告信息
}

注意：
1. trigger至少需要一个
2. action至少需要一个
3. condition是可选的
4. 如果设备信息不完整，在warnings中说明
5. 所有service调用必须使用正确的domain（如light.turn_off而不是turn_off）
6. entity_id必须完整（如binary_sensor.motion_sensor_1）
7. 对于binary_sensor的trigger，通常需要指定to状态（on/off）
8. 如果用户输入包含"没人"、"无人"等词，通常表示binary_sensor状态为off
9. 如果用户输入包含"有人"、"检测到"等词，通常表示binary_sensor状态为on
10. 考虑是否需要添加延迟或持续时间条件，避免误触发`;
    }

    /**
     * Get default update automation prompt
     */
    getDefaultUpdatePrompt() {
        return `你是一个智能家居自动化更新助手。你的任务是根据用户输入更新现有的自动化配置。

输入信息：
1. user_input: 用户的原始输入
2. current_automation: 当前自动化的完整配置
3. update_request: 更新请求的详细信息

你需要：
1. 分析用户的更新需求
2. 保留不需要改变的配置
3. 更新需要改变的部分
4. 确保更新后的配置仍然有效

输出格式（JSON）：
{
  "success": true,
  "automation_config": {
    // 完整的更新后配置
  },
  "changes": "对修改内容的说明",
  "warnings": []
}`;
    }

    /**
     * Create automation using AI
     * 输入数据格式示例：
     * {
     *   "intent": "Set Automation",
     *   "user_input": "电视房没人的时候把灯关了",
     *   "matched_devices": [
     *     {
     *       "entity_id": "binary_sensor.motion_sensor_1",
     *       "service": "binary_sensor.state",
     *       "service_data": {"state": "off"},
     *       "automation": "trigger"
     *     },
     *     {
     *       "entity_id": "light.color_light_3",
     *       "service": "light.turn_off",
     *       "service_data": {},
     *       "automation": "action"
     *     }
     *   ],
     *   "automation": {
     *     "automation_name": "电视房无人关灯",
     *     "automation_name_en": "tv_room_no_one_turn_off_lights",
     *     "operation": "add",
     *     "description": "当电视房没人的时候自动关灯"
     *   }
     * }
     */
    async createAutomation(inputData) {
        try {
            this.logger.info('[AI_ENHANCED_AUTOMATION] Creating automation...');
            this.logger.info('[AI_ENHANCED_AUTOMATION] Input data:', JSON.stringify(inputData, null, 2));

            // Handle wrapped data format {success: true, data: {...}}
            let actualData = inputData;
            if (inputData && inputData.success && inputData.data) {
                this.logger.info('[AI_ENHANCED_AUTOMATION] Unwrapping data from success wrapper');
                actualData = inputData.data;
            }

            // Validate input
            if (!actualData || !actualData.automation || !actualData.matched_devices) {
                return {
                    success: false,
                    error: 'Invalid input data: missing automation or matched_devices'
                };
            }

            // Get AI provider
            const aiModule = await this.getAIModule();
            if (!aiModule) {
                return {
                    success: false,
                    error: 'No AI provider available'
                };
            }

            // Read prompt
            const prompt = await this.readPrompt(this.createPromptFile);

            // Prepare AI input
            const aiInput = {
                user_input: actualData.user_input || '',
                automation: actualData.automation,
                matched_devices: actualData.matched_devices
            };

            // Build user message
            const userMessage = `输入数据：\n${JSON.stringify(aiInput, null, 2)}\n\n请分析并生成完整的自动化配置。`;

            // Call AI
            this.logger.info('[AI_ENHANCED_AUTOMATION] Calling AI to generate automation config...');
            
            const aiOptions = {
                model: 'deepseek-chat',
                temperature: 0.3,
                max_tokens: 2000
            };
            
            const aiResponse = await aiModule.sendSimpleChat(prompt, userMessage, aiOptions);

            if (!aiResponse.success) {
                return {
                    success: false,
                    error: 'AI call failed',
                    details: aiResponse
                };
            }

            // Parse AI response
            let automationConfig;
            try {
                // Extract AI response content
                const responseText = aiResponse.data?.message?.content 
                    || aiResponse.data?.response_text 
                    || aiResponse.data?.content 
                    || aiResponse.data?.text 
                    || '';
                    
                this.logger.info('[AI_ENHANCED_AUTOMATION] AI response:', responseText.substring(0, 500));

                // Try to extract JSON from response
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    throw new Error('No JSON found in AI response');
                }

                const aiResult = JSON.parse(jsonMatch[0]);
                
                if (!aiResult.success || !aiResult.automation_config) {
                    return {
                        success: false,
                        error: 'AI failed to generate valid automation config',
                        details: aiResult
                    };
                }

                automationConfig = aiResult.automation_config;
                
                // Store AI analysis and warnings
                const aiAnalysis = {
                    analysis: aiResult.analysis,
                    warnings: aiResult.warnings || []
                };

                this.logger.info('[AI_ENHANCED_AUTOMATION] AI generated automation config:', JSON.stringify(automationConfig, null, 2));

                // Create automation via Home Assistant
                const haResult = await this.createHomeAssistantAutomation(automationConfig);

                if (!haResult.success) {
                    return haResult;
                }

                // Detect language from user input
                const userInput = actualData.user_input || '';
                const isChinese = this.detectChinese(userInput);

                // Generate automation description message
                const messageContent = this.generateAutomationMessage(automationConfig, userInput, isChinese);

                return {
                    success: true,
                    data: {
                        ...haResult.data,
                        ai_analysis: aiAnalysis,
                        input_data: actualData,
                        message: {
                            type: 'notification',
                            content: messageContent,
                            source: 'external_system'
                        }
                    }
                };

            } catch (parseError) {
                this.logger.error('[AI_ENHANCED_AUTOMATION] Failed to parse AI response:', parseError);
                return {
                    success: false,
                    error: 'Failed to parse AI response',
                    details: {
                        message: parseError.message,
                        response: aiResponse.data
                    }
                };
            }

        } catch (error) {
            this.logger.error('[AI_ENHANCED_AUTOMATION] Create automation failed:', error);
            return {
                success: false,
                error: 'Failed to create automation',
                details: { message: error.message }
            };
        }
    }

    /**
     * Create automation in Home Assistant
     */
    async createHomeAssistantAutomation(automationConfig) {
        try {
            this.logger.info('[AI_ENHANCED_AUTOMATION] Creating automation in Home Assistant...');

            // Get Home Assistant module
            const haModule = global.moduleManager?.getModule('home_assistant');
            if (!haModule) {
                return {
                    success: false,
                    error: 'Home Assistant module not found'
                };
            }

            // Call Home Assistant automation creation
            const result = await haModule.createAutomation(automationConfig);

            if (!result.success) {
                return result;
            }

            this.logger.info('[AI_ENHANCED_AUTOMATION] Automation created successfully in Home Assistant');

            return result;

        } catch (error) {
            this.logger.error('[AI_ENHANCED_AUTOMATION] Failed to create automation in Home Assistant:', error);
            return {
                success: false,
                error: 'Failed to create automation in Home Assistant',
                details: { message: error.message }
            };
        }
    }

    /**
     * Get AI module based on configuration
     */
    async getAIModule() {
        const provider = this.config.aiProvider || 'auto';

        // Helper function to check if module has valid credentials
        const hasCreds = async mod => {
            try {
                if (!mod || typeof mod.getCredentials !== 'function') return false;
                const res = await mod.getCredentials();
                if (!res.success || !res.data) return false;
                // Check if has at least one non-empty, non-internal field
                return Object.entries(res.data).some(([k, v]) => 
                    !k.startsWith('_') && typeof v === 'string' && v.trim()
                );
            } catch { 
                return false; 
            }
        };

        if (provider === 'auto') {
            // Try to get any available AI provider (priority: gemini > openai > deepseek > claude)
            const providers = ['gemini', 'openai', 'deepseek', 'claude'];
            for (const p of providers) {
                try {
                    const module = global.moduleManager?.getModule(p);
                    if (module && typeof module.sendSimpleChat === 'function' && await hasCreds(module)) {
                        this.logger.info(`[AI_ENHANCED_AUTOMATION] Using AI provider: ${p}`);
                        return module;
                    }
                } catch (e) {
                    // Continue to next provider
                }
            }
            return null;
        } else {
            const module = global.moduleManager?.getModule(provider);
            if (module && typeof module.sendSimpleChat === 'function' && await hasCreds(module)) {
                this.logger.info(`[AI_ENHANCED_AUTOMATION] Using AI provider: ${provider}`);
                return module;
            }
            return null;
        }
    }

    /**
     * Read prompt from file
     */
    async readPrompt(promptFile) {
        try {
            return await fs.readFile(promptFile, 'utf-8');
        } catch (error) {
            this.logger.warn(`[AI_ENHANCED_AUTOMATION] Failed to read prompt file ${promptFile}, using default`);
            if (promptFile === this.createPromptFile) {
                return this.getDefaultCreatePrompt();
            } else if (promptFile === this.updatePromptFile) {
                return this.getDefaultUpdatePrompt();
            }
            return '';
        }
    }

    /**
     * Delete automation
     */
    async deleteAutomation(automationId) {
        try {
            this.logger.info('[AI_ENHANCED_AUTOMATION] Deleting automation:', automationId);

            // Get Home Assistant module
            const haModule = global.moduleManager?.getModule('home_assistant');
            if (!haModule) {
                return {
                    success: false,
                    error: 'Home Assistant module not found'
                };
            }

            // Call Home Assistant automation deletion
            const result = await haModule.deleteAutomation(automationId);

            return result;

        } catch (error) {
            this.logger.error('[AI_ENHANCED_AUTOMATION] Delete automation failed:', error);
            return {
                success: false,
                error: 'Failed to delete automation',
                details: { message: error.message }
            };
        }
    }

    /**
     * Get automation details
     */
    async getAutomation(automationId) {
        try {
            this.logger.info('[AI_ENHANCED_AUTOMATION] Getting automation:', automationId);

            // Get Home Assistant module
            const haModule = global.moduleManager?.getModule('home_assistant');
            if (!haModule) {
                return {
                    success: false,
                    error: 'Home Assistant module not found'
                };
            }

            // Call Home Assistant automation query
            const result = await haModule.getAutomation(automationId);

            return result;

        } catch (error) {
            this.logger.error('[AI_ENHANCED_AUTOMATION] Get automation failed:', error);
            return {
                success: false,
                error: 'Failed to get automation',
                details: { message: error.message }
            };
        }
    }

    /**
     * List all automations
     */
    async listAutomations() {
        try {
            this.logger.info('[AI_ENHANCED_AUTOMATION] Listing automations...');

            // Get Home Assistant module
            const haModule = global.moduleManager?.getModule('home_assistant');
            if (!haModule) {
                return {
                    success: false,
                    error: 'Home Assistant module not found'
                };
            }

            // Call Home Assistant automations list
            const result = await haModule.getAutomations();

            return result;

        } catch (error) {
            this.logger.error('[AI_ENHANCED_AUTOMATION] List automations failed:', error);
            return {
                success: false,
                error: 'Failed to list automations',
                details: { message: error.message }
            };
        }
    }

    /**
     * Enable automation
     */
    async enableAutomation(automationId) {
        try {
            this.logger.info('[AI_ENHANCED_AUTOMATION] Enabling automation:', automationId);

            // Get Home Assistant module
            const haModule = global.moduleManager?.getModule('home_assistant');
            if (!haModule) {
                return {
                    success: false,
                    error: 'Home Assistant module not found'
                };
            }

            // Call Home Assistant automation enable
            const result = await haModule.enableAutomation(automationId);

            return result;

        } catch (error) {
            this.logger.error('[AI_ENHANCED_AUTOMATION] Enable automation failed:', error);
            return {
                success: false,
                error: 'Failed to enable automation',
                details: { message: error.message }
            };
        }
    }

    /**
     * Disable automation
     */
    async disableAutomation(automationId) {
        try {
            this.logger.info('[AI_ENHANCED_AUTOMATION] Disabling automation:', automationId);

            // Get Home Assistant module
            const haModule = global.moduleManager?.getModule('home_assistant');
            if (!haModule) {
                return {
                    success: false,
                    error: 'Home Assistant module not found'
                };
            }

            // Call Home Assistant automation disable
            const result = await haModule.disableAutomation(automationId);

            return result;

        } catch (error) {
            this.logger.error('[AI_ENHANCED_AUTOMATION] Disable automation failed:', error);
            return {
                success: false,
                error: 'Failed to disable automation',
                details: { message: error.message }
            };
        }
    }

    /**
     * List available automations with formatted message
     * Input formats:
     * 1. Simple: { user_input: "查看所有自动化" }
     * 2. Wrapped: { success: true, data: { user_input: "有哪些自动化", automation: {...}, ... } }
     * 
     * Output: {
     *   success: true,
     *   data: {
     *     automations: [...],
     *     count: 10,
     *     message: {
     *       type: "notification",
     *       content: "找到10个自动化：...",
     *       source: "external_system"
     *     }
     *   }
     * }
     */
    async listAvailableAutomations(inputData) {
        try {
            this.logger.info('[AI_ENHANCED_AUTOMATION] Listing available automations...');
            this.logger.info('[AI_ENHANCED_AUTOMATION] Input data:', JSON.stringify(inputData, null, 2));
            
            // Handle wrapped data format {success: true, data: {...}}
            let actualData = inputData;
            if (inputData && inputData.success && inputData.data) {
                this.logger.info('[AI_ENHANCED_AUTOMATION] Unwrapping data from success wrapper');
                actualData = inputData.data;
            }
            
            // Extract user input to detect language
            const userInput = actualData?.user_input || '';
            const isChinese = this.detectChinese(userInput);
            
            // Get Home Assistant module
            const haModule = global.moduleManager?.getModule('home_assistant');
            if (!haModule) {
                const errorMsg = isChinese ? 'Home Assistant 模块未找到' : 'Home Assistant module not found';
                return {
                    success: false,
                    error: errorMsg
                };
            }

            // Get all automations
            const result = await haModule.getAutomations();
            
            if (!result.success) {
                return result;
            }

            // Format automations list - handle different data formats
            let automations = [];
            if (Array.isArray(result.data)) {
                automations = result.data;
            } else if (result.data && Array.isArray(result.data.automations)) {
                automations = result.data.automations;
            } else if (result.data && typeof result.data === 'object') {
                // If data is an object, try to extract automations
                automations = Object.values(result.data).filter(item => 
                    item && typeof item === 'object' && item.entity_id
                );
            }
            
            const count = automations.length;
            
            // Build automation names list with status
            const automationDetails = automations
                .map(a => {
                    const name = a.attributes?.friendly_name || a.attributes?.alias || a.entity_id;
                    const state = a.state || 'unknown';
                    const isEnabled = state === 'on';
                    return { name, isEnabled, state };
                })
                .slice(0, 10); // Limit to first 10 for display
            
            // Build message content based on language
            let messageContent;
            if (isChinese) {
                if (count === 0) {
                    messageContent = '未找到任何自动化';
                } else {
                    // Format with status indicators
                    const formattedList = automationDetails.map(item => 
                        `${item.name}（${item.isEnabled ? '已启用' : '已禁用'}）`
                    );
                    
                    if (count <= 10) {
                        messageContent = `找到${count}个自动化：${formattedList.join('、')}`;
                    } else {
                        messageContent = `找到${count}个自动化：${formattedList.join('、')}等`;
                    }
                }
            } else {
                if (count === 0) {
                    messageContent = 'No automations found';
                } else {
                    // Format with status indicators
                    const formattedList = automationDetails.map(item => 
                        `${item.name} (${item.isEnabled ? 'enabled' : 'disabled'})`
                    );
                    
                    if (count <= 10) {
                        messageContent = `Found ${count} automation${count > 1 ? 's' : ''}: ${formattedList.join(', ')}`;
                    } else {
                        messageContent = `Found ${count} automations: ${formattedList.join(', ')}, etc.`;
                    }
                }
            }
            
            // Format response
            return {
                success: true,
                data: {
                    automations: automations,
                    count: count,
                    message: {
                        type: 'notification',
                        content: messageContent,
                        source: 'external_system'
                    }
                }
            };

        } catch (error) {
            this.logger.error('[AI_ENHANCED_AUTOMATION] List available automations failed:', error);
            return {
                success: false,
                error: 'Failed to list available automations',
                details: { message: error.message }
            };
        }
    }

    /**
     * Detect if text contains Chinese characters
     */
    detectChinese(text) {
        if (!text) return true; // Default to Chinese if no input
        return /[\u4e00-\u9fa5]/.test(text);
    }

    /**
     * Generate automation description message
     * @param {Object} automationConfig - The automation configuration
     * @param {String} userInput - Original user input
     * @param {Boolean} isChinese - Whether to use Chinese
     * @returns {String} - Description message
     */
    generateAutomationMessage(automationConfig, userInput, isChinese) {
        try {
            const alias = automationConfig.alias || '未命名自动化';
            const description = automationConfig.description || '';
            
            // Parse triggers
            const triggers = automationConfig.trigger || [];
            let triggerDesc = '';
            if (isChinese) {
                if (triggers.length === 0) {
                    triggerDesc = '无触发器';
                } else {
                    const triggerTexts = triggers.map(t => {
                        if (t.platform === 'state') {
                            const entityId = t.entity_id || '';
                            const toState = t.to || '任意状态';
                            const duration = t.for ? `持续${JSON.stringify(t.for)}` : '';
                            return `${entityId}变为${toState}${duration}`;
                        } else if (t.platform === 'time') {
                            return `时间到达${t.at || ''}`;
                        } else if (t.platform === 'numeric_state') {
                            const entityId = t.entity_id || '';
                            const above = t.above ? `大于${t.above}` : '';
                            const below = t.below ? `小于${t.below}` : '';
                            return `${entityId}${above}${below}`;
                        } else {
                            return `${t.platform}触发`;
                        }
                    });
                    triggerDesc = triggerTexts.join('，');
                }
            } else {
                if (triggers.length === 0) {
                    triggerDesc = 'No triggers';
                } else {
                    const triggerTexts = triggers.map(t => {
                        if (t.platform === 'state') {
                            const entityId = t.entity_id || '';
                            const toState = t.to || 'any state';
                            const duration = t.for ? ` for ${JSON.stringify(t.for)}` : '';
                            return `${entityId} changes to ${toState}${duration}`;
                        } else if (t.platform === 'time') {
                            return `time reaches ${t.at || ''}`;
                        } else if (t.platform === 'numeric_state') {
                            const entityId = t.entity_id || '';
                            const above = t.above ? ` above ${t.above}` : '';
                            const below = t.below ? ` below ${t.below}` : '';
                            return `${entityId}${above}${below}`;
                        } else {
                            return `${t.platform} trigger`;
                        }
                    });
                    triggerDesc = triggerTexts.join(', ');
                }
            }
            
            // Parse conditions
            const conditions = automationConfig.condition || [];
            let conditionDesc = '';
            if (isChinese) {
                if (conditions.length === 0) {
                    conditionDesc = '无条件';
                } else {
                    const conditionTexts = conditions.map(c => {
                        if (c.condition === 'state') {
                            return `${c.entity_id || ''}为${c.state || ''}`;
                        } else if (c.condition === 'time') {
                            const after = c.after ? `${c.after}之后` : '';
                            const before = c.before ? `${c.before}之前` : '';
                            return `时间在${after}${before}`;
                        } else if (c.condition === 'numeric_state') {
                            const entityId = c.entity_id || '';
                            const above = c.above ? `大于${c.above}` : '';
                            const below = c.below ? `小于${c.below}` : '';
                            return `${entityId}${above}${below}`;
                        } else {
                            return `${c.condition}条件`;
                        }
                    });
                    conditionDesc = conditionTexts.join('，');
                }
            } else {
                if (conditions.length === 0) {
                    conditionDesc = 'No conditions';
                } else {
                    const conditionTexts = conditions.map(c => {
                        if (c.condition === 'state') {
                            return `${c.entity_id || ''} is ${c.state || ''}`;
                        } else if (c.condition === 'time') {
                            const after = c.after ? ` after ${c.after}` : '';
                            const before = c.before ? ` before ${c.before}` : '';
                            return `time${after}${before}`;
                        } else if (c.condition === 'numeric_state') {
                            const entityId = c.entity_id || '';
                            const above = c.above ? ` above ${c.above}` : '';
                            const below = c.below ? ` below ${c.below}` : '';
                            return `${entityId}${above}${below}`;
                        } else {
                            return `${c.condition} condition`;
                        }
                    });
                    conditionDesc = conditionTexts.join(', ');
                }
            }
            
            // Parse actions
            const actions = automationConfig.action || [];
            let actionDesc = '';
            if (isChinese) {
                if (actions.length === 0) {
                    actionDesc = '无动作';
                } else {
                    const actionTexts = actions.map(a => {
                        if (a.service) {
                            const entityId = a.target?.entity_id || a.entity_id || '';
                            return `调用服务${a.service}${entityId ? `控制${entityId}` : ''}`;
                        } else if (a.delay) {
                            return `延迟${JSON.stringify(a.delay)}`;
                        } else {
                            return '执行动作';
                        }
                    });
                    actionDesc = actionTexts.join('，');
                }
            } else {
                if (actions.length === 0) {
                    actionDesc = 'No actions';
                } else {
                    const actionTexts = actions.map(a => {
                        if (a.service) {
                            const entityId = a.target?.entity_id || a.entity_id || '';
                            return `call service ${a.service}${entityId ? ` to control ${entityId}` : ''}`;
                        } else if (a.delay) {
                            return `delay ${JSON.stringify(a.delay)}`;
                        } else {
                            return 'perform action';
                        }
                    });
                    actionDesc = actionTexts.join(', ');
                }
            }
            
            // Build final message
            let message = '';
            if (isChinese) {
                message = `已为您创建自动化'${alias}'。`;
                if (description) {
                    message += `\n用途：${description}`;
                }
                message += `\n触发器：${triggerDesc}`;
                message += `\n条件：${conditionDesc}`;
                message += `\n动作：${actionDesc}`;
            } else {
                message = `Automation '${alias}' has been created for you.`;
                if (description) {
                    message += `\nPurpose: ${description}`;
                }
                message += `\nTrigger: ${triggerDesc}`;
                message += `\nCondition: ${conditionDesc}`;
                message += `\nAction: ${actionDesc}`;
            }
            
            return message;
            
        } catch (error) {
            this.logger.error('[AI_ENHANCED_AUTOMATION] Failed to generate automation message:', error);
            return isChinese ? '自动化创建成功' : 'Automation created successfully';
        }
    }

    /**
     * Enable automation with formatted message
     */
    async enableAutomationWithMessage(inputData) {
        return await this._operateAutomationWithMessage(inputData, 'enable');
    }

    /**
     * Disable automation with formatted message
     */
    async disableAutomationWithMessage(inputData) {
        return await this._operateAutomationWithMessage(inputData, 'disable');
    }

    /**
     * Delete automation with formatted message
     * Input formats:
     * 1. Simple: { automation_id: "automation.xxx" }
     * 2. Wrapped: { 
     *      success: true, 
     *      data: { 
     *        user_input: "删除禁用电视房温度控制自动化",
     *        automation: {
     *          automation_name: "电视房温度控制",
     *          automation_name_en: "tv_room_temperature_control",
     *          operation: "delete",
     *          ...
     *        },
     *        ...
     *      } 
     *    }
     * 
     * Output: {
     *   success: true,
     *   data: {
     *     automation_id: "automation.xxx",
     *     message: {
     *       type: "notification",
     *       content: "已为您删除'电视房温度控制'自动化",
     *       source: "external_system"
     *     }
     *   }
     * }
     */
    async deleteAutomationWithMessage(inputData) {
        return await this._operateAutomationWithMessage(inputData, 'delete');
    }

    /**
     * Internal method to operate automation with formatted message
     * @param {Object} inputData - Input data
     * @param {String} operation - Operation type: 'enable', 'disable', 'delete'
     */
    async _operateAutomationWithMessage(inputData, operation) {
        try {
            this.logger.info(`[AI_ENHANCED_AUTOMATION] ${operation} automation with message...`);
            this.logger.info('[AI_ENHANCED_AUTOMATION] Input data:', JSON.stringify(inputData, null, 2));
            
            // Handle wrapped data format {success: true, data: {...}}
            let actualData = inputData;
            if (inputData && inputData.success && inputData.data) {
                this.logger.info('[AI_ENHANCED_AUTOMATION] Unwrapping data from success wrapper');
                actualData = inputData.data;
            }
            
            // Extract user input and automation info
            const userInput = actualData?.user_input || '';
            const automation = actualData?.automation || {};
            const automationName = automation.automation_name || '';
            const automationNameEn = automation.automation_name_en || '';
            
            // Detect language from user input
            const isChinese = this.detectChinese(userInput);
            
            // Get Home Assistant module
            const haModule = global.moduleManager?.getModule('home_assistant');
            if (!haModule) {
                const errorMsg = isChinese ? 'Home Assistant 模块未找到' : 'Home Assistant module not found';
                return {
                    success: false,
                    error: errorMsg
                };
            }

            // First, try to find the automation by name
            let automationId = null;
            
            // Try to find by automation_name_en first
            if (automationNameEn) {
                // Search for automation with matching alias or entity_id
                const listResult = await haModule.getAutomations();
                if (listResult.success) {
                    let automations = [];
                    if (Array.isArray(listResult.data)) {
                        automations = listResult.data;
                    } else if (listResult.data && Array.isArray(listResult.data.automations)) {
                        automations = listResult.data.automations;
                    } else if (listResult.data && typeof listResult.data === 'object') {
                        automations = Object.values(listResult.data).filter(item => 
                            item && typeof item === 'object' && item.entity_id
                        );
                    }
                    
                    // Look for automation with matching name
                    const found = automations.find(a => {
                        const alias = a.attributes?.alias || a.attributes?.friendly_name || '';
                        const entityId = a.entity_id || '';
                        // Check if alias matches (exact or fuzzy)
                        if (alias === automationName || alias === automationNameEn) {
                            return true;
                        }
                        // Check if entity_id contains the english name
                        if (entityId.includes(automationNameEn)) {
                            return true;
                        }
                        return false;
                    });
                    
                    if (found) {
                        automationId = found.entity_id;
                        this.logger.info('[AI_ENHANCED_AUTOMATION] Found automation by name:', automationId);
                    }
                }
            }
            
            if (!automationId) {
                const errorMsg = isChinese 
                    ? `未找到名为'${automationName}'的自动化`
                    : `Automation '${automationName}' not found`;
                return {
                    success: false,
                    error: errorMsg,
                    data: {
                        message: {
                            type: 'notification',
                            content: errorMsg,
                            source: 'external_system'
                        }
                    }
                };
            }

            // Perform the operation
            let result;
            if (operation === 'delete') {
                result = await haModule.deleteAutomation(automationId);
            } else if (operation === 'enable') {
                result = await haModule.enableAutomation(automationId);
            } else if (operation === 'disable') {
                result = await haModule.disableAutomation(automationId);
            } else {
                return {
                    success: false,
                    error: `Unknown operation: ${operation}`
                };
            }
            
            if (!result.success) {
                const errorMsg = isChinese 
                    ? `${this._getOperationNameCN(operation)}自动化'${automationName}'失败: ${result.error || '未知错误'}`
                    : `Failed to ${operation} automation '${automationName}': ${result.error || 'Unknown error'}`;
                return {
                    success: false,
                    error: errorMsg,
                    data: {
                        message: {
                            type: 'notification',
                            content: errorMsg,
                            source: 'external_system'
                        }
                    }
                };
            }

            // Build success message based on language and operation
            const messageContent = isChinese
                ? `已为您${this._getOperationNameCN(operation)}'${automationName}'自动化`
                : `${this._getOperationNameEN(operation)} automation '${automationName}' successfully`;
            
            // Format response
            return {
                success: true,
                data: {
                    automation_id: automationId,
                    automation_name: automationName,
                    operation: operation,
                    message: {
                        type: 'notification',
                        content: messageContent,
                        source: 'external_system'
                    }
                }
            };

        } catch (error) {
            this.logger.error(`[AI_ENHANCED_AUTOMATION] ${operation} automation with message failed:`, error);
            const userInput = inputData?.user_input || inputData?.data?.user_input || '';
            const isChinese = this.detectChinese(userInput);
            const errorMsg = isChinese 
                ? `${this._getOperationNameCN(operation)}自动化失败: ${error.message}`
                : `Failed to ${operation} automation: ${error.message}`;
            return {
                success: false,
                error: errorMsg,
                data: {
                    message: {
                        type: 'notification',
                        content: errorMsg,
                        source: 'external_system'
                    }
                },
                details: { message: error.message }
            };
        }
    }

    /**
     * Get operation name in Chinese
     */
    _getOperationNameCN(operation) {
        const names = {
            'delete': '删除',
            'enable': '启用',
            'disable': '禁用'
        };
        return names[operation] || operation;
    }

    /**
     * Get operation name in English (past tense)
     */
    _getOperationNameEN(operation) {
        const names = {
            'delete': 'Deleted',
            'enable': 'Enabled',
            'disable': 'Disabled'
        };
        return names[operation] || operation;
    }
}

module.exports = AiEnhancedAutomationModule;

