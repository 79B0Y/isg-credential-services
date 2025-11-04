const BaseCredentialModule = require('../../core/BaseCredentialModule');
const InfoListModule = require('./InfoListModule');
const BasicInfoModule = require('./BasicInfoModule');
const DeviceControlModule = require('./DeviceControlModule');
const SceneModule = require('./SceneModule');
const PermanentSceneModule = require('./PermanentSceneModule');
const AutomationModule = require('./AutomationModule');
const WebSocket = require('ws');

/**
 * Home_assistantModule - 重构后的Home Assistant API凭据管理模块
 * 使用模块化设计，分为多个子模块：信息列表、基础信息、设备控制、场景、自动化
 */
class Home_assistantModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);

        // Home Assistant API配置
        this.defaultTimeout = 10000;

        // 初始化子模块
        this.infoListModule = null;
        this.basicInfoModule = null;
        this.deviceControlModule = null;
        this.sceneModule = null;
        this.permanentSceneModule = null;
        this.automationModule = null;
        
        // 空间列表监控
        this.spaceMonitorTimer = null;
        this.lastSpacesHash = null;
        this.floorMappings = {};
        this.roomMappings = {};
        
        // WebSocket 服务器
        this.wss = null;
        this.websocketPort = 8081;
        this.websocketClients = new Set();
    }

    /**
     * 模块特定初始化
     */
    async onInitialize() {
        this.logger.info('Home Assistant module initializing with modular architecture...');

        if (!this.config.timeout) {
            this.config.timeout = this.defaultTimeout;
        }

        // 初始化子模块
        this.infoListModule = new InfoListModule(this.logger, this);
        this.basicInfoModule = new BasicInfoModule(this.logger, this);
        this.deviceControlModule = new DeviceControlModule(this.logger, this);
        this.sceneModule = new SceneModule(this.logger, this);
        this.permanentSceneModule = new PermanentSceneModule(this.logger, this);
        this.automationModule = new AutomationModule(this.logger, this);

        // 启动信息列表缓存更新器
        this.infoListModule.startEnhancedListCacheUpdater();
        
        // 启动空间列表监控（每5分钟检查一次）
        this.startSpaceMonitoring();

        this.logger.info('Home Assistant module initialized with modular architecture');
        
        // 检查是否已有有效凭据，如果有则自动启动 WebSocket
        this.autoStartWebSocket();
    }
    
    /**
     * 自动启动 WebSocket 服务器（如果有有效凭据）
     */
    async autoStartWebSocket() {
        try {
            // 延迟启动，避免初始化冲突
            setTimeout(async () => {
                try {
                    const credentialsResult = await this.getCredentials();
                    if (credentialsResult.success && credentialsResult.data.access_token && credentialsResult.data.base_url) {
                        this.logger.info('[AUTO-START] 发现已保存的 Home Assistant 凭据，自动启动 WebSocket 服务器...');
                        
                        // 启动 WebSocket 服务器
                        if (!this.wss) {
                            const result = await this.startWebSocketServer();
                            if (result.success) {
                                this.logger.info(`[AUTO-START] ✅ Home Assistant WebSocket 服务器启动成功 - ${result.url}`);
                            } else {
                                this.logger.warn('[AUTO-START] Home Assistant WebSocket 服务器启动失败:', result.error);
                            }
                        } else {
                            this.logger.info('[AUTO-START] Home Assistant WebSocket 服务器已在运行');
                        }
                    } else {
                        this.logger.info('[AUTO-START] 未找到有效的 Home Assistant 凭据，跳过 WebSocket 自动启动');
                    }
                } catch (autoStartError) {
                    this.logger.warn('[AUTO-START] Home Assistant WebSocket 自动启动失败:', autoStartError.message);
                }
            }, 3000); // 3秒延迟，确保所有模块初始化完成
        } catch (error) {
            this.logger.warn('[AUTO-START] Home Assistant WebSocket 自动启动检查失败:', error.message);
        }
    }
    
    /**
     * 启动空间列表监控
     */
    startSpaceMonitoring() {
        if (this.spaceMonitorTimer) {
            return;
        }
        
        this.logger.info('[Space Monitor] Starting space list monitoring (every 5 minutes)');
        
        // 立即执行一次
        this.checkSpaceChanges().catch(err => {
            this.logger.error('[Space Monitor] Initial check error:', err);
        });
        
        // 每 5 分钟检查一次
        this.spaceMonitorTimer = setInterval(async () => {
            try {
                await this.checkSpaceChanges();
            } catch (error) {
                this.logger.error('[Space Monitor] Check error:', error);
            }
        }, 5 * 60 * 1000); // 5 minutes
    }
    
    /**
     * 停止空间列表监控
     */
    stopSpaceMonitoring() {
        if (this.spaceMonitorTimer) {
            clearInterval(this.spaceMonitorTimer);
            this.spaceMonitorTimer = null;
            this.logger.info('[Space Monitor] Space list monitoring stopped');
        }
    }

    /**
     * 执行Home Assistant API验证
     */
    async performValidation(credentials) {
        const { access_token, base_url } = credentials;

        if (!access_token) {
            return {
                success: false,
                error: 'Access token is required',
                details: { field: 'access_token' }
            };
        }

        if (!base_url) {
            return {
                success: false,
                error: 'Base URL is required',
                details: { field: 'base_url' }
            };
        }

        try {
            this.logger.info('Validating Home Assistant API credentials...');

            // 验证URL格式
            let baseUrl;
            try {
                baseUrl = new URL(base_url);
            } catch (urlError) {
                return {
                    success: false,
                    error: 'Invalid base URL format',
                    details: { field: 'base_url', message: urlError.message }
                };
            }

            // 使用基础信息模块进行连接测试
            const testResult = await this.basicInfoModule.testConnection(credentials);

            if (!testResult.success) {
                return {
                    success: false,
                    error: testResult.error,
                    details: testResult.details
                };
            }

            return {
                success: true,
                message: 'Home Assistant API credentials are valid',
                data: testResult.data
            };

        } catch (error) {
            this.logger.error('Home Assistant validation error:', error);
            return {
                success: false,
                error: 'Validation failed',
                details: {
                    message: error.message,
                    code: error.code
                }
            };
        }
    }

    /**
     * 测试连接
     */
    async testConnection(credentials = null) {
        return await this.basicInfoModule.testConnection(credentials);
    }

    // ========== 信息列表相关方法 ==========

    /**
     * 获取实体注册表
     */
    async getEntityRegistry(credentials = null) {
        const creds = credentials || (await this.getCredentials()).data;
        return await this.infoListModule.getEntityRegistryViaWebSocket(creds.access_token, creds.base_url);
    }

    /**
     * 获取设备注册表
     */
    async getDeviceRegistry(credentials = null) {
        const creds = credentials || (await this.getCredentials()).data;
        return await this.infoListModule.getDevicesViaWebSocket(creds.access_token, creds.base_url);
    }

    /**
     * 获取空间列表（楼层 + 房间），支持op格式
     */
    async getSpaces(op = 'floors', credentials = null) {
        return await this.infoListModule.getSpaces(op, credentials);
    }

    /**
     * 获取空间列表（getSpacesList别名，用于向后兼容）
     */
    async getSpacesList(credentials = null) {
        return await this.getSpaces('floors', credentials);
    }

    /**
     * 构建增强实体列表（包含state、device、room、floor等完整信息）
     */
    async buildEnhancedEntities(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            // 获取增强状态列表（包含 state, attributes 等）
            const enhancedStatesResult = await this.infoListModule.getEnhancedStates(credentials);

            if (!enhancedStatesResult.success) {
                return enhancedStatesResult;
            }

            // 应用楼层和房间的映射表增强
            const floorMappings = this.getFloorMappings();
            const roomMappings = this.getRoomMappings();

            const enrichedEntities = (enhancedStatesResult.data.states || []).map(entity => {
                const enriched = { ...entity };

                // 添加 area_id（与 room_id 相同）
                if (entity.room_id) {
                    enriched.area_id = entity.room_id;
                }

                // 应用楼层映射
                if (entity.floor_name && floorMappings[entity.floor_name]) {
                    const mapping = floorMappings[entity.floor_name];
                    enriched.floor_name_en = mapping.floor_name_en;
                    enriched.floor_type = mapping.floor_type;
                    enriched.level = mapping.level;
                }

                // 应用房间映射
                if (entity.room_name && roomMappings[entity.room_name]) {
                    const mapping = roomMappings[entity.room_name];
                    enriched.room_name_en = mapping.room_name_en;
                    enriched.room_type = mapping.room_type;
                }

                return enriched;
            });

            return {
                success: true,
                data: {
                    entities: enrichedEntities,
                    total_count: enrichedEntities.length,
                    retrieved_at: enhancedStatesResult.data.retrieved_at || new Date().toISOString()
                }
            };
        } catch (error) {
            this.logger.error('Failed to build enhanced entities:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取AI提示词（用于空间数据增强）
     */
    async getPrompt() {
        const systemPrompt = `您是专业的智能家居数据补全专家,专门负责为现有的房间楼层JSON数据补充缺失的标准化字段。

## 核心任务
- 接收用户提供的现有JSON数据
- 识别数据中缺失的必填字段
- 楼层名称统一翻译为标准英文(如 First Floor, Second Floor)
- 房间名称翻译为标准英文(如 Living Room, Kitchen等)

## 房间类型智能识别规则

**基于中文房间类型映射：**
- 客厅/大厅/会客厅/起居室 → "living_room"
- 卧室/睡房 → "bedroom"
- 主卧/主卧室 → "master_bedroom"
- 客卧/次卧 → "guest_bedroom"
- 儿童房/小孩房 → "kids_room"
- 厨房/烹饪间 → "kitchen"
- 餐厅/饭厅/用餐区 → "dining_room"
- 书房/办公室/工作室/学习室 → "study"
- 卫生间/洗手间/厕所/浴室 → "bathroom"
- 主卫/主卫生间 → "master_bathroom"
- 客卫/公卫 → "guest_bathroom"
- 储物间/杂物间/收纳间 → "storage"
- 衣帽间/更衣室 → "closet"
- 走廊/过道/通道 → "hallway"
- 玄关/门厅/入户 → "entrance"
- 阳台/露台/平台 → "balcony"
- 花园/后院/前院/庭院 → "garden"
- 车库/停车库 → "garage"
- 地下室/地库 → "basement"
- 阁楼/顶层 → "attic"
- 楼梯间 → "stairway"
- 娱乐室/游戏室/影音室/TV room → "entertainment"
- 健身房/运动室 → "gym"
- 洗衣房/洗衣间 → "laundry"

**多语言支持：**
- 当房间名称为其他语言时,先理解其含义,再参照上述映射规则进行类型判断
- 例如：英文"Living Room"对应"living_room"
- 例如：日文"寝室"对应"bedroom"

## 楼层类型识别规则

**基于楼层命名映射：**
- 一楼/1F/1层/地面层/first floor → "first_floor", level: 1
- 二楼/2F/2层/second floor → "second_floor", level: 2
- 三楼/3F/3层/third floor → "third_floor", level: 3
- 四楼及以上类推
- 地下室/地库/B1/basement → "basement", level: -1
- 阁楼/顶层/attic → "attic"

## 输出要求

必须严格按照以下JSON格式输出,不要添加任何markdown标记或额外文字:

{
  "floors": [
    {
      "floor_name": "原始楼层名称",
      "floor_name_en": "标准英文楼层名",
      "floor_type": "楼层类型",
      "level": 数字
    }
  ],
  "rooms": [
    {
      "room_name": "原始房间名称",
      "room_name_en": "标准英文房间名",
      "room_type": "房间类型"
    }
  ]
}

请直接返回JSON数据,不要包含任何解释说明。`;

        return {
            success: true,
            data: {
                prompt: systemPrompt
            }
        };
    }

    /**
     * 获取Home Assistant配置信息（用于健康检查）
     */
    async getConfig(credentials = null) {
        try {
            if (!credentials) {
                const credResult = await this.getCredentials();
                if (!credResult.success) {
                    return { success: false, error: 'No credentials found' };
                }
                credentials = credResult.data;
            }

            const { base_url, access_token } = credentials;
            if (!base_url || !access_token) {
                return { success: false, error: 'Base URL and access token are required' };
            }

            // 使用 basicInfoModule 调用 Home Assistant API /api/config
            const result = await this.basicInfoModule.callHomeAssistantAPI(
                access_token, 
                base_url, 
                '/api/config'
            );
            
            if (result && typeof result === 'object') {
        return {
            success: true,
                    data: result
                };
            } else {
                return {
                    success: false,
                    error: 'Invalid response from Home Assistant'
                };
            }
        } catch (error) {
            this.logger.error('Failed to get Home Assistant config:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取所有实体状态
     */
    async getStates(credentials = null) {
        return await this.basicInfoModule.getStates(credentials);
    }

    /**
     * 检查空间列表变化
     */
    async checkSpaceChanges() {
        try {
            // 获取当前空间列表
            const spacesResult = await this.getSpaces();
            if (!spacesResult || !spacesResult.success || !spacesResult.data) {
                this.logger.warn('[Space Monitor] Failed to get spaces');
                return;
            }
            
            // 从 buildSpaces 提取 floors 和 rooms
            const floors = spacesResult.data.floors || [];
            const rooms = [];
            // 从 floors 中提取所有 rooms
            floors.forEach(floor => {
                if (floor.rooms && Array.isArray(floor.rooms)) {
                    rooms.push(...floor.rooms);
                }
            });
            
            // 计算哈希值来检测变化
            const currentHash = this.calculateSpacesHash(floors, rooms);
            
            if (this.lastSpacesHash === null) {
                // 首次运行，保存哈希值
                this.lastSpacesHash = currentHash;
                this.logger.info(`[Space Monitor] Initial spaces recorded (${floors.length} floors, ${rooms.length} rooms)`);
                
                // 尝试从现有数据加载映射
                await this.loadExistingMappings(floors, rooms);
                return;
            }
            
            if (this.lastSpacesHash !== currentHash) {
                this.logger.info('[Space Monitor] Space list changed, enriching with OpenAI...');
                await this.enrichSpacesWithOpenAI(floors, rooms);
                this.lastSpacesHash = currentHash;
                
                // 广播空间列表变化到 WebSocket 客户端
                await this.broadcastSpaceChanges(spacesResult.data);
            } else {
                this.logger.info('[Space Monitor] No changes detected');
            }
        } catch (error) {
            this.logger.error('[Space Monitor] Error checking space changes:', error);
        }
    }
    
    /**
     * 计算空间列表的哈希值
     */
    calculateSpacesHash(floors, rooms) {
        const crypto = require('crypto');
        const data = JSON.stringify({ floors, rooms });
        return crypto.createHash('md5').update(data).digest('hex');
    }
    
    /**
     * 从现有数据加载映射（如果实体已有标准化字段）
     */
    async loadExistingMappings(floors, rooms) {
        // 检查楼层是否已有标准化字段
        for (const floor of floors) {
            if (floor.floor_name_en && floor.floor_type && floor.level !== undefined) {
                this.floorMappings[floor.floor_name] = {
                    floor_name_en: floor.floor_name_en,
                    floor_type: floor.floor_type,
                    level: floor.level
                };
            }
        }
        
        // 检查房间是否已有标准化字段
        for (const room of rooms) {
            if (room.room_name_en && room.room_type) {
                this.roomMappings[room.room_name] = {
                    room_name_en: room.room_name_en,
                    room_type: room.room_type
                };
            }
        }
        
        if (Object.keys(this.floorMappings).length > 0 || Object.keys(this.roomMappings).length > 0) {
            this.logger.info(`[Space Monitor] Loaded existing mappings: ${Object.keys(this.floorMappings).length} floors, ${Object.keys(this.roomMappings).length} rooms`);
        }
    }
    
    /**
     * 使用 OpenAI 丰富空间数据
     */
    async enrichSpacesWithOpenAI(floors, rooms) {
        try {
            // 获取 OpenAI 模块
            const openaiModule = global.moduleManager?.getModule('openai');
            if (!openaiModule) {
                this.logger.error('[Space Monitor] OpenAI module not found');
                return;
            }
            
            // 准备输入数据
            const inputData = {
                floors: floors.map(f => ({
                    floor_name: f.floor_name,
                    floor_name_en: f.floor_name_en,
                    floor_type: f.floor_type,
                    level: f.level
                })),
                rooms: rooms.map(r => ({
                    room_name: r.room_name,
                    room_name_en: r.room_name_en,
                    room_type: r.room_type
                }))
            };
            
            const systemPrompt = `您是专业的智能家居数据补全专家,专门负责为现有的房间楼层JSON数据补充缺失的标准化字段。

## 核心任务
- 接收用户提供的现有JSON数据
- 识别数据中缺失的必填字段
- 楼层名称统一翻译为标准英文(如 First Floor, Second Floor)
- 房间名称翻译为标准英文(如 Living Room, Kitchen等)

## 房间类型智能识别规则

**基于中文房间类型映射：**
- 客厅/大厅/会客厅/起居室 → "living_room"
- 卧室/睡房 → "bedroom"
- 主卧/主卧室 → "master_bedroom"
- 客卧/次卧 → "guest_bedroom"
- 儿童房/小孩房 → "kids_room"
- 厨房/烹饪间 → "kitchen"
- 餐厅/饭厅/用餐区 → "dining_room"
- 书房/办公室/工作室/学习室 → "study"
- 卫生间/洗手间/厕所/浴室 → "bathroom"
- 主卫/主卫生间 → "master_bathroom"
- 客卫/公卫 → "guest_bathroom"
- 储物间/杂物间/收纳间 → "storage"
- 衣帽间/更衣室 → "closet"
- 走廊/过道/通道 → "hallway"
- 玄关/门厅/入户 → "entrance"
- 阳台/露台/平台 → "balcony"
- 花园/后院/前院/庭院 → "garden"
- 车库/停车库 → "garage"
- 地下室/地库 → "basement"
- 阁楼/顶层 → "attic"
- 楼梯间 → "stairway"
- 娱乐室/游戏室/影音室/TV room → "entertainment"
- 健身房/运动室 → "gym"
- 洗衣房/洗衣间 → "laundry"

**多语言支持：**
- 当房间名称为其他语言时,先理解其含义,再参照上述映射规则进行类型判断
- 例如：英文"Living Room"对应"living_room"
- 例如：日文"寝室"对应"bedroom"

## 楼层类型识别规则

**基于楼层命名映射：**
- 一楼/1F/1层/地面层/first floor → "first_floor", level: 1
- 二楼/2F/2层/second floor → "second_floor", level: 2
- 三楼/3F/3层/third floor → "third_floor", level: 3
- 四楼及以上类推
- 地下室/地库/B1/basement → "basement", level: -1
- 阁楼/顶层/attic → "attic"

## 输出要求

必须严格按照以下JSON格式输出,不要添加任何markdown标记或额外文字:

{
  "floors": [
    {
      "floor_name": "原始楼层名称",
      "floor_name_en": "标准英文楼层名",
      "floor_type": "楼层类型",
      "level": 数字
    }
  ],
  "rooms": [
    {
      "room_name": "原始房间名称",
      "room_name_en": "标准英文房间名",
      "room_type": "房间类型"
    }
  ]
}

请直接返回JSON数据,不要包含任何解释说明。`;
            
            // 调用 OpenAI Simple Chat
            this.logger.info('[Space Monitor] Calling OpenAI to enrich space data...');
            const result = await openaiModule.sendSimpleChat(
                systemPrompt,
                JSON.stringify(inputData, null, 2),
                {
                    model: 'gpt-4o-mini',
                    temperature: 0.3,
                    max_tokens: 2000
                }
            );
            
            if (!result.success) {
                this.logger.error('[Space Monitor] OpenAI enrichment failed:', result.error);
                return;
            }
            
            // 解析 OpenAI 响应（应该是 JSON 对象）
            const enrichedData = result.data?.response_text || result.data?.message?.content || result.data?.content;
            
            if (!enrichedData) {
                this.logger.error('[Space Monitor] No content in OpenAI response');
                return;
            }
            
            // 如果是字符串，尝试解析
            let parsedData;
            if (typeof enrichedData === 'string') {
                try {
                    parsedData = JSON.parse(enrichedData);
                } catch (e) {
                    this.logger.error('[Space Monitor] Failed to parse OpenAI response as JSON');
                    return;
                }
            } else {
                parsedData = enrichedData;
            }
            
            // 更新映射表
            if (parsedData.floors) {
                for (const floor of parsedData.floors) {
                    this.floorMappings[floor.floor_name] = {
                        floor_name_en: floor.floor_name_en,
                        floor_type: floor.floor_type,
                        level: floor.level
                    };
                }
            }
            
            if (parsedData.rooms) {
                for (const room of parsedData.rooms) {
                    this.roomMappings[room.room_name] = {
                        room_name_en: room.room_name_en,
                        room_type: room.room_type
                    };
                }
            }
            
            this.logger.info(`[Space Monitor] Enrichment complete: ${Object.keys(this.floorMappings).length} floors, ${Object.keys(this.roomMappings).length} rooms mapped`);
            
            // 触发缓存更新
            if (this.infoListModule) {
                this.infoListModule.invalidateCache();
            }

        } catch (error) {
            this.logger.error('[Space Monitor] Error enriching spaces with OpenAI:', error);
        }
    }
    
    /**
     * 获取楼层映射表
     */
    getFloorMappings() {
        return this.floorMappings;
    }
    
    /**
     * 获取房间映射表
     */
    getRoomMappings() {
        return this.roomMappings;
    }

    // ========== WebSocket 相关方法 ==========

    /**
     * 启动 WebSocket 服务器
     */
    async startWebSocketServer(port = null) {
        try {
            if (this.wss) {
                this.logger.warn('[WebSocket] Server is already running');
                return { success: true, message: 'WebSocket server already running' };
            }

            const wsPort = port || this.websocketPort;
            this.wss = new WebSocket.Server({ port: wsPort });
            
            this.wss.on('connection', (ws, req) => {
                this.logger.info(`[WebSocket] New client connected from ${req.socket.remoteAddress}`);
                this.websocketClients.add(ws);
                
                // 设置客户端为活跃状态
                ws.isAlive = true;
                
                // 监听 pong 响应
                ws.on('pong', () => {
                    ws.isAlive = true;
                });
                
                // 不发送欢迎消息（根据用户要求）
                // 只发送当前空间列表
                this.sendCurrentSpaces(ws).catch(err => {
                    this.logger.error('[WebSocket] Error sending current spaces:', err);
                });
                
                ws.on('close', () => {
                    this.logger.info('[WebSocket] Client disconnected');
                    this.websocketClients.delete(ws);
                });
                
                ws.on('error', (error) => {
                    this.logger.error('[WebSocket] Client error:', error);
                    this.websocketClients.delete(ws);
                });
            });

            // 启动心跳检测（每30秒）
            this.startWebSocketHeartbeat();
            
            this.logger.info(`[WebSocket] Server started on port ${wsPort}`);
            return { 
                success: true, 
                message: 'WebSocket server started',
                port: wsPort,
                url: `ws://localhost:${wsPort}`
            };
        } catch (error) {
            this.logger.error('[WebSocket] Failed to start server:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 启动 WebSocket 心跳检测
     */
    startWebSocketHeartbeat() {
        if (this.wsHeartbeatTimer) {
            clearInterval(this.wsHeartbeatTimer);
        }
        
        this.wsHeartbeatTimer = setInterval(() => {
            if (!this.wss) return;
            
            this.websocketClients.forEach((ws) => {
                if (ws.isAlive === false) {
                    this.logger.info('[WebSocket] Terminating inactive client');
                    this.websocketClients.delete(ws);
                    return ws.terminate();
                }
                
                ws.isAlive = false;
                ws.ping();
            });
        }, 30000); // 每30秒检测一次
    }
    
    /**
     * 停止 WebSocket 心跳检测
     */
    stopWebSocketHeartbeat() {
        if (this.wsHeartbeatTimer) {
            clearInterval(this.wsHeartbeatTimer);
            this.wsHeartbeatTimer = null;
        }
    }

    /**
     * 停止 WebSocket 服务器
     */
    async stopWebSocketServer() {
        return new Promise((resolve) => {
            try {
                if (!this.wss) {
                    resolve({ success: true, message: 'WebSocket server is not running' });
                    return;
                }

                // 停止心跳检测
                this.stopWebSocketHeartbeat();

                // 关闭所有客户端连接
                this.websocketClients.forEach(ws => {
                    try {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.close(1000, 'Server shutdown');
                        }
                    } catch (error) {
                        this.logger.warn('[WebSocket] Error closing client:', error);
                    }
                });
                this.websocketClients.clear();

                // 关闭服务器
                this.wss.close(() => {
                    this.logger.info('[WebSocket] Server stopped');
                    this.wss = null;
                    resolve({ success: true, message: 'WebSocket server stopped' });
                });
            } catch (error) {
                this.logger.error('[WebSocket] Error stopping server:', error);
                resolve({ success: false, error: error.message });
            }
        });
    }

    /**
     * 获取 WebSocket 状态
     */
    getWebSocketStatus() {
        return {
            running: !!this.wss,
            port: this.websocketPort,
            clients: this.websocketClients.size,
            url: this.wss ? `ws://localhost:${this.websocketPort}` : null
        };
    }

    /**
     * 发送当前空间列表给新连接的客户端
     * 格式与 HTTP API 完全一致: {success: true, data: {...}}
     */
    async sendCurrentSpaces(ws) {
        try {
            const spacesResult = await this.getSpaces();
            if (spacesResult && spacesResult.success) {
                // 直接发送与 HTTP API 相同的格式
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(spacesResult));
                }
            }
        } catch (error) {
            this.logger.error('[WebSocket] Error sending current spaces:', error);
        }
    }

    /**
     * 广播空间列表变化到所有连接的客户端
     */
    async broadcastSpaceChanges(spacesData) {
        if (!this.wss || this.websocketClients.size === 0) {
            this.logger.info('[WebSocket] No clients connected, skipping broadcast');
            return;
        }

        // 构造与 HTTP API 相同的格式
        const message = {
                success: true,
            data: spacesData
        };

        const messageStr = JSON.stringify(message);
        let successCount = 0;
        let failCount = 0;

        this.websocketClients.forEach(ws => {
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(messageStr);
                    successCount++;
                } else {
                    failCount++;
                    this.websocketClients.delete(ws);
                }
        } catch (error) {
                this.logger.error('[WebSocket] Error broadcasting to client:', error);
                failCount++;
                this.websocketClients.delete(ws);
            }
        });

        this.logger.info(`[WebSocket] Broadcast complete: ${successCount} success, ${failCount} failed`);
    }

    /**
     * 获取所有场景列表
     */
    async getScenes(credentials = null) {
        return await this.sceneModule.getScenes(credentials);
    }

    /**
     * 执行场景
     */
    async activateScene(sceneId, credentials = null) {
        return await this.sceneModule.activateScene(sceneId, credentials);
    }

    /**
     * 创建场景
     */
    async createScene(sceneData, credentials = null) {
        return await this.sceneModule.createScene(sceneData, credentials);
    }

    /**
     * 批量执行场景
     */
    async activateScenes(sceneIds, credentials = null) {
        return await this.sceneModule.activateScenes(sceneIds, credentials);
    }

    /**
     * 删除场景
     */
    async deleteScene(sceneId, credentials = null) {
        return await this.sceneModule.deleteScene(sceneId, credentials);
    }

    /**
     * 批量删除场景
     */
    async deleteScenes(sceneIds, credentials = null) {
        return await this.sceneModule.deleteScenes(sceneIds, credentials);
    }

    /**
     * 获取场景示例
     */
    getSceneExamples() {
        return this.sceneModule.getSceneExamples();
    }

    // ========== 自动化相关方法 ==========

    /**
     * 获取所有自动化列表
     */
    async getAutomations(credentials = null) {
        return await this.automationModule.getAutomations(credentials);
    }

    /**
     * 创建自动化
     */
    async createAutomation(automationConfig, credentials = null) {
        return await this.automationModule.createAutomation(automationConfig, credentials);
    }

    /**
     * 删除自动化
     */
    async deleteAutomation(automationId, credentials = null) {
        return await this.automationModule.deleteAutomation(automationId, credentials);
    }

    /**
     * 启用自动化
     */
    async enableAutomation(automationId, credentials = null) {
        return await this.automationModule.enableAutomation(automationId, credentials);
    }

    /**
     * 禁用自动化
     */
    async disableAutomation(automationId, credentials = null) {
        return await this.automationModule.disableAutomation(automationId, credentials);
    }

    /**
     * 触发自动化（手动执行）
     */
    async triggerAutomation(automationId, credentials = null) {
        return await this.automationModule.triggerAutomation(automationId, credentials);
    }

    /**
     * 获取单个自动化详情
     */
    async getAutomation(automationId, credentials = null) {
        return await this.automationModule.getAutomation(automationId, credentials);
    }

    /**
     * 重新加载自动化配置
     */
    async reloadAutomations(credentials = null) {
        return await this.automationModule.reloadAutomations(credentials);
    }

    /**
     * 模块清理
     */
    async cleanup() {
        this.stopSpaceMonitoring();
        await this.stopWebSocketServer();
        if (this.infoListModule) {
            this.infoListModule.cleanup();
        }
        this.logger.info('Home Assistant module cleanup completed');
    }
}

module.exports = Home_assistantModule;
