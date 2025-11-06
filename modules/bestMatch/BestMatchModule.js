const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const PythonPool = require('./PythonPool');
const BaseCredentialModule = require('../../core/BaseCredentialModule');

/**
 * BestMatchModule - 智能设备匹配模块
 * 使用轻量TF-IDF + 余弦相似度来匹配意图设备与实体列表
 * 支持多语言（中英文/拼音）、模糊匹配、泛指设备和位置提取
 * 运行环境：Termux Proot Ubuntu（无GPU）
 */
class BestMatchModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        this.matcherScript = path.join(this.moduleDir, 'matcher_engine.py');
        this.aliasesFile = path.join(this.dataDir, 'aliases.json');
        this.historyFile = path.join(this.dataDir, 'match_history.json');

        this.aliasesCache = null;
        this.lastAliasUpdate = 0;
        
        // ⭐ 空间信息继承机制
        this.locationHistory = []; // 存储最近的空间信息 [{timestamp, floor, room}, ...]
        this.locationHistoryTimeout = 60000; // 1分钟
        
        // ⭐ Termux 环境检测和优化配置
        const TermuxHelper = require('../../lib/termux-helper');
        this.envConfig = TermuxHelper.getOptimizedConfig();
        this.isRestrictedEnv = this.envConfig.isRestrictedEnv;
        
        // ⭐ 实体缓存
        this.entitiesCache = null;
        this.entitiesCacheTime = 0;
        this.entitiesCacheTTL = this.envConfig.modules?.bestMatch?.cacheTTL || 60000;
        
        if (this.isRestrictedEnv) {
            this.logger.info('[BESTMATCH] 检测到受限环境（Termux/proot），应用性能优化');
        }

        // ⭐ Python 进程池（Termux 环境默认启用）
        this.pythonPool = null;

        // ⭐ 简易结果缓存（可选）
        this.matchCache = new Map();
        this.matchCacheMax = 200;
    }

    getDefaultConfig() {
        // 应用 Termux 环境优化
        const envOptimizations = this.envConfig?.modules?.bestMatch || {};
        
        return {
            pythonPath: 'python3',
            timeout: envOptimizations.timeout || 30000,
            maxHistorySize: 200,
            enableLLMFallback: envOptimizations.enableAIFallback ?? true,
            autoUpdateAliases: true,
            weights: { F: 0.15, R: 0.40, N: 0.30, T: 0.15 },
            thresholds: { floor: 0.70, room: 0.85, type: 0.65, name: 0.80 },
            topK: envOptimizations.topK || 100,
            disambiguationGap: 0.08,
            performanceLogging: envOptimizations.performanceLogging ?? false,
            usePythonPool: envOptimizations.usePythonPool ?? this.isRestrictedEnv
        };
    }

    getDefaultSchema() {
        return {
            type: 'object',
            properties: {
                llm_provider: {
                    type: 'string',
                    title: 'LLM Provider',
                    description: 'auto | claude | openai | gemini | deepseek',
                    default: 'auto'
                }
            }
        };
    }

    async onInitialize() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
        } catch (e) {
            this.logger.warn('Create data dir failed:', e.message);
        }

        // 读取/初始化别名
        await this.getAliases();

        // 启动 Python 进程池（如果启用）
        try {
            if (this.config.usePythonPool) {
                this.pythonPool = new PythonPool({
                    pythonPath: this.config.pythonPath || 'python3',
                    scriptPath: this.matcherScript,
                    logger: this.logger,
                    cwd: this.moduleDir
                });
                await this.pythonPool.start();
                this.logger.info('[BESTMATCH] Python 进程池已启动');
            }
        } catch (e) {
            this.logger.warn(`[BESTMATCH] 启动 Python 进程池失败，回退到一次性进程: ${e.message}`);
        }
        return { success: true };
    }

    async performValidation() {
        // 无外部连接，始终返回成功
        return { success: true, message: 'BestMatch module ready' };
    }

    // ========= 公共API =========
    
    /**
     * 从 ai_enhanced_entities 模块获取增强实体数据
     */
    async getEnhancedEntities() {
        try {
            const aiEnhancedModule = global.moduleManager?.getModule('ai_enhanced_entities');
            if (!aiEnhancedModule) {
                this.logger.error('ai_enhanced_entities module not found in moduleManager');
                return { success: false, error: 'ai_enhanced_entities module not found' };
            }
            
            // ⭐ 正确的方法名是 getSaved，不是 getSavedEntities
            if (typeof aiEnhancedModule.getSaved === 'function') {
                this.logger.info('Calling ai_enhanced_entities.getSaved()...');
                const result = await aiEnhancedModule.getSaved();
                this.logger.info(`getSaved() returned: success=${result.success}, entities=${result.data?.entities?.length || 0}`);
                return result;
            } else {
                this.logger.error('getSaved method not available on ai_enhanced_entities module');
                this.logger.error('Available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(aiEnhancedModule)));
                return { success: false, error: 'getSaved method not available' };
            }
        } catch (error) {
            this.logger.error('Failed to get enhanced entities:', error);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * 带缓存的实体获取（性能优化）
     */
    async getEnhancedEntitiesWithCache() {
        const now = Date.now();
        const cacheAge = now - this.entitiesCacheTime;
        
        // 缓存命中
        if (this.entitiesCache && cacheAge < this.entitiesCacheTTL) {
            this.logger.info(`✅ 使用缓存的实体数据 (${this.entitiesCache.length} 个, 年龄: ${Math.round(cacheAge/1000)}秒)`);
            return { success: true, data: { entities: this.entitiesCache } };
        }
        
        // 缓存未命中或过期，重新获取
        const cacheStatus = this.entitiesCache ? '过期' : '未初始化';
        this.logger.info(`🔄 实体缓存${cacheStatus}，重新获取...`);
        
        const result = await this.getEnhancedEntities();
        
        if (result.success && result.data?.entities) {
            this.entitiesCache = result.data.entities;
            this.entitiesCacheTime = now;
            
            // 在受限环境限制实体数量
            const maxEntities = this.envConfig.modules?.bestMatch?.maxEntities;
            if (maxEntities && this.entitiesCache.length > maxEntities) {
                this.logger.warn(`⚠️  实体数量 (${this.entitiesCache.length}) 超过限制 (${maxEntities})，截断处理`);
                this.entitiesCache = this.entitiesCache.slice(0, maxEntities);
            }
            
            this.logger.info(`💾 缓存 ${this.entitiesCache.length} 个实体（TTL: ${Math.round(this.entitiesCacheTTL/1000)}秒）`);
        }
        
        return result;
    }
    
    /**
     * 匹配设备（支持多种输入格式）
     * @param {Object|Array} intentionResult - 意图结果对象或设备数组
     * @param {Object|Array} entitiesResult - 实体结果对象、实体数组或 null（自动获取）
     * @param {String} userQuery - 用户查询文本
     */
    async matchDevices(intentionResult, entitiesResult, userQuery = '') {
        // ⭐ 性能监控
        const startTime = Date.now();
        const perfLog = {};
        const enablePerfLogging = this.config.performanceLogging;
        
        try {
            // 支持多种输入格式
            let intentDevices, actualUserQuery, intentName, scene, automation;
            
            // 格式1: 新格式 - 完整的 intention 对象
            if (intentionResult && typeof intentionResult === 'object' && intentionResult.success) {
                // 这是完整的intention对象
                const intentionData = intentionResult.data || {};
                intentDevices = intentionData.devices || [];
                actualUserQuery = intentionData.user_input || userQuery;
                intentName = intentionData.intent || 'Best Match';  // ⭐ 提取 intent
                scene = intentionData.scene || {};  // ⭐ 提取 scene
                automation = intentionData.automation || null;  // ⭐ 提取 automation
            }
            // 格式2: 旧格式 - 直接传数组
            else if (Array.isArray(intentionResult)) {
                intentDevices = intentionResult;
                actualUserQuery = userQuery;
                intentName = 'Best Match';  // 默认值
                scene = {};
                automation = null;
            }
            // 格式3: 空或错误
            else {
                return { success: false, error: 'Invalid input format for intentionResult' };
            }
            
            // ⭐ 空间信息继承处理
            intentDevices = this.inheritLocationInfo(intentDevices);
            
            // ⭐ 使用缓存的实体获取方法（性能优化）
            let t1 = Date.now();
            this.logger.info('🔍 获取增强实体数据...');
            const entitiesResponse = await this.getEnhancedEntitiesWithCache();
            perfLog.getEntities = Date.now() - t1;
            
            let entities = [];
            if (entitiesResponse.success) {
                const entitiesData = entitiesResponse.data || {};
                entities = entitiesData.entities || [];
                this.logger.info(`✅ 获取 ${entities.length} 个实体 (耗时: ${perfLog.getEntities}ms)`);
            } else {
                this.logger.warn('⚠️ Failed to fetch entities:', entitiesResponse.error);
                entities = [];
            }
            
            // 验证必要数据
            if (!Array.isArray(intentDevices) || !Array.isArray(entities)) {
                return { success: false, error: 'Invalid input: intent_devices and entities must be arrays' };
            }
            
            // 🔍 调试日志
            this.logger.info(`📊 Matching: ${intentDevices.length} intent devices against ${entities.length} entities`);
            if (intentDevices.length > 0) {
                this.logger.info(`First intent device:`, JSON.stringify(intentDevices[0], null, 2));
            }

            const aliases = await this.getAliases();

            // ⭐ 尝试快速匹配（JS 快速路径）
            let tFast = Date.now();
            const fastOut = this.tryFastMatch(intentDevices, entities);
            perfLog.fastPath = Date.now() - tFast;
            
            // ⭐ 在以下情况直接使用快速匹配结果：
            // 1. Termux/proot 环境
            // 2. 快速匹配成功且覆盖所有设备
            // 3. 配置禁用了 Python 匹配器
            const usePythonMatcher = this.config.usePythonMatcher !== false;  // 默认为 true
            const useOnlyFastMatch = this.isRestrictedEnv || 
                                    !usePythonMatcher || 
                                    (fastOut && fastOut.hasMatches && fastOut.coverAll);
            
            if (fastOut && useOnlyFastMatch) {
                // 读取设备状态并直接返回
                await this.enrichDeviceStates(fastOut.matched_devices, intentName);
                
                if (enablePerfLogging) {
                    perfLog.total = Date.now() - startTime;
                    if (this.isRestrictedEnv) {
                        this.logger.info(`⚡ Termux环境-仅快速匹配: 总耗时=${perfLog.total}ms | fast=${perfLog.fastPath}ms | 实体=${perfLog.getEntities}ms`);
                    } else if (!usePythonMatcher) {
                        this.logger.info(`⚡ Python匹配器已禁用-仅快速匹配: 总耗时=${perfLog.total}ms | fast=${perfLog.fastPath}ms | 实体=${perfLog.getEntities}ms`);
                    } else {
                        this.logger.info(`⚡ 快速路径命中: 总耗时=${perfLog.total}ms | fast=${perfLog.fastPath}ms | 实体=${perfLog.getEntities}ms`);
                    }
                }
                
                const out = { 
                    success: true, 
                    data: { 
                        intent: intentName, 
                        user_input: actualUserQuery, 
                        actions: fastOut.actions, 
                        matched_devices: fastOut.matched_devices, 
                        scene: scene || {}, 
                        automation: automation || {} 
                    }, 
                    _perf: perfLog 
                };
                
                await this.saveToHistory({ 
                    timestamp: new Date().toISOString(), 
                    input: { intentDevices, entities, userQuery }, 
                    output: out.data 
                });
                
                return out;
            }

            // ⭐ 如果在 Termux 环境但快速匹配失败，返回空结果
            if (this.isRestrictedEnv && (!fastOut || !fastOut.hasMatches)) {
                this.logger.warn('⚠️  Termux环境下快速匹配无结果，返回空匹配');
                const emptyOut = { 
                    success: true, 
                    data: { 
                        intent: intentName, 
                        user_input: actualUserQuery, 
                        actions: fastOut ? fastOut.actions : [], 
                        matched_devices: [], 
                        scene: scene || {}, 
                        automation: automation || {} 
                    }, 
                    _perf: perfLog 
                };
                return emptyOut;
            }

            const input = {
                intent_devices: intentDevices,
                entities,
                user_query: actualUserQuery,
                intent: intentName,  // ⭐ 添加 intent 字段
                aliases,
                config: {
                    weights: this.config.weights,
                    thresholds: this.config.thresholds,
                    topK: this.config.topK,
                    disambiguationGap: this.config.disambiguationGap
                }
            };

            // ⭐ Python 匹配（性能监控）
            t1 = Date.now();
            this.logger.info('🐍 调用 Python 匹配引擎...');
            const result = await this.callPythonMatcher(input);
            perfLog.pythonMatcher = Date.now() - t1;
            this.logger.info(`✅ Python 匹配完成 (耗时: ${perfLog.pythonMatcher}ms)`);

            // ⭐ 优化 1: 检查是否有匹配成功的设备
            const hasMatches = result && result.actions && result.actions.some(a => 
                Array.isArray(a.targets) && a.targets.length > 0
            );

            // ⭐ 优化 2: 如果有匹配成功的设备，先返回结果，AI 异步处理
            if (hasMatches) {
                this.logger.info('✅ 有匹配结果，立即返回');
                
                // ⭐ 同步 matched_devices：将所有 actions 中的 targets 整理到 matched_devices
                // 先清空，避免与 Python matcher 的填充重复
                result.matched_devices = [];
                
                if (result.actions && Array.isArray(result.actions)) {
                    for (const action of result.actions) {
                        if (action.targets && Array.isArray(action.targets) && action.targets.length > 0) {
                            // 为每个匹配的 target 添加到 matched_devices
                            for (const target of action.targets) {
                                const matchedDevice = {
                                    entity_id: target.entity_id,
                                    service: action.request.service || '',
                                    service_data: action.request.service_data || {}
                                };
                                
                                // ⭐ 如果原始 request 有 automation 字段，添加到 matched_device
                                if (action.request.automation) {
                                    matchedDevice.automation = action.request.automation;
                                }
                                
                                result.matched_devices.push(matchedDevice);
                            }
                        }
                    }
                }
                
                // ⭐ 读取设备状态并合并到 service_data（如果需要）
                await this.enrichDeviceStates(result.matched_devices, intentName);
                
                // ⭐ 添加 scene 和 automation 到输出
                result.scene = scene;
                if (automation) {
                    result.automation = automation;
                }
                
                // 保存历史
                this.saveToHistory({
                    timestamp: new Date().toISOString(),
                    input: { intentDevices, entities, userQuery },
                    output: result
                }).catch(e => this.logger.warn('保存历史失败:', e.message));
                
                // 立即返回结果
                return { success: true, data: result };
            }

            // ⭐ 优化 3: 没有匹配结果时，智能判断是否需要 AI
            t1 = Date.now();
            let aiCallCount = 0;
            if (this.config.enableLLMFallback && result && result.actions) {
                this.logger.info('🤖 检查是否需要 AI fallback...');
                for (const action of result.actions) {
                    if (Array.isArray(action.targets) && action.targets.length === 0) {
                        // ⭐ 优先检查已学习的设备名称映射
                        const deviceName = action.request.device_name || '';
                        const deviceType = action.request.device_type || '';
                        const room = action.request.room || '';
                        
                        if (deviceName) {
                            this.logger.info(`🔍 检查是否有已学习的设备名称映射: "${deviceName}"`);
                            
                            const learnedMapping = await this.findLearnedDeviceMapping(deviceName, deviceType, room);
                            
                            if (learnedMapping) {
                                // 找到已学习的映射，直接使用
                                this.logger.info(`✅ 使用已学习的映射，跳过 AI 调用`);
                                
                                // 从 entities 中找到对应的实体
                                const matchedEntity = entities.find(e => e.entity_id === learnedMapping.entity_id);
                                
                                if (matchedEntity) {
                                    // 添加到 targets
                                    action.targets = [{
                                        entity_id: matchedEntity.entity_id,
                                        device_type: matchedEntity.device_type || deviceType,
                                        device_name: matchedEntity.device_name || matchedEntity.friendly_name,
                                        floor: matchedEntity.floor_name_en || matchedEntity.floor_name || '',
                                        room: matchedEntity.room_name_en || matchedEntity.room_name || '',
                                        score: 0.95,  // 高分，因为是已学习的映射
                                        matched: {
                                            floor: { text: '', hit: '', score: 0 },
                                            room: { text: room, hit: matchedEntity.room_name_en || '', score: 1.0 },
                                            device_name: { text: deviceName, hit: matchedEntity.device_name || '', score: 1.0 },
                                            device_type: { text: deviceType, hit: deviceType, score: 1.0 }
                                        },
                                        learned_mapping: true,  // 标记为使用已学习的映射
                                        use_count: learnedMapping.use_count
                                    }];
                                    
                                    // 更新使用计数
                                    await this.saveDeviceNameMapping({
                                        user_name: deviceName,
                                        entity_id: learnedMapping.entity_id,
                                        entity_name: learnedMapping.entity_name,
                                        device_type: deviceType,
                                        room: room,
                                        confidence: learnedMapping.confidence,
                                        learned_at: new Date().toISOString()
                                    });
                                    
                                    continue;  // 跳过 AI 调用
                                } else {
                                    this.logger.warn(`⚠️  已学习的映射对应的实体不存在: ${learnedMapping.entity_id}`);
                                }
                            }
                        }
                        
                        // 没有找到已学习的映射，使用 AI
                        const needsAI = this.shouldUseAIFallback(action.request, entities);
                        
                        if (needsAI) {
                            this.logger.info(`🤖 设备类型存在但匹配失败，调用 AI 辅助`);
                            aiCallCount++;
                            try {
                                const suggest = await this.getLLMSuggestions(action.request, entities, actualUserQuery);
                                
                                if (suggest.success && suggest.data.device_name_mapping) {
                                    // AI 匹配成功，保存映射
                                    const mapping = suggest.data.device_name_mapping;
                                    await this.saveDeviceNameMapping(mapping);
                                    
                                    this.logger.info(`📚 AI 学习完成，下次将直接使用此映射`);
                                    
                                    // 将 AI 匹配的结果添加到 targets
                                    if (suggest.data.suggestions && suggest.data.suggestions.length > 0) {
                                        const aiSuggestion = suggest.data.suggestions[0];
                                        const matchedEntity = entities.find(e => e.entity_id === aiSuggestion.entity_id);
                                        
                                        if (matchedEntity) {
                                            action.targets = [{
                                                entity_id: matchedEntity.entity_id,
                                                device_type: matchedEntity.device_type || deviceType,
                                                device_name: matchedEntity.device_name || matchedEntity.friendly_name,
                                                floor: matchedEntity.floor_name_en || matchedEntity.floor_name || '',
                                                room: matchedEntity.room_name_en || matchedEntity.room_name || '',
                                                score: aiSuggestion.confidence || 0.90,
                                                matched: {
                                                    floor: { text: '', hit: '', score: 0 },
                                                    room: { text: room, hit: matchedEntity.room_name_en || '', score: 1.0 },
                                                    device_name: { text: deviceName, hit: matchedEntity.device_name || '', score: 1.0 },
                                                    device_type: { text: deviceType, hit: deviceType, score: 1.0 }
                                                },
                                                ai_matched: true,  // 标记为 AI 匹配
                                                ai_confidence: aiSuggestion.confidence
                                            }];
                                        }
                                    }
                                } else if (suggest.success) {
                                    // 兼容旧格式
                                    action.suggestions_if_empty = suggest.data.suggestions || [];
                                    if (this.config.autoUpdateAliases && suggest.data.new_aliases) {
                                        await this.updateAliases(suggest.data.new_aliases);
                                    }
                                }
                            } catch (e) {
                                this.logger.warn('AI 匹配失败:', e.message);
                            }
                        } else {
                            this.logger.info('⏭️  空间内无此设备类型，跳过 AI 识别');
                            action.skip_reason = 'device_type_not_found_in_space';
                        }
                    }
                }
            }
            perfLog.aiFallback = Date.now() - t1;
            if (aiCallCount > 0) {
                this.logger.info(`🤖 AI fallback 完成: ${aiCallCount} 次调用 (耗时: ${perfLog.aiFallback}ms)`);
            }

            // ⭐ 同步 matched_devices：将所有 actions 中的 targets 整理到 matched_devices
            // 先清空，避免与 Python matcher 的填充重复
            result.matched_devices = [];
            
            if (result.actions && Array.isArray(result.actions)) {
                for (const action of result.actions) {
                    if (action.targets && Array.isArray(action.targets) && action.targets.length > 0) {
                        // 为每个匹配的 target 添加到 matched_devices
                        for (const target of action.targets) {
                            const matchedDevice = {
                                entity_id: target.entity_id,
                                service: action.request.service || '',
                                service_data: action.request.service_data || {}
                            };
                            
                            // ⭐ 如果原始 request 有 automation 字段，添加到 matched_device
                            if (action.request.automation) {
                                matchedDevice.automation = action.request.automation;
                            }
                            
                            result.matched_devices.push(matchedDevice);
                        }
                    }
                }
            }
            
            // ⭐ 读取设备状态并合并到 service_data（如果需要）
            t1 = Date.now();
            await this.enrichDeviceStates(result.matched_devices, intentName);
            perfLog.enrichStates = Date.now() - t1;
            if (perfLog.enrichStates > 0) {
                this.logger.info(`📖 设备状态读取完成 (耗时: ${perfLog.enrichStates}ms)`);
            }
            
            // ⭐ 添加 scene 和 automation 到输出
            result.scene = scene;
            if (automation) {
                result.automation = automation;
            }

            await this.saveToHistory({
                timestamp: new Date().toISOString(),
                input: { intentDevices, entities, userQuery },
                output: result
            });

            // ⭐ 性能统计
            perfLog.total = Date.now() - startTime;
            if (enablePerfLogging) {
                this.logger.info(`📊 性能统计: 总耗时=${perfLog.total}ms | 实体获取=${perfLog.getEntities}ms | Python匹配=${perfLog.pythonMatcher}ms | AI=${perfLog.aiFallback || 0}ms | 状态读取=${perfLog.enrichStates || 0}ms`);
            }

            return { success: true, data: result, _perf: perfLog };
        } catch (e) {
            this.logger.error('matchDevices error:', e.message);
            return { success: false, error: e.message };
        }
    }

    async getHistory(limit = 50) {
        try {
            const data = await fs.readFile(this.historyFile, 'utf8').catch(() => '[]');
            const arr = JSON.parse(data);
            return { success: true, data: { total: arr.length, history: arr.slice(0, limit) } };
        } catch (e) {
            return { success: true, data: { total: 0, history: [] } };
        }
    }

    async clearHistory() {
        await fs.writeFile(this.historyFile, '[]', 'utf8');
        return { success: true };
    }

    async getStats() {
        const h = await this.getHistory(1000);
        const history = h.data.history || [];
        let total = 0, matchedActions = 0, sumScore = 0, scoreCount = 0;
        for (const item of history) {
            total++;
            const out = item.output || {};
            const actions = out.actions || [];
            for (const a of actions) {
                if (a.targets && a.targets.length > 0) {
                    matchedActions++;
                    for (const t of a.targets) {
                        if (typeof t.score === 'number') { sumScore += t.score; scoreCount++; }
                    }
                }
            }
        }
        return {
            success: true,
            data: {
                requests: total,
                actions_matched: matchedActions,
                avg_score: scoreCount ? Number((sumScore / scoreCount).toFixed(3)) : 0
            }
        };
    }

    // ========= 别名存取 =========
    async getAliases() {
        if (this.aliasesCache && Date.now() - this.lastAliasUpdate < 60000) {
            return this.aliasesCache;
        }
        try {
            const data = await fs.readFile(this.aliasesFile, 'utf8');
            this.aliasesCache = JSON.parse(data);
            this.lastAliasUpdate = Date.now();
            return this.aliasesCache;
        } catch {
            const defaults = {
                rooms: {
                    "living_room": ["客厅", "keting", "living", "livingroom", "lounge"],
                    "bedroom": ["卧室", "woshi", "bedroom", "bed_room"],
                    "master_bedroom": ["主卧", "zhuwo", "master", "masterbedroom"],
                    "kitchen": ["厨房", "chufang", "kitchen"],
                    "bathroom": ["浴室", "卫生间", "yushi", "weishengjian", "bathroom"],
                    "study": ["书房", "shufang", "study", "office"],
                    "dining_room": ["餐厅", "canting", "dining", "diningroom"],
                    "garage": ["车库", "cheku", "garage"],
                    "garden": ["花园", "后院", "huayuan", "houyuan", "garden", "backyard"],
                    "balcony": ["阳台", "yangtai", "balcony"]
                },
                floors: {
                    "1": ["一楼", "1楼", "yilou", "first", "firstfloor", "first_floor", "ground"],
                    "2": ["二楼", "2楼", "erlou", "second", "secondfloor", "second_floor"],
                    "3": ["三楼", "3楼", "sanlou", "third", "thirdfloor", "third_floor"]
                },
                device_types: {
                    "light": ["light", "lights", "lamp", "deng", "灯", "灯光"],
                    "switch": ["switch", "kaiguan", "开关", "socket", "chazuo", "插座"],
                    "climate": ["climate", "ac", "aircon", "kongtiao", "空调"],
                    "fan": ["fan", "fengshan", "风扇"],
                    "cover": ["cover", "chuanglian", "窗帘"],
                    "camera": ["camera", "cam", "shexiangtou", "摄像头"],
                    "sensor": ["sensor", "chuanganqi", "传感器"]
                },
                // ⭐ 新增：AI 学习的设备名称映射
                device_names: {}
            };
            await this.saveAliases(defaults);
            return defaults;
        }
    }
    
    /**
     * 保存 AI 学习到的设备名称映射
     * @param {Object} mapping - {user_name, entity_id, entity_name, device_type, room, confidence, learned_at}
     */
    async saveDeviceNameMapping(mapping) {
        try {
            const aliases = await this.getAliases();
            
            // 初始化 device_names 结构
            if (!aliases.device_names) {
                aliases.device_names = {};
            }
            
            // 使用 entity_name 作为 key，存储映射列表
            const entityName = mapping.entity_name;
            if (!aliases.device_names[entityName]) {
                aliases.device_names[entityName] = {
                    entity_id: mapping.entity_id,
                    device_type: mapping.device_type,
                    user_names: []  // 用户说过的各种名称
                };
            }
            
            // 添加用户名称（去重）
            const userNameLower = mapping.user_name.toLowerCase();
            const existing = aliases.device_names[entityName].user_names.find(
                item => item.name.toLowerCase() === userNameLower
            );
            
            if (!existing) {
                aliases.device_names[entityName].user_names.push({
                    name: mapping.user_name,
                    room: mapping.room,
                    confidence: mapping.confidence,
                    learned_at: mapping.learned_at,
                    use_count: 1
                });
                
                this.logger.info(`💾 保存设备名称映射: "${mapping.user_name}" → ${entityName} (${mapping.entity_id})`);
            } else {
                // 更新使用次数和置信度
                existing.use_count = (existing.use_count || 0) + 1;
                existing.confidence = Math.max(existing.confidence, mapping.confidence);
                existing.last_used = new Date().toISOString();
                
                this.logger.info(`📈 更新设备名称映射: "${mapping.user_name}" 使用次数 +1 (共 ${existing.use_count} 次)`);
            }
            
            await this.saveAliases(aliases);
            
            return { success: true, data: aliases.device_names[entityName] };
            
        } catch (e) {
            this.logger.error(`❌ 保存设备名称映射失败: ${e.message}`);
            return { success: false, error: e.message };
        }
    }
    
    /**
     * 查找已学习的设备名称映射
     * @param {String} userDeviceName - 用户说的设备名称
     * @param {String} deviceType - 设备类型
     * @param {String} room - 房间
     * @returns {Object|null} - 匹配的 entity_id 和entity_name，或 null
     */
    async findLearnedDeviceMapping(userDeviceName, deviceType, room) {
        try {
            const aliases = await this.getAliases();
            
            if (!aliases.device_names || Object.keys(aliases.device_names).length === 0) {
                return null;
            }
            
            const userNameLower = userDeviceName.toLowerCase();
            
            // 遍历所有设备名称映射
            for (const [entityName, mapping] of Object.entries(aliases.device_names)) {
                // 检查设备类型是否匹配
                if (mapping.device_type && mapping.device_type.toLowerCase() !== deviceType.toLowerCase()) {
                    continue;
                }
                
                // 检查用户名称是否匹配
                const matchedUserName = mapping.user_names.find(item => {
                    const nameLower = item.name.toLowerCase();
                    // 支持完全匹配或包含匹配
                    return nameLower === userNameLower || 
                           nameLower.includes(userNameLower) || 
                           userNameLower.includes(nameLower);
                });
                
                if (matchedUserName) {
                    // 可选：检查房间是否匹配（如果指定了房间）
                    if (room && matchedUserName.room && matchedUserName.room.toLowerCase() !== room.toLowerCase()) {
                        this.logger.info(`⚠️  找到映射但房间不匹配: "${userDeviceName}" → ${entityName} (房间: ${matchedUserName.room} vs ${room})`);
                        continue;
                    }
                    
                    this.logger.info(`✅ 找到已学习的映射: "${userDeviceName}" → ${entityName} (${mapping.entity_id}), 使用次数: ${matchedUserName.use_count}`);
                    
                    return {
                        entity_id: mapping.entity_id,
                        entity_name: entityName,
                        user_name_matched: matchedUserName.name,
                        confidence: matchedUserName.confidence,
                        use_count: matchedUserName.use_count
                    };
                }
            }
            
            return null;
            
        } catch (e) {
            this.logger.error(`❌ 查找设备名称映射失败: ${e.message}`);
            return null;
        }
    }

    async updateAliases(newAliases) {
        const current = await this.getAliases();
        const merged = { ...current };
        if (newAliases.rooms) merged.rooms = { ...merged.rooms, ...newAliases.rooms };
        if (newAliases.floors) merged.floors = { ...merged.floors, ...newAliases.floors };
        if (newAliases.device_types) merged.device_types = { ...merged.device_types, ...newAliases.device_types };
        await this.saveAliases(merged);
        return { success: true };
    }

    async saveAliases(aliases) {
        await fs.mkdir(this.dataDir, { recursive: true });
        await fs.writeFile(this.aliasesFile, JSON.stringify(aliases, null, 2), 'utf8');
        this.aliasesCache = aliases;
        this.lastAliasUpdate = Date.now();
    }

    // ========= 内部方法 =========
    
    /**
     * 读取设备状态并合并到 service_data
     * 如果 service 是 .state 结尾，则调用 HA API 读取设备状态并填充到 service_data
     * @param {Array} matchedDevices - 匹配的设备列表
     * @param {String} intentName - 意图名称
     */
    async enrichDeviceStates(matchedDevices, intentName = '') {
        if (!Array.isArray(matchedDevices) || matchedDevices.length === 0) {
            return;
        }
        
        // 只在 "Set Scene" 意图时读取状态
        if (intentName !== 'Set Scene') {
            this.logger.info(`⏭️ 意图 "${intentName}" 不需要读取设备状态`);
            return;
        }
        
        // 筛选出需要读取状态的设备（service 以 .state 结尾）
        const devicesToRead = matchedDevices.filter(dev => {
            const service = dev.service || '';
            return service.endsWith('.state');
        });
        
        if (devicesToRead.length === 0) {
            this.logger.info('⏭️ 没有需要读取状态的设备');
            return;
        }
        
        this.logger.info(`📖 需要读取 ${devicesToRead.length} 个设备的状态`);
        
        try {
            // 获取 Home Assistant 模块
            const haModule = global.moduleManager?.getModule('home_assistant');
            if (!haModule) {
                this.logger.error('❌ Home Assistant 模块不可用，无法读取设备状态');
                return;
            }
            
            // 获取 HA 凭证
            const credentialsResult = await haModule.getCredentials();
            if (!credentialsResult.success) {
                this.logger.error('❌ 无法获取 Home Assistant 凭证:', credentialsResult.error);
                return;
            }
            
            const credentials = credentialsResult.data;
            
            // 批量读取所有设备的状态
            const statesResult = await haModule.basicInfoModule.getStates(credentials);
            if (!statesResult.success || !Array.isArray(statesResult.data?.states)) {
                this.logger.error('❌ 读取设备状态失败:', statesResult.error);
                return;
            }
            
            // 构建 entity_id 到状态的映射
            const statesMap = new Map();
            statesResult.data.states.forEach(state => {
                statesMap.set(state.entity_id, state);
            });
            
            // 合并状态到 service_data
            let successCount = 0;
            for (const device of devicesToRead) {
                const entityState = statesMap.get(device.entity_id);
                
                if (!entityState) {
                    this.logger.warn(`⚠️ 未找到设备 ${device.entity_id} 的状态`);
                    continue;
                }
                
                // 根据设备类型提取相关状态数据
                const stateData = this.extractStateData(device.entity_id, entityState);
                
                // 合并到 service_data
                device.service_data = {
                    ...device.service_data,
                    ...stateData
                };
                
                successCount++;
                this.logger.info(`✅ ${device.entity_id}: ${JSON.stringify(stateData)}`);
            }
            
            this.logger.info(`📖 成功读取 ${successCount}/${devicesToRead.length} 个设备的状态`);
            
        } catch (error) {
            this.logger.error('❌ 读取设备状态时出错:', error.message);
        }
    }
    
    /**
     * 从实体状态中提取相关数据
     * @param {String} entityId - 实体 ID
     * @param {Object} entityState - 实体状态对象
     * @returns {Object} - 提取的状态数据
     */
    extractStateData(entityId, entityState) {
        const domain = entityId.split('.')[0];
        const state = entityState.state;
        const attributes = entityState.attributes || {};
        
        const stateData = {};
        
        // ⚠️ 对于大多数设备类型，包含基本 state 字段
        // ⚠️ 但 climate 设备不应使用 state，而应使用 hvac_mode
        if (domain !== 'climate') {
            stateData.state = state;
        }
        
        // 根据设备域名提取相关属性
        switch (domain) {
            case 'light':
                // 灯光：状态、亮度、颜色等
                if (attributes.brightness !== undefined) {
                    stateData.brightness = attributes.brightness;
                }
                
                // ⚠️ color_mode 是只读属性，不应该在 service_data 中设置
                // Home Assistant 会根据提供的颜色参数自动确定颜色模式
                // if (attributes.color_mode) {
                //     stateData.color_mode = attributes.color_mode;
                // }
                
                // ⭐ 颜色设置：根据当前的 color_mode 选择合适的颜色字段
                // 优先级：hs_color > rgb_color > color_temp
                // 避免同时设置多个颜色字段造成冲突
                const colorMode = attributes.color_mode;
                if (colorMode === 'hs' && attributes.hs_color) {
                    stateData.hs_color = attributes.hs_color;
                } else if (colorMode === 'rgb' && attributes.rgb_color) {
                    stateData.rgb_color = attributes.rgb_color;
                } else if (colorMode === 'color_temp' && attributes.color_temp) {
                    stateData.color_temp = attributes.color_temp;
                } else if (colorMode === 'xy' && attributes.xy_color) {
                    stateData.xy_color = attributes.xy_color;
                } else {
                    // 如果没有明确的 color_mode 或不匹配，按优先级设置
                    if (attributes.hs_color) {
                        stateData.hs_color = attributes.hs_color;
                    } else if (attributes.rgb_color) {
                        stateData.rgb_color = attributes.rgb_color;
                    } else if (attributes.color_temp) {
                        stateData.color_temp = attributes.color_temp;
                    } else if (attributes.xy_color) {
                        stateData.xy_color = attributes.xy_color;
                    }
                }
                
                if (attributes.effect) {
                    stateData.effect = attributes.effect;
                }
                break;
                
            case 'climate':
                // 空调：温度、模式、风速等
                // ⚠️ climate 实体不应使用 state 字段，而应使用 hvac_mode
                // Home Assistant API 返回的 state 字段对应 hvac_mode
                if (state && state !== 'unknown' && state !== 'unavailable') {
                    stateData.hvac_mode = state;  // ⭐ 使用 hvac_mode 而不是 state
                }
                if (attributes.temperature !== undefined) {
                    stateData.temperature = attributes.temperature;
                }
                if (attributes.target_temp_high !== undefined) {
                    stateData.target_temp_high = attributes.target_temp_high;
                }
                if (attributes.target_temp_low !== undefined) {
                    stateData.target_temp_low = attributes.target_temp_low;
                }
                // ⭐ 优先使用 attributes.hvac_mode（如果存在）
                if (attributes.hvac_mode) {
                    stateData.hvac_mode = attributes.hvac_mode;
                }
                if (attributes.fan_mode) {
                    stateData.fan_mode = attributes.fan_mode;
                }
                if (attributes.preset_mode) {
                    stateData.preset_mode = attributes.preset_mode;
                }
                break;
                
            case 'fan':
                // 风扇：速度、摆动等
                if (attributes.percentage !== undefined) {
                    stateData.percentage = attributes.percentage;
                }
                if (attributes.oscillating !== undefined) {
                    stateData.oscillating = attributes.oscillating;
                }
                if (attributes.preset_mode) {
                    stateData.preset_mode = attributes.preset_mode;
                }
                break;
                
            case 'cover':
                // 窗帘：位置、倾斜度等
                if (attributes.current_position !== undefined) {
                    stateData.position = attributes.current_position;
                }
                if (attributes.current_tilt_position !== undefined) {
                    stateData.tilt_position = attributes.current_tilt_position;
                }
                break;
                
            case 'media_player':
                // 媒体播放器：音量、来源等
                if (attributes.volume_level !== undefined) {
                    stateData.volume_level = attributes.volume_level;
                }
                if (attributes.is_volume_muted !== undefined) {
                    stateData.is_volume_muted = attributes.is_volume_muted;
                }
                if (attributes.source) {
                    stateData.source = attributes.source;
                }
                if (attributes.media_content_type) {
                    stateData.media_content_type = attributes.media_content_type;
                }
                break;
                
            case 'switch':
                // 开关：只需要状态
                // state 已经包含在 stateData 中
                break;
                
            default:
                // 其他设备：保留基本状态
                // 可以根据需要添加更多通用属性
                break;
        }
        
        return stateData;
    }
    
    /**
     * 清理过期的空间信息历史记录
     * 移除超过1分钟的记录
     */
    cleanLocationHistory() {
        const now = Date.now();
        this.locationHistory = this.locationHistory.filter(
            item => (now - item.timestamp) < this.locationHistoryTimeout
        );
    }
    
    /**
     * 添加空间信息到历史记录
     * @param {String} floor - 楼层信息
     * @param {String} room - 房间信息
     */
    addLocationToHistory(floor, room) {
        // 只记录有意义的空间信息
        if (!floor && !room) return;
        
        const now = Date.now();
        this.locationHistory.push({
            timestamp: now,
            floor: floor || '',
            room: room || ''
        });
        
        // 清理过期记录
        this.cleanLocationHistory();
    }
    
    /**
     * 获取唯一的空间信息（如果存在）
     * 返回最近1分钟内唯一的空间信息，如果有多个不同的空间信息则返回null
     * @returns {Object|null} - {floor, room} 或 null
     */
    getUniqueLocation() {
        this.cleanLocationHistory();
        
        if (this.locationHistory.length === 0) {
            return null;
        }
        
        // 检查是否所有记录都有相同的空间信息
        const firstLocation = this.locationHistory[0];
        const isUnique = this.locationHistory.every(item => 
            item.floor === firstLocation.floor && item.room === firstLocation.room
        );
        
        if (isUnique) {
            this.logger.info(`🏠 检测到唯一空间信息: floor=${firstLocation.floor}, room=${firstLocation.room}`);
            return {
                floor: firstLocation.floor,
                room: firstLocation.room
            };
        }
        
        this.logger.info(`🏠 检测到多个不同空间信息，不继承`);
        return null;
    }
    
    /**
     * 智能继承空间信息
     * 如果设备没有空间信息，尝试从历史记录中继承唯一的空间信息
     * @param {Array} devices - 设备数组
     * @returns {Array} - 处理后的设备数组
     */
    inheritLocationInfo(devices) {
        if (!Array.isArray(devices) || devices.length === 0) {
            return devices;
        }
        
        // 检查是否有设备缺少空间信息
        const hasDevicesWithoutLocation = devices.some(dev => {
            const hasFloor = dev.floor_name || dev.floor_name_en || dev.floor_type;
            const hasRoom = dev.room_name || dev.room_name_en || dev.room_type;
            return !hasFloor && !hasRoom;
        });
        
        if (!hasDevicesWithoutLocation) {
            // 所有设备都有空间信息，记录到历史
            // ⭐ 优先使用 EN 名称（与 matcher_engine.py 保持一致）
            devices.forEach(dev => {
                const floor = dev.floor_name_en || dev.floor_type || dev.floor_name;
                const room = dev.room_name_en || dev.room_type || dev.room_name;
                if (floor || room) {
                    this.addLocationToHistory(floor, room);
                }
            });
            return devices;
        }
        
        // 有设备缺少空间信息，尝试继承
        const uniqueLocation = this.getUniqueLocation();
        
        if (!uniqueLocation) {
            // 没有唯一的空间信息可继承
            return devices;
        }
        
        // 继承空间信息
        const processedDevices = devices.map(dev => {
            const hasFloor = dev.floor_name || dev.floor_name_en || dev.floor_type;
            const hasRoom = dev.room_name || dev.room_name_en || dev.room_type;
            
            // 如果设备没有空间信息，继承唯一的空间信息
            if (!hasFloor && !hasRoom && uniqueLocation) {
                this.logger.info(`🏠 设备 "${dev.device_name || dev.device_type}" 继承空间信息: floor=${uniqueLocation.floor}, room=${uniqueLocation.room}`);
                
                // ⭐ 继承的空间信息可能是 EN 名称或中文名称
                // 如果是标准的 EN 格式（如 tv_room），则设置到 _en 字段
                // 如果是中文（如 客厅），则设置到中文字段
                const isEnglishFormat = /^[a-z_]+$/.test(uniqueLocation.room);
                
                return {
                    ...dev,
                    // ⭐ 优先设置 EN 字段（与 matcher 优先级一致）
                    floor_name_en: isEnglishFormat ? uniqueLocation.floor : (dev.floor_name_en || ''),
                    floor_name: !isEnglishFormat ? uniqueLocation.floor : (dev.floor_name || ''),
                    room_name_en: isEnglishFormat ? uniqueLocation.room : (dev.room_name_en || ''),
                    room_name: !isEnglishFormat ? uniqueLocation.room : (dev.room_name || ''),
                    _inherited_location: true // 标记为继承的空间信息
                };
            }
            
            return dev;
        });
        
        return processedDevices;
    }
    
    /**
     * 智能判断是否需要使用 AI Fallback
     * 只有当设备类型存在且在指定位置找到相似设备但名称匹配不上时才返回 true
     * @param {Object} request - 匹配请求
     * @param {Array} entities - 实体列表
     * @returns {boolean}
     */
    shouldUseAIFallback(request, entities) {
        // 提取请求的设备类型
        const requestType = request.device_type || '';
        if (!requestType) {
            return false; // 没有指定类型，不需要 AI
        }
        
        // 标准化类型名称 - 移除空格、下划线、连字符
        const normalizeType = (type) => {
            if (!type) return '';
            return String(type).toLowerCase().trim()
                .replace(/[_-]/g, '')
                .replace(/\s+/g, '');
        };
        
        const requestTypeNorm = normalizeType(requestType);
        
        // 检查楼层和房间条件
        const requestFloor = request.floor || '';
        const requestRoom = request.room || '';
        
        this.logger.info(`🔍 检查 AI Fallback: type="${requestType}", floor="${requestFloor}", room="${requestRoom}"`);
        
        // 在实体列表中查找是否存在该设备类型
        let foundInTargetLocation = false;
        let foundInOtherLocation = false;
        let targetLocationDevices = [];
        
        for (const entity of entities) {
            // 获取实体的类型
            const entityType = entity.device_type || '';
            const entityDomain = entity.entity_id ? entity.entity_id.split('.')[0] : '';
            
            const entityTypeNorm = normalizeType(entityType);
            const entityDomainNorm = normalizeType(entityDomain);
            
            // 检查类型是否匹配（支持 device_type 或 domain 匹配）
            const typeMatches = (entityTypeNorm === requestTypeNorm) || 
                               (entityDomainNorm === requestTypeNorm) ||
                               (entityTypeNorm.includes(requestTypeNorm)) ||
                               (requestTypeNorm.includes(entityTypeNorm));
            
            if (typeMatches) {
                // ⭐ 优先使用 _en 字段和 room_type, floor_type 字段（与 Python matcher 保持一致）
                const entityFloorEn = entity.floor_name_en || '';
                const entityFloorType = entity.floor_type || '';
                const entityFloorName = entity.floor_name || '';
                
                const entityRoomEn = entity.room_name_en || '';
                const entityRoomType = entity.room_type || '';
                const entityRoomName = entity.room_name || '';
                
                // 楼层匹配检查 - 更宽松的匹配逻辑
                const floorMatches = !requestFloor || 
                                    normalizeType(entityFloorEn).includes(normalizeType(requestFloor)) ||
                                    normalizeType(requestFloor).includes(normalizeType(entityFloorEn)) ||
                                    normalizeType(entityFloorType).includes(normalizeType(requestFloor)) ||
                                    normalizeType(requestFloor).includes(normalizeType(entityFloorType)) ||
                                    normalizeType(entityFloorName).includes(normalizeType(requestFloor)) ||
                                    normalizeType(requestFloor).includes(normalizeType(entityFloorName));
                
                // 房间匹配检查 - 更宽松的匹配逻辑
                const roomMatches = !requestRoom || 
                                   normalizeType(entityRoomEn).includes(normalizeType(requestRoom)) ||
                                   normalizeType(requestRoom).includes(normalizeType(entityRoomEn)) ||
                                   normalizeType(entityRoomType).includes(normalizeType(requestRoom)) ||
                                   normalizeType(requestRoom).includes(normalizeType(entityRoomType)) ||
                                   normalizeType(entityRoomName).includes(normalizeType(requestRoom)) ||
                                   normalizeType(requestRoom).includes(normalizeType(entityRoomName));
                
                if (floorMatches && roomMatches) {
                    foundInTargetLocation = true;
                    targetLocationDevices.push(entity.entity_id);
                } else {
                    foundInOtherLocation = true;
                }
            }
        }
        
        // 决策逻辑
        if (!foundInTargetLocation && !foundInOtherLocation) {
            // 整个空间都没有这个设备类型，不需要 AI
            this.logger.info(`⏭️  设备类型 "${requestType}" 在整个空间都不存在，跳过 AI`);
            return false;
        }
        
        if (!foundInTargetLocation && foundInOtherLocation) {
            // 设备类型存在，但不在目标位置（在其他位置）
            this.logger.info(`⏭️  设备类型 "${requestType}" 仅存在于其他位置，跳过 AI`);
            return false;
        }
        
        if (foundInTargetLocation) {
            // 设备类型存在于目标位置，但名称没匹配上，需要 AI 帮助识别具体设备
            this.logger.info(`🤖 设备类型 "${requestType}" 存在于目标位置但名称未匹配 (找到 ${targetLocationDevices.length} 个设备: ${targetLocationDevices.slice(0, 5).join(', ')}${targetLocationDevices.length > 5 ? '...' : ''})，需要 AI 辅助`);
            return true;
        }
        
        return false;
    }
    
    callPythonMatcher(payload) {
        const pythonPath = this.config.pythonPath || 'python3';
        const timeout = this.config.timeout || 30000;

        // 优先使用持久进程池
        if (this.config.usePythonPool && this.pythonPool) {
            return this.pythonPool.execute(payload, timeout).catch(err => {
                this.logger.warn(`[BESTMATCH] Python 进程池执行失败，回退到一次性进程: ${err.message}`);
                return this._callPythonOnce(payload, pythonPath, timeout);
            });
        }

        // 回退：一次性进程
        return this._callPythonOnce(payload, pythonPath, timeout);
    }

    _callPythonOnce(payload, pythonPath, timeout) {
        return new Promise((resolve, reject) => {
            const p = spawn(pythonPath, [this.matcherScript], { cwd: this.moduleDir });
            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => {
                try { p.kill(); } catch {}
                reject(new Error('Python matcher timeout'));
            }, timeout);
            p.stdout.on('data', d => { stdout += d.toString(); });
            p.stderr.on('data', d => { stderr += d.toString(); });
            p.on('error', err => { clearTimeout(timer); reject(err); });
            p.on('close', code => {
                clearTimeout(timer);
                if (code === 0) {
                    try { resolve(JSON.parse(stdout)); }
                    catch (e) { reject(new Error(`Parse output failed: ${e.message}\n${stdout}`)); }
                } else {
                    reject(new Error(`Matcher exited ${code}: ${stderr}`));
                }
            });
            p.stdin.write(JSON.stringify(payload));
            p.stdin.end();
        });
    }

    // ========= JS 快速路径 =========
    
    /**
     * 标准化文本 - 移除空格、下划线、连字符等
     */
    normalizeText(text) {
        if (!text) return '';
        return String(text).toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[_-]/g, '')
            .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
            .trim();
    }
    
    /**
     * 模糊匹配 - 忽略空格、下划线、大小写
     */
    fuzzyMatch(a, b) {
        if (!a || !b) return false;
        return this.normalizeText(a) === this.normalizeText(b);
    }
    
    /**
     * Jaro-Winkler 距离算法（从 node-red-matcher-complete.js 移植）
     */
    jaroWinkler(a, b) {
        if (!a || !b) return 0;
        if (a === b) return 1;
        
        const md = Math.floor(Math.max(a.length, b.length) / 2) - 1;
        const aM = new Array(a.length).fill(false);
        const bM = new Array(b.length).fill(false);
        let m = 0, t = 0;
        
        for (let i = 0; i < a.length; i++) {
            const start = Math.max(0, i - md);
            const end = Math.min(i + md + 1, b.length);
            for (let j = start; j < end; j++) {
                if (bM[j]) continue;
                if (a[i] !== b[j]) continue;
                aM[i] = true;
                bM[j] = true;
                m++;
                break;
            }
        }
        
        if (m === 0) return 0;
        
        let k = 0;
        for (let i = 0; i < a.length; i++) {
            if (!aM[i]) continue;
            while (!bM[k]) k++;
            if (a[i] !== b[k]) t++;
            k++;
        }
        
        const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
        let p = 0;
        const maxP = 4;
        for (let i = 0; i < Math.min(maxP, a.length, b.length); i++) {
            if (a[i] === b[i]) p++;
            else break;
        }
        
        return jaro + p * 0.1 * (1 - jaro);
    }
    
    /**
     * 槽位相似度匹配 - 在多个候选值中找到最佳匹配
     */
    slotSim(queryText, ...candidates) {
        const q = this.normalizeText(queryText || '');
        if (!q) return { score: 0, hit: '' };
        
        const validCands = candidates.filter(Boolean).map(String);
        if (validCands.length === 0) return { score: 0, hit: '' };
        
        let bestScore = 0;
        let bestHit = '';
        
        for (const cand of validCands) {
            const c = this.normalizeText(cand);
            if (!c) continue;
            
            // 完全匹配
            if (q === c) {
                return { score: 1.0, hit: cand };
            }
            
            // ⭐ 子串匹配：如果查询词是候选词的子串
            if (c.includes(q)) {
                // 子串匹配得分：基于长度比例，权重更高
                // 例如: "strip" in "lightstrip" -> 5/10 = 0.50, 0.55 + 0.45*0.5 = 0.775
                // 如果查询词长度占比超过40%，给予更高分数
                const lengthRatio = q.length / c.length;
                let score;
                if (lengthRatio >= 0.4) {
                    // 有意义的子串（占比>=40%），基础分更高
                    score = 0.55 + lengthRatio * 0.45;  // 范围: 0.73-1.0，确保通过0.75阈值
                } else {
                    // 较短的子串，基础分较低
                    score = 0.40 + lengthRatio * 0.50;  // 范围: 0.40-0.60
                }
                if (score > bestScore) {
                    bestScore = score;
                    bestHit = cand;
                }
                continue;
            }
            if (q.includes(c)) {
                // 候选词是查询词的子串（较少见的情况）
                const lengthRatio = c.length / q.length;
                const score = 0.40 + lengthRatio * 0.50;
                if (score > bestScore) {
                    bestScore = score;
                    bestHit = cand;
                }
                continue;
            }
            
            // Jaro-Winkler 相似度
            const score = this.jaroWinkler(q, c);
            if (score > bestScore) {
                bestScore = score;
                bestHit = cand;
            }
        }
        
        return { score: bestScore, hit: bestHit };
    }
    
    /**
     * 楼层别名映射
     */
    normalizeFloor(input) {
        if (!input) return '';
        const normalized = this.normalizeText(input);
        
        // 已经是数字
        if (/^\d+$/.test(normalized)) return normalized;
        
        const FLOOR_ALIASES = {
            '1': ['一楼', '1楼', 'yilou', 'first', 'firstfloor', 'first_floor', 'ground'],
            '2': ['二楼', '2楼', 'erlou', 'second', 'secondfloor', 'second_floor'],
            '3': ['三楼', '3楼', 'sanlou', 'third', 'thirdfloor', 'third_floor']
        };
        
        for (const [level, aliases] of Object.entries(FLOOR_ALIASES)) {
            if (normalized === level) return level;
            for (const alias of aliases) {
                if (normalized === this.normalizeText(alias)) return level;
            }
        }
        
        return normalized;
    }
    
    /**
     * 房间别名映射
     */
    normalizeRoom(input) {
        if (!input) return '';
        const normalized = this.normalizeText(input);
        
        const ROOM_ALIASES = {
            'living_room': ['客厅', 'keting', 'living', 'livingroom', 'living_room', 'lounge'],
            'bedroom': ['卧室', 'woshi', 'bedroom', 'bed_room'],
            'master_bedroom': ['主卧', 'zhuwo', 'master', 'masterbedroom', 'master_bedroom'],
            'baby_room': ['婴儿房', '宝宝房', 'baby', 'babyroom', 'baby_room', 'nursery', 'kids', 'kids_room', 'kidsroom'],
            'kitchen': ['厨房', 'chufang', 'kitchen'],
            'bathroom': ['浴室', '卫生间', 'yushi', 'weishengjian', 'bathroom', 'washroom'],
            'study': ['书房', 'shufang', 'study', 'office'],
            'dining_room': ['餐厅', 'canting', 'dining', 'diningroom', 'dining_room'],
            'garage': ['车库', 'cheku', 'garage'],
            'garden': ['花园', '后院', 'huayuan', 'houyuan', 'garden', 'backyard', 'yard'],
            'balcony': ['阳台', 'yangtai', 'balcony'],
            'entertainment': ['娱乐室', '影音室', 'yuleshi', 'entertainment', 'tvroom', 'tv_room']
        };
        
        for (const [roomType, aliases] of Object.entries(ROOM_ALIASES)) {
            if (normalized === this.normalizeText(roomType)) return roomType;
            for (const alias of aliases) {
                if (normalized === this.normalizeText(alias)) return roomType;
            }
        }
        
        return normalized;
    }
    
    /**
     * 域名别名映射
     */
    normalizeDomain(input) {
        if (!input) return '';
        const normalized = this.normalizeText(input);
        
        const HA_DOMAIN_ALIASES = {
            'light': ['light', 'lights', 'lamp', 'deng', '灯'],
            'switch': ['switch', 'kaiguan', '开关', 'socket', 'chazuo', '插座'],
            'climate': ['climate', 'ac', 'aircon', 'kongtiao', '空调'],
            'fan': ['fan', 'fengshan', '风扇'],
            'cover': ['cover', 'chuanglian', '窗帘'],
            'camera': ['camera', 'cam', 'shexiangtou', '摄像头'],
            'sensor': ['sensor', 'chuanganqi', '传感器'],
            'binary_sensor': ['binary_sensor', 'binarysensor', 'presence', '存在', '在家'],
            // ⭐ occupancy 和 motion 作为独立的设备类型
            'occupancy': ['occupancy', 'occupied', '占用', '占用传感器'],
            'motion': ['motion', '运动', '运动传感器', '人体传感器'],
            // ⭐ door 和 window 作为独立的设备类型（虽然域名是 binary_sensor）
            'door': ['door', 'doors', 'men', '门', '门传感器', 'contact', 'contactsensor'],
            'window': ['window', 'windows', 'chuang', '窗', '窗户', '窗户传感器'],
            // ⭐ humidity 和 temperature 作为独立的设备类型（虽然域名是 sensor）
            'humidity': ['humidity', 'humiditysensor', 'shidu', '湿度', '湿度传感器'],
            'temperature': ['temperature', 'temp', 'temperaturesensor', 'tempsensor', 'wendu', '温度', '温度传感器']
        };
        
        for (const [domain, aliases] of Object.entries(HA_DOMAIN_ALIASES)) {
            if (normalized === this.normalizeText(domain)) return domain;
            for (const alias of aliases) {
                if (normalized === this.normalizeText(alias)) return domain;
            }
        }
        
        return input.toLowerCase();
    }

    buildTypeIndex(entities) {
        const index = new Map();
        for (const e of entities) {
            const domain = (e.entity_id || '').split('.')[0];
            const dt = e.device_type || '';
            const keys = [domain, dt].map(k => this.normalizeText(k)).filter(Boolean);
            for (const k of keys) {
                if (!index.has(k)) index.set(k, []);
                index.get(k).push(e);
            }
        }
        return index;
    }

    isGenericName(name) {
        if (!name) return false;
        const n = this.normalizeText(name);
        return [
            'light','lights','lamp','lamps','deng','灯','灯光','灯具','照明',
            'switch','switches','kaiguan','开关','socket','sockets','chazuo','插座','outlet','plug',
            'ac','aircon','kongtiao','空调','冷气','climate',
            'fan','fans','fengshan','风扇',
            'cover','covers','chuanglian','窗帘','curtain','blind',
            'sensor','sensors','chuanganqi','传感器',
            'binarysensor','occupancysensor','motionsensor','occupancy','motion',
            '占用传感器','运动传感器','人体传感器','存在传感器',
            'door','doors','men','门','门传感器','doorsensor',
            'window','windows','chuang','窗','窗户','窗户传感器','windowsensor',
            'contact','contactsensor','contacts','contactsensors',
            'humidity','humiditysensor','shidu','湿度','湿度传感器',
            'temperature','temperaturesensor','temp','tempsensor','wendu','温度','温度传感器'
        ].includes(n);
    }

    /**
     * 优化的快速匹配函数 - 两阶段匹配策略
     * 
     * 第一步：通过 floor_name_en, floor_type, room_name_en, room_type, device_type 筛选实体
     * 第二步：通过 device_name, device_name_en 进一步匹配
     * 
     * @param {Array} intentDevices - 意图设备列表
     * @param {Array} entities - 实体列表
     * @returns {Object} - {actions, matched_devices, coverAll, hasMatches}
     */
    tryFastMatch(intentDevices, entities) {
        if (!Array.isArray(intentDevices) || !Array.isArray(entities) || entities.length === 0) return null;

        const actions = [];
        const matchedDevices = [];
        let coverAll = true;
        let anyMatch = false;

        // 配置参数（与 node-red-matcher-complete.js 保持一致）
        const TH = { 
            floor: 0.70,
            room: 0.85,
            type: 0.65,
            name: 0.75  // 提高到 0.75
        };
        
        const W = { 
            F: 0.15,  // 楼层权重
            R: 0.40,  // 房间权重
            N: 0.30,  // 名称权重
            T: 0.15   // 类型权重
        };
        
        const BEST_K = 100;
        const DISAMBIG_GAP = 0.08;

        for (let devIndex = 0; devIndex < intentDevices.length; devIndex++) {
            const dev = intentDevices[devIndex];
            
            // ⭐ 优先使用 _en 字段（与 Python matcher 保持一致）
            const floorQ = dev.floor_name_en || dev.floor_type || dev.floor_name || '';
            const roomQ = dev.room_name_en || dev.room_type || dev.room_name || '';
            const nameQ = dev.device_name_en || dev.device_name || '';
            const typeQ = (dev.device_type || '').toLowerCase() || (dev.service ? String(dev.service).split('.')[0].toLowerCase() : '');
            
            this.logger.info(`\n${'='.repeat(80)}`);
            this.logger.info(`[快速匹配] 设备 #${devIndex + 1}/${intentDevices.length}`);
            this.logger.info(`  查询条件: floor="${floorQ}", room="${roomQ}", type="${typeQ}", name="${nameQ}"`);
            this.logger.info(`${'='.repeat(80)}`);
            
            // ==================== 第一步：空间信息 + 设备类型筛选 ====================
            const step1Start = Date.now();
            this.logger.info(`\n📍 [步骤1] 通过空间信息和设备类型筛选实体...`);
            this.logger.info(`  输入实体总数: ${entities.length}`);
            
            let step1Pool = entities;
            
            // 1.1 按设备类型筛选
            const normalizedTypeQ = this.normalizeDomain(typeQ);
            if (normalizedTypeQ) {
                const typeFilterStart = Date.now();
                step1Pool = entities.filter(e => {
                    const eDomain = e.entity_id ? e.entity_id.split('.')[0] : '';
                    const eType = (e.device_type || '').toLowerCase();
                    const normalizedEDomain = this.normalizeDomain(eDomain);
                    const normalizedEType = this.normalizeDomain(eType);
                    
                    // ⭐ 优先匹配精确的 device_type，如果没有再匹配域名
                    // 例如：occupancy 和 motion 都是 binary_sensor 域，但它们的 device_type 不同
                    if (normalizedTypeQ === normalizedEType || this.normalizeText(typeQ) === this.normalizeText(eType)) {
                        return true;  // device_type 精确匹配
                    }
                    
                    // 如果 device_type 不匹配，检查域名是否匹配
                    // 但如果查询的类型有独立定义（如 occupancy, motion, door, window, humidity, temperature），则不应匹配到其他类型
                    if (normalizedTypeQ === normalizedEDomain) {
                        // 检查查询类型是否是独立类型（非通用域名）
                        const isIndependentType = ['occupancy', 'motion', 'door', 'window', 'humidity', 'temperature'].includes(normalizedTypeQ);
                        if (isIndependentType) {
                            // 独立类型必须精确匹配 device_type
                            return normalizedTypeQ === normalizedEType || this.normalizeText(typeQ) === this.normalizeText(eType);
                        }
                        return true;  // 通用域名匹配
                    }
                    
                    return false;
                });
                const typeFilterTime = Date.now() - typeFilterStart;
                this.logger.info(`  [1.1] 设备类型筛选: ${entities.length} → ${step1Pool.length} (${typeFilterTime}ms)`);
                if (step1Pool.length > 0 && step1Pool.length <= 5) {
                    this.logger.info(`    匹配实体: ${step1Pool.map(e => e.entity_id).join(', ')}`);
                } else if (step1Pool.length > 5) {
                    this.logger.info(`    匹配实体(前5个): ${step1Pool.slice(0, 5).map(e => e.entity_id).join(', ')}...`);
                }
            } else {
                this.logger.info(`  [1.1] 未指定设备类型，跳过类型筛选`);
            }
            
            // 1.2 按空间信息筛选（楼层 + 房间）
            if (step1Pool.length > 0 && (floorQ || roomQ)) {
                const spaceFilterStart = Date.now();
                const spaceFiltered = step1Pool.filter(e => {
                    let floorMatch = true;
                    let roomMatch = true;
                    
                    // 楼层匹配
                    if (floorQ) {
                        const eFloorName = e.floor_name || '';
                        const eFloorNameEn = e.floor_name_en || '';
                        const eFloorType = e.floor_type || '';
                        const eLevel = e.level != null ? String(e.level) : '';
                        
                        const normalizedFloorQ = this.normalizeFloor(floorQ);
                        const normalizedEFloorName = this.normalizeFloor(eFloorName);
                        const normalizedEFloorNameEn = this.normalizeFloor(eFloorNameEn);
                        const normalizedEFloorType = this.normalizeFloor(eFloorType);
                        
                        floorMatch = this.fuzzyMatch(floorQ, eFloorName) ||
                                    this.fuzzyMatch(floorQ, eFloorNameEn) ||
                                    this.fuzzyMatch(floorQ, eFloorType) ||
                                    this.fuzzyMatch(floorQ, eLevel) ||
                                    normalizedFloorQ === normalizedEFloorName ||
                                    normalizedFloorQ === normalizedEFloorNameEn ||
                                    normalizedFloorQ === normalizedEFloorType ||
                                    normalizedFloorQ === eLevel;
                    }
                    
                    // 房间匹配
                    if (roomQ) {
                        const eRoomName = e.room_name || '';
                        const eRoomNameEn = e.room_name_en || '';
                        const eRoomType = e.room_type || '';
                        
                        const normalizedRoomQ = this.normalizeRoom(roomQ);
                        const normalizedERoomName = this.normalizeRoom(eRoomName);
                        const normalizedERoomNameEn = this.normalizeRoom(eRoomNameEn);
                        const normalizedERoomType = this.normalizeRoom(eRoomType);
                        
                        roomMatch = this.fuzzyMatch(roomQ, eRoomName) ||
                                   this.fuzzyMatch(roomQ, eRoomNameEn) ||
                                   this.fuzzyMatch(roomQ, eRoomType) ||
                                   normalizedRoomQ === normalizedERoomName ||
                                   normalizedRoomQ === normalizedERoomNameEn ||
                                   normalizedRoomQ === normalizedERoomType;
                    }
                    
                    return floorMatch && roomMatch;
                });
                
                const spaceFilterTime = Date.now() - spaceFilterStart;
                this.logger.info(`  [1.2] 空间信息筛选: ${step1Pool.length} → ${spaceFiltered.length} (${spaceFilterTime}ms)`);
                
                // 如果筛选后还有结果，使用筛选后的池
                if (spaceFiltered.length > 0) {
                    step1Pool = spaceFiltered;
                    if (spaceFiltered.length <= 10) {
                        this.logger.info(`    匹配实体: ${spaceFiltered.map(e => e.entity_id).join(', ')}`);
                    } else {
                        this.logger.info(`    匹配实体(前10个): ${spaceFiltered.slice(0, 10).map(e => e.entity_id).join(', ')}...`);
                    }
                } else {
                    this.logger.warn(`    ⚠️  空间信息筛选后无结果，保留类型筛选结果`);
                }
            } else {
                this.logger.info(`  [1.2] 未指定空间信息，跳过空间筛选`);
            }
            
            const step1Time = Date.now() - step1Start;
            this.logger.info(`\n✅ [步骤1完成] 筛选结果: ${step1Pool.length} 个实体 (总耗时: ${step1Time}ms)`);
            if (step1Pool.length > 0) {
                this.logger.info(`  实体列表:`);
                step1Pool.slice(0, 20).forEach((e, i) => {
                    const name = e.device_name || e.friendly_name || (e.attributes && e.attributes.friendly_name) || '未知';
                    const room = e.room_name_en || e.room_name || '未知';
                    const floor = e.floor_name_en || e.floor_name || '未知';
                    this.logger.info(`    ${i + 1}. ${e.entity_id} - ${name} (${floor}/${room})`);
                });
                if (step1Pool.length > 20) {
                    this.logger.info(`    ... 还有 ${step1Pool.length - 20} 个实体`);
                }
            }
            
            // ==================== 第二步：设备名称匹配 ====================
            const step2Start = Date.now();
            this.logger.info(`\n🔍 [步骤2] 通过设备名称进一步匹配...`);
            this.logger.info(`  输入实体数: ${step1Pool.length}`);
            this.logger.info(`  查询名称: "${nameQ}"`);
            
            let step2Pool = step1Pool;
            
            // 如果指定了设备名称（非泛指），进行名称匹配
            if (nameQ && !this.isGenericName(nameQ)) {
                const nameFilterStart = Date.now();
                const nameMatched = [];
                
                for (const e of step1Pool) {
                    // ⭐ 优先匹配 device_name_en（英文翻译名称），其次 device_name（原语言名称）
                    const eNameEn = e.device_name_en || '';
                    const eName = e.device_name || e.friendly_name || (e.attributes && e.attributes.friendly_name) || '';
                    
                    // 同时尝试匹配英文名称和原语言名称，取最高分
                    const nameSim = this.slotSim(nameQ, eNameEn, eName);
                    
                    if (nameSim.score >= TH.name) {
                        nameMatched.push({
                            entity: e,
                            score: nameSim.score,
                            matchedName: nameSim.hit
                        });
                    }
                }
                
                const nameFilterTime = Date.now() - nameFilterStart;
                
                if (nameMatched.length > 0) {
                    // 按名称匹配分数排序
                    nameMatched.sort((a, b) => b.score - a.score);
                    step2Pool = nameMatched.map(m => m.entity);
                    
                    this.logger.info(`  [2.1] 设备名称匹配: ${step1Pool.length} → ${step2Pool.length} (${nameFilterTime}ms)`);
                    if (nameMatched.length <= 10) {
                        this.logger.info(`    匹配实体:`);
                        nameMatched.forEach((m, i) => {
                            this.logger.info(`      ${i + 1}. ${m.entity.entity_id} - ${m.matchedName} (相似度: ${m.score.toFixed(3)})`);
                        });
                    } else {
                        this.logger.info(`    匹配实体(前10个):`);
                        nameMatched.slice(0, 10).forEach((m, i) => {
                            this.logger.info(`      ${i + 1}. ${m.entity.entity_id} - ${m.matchedName} (相似度: ${m.score.toFixed(3)})`);
                        });
                        this.logger.info(`      ... 还有 ${nameMatched.length - 10} 个实体`);
                    }
                } else {
                    this.logger.warn(`  [2.1] 设备名称匹配: ${step1Pool.length} → 0 (${nameFilterTime}ms)`);
                    this.logger.warn(`    ⚠️  未找到名称匹配的实体，保留步骤1结果`);
                }
            } else {
                if (nameQ) {
                    this.logger.info(`  [2.1] 设备名称为泛指 ("${nameQ}")，跳过名称匹配`);
                } else {
                    this.logger.info(`  [2.1] 未指定设备名称，跳过名称匹配`);
                }
            }
            
            const step2Time = Date.now() - step2Start;
            this.logger.info(`\n✅ [步骤2完成] 最终匹配结果: ${step2Pool.length} 个实体 (耗时: ${step2Time}ms)`);
            
            // ==================== 打分和排序 ====================
            const scoringStart = Date.now();
            this.logger.info(`\n🎯 [打分排序] 对 ${step2Pool.length} 个实体进行综合打分...`);
            
            const scored = step2Pool.map(e => {
                const result = this.scoreTriplet(dev, e, TH, W);
                return {
                    e: e,
                    score: result.score,
                    ev: result.ev,
                    warnings: result.warnings
                };
            }).filter(x => x.score >= 0);
            
            // 排序并取 top K
            scored.sort((a, b) => b.score - a.score);
            const topK = scored.slice(0, BEST_K);
            
            const scoringTime = Date.now() - scoringStart;
            this.logger.info(`  打分完成: ${scored.length} 个有效结果 (耗时: ${scoringTime}ms)`);
            
            // 收集警告
            const warnings = [];
            for (const item of topK) {
                warnings.push(...item.warnings);
            }
            
            // 构建 targets
            let targets = topK.map(item => ({
                entity_id: item.e.entity_id,
                device_type: (item.e.device_type || '').toLowerCase(),
                device_name: item.e.device_name || (item.e.attributes && item.e.attributes.friendly_name) || '',
                floor: item.e.floor_name_en || item.e.floor_name || '',
                room: item.e.room_name_en || item.e.room_name || '',
                score: Number(item.score.toFixed(3)),
                matched: {
                    floor: item.ev.floor,
                    room: item.ev.room,
                    device_name: item.ev.device_name,
                    device_type: item.ev.device_type
                }
            }));
            
            // ⭐ 方案3：完全匹配优先 - 如果有设备名称完全匹配(score=1.0)，过滤掉其他低分设备
            if (nameQ && !this.isGenericName(nameQ) && targets.length > 1) {
                const perfectMatches = targets.filter(t => t.matched.device_name.score === 1.0);
                if (perfectMatches.length > 0) {
                    const filteredCount = targets.length - perfectMatches.length;
                    if (filteredCount > 0) {
                        this.logger.info(`\n✨ [完全匹配优先] 发现 ${perfectMatches.length} 个设备名称完全匹配，过滤掉 ${filteredCount} 个低分设备`);
                        targets = perfectMatches;
                    }
                }
            }
            
            // 显示最终结果
            this.logger.info(`\n📊 [最终结果] Top ${Math.min(targets.length, 5)} 匹配实体:`);
            targets.slice(0, 5).forEach((t, i) => {
                this.logger.info(`  ${i + 1}. ${t.entity_id} - ${t.device_name} (得分: ${t.score}, 名称匹配: ${t.matched.device_name.score.toFixed(3)})`);
            });
            
            // 总时长统计
            const totalTime = step1Time + step2Time + scoringTime;
            this.logger.info(`\n⏱️  [性能统计]`);
            this.logger.info(`  步骤1 (空间+类型筛选): ${step1Time}ms`);
            this.logger.info(`  步骤2 (名称匹配): ${step2Time}ms`);
            this.logger.info(`  打分排序: ${scoringTime}ms`);
            this.logger.info(`  总耗时: ${totalTime}ms`);
            
            // 构建 action
            const action = {
                request: {
                    floor: floorQ || null,
                    room: roomQ || null,
                    device_name: nameQ || null,
                    device_type: typeQ || null,
                    service: dev.service || null,
                    service_data: dev.service_data || {}
                },
                targets: targets,
                disambiguation_required: topK.length >= 2 && (topK[0].score - topK[1].score) < DISAMBIG_GAP,
                warnings: warnings,
                suggestions_if_empty: []
            };
            
            actions.push(action);
            
            // 更新匹配结果
            if (targets.length > 0) {
                anyMatch = true;
                for (const t of targets) {
                    matchedDevices.push({
                        entity_id: t.entity_id,
                        service: dev.service || '',
                        service_data: dev.service_data || {}
                    });
                }
            } else {
                coverAll = false;
            }
        }

        return { 
            actions, 
            matched_devices: matchedDevices, 
            coverAll, 
            hasMatches: anyMatch 
        };
    }
    
    /**
     * 设备-实体三元组打分函数（从 node-red-matcher-complete.js 移植）
     * 
     * @param {Object} dev - 意图设备
     * @param {Object} e - 实体
     * @param {Object} TH - 阈值配置
     * @param {Object} W - 权重配置
     * @returns {Object} - {score, ev, warnings}
     */
    scoreTriplet(dev, e, TH, W) {
        const ev = {};
        
        // ===== 楼层匹配 =====
        const floorQ = dev.floor_name_en || dev.floor_type || dev.floor_name || '';
        const eFloorName = e.floor_name || '';
        const eFloorNameEn = e.floor_name_en || '';
        const eFloorType = e.floor_type || '';
        const eLevel = e.level != null ? String(e.level) : '';
        
        let floorScore = 0;
        if (floorQ) {
            if (this.fuzzyMatch(floorQ, eFloorName) || 
                this.fuzzyMatch(floorQ, eFloorNameEn) || 
                this.fuzzyMatch(floorQ, eFloorType) || 
                this.fuzzyMatch(floorQ, eLevel)) {
                floorScore = 1.0;
            } else {
                const normalizedFloorQ = this.normalizeFloor(floorQ);
                const normalizedEFloorName = this.normalizeFloor(eFloorName);
                const normalizedEFloorNameEn = this.normalizeFloor(eFloorNameEn);
                const normalizedEFloorType = this.normalizeFloor(eFloorType);
                
                if (normalizedFloorQ === normalizedEFloorName ||
                    normalizedFloorQ === normalizedEFloorNameEn ||
                    normalizedFloorQ === normalizedEFloorType ||
                    normalizedFloorQ === eLevel) {
                    floorScore = 1.0;
                } else {
                    const sim = this.slotSim(floorQ, eFloorName, eFloorNameEn, eFloorType, eLevel);
                    floorScore = sim.score;
                }
            }
        }
        ev.floor = { 
            text: floorQ, 
            hit: floorScore >= 0.9 ? (eFloorNameEn || eFloorName || eFloorType) : '', 
            score: floorScore 
        };
        
        // ===== 房间匹配 =====
        const roomQ = dev.room_name_en || dev.room_type || dev.room_name || '';
        const eRoomName = e.room_name || '';
        const eRoomNameEn = e.room_name_en || '';
        const eRoomType = e.room_type || '';
        
        let roomScore = 0;
        if (roomQ) {
            if (this.fuzzyMatch(roomQ, eRoomName) || 
                this.fuzzyMatch(roomQ, eRoomNameEn) || 
                this.fuzzyMatch(roomQ, eRoomType)) {
                roomScore = 1.0;
            } else {
                const normalizedRoomQ = this.normalizeRoom(roomQ);
                const normalizedERoomName = this.normalizeRoom(eRoomName);
                const normalizedERoomNameEn = this.normalizeRoom(eRoomNameEn);
                const normalizedERoomType = this.normalizeRoom(eRoomType);
                
                if (normalizedRoomQ === normalizedERoomName ||
                    normalizedRoomQ === normalizedERoomNameEn ||
                    normalizedRoomQ === normalizedERoomType) {
                    roomScore = 1.0;
                } else {
                    const sim = this.slotSim(roomQ, eRoomName, eRoomNameEn, eRoomType);
                    roomScore = sim.score;
                }
            }
        }
        ev.room = { 
            text: roomQ, 
            hit: roomScore >= 0.9 ? (eRoomNameEn || eRoomName || eRoomType) : '', 
            score: roomScore 
        };
        
        // ===== 设备名称匹配 =====
        const nameQ = dev.device_name_en || dev.device_name || '';
        // ⭐ 优先匹配 device_name_en（英文翻译名称），其次 device_name（原语言名称）
        const eNameEn = e.device_name_en || '';
        const eName = e.device_name || e.friendly_name || (e.attributes && e.attributes.friendly_name) || '';
        
        // 同时尝试匹配英文名称和原语言名称，取最高分
        const nameSim = this.slotSim(nameQ, eNameEn, eName);
        
        ev.device_name = { 
            text: nameQ, 
            hit: nameSim.hit, 
            score: nameSim.score 
        };
        
        // ===== 设备类型匹配 =====
        const typeQ = (dev.device_type || '').toLowerCase() || (dev.service ? dev.service.split('.')[0].toLowerCase() : '');
        const eType = (e.device_type || '').toLowerCase();
        const eDomain = e.entity_id ? e.entity_id.split('.')[0] : '';
        
        const normalizedTypeQ = this.normalizeDomain(typeQ);
        const normalizedEDomain = this.normalizeDomain(eDomain);
        
        let typeScore = 0;
        if (normalizedTypeQ) {
            if (normalizedTypeQ === normalizedEDomain || 
                normalizedTypeQ === this.normalizeText(eType) || 
                this.fuzzyMatch(typeQ, eDomain) || 
                this.fuzzyMatch(typeQ, eType)) {
                typeScore = 1.0;
            } else {
                const sim1 = this.jaroWinkler(this.normalizeText(normalizedTypeQ), this.normalizeText(normalizedEDomain));
                const sim2 = this.jaroWinkler(this.normalizeText(normalizedTypeQ), this.normalizeText(eType));
                typeScore = Math.max(sim1, sim2);
            }
        }
        ev.device_type = { 
            text: typeQ, 
            hit: typeScore >= 0.9 ? (normalizedEDomain || eType) : '', 
            score: typeScore 
        };
        
        // ===== 特殊场景：所有设备 =====
        const isAllDevices = !floorQ && !roomQ && !nameQ && typeQ;
        if (isAllDevices) {
            if (typeQ && typeScore >= 0.90) {
                return { score: 0.80, ev: ev, warnings: [] };
            } else {
                return { score: -1, ev: ev, warnings: [] };
            }
        }
        
        // ===== 阈值检查 =====
        const floorPass = floorQ ? floorScore >= TH.floor : true;
        const roomPass = roomQ ? roomScore >= TH.room : true;
        const namePass = nameQ ? nameSim.score >= TH.name : true;
        const typePass = typeQ ? typeScore >= 0.90 : true;
        
        const isGenericName = this.isGenericName(nameQ);
        
        // 仅楼层模式
        const floorOnlyMode = floorQ && !roomQ && !nameQ && typeQ;
        if (floorOnlyMode) {
            if (!floorPass || !typePass || typeScore < 0.95) {
                return { score: -1, ev: ev, warnings: [] };
            }
        } else if (nameQ && !isGenericName) {
            // 有具体名称
            if (!roomPass || !namePass || !typePass) {
                return { score: -1, ev: ev, warnings: [] };
            }
            if (floorQ && !floorPass) {
                return { score: -1, ev: ev, warnings: [] };
            }
        } else {
            // 泛指或无名称
            if (!roomPass || !typePass) {
                return { score: -1, ev: ev, warnings: [] };
            }
            if (floorQ && !floorPass) {
                return { score: -1, ev: ev, warnings: [] };
            }
        }
        
        // ===== 计算最终得分 =====
        const floorScoreWeight = floorQ ? floorScore : 0.90;
        const nameScore = (nameQ && !isGenericName) ? nameSim.score : 0.85;
        
        let base = W.F * floorScoreWeight + W.R * roomScore + W.N * nameScore + W.T * typeScore;
        
        const warnings = [];
        
        // 加分项
        if (roomQ && roomScore >= 0.98) base += 0.10;
        if (nameQ && !isGenericName && nameSim.score >= 0.98) base += 0.05;
        if (floorQ && floorScore >= 0.98) base += 0.03;
        
        // 域名检查
        if (dev.service) {
            const svcDomain = dev.service.split('.')[0].toLowerCase();
            const normalizedSvcDomain = this.normalizeDomain(svcDomain);
            if (normalizedSvcDomain && normalizedEDomain) {
                if (normalizedSvcDomain === normalizedEDomain) {
                    base += 0.03;
                } else {
                    warnings.push(`Service domain mismatch for ${e.entity_id}`);
                }
            }
        }
        
        return { score: base, ev: ev, warnings: warnings };
    }

    /**
     * 使用 AI 进行设备名称匹配
     * 只比对设备名称，不管其他字段
     * @param {Object} request - 匹配请求
     * @param {Array} entities - 目标空间内该设备类型的实体列表
     * @param {String} userQuery - 用户查询
     * @returns {Object} - {success, data: {matched_entity, device_name_mapping}}
     */
    async matchDeviceNameWithAI(request, entities, userQuery) {
        try {
            const ai = await this.autoSelectAI(this.config.llm_provider || 'auto');
            if (!ai.success) {
                return { success: false, error: 'No AI provider available' };
            }
            
            // 提取请求的设备名称
            const requestDeviceName = request.device_name || '';
            const requestDeviceType = request.device_type || '';
            const requestRoom = request.room || '';
            
            if (!requestDeviceName) {
                return { success: false, error: 'No device name in request' };
            }
            
            // 过滤目标空间内该设备类型的实体
            const targetEntities = entities.filter(e => {
                const entityType = e.device_type || '';
                const entityDomain = e.entity_id ? e.entity_id.split('.')[0] : '';
                return entityType.toLowerCase() === requestDeviceType.toLowerCase() ||
                       entityDomain.toLowerCase() === requestDeviceType.toLowerCase();
            });
            
            if (targetEntities.length === 0) {
                return { success: false, error: 'No entities of this type in target location' };
            }
            
            this.logger.info(`🤖 AI 匹配: 用户说的 "${requestDeviceName}" 对应哪个设备？`);
            this.logger.info(`   目标空间: ${requestRoom}`);
            this.logger.info(`   设备类型: ${requestDeviceType}`);
            this.logger.info(`   候选设备: ${targetEntities.length} 个`);
            
            // 构建 AI 提示
            const systemPrompt = `你是智能家居设备名称匹配专家。
任务：判断用户说的设备名称对应哪个实体。

规则：
1. 只返回 JSON 格式
2. 如果能确定匹配，返回 entity_id
3. 如果不确定，返回 null
4. confidence 表示置信度 (0-1)

返回格式：
{
  "matched_entity_id": "light.xxx" 或 null,
  "confidence": 0.95,
  "reason": "匹配原因"
}`;

            const userPrompt = `用户查询: "${userQuery}"
用户说的设备名称: "${requestDeviceName}"
房间: ${requestRoom}
设备类型: ${requestDeviceType}

候选实体列表:
${targetEntities.map((e, i) => `${i + 1}. ${e.entity_id}
   设备名: ${e.device_name || e.friendly_name || '未知'}
   房间: ${e.room_name_en || e.room_name || '未知'}`).join('\n')}

请判断用户说的 "${requestDeviceName}" 最可能是哪个设备？`;

            this.logger.info(`🤖 发送 AI 请求...`);
            
            const res = await ai.module.sendSimpleChat(systemPrompt, userPrompt, {
                model: ai.provider === 'deepseek' ? 'deepseek-chat' : 
                      ai.provider === 'gemini' ? 'gemini-2.0-flash-exp' : 'gpt-4o-mini',
                temperature: 0.1,  // 低温度，更确定的答案
                max_tokens: 500
            });
            
            if (!res.success) {
                this.logger.error(`❌ AI 调用失败: ${res.error}`);
                return { success: false, error: res.error };
            }
            
            let content = res.data?.message?.content || res.data?.response_text || res.data?.content || '';
            content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            
            this.logger.info(`🤖 AI 响应: ${content}`);
            
            const parsed = JSON.parse(content);
            
            if (!parsed.matched_entity_id || !parsed.confidence || parsed.confidence < 0.7) {
                this.logger.warn(`⚠️  AI 匹配置信度不足: ${parsed.confidence}`);
                return { success: false, error: 'AI confidence too low', data: parsed };
            }
            
            // 找到匹配的实体
            const matchedEntity = targetEntities.find(e => e.entity_id === parsed.matched_entity_id);
            
            if (!matchedEntity) {
                this.logger.error(`❌ AI 返回的 entity_id 不在候选列表中: ${parsed.matched_entity_id}`);
                return { success: false, error: 'Invalid entity_id from AI' };
            }
            
            this.logger.info(`✅ AI 匹配成功: "${requestDeviceName}" → ${matchedEntity.entity_id} (${matchedEntity.device_name})`);
            
            // 构建设备名称映射
            const deviceNameMapping = {
                user_name: requestDeviceName,  // 用户说的名称
                entity_id: matchedEntity.entity_id,
                entity_name: matchedEntity.device_name || matchedEntity.friendly_name,
                device_type: requestDeviceType,
                room: requestRoom,
                confidence: parsed.confidence,
                learned_at: new Date().toISOString()
            };
            
            return {
                success: true,
                data: {
                    matched_entity: matchedEntity,
                    device_name_mapping: deviceNameMapping,
                    ai_response: parsed
                }
            };
            
        } catch (e) {
            this.logger.error(`❌ AI 匹配异常: ${e.message}`);
            return { success: false, error: e.message };
        }
    }
    
    /**
     * 旧的 getLLMSuggestions 方法（保留向后兼容）
     */
    async getLLMSuggestions(request, entities, userQuery) {
        // 使用新的 AI 匹配方法
        const result = await this.matchDeviceNameWithAI(request, entities, userQuery);
        
        if (result.success) {
            // 转换为旧格式
            const entity = result.data.matched_entity;
            return {
                success: true,
                data: {
                    suggestions: [{
                        entity_id: entity.entity_id,
                        device_name: entity.device_name || entity.friendly_name,
                        room: entity.room_name_en || entity.room_name,
                        floor: entity.floor_name_en || entity.floor_name,
                        confidence: result.data.ai_response.confidence
                    }],
                    device_name_mapping: result.data.device_name_mapping
                }
            };
        }
        
        return result;
    }

    async autoSelectAI(preferred = 'auto') {
        const names = [];
        if (preferred && preferred !== 'auto') names.push(preferred);
        names.push('gemini','openai','deepseek','claude');
        for (const n of names) {
            const m = global.moduleManager?.getModule(n);
            if (!m || typeof m.sendSimpleChat !== 'function') continue;
            try {
                const cred = await m.getCredentials();
                const ok = cred.success && cred.data && Object.entries(cred.data).some(([k,v]) => !k.startsWith('_') && typeof v === 'string' && v.trim());
                if (ok) return { success: true, provider: n, module: m };
            } catch {}
        }
        return { success: false };
    }

    async saveToHistory(entry) {
        try {
            const data = await fs.readFile(this.historyFile, 'utf8').catch(() => '[]');
            let arr = [];
            try { arr = JSON.parse(data); } catch { arr = []; }
            arr.unshift(entry);
            const maxSize = this.config.maxHistorySize || 200;
            if (arr.length > maxSize) arr = arr.slice(0, maxSize);
            await fs.writeFile(this.historyFile, JSON.stringify(arr, null, 2), 'utf8');
        } catch (e) {
            this.logger.warn('saveToHistory failed:', e.message);
        }
    }
}

module.exports = BestMatchModule;
