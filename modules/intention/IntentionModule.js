const fs = require('fs').promises;
const path = require('path');
const BaseCredentialModule = require('../../core/BaseCredentialModule');

class IntentionModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        this.intentionsFile = path.join(this.dataDir, 'intentions.json');
        this.promptFile = path.join(this.dataDir, 'custom_prompt.txt');
        this.classificationPromptFile = path.join(this.dataDir, 'classification_prompt.txt');
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
    }

    /**
     * Classify intention: only classify user intention without device extraction
     */
    async classifyIntention(userInput, additionalData = {}) {
        const startTime = Date.now();
        try {
            // Validate input
            if (!userInput || typeof userInput !== 'string') {
                return { success: false, error: 'Invalid input: content or user_input is required' };
            }

            // Extract additional metadata
            const { type, metadata, timestamp } = additionalData;

            // Get classification prompt
            const promptRes = await this.getClassificationSystemPrompt();
            const classificationPrompt = promptRes.success ? promptRes.data.prompt : this.getClassificationPrompt();

            // Auto select AI provider
            const aiProvider = this.config.aiProvider || 'auto';
            const aiRes = await this.autoSelectAI(aiProvider);
            if (!aiRes.success) {
                return { success: false, error: aiRes.error || 'No AI provider available' };
            }

            // Prepare AI request - select appropriate model for each provider
            let modelName;
            if (aiRes.provider === 'deepseek') {
                modelName = 'deepseek-chat';
            } else if (aiRes.provider === 'openai') {
                // Get preferred model from OpenAI configuration
                try {
                    const modelResult = await aiRes.module.getPreferredModel();
                    modelName = modelResult.success ? modelResult.data.model : 'gpt-3.5-turbo';
                } catch (e) {
                    modelName = 'gpt-3.5-turbo';
                }
            } else if (aiRes.provider === 'gemini') {
                modelName = 'gemini-2.0-flash-exp';
            } else if (aiRes.provider === 'claude') {
                modelName = 'claude-3-5-sonnet-20241022';
            } else {
                modelName = 'gpt-3.5-turbo'; // default
            }
            
            const aiOptions = {
                model: modelName,
                temperature: 0.3,
                max_tokens: 500
            };

            // Call AI
            const aiCallStart = Date.now();
            const aiResult = await aiRes.module.sendSimpleChat(classificationPrompt, userInput, aiOptions);
            const aiCallDuration = Date.now() - aiCallStart;
            
            if (!aiResult.success) {
                return { success: false, error: aiResult.error || 'AI call failed' };
            }

            // Extract token usage information
            const tokenUsage = {
                prompt_tokens: aiResult.data?.usage?.prompt_tokens || 
                               aiResult.data?.usage?.input_tokens || 
                               aiResult.data?.promptTokens || 0,
                completion_tokens: aiResult.data?.usage?.completion_tokens || 
                                  aiResult.data?.usage?.output_tokens || 
                                  aiResult.data?.completionTokens || 0,
                total_tokens: aiResult.data?.usage?.total_tokens || 
                             aiResult.data?.usage?.totalTokens || 0
            };

            // If total_tokens is not provided, calculate it
            if (!tokenUsage.total_tokens && (tokenUsage.prompt_tokens || tokenUsage.completion_tokens)) {
                tokenUsage.total_tokens = tokenUsage.prompt_tokens + tokenUsage.completion_tokens;
            }

            // Parse AI response
            let classificationResult;
            try {
                let aiContent = aiResult.data?.message?.content 
                    || aiResult.data?.response_text 
                    || aiResult.data?.content 
                    || '';
                
                // If content is string, clean markdown code blocks
                if (typeof aiContent === 'string') {
                    // Remove markdown code block markers (```json, ```, etc.)
                    aiContent = aiContent
                        .replace(/```json\s*/gi, '')
                        .replace(/```\s*/g, '')
                        .trim();
                    classificationResult = JSON.parse(aiContent);
                } else {
                    classificationResult = aiContent;
                }
            } catch (e) {
                this.logger.error('Failed to parse AI classification response:', e.message);
                this.logger.error('AI content:', aiResult.data?.message?.content || aiResult.data?.response_text || aiResult.data?.content);
                return { success: false, error: 'Failed to parse AI response: ' + e.message };
            }

            const totalDuration = Date.now() - startTime;

            return {
                success: true,
                data: {
                    ...classificationResult,
                    ai_provider: aiRes.provider,
                    classified_at: new Date().toISOString(),
                    input_metadata: {
                        type,
                        metadata,
                        timestamp: timestamp || new Date().toISOString()
                    },
                    performance: {
                        total_duration_ms: totalDuration,
                        ai_call_duration_ms: aiCallDuration,
                        token_usage: tokenUsage
                    }
                }
            };
        } catch (e) {
            this.logger.error('Error classifying intention:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Get classification prompt
     */
    getClassificationPrompt() {
        return `# Home Assistant意图分类专家

将用户的智能家居指令分类为以下6种意图：

## 意图分类

- **Query Device Status**: 查询设备状态（如："客厅灯开着吗"、"温度是多少"）
- **Control Device**: 控制设备（如："打开客厅灯"、"关闭空调"）
- **Control Scene**: 场景控制/执行场景（如："启动观影模式"、"执行睡眠场景"、"我回家了"、"离家模式"）
- **Set Scene**: 设定场景（如："创建一个观影场景"、"设置回家场景"）
- **Set Automation**: 设定自动化规则（如："晚上7点自动开灯"、"当温度低于20度时打开暖气"）
- **Other**: 其他

## 重要区分规则

### Control Scene vs Set Automation
- **Control Scene**: 用户想要**立即执行/触发**一个场景或模式
  - 关键词：启动、执行、开启、激活、触发、进入、我XX了
  - 示例：
    - "启动观影模式" → Control Scene
    - "我回家了" → Control Scene（触发回家场景）
    - "离家模式" → Control Scene
    - "睡眠模式" → Control Scene
    - "进入会客模式" → Control Scene
    
- **Set Automation**: 用户想要**设置/创建**一个自动化规则（通常包含时间/条件）
  - 关键词：自动、定时、当...时、每天、每周、如果...就
  - 示例：
    - "晚上7点自动开灯" → Set Automation
    - "当温度低于20度时打开暖气" → Set Automation
    - "每天早上8点打开窗帘" → Set Automation
    - "回家时自动开灯" → Set Automation（注意：这是设置规则，不是执行）

### Control Device vs Control Scene
- **Control Device**: 操作单个或多个具体设备
  - 示例：
    - "打开客厅灯" → Control Device
    - "关闭所有灯" → Control Device
    
- **Control Scene**: 执行预设的场景模式（通常包含多个设备的协同操作）
  - 示例：
    - "观影模式" → Control Scene
    - "我回来了" → Control Scene

## 输出格式
\`\`\`json
{
  "user_input": "用户原始输入",
  "intent": "意图类型",
  "confidence": 0.0-1.0,
  "user_responds": "简短回应，语言与输入一致"
}
\`\`\`

## 示例

**输入**: "客厅温度和湿度是多少"
\`\`\`json
{
  "user_input": "客厅温度和湿度是多少",
  "intent": "Query Device Status",
  "confidence": 0.9,
  "user_responds": "好的，我帮您查看客厅的温度和湿度"
}
\`\`\`

**输入**: "打开客厅灯"
\`\`\`json
{
  "user_input": "打开客厅灯",
  "intent": "Control Device",
  "confidence": 0.95,
  "user_responds": "好的，正在为您打开客厅灯"
}
\`\`\`

**输入**: "启动观影模式"
\`\`\`json
{
  "user_input": "启动观影模式",
  "intent": "Control Scene",
  "confidence": 0.95,
  "user_responds": "好的，正在为您启动观影模式"
}
\`\`\`

**输入**: "我回家了"
\`\`\`json
{
  "user_input": "我回家了",
  "intent": "Control Scene",
  "confidence": 0.9,
  "user_responds": "欢迎回家，正在为您执行回家场景"
}
\`\`\`

**输入**: "离家模式"
\`\`\`json
{
  "user_input": "离家模式",
  "intent": "Control Scene",
  "confidence": 0.9,
  "user_responds": "好的，正在为您启动离家模式"
}
\`\`\`

**输入**: "晚上7点自动开灯"
\`\`\`json
{
  "user_input": "晚上7点自动开灯",
  "intent": "Set Automation",
  "confidence": 0.95,
  "user_responds": "好的，我帮您设置晚上7点自动开灯"
}
\`\`\`

**输入**: "回家时自动开灯"
\`\`\`json
{
  "user_input": "回家时自动开灯",
  "intent": "Set Automation",
  "confidence": 0.9,
  "user_responds": "好的，我帮您设置回家时自动开灯的规则"
}
\`\`\`

**输入**: "创建一个观影场景"
\`\`\`json
{
  "user_input": "创建一个观影场景",
  "intent": "Set Scene",
  "confidence": 0.95,
  "user_responds": "好的，我帮您创建观影场景"
}
\`\`\`

请只返回JSON格式的结果，不要添加其他说明文字。`;
    }

    /**
     * Normalize device object to ensure all required fields are present
     */
    normalizeDevice(device) {
        return {
            floor_name: device.floor_name || "",
            floor_name_en: device.floor_name_en || "",
            floor_type: device.floor_type || "",
            room_type: device.room_type || "",
            room_name: device.room_name || "",
            room_name_en: device.room_name_en || "",
            device_type: device.device_type || "",
            device_name: device.device_name || "",
            device_name_en: device.device_name_en || "",
            service: device.service || "",
            service_data: device.service_data || {}
        };
    }

    /**
     * Process intention: receive user intent, combine with system prompt, send to AI, return result
     */
    async processIntention(intentionData) {
        try {
            // Validate input
            if (!intentionData || !intentionData.content) {
                return { success: false, error: 'Invalid intention data: content is required' };
            }

            const { type, content, metadata, timestamp } = intentionData;

            // Get system prompt
            const promptRes = await this.getSystemPrompt();
            if (!promptRes.success) {
                return { success: false, error: 'Failed to get system prompt' };
            }
            const systemPrompt = promptRes.data.prompt;

            // Auto select AI provider
            const aiProvider = this.config.aiProvider || 'auto';
            const aiRes = await this.autoSelectAI(aiProvider);
            if (!aiRes.success) {
                return { success: false, error: aiRes.error || 'No AI provider available' };
            }

            // Prepare AI request - select appropriate model for each provider
            let modelName;
            if (aiRes.provider === 'deepseek') {
                modelName = 'deepseek-chat';
            } else if (aiRes.provider === 'openai') {
                // Get preferred model from OpenAI configuration
                try {
                    const modelResult = await aiRes.module.getPreferredModel();
                    modelName = modelResult.success ? modelResult.data.model : 'gpt-3.5-turbo';
                } catch (e) {
                    modelName = 'gpt-3.5-turbo';
                }
            } else if (aiRes.provider === 'gemini') {
                modelName = 'gemini-2.0-flash-exp';
            } else if (aiRes.provider === 'claude') {
                modelName = 'claude-3-5-sonnet-20241022';
            } else {
                modelName = 'gpt-3.5-turbo'; // default
            }
            
            const userPrompt = content;
            const aiOptions = {
                model: modelName,
                temperature: 0.7,
                max_tokens: 3500
            };

            // Call AI
            const aiResult = await aiRes.module.sendSimpleChat(systemPrompt, userPrompt, aiOptions);
            if (!aiResult.success) {
                return { success: false, error: aiResult.error || 'AI call failed' };
            }

            // Parse AI response
            let intentResult;
            try {
                let aiContent = aiResult.data?.message?.content 
                    || aiResult.data?.response_text 
                    || aiResult.data?.content 
                    || '';
                
                // If content is string, clean markdown code blocks
                if (typeof aiContent === 'string') {
                    // Remove markdown code block markers (```json, ```, etc.)
                    aiContent = aiContent
                        .replace(/```json\s*/gi, '')
                        .replace(/```\s*/g, '')
                        .trim();
                    
                    // Find the first complete JSON object
                    // This handles cases where AI adds explanatory text after the JSON
                    const firstBraceIndex = aiContent.indexOf('{');
                    if (firstBraceIndex !== -1) {
                        // Try to find the matching closing brace
                        let braceCount = 0;
                        let inString = false;
                        let escapeNext = false;
                        let jsonEndIndex = -1;
                        
                        for (let i = firstBraceIndex; i < aiContent.length; i++) {
                            const char = aiContent[i];
                            
                            if (escapeNext) {
                                escapeNext = false;
                                continue;
                            }
                            
                            if (char === '\\') {
                                escapeNext = true;
                                continue;
                            }
                            
                            if (char === '"' && !escapeNext) {
                                inString = !inString;
                                continue;
                            }
                            
                            if (!inString) {
                                if (char === '{') {
                                    braceCount++;
                                } else if (char === '}') {
                                    braceCount--;
                                    if (braceCount === 0) {
                                        jsonEndIndex = i + 1;
                                        break;
                                    }
                                }
                            }
                        }
                        
                        if (jsonEndIndex !== -1) {
                            aiContent = aiContent.substring(firstBraceIndex, jsonEndIndex);
                        }
                    }
                    
                    intentResult = JSON.parse(aiContent);
                } else {
                    intentResult = aiContent;
                }
            } catch (e) {
                this.logger.error('Failed to parse AI response:', e.message);
                this.logger.error('AI content:', aiResult.data?.message?.content || aiResult.data?.response_text || aiResult.data?.content);
                return { success: false, error: 'Failed to parse AI response: ' + e.message };
            }

            // Ensure all device objects have complete field structure with guaranteed output
            if (intentResult && Array.isArray(intentResult.devices)) {
                intentResult.devices = intentResult.devices.map(device => this.normalizeDevice(device));
            } else if (intentResult) {
                // Ensure devices array exists even if empty
                intentResult.devices = intentResult.devices || [];
            }

            // Log device information for debugging
            if (intentResult && intentResult.devices) {
                this.logger.info(`Processed ${intentResult.devices.length} device(s) with complete field structure`);
            }

            // Save to history
            const historyEntry = {
                timestamp: timestamp || new Date().toISOString(),
                input: { type, content, metadata },
                output: intentResult,
                ai_provider: aiRes.provider
            };
            await this.saveToHistory(historyEntry);

            // Prepare final response with guaranteed field structure
            const responseData = {
                user_input: intentResult.user_input || content,
                intent: intentResult.intent || "Other",
                devices: intentResult.devices || [],
                confidence: intentResult.confidence || 0,
                user_responds: intentResult.user_responds || "",
                ai_provider: aiRes.provider,
                processed_at: new Date().toISOString()
            };

            return {
                success: true,
                data: responseData
            };
        } catch (e) {
            this.logger.error('Error processing intention:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Auto select available AI provider
     */
    async autoSelectAI(preferred = 'auto') {
        const names = [];
        if (preferred && preferred !== 'auto') names.push(preferred);
        names.push('gemini', 'openai', 'deepseek', 'claude');

        const hasCreds = async mod => {
            try {
                if (!mod || typeof mod.getCredentials !== 'function') return false;
                const res = await mod.getCredentials();
                if (!res.success || !res.data) return false;
                return Object.entries(res.data).some(([k, v]) => 
                    !k.startsWith('_') && typeof v === 'string' && v.trim()
                );
            } catch { return false; }
        };

        for (const n of names) {
            const m = global.moduleManager?.getModule(n);
            if (m && typeof m.sendSimpleChat === 'function' && await hasCreds(m)) {
                return { success: true, provider: n, module: m };
            }
        }
        return { success: false, error: 'No AI provider available' };
    }

    /**
     * Get system prompt (custom or default)
     */
    async getSystemPrompt() {
        try {
            // Try to read custom prompt
            const customPrompt = await fs.readFile(this.promptFile, 'utf8');
            if (customPrompt && customPrompt.trim()) {
                return { success: true, data: { prompt: customPrompt, is_custom: true } };
            }
        } catch (e) {
            // File doesn't exist, use default
        }

        // Use default prompt
        const defaultPrompt = `你是Home Assistant智能家居指令解析专家。分析用户自然语言指令，提取房间、设备信息，判断意图并转换为标准的Home Assistant服务调用。

## 意图分类（六种类型）
1. **Query Device Status**（查询设备状态）
2. **Control Device**（控制设备）
3. **Control Scene**（场景控制）
4. **Set Scene**（设定场景）
5. **Set Automation**（设定自动化）
6. **Other**（其他）

### 意图分类规则
- **Control Device**：用户明确指定设备和动作（如："打开客厅灯"、"关闭书房空调"）
- **Control Scene**：用户使用场景关键词（如："启动/执行/开启XX模式/场景"）
- **Query Device Status**：用户询问设备状态（如："客厅灯开着吗"、"空调温度是多少"）

## 房间类型映射
客厅/大厅/会客厅/起居室 → "living_room"
卧室/睡房 → "bedroom"
主卧/主卧室 → "master_bedroom"
客卧/次卧 → "guest_bedroom"
书房/办公室/工作室/学习室 → "study"
厨房/烹饪间 → "kitchen"
餐厅/饭厅/用餐区 → "dining_room"
卫生间/洗手间/厕所/浴室 → "bathroom"
阳台/露台/平台 → "balcony"
花园/后院/前院/庭院 → "garden"
车库/停车库 → "garage"
走廊/过道/通道 → "hallway"

## 设备类型映射（基于Home Assistant域和传感器的device class）

### 可控制设备（控制类域）
灯/台灯/吊灯/射灯/筒灯/照明灯/落地灯/壁灯/夜灯/吸顶灯 → "light"
空调/冷气/制冷机/暖气 → "climate"
风扇/吊扇/台扇/电扇 → "fan"
电视/TV/显示器/投影仪 → "media_player"
音响/音箱/扬声器/智能音箱 → "media_player"
窗帘/百叶窗/遮光帘/电动窗帘 → "cover"
开关/插座/智能插座 → "switch"
门锁/智能锁/指纹锁 → "lock"
摄像头/监控/门铃摄像头 → "camera"
扫地机器人/拖地机器人 → "vacuum"
空气净化器/加湿器/除湿器 → "humidifier"
洗衣机/干衣机 → "washing_machine"

### 数值型传感器（sensor域）
温度计/温度传感器 → "temperature"
湿度计/湿度传感器 → "humidity"
亮度传感器/光照传感器 → "illuminance"
功率传感器/电量传感器 → "power"
能耗传感器 → "energy"
气压传感器 → "pressure"
PM2.5传感器/空气质量传感器 → "pm25"
CO2传感器/二氧化碳传感器 → "co2"

### 二值型传感器（binary_sensor域）
人体感应器/移动传感器/运动传感器 → "motion"
占用传感器/在位传感器/房间占用检测器 → "occupancy"
门窗传感器/门磁 → "door"
烟雾报警器/烟感器 → "smoke"
水浸传感器/漏水传感器 → "moisture"
震动传感器 → "vibration"
玻璃破碎传感器 → "safety"

### 其他设备
门铃/智能门铃 → "button"

## 英文设备名称映射
ceiling light/吸顶灯 → "light" (device_name: "吸顶灯", device_name_en: "ceiling_light")
floor lamp/落地灯 → "light" (device_name: "落地灯", device_name_en: "floor_lamp")
table lamp/台灯 → "light" (device_name: "台灯", device_name_en: "table_lamp")

## Home Assistant服务调用规则

### 灯光控制 (light域)
- **服务**: \`light.turn_on\`, \`light.turn_off\`, \`light.toggle\`
- **参数**:
  {
    "color_name": "red|blue|green|white|yellow|purple|orange|pink",
    "brightness_pct": 1-100,
    "color_temp": 153-500,  // 冷光6500K=153, 暖光3000K=333
    "rgb_color": [255, 0, 0],
    "transition": 秒数
  }

### 空调控制 (climate域)
- **服务**: \`climate.set_temperature\`, \`climate.set_hvac_mode\`, \`climate.turn_on\`, \`climate.turn_off\`
- **参数**:
  {
    "temperature": 温度值,
    "hvac_mode": "heat|cool|auto|dry|fan_only|off",
    "fan_mode": "auto|low|medium|high",
    "swing_mode": "on|off"
  }

### 风扇控制 (fan域)
- **服务**: \`fan.turn_on\`, \`fan.turn_off\`, \`fan.set_percentage\`, \`fan.oscillate\`
- **参数**:
  {
    "percentage": 1-100,  // 1档=20%, 2档=40%, 3档=60%, 4档=80%, 5档=100%
    "oscillating": true|false
  }

### 窗帘控制 (cover域)
- **服务**: \`cover.open_cover\`, \`cover.close_cover\`, \`cover.set_cover_position\`, \`cover.stop_cover\`
- **参数**:
  {
    "position": 0-100  // 0=完全关闭, 100=完全打开
  }

### 开关控制 (switch域)
- **服务**: \`switch.turn_on\`, \`switch.turn_off\`, \`switch.toggle\`

### 媒体播放器 (media_player域)
- **服务**: \`media_player.turn_on\`, \`media_player.turn_off\`, \`media_player.volume_set\`, \`media_player.media_play\`, \`media_player.media_pause\`
- **参数**:
  {
    "volume_level": 0.0-1.0,
    "media_content_id": "内容ID",
    "media_content_type": "music|video"
  }

### 传感器状态查询规则

#### 数值型传感器（sensor域）
- **设备类型**: temperature, humidity, illuminance, power, energy, pressure, pm25, co2等
- **服务**: \`sensor.state\`
- **示例**: 查询温度时，\`device_type: "temperature"\` 配合 \`service: "sensor.state"\`

#### 二值型传感器（binary_sensor域）
- **设备类型**: motion, occupancy, door, smoke, moisture, vibration, safety等
- **服务**: \`binary_sensor.state\`
- **示例**: 查询运动传感器时，\`device_type: "motion"\` 配合 \`service: "binary_sensor.state"\`

## 参数提取规则

### 颜色参数
红色 → "red"
蓝色 → "blue" 
绿色 → "green"
白色 → "white"
黄色 → "yellow"
紫色 → "purple"
橙色 → "orange"
粉色 → "pink"

### 亮度参数
X% → X
最亮/全亮 → 100
最暗/微亮 → 1
亮一点/调亮一些/亮一些 → +20
暗一点/调暗一些/暗一些 → -20

### 温度参数
X度 → X
调高/升高/热一点 → +2
调低/降低/冷一点 → -2

### 色温参数
暖光/暖白 → 333 (3000K)
冷光/冷白 → 153 (6500K)  
自然光/日光 → 250 (4000K)

## JSON输出格式

{
  "user_input": "用户原始输入",
  "intent": "Control Device|Query Device Status|Control Scene|Set Scene|Set Automation|Other",
  "devices": [
    {
      "floor_name": "楼层名称（本地语言，如：一楼、二楼、1階、1층）",
      "floor_name_en": "楼层英文名称（如：First Floor、Second Floor）",
      "floor_type": "楼层类型代码（如：first_floor、second_floor）",
      "room_type": "房间类型代码（如：living_room）",
      "room_name": "房间名称（本地语言，如：客厅、リビング、거실）",
      "room_name_en": "房间英文名称（如：living_room）",
      "device_type": "设备类型（HA域名）",
      "device_name": "设备名称（本地语言，如：吊灯、シーリングライト、천장 조명）",
      "device_name_en": "设备英文名称（如：ceiling_light）",
      "service": "HA服务名称（如：light.turn_on）",
      "service_data": "服务参数对象"
    }
  ],
  "confidence": 0.0-1.0，
  "user_responds": "根据用户的要求做一个简单的相应，语言与user_input保持一致"
}

## 输出示例

### 示例1：自定义房间设备控制
{
  "user_input": "打开Jayden房间的灯，亮度调亮一些",
  "intent": "Control Device",
  "devices": [
    {
      "floor_name": "",
      "floor_name_en": "",
      "floor_type": "", 
      "room_type": "",
      "room_name": "Jayden房间",
      "room_name_en": "Jayden_room",
      "device_type": "light",
      "device_name": "",
      "device_name_en": "",
      "service": "light.turn_on",
      "service_data": {
        "brightness_pct": "+20"
      }
    }
  ],
  "confidence": 0.9，
  "user_responds": "好的，即将为您执行灯光调节"
}

### 示例2：多设备状态查询
{
  "user_input": "主卧和客厅灯的状态",
  "intent": "Query Device Status",
  "devices": [
    {
      "floor_name": "",
      "floor_name_en": "",
      "floor_type": "",
      "room_type": "master_bedroom",
      "room_name": "主卧",
      "room_name_en": "master_bedroom",
      "device_type": "light",
      "device_name": "灯",
      "device_name_en": "light",
      "service": "light.state",
      "service_data": {}
    },
    {
      "floor_name": "",
      "floor_name_en": "",
      "floor_type": "",
      "room_type": "living_room",
      "room_name": "客厅",
      "room_name_en": "living_room",
      "device_type": "light",
      "device_name": "灯",
      "device_name_en": "light",
      "service": "light.state",
      "service_data": {}
    }
  ],
  "confidence": 0.9，
  "user_responds": "好的，即将为您查看灯光状态"
}

### 示例3：多楼层混合控制
{
  "user_input": "一楼落地灯变成蓝色，二楼客房空调调成26度，落地灯变成红色，亮一点",
  "intent": "Control Device",
  "devices": [
    {
      "floor_name": "一楼",
      "floor_name_en": "First Floor",
      "floor_type": "first_floor",
      "room_type": "",
      "room_name": "",
      "room_name_en": "",
      "device_type": "light",
      "device_name": "落地灯",
      "device_name_en": "floor_lamp",
      "service": "light.turn_on",
      "service_data": {
        "color_name": "blue"
      }
    },
    {
      "floor_name": "二楼",
      "floor_name_en": "Second Floor",
      "floor_type": "second_floor",
      "room_type": "guest_bedroom",
      "room_name": "客房",
      "room_name_en": "guest_bedroom",
      "device_type": "climate",
      "device_name": "空调",
      "device_name_en": "air_conditioner",
      "service": "climate.set_temperature",
      "service_data": {
        "temperature": 26
      }
    },
    {
      "floor_name": "二楼",
      "floor_name_en": "Second Floor",
      "floor_type": "second_floor",
      "room_type": "guest_bedroom",
      "room_name": "客房",
      "room_name_en": "guest_bedroom",
      "device_type": "light",
      "device_name": "落地灯",
      "device_name_en": "floor_light",
      "service": "light.turn_on",
      "service_data": {
        "color_name": "red",
        "brightness_pct": "+20"
      }
    }
  ],
  "confidence": 0.9，
  "user_responds": "好的，即将为您执行灯光和空调的控制"
}

### 示例4：房间人员检测查询（binary_sensor）
{
  "user_input": "主卧现在有人么",
  "intent": "Query Device Status",
  "devices": [
    {
      "floor_name": "",
      "floor_name_en": "",
      "floor_type": "",
      "room_type": "master_bedroom",
      "room_name": "主卧",
      "room_name_en": "master_bedroom",
      "device_type": "occupancy",
      "device_name": "占用传感器",
      "device_name_en": "occupancy_sensor",
      "service": "binary_sensor.state",
      "service_data": {}
    },
    {
      "floor_name": "",
      "floor_name_en": "",
      "floor_type": "",
      "room_type": "master_bedroom",
      "room_name": "主卧",
      "room_name_en": "master_bedroom",
      "device_type": "motion",
      "device_name": "运动传感器",
      "device_name_en": "motion_sensor",
      "service": "binary_sensor.state",
      "service_data": {}
    }
  ],
  "confidence": 0.9，
  "user_responds": "好的，我帮您查看主卧的占用和运动传感器状态"
}

### 示例5：温湿度查询（sensor）
{
  "user_input": "客厅温度和湿度是多少",
  "intent": "Query Device Status",
  "devices": [
    {
      "floor_name": "",
      "floor_name_en": "",
      "floor_type": "",
      "room_type": "living_room",
      "room_name": "客厅",
      "room_name_en": "living_room",
      "device_type": "temperature",
      "device_name": "温度传感器",
      "device_name_en": "temperature_sensor",
      "service": "sensor.state",
      "service_data": {}
    },
    {
      "floor_name": "",
      "floor_name_en": "",
      "floor_type": "",
      "room_type": "living_room",
      "room_name": "客厅",
      "room_name_en": "living_room",
      "device_type": "humidity",
      "device_name": "湿度传感器",
      "device_name_en": "humidity_sensor",
      "service": "sensor.state",
      "service_data": {}
    }
  ],
  "confidence": 0.9，
  "user_responds": "好的，我帮您查看客厅的温度和湿度"
}

## 重要注意事项

1. **服务名称格式**: 必须使用完整的Home Assistant服务格式：\`域名.服务名\`

2. **楼层/房间上下文继承**：若一句话中前面已指定楼层或房间，后续未标明位置的设备默认继承最近的楼层或房间。

3. **房间匹配规则**：
   - **家里/全屋/全家/整个屋子/所有房间**：❌ 不能当房间名用！✅ room_name 和room_name_en 必须留空，只保留设备类型。
   - **只提楼层**（例：「二楼空调」）：✅ 填写 \`floor_name\`，房间留空。
   - **只提房间**（例：「主卧灯」）：✅ 填写 \`room_name\`，楼层留空。
   - **同时有楼层和房间**（例：「二楼客厅空调」）：✅ \`floor_name\` 和 \`room_name\` 都要填。

4. **设备类型 vs 设备名称**：
   - 用户只说了设备类型（如：灯、空调、风扇…）时，\`device_name\` 和 \`device_name_en\` 必须留空
   - 只有用户明确说了「落地灯」「台灯」「书房空调」这种情况，才能填 \`device_name\`
   - **人员检测查询规则**：专门处理"有人吗？"这类查询，明确要求同时返回occupancy和motion两种传感器

5. **服务调用格式**：
   - 查询状态时，必须根据设备域名正确使用服务：
     - 可控制设备状态查询：\`light.state\`、\`climate.state\`、\`switch.state\`、\`fan.state\`、\`cover.state\`等
     - 数值型传感器（sensor域）：\`sensor.state\` → 适用于 temperature, humidity, illuminance, power, energy, pressure, pm25, co2等
     - 二值型传感器（binary_sensor域）：\`binary_sensor.state\` → 适用于 motion, occupancy, door, smoke, moisture, vibration, safety等
   - **严格规则**：
     - 如果 device_type 是 motion、occupancy、door、smoke、moisture、vibration、safety，必须使用 \`binary_sensor.state\`
     - 如果 device_type 是 temperature、humidity、illuminance、power、energy、pressure、pm25、co2，必须使用 \`sensor.state\`
   - 不允许随意更改格式

6. **参数完整性**：
   - 相对调节必须带符号：\`+\` 或 \`-\`
   - 参数字段必须写 \`service_data\`，不能写成 \`data\`

7. **格式要求**：
   - JSON必须是有效格式，所有引号/逗号正确
   - 确保所有必需字段都已填写`;

        return {
            success: true,
            data: { prompt: defaultPrompt, is_custom: false }
        };
    }

    /**
     * Save custom system prompt
     */
    async saveSystemPrompt(prompt) {
        try {
            if (!prompt || typeof prompt !== 'string') {
                return { success: false, error: 'Invalid prompt' };
            }

            await fs.mkdir(this.dataDir, { recursive: true });
            await fs.writeFile(this.promptFile, prompt.trim(), 'utf8');

            this.logger.info('Custom system prompt saved');
            return { success: true, message: 'System prompt saved successfully' };
        } catch (e) {
            this.logger.error('Failed to save system prompt:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Delete custom system prompt (restore default)
     */
    async deleteSystemPrompt() {
        try {
            await fs.unlink(this.promptFile);
            this.logger.info('Custom system prompt deleted, using default');
            return { success: true, message: 'Custom prompt deleted, using default' };
        } catch (e) {
            if (e.code === 'ENOENT') {
                return { success: true, message: 'No custom prompt to delete' };
            }
            this.logger.error('Failed to delete system prompt:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Get classification system prompt (custom or default)
     */
    async getClassificationSystemPrompt() {
        try {
            // Try to read custom classification prompt
            const customPrompt = await fs.readFile(this.classificationPromptFile, 'utf8');
            if (customPrompt && customPrompt.trim()) {
                return { success: true, data: { prompt: customPrompt, is_custom: true } };
            }
        } catch (e) {
            // File doesn't exist, use default
        }

        // Use default classification prompt
        return {
            success: true,
            data: { prompt: this.getClassificationPrompt(), is_custom: false }
        };
    }

    /**
     * Save custom classification prompt
     */
    async saveClassificationPrompt(prompt) {
        try {
            if (!prompt || typeof prompt !== 'string') {
                return { success: false, error: 'Invalid prompt' };
            }

            await fs.mkdir(this.dataDir, { recursive: true });
            await fs.writeFile(this.classificationPromptFile, prompt.trim(), 'utf8');

            this.logger.info('Custom classification prompt saved');
            return { success: true, message: 'Classification prompt saved successfully' };
        } catch (e) {
            this.logger.error('Failed to save classification prompt:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Delete custom classification prompt (restore default)
     */
    async deleteClassificationPrompt() {
        try {
            await fs.unlink(this.classificationPromptFile);
            this.logger.info('Custom classification prompt deleted, using default');
            return { success: true, message: 'Custom classification prompt deleted, using default' };
        } catch (e) {
            if (e.code === 'ENOENT') {
                return { success: true, message: 'No custom classification prompt to delete' };
            }
            this.logger.error('Failed to delete classification prompt:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Save to history
     */
    async saveToHistory(entry) {
        try {
            let history = [];
            try {
                const data = await fs.readFile(this.intentionsFile, 'utf8');
                history = JSON.parse(data);
            } catch (e) {
                // File doesn't exist yet
            }

            history.unshift(entry);
            // Keep only last 100 entries
            if (history.length > 100) {
                history = history.slice(0, 100);
            }

            await fs.writeFile(this.intentionsFile, JSON.stringify(history, null, 2), 'utf8');
        } catch (e) {
            this.logger.warn('Failed to save to history:', e.message);
        }
    }

    /**
     * Get intentions history
     */
    async getHistory(limit = 50) {
        try {
            const data = await fs.readFile(this.intentionsFile, 'utf8');
            const history = JSON.parse(data);
            return {
                success: true,
                data: {
                    total: history.length,
                    intentions: history.slice(0, limit)
                }
            };
        } catch (e) {
            return {
                success: true,
                data: { total: 0, intentions: [] }
            };
        }
    }

    /**
     * Get current AI provider configuration
     */
    async getAIProviderConfig() {
        const currentProvider = this.config.aiProvider || 'auto';
        
        // Check which providers are available
        const providers = ['claude', 'openai', 'gemini', 'deepseek'];
        const available = [];

        for (const name of providers) {
            const mod = global.moduleManager?.getModule(name);
            if (mod && typeof mod.sendSimpleChat === 'function') {
                try {
                    const res = await mod.getCredentials();
                    const hasCredentials = res.success && res.data && 
                        Object.entries(res.data).some(([k, v]) => 
                            !k.startsWith('_') && typeof v === 'string' && v.trim()
                        );
                    
                    available.push({
                        name,
                        available: hasCredentials
                    });
                } catch (e) {
                    available.push({ name, available: false });
                }
            } else {
                available.push({ name, available: false });
            }
        }

        return {
            success: true,
            data: {
                current: currentProvider,
                available
            }
        };
    }

    /**
     * Set AI provider
     */
    async setAIProvider(provider) {
        const validProviders = ['auto', 'claude', 'openai', 'gemini', 'deepseek'];
        if (!validProviders.includes(provider)) {
            return { success: false, error: 'Invalid provider' };
        }

        this.config.aiProvider = provider;
        try {
            await this.saveConfig();
            this.logger.info(`AI provider set to: ${provider}`);
            return { success: true, message: 'AI provider updated successfully' };
        } catch (e) {
            this.logger.error('Failed to save AI provider config:', e.message);
            return { success: false, error: e.message };
        }
    }
}

module.exports = IntentionModule;

