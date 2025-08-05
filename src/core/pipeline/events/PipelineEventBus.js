/**
 * @file PipelineEventBus.js
 * @description 管道专用事件总线，扩展基础事件总线功能
 */

import { EventBus } from '../../../infrastructure/events/EventBus.js';
import { Logger } from '../../../utils/Logger.js';

/**
 * 管道事件总线
 * 为管道处理提供专门的事件处理功能
 */
export class PipelineEventBus extends EventBus {
    constructor() {
        super();
        this.logger = new Logger('PipelineEventBus');
        this.eventHistory = [];
        this.maxHistorySize = 1000;
        this.eventStats = new Map();
        this.eventFilters = new Map();
        this.eventMiddlewares = [];
    }

    /**
     * 发送事件（重写基类方法以添加额外功能）
     */
    emit(event, data = {}) {
        const eventData = {
            event,
            data,
            timestamp: Date.now(),
            id: this.generateEventId()
        };

        // 记录事件历史
        this.recordEvent(eventData);

        // 更新统计
        this.updateStats(event);

        // 应用事件中间件
        const processedData = this.applyEventMiddlewares(eventData);

        // 检查事件过滤器
        if (this.shouldFilterEvent(event, processedData)) {
            this.logger.debug(`Event filtered: ${event}`);
            return false;
        }

        // 发送事件
        super.emit(event, processedData);

        // 发送通用处理事件
        if (event.startsWith('pipeline:')) {
            super.emit('pipeline:event', {
                originalEvent: event,
                ...processedData
            });
        }

        return true;
    }

    /**
     * 生成事件ID
     * @private
     */
    generateEventId() {
        return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 记录事件历史
     * @private
     */
    recordEvent(eventData) {
        this.eventHistory.push(eventData);
        
        // 保持历史大小限制
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.shift();
        }
    }

    /**
     * 更新事件统计
     * @private
     */
    updateStats(event) {
        if (!this.eventStats.has(event)) {
            this.eventStats.set(event, {
                count: 0,
                firstSeen: Date.now(),
                lastSeen: Date.now()
            });
        }

        const stats = this.eventStats.get(event);
        stats.count++;
        stats.lastSeen = Date.now();
    }

    /**
     * 应用事件中间件
     * @private
     */
    applyEventMiddlewares(eventData) {
        let processedData = { ...eventData };

        for (const middleware of this.eventMiddlewares) {
            try {
                processedData = middleware(processedData) || processedData;
            } catch (error) {
                this.logger.error(`Event middleware error: ${error.message}`);
            }
        }

        return processedData;
    }

    /**
     * 检查是否应该过滤事件
     * @private
     */
    shouldFilterEvent(event, data) {
        const filter = this.eventFilters.get(event);
        if (!filter) return false;

        try {
            return filter(data);
        } catch (error) {
            this.logger.error(`Event filter error for ${event}: ${error.message}`);
            return false;
        }
    }

    /**
     * 添加事件中间件
     * @param {Function} middleware - 中间件函数
     */
    addEventMiddleware(middleware) {
        if (typeof middleware !== 'function') {
            throw new Error('Event middleware must be a function');
        }
        this.eventMiddlewares.push(middleware);
        this.logger.log('Added event middleware');
    }

    /**
     * 移除事件中间件
     * @param {Function} middleware - 要移除的中间件函数
     */
    removeEventMiddleware(middleware) {
        const index = this.eventMiddlewares.indexOf(middleware);
        if (index >= 0) {
            this.eventMiddlewares.splice(index, 1);
            this.logger.log('Removed event middleware');
            return true;
        }
        return false;
    }

    /**
     * 设置事件过滤器
     * @param {string} event - 事件名称
     * @param {Function} filter - 过滤器函数，返回true表示过滤掉事件
     */
    setEventFilter(event, filter) {
        if (typeof filter !== 'function') {
            throw new Error('Event filter must be a function');
        }
        this.eventFilters.set(event, filter);
        this.logger.log(`Set filter for event: ${event}`);
    }

    /**
     * 移除事件过滤器
     * @param {string} event - 事件名称
     */
    removeEventFilter(event) {
        const removed = this.eventFilters.delete(event);
        if (removed) {
            this.logger.log(`Removed filter for event: ${event}`);
        }
        return removed;
    }

    /**
     * 获取事件历史
     * @param {string} [eventType] - 特定事件类型
     * @param {number} [limit] - 返回数量限制
     * @returns {Array} 事件历史
     */
    getEventHistory(eventType = null, limit = 100) {
        let history = [...this.eventHistory];

        if (eventType) {
            history = history.filter(event => event.event === eventType);
        }

        if (limit && history.length > limit) {
            history = history.slice(-limit);
        }

        return history;
    }

    /**
     * 获取事件统计
     * @param {string} [eventType] - 特定事件类型
     * @returns {Object|Map} 统计信息
     */
    getEventStats(eventType = null) {
        if (eventType) {
            return this.eventStats.get(eventType) || null;
        }
        return new Map(this.eventStats);
    }

    /**
     * 清除事件历史
     */
    clearEventHistory() {
        this.eventHistory = [];
        this.logger.log('Event history cleared');
    }

    /**
     * 重置事件统计
     */
    resetEventStats() {
        this.eventStats.clear();
        this.logger.log('Event stats reset');
    }

    /**
     * 等待特定事件
     * @param {string} event - 事件名称
     * @param {number} [timeout] - 超时时间（毫秒）
     * @param {Function} [condition] - 额外条件函数
     * @returns {Promise} Promise that resolves when event occurs
     */
    waitForEvent(event, timeout = 30000, condition = null) {
        return new Promise((resolve, reject) => {
            let timeoutId;

            const handler = (data) => {
                if (condition && !condition(data)) {
                    return; // 条件不满足，继续等待
                }

                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                this.off(event, handler);
                resolve(data);
            };

            this.on(event, handler);

            if (timeout > 0) {
                timeoutId = setTimeout(() => {
                    this.off(event, handler);
                    reject(new Error(`Timeout waiting for event: ${event}`));
                }, timeout);
            }
        });
    }

    /**
     * 监听事件模式
     * @param {RegExp|string} pattern - 事件名称模式
     * @param {Function} callback - 回调函数
     * @returns {Function} 取消监听的函数
     */
    onPattern(pattern, callback) {
        const patternRegex = typeof pattern === 'string' 
            ? new RegExp(pattern.replace(/\*/g, '.*'))
            : pattern;

        const handler = (data) => {
            callback(data);
        };

        // 监听通用事件
        this.on('pipeline:event', (eventData) => {
            if (patternRegex.test(eventData.originalEvent)) {
                handler(eventData);
            }
        });

        // 返回取消监听函数
        return () => {
            this.off('pipeline:event', handler);
        };
    }

    /**
     * 发送管道处理开始事件
     */
    emitProcessingStart(processorType, inputSize, contextId) {
        this.emit('pipeline:processing-start', {
            processorType,
            inputSize,
            contextId,
            stage: 'start'
        });
    }

    /**
     * 发送管道处理进度事件
     */
    emitProcessingProgress(processorType, progress, contextId, details = {}) {
        this.emit('pipeline:processing-progress', {
            processorType,
            progress,
            contextId,
            stage: 'progress',
            ...details
        });
    }

    /**
     * 发送管道处理完成事件
     */
    emitProcessingComplete(processorType, processingTime, contextId, result = {}) {
        this.emit('pipeline:processing-complete', {
            processorType,
            processingTime,
            contextId,
            success: true,
            stage: 'complete',
            ...result
        });
    }

    /**
     * 发送管道处理错误事件
     */
    emitProcessingError(processorType, error, contextId, details = {}) {
        this.emit('pipeline:processing-error', {
            processorType,
            error: error.message || error,
            errorType: error.constructor?.name || 'Error',
            contextId,
            success: false,
            stage: 'error',
            ...details
        });
    }

    /**
     * 发送中间件事件
     */
    emitMiddlewareEvent(middlewareName, eventType, data = {}) {
        this.emit(`middleware:${eventType}`, {
            middlewareName,
            ...data
        });
    }

    /**
     * 发送处理器事件
     */
    emitProcessorEvent(processorName, eventType, data = {}) {
        this.emit(`processor:${eventType}`, {
            processorName,
            ...data
        });
    }

    /**
     * 获取管道事件的总体统计
     */
    getPipelineStats() {
        const pipelineEvents = Array.from(this.eventStats.entries())
            .filter(([event]) => event.startsWith('pipeline:'));

        const totalEvents = pipelineEvents.reduce((sum, [, stats]) => sum + stats.count, 0);
        const avgEventsPerMinute = this.calculateEventRate();

        return {
            totalPipelineEvents: totalEvents,
            eventTypes: pipelineEvents.length,
            averageEventsPerMinute: avgEventsPerMinute,
            eventBreakdown: Object.fromEntries(pipelineEvents),
            lastActivity: Math.max(...pipelineEvents.map(([, stats]) => stats.lastSeen))
        };
    }

    /**
     * 计算事件速率
     * @private
     */
    calculateEventRate() {
        if (this.eventHistory.length < 2) return 0;

        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        const recentEvents = this.eventHistory.filter(event => event.timestamp > oneMinuteAgo);
        
        return recentEvents.length;
    }

    /**
     * 销毁事件总线
     */
    destroy() {
        this.clearEventHistory();
        this.resetEventStats();
        this.eventFilters.clear();
        this.eventMiddlewares = [];
        super.destroy?.();
        this.logger.log('PipelineEventBus destroyed');
    }
}