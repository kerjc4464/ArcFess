/**
 * @fileoverview 简单的前缀式日志记录器——在 console 输出前自动加上模块名标签。
 *
 * 使用方式:
 *   const logger = new Logger('VectorizationProcessor');
 *   logger.log('准备开始处理...');    // → [VectorizationProcessor] 准备开始处理...
 *   logger.error('API 请求失败');     // → [VectorizationProcessor] API 请求失败
 *
 * 日志级别对应标准 console 方法:
 *   log   → console.log    (普通信息)
 *   error → console.error  (错误信息，控制台高亮红)
 *   warn  → console.warn   (警告信息，控制台高亮黄)
 *   debug → console.debug  (调试信息，默认仅在打开调试级别时显示)
 *
 * @class Logger
 */
export class Logger {
  /**
   * 创建一个带模块前缀的日志器。
   *
   * @param {string} module - 模块名称，会以 [moduleName] 格式加在所有日志输出前
   */
  constructor(module) {
    this.module = module;
  }

  /**
   * 普通日志输出。
   * @param {string} message - 日志消息
   * @param {...*} args - 额外的参数，传递给 console.log
   */
  log(message, ...args) {
    console.log(`[${this.module}] ${message}`, ...args);
  }

  /**
   * 错误日志输出。
   * @param {string} message - 错误消息
   * @param {...*} args - 额外的参数，传递给 console.error
   */
  error(message, ...args) {
    console.error(`[${this.module}] ${message}`, ...args);
  }

  /**
   * 警告日志输出。
   * @param {string} message - 警告消息
   * @param {...*} args - 额外的参数，传递给 console.warn
   */
  warn(message, ...args) {
    console.warn(`[${this.module}] ${message}`, ...args);
  }

  /**
   * 调试日志输出（需在浏览器开发工具中开启 Debug 日志级别才可见）。
   * @param {string} message - 调试消息
   * @param {...*} args - 额外的参数，传递给 console.debug
   */
  debug(message, ...args) {
    console.debug(`[${this.module}] ${message}`, ...args);
  }
}
