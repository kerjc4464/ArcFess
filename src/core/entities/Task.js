/**
 * @fileoverview 任务实体定义——兼容新旧两种任务格式。
 *
 * 历史背景:
 *   旧版插件中任务仅以字符串ID标识，所有上下文信息混在外部。
 *   新版升级为结构化对象，携带类型、状态、内容和元数据。
 *   本实体封装了迁移兼容逻辑，使新旧数据可以无感共存。
 *
 * @typedef {Object} TaskData
 * @property {string} id - 任务唯一标识符
 * @property {'vectorize'|'query'|'rerank'|'external'} type - 任务类型
 * @property {'pending'|'running'|'completed'|'failed'|'cancelled'} status - 任务执行状态
 * @property {import('./Content.js').Content|string} content - 关联的内容实体或内容文本
 * @property {Object} [metadata] - 可选的附加元数据
 */

/**
 * 任务数据结构——表示一条可被调度执行的异步向量化/检索任务。
 *
 * 兼容性模式:
 *   - 旧格式（字符串）: `new Task("task_123")` → legacy = true，仅设定 id
 *   - 新格式（对象）: `new Task({id, type, status, ...})` → legacy = false，完整结构
 *
 * 状态流转:
 *   pending → running → completed (成功)
 *   pending → running → failed (失败)
 *   pending → cancelled (取消，跳过执行)
 *
 * @class Task
 */
export class Task {
  /**
   * 创建一个任务实例。
   *
   * @param {string|TaskData} data - 任务数据。旧格式为字符串ID，新格式为结构化对象
   *
   * @example
   * // 旧格式兼容
   * const legacyTask = new Task('task_abc');
   *
   * @example
   * // 新格式
   * const task = new Task({
   *   id: 'task_xyz',
   *   type: 'vectorize',
   *   status: 'pending',
   *   content: someContentObject,
   *   metadata: { priority: 'high' }
   * });
   */
  constructor(data) {
    // === 旧格式兼容（字符串ID） ===
    if (typeof data === 'string') {
      this.id = data;          // 直接使用字符串作为任务ID
      this.legacy = true;      // 标记为旧格式，外部代码可据此差异化处理
    }
    // === 新格式（结构化对象） ===
    else {
      this.id = data.id;
      this.type = data.type;
      this.status = data.status || 'pending';  // 默认状态为等待执行
      this.content = data.content;
      this.metadata = data.metadata || {};
      this.legacy = false;
    }
  }
}
