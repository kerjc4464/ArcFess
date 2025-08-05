/**
 * @file LoggingMiddleware.js
 * @description 日志记录中间件，用于记录管道处理过程中的关键信息
 */

import { IMiddleware } from './IMiddleware.js';
import { Logger } from '../../../utils/Logger.js';

/**
 * 日志记录中间件
 * 记录处理开始、结束时间，处理结果，以及错误信息
 */
export class LoggingMiddleware extends IMiddleware {
    constructor(options = {}) {
        super();
        this.logger = new Logger('Pipeline');
        this.logLevel = options.logLevel || 'info';
        this.includeData = options.includeData || false;
        this.maxDataLength = options.maxDataLength || 200;
    }

    /**
     * 处理日志记录
     */
    async process(input, context, next) {
        const startTime = Date.now();
        const processorName = context.currentProcessor?.name || 'Unknown';
        
        try {
            // 记录开始
            this.logStart(processorName, input, context);
            
            // 执行下一个处理器
            const result = await next(input, context);
            
            // 记录成功完成
            const duration = Date.now() - startTime;
            this.logSuccess(processorName, result, context, duration);
            
            return result;
        } catch (error) {
            // 记录错误
            const duration = Date.now() - startTime;
            this.logError(processorName, error, context, duration);
            throw error;
        }
    }

    /**
     * 记录处理开始
     */
    logStart(processorName, input, context) {
        if (this.logLevel === 'debug') {
            const inputSummary = this.summarizeData(input);
            this.logger.log(`Starting ${processorName} processor`, {
                inputType: typeof input,
                inputSummary,
                contextId: context.id
            });
        }
    }

    /**
     * 记录处理成功
     */
    logSuccess(processorName, result, context, duration) {
        const resultSummary = this.summarizeData(result);
        this.logger.log(`${processorName} completed successfully`, {
            duration: `${duration}ms`,
            resultType: typeof result,
            resultSummary,
            contextId: context.id
        });
    }

    /**
     * 记录处理错误
     */
    logError(processorName, error, context, duration) {
        this.logger.error(`${processorName} failed`, {
            duration: `${duration}ms`,
            error: error.message,
            errorType: error.constructor.name,
            contextId: context.id,
            stack: this.logLevel === 'debug' ? error.stack : undefined
        });
    }

    /**
     * 总结数据用于日志
     */
    summarizeData(data) {
        if (!this.includeData || !data) {
            return this.getDataTypeInfo(data);
        }

        try {
            let summary;
            if (typeof data === 'string') {
                summary = data.length > this.maxDataLength 
                    ? data.substring(0, this.maxDataLength) + '...'
                    : data;
            } else if (Array.isArray(data)) {
                summary = `Array[${data.length}]`;
                if (data.length > 0 && this.logLevel === 'debug') {
                    summary += ` first: ${this.summarizeData(data[0])}`;
                }
            } else if (typeof data === 'object') {
                const keys = Object.keys(data);
                summary = `Object{${keys.join(', ')}}`;
            } else {
                summary = String(data);
            }
            
            return summary;
        } catch (error) {
            return `[Error summarizing data: ${error.message}]`;
        }
    }

    /**
     * 获取数据类型信息
     */
    getDataTypeInfo(data) {
        if (data === null) return 'null';
        if (data === undefined) return 'undefined';
        if (Array.isArray(data)) return `Array[${data.length}]`;
        if (typeof data === 'object') return `Object{${Object.keys(data).length} keys}`;
        if (typeof data === 'string') return `String[${data.length}]`;
        return typeof data;
    }

    get priority() {
        return 10; // 高优先级，早执行
    }
}