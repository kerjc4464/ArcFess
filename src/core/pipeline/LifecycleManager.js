/**
 * @file LifecycleManager.js
 * @description 处理器生命周期管理器，管理处理器的初始化、启动、停止、健康检查等
 */

import { Logger } from '../../utils/Logger.js';
import { PipelineEventBus } from './events/PipelineEventBus.js';

/**
 * 生命周期管理器
 * 管理处理器和中间件的生命周期状态
 */
export class LifecycleManager {
    constructor(eventBus = null) {
        this.logger = new Logger('LifecycleManager');
        this.processors = new Map();
        this.middlewares = new Map();
        this.isInitialized = false;
        this.healthCheckInterval = null;
        this.eventBus = eventBus || new PipelineEventBus();
        this.config = {
            healthCheckEnabled: true,
            healthCheckInterval: 30000, // 30 seconds
            autoRestart: false,
            maxRestartAttempts: 3
        };
    }

    /**
     * 初始化生命周期管理器
     * @param {object} config - 配置选项
     */
    async init(config = {}) {
        if (this.isInitialized) {
            this.logger.warn('LifecycleManager already initialized');
            return;
        }

        this.config = { ...this.config, ...config };
        this.logger.log('Initializing LifecycleManager', this.config);

        // 启动健康检查
        if (this.config.healthCheckEnabled) {
            this.startHealthCheck();
        }

        this.isInitialized = true;
        this.eventBus.emit('lifecycle:manager-initialized');
        this.logger.log('LifecycleManager initialized');
    }

    /**
     * 注册处理器
     * @param {string} name - 处理器名称
     * @param {ITextProcessor} processor - 处理器实例
     */
    registerProcessor(name, processor) {
        if (this.processors.has(name)) {
            this.logger.warn(`Processor '${name}' already registered, replacing`);
        }

        const processorInfo = {
            name,
            processor,
            status: 'registered',
            registeredAt: Date.now(),
            restartAttempts: 0,
            lastHealthCheck: null
        };

        this.processors.set(name, processorInfo);
        this.logger.log(`Registered processor: ${name}`);
        
        this.eventBus.emit('lifecycle:processor-registered', { name });
    }

    /**
     * 注册中间件
     * @param {string} name - 中间件名称
     * @param {IMiddleware} middleware - 中间件实例
     */
    registerMiddleware(name, middleware) {
        if (this.middlewares.has(name)) {
            this.logger.warn(`Middleware '${name}' already registered, replacing`);
        }

        const middlewareInfo = {
            name,
            middleware,
            status: 'registered',
            registeredAt: Date.now(),
            lastHealthCheck: null
        };

        this.middlewares.set(name, middlewareInfo);
        this.logger.log(`Registered middleware: ${name}`);
        
        this.eventBus.emit('lifecycle:middleware-registered', { name });
    }

    /**
     * 初始化处理器
     * @param {string} name - 处理器名称
     * @param {object} config - 初始化配置
     */
    async initializeProcessor(name, config = {}) {
        const processorInfo = this.processors.get(name);
        if (!processorInfo) {
            throw new Error(`Processor '${name}' not found`);
        }

        if (processorInfo.status === 'initialized') {
            this.logger.warn(`Processor '${name}' already initialized`);
            return;
        }

        try {
            this.logger.log(`Initializing processor: ${name}`);
            processorInfo.status = 'initializing';
            
            await processorInfo.processor.initialize(config);
            processorInfo.processor._isInitialized = true;
            processorInfo.processor._initializationTime = Date.now();
            
            processorInfo.status = 'initialized';
            processorInfo.initializedAt = Date.now();
            
            this.logger.log(`Processor '${name}' initialized successfully`);
            this.eventBus.emit('lifecycle:processor-initialized', { name });
            
        } catch (error) {
            processorInfo.status = 'error';
            processorInfo.error = error.message;
            
            this.logger.error(`Failed to initialize processor '${name}': ${error.message}`);
            this.eventBus.emit('lifecycle:processor-error', { name, error: error.message });
            
            throw error;
        }
    }

    /**
     * 启动处理器
     * @param {string} name - 处理器名称
     */
    async startProcessor(name) {
        const processorInfo = this.processors.get(name);
        if (!processorInfo) {
            throw new Error(`Processor '${name}' not found`);
        }

        if (processorInfo.status !== 'initialized') {
            throw new Error(`Processor '${name}' must be initialized before starting`);
        }

        try {
            this.logger.log(`Starting processor: ${name}`);
            processorInfo.status = 'starting';
            
            if (typeof processorInfo.processor.start === 'function') {
                await processorInfo.processor.start();
            }
            
            processorInfo.status = 'running';
            processorInfo.startedAt = Date.now();
            
            this.logger.log(`Processor '${name}' started successfully`);
            this.eventBus.emit('lifecycle:processor-started', { name });
            
        } catch (error) {
            processorInfo.status = 'error';
            processorInfo.error = error.message;
            
            this.logger.error(`Failed to start processor '${name}': ${error.message}`);
            this.eventBus.emit('lifecycle:processor-error', { name, error: error.message });
            
            throw error;
        }
    }

    /**
     * 停止处理器
     * @param {string} name - 处理器名称
     */
    async stopProcessor(name) {
        const processorInfo = this.processors.get(name);
        if (!processorInfo) {
            throw new Error(`Processor '${name}' not found`);
        }

        if (processorInfo.status !== 'running') {
            this.logger.warn(`Processor '${name}' is not running`);
            return;
        }

        try {
            this.logger.log(`Stopping processor: ${name}`);
            processorInfo.status = 'stopping';
            
            if (typeof processorInfo.processor.stop === 'function') {
                await processorInfo.processor.stop();
            }
            
            processorInfo.status = 'stopped';
            processorInfo.stoppedAt = Date.now();
            
            this.logger.log(`Processor '${name}' stopped successfully`);
            this.eventBus.emit('lifecycle:processor-stopped', { name });
            
        } catch (error) {
            processorInfo.status = 'error';
            processorInfo.error = error.message;
            
            this.logger.error(`Failed to stop processor '${name}': ${error.message}`);
            this.eventBus.emit('lifecycle:processor-error', { name, error: error.message });
            
            throw error;
        }
    }

    /**
     * 重启处理器
     * @param {string} name - 处理器名称
     */
    async restartProcessor(name) {
        const processorInfo = this.processors.get(name);
        if (!processorInfo) {
            throw new Error(`Processor '${name}' not found`);
        }

        if (processorInfo.restartAttempts >= this.config.maxRestartAttempts) {
            this.logger.error(`Processor '${name}' exceeded maximum restart attempts`);
            return false;
        }

        try {
            this.logger.log(`Restarting processor: ${name}`);
            processorInfo.restartAttempts++;
            
            await this.stopProcessor(name);
            await this.startProcessor(name);
            
            processorInfo.restartAttempts = 0; // Reset on successful restart
            this.logger.log(`Processor '${name}' restarted successfully`);
            this.eventBus.emit('lifecycle:processor-restarted', { name });
            
            return true;
        } catch (error) {
            this.logger.error(`Failed to restart processor '${name}': ${error.message}`);
            return false;
        }
    }

    /**
     * 暂停处理器
     * @param {string} name - 处理器名称
     */
    async pauseProcessor(name) {
        const processorInfo = this.processors.get(name);
        if (!processorInfo) {
            throw new Error(`Processor '${name}' not found`);
        }

        try {
            if (typeof processorInfo.processor.pause === 'function') {
                await processorInfo.processor.pause();
            }
            
            processorInfo.status = 'paused';
            this.logger.log(`Processor '${name}' paused`);
            this.eventBus.emit('lifecycle:processor-paused', { name });
            
        } catch (error) {
            this.logger.error(`Failed to pause processor '${name}': ${error.message}`);
            throw error;
        }
    }

    /**
     * 恢复处理器
     * @param {string} name - 处理器名称
     */
    async resumeProcessor(name) {
        const processorInfo = this.processors.get(name);
        if (!processorInfo) {
            throw new Error(`Processor '${name}' not found`);
        }

        try {
            if (typeof processorInfo.processor.resume === 'function') {
                await processorInfo.processor.resume();
            }
            
            processorInfo.status = 'running';
            this.logger.log(`Processor '${name}' resumed`);
            this.eventBus.emit('lifecycle:processor-resumed', { name });
            
        } catch (error) {
            this.logger.error(`Failed to resume processor '${name}': ${error.message}`);
            throw error;
        }
    }

    /**
     * 执行健康检查
     * @param {string} [name] - 特定处理器名称，不提供则检查所有
     */
    async performHealthCheck(name = null) {
        const now = Date.now();
        
        if (name) {
            return await this.checkSingleProcessor(name, now);
        }

        const results = {};
        
        // 检查所有处理器
        for (const [processorName, processorInfo] of this.processors) {
            results[processorName] = await this.checkSingleProcessor(processorName, now);
        }

        // 检查所有中间件
        for (const [middlewareName, middlewareInfo] of this.middlewares) {
            results[middlewareName] = await this.checkSingleMiddleware(middlewareName, now);
        }

        return results;
    }

    /**
     * 检查单个处理器健康状态
     * @private
     */
    async checkSingleProcessor(name, timestamp) {
        const processorInfo = this.processors.get(name);
        if (!processorInfo) {
            return { status: 'not_found', timestamp };
        }

        try {
            const health = await processorInfo.processor.healthCheck();
            processorInfo.lastHealthCheck = timestamp;
            
            // 如果处理器不健康且启用了自动重启
            if (health.status === 'error' && this.config.autoRestart) {
                this.logger.warn(`Processor '${name}' unhealthy, attempting restart`);
                await this.restartProcessor(name);
            }
            
            return health;
        } catch (error) {
            this.logger.error(`Health check failed for processor '${name}': ${error.message}`);
            return {
                status: 'error',
                error: error.message,
                timestamp
            };
        }
    }

    /**
     * 检查单个中间件健康状态
     * @private
     */
    async checkSingleMiddleware(name, timestamp) {
        const middlewareInfo = this.middlewares.get(name);
        if (!middlewareInfo) {
            return { status: 'not_found', timestamp };
        }

        try {
            if (typeof middlewareInfo.middleware.healthCheck === 'function') {
                const health = await middlewareInfo.middleware.healthCheck();
                middlewareInfo.lastHealthCheck = timestamp;
                return health;
            } else {
                return { status: 'healthy', timestamp, note: 'No health check method' };
            }
        } catch (error) {
            this.logger.error(`Health check failed for middleware '${name}': ${error.message}`);
            return {
                status: 'error',
                error: error.message,
                timestamp
            };
        }
    }

    /**
     * 启动健康检查定时器
     * @private
     */
    startHealthCheck() {
        if (this.healthCheckInterval) {
            this.logger.warn('Health check already running');
            return;
        }

        this.logger.log(`Starting health check with interval: ${this.config.healthCheckInterval}ms`);
        
        this.healthCheckInterval = setInterval(async () => {
            try {
                const results = await this.performHealthCheck();
                this.eventBus.emit('lifecycle:health-check-complete', { results });
            } catch (error) {
                this.logger.error(`Health check failed: ${error.message}`);
            }
        }, this.config.healthCheckInterval);
    }

    /**
     * 停止健康检查定时器
     * @private
     */
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
            this.logger.log('Health check stopped');
        }
    }

    /**
     * 获取所有组件状态
     */
    getStatus() {
        const processors = {};
        const middlewares = {};

        for (const [name, info] of this.processors) {
            processors[name] = {
                status: info.status,
                registeredAt: info.registeredAt,
                initializedAt: info.initializedAt,
                startedAt: info.startedAt,
                restartAttempts: info.restartAttempts,
                lastHealthCheck: info.lastHealthCheck,
                error: info.error
            };
        }

        for (const [name, info] of this.middlewares) {
            middlewares[name] = {
                status: info.status,
                registeredAt: info.registeredAt,
                lastHealthCheck: info.lastHealthCheck
            };
        }

        return {
            isInitialized: this.isInitialized,
            config: this.config,
            processors,
            middlewares,
            healthCheckRunning: this.healthCheckInterval !== null
        };
    }

    /**
     * 销毁生命周期管理器
     */
    async destroy() {
        this.logger.log('Destroying LifecycleManager');

        // 停止健康检查
        this.stopHealthCheck();

        // 停止所有处理器
        const stopPromises = [];
        for (const [name, info] of this.processors) {
            if (info.status === 'running') {
                stopPromises.push(this.stopProcessor(name).catch(error => {
                    this.logger.error(`Error stopping processor '${name}': ${error.message}`);
                }));
            }
        }

        await Promise.all(stopPromises);

        // 清理
        this.processors.clear();
        this.middlewares.clear();
        this.isInitialized = false;

        this.eventBus.emit('lifecycle:manager-destroyed');
        this.logger.log('LifecycleManager destroyed');
    }
}