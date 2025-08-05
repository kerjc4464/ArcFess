/**
 * @file ValidationMiddleware.js
 * @description 验证中间件，用于验证输入数据的有效性
 */

import { IMiddleware } from './IMiddleware.js';
import { Logger } from '../../../utils/Logger.js';

/**
 * 验证中间件
 * 在处理前验证输入数据的有效性，确保数据符合预期格式
 */
export class ValidationMiddleware extends IMiddleware {
    constructor(options = {}) {
        super();
        this.logger = new Logger('Validation');
        this.rules = options.rules || {};
        this.throwOnValidationError = options.throwOnValidationError !== false;
    }

    /**
     * 执行验证
     */
    async process(input, context, next) {
        const validationResult = this.validateInput(input, context);
        
        if (!validationResult.isValid) {
            const error = new ValidationError(
                `Validation failed: ${validationResult.errors.join(', ')}`,
                validationResult.errors
            );
            
            this.logger.error('Validation failed', {
                errors: validationResult.errors,
                contextId: context.id,
                inputType: typeof input
            });
            
            if (this.throwOnValidationError) {
                throw error;
            } else {
                // 添加验证错误到上下文但继续处理
                context.addValidationErrors(validationResult.errors);
            }
        }

        return next(input, context);
    }

    /**
     * 验证输入数据
     */
    validateInput(input, context) {
        const errors = [];
        
        // 基本类型验证
        if (this.rules.required && (input === null || input === undefined)) {
            errors.push('Input is required but got null or undefined');
        }
        
        if (this.rules.type && input !== null && input !== undefined) {
            if (typeof input !== this.rules.type) {
                errors.push(`Expected type ${this.rules.type} but got ${typeof input}`);
            }
        }
        
        // 字符串验证
        if (typeof input === 'string' && this.rules.string) {
            const stringRules = this.rules.string;
            
            if (stringRules.minLength && input.length < stringRules.minLength) {
                errors.push(`String length ${input.length} is less than minimum ${stringRules.minLength}`);
            }
            
            if (stringRules.maxLength && input.length > stringRules.maxLength) {
                errors.push(`String length ${input.length} exceeds maximum ${stringRules.maxLength}`);
            }
            
            if (stringRules.pattern && !stringRules.pattern.test(input)) {
                errors.push(`String does not match required pattern`);
            }
            
            if (stringRules.notEmpty && input.trim().length === 0) {
                errors.push('String cannot be empty');
            }
        }
        
        // 数组验证
        if (Array.isArray(input) && this.rules.array) {
            const arrayRules = this.rules.array;
            
            if (arrayRules.minLength && input.length < arrayRules.minLength) {
                errors.push(`Array length ${input.length} is less than minimum ${arrayRules.minLength}`);
            }
            
            if (arrayRules.maxLength && input.length > arrayRules.maxLength) {
                errors.push(`Array length ${input.length} exceeds maximum ${arrayRules.maxLength}`);
            }
            
            if (arrayRules.itemType) {
                input.forEach((item, index) => {
                    if (typeof item !== arrayRules.itemType) {
                        errors.push(`Array item at index ${index} has type ${typeof item}, expected ${arrayRules.itemType}`);
                    }
                });
            }
        }
        
        // 对象验证
        if (typeof input === 'object' && input !== null && !Array.isArray(input) && this.rules.object) {
            const objectRules = this.rules.object;
            
            if (objectRules.requiredFields) {
                objectRules.requiredFields.forEach(field => {
                    if (!(field in input)) {
                        errors.push(`Required field '${field}' is missing`);
                    }
                });
            }
            
            if (objectRules.allowedFields) {
                Object.keys(input).forEach(field => {
                    if (!objectRules.allowedFields.includes(field)) {
                        errors.push(`Field '${field}' is not allowed`);
                    }
                });
            }
        }
        
        // 自定义验证函数
        if (this.rules.custom && typeof this.rules.custom === 'function') {
            try {
                const customResult = this.rules.custom(input, context);
                if (customResult !== true) {
                    errors.push(customResult || 'Custom validation failed');
                }
            } catch (error) {
                errors.push(`Custom validation error: ${error.message}`);
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    get priority() {
        return 20; // 高优先级，在日志后但在处理前执行
    }
}

/**
 * 验证错误类
 */
export class ValidationError extends Error {
    constructor(message, errors = []) {
        super(message);
        this.name = 'ValidationError';
        this.errors = errors;
    }
}