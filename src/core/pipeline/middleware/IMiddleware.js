/**
 * @file IMiddleware.js
 * @description 中间件接口定义，用于管道处理中的横切关注点
 */

/**
 * 中间件接口
 * 中间件用于在管道处理过程中添加横切关注点，如日志记录、验证、转换等
 */
export class IMiddleware {
    /**
     * 处理方法，必须由子类实现
     * @param {any} input - 输入数据
     * @param {ProcessingContext} context - 处理上下文
     * @param {Function} next - 调用下一个中间件的函数
     * @returns {Promise<any>} 处理后的数据
     */
    async process(input, context, next) {
        throw new Error('IMiddleware.process() must be implemented by subclasses');
    }

    /**
     * 中间件名称，用于识别和调试
     * @returns {string} 中间件名称
     */
    get name() {
        return this.constructor.name;
    }

    /**
     * 中间件优先级，数字越小优先级越高
     * @returns {number} 优先级值
     */
    get priority() {
        return 100;
    }

    /**
     * 初始化中间件（可选实现）
     * @param {object} config - 配置选项
     */
    async init(config = {}) {
        // 默认空实现
    }

    /**
     * 销毁中间件（可选实现）
     */
    async destroy() {
        // 默认空实现
    }
}