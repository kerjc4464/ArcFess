/**
 * VectorCollectionManager - 向量集合管理器
 * 负责管理向量集合ID的生成和验证
 */

import { Logger } from '../../utils/Logger.js';

export class VectorCollectionManager {
  constructor(storageAdapter) {
    this.storageAdapter = storageAdapter;
    this.logger = new Logger('VectorCollectionManager');
  }

  /**
   * 获取向量集合ID
   * @param {Object} task - 任务对象
   * @param {string} currentChatId - 当前聊天ID
   * @returns {string} 向量集合ID
   */
  getCollectionId(task, currentChatId) {
    if (task.type === "external") {
      // 外挂任务使用源任务的集合ID
      const collectionId = `${task.sourceChat}_${task.sourceTaskId}`;
      this.logger.debug(`外挂任务集合ID: ${collectionId}`);
      return collectionId;
    } else {
      // 普通任务使用当前聊天的集合ID
      const collectionId = `${currentChatId}_${task.taskId}`;
      this.logger.debug(`普通任务集合ID: ${collectionId}`);
      return collectionId;
    }
  }

  /**
   * 检查向量集合是否存在
   * @param {string} collectionId - 集合ID
   * @returns {Promise<boolean>} 是否存在
   */
  async collectionExists(collectionId) {
    try {
      if (!this.storageAdapter) {
        this.logger.warn('StorageAdapter 未初始化');
        return false;
      }

      // 尝试查询集合以检查是否存在
      const result = await this.storageAdapter.queryCollection(collectionId, "test", 1);
      return result !== null && result !== undefined;
    } catch (error) {
      this.logger.debug(`集合不存在或查询失败: ${collectionId}`, error);
      return false;
    }
  }

  /**
   * 获取集合信息
   * @param {string} collectionId - 集合ID
   * @returns {Promise<Object|null>} 集合信息
   */
  async getCollectionInfo(collectionId) {
    try {
      if (!this.storageAdapter) {
        this.logger.warn('StorageAdapter 未初始化');
        return null;
      }

      const exists = await this.collectionExists(collectionId);
      if (!exists) {
        return null;
      }

      // 尝试获取集合的基本信息
      const result = await this.storageAdapter.queryCollection(collectionId, "", 0);
      
      return {
        id: collectionId,
        exists: true,
        itemCount: result?.items?.length || 0,
        lastQueried: Date.now()
      };
    } catch (error) {
      this.logger.error(`获取集合信息失败: ${collectionId}`, error);
      return null;
    }
  }

  /**
   * 验证任务的向量集合
   * @param {Object} task - 任务对象
   * @param {string} currentChatId - 当前聊天ID
   * @returns {Promise<Object>} 验证结果
   */
  async validateTaskCollection(task, currentChatId) {
    const collectionId = this.getCollectionId(task, currentChatId);
    const exists = await this.collectionExists(collectionId);
    
    const result = {
      taskId: task.taskId,
      taskName: task.name,
      taskType: task.type || 'regular',
      collectionId,
      exists,
      valid: exists
    };

    if (task.type === "external") {
      result.sourceChat = task.sourceChat;
      result.sourceTaskId = task.sourceTaskId;
      
      if (!exists) {
        result.valid = false;
        result.reason = "源任务的向量数据不存在";
      }
    } else {
      if (!exists) {
        result.valid = false;
        result.reason = "任务的向量数据不存在";
      }
    }

    this.logger.debug(`任务向量集合验证: ${task.name} -> ${result.valid ? '有效' : '无效'}`);
    return result;
  }

  /**
   * 批量验证任务的向量集合
   * @param {Array} tasks - 任务列表
   * @param {string} currentChatId - 当前聊天ID
   * @returns {Promise<Array>} 验证结果列表
   */
  async validateTaskCollections(tasks, currentChatId) {
    if (!Array.isArray(tasks)) {
      return [];
    }

    const validationPromises = tasks.map(task => 
      this.validateTaskCollection(task, currentChatId)
    );

    try {
      const results = await Promise.all(validationPromises);
      
      const validCount = results.filter(r => r.valid).length;
      this.logger.info(`批量验证完成: ${validCount}/${results.length} 个任务有效`);
      
      return results;
    } catch (error) {
      this.logger.error('批量验证失败', error);
      return [];
    }
  }

  /**
   * 清理集合（仅用于普通任务）
   * @param {string} collectionId - 集合ID
   * @returns {Promise<boolean>} 是否成功清理
   */
  async purgeCollection(collectionId) {
    try {
      if (!this.storageAdapter) {
        this.logger.warn('StorageAdapter 未初始化');
        return false;
      }

      // 检查集合ID格式，确保不是外挂任务的集合
      const parts = collectionId.split('_');
      if (parts.length < 2) {
        this.logger.warn(`集合ID格式不正确: ${collectionId}`);
        return false;
      }

      await this.storageAdapter.purgeVectorIndex(collectionId);
      this.logger.info(`成功清理向量集合: ${collectionId}`);
      return true;
    } catch (error) {
      this.logger.error(`清理向量集合失败: ${collectionId}`, error);
      return false;
    }
  }

  /**
   * 获取所有集合的统计信息
   * @param {Array} tasks - 任务列表
   * @param {string} currentChatId - 当前聊天ID
   * @returns {Promise<Object>} 统计信息
   */
  async getCollectionStatistics(tasks, currentChatId) {
    if (!Array.isArray(tasks)) {
      return {
        totalTasks: 0,
        validCollections: 0,
        externalTasks: 0,
        regularTasks: 0,
        orphanedTasks: 0
      };
    }

    const validations = await this.validateTaskCollections(tasks, currentChatId);
    
    const stats = {
      totalTasks: tasks.length,
      validCollections: validations.filter(v => v.valid).length,
      externalTasks: validations.filter(v => v.taskType === 'external').length,
      regularTasks: validations.filter(v => v.taskType === 'regular').length,
      orphanedTasks: tasks.filter(t => t.orphaned).length
    };

    this.logger.info('集合统计信息', stats);
    return stats;
  }

  /**
   * 生成任务的向量集合ID（用于创建新任务）
   * @param {string} chatId - 聊天ID
   * @param {string} taskId - 任务ID
   * @returns {string} 向量集合ID
   */
  generateCollectionId(chatId, taskId) {
    return `${chatId}_${taskId}`;
  }

  /**
   * 解析集合ID
   * @param {string} collectionId - 集合ID
   * @returns {Object} 解析结果
   */
  parseCollectionId(collectionId) {
    const parts = collectionId.split('_');
    if (parts.length < 2) {
      return {
        valid: false,
        reason: 'ID格式不正确'
      };
    }

    // 重新组合，因为聊天ID或任务ID可能包含下划线
    const lastUnderscoreIndex = collectionId.lastIndexOf('_');
    const chatId = collectionId.substring(0, lastUnderscoreIndex);
    const taskId = collectionId.substring(lastUnderscoreIndex + 1);

    return {
      valid: true,
      chatId,
      taskId,
      collectionId
    };
  }

  /**
   * 检查集合ID是否属于指定聊天
   * @param {string} collectionId - 集合ID
   * @param {string} chatId - 聊天ID
   * @returns {boolean} 是否属于指定聊天
   */
  belongsToChat(collectionId, chatId) {
    const parsed = this.parseCollectionId(collectionId);
    return parsed.valid && parsed.chatId === chatId;
  }
}