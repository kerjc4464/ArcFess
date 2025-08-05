/**
 * @file MiddlewareManager.js
 * @description 中间件管理器，负责注册、管理和执行中间件
 */

import { Logger } from '../../utils/Logger.js';

/**
 * 中间件管理器
 * 管理管道中的中间件，支持注册、注销、排序和执行
 */
export class MiddlewareManager {
    constructor() {
        this.middlewares = new Map();
        this.logger = new Logger('MiddlewareManager');
        this.isInitialized = false;
    }

    /**
     * 初始化中间件管理器
     */
    async init() {
        if (this.isInitialized) {
            this.logger.warn('MiddlewareManager already initialized');
            return;
        }

        this.logger.log('Initializing MiddlewareManager');
        
        // 初始化所有已注册的中间件
        for (const [name, middleware] of this.middlewares) {
            try {
                if (typeof middleware.init === 'function') {
                    await middleware.init();
                    this.logger.log(`Initialized middleware: ${name}`);
                }
            } catch (error) {
                this.logger.error(`Failed to initialize middleware: ${name}`, error);
                throw new MiddlewareError(`Failed to initialize middleware '${name}': ${error.message}`, middleware, error);
            }
        }

        this.isInitialized = true;
        this.logger.log('MiddlewareManager initialized successfully');
    }

    /**
     * 注册中间件
     * @param {string} name - 中间件名称
     * @param {IMiddleware} middleware - 中间件实例
     * @param {object} options - 选项
     */
    register(name, middleware, options = {}) {
        if (this.middlewares.has(name)) {
            if (!options.overwrite) {
                throw new MiddlewareError(`Middleware '${name}' already registered`);
            }
            this.logger.warn(`Overwriting existing middleware: ${name}`);
        }

        // 验证中间件接口
        if (!middleware || typeof middleware.process !== 'function') {
            throw new MiddlewareError(`Invalid middleware '${name}': must implement process method`);
        }

        this.middlewares.set(name, middleware);
        this.logger.log(`Registered middleware: ${name} (priority: ${middleware.priority || 100})`);

        // 如果管理器已初始化，立即初始化新中间件
        if (this.isInitialized && typeof middleware.init === 'function') {
            middleware.init().catch(error => {
                this.logger.error(`Failed to initialize newly registered middleware: ${name}`, error);
            });
        }
    }

    /**
     * 注销中间件
     * @param {string} name - 中间件名称
     */
    async unregister(name) {
        const middleware = this.middlewares.get(name);
        if (!middleware) {
            this.logger.warn(`Middleware '${name}' not found for unregistration`);
            return false;
        }

        // 销毁中间件
        try {
            if (typeof middleware.destroy === 'function') {
                await middleware.destroy();
            }
        } catch (error) {
            this.logger.error(`Error destroying middleware '${name}'`, error);
        }

        this.middlewares.delete(name);
        this.logger.log(`Unregistered middleware: ${name}`);
        return true;
    }

    /**
     * 获取已注册的中间件
     * @param {string} name - 中间件名称
     * @returns {IMiddleware|undefined} 中间件实例
     */
    get(name) {
        return this.middlewares.get(name);
    }

    /**
     * 获取所有已注册的中间件名称
     * @returns {string[]} 中间件名称列表
     */
    getRegisteredNames() {
        return Array.from(this.middlewares.keys());
    }

    /**
     * 获取按优先级排序的中间件列表
     * @returns {IMiddleware[]} 排序后的中间件列表
     */
    getSortedMiddlewares() {
        return Array.from(this.middlewares.values())
            .sort((a, b) => (a.priority || 100) - (b.priority || 100));
    }

    /**
     * 创建中间件执行链
     * @param {ProcessingContext} context - 处理上下文
     * @returns {Function} 执行函数
     */
    createExecutionChain(context) {
        const sortedMiddlewares = this.getSortedMiddlewares();
        
        if (sortedMiddlewares.length === 0) {
            // 没有中间件，直接执行处理器
            return async (input, processor) => {
                context.currentProcessor = processor;
                return await processor.process(input, context);
            };
        }

        return async (input, processor) => {
            context.currentProcessor = processor;
            let currentIndex = 0;

            const next = async (currentInput, currentContext) => {
                if (currentIndex >= sortedMiddlewares.length) {
                    // 所有中间件都执行完了，执行实际的处理器
                    return await processor.process(currentInput, currentContext);
                }

                const middleware = sortedMiddlewares[currentIndex++];
                
                try {
                    return await middleware.process(currentInput, currentContext, next);
                } catch (error) {
                    this.logger.error(`Middleware '${middleware.name}' failed`, {
                        error: error.message,
                        contextId: currentContext.id,
                        middlewareIndex: currentIndex - 1
                    });
                    throw error;
                }
            };

            return await next(input, context);
        };
    }

    /**
     * 检查中间件健康状态
     * @returns {object} 健康状态报告
     */
    async healthCheck() {
        const report = {
            totalMiddlewares: this.middlewares.size,
            healthyMiddlewares: 0,
            unhealthyMiddlewares: 0,
            details: []
        };

        for (const [name, middleware] of this.middlewares) {
            const detail = { name, status: 'unknown', error: null };
            
            try {
                if (typeof middleware.healthCheck === 'function') {
                    const isHealthy = await middleware.healthCheck();
                    detail.status = isHealthy ? 'healthy' : 'unhealthy';
                    if (isHealthy) {
                        report.healthyMiddlewares++;
                    } else {
                        report.unhealthyMiddlewares++;
                    }
                } else {
                    // 没有健康检查方法，假设健康
                    detail.status = 'healthy';
                    report.healthyMiddlewares++;
                }
            } catch (error) {
                detail.status = 'error';
                detail.error = error.message;
                report.unhealthyMiddlewares++;
            }
            
            report.details.push(detail);
        }

        return report;
    }

    /**
     * 销毁中间件管理器
     */
    async destroy() {
        this.logger.log('Destroying MiddlewareManager');

        // 销毁所有中间件
        const destroyPromises = Array.from(this.middlewares.entries()).map(async ([name, middleware]) => {
            try {
                if (typeof middleware.destroy === 'function') {
                    await middleware.destroy();
                }
                this.logger.log(`Destroyed middleware: ${name}`);
            } catch (error) {
                this.logger.error(`Error destroying middleware '${name}'`, error);
            }
        });

        await Promise.all(destroyPromises);

        this.middlewares.clear();
        this.isInitialized = false;
        this.logger.log('MiddlewareManager destroyed');
    }

    /**
     * 获取统计信息
     * @returns {object} 统计信息
     */
    getStats() {
        const middlewares = Array.from(this.middlewares.values());
        
        return {
            totalCount: middlewares.length,
            priorityDistribution: middlewares.reduce((acc, mw) => {
                const priority = mw.priority || 100;
                acc[priority] = (acc[priority] || 0) + 1;
                return acc;
            }, {}),
            byName: Array.from(this.middlewares.keys()),
            isInitialized: this.isInitialized
        };
    }
}

/**
 * 中间件错误类
 */
export class MiddlewareError extends Error {
    constructor(message, middleware = null, originalError = null) {
        super(message);
        this.name = 'MiddlewareError';
        this.middleware = middleware;
        this.originalError = originalError;
    }
}