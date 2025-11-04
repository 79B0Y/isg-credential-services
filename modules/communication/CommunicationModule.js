const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');
const BaseCredentialModule = require('../../core/BaseCredentialModule');

class CommunicationModule extends BaseCredentialModule {
    constructor(name, moduleDir) {
        super(name, moduleDir);
        this.wss = null;
        this.wsClients = new Set();
        this.messages = [];
        this.messagesFile = path.join(this.dataDir, 'messages.json');
    }

    getDefaultConfig() {
        return {
            websocketPort: 8082,
            autoStart: true,
            maxMessageHistory: 100
        };
    }

    getDefaultSchema() {
        return {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false
        };
    }

    async onInitialize() {
        // Load message history
        await this.loadMessages();

        // Auto-start WebSocket server if enabled
        if (this.config.autoStart) {
            await this.startWebSocketServer();
        }
    }

    /**
     * Load message history from file
     */
    async loadMessages() {
        try {
            const data = await fs.readFile(this.messagesFile, 'utf8');
            this.messages = JSON.parse(data);
            this.logger.info(`Loaded ${this.messages.length} messages from history`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.warn('Failed to load messages:', error.message);
            }
            this.messages = [];
        }
    }

    /**
     * Save message history to file
     */
    async saveMessages() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            await fs.writeFile(this.messagesFile, JSON.stringify(this.messages, null, 2), 'utf8');
        } catch (error) {
            this.logger.error('Failed to save messages:', error.message);
        }
    }

    /**
     * Add a message to history
     */
    async addMessage(message) {
        const msg = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            timestamp: new Date().toISOString(),
            ...message
        };

        this.messages.unshift(msg);

        // Limit message history
        if (this.messages.length > this.config.maxMessageHistory) {
            this.messages = this.messages.slice(0, this.config.maxMessageHistory);
        }

        await this.saveMessages();
        return msg;
    }

    /**
     * Start WebSocket server
     */
    async startWebSocketServer() {
        if (this.wss) {
            return { success: false, error: 'WebSocket server already running' };
        }

        try {
            const port = this.config.websocketPort;

            this.wss = new WebSocket.Server({ port });

            this.wss.on('connection', (ws) => {
                this.wsClients.add(ws);
                this.logger.info(`[WebSocket] Client connected (total: ${this.wsClients.size})`);

                // Send welcome message
                ws.send(JSON.stringify({
                    type: 'welcome',
                    message: 'Connected to Communication Module',
                    timestamp: new Date().toISOString()
                }));

                ws.on('close', () => {
                    this.wsClients.delete(ws);
                    this.logger.info(`[WebSocket] Client disconnected (total: ${this.wsClients.size})`);
                });

                ws.on('error', (error) => {
                    this.logger.error('[WebSocket] Client error:', error.message);
                    this.wsClients.delete(ws);
                });
            });

            this.wss.on('error', (error) => {
                this.logger.error('[WebSocket] Server error:', error.message);
            });

            this.logger.info(`[WebSocket] Server started on port ${port}`);
            return {
                success: true,
                message: `WebSocket server started on port ${port}`,
                port,
                url: `ws://localhost:${port}`
            };

        } catch (error) {
            this.logger.error('[WebSocket] Failed to start server:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Stop WebSocket server
     */
    async stopWebSocketServer() {
        if (!this.wss) {
            return { success: false, error: 'WebSocket server not running' };
        }

        try {
            // Close all client connections
            this.wsClients.forEach(ws => {
                ws.close();
            });
            this.wsClients.clear();

            // Close server
            await new Promise((resolve, reject) => {
                this.wss.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            this.wss = null;
            this.logger.info('[WebSocket] Server stopped');

            return { success: true, message: 'WebSocket server stopped' };

        } catch (error) {
            this.logger.error('[WebSocket] Failed to stop server:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get WebSocket server status
     */
    getWebSocketStatus() {
        return {
            success: true,
            data: {
                running: this.wss !== null,
                port: this.config.websocketPort,
                url: `ws://localhost:${this.config.websocketPort}`,
                connected_clients: this.wsClients.size,
                auto_start: this.config.autoStart
            }
        };
    }

    /**
     * Send message via WebSocket to all connected clients
     */
    async sendMessage(data) {
        if (!this.wss) {
            return { success: false, error: 'WebSocket server not running' };
        }

        try {
            const message = {
                type: data.type || 'message',
                content: data.content,
                metadata: data.metadata || {},
                timestamp: new Date().toISOString()
            };

            // Add to history
            const savedMessage = await this.addMessage({
                ...message,
                direction: 'outgoing'
            });

            // Broadcast to all connected clients
            let sentCount = 0;
            this.wsClients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(message));
                    sentCount++;
                }
            });

            this.logger.info(`[WebSocket] Message sent to ${sentCount} clients`);

            return {
                success: true,
                message: `Message sent to ${sentCount} client(s)`,
                data: {
                    message_id: savedMessage.id,
                    sent_to: sentCount,
                    total_clients: this.wsClients.size
                }
            };

        } catch (error) {
            this.logger.error('[WebSocket] Failed to send message:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Receive message from HTTP API
     */
    async receiveMessage(data) {
        try {
            const message = {
                type: data.type || 'message',
                content: data.content,
                metadata: data.metadata || {},
                source: data.source || 'api'
            };

            // Add to history
            const savedMessage = await this.addMessage({
                ...message,
                direction: 'incoming'
            });

            this.logger.info('[API] Message received:', message.type);

            // Optionally broadcast incoming messages to WebSocket clients (opt-in)
            if (this.wss && data.broadcast === true) {
                const broadcastMsg = {
                    type: 'incoming_message',
                    ...message
                };

                let broadcastCount = 0;
                this.wsClients.forEach(ws => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(broadcastMsg));
                        broadcastCount++;
                    }
                });

                this.logger.info(`[API] Message broadcasted to ${broadcastCount} WebSocket clients`);
            }

            return {
                success: true,
                message: 'Message received',
                data: {
                    message_id: savedMessage.id,
                    timestamp: savedMessage.timestamp
                }
            };

        } catch (error) {
            this.logger.error('[API] Failed to receive message:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get message history
     */
    async getMessages(options = {}) {
        try {
            let messages = [...this.messages];

            // Filter by direction
            if (options.direction) {
                messages = messages.filter(m => m.direction === options.direction);
            }

            // Filter by type
            if (options.type) {
                messages = messages.filter(m => m.type === options.type);
            }

            // Limit results
            const limit = options.limit || 50;
            messages = messages.slice(0, limit);

            return {
                success: true,
                data: {
                    messages,
                    total: this.messages.length,
                    returned: messages.length
                }
            };

        } catch (error) {
            this.logger.error('Failed to get messages:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Clear message history
     */
    async clearMessages() {
        try {
            this.messages = [];
            await this.saveMessages();

            this.logger.info('Message history cleared');
            return { success: true, message: 'Message history cleared' };

        } catch (error) {
            this.logger.error('Failed to clear messages:', error.message);
            return { success: false, error: error.message };
        }
    }
}

module.exports = CommunicationModule;
