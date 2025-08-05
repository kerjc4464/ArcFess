/**
 * @file EventListenerFactory.js
 * @description 事件监听器工厂，提供常见的事件监听模式
 */

import { Logger } from '../../../utils/Logger.js';

/**
 * 事件监听器工厂
 * 提供预定义的事件监听器和模式
 */
export class EventListenerFactory {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.logger = new Logger('EventListenerFactory');
        this.activeListeners = new Map();
    }

    /**
     * 创建处理进度监听器
     * @param {Function} onProgress - 进度回调函数
     * @param {object} options - 选项
     * @returns {string} 监听器ID
     */
    createProgressListener(onProgress, options = {}) {
        const {
            processorType = null,
            contextId = null,
            includeStart = true,
            includeComplete = true
        } = options;

        const listenerId = this.generateListenerId('progress');
        const listeners = [];

        // 处理开始事件
        if (includeStart) {
            const startListener = (data) => {
                if (this.matchesFilter(data, processorType, contextId)) {
                    onProgress({
                        stage: 'start',
                        progress: 0,
                        ...data
                    });
                }
            };
            this.eventBus.on('pipeline:processing-start', startListener);
            listeners.push(['pipeline:processing-start', startListener]);
        }

        // 处理进度事件
        const progressListener = (data) => {
            if (this.matchesFilter(data, processorType, contextId)) {
                onProgress({
                    stage: 'progress',
                    ...data
                });
            }
        };
        this.eventBus.on('pipeline:processing-progress', progressListener);
        listeners.push(['pipeline:processing-progress', progressListener]);

        // 处理完成事件
        if (includeComplete) {
            const completeListener = (data) => {
                if (this.matchesFilter(data, processorType, contextId)) {
                    onProgress({
                        stage: 'complete',
                        progress: 100,
                        ...data
                    });
                }
            };
            this.eventBus.on('pipeline:processing-complete', completeListener);
            listeners.push(['pipeline:processing-complete', completeListener]);
        }

        this.activeListeners.set(listenerId, listeners);
        this.logger.log(`Created progress listener: ${listenerId}`);
        
        return listenerId;
    }

    /**
     * 创建错误监听器
     * @param {Function} onError - 错误回调函数
     * @param {object} options - 选项
     * @returns {string} 监听器ID
     */
    createErrorListener(onError, options = {}) {
        const {
            processorType = null,
            contextId = null,
            includeMiddlewareErrors = true
        } = options;

        const listenerId = this.generateListenerId('error');
        const listeners = [];

        // 处理处理器错误
        const processingErrorListener = (data) => {
            if (this.matchesFilter(data, processorType, contextId)) {
                onError({
                    source: 'processor',
                    ...data
                });
            }
        };
        this.eventBus.on('pipeline:processing-error', processingErrorListener);
        listeners.push(['pipeline:processing-error', processingErrorListener]);

        // 处理中间件错误
        if (includeMiddlewareErrors) {
            const middlewareErrorListener = (data) => {
                onError({
                    source: 'middleware',
                    ...data
                });
            };
            this.eventBus.on('middleware:error', middlewareErrorListener);
            listeners.push(['middleware:error', middlewareErrorListener]);
        }

        this.activeListeners.set(listenerId, listeners);
        this.logger.log(`Created error listener: ${listenerId}`);
        
        return listenerId;
    }

    /**
     * 创建生命周期监听器
     * @param {object} callbacks - 生命周期回调
     * @param {object} options - 选项
     * @returns {string} 监听器ID
     */
    createLifecycleListener(callbacks, options = {}) {
        const {
            processorName = null,
            middlewareName = null
        } = options;

        const listenerId = this.generateListenerId('lifecycle');
        const listeners = [];

        // 处理器生命周期事件
        if (callbacks.onProcessorRegistered) {
            const listener = (data) => {
                if (!processorName || data.name === processorName) {
                    callbacks.onProcessorRegistered(data);
                }
            };
            this.eventBus.on('lifecycle:processor-registered', listener);
            listeners.push(['lifecycle:processor-registered', listener]);
        }

        if (callbacks.onProcessorInitialized) {
            const listener = (data) => {
                if (!processorName || data.name === processorName) {
                    callbacks.onProcessorInitialized(data);
                }
            };
            this.eventBus.on('lifecycle:processor-initialized', listener);
            listeners.push(['lifecycle:processor-initialized', listener]);
        }

        if (callbacks.onProcessorStarted) {
            const listener = (data) => {
                if (!processorName || data.name === processorName) {
                    callbacks.onProcessorStarted(data);
                }
            };
            this.eventBus.on('lifecycle:processor-started', listener);
            listeners.push(['lifecycle:processor-started', listener]);
        }

        if (callbacks.onProcessorStopped) {
            const listener = (data) => {
                if (!processorName || data.name === processorName) {
                    callbacks.onProcessorStopped(data);
                }
            };
            this.eventBus.on('lifecycle:processor-stopped', listener);
            listeners.push(['lifecycle:processor-stopped', listener]);
        }

        if (callbacks.onProcessorError) {
            const listener = (data) => {
                if (!processorName || data.name === processorName) {
                    callbacks.onProcessorError(data);
                }
            };
            this.eventBus.on('lifecycle:processor-error', listener);
            listeners.push(['lifecycle:processor-error', listener]);
        }

        // 中间件生命周期事件
        if (callbacks.onMiddlewareRegistered) {
            const listener = (data) => {
                if (!middlewareName || data.name === middlewareName) {
                    callbacks.onMiddlewareRegistered(data);
                }
            };
            this.eventBus.on('lifecycle:middleware-registered', listener);
            listeners.push(['lifecycle:middleware-registered', listener]);
        }

        this.activeListeners.set(listenerId, listeners);
        this.logger.log(`Created lifecycle listener: ${listenerId}`);
        
        return listenerId;
    }

    /**
     * 创建性能监听器
     * @param {Function} onMetrics - 性能指标回调
     * @param {object} options - 选项
     * @returns {string} 监听器ID
     */
    createPerformanceListener(onMetrics, options = {}) {
        const {
            processorType = null,
            sampleRate = 1.0, // 采样率，1.0表示100%
            aggregateWindow = 60000 // 聚合窗口（毫秒）
        } = options;

        const listenerId = this.generateListenerId('performance');
        const listeners = [];
        const metrics = new Map();

        const processMetrics = (data) => {
            if (Math.random() > sampleRate) return; // 采样
            if (processorType && data.processorType !== processorType) return;

            const key = data.processorType || 'unknown';
            if (!metrics.has(key)) {
                metrics.set(key, {
                    count: 0,
                    totalTime: 0,
                    minTime: Infinity,
                    maxTime: 0,
                    errors: 0,
                    windowStart: Date.now()
                });
            }

            const metric = metrics.get(key);
            
            if (data.processingTime !== undefined) {
                metric.count++;
                metric.totalTime += data.processingTime;
                metric.minTime = Math.min(metric.minTime, data.processingTime);
                metric.maxTime = Math.max(metric.maxTime, data.processingTime);
            }

            if (data.success === false) {
                metric.errors++;
            }

            // 检查是否需要发送聚合指标
            const now = Date.now();
            if (now - metric.windowStart >= aggregateWindow && metric.count > 0) {
                onMetrics({
                    processorType: key,
                    window: {
                        start: metric.windowStart,
                        end: now,
                        duration: now - metric.windowStart
                    },
                    metrics: {
                        count: metric.count,
                        averageTime: metric.totalTime / metric.count,
                        minTime: metric.minTime === Infinity ? 0 : metric.minTime,
                        maxTime: metric.maxTime,
                        totalTime: metric.totalTime,
                        errors: metric.errors,
                        errorRate: metric.errors / metric.count,
                        throughput: metric.count / ((now - metric.windowStart) / 1000) // per second
                    }
                });

                // 重置指标
                metric.count = 0;
                metric.totalTime = 0;
                metric.minTime = Infinity;
                metric.maxTime = 0;
                metric.errors = 0;
                metric.windowStart = now;
            }
        };

        // 监听完成和错误事件
        this.eventBus.on('pipeline:processing-complete', processMetrics);
        listeners.push(['pipeline:processing-complete', processMetrics]);

        this.eventBus.on('pipeline:processing-error', processMetrics);
        listeners.push(['pipeline:processing-error', processMetrics]);

        this.activeListeners.set(listenerId, listeners);
        this.logger.log(`Created performance listener: ${listenerId}`);
        
        return listenerId;
    }

    /**
     * 创建调试监听器
     * @param {Function} onDebugInfo - 调试信息回调
     * @param {object} options - 选项
     * @returns {string} 监听器ID
     */
    createDebugListener(onDebugInfo, options = {}) {
        const {
            logLevel = 'all', // 'all', 'errors', 'warnings'
            includeData = false,
            maxDataSize = 1000
        } = options;

        const listenerId = this.generateListenerId('debug');
        const listeners = [];

        // 监听所有管道事件
        const debugListener = (data) => {
            const debugInfo = {
                timestamp: Date.now(),
                event: data.originalEvent,
                data: includeData ? this.truncateData(data, maxDataSize) : null,
                summary: this.createEventSummary(data)
            };

            // 根据日志级别过滤
            if (logLevel === 'errors' && !data.originalEvent.includes('error')) return;
            if (logLevel === 'warnings' && !data.originalEvent.includes('error') && !data.originalEvent.includes('warning')) return;

            onDebugInfo(debugInfo);
        };

        this.eventBus.on('pipeline:event', debugListener);
        listeners.push(['pipeline:event', debugListener]);

        this.activeListeners.set(listenerId, listeners);
        this.logger.log(`Created debug listener: ${listenerId}`);
        
        return listenerId;
    }

    /**
     * 移除监听器
     * @param {string} listenerId - 监听器ID
     * @returns {boolean} 是否成功移除
     */
    removeListener(listenerId) {
        const listeners = this.activeListeners.get(listenerId);
        if (!listeners) {
            this.logger.warn(`Listener not found: ${listenerId}`);
            return false;
        }

        // 移除所有事件监听器
        for (const [event, listener] of listeners) {
            this.eventBus.off(event, listener);
        }

        this.activeListeners.delete(listenerId);
        this.logger.log(`Removed listener: ${listenerId}`);
        
        return true;
    }

    /**
     * 移除所有监听器
     */
    removeAllListeners() {
        const listenerIds = Array.from(this.activeListeners.keys());
        for (const listenerId of listenerIds) {
            this.removeListener(listenerId);
        }
        this.logger.log('Removed all listeners');
    }

    /**
     * 获取活跃监听器统计
     * @returns {object} 统计信息
     */
    getListenerStats() {
        const stats = {
            totalListeners: this.activeListeners.size,
            byType: {},
            listenerIds: Array.from(this.activeListeners.keys())
        };

        for (const listenerId of stats.listenerIds) {
            const type = listenerId.split('_')[0];
            stats.byType[type] = (stats.byType[type] || 0) + 1;
        }

        return stats;
    }

    /**
     * 生成监听器ID
     * @private
     */
    generateListenerId(type) {
        return `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 检查数据是否匹配过滤条件
     * @private
     */
    matchesFilter(data, processorType, contextId) {
        if (processorType && data.processorType !== processorType) return false;
        if (contextId && data.contextId !== contextId) return false;
        return true;
    }

    /**
     * 截断数据用于调试
     * @private
     */
    truncateData(data, maxSize) {
        const str = JSON.stringify(data);
        if (str.length <= maxSize) return data;
        
        return str.substring(0, maxSize) + '... [truncated]';
    }

    /**
     * 创建事件摘要
     * @private
     */
    createEventSummary(data) {
        const summary = {
            event: data.originalEvent,
            timestamp: data.timestamp
        };

        if (data.processorType) summary.processor = data.processorType;
        if (data.contextId) summary.context = data.contextId;
        if (data.error) summary.error = data.error;
        if (data.processingTime) summary.duration = data.processingTime;

        return summary;
    }

    /**
     * 销毁工厂
     */
    destroy() {
        this.removeAllListeners();
        this.logger.log('EventListenerFactory destroyed');
    }
}