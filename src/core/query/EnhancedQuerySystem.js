/**
 * EnhancedQuerySystem - 增强查询系统
 * 负责处理包含外挂任务的向量查询
 */

import { TaskReferenceResolver } from '../external-tasks/TaskReferenceResolver.js';
import { VectorCollectionManager } from '../external-tasks/VectorCollectionManager.js';
import { Logger } from '../../utils/Logger.js';

export class EnhancedQuerySystem {
  constructor(storageAdapter) {
    this.storageAdapter = storageAdapter;
    this.taskResolver = new TaskReferenceResolver();
    this.vectorManager = new VectorCollectionManager(storageAdapter);
    this.logger = new Logger('EnhancedQuerySystem');
  }

  /**
   * 查询向量任务
   * @param {string} chatId - 聊天ID
   * @param {string} queryText - 查询文本
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>} 查询结果
   */
  async queryVectorTasks(chatId, queryText, options = {}) {
    this.logger.debug(`开始查询向量任务: ${chatId}`);
    
    // 获取当前聊天的启用任务
    const tasks = this.getChatTasks(chatId).filter(t => t.enabled);
    this.logger.debug(`找到 ${tasks.length} 个启用的任务`);

    if (tasks.length === 0) {
      this.logger.debug('没有启用的任务，返回空结果');
      return [];
    }

    const {
      perTaskLimit = 10,
      scoreThreshold = 0.5,
      includeMetadata = true,
      maxResults = 100
    } = options;

    try {
      // 1. 提取所有有效的 collectionId 并建立映射
      const validTasks = [];
      const collectionIds = [];

      for (const task of tasks) {
        const resolved = this.taskResolver.resolve(task);
        if (!resolved.valid) {
          this.logger.warn(`跳过失效任务: ${task.name} - ${resolved.reason}`);
          continue;
        }

        const collectionId = this.vectorManager.getCollectionId(task, chatId);
        const exists = await this.vectorManager.collectionExists(collectionId);
        
        if (exists) {
          validTasks.push({ task, resolved, collectionId });
          collectionIds.push(collectionId);
        }
      }

      if (collectionIds.length === 0) {
        return [];
      }

      // 2. 单次查询多个集合，避免并发风暴
      const totalLimit = perTaskLimit * collectionIds.length;
      const batchResults = await this.storageAdapter.queryMultipleCollections(
        collectionIds,
        queryText,
        totalLimit,
        scoreThreshold
      );

      if (!batchResults || !batchResults.items || batchResults.items.length === 0) {
        return [];
      }

      // 3. 元数据回填，确保前端UI正常显示
      if (includeMetadata) {
        batchResults.items.forEach(item => {
          // 通过后端返回的 collection_id 找回对应的任务信息
          const sourceInfo = validTasks.find(t => t.collectionId === item.metadata.collection_id);
          
          if (sourceInfo) {
            const { task, resolved } = sourceInfo;
            item.metadata = {
              ...item.metadata,
              taskId: task.taskId,
              taskName: task.name,
              isExternal: task.type === "external",
              chatId: chatId,
              queryTime: Date.now()
            };

            if (task.type === "external") {
              item.metadata.sourceChat = task.sourceChat;
              item.metadata.sourceTaskId = task.sourceTaskId;
              item.metadata.sourceTaskName = resolved.task.name;
            }
          }
        });
      }

      // 4. 全局排序并截断
      batchResults.items.sort((a, b) => (b.score || 0) - (a.score || 0));
      const limitedResults = batchResults.items.slice(0, maxResults);

      this.logger.info(`查询完成: 返回 ${limitedResults.length} 个结果`);
      return limitedResults;

    } catch (error) {
      this.logger.error('查询过程中发生错误', error);
      return [];
    }
  }

  /**
   * 查询单个任务
   * @param {Object} task - 任务对象
   * @param {string} chatId - 聊天ID
   * @param {string} queryText - 查询文本
   * @param {Object} options - 查询选项
   * @returns {Promise<Object|null>} 查询结果
   */
  async querySingleTask(task, chatId, queryText, options) {
    try {
      this.logger.debug(`查询任务: ${task.name}`);

      // 解析任务引用
      const resolved = this.taskResolver.resolve(task);
      
      if (!resolved.valid) {
        this.logger.warn(`跳过失效任务: ${task.name} - ${resolved.reason}`);
        return null;
      }

      // 确定向量集合ID
      const collectionId = this.vectorManager.getCollectionId(task, chatId);
      
      // 检查集合是否存在
      const collectionExists = await this.vectorManager.collectionExists(collectionId);
      if (!collectionExists) {
        this.logger.warn(`向量集合不存在: ${collectionId}`);
        return null;
      }

      // 查询向量数据
      const taskResults = await this.storageAdapter.queryCollection(
        collectionId,
        queryText,
        options.perTaskLimit,
        options.scoreThreshold
      );

      if (!taskResults || !taskResults.items || taskResults.items.length === 0) {
        this.logger.debug(`任务 ${task.name} 没有匹配结果`);
        return null;
      }

      // 增强结果元数据
      if (options.includeMetadata) {
        taskResults.items.forEach(item => {
          item.metadata = {
            ...item.metadata,
            taskId: task.taskId,
            taskName: task.name,
            isExternal: task.type === "external",
            chatId: chatId,
            queryTime: Date.now()
          };

          // 外挂任务的额外元数据
          if (task.type === "external") {
            item.metadata.sourceChat = task.sourceChat;
            item.metadata.sourceTaskId = task.sourceTaskId;
            item.metadata.sourceTaskName = resolved.task.name;
          }
        });
      }

      this.logger.debug(`任务 ${task.name} 返回 ${taskResults.items.length} 个结果`);
      return taskResults;

    } catch (error) {
      this.logger.error(`查询任务失败: ${task.name}`, error);
      return null;
    }
  }

  /**
   * 查询指定任务
   * @param {string} chatId - 聊天ID
   * @param {string} taskId - 任务ID
   * @param {string} queryText - 查询文本
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>} 查询结果
   */
  async querySpecificTask(chatId, taskId, queryText, options = {}) {
    this.logger.debug(`查询指定任务: ${chatId}/${taskId}`);

    const tasks = this.getChatTasks(chatId);
    const task = tasks.find(t => t.taskId === taskId);

    if (!task) {
      this.logger.warn(`任务不存在: ${taskId}`);
      return [];
    }

    if (!task.enabled) {
      this.logger.warn(`任务已禁用: ${taskId}`);
      return [];
    }

    const result = await this.querySingleTask(task, chatId, queryText, {
      perTaskLimit: options.perTaskLimit || 50,
      scoreThreshold: options.scoreThreshold || 0,
      includeMetadata: true
    });

    return result ? result.items : [];
  }

  /**
   * 获取任务查询统计信息
   * @param {string} chatId - 聊天ID
   * @returns {Promise<Object>} 统计信息
   */
  async getQueryStatistics(chatId) {
    const tasks = this.getChatTasks(chatId);
    const enabledTasks = tasks.filter(t => t.enabled);
    
    const stats = {
      totalTasks: tasks.length,
      enabledTasks: enabledTasks.length,
      externalTasks: tasks.filter(t => t.type === 'external').length,
      regularTasks: tasks.filter(t => t.type !== 'external').length,
      orphanedTasks: tasks.filter(t => t.orphaned).length,
      validTasks: 0,
      invalidTasks: 0
    };

    // 检查任务有效性
    for (const task of enabledTasks) {
      const resolved = this.taskResolver.resolve(task);
      if (resolved.valid) {
        const collectionId = this.vectorManager.getCollectionId(task, chatId);
        const exists = await this.vectorManager.collectionExists(collectionId);
        if (exists) {
          stats.validTasks++;
        } else {
          stats.invalidTasks++;
        }
      } else {
        stats.invalidTasks++;
      }
    }

    this.logger.info(`查询统计信息: 聊天 ${chatId}`, stats);
    return stats;
  }

  /**
   * 测试查询性能
   * @param {string} chatId - 聊天ID
   * @param {string} queryText - 查询文本
   * @returns {Promise<Object>} 性能统计
   */
  async testQueryPerformance(chatId, queryText) {
    const startTime = Date.now();
    
    try {
      const results = await this.queryVectorTasks(chatId, queryText, {
        perTaskLimit: 10,
        scoreThreshold: 0.5
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      const performance = {
        queryText,
        duration,
        resultCount: results.length,
        averageScore: results.length > 0 ? 
          results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length : 0,
        timestamp: startTime
      };

      this.logger.info(`查询性能测试完成`, performance);
      return performance;

    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;

      this.logger.error('查询性能测试失败', error);
      return {
        queryText,
        duration,
        error: error.message,
        timestamp: startTime
      };
    }
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
   * 验证查询系统状态
   * @returns {Object} 验证结果
   */
  validateSystem() {
    const validation = {
      valid: true,
      issues: []
    };

    if (!this.storageAdapter) {
      validation.valid = false;
      validation.issues.push('StorageAdapter 未初始化');
    }

    if (!this.taskResolver) {
      validation.valid = false;
      validation.issues.push('TaskReferenceResolver 未初始化');
    }

    if (!this.vectorManager) {
      validation.valid = false;
      validation.issues.push('VectorCollectionManager 未初始化');
    }

    this.logger.debug('查询系统验证', validation);
    return validation;
  }
}