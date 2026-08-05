/**
 * @fileoverview 配置管理器——插件设置的统一读写入口。
 *
 * 设计思路:
 *   SillyTavern 使用全局 extension_settings 对象存储所有插件的持久化配置。
 *   本管理器将 vectors_enhanced 命名空间下的读写操作封装为统一的 get/set/getAll 接口，
 *   确保每次写入后自动触发 SillyTavern 的保存函数以持久化到 settings.json。
 *
 * 保存机制:
 *   set() 调用后会立即调用 saveFunction() 触发全量保存。
 *   这是 SillyTavern 的标准模式——extensions 直接修改 extension_settings 后调用 saveSettingsDebounced()。
 *
 * @class ConfigManager
 */
export class ConfigManager {
  /**
   * 创建配置管理器实例。
   *
   * @param {Object} extensionSettings - SillyTavern 的全局 extension_settings 对象引用
   * @param {Function} saveFunction - SillyTavern 提供的保存函数（通常为 saveSettingsDebounced）
   */
  constructor(extensionSettings, saveFunction) {
    this.extensionSettings = extensionSettings;
    this.saveFunction = saveFunction;
  }

  /**
   * 读取单个配置项。
   *
   * 使用可选链运算符（?.）安全读取，当 vectors_enhanced 命名空间尚未初始化时返回 undefined。
   *
   * @param {string} key - 配置项的键名
   * @returns {*} 配置值，未设置时返回 undefined
   */
  get(key) {
    // 从 extension_settings.vectors_enhanced 中按 key 读取对应配置值
    // 可选链确保首次访问时不会因命名空间未初始化而报错
    return this.extensionSettings.vectors_enhanced?.[key];
  }

  /**
   * 写入单个配置项并立即持久化。
   *
   * 执行流程:
   *   1. 懒初始化 vectors_enhanced 命名空间（如果不存在）
   *   2. 写入 key-value
   *   3. 调用 saveFunction() 持久化到 settings.json
   *   4. 返回写入的值（支持链式调用）
   *
   * @param {string} key - 配置项的键名
   * @param {*} value - 配置值（支持任意可序列化类型）
   * @returns {*} 返回写入的值
   */
  set(key, value) {
    // 懒初始化——首次写入时创建命名空间对象
    if (!this.extensionSettings.vectors_enhanced) {
      this.extensionSettings.vectors_enhanced = {};
    }

    // 写入配置值
    this.extensionSettings.vectors_enhanced[key] = value;

    // 触发持久化保存（SillyTavern 全量保存 extension_settings 到 settings.json）
    this.saveFunction();

    return value;
  }

  /**
   * 批量获取当前命名空间下的所有配置项。
   *
   * 用于初始化时同步全部设置，或者导出/备份配置快照。
   *
   * @returns {Object} vectors_enhanced 命名空间下的完整配置对象（浅拷贝），未初始化时返回空对象
   */
  getAll() {
    // 返回 vectors_enhanced 下的全部配置，不存在时返回空对象兜底
    return this.extensionSettings.vectors_enhanced || {};
  }
}
