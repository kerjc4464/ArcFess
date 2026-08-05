/**
 * @fileoverview 轻量级事件总线——发布-订阅模式的零依赖实现。
 *
 * 使用场景:
 *   - 跨模块解耦通信（UI 层 ↔ 核心逻辑层 ↔ 基础设施层）
 *   - 避免硬编码回调链和紧耦合的依赖关系
 *   - 替代 Web 原生的 CustomEvent / EventTarget，提供更简洁的 API
 *
 * 线程安全说明:
 *   JavaScript 为单线程模型，所有事件处理同步执行，不存在竞态条件。
 *   但回调中的异步操作（Promise/async）会推迟到当前微任务队列完成之后，
 *   如果回调依赖顺序执行，请在回调中自行处理 await 逻辑。
 *
 * 内存泄漏警告:
 *   注册回调而不移除会导致回调闭包中的引用无法被 GC 回收。
 *   在 UI 组件销毁、页面切换等场景下，务必调用 off() 解除绑定。
 *
 * @class EventBus
 */
export class EventBus {
  /**
   * 创建一个事件总线实例。
   * 内部使用 plain Object 存储事件名到回调数组的映射。
   */
  constructor() {
    /** @type {Object.<string, Function[]>} 事件名 → 回调函数数组的映射表 */
    this.events = {};
  }

  /**
   * 注册事件监听器。
   *
   * 支持同一事件注册多个回调，触发时按注册顺序同步执行。
   * 重复注册同一个回调不会自动去重——调用方需自行保证不重复绑定。
   *
   * @param {string} event - 事件名称（建议使用 `:` 分隔命名空间，如 `vector:complete`）
   * @param {Function} callback - 事件回调函数，接收 emit() 传递的 data 参数
   *
   * @example
   * eventBus.on('task:done', (task) => { console.log(task.id); });
   */
  on(event, callback) {
    // 懒初始化——首次注册该事件时创建回调数组
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(callback);
  }

  /**
   * 触发事件——同步调用该事件的所有已注册回调。
   *
   * 回调按注册顺序依次执行。如果某个回调抛出异常，后续回调仍会继续执行
   * （forEach 不会因异常而中断——但异常会导致当前调用栈上的 catch 捕获）。
   * 对于关键事件，建议在回调内部自行 try/catch。
   *
   * @param {string} event - 要触发的事件名称
   * @param {*} [data] - 传递给每个回调的数据载荷（可选）
   *
   * @example
   * eventBus.emit('ui:refresh', { source: 'settings' });
   */
  emit(event, data) {
    if (this.events[event]) {
      this.events[event].forEach(callback => callback(data));
    }
  }

  /**
   * 移除事件监听器。
   *
   * 通过引用相等（===）精确匹配要移除的回调函数。
   * 如果同一个回调被注册了多次（同一引用），此操作会一次性移除所有匹配项。
   * 如果事件名下没有已注册的回调，此操作为安全的空操作。
   *
   * @param {string} event - 事件名称
   * @param {Function} callback - 要移除的回调函数引用
   *
   * @example
   * const handler = (data) => { ... };
   * eventBus.on('task:done', handler);
   * // ... 稍后移除
   * eventBus.off('task:done', handler);
   */
  off(event, callback) {
    if (this.events[event]) {
      this.events[event] = this.events[event].filter(cb => cb !== callback);
    }
  }
}
