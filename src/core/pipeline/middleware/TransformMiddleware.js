/**
 * @file TransformMiddleware.js
 * @description 转换中间件，用于在处理过程中转换数据格式
 */

import { IMiddleware } from './IMiddleware.js';
import { Logger } from '../../../utils/Logger.js';

/**
 * 转换中间件
 * 用于在管道处理过程中转换数据格式，支持多种常见的转换操作
 */
export class TransformMiddleware extends IMiddleware {
    constructor(options = {}) {
        super();
        this.logger = new Logger('Transform');
        this.transformers = options.transformers || [];
        this.preserveOriginal = options.preserveOriginal || false;
    }

    /**
     * 执行数据转换
     */
    async process(input, context, next) {
        let transformedInput = input;
        
        // 如果需要保留原始数据，在上下文中保存
        if (this.preserveOriginal) {
            context.setOriginalInput(input);
        }
        
        // 应用所有转换器
        for (const transformer of this.transformers) {
            try {
                transformedInput = await this.applyTransformer(transformer, transformedInput, context);
                
                this.logger.log(`Applied transformer: ${transformer.name || 'anonymous'}`, {
                    inputType: typeof input,
                    outputType: typeof transformedInput,
                    contextId: context.id
                });
            } catch (error) {
                this.logger.error(`Transformer failed: ${transformer.name || 'anonymous'}`, {
                    error: error.message,
                    contextId: context.id
                });
                
                // 根据配置决定是否继续或抛出错误
                if (transformer.required !== false) {
                    throw new TransformError(
                        `Required transformer '${transformer.name || 'anonymous'}' failed: ${error.message}`,
                        transformer,
                        error
                    );
                }
            }
        }
        
        return next(transformedInput, context);
    }

    /**
     * 应用单个转换器
     */
    async applyTransformer(transformer, input, context) {
        // 检查转换器条件
        if (transformer.condition && !transformer.condition(input, context)) {
            return input; // 条件不满足，跳过转换
        }
        
        // 应用转换
        if (typeof transformer.transform === 'function') {
            return await transformer.transform(input, context);
        } else if (transformer.type) {
            return await this.applyBuiltInTransform(transformer.type, transformer.options || {}, input, context);
        } else {
            throw new Error('Transformer must have either transform function or type');
        }
    }

    /**
     * 应用内置转换
     */
    async applyBuiltInTransform(type, options, input, context) {
        switch (type) {
            case 'normalize':
                return this.normalizeText(input, options);
            
            case 'filter':
                return this.filterData(input, options);
            
            case 'extract':
                return this.extractData(input, options);
            
            case 'format':
                return this.formatData(input, options);
            
            case 'validate':
                return this.validateAndTransform(input, options);
            
            default:
                throw new Error(`Unknown built-in transform type: ${type}`);
        }
    }

    /**
     * 文本标准化转换
     */
    normalizeText(input, options) {
        if (typeof input !== 'string') {
            return input;
        }
        
        let result = input;
        
        if (options.trim !== false) {
            result = result.trim();
        }
        
        if (options.toLowerCase) {
            result = result.toLowerCase();
        }
        
        if (options.removeExtraSpaces) {
            result = result.replace(/\s+/g, ' ');
        }
        
        if (options.removeSpecialChars) {
            result = result.replace(/[^\w\s]/g, '');
        }
        
        if (options.maxLength && result.length > options.maxLength) {
            result = result.substring(0, options.maxLength);
        }
        
        return result;
    }

    /**
     * 数据过滤转换
     */
    filterData(input, options) {
        if (Array.isArray(input)) {
            return input.filter(item => {
                if (options.predicate) {
                    return options.predicate(item);
                }
                if (options.notEmpty && (!item || item.toString().trim() === '')) {
                    return false;
                }
                if (options.minLength && item.toString().length < options.minLength) {
                    return false;
                }
                return true;
            });
        }
        
        return input;
    }

    /**
     * 数据提取转换
     */
    extractData(input, options) {
        if (typeof input === 'object' && input !== null) {
            if (options.fields) {
                const result = {};
                options.fields.forEach(field => {
                    if (field in input) {
                        result[field] = input[field];
                    }
                });
                return result;
            }
            
            if (options.path) {
                return this.getNestedValue(input, options.path);
            }
        }
        
        if (typeof input === 'string' && options.regex) {
            const match = input.match(options.regex);
            return match ? (options.group ? match[options.group] : match[0]) : input;
        }
        
        return input;
    }

    /**
     * 数据格式化转换
     */
    formatData(input, options) {
        if (options.template && typeof options.template === 'string') {
            return options.template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
                return this.getNestedValue(input, key) || match;
            });
        }
        
        if (options.stringify) {
            try {
                return JSON.stringify(input, null, options.indent || 0);
            } catch (error) {
                return String(input);
            }
        }
        
        return input;
    }

    /**
     * 验证并转换
     */
    validateAndTransform(input, options) {
        if (options.schema) {
            // 简单的模式验证
            for (const [key, validator] of Object.entries(options.schema)) {
                const value = this.getNestedValue(input, key);
                if (!validator(value)) {
                    throw new Error(`Validation failed for field: ${key}`);
                }
            }
        }
        
        return input;
    }

    /**
     * 获取嵌套对象的值
     */
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }

    get priority() {
        return 50; // 中等优先级
    }
}

/**
 * 转换错误类
 */
export class TransformError extends Error {
    constructor(message, transformer, originalError) {
        super(message);
        this.name = 'TransformError';
        this.transformer = transformer;
        this.originalError = originalError;
    }
}