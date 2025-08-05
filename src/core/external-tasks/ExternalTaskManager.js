/**
 * ExternalTaskManager - 外挂任务管理器
 * 负责外挂任务的创建、删除和管理
 */

import { TaskReferenceResolver } from './TaskReferenceResolver.js';
import { Logger } from '../../utils/Logger.js';

export class ExternalTaskManager {
  constructor() {
    this.resolver = new TaskReferenceResolver();
    this.logger = new Logger('ExternalTaskManager');
  }

  /**
   * 创建外挂任务
   * @param {string} targetChatId - 目标聊天ID
   * @param {string} sourceChatId - 源聊天ID
   * @param {string} sourceTaskId - 源任务ID
   * @param {string} customName - 自定义名称
   * @returns {Promise<Object>} 创建的外挂任务对象
   */
  async createExternalTask(targetChatId, sourceChatId, sourceTaskId, customName) {
    this.logger.debug(`创建外挂任务: ${targetChatId} <- ${sourceChatId}/${sourceTaskId}`);

    // 1. 循环引用检测
    if (this.detectCircularReference(targetChatId, sourceChatId, sourceTaskId)) {
      const error = new Error("创建外挂任务会导致循环引用");
      this.logger.error(error.message);
      throw error;
    }

    // 2. 验证源任务
    const sourceTasks = this.getChatTasks(sourceChatId);
    const sourceTask = sourceTasks.find(t => t.taskId === sourceTaskId);
    if (!sourceTask) {
      const error = new Error("源任务不存在");
      this.logger.error(error.message);
      throw error;
    }

    // 3. 检查重复
    const targetTasks = this.getChatTasks(targetChatId);
    const existingTask = targetTasks.find(t => 
      t.type === "external" && 
      t.sourceChat === sourceChatId && 
      t.sourceTaskId === sourceTaskId
    );
    
    if (existingTask) {
      const error = new Error("该外挂任务已存在");
      this.logger.warn(error.message);
      throw error;
    }

    // 4. 创建外挂任务
    const externalTask = {
      taskId: `task_ext_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      type: "external",
      sourceChat: sourceChatId,
      sourceTaskId: sourceTaskId,
      name: customName || `外挂：${sourceTask.name}`,
      displayName: customName,
      enabled: true,
      timestamp: Date.now(),
      orphaned: false
    };

    // 5. 添加到目标聊天
    targetTasks.push(externalTask);
    this.saveChatTasks(targetChatId, targetTasks);

    this.logger.info(`成功创建外挂任务: ${externalTask.name}`);
    return externalTask;
  }

  /**
   * 删除外挂任务
   * @param {string} chatId - 聊天ID
   * @param {string} taskId - 任务ID
   * @returns {Promise<boolean>} 是否成功删除
   */
  async removeExternalTask(chatId, taskId) {
    this.logger.debug(`删除外挂任务: ${chatId}/${taskId}`);

    const tasks = this.getChatTasks(chatId);
    const taskIndex = tasks.findIndex(t => t.taskId === taskId);
    
    if (taskIndex === -1) {
      this.logger.warn(`外挂任务不存在: ${taskId}`);
      return false;
    }

    const task = tasks[taskIndex];
    if (task.type !== "external") {
      this.logger.warn(`任务不是外挂任务: ${taskId}`);
      return false;
    }

    // 外挂任务只删除引用，不删除向量数据
    tasks.splice(taskIndex, 1);
    this.saveChatTasks(chatId, tasks);

    this.logger.info(`成功删除外挂任务: ${task.name}`);
    return true;
  }

  /**
   * 重命名外挂任务
   * @param {string} chatId - 聊天ID
   * @param {string} taskId - 任务ID
   * @param {string} newName - 新名称
   * @returns {Promise<boolean>} 是否成功重命名
   */
  async renameExternalTask(chatId, taskId, newName) {
    this.logger.debug(`重命名外挂任务: ${chatId}/${taskId} -> ${newName}`);

    const tasks = this.getChatTasks(chatId);
    const task = tasks.find(t => t.taskId === taskId);
    
    if (!task) {
      this.logger.warn(`外挂任务不存在: ${taskId}`);
      return false;
    }

    if (task.type !== "external") {
      this.logger.warn(`任务不是外挂任务: ${taskId}`);
      return false;
    }

    // 外挂任务：只修改显示名称，不影响源任务
    task.displayName = newName;
    task.name = newName;
    this.saveChatTasks(chatId, tasks);

    this.logger.info(`成功重命名外挂任务: ${newName}`);
    return true;
  }

  /**
   * 切换外挂任务启用状态
   * @param {string} chatId - 聊天ID
   * @param {string} taskId - 任务ID
   * @param {boolean} enabled - 启用状态
   * @returns {Promise<boolean>} 是否成功切换
   */
  async toggleExternalTask(chatId, taskId, enabled) {
    this.logger.debug(`切换外挂任务状态: ${chatId}/${taskId} -> ${enabled}`);

    const tasks = this.getChatTasks(chatId);
    const task = tasks.find(t => t.taskId === taskId);
    
    if (!task) {
      this.logger.warn(`外挂任务不存在: ${taskId}`);
      return false;
    }

    if (task.type !== "external") {
      this.logger.warn(`任务不是外挂任务: ${taskId}`);
      return false;
    }

    // 只修改外挂任务自己的启用状态，不影响源任务
    task.enabled = enabled;
    this.saveChatTasks(chatId, tasks);

    this.logger.info(`成功${enabled ? '启用' : '禁用'}外挂任务: ${task.name}`);
    return true;
  }

  /**
   * 标记孤儿外挂任务
   * @param {string} deletedChatId - 被删除的聊天ID
   * @returns {Promise<number>} 标记的孤儿任务数量
   */
  async markOrphanedExternalTasks(deletedChatId) {
    this.logger.debug(`标记孤儿外挂任务: ${deletedChatId}`);

    let orphanedCount = 0;
    const allTasks = this.getAllChatTasks();

    for (const [chatId, tasks] of Object.entries(allTasks)) {
      if (!tasks || !Array.isArray(tasks)) continue;

      const orphanedTasks = tasks.filter(task =>
        task.type === "external" && task.sourceChat === deletedChatId
      );

      if (orphanedTasks.length > 0) {
        orphanedTasks.forEach(task => {
          task.orphaned = true;
          task.enabled = false;
          task.name = "源数据已删除";
        });

        this.saveChatTasks(chatId, tasks);
        orphanedCount += orphanedTasks.length;
        
        this.logger.info(`在聊天 ${chatId} 中标记了 ${orphanedTasks.length} 个孤儿外挂任务`);
      }
    }

    this.logger.info(`总共标记了 ${orphanedCount} 个孤儿外挂任务`);
    return orphanedCount;
  }

  /**
   * 循环引用检测
   * @param {string} targetChatId - 目标聊天ID
   * @param {string} sourceChatId - 源聊天ID
   * @param {string} sourceTaskId - 源任务ID
   * @returns {boolean} 是否存在循环引用
   */
  detectCircularReference(targetChatId, sourceChatId, sourceTaskId) {
    const visited = new Set();

    const checkCircular = (chatId, taskId) => {
      const key = `${chatId}_${taskId}`;
      if (visited.has(key)) {
        return true; // 发现循环
      }
      visited.add(key);

      const tasks = this.getChatTasks(chatId);
      const task = tasks.find(t => t.taskId === taskId);

      if (task && task.type === "external") {
        return checkCircular(task.sourceChat, task.sourceTaskId);
      }

      return false;
    };

    // 检查是否会形成循环
    if (sourceChatId === targetChatId) {
      return true; // 同一聊天内不能外挂
    }

    return checkCircular(sourceChatId, sourceTaskId);
  }

  /**
   * 获取聊天任务列表
   * @param {string} chatId - 聊天ID
   * @returns {Array} 任务列表
   */
  getChatTasks(chatId) {
    try {
      const vectorTasks = window.extension_settings?.vectors_enhanced?.vector_tasks || {};
      return vectorTasks[chatId] || [];
    } catch (error) {
      this.logger.error(`获取聊天任务失败: ${chatId}`, error);
      return [];
    }
  }

  /**
   * 获取所有聊天任务
   * @returns {Object} 所有聊天任务
   */
  getAllChatTasks() {
    try {
      return window.extension_settings?.vectors_enhanced?.vector_tasks || {};
    } catch (error) {
      this.logger.error('获取所有聊天任务失败', error);
      return {};
    }
  }

  /**
   * 保存聊天任务列表
   * @param {string} chatId - 聊天ID
   * @param {Array} tasks - 任务列表
   */
  saveChatTasks(chatId, tasks) {
    try {
      if (!window.extension_settings?.vectors_enhanced) {
        window.extension_settings.vectors_enhanced = {};
      }
      if (!window.extension_settings.vectors_enhanced.vector_tasks) {
        window.extension_settings.vectors_enhanced.vector_tasks = {};
      }

      window.extension_settings.vectors_enhanced.vector_tasks[chatId] = tasks;
      
      // 触发保存
      if (typeof window.saveSettingsDebounced === 'function') {
        window.saveSettingsDebounced();
      }
    } catch (error) {
      this.logger.error(`保存聊天任务失败: ${chatId}`, error);
    }
  }

  /**
   * 获取外挂任务预览数据
   * @param {Object} task - 外挂任务对象
   * @returns {Object} 预览数据
   */
  getExternalTaskPreview(task) {
    if (task.type !== "external") {
      return null;
    }

    const resolved = this.resolver.resolve(task);
    
    if (!resolved.valid) {
      return {
        taskName: "源数据已删除",
        content: "此外挂任务的源数据已被删除，无法预览。",
        status: "orphaned"
      };
    }

    const sourceTask = resolved.task;
    return {
      taskName: task.displayName || `外挂：${sourceTask.name}`,
      content: sourceTask.textContent || [],
      settings: sourceTask.settings || {},
      sourceInfo: {
        sourceChat: task.sourceChat,
        sourceTaskName: sourceTask.name,
        sourceTaskId: task.sourceTaskId
      },
      status: "valid"
    };
  }
}