/**
 * TaskReferenceResolver - 任务引用解析器
 * 负责解析外挂任务的引用，处理源任务的查找和验证
 */

import { Logger } from '../../utils/Logger.js';

export class TaskReferenceResolver {
  constructor(allVectorTasks) {
    this.logger = new Logger('TaskReferenceResolver');
    this.allVectorTasks = allVectorTasks || {};
  }

  /**
   * 解析任务引用
   * @param {Object} task - 任务对象
   * @returns {Object} 解析结果 {valid: boolean, task: Object, isExternal: boolean, reason?: string}
   */
  resolve(task) {
    if (task.type !== "external") {
      return { valid: true, task, isExternal: false };
    }

    this.logger.debug(`解析外挂任务引用: ${task.name}`);

    // 检查源聊天是否存在
    const sourceChat = this.getSourceChat(task.sourceChat);
    if (!sourceChat) {
      this.logger.warn(`源聊天不存在: ${task.sourceChat}`);
      return {
        valid: false,
        reason: "源聊天不存在",
        task: this.createOrphanTask(task),
        isExternal: true
      };
    }

    // 检查源任务是否存在，兼容旧格式
    const sourceTask = sourceChat.find(t => (t.taskId || t.id) === task.sourceTaskId);
    if (!sourceTask) {
      this.logger.warn(`源任务不存在: ${task.sourceTaskId}`);
      return {
        valid: false,
        reason: "源任务不存在",
        task: this.createOrphanTask(task),
        isExternal: true
      };
    }

    // 注意：不检查源任务的启用状态，因为外挂任务应该可以访问被禁用的源任务数据

    // 返回解析后的任务
    const mergedTask = this.mergeTaskData(task, sourceTask);
    this.logger.debug(`成功解析外挂任务: ${mergedTask.name}`);

    return {
      valid: true,
      task: mergedTask,
      isExternal: true
    };
  }

  /**
   * 创建孤儿任务视图
   * @param {Object} externalTask - 外挂任务对象
   * @returns {Object} 孤儿任务对象
   */
  createOrphanTask(externalTask) {
    return {
      ...externalTask,
      name: "源数据已删除",
      enabled: false,
      orphaned: true,
      textContent: [],
      settings: {}
    };
  }

  /**
   * 合并外挂任务和源任务数据
   * @param {Object} externalTask - 外挂任务对象
   * @param {Object} sourceTask - 源任务对象
   * @returns {Object} 合并后的任务对象
   */
  mergeTaskData(externalTask, sourceTask) {
    return {
      ...sourceTask,                     // 源任务的所有数据
      taskId: externalTask.taskId,       // 保持外挂任务的ID
      enabled: externalTask.enabled,     // 使用外挂任务自己的启用状态
      name: externalTask.displayName || `外挂：${sourceTask.name}`,
      timestamp: externalTask.timestamp,
      isExternal: true,
      sourceChat: externalTask.sourceChat,
      sourceTaskId: externalTask.sourceTaskId,
      displayName: externalTask.displayName,
      orphaned: false
    };
  }

  /**
   * 获取源聊天的任务列表
   * @param {string} sourceChatId - 源聊天ID
   * @returns {Array|null} 任务列表或null
   */
  getSourceChat(sourceChatId) {
    try {
      // 使用构造函数中传入的任务数据
      return this.allVectorTasks[sourceChatId] || null;
    } catch (error) {
      this.logger.error(`获取源聊天失败: ${sourceChatId}`, error);
      return null;
    }
  }

  /**
   * 批量解析任务列表
   * @param {Array} tasks - 任务列表
   * @returns {Array} 解析结果列表
   */
  resolveAll(tasks) {
    if (!Array.isArray(tasks)) {
      return [];
    }

    return tasks.map(task => this.resolve(task));
  }

  /**
   * 检查任务是否为外挂任务
   * @param {Object} task - 任务对象
   * @returns {boolean} 是否为外挂任务
   */
  isExternalTask(task) {
    return task && task.type === "external";
  }

  /**
   * 获取外挂任务的源信息
   * @param {Object} task - 外挂任务对象
   * @returns {Object|null} 源信息或null
   */
  getExternalTaskSource(task) {
    if (!this.isExternalTask(task)) {
      return null;
    }

    const sourceChat = this.getSourceChat(task.sourceChat);
    const sourceTask = sourceChat ? sourceChat.find(t => t.taskId === task.sourceTaskId) : null;

    return {
      sourceChat: task.sourceChat,
      sourceTaskId: task.sourceTaskId,
      sourceChatExists: !!sourceChat,
      sourceTaskExists: !!sourceTask,
      sourceTaskEnabled: sourceTask ? sourceTask.enabled : false,
      sourceTaskName: sourceTask ? sourceTask.name : null
    };
  }

  /**
   * 检查引用完整性
   * @param {Object} task - 外挂任务对象
   * @returns {Object} 完整性检查结果
   */
  checkReferenceIntegrity(task) {
    if (!this.isExternalTask(task)) {
      return { valid: true, issues: [] };
    }

    const issues = [];
    const sourceInfo = this.getExternalTaskSource(task);

    if (!sourceInfo.sourceChatExists) {
      issues.push('源聊天不存在');
    }

    if (!sourceInfo.sourceTaskExists) {
      issues.push('源任务不存在');
    }

    return {
      valid: issues.length === 0,
      issues,
      sourceInfo
    };
  }
}
