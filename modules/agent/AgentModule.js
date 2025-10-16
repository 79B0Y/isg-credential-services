const BaseCredentialModule = require('../../core/BaseCredentialModule');

/**
 * Agent Module - AI Agent for integrating multiple services
 * 
 * Features:
 * - Subscribe to messages from different modules (Telegram, WhatsApp, etc.)
 * - Integrate with OpenAI for intelligent responses
 * - Maintain conversation context
 * - Auto-reply based on configuration
 */
class AgentModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        
        // 订阅管理
        this.subscriptions = new Map(); // module_name -> subscription_info
        this.messageQueue = [];
        this.conversationContext = []; // 对话上下文
        
        // Agent 状态
        this.isProcessing = false;
        this.stats = {
            totalMessages: 0,
            processedMessages: 0,
            aiCalls: 0,
            errors: 0
        };
        
        this.logger.info('[Agent] Agent Module instance created');
    }

    /**
     * 初始化 Agent
     */
    async initialize() {
        await super.initialize();
        
        const credentials = await this.getCredentials();
        
        this.logger.info('[Agent] Initializing AI Agent...');
        this.logger.info(`[Agent] System Prompt: ${credentials.system_prompt?.substring(0, 50)}...`);
        this.logger.info(`[Agent] Subscribed Modules: ${credentials.subscribed_modules?.join(', ')}`);
        this.logger.info(`[Agent] OpenAI Model: ${credentials.openai_model}`);
        this.logger.info(`[Agent] Auto Reply: ${credentials.auto_reply}`);
        this.logger.info(`[Agent] Enabled: ${credentials.enabled}`);
        
        // 如果启用，开始订阅模块
        if (credentials.enabled) {
            await this.startSubscriptions();
        }
        
        return { 
            success: true, 
            enabled: credentials.enabled,
            subscribed_modules: credentials.subscribed_modules
        };
    }

    /**
     * 开始订阅模块消息
     */
    async startSubscriptions() {
        const credentials = await this.getCredentials();
        const subscribedModules = credentials.subscribed_modules || [];
        
        if (!global.moduleManager) {
            this.logger.error('[Agent] ModuleManager not available');
            return;
        }
        
        for (const moduleName of subscribedModules) {
            await this.subscribeToModule(moduleName);
        }
    }

    /**
     * 订阅特定模块的消息
     */
    async subscribeToModule(moduleName) {
        try {
            const module = global.moduleManager.getModule(moduleName);
            
            if (!module) {
                this.logger.warn(`[Agent] Module '${moduleName}' not found`);
                return { success: false, error: `Module '${moduleName}' not found` };
            }
            
            // 检查是否已订阅
            if (this.subscriptions.has(moduleName)) {
                this.logger.info(`[Agent] Already subscribed to '${moduleName}'`);
                return { success: true, already_subscribed: true };
            }
            
            // 创建订阅信息
            const subscription = {
                moduleName: moduleName,
                module: module,
                handler: this.createMessageHandler(moduleName),
                subscribedAt: new Date()
            };
            
            // 根据模块类型订阅不同的事件
            if (moduleName === 'telegram') {
                // 订阅 Telegram 新消息事件
                if (module.on) {
                    module.on('message', subscription.handler);
                    this.logger.info(`[Agent] Subscribed to Telegram messages`);
                } else {
                    // 如果模块没有事件发射器，使用轮询
                    subscription.pollingInterval = setInterval(() => {
                        this.pollModuleMessages(moduleName);
                    }, 5000); // 每5秒检查一次
                    this.logger.info(`[Agent] Started polling Telegram messages`);
                }
            } else if (moduleName === 'home_assistant') {
                // Home Assistant 可以订阅状态变化
                if (module.on) {
                    module.on('state_changed', subscription.handler);
                    this.logger.info(`[Agent] Subscribed to Home Assistant state changes`);
                }
            } else if (moduleName === 'whatsapp') {
                // WhatsApp 消息订阅
                if (module.on) {
                    module.on('message', subscription.handler);
                    this.logger.info(`[Agent] Subscribed to WhatsApp messages`);
                }
            }
            
            this.subscriptions.set(moduleName, subscription);
            
            return { 
                success: true, 
                module: moduleName,
                subscribed_at: subscription.subscribedAt
            };
            
        } catch (error) {
            this.logger.error(`[Agent] Failed to subscribe to '${moduleName}':`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 创建消息处理器
     */
    createMessageHandler(moduleName) {
        return async (message) => {
            try {
                this.stats.totalMessages++;
                
                this.logger.info(`[Agent] Received message from '${moduleName}':`, {
                    type: message.message_type || message.type,
                    id: message.id || message.message_id
                });
                
                // 将消息加入队列
                this.messageQueue.push({
                    source: moduleName,
                    message: message,
                    receivedAt: new Date()
                });
                
                // 处理消息
                await this.processMessage(moduleName, message);
                
            } catch (error) {
                this.logger.error(`[Agent] Error handling message from '${moduleName}':`, error);
                this.stats.errors++;
            }
        };
    }

    /**
     * 轮询模块消息（用于不支持事件的模块）
     */
    async pollModuleMessages(moduleName) {
        try {
            const module = global.moduleManager.getModule(moduleName);
            if (!module) return;
            
            // 对于 Telegram，检查是否有新消息
            if (moduleName === 'telegram' && module.messageHistory) {
                const messages = module.messageHistory;
                if (messages.length > 0) {
                    const lastMessage = messages.reduce((latest, current) => {
                        const latestId = latest.id || latest.message_id || 0;
                        const currentId = current.id || current.message_id || 0;
                        return currentId > latestId ? current : latest;
                    });
                    
                    // 检查是否是新消息（避免重复处理）
                    const lastProcessedId = this.subscriptions.get(moduleName).lastProcessedId || 0;
                    const currentId = lastMessage.id || lastMessage.message_id;
                    
                    if (currentId > lastProcessedId) {
                        this.subscriptions.get(moduleName).lastProcessedId = currentId;
                        await this.processMessage(moduleName, lastMessage);
                    }
                }
            }
        } catch (error) {
            this.logger.error(`[Agent] Polling error for '${moduleName}':`, error);
        }
    }

    /**
     * 处理接收到的消息
     */
    async processMessage(source, message) {
        try {
            const credentials = await this.getCredentials();
            
            // 检查是否启用
            if (!credentials.enabled) {
                this.logger.info('[Agent] Agent is disabled, skipping message');
                return;
            }
            
            // 检查是否自动回复
            if (!credentials.auto_reply) {
                this.logger.info('[Agent] Auto reply is disabled, skipping message');
                return;
            }
            
            // 提取消息文本
            let messageText = await this.extractMessageText(source, message);
            
            if (!messageText) {
                this.logger.info('[Agent] No text content in message, skipping');
                return;
            }
            
            this.logger.info(`[Agent] Processing message: "${messageText}"`);
            
            // 添加到上下文
            this.addToContext('user', messageText, source);
            
            // 调用 AI 生成回复
            const aiResponse = await this.getAIResponse(messageText, source, message);
            
            if (aiResponse && aiResponse.success) {
                this.logger.info(`[Agent] AI Response: "${aiResponse.text}"`);
                
                // 添加 AI 回复到上下文
                this.addToContext('assistant', aiResponse.text, source);
                
                // 发送回复
                await this.sendReply(source, message, aiResponse.text);
                
                this.stats.processedMessages++;
            } else {
                this.logger.error('[Agent] Failed to get AI response:', aiResponse?.error);
                this.stats.errors++;
            }
            
        } catch (error) {
            this.logger.error('[Agent] Error processing message:', error);
            this.stats.errors++;
        }
    }

    /**
     * 提取消息文本（支持文字和语音）
     */
    async extractMessageText(source, message) {
        try {
            // 如果是文字消息
            if (message.text) {
                return message.text;
            }
            
            // 如果是语音消息（Telegram）
            if (source === 'telegram' && message.message_type === 'voice') {
                const module = global.moduleManager.getModule('telegram');
                if (module && typeof module.transcribeVoice === 'function') {
                    const fileId = message.media?.voice?.file_id;
                    if (fileId) {
                        this.logger.info('[Agent] Transcribing voice message...');
                        const result = await module.transcribeVoice(fileId, { language: 'zh' });
                        if (result.success && result.text) {
                            this.logger.info(`[Agent] Transcription: "${result.text}"`);
                            return result.text;
                        }
                    }
                }
            }
            
            return null;
            
        } catch (error) {
            this.logger.error('[Agent] Error extracting message text:', error);
            return null;
        }
    }

    /**
     * 获取 AI 回复
     */
    async getAIResponse(messageText, source, originalMessage) {
        try {
            const credentials = await this.getCredentials();
            
            // 获取 OpenAI 模块
            const openaiModule = global.moduleManager.getModule('openai');
            if (!openaiModule) {
                this.logger.error('[Agent] OpenAI module not found');
                return { success: false, error: 'OpenAI module not found' };
            }
            
            // 构建消息上下文
            const messages = [
                {
                    role: 'system',
                    content: credentials.system_prompt || 'You are a helpful assistant.'
                }
            ];
            
            // 添加对话历史
            const contextLimit = credentials.context_memory || 10;
            const recentContext = this.conversationContext.slice(-contextLimit);
            messages.push(...recentContext);
            
            // 添加当前消息（如果不在上下文中）
            if (recentContext.length === 0 || recentContext[recentContext.length - 1].content !== messageText) {
                messages.push({
                    role: 'user',
                    content: messageText
                });
            }
            
            this.logger.info('[Agent] Calling OpenAI with messages:', JSON.stringify(messages, null, 2));
            
            // 调用 OpenAI
            const aiResult = await openaiModule.sendChatMessage(messages, {
                model: credentials.openai_model || 'gpt-4o-mini',
                temperature: credentials.temperature || 0.7,
                max_tokens: credentials.max_tokens || 1000
            });
            
            this.stats.aiCalls++;
            
            // OpenAI 模块返回的数据在 response_text 或 message.content 中
            const responseText = aiResult.data?.response_text || aiResult.data?.message?.content || aiResult.data?.content;
            
            if (aiResult.success && responseText) {
                return {
                    success: true,
                    text: responseText,
                    model: aiResult.data.model,
                    tokens: aiResult.data.usage
                };
            } else {
                return {
                    success: false,
                    error: aiResult.error || 'Unknown error'
                };
            }
            
        } catch (error) {
            this.logger.error('[Agent] Error getting AI response:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 发送回复到原始来源
     */
    async sendReply(source, originalMessage, replyText) {
        try {
            const module = global.moduleManager.getModule(source);
            if (!module) {
                this.logger.error(`[Agent] Module '${source}' not found for reply`);
                return { success: false, error: 'Module not found' };
            }
            
            if (source === 'telegram') {
                // 使用 Telegram 的回复功能
                if (typeof module.replyToLastChat === 'function') {
                    const result = await module.replyToLastChat(replyText);
                    this.logger.info('[Agent] Sent reply via Telegram');
                    return result;
                }
            } else if (source === 'whatsapp') {
                // WhatsApp 回复
                // TODO: 实现 WhatsApp 回复
                this.logger.warn('[Agent] WhatsApp reply not implemented yet');
            }
            
            return { success: false, error: 'Reply method not available' };
            
        } catch (error) {
            this.logger.error('[Agent] Error sending reply:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 添加消息到对话上下文
     */
    addToContext(role, content, source) {
        const credentials = this.credentialsCache || {};
        const contextLimit = credentials.context_memory || 10;
        
        this.conversationContext.push({
            role: role,
            content: content,
            source: source,
            timestamp: new Date()
        });
        
        // 限制上下文长度
        if (this.conversationContext.length > contextLimit * 2) {
            this.conversationContext = this.conversationContext.slice(-contextLimit * 2);
        }
    }

    /**
     * 清空对话上下文
     */
    clearContext() {
        this.conversationContext = [];
        this.logger.info('[Agent] Conversation context cleared');
        return { success: true, message: 'Context cleared' };
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            success: true,
            stats: {
                ...this.stats,
                active_subscriptions: this.subscriptions.size,
                context_length: this.conversationContext.length,
                queue_length: this.messageQueue.length
            },
            subscriptions: Array.from(this.subscriptions.keys()),
            context: this.conversationContext.map(ctx => ({
                role: ctx.role,
                source: ctx.source,
                content_preview: ctx.content.substring(0, 50) + '...',
                timestamp: ctx.timestamp
            }))
        };
    }

    /**
     * 手动处理消息（用于测试）
     */
    async processManualMessage(messageText, source = 'manual') {
        try {
            this.logger.info(`[Agent] Processing manual message: "${messageText}"`);
            
            this.addToContext('user', messageText, source);
            
            const aiResponse = await this.getAIResponse(messageText, source, null);
            
            if (aiResponse && aiResponse.success) {
                this.addToContext('assistant', aiResponse.text, source);
                return {
                    success: true,
                    request: messageText,
                    response: aiResponse.text,
                    model: aiResponse.model,
                    tokens: aiResponse.tokens
                };
            } else {
                return {
                    success: false,
                    error: aiResponse?.error || 'Unknown error'
                };
            }
            
        } catch (error) {
            this.logger.error('[Agent] Error processing manual message:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 取消订阅模块
     */
    async unsubscribeFromModule(moduleName) {
        try {
            const subscription = this.subscriptions.get(moduleName);
            
            if (!subscription) {
                return { success: false, error: `Not subscribed to '${moduleName}'` };
            }
            
            // 移除事件监听器
            if (subscription.module && subscription.module.removeListener) {
                subscription.module.removeListener('message', subscription.handler);
                subscription.module.removeListener('state_changed', subscription.handler);
            }
            
            // 停止轮询
            if (subscription.pollingInterval) {
                clearInterval(subscription.pollingInterval);
            }
            
            this.subscriptions.delete(moduleName);
            
            this.logger.info(`[Agent] Unsubscribed from '${moduleName}'`);
            
            return { success: true, module: moduleName };
            
        } catch (error) {
            this.logger.error(`[Agent] Error unsubscribing from '${moduleName}':`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 清理资源
     */
    async cleanup() {
        this.logger.info('[Agent] Cleaning up Agent module...');
        
        // 取消所有订阅
        for (const moduleName of this.subscriptions.keys()) {
            await this.unsubscribeFromModule(moduleName);
        }
        
        await super.cleanup();
    }
}

module.exports = AgentModule;

