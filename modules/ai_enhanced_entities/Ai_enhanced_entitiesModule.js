const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const BaseCredentialModule = require('../../core/BaseCredentialModule');

class Ai_enhanced_entitiesModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        this.monitorTimer = null;
        this.lastHash = null;
        this.lastEntityCount = 0;
        this.saveFile = path.join(this.dataDir, 'ai_enhanced_entities.json');
        this.promptFile = path.join(this.dataDir, 'custom_prompt.txt');
    }

    getDefaultConfig() {
        return {
			monitorEnabled: true,
			monitorIntervalMs: 30 * 60 * 1000, // 30 min
        };
    }

    getDefaultSchema() {
        // This module has no credentials; keep schema minimal for future use
        return {
            type: 'object',
            properties: {},
        };
    }

    async onInitialize() {
        // Start monitor if enabled
        if (this.config.monitorEnabled) {
            this.startMonitor();
        }
    }

    startMonitor() {
        if (this.monitorTimer) return;
        this.logger.info('[Monitor] starting (interval=' + this.config.monitorIntervalMs + 'ms)');
        const tick = async () => {
            try {
                const result = await this.detectChanges();
                if (result.changed) {
                    this.logger.info('[Monitor] Change detected (' + result.changeType + ') -> run workflow');
                    await this.runWorkflow({ provider: 'auto', triggerSource: result.changeType });
                }
            } catch (e) {
                this.logger.warn('[Monitor] tick error:', e.message);
            }
        };
        // immediate + interval
        tick().catch(()=>{});
        this.monitorTimer = setInterval(tick, this.config.monitorIntervalMs);
    }

    stopMonitor() {
        if (this.monitorTimer) {
            clearInterval(this.monitorTimer);
            this.monitorTimer = null;
            this.logger.info('[Monitor] stopped');
        }
    }

    async detectChanges() {
        const ha = global.moduleManager?.getModule('home_assistant');
        if (!ha) return { changed: false };

        const spaces = await ha.getSpacesList();
        const states = await ha.getStates();
        if (!spaces.success || !states.success) return { changed: false };

        const floors = spaces.data.floors || [];
        const rooms = spaces.data.rooms || [];
        const hash = crypto
            .createHash('md5')
            .update(JSON.stringify({ floors, rooms }))
            .digest('hex');
        const entityCount = (states.data.states || []).length;

        // Detect what type of change occurred
        let changeType = null;
        if (this.lastHash === null) {
            changeType = 'initial';
        } else if (this.lastHash !== hash) {
            changeType = 'space_change';
        } else if (this.lastEntityCount !== entityCount) {
            changeType = 'entity_change';
        }

        const changed = changeType !== null;
        this.lastHash = hash;
        this.lastEntityCount = entityCount;

        return { changed, changeType };
    }

    async runWorkflow(options = {}) {
        const providerName = options.provider || 'auto';
        const triggerSource = options.triggerSource || 'manual';
        const ha = global.moduleManager?.getModule('home_assistant');
        if (!ha) return { success: false, error: 'home_assistant module not found' };

        // 1) spaces
        const spacesRes = await ha.getSpacesList();
        if (!spacesRes.success) return { success: false, error: 'Failed to get spaces list' };
        const floors = spacesRes.data.floors || [];

        // Extract rooms from floors (rooms are nested in floors)
        const rooms = [];
        floors.forEach(floor => {
            if (floor.rooms && Array.isArray(floor.rooms)) {
                rooms.push(...floor.rooms);
            }
        });

        // 2) extract names -> user prompt
        const floorNames = floors.map(f => f.name);
        const roomNames = rooms.map(r => r.name);

        // 3) system prompt (use custom or default)
        const promptRes = await this.getSystemPrompt();
        const systemPrompt = promptRes.success ? promptRes.data.prompt : 'You are a smart home data enrichment expert. Given floor and room names, return normalized english names and types as JSON.';

        // 4) auto select AI
        const sel = await this.autoSelectAI(providerName);
        if (!sel.success) return sel;

        const userPrompt = JSON.stringify({ floors: floorNames, rooms: roomNames });
        
        // Set appropriate model based on provider
        let aiOptions = { temperature: 0.7, max_tokens: 3500 };
        if (sel.provider === 'deepseek') {
            aiOptions.model = 'deepseek-chat';
        } else if (sel.provider === 'gemini') {
            aiOptions.model = 'gemini-2.5-flash';
        } else if (sel.provider === 'openai') {
            aiOptions.model = 'gpt-3.5-turbo';
        } else if (sel.provider === 'claude') {
            aiOptions.model = 'claude-3-5-sonnet-20241022';
        }

        const aiRes = await sel.module.sendSimpleChat(systemPrompt, userPrompt, aiOptions);
        if (!aiRes.success) return { success: false, error: aiRes.error || 'AI call failed' };

        let mapping;
        try {
            const content = aiRes.data?.message?.content || aiRes.data?.response_text || aiRes.data?.content || '';
            mapping = typeof content === 'string' ? JSON.parse(content) : content;
        } catch (e) {
            return { success: false, error: 'AI response parse error: ' + e.message };
        }

        const floorMap = {};
        (mapping.floors || []).forEach(f => {
            floorMap[f.floor_name] = {
                floor_name_en: f.floor_name_en,
                floor_type: f.floor_type,
                level: f.level
            };
        });
        const roomMap = {};
        (mapping.rooms || []).forEach(r => {
            roomMap[r.room_name] = {
                room_name_en: r.room_name_en,
                room_type: r.room_type
            };
        });

        // 5) get enhanced entities (with state + space info)
        const baseRes = await ha.buildEnhancedEntities();
        if (!baseRes.success) return { success: false, error: 'Failed to get enhanced entities' };
        const entities = baseRes.data.entities || [];

        // Filter out entities that are not assigned to any area/room
        const entitiesWithArea = entities.filter(e => e.room_id != null || e.area_id != null);

		const enriched = entitiesWithArea.map(e => {
			const out = { ...e };
			if (e.floor_name && floorMap[e.floor_name]) Object.assign(out, floorMap[e.floor_name]);
			if (e.room_name && roomMap[e.room_name]) Object.assign(out, roomMap[e.room_name]);
			return out;
		});

		// 统一补齐需要的字段，保证实体包含指定键（无值则为空字符串）
		const normalized = enriched.map(e => {
			const out = { ...e };
			out.floor_name = (out.floor_name ?? '') || '';
			out.floor_name_en = (out.floor_name_en ?? '') || '';
			out.floor_type = (out.floor_type ?? '') || '';
			out.room_type = (out.room_type ?? '') || '';
			out.room_name = (out.room_name ?? '') || '';
			out.room_name_en = (out.room_name_en ?? '') || '';
			out.device_type = (out.device_type ?? out.domain ?? '') || '';
			out.device_name = (out.device_name ?? out.friendly_name ?? out.name ?? '') || '';
			if (out.device_name_en == null) out.device_name_en = '';
			return out;
		});

        // 进一步过滤：剔除没有任何空间信息（无楼层且无房间）的实体
        const hasSpaceInfo = (ent) => {
            const hasRoom = !!(ent.room_name || ent.room_name_en || ent.room_type);
            const hasFloor = !!(ent.floor_name || ent.floor_name_en || ent.floor_type || ent.level);
            return hasRoom || hasFloor;
        };
		const filtered = normalized.filter(hasSpaceInfo);

        const triggeredAt = new Date().toISOString();
        const payloadToSave = {
            triggered_at: triggeredAt,
            trigger_source: triggerSource,
            provider: sel.provider,
            floors: floorNames,
            rooms: roomNames,
            count: filtered.length,
            entities: filtered
        };
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            await fs.writeFile(this.saveFile, JSON.stringify(payloadToSave, null, 2), 'utf8');
        } catch (e) {
            this.logger.warn('Failed to save ai_enhanced_entities:', e.message);
        }

        return { success: true, data: { triggered_at: triggeredAt, count: enriched.length } };
    }

    async autoSelectAI(preferred = 'auto') {
        const names = [];
        if (preferred && preferred !== 'auto') names.push(preferred);
        names.push('gemini', 'openai', 'deepseek', 'claude');

        const hasCreds = async mod => {
            try {
                if (!mod || typeof mod.getCredentials !== 'function') return false;
                const res = await mod.getCredentials();
                if (!res.success || !res.data) return false;
                return Object.entries(res.data).some(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v.trim());
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

    async getSaved() {
        try {
            const txt = await fs.readFile(this.saveFile, 'utf8');
			const data = JSON.parse(txt);
			// 读取时也进行一次防御性过滤，确保列表不包含无空间信息的实体
            const hasSpaceInfo = (ent) => {
                if (!ent || typeof ent !== 'object') return false;
                const hasRoom = !!(ent.room_name || ent.room_name_en || ent.room_type);
                const hasFloor = !!(ent.floor_name || ent.floor_name_en || ent.floor_type || ent.level);
                return hasRoom || hasFloor;
            };
			const ensureKeys = (e) => {
				const out = { ...e };
				out.floor_name = (out.floor_name ?? '') || '';
				out.floor_name_en = (out.floor_name_en ?? '') || '';
				out.floor_type = (out.floor_type ?? '') || '';
				out.room_type = (out.room_type ?? '') || '';
				out.room_name = (out.room_name ?? '') || '';
				out.room_name_en = (out.room_name_en ?? '') || '';
				out.device_type = (out.device_type ?? out.domain ?? '') || '';
				out.device_name = (out.device_name ?? out.friendly_name ?? out.name ?? '') || '';
				if (out.device_name_en == null) out.device_name_en = '';
				return out;
			};
			const entities = Array.isArray(data.entities)
				? data.entities.map(ensureKeys).filter(hasSpaceInfo)
				: [];
            const out = {
                ...data,
                count: entities.length,
                entities
            };
            return { success: true, data: out };
        } catch (e) {
            return { success: true, data: { triggered_at: null, count: 0, entities: [] } };
        }
    }

    /**
     * 获取系统提示词（优先使用自定义提示词）
     */
    async getSystemPrompt() {
        try {
            // 尝试读取自定义提示词
            const customPrompt = await fs.readFile(this.promptFile, 'utf8');
            if (customPrompt && customPrompt.trim()) {
                return { success: true, data: { prompt: customPrompt, is_custom: true } };
            }
        } catch (e) {
            // 文件不存在或读取失败，使用默认提示词
        }

        // 使用 Home Assistant 模块的默认提示词
        const ha = global.moduleManager?.getModule('home_assistant');
        if (ha && typeof ha.getPrompt === 'function') {
            try {
                const result = await ha.getPrompt();
                if (result.success) {
                    return { success: true, data: { prompt: result.data.prompt, is_custom: false } };
                }
            } catch (e) {
                this.logger.warn('Failed to get prompt from HA module:', e.message);
            }
        }

        // 最终回退到默认提示词
        return {
            success: true,
            data: {
                prompt: 'You are a smart home data enrichment expert. Given floor and room names, return normalized english names and types as JSON.',
                is_custom: false
            }
        };
    }

    /**
     * 保存自定义系统提示词
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
     * 删除自定义系统提示词（恢复默认）
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
}

module.exports = Ai_enhanced_entitiesModule;



