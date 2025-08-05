/**
 * @file VectorExportImportManager.js
 * @description 向量数据导入导出管理器
 * @module core/export-import/VectorExportImportManager
 */

import { Logger } from '../../utils/Logger.js';

/**
 * 向量数据导入导出管理器
 * 负责向量数据的导出和导入功能
 */
export class VectorExportImportManager {
  constructor(dependencies = {}) {
    this.storageAdapter = dependencies.storageAdapter;
    this.getRequestHeaders = dependencies.getRequestHeaders;
    this.getCurrentChatId = dependencies.getCurrentChatId;
    this.extension_settings = dependencies.extension_settings;
    this.saveSettingsDebounced = dependencies.saveSettingsDebounced;
    this.logger = new Logger('VectorExportImportManager');
  }

  /**
   * 导出向量数据
   * @param {string} taskId - 任务ID
   * @param {string} chatId - 聊天ID
   * @returns {Promise<Object>} 导出的数据包
   */
  async exportVectorData(taskId, chatId) {
    try {
      this.logger.log(`开始导出向量数据: ${chatId}/${taskId}`);
      
      // 1. 获取任务元数据
      const tasks = this.getChatTasks(chatId);
      const task = tasks.find(t => t.taskId === taskId);
      
      if (!task) {
        throw new Error(`任务不存在: ${taskId}`);
      }
      
      // 2. 构建集合ID
      const collectionId = this.getCollectionId(task, chatId);
      
      // 3. 获取所有向量数据（使用新的方法）
      const vectorData = await this.storageAdapter.getAllVectorData(collectionId);
      this.logger.log(`获取到 ${vectorData.length} 条向量数据`);
      
      // 5. 获取当前的向量化引擎信息
      const vectorSource = this.extension_settings?.vectors_enhanced?.source || 'unknown';
      const sourceModel = this.getVectorSourceModel();
      
      // 6. 构建导出包
      const exportPackage = {
        version: "1.1", // 升级版本以包含向量化引擎信息
        exportDate: new Date().toISOString(),
        source: {
          chatId: chatId,
          taskId: taskId,
          taskName: task.name,
          taskType: task.type || 'regular'
        },
        vectorEngine: {
          source: vectorSource,
          model: sourceModel,
          warning: "导入时必须使用相同的向量化引擎和模型，否则查询结果将不准确"
        },
        vectorData: {
          collectionId: collectionId,
          items: vectorData.map(item => ({
            hash: item.hash,
            text: item.text,
            metadata: item.metadata || {}
          })),
          itemCount: vectorData.length
        },
        settings: {
          chunkSize: task.chunkSize || this.extension_settings?.vectors_enhanced?.chunk_size || 512,
          overlapPercent: task.overlapPercent || this.extension_settings?.vectors_enhanced?.overlap_percent || 0,
          tagRules: task.tagRules || this.extension_settings?.vectors_enhanced?.selected_content?.chat?.tag_rules || []
        }
      };
      
      this.logger.log(`成功创建导出包，包含 ${exportPackage.vectorData.itemCount} 条数据`);
      return exportPackage;
      
    } catch (error) {
      this.logger.error(`导出向量数据失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 导入向量数据
   * @param {string} fileContent - 文件内容（JSON字符串）
   * @param {string} targetChatId - 目标聊天ID
   * @returns {Promise<Object>} 创建的导入任务
   */
  async importVectorData(fileContent, targetChatId) {
    try {
      this.logger.log(`开始导入向量数据到聊天: ${targetChatId}`);
      
      // 1. 解析导入数据
      const importData = JSON.parse(fileContent);
      
      // 2. 验证格式
      if (!this.validateImportFormat(importData)) {
        throw new Error('无效的导入文件格式');
      }
      
      // 3. 创建导入任务
      const importedTask = {
        taskId: `task_imp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        type: "imported",
        name: `导入：${importData.source.taskName}`,
        enabled: true,
        timestamp: Date.now(),
        importInfo: {
          originalChatId: importData.source.chatId,
          originalTaskId: importData.source.taskId,
          originalTaskName: importData.source.taskName,
          importDate: new Date().toISOString(),
          itemCount: importData.vectorData.itemCount,
          version: importData.version
        },
        chunkSize: importData.settings?.chunkSize,
        overlapPercent: importData.settings?.overlapPercent,
        tagRules: importData.settings?.tagRules || []
      };
      
      // 4. 保存任务到目标聊天
      const tasks = this.getChatTasks(targetChatId);
      tasks.push(importedTask);
      this.saveChatTasks(targetChatId, tasks);
      
      // 5. 导入向量数据（不进行去重）
      const newCollectionId = `${targetChatId}_${importedTask.taskId}`;
      this.logger.log(`创建新集合: ${newCollectionId}`);
      
      // 准备导入的数据项
      const itemsToInsert = importData.vectorData.items.map(item => ({
        hash: item.hash,
        text: item.text,
        index: item.metadata?.index,
        metadata: item.metadata
      }));
      
      // 批量插入数据，跳过去重检查
      await this.storageAdapter.insertVectorItems(
        newCollectionId,
        itemsToInsert,
        null,
        { skipDeduplication: true }
      );
      
      this.logger.log(`成功导入 ${itemsToInsert.length} 条向量数据`);
      
      return importedTask;
      
    } catch (error) {
      this.logger.error(`导入向量数据失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取当前向量化引擎的模型信息
   * @returns {string} 模型信息
   */
  getVectorSourceModel() {
    const settings = this.extension_settings?.vectors_enhanced;
    if (!settings) return 'unknown';
    
    const source = settings.source;
    switch (source) {
      case 'openai':
        return settings.openai_model || 'text-embedding-ada-002';
      case 'cohere':
        return settings.cohere_model || 'embed-english-v2.0';
      case 'ollama':
        return settings.ollama_model || 'nomic-embed-text';
      case 'transformers':
        return settings.transformers_model || 'Xenova/all-MiniLM-L6-v2';
      case 'webllm':
        return settings.webllm_model || 'all-MiniLM-L6-v2-q4f16_1';
      case 'local':
        return settings.local_model || 'custom';
      default:
        return 'unknown';
    }
  }

  /**
   * 验证导入文件格式
   * @param {Object} data - 导入的数据
   * @returns {boolean} 是否有效
   */
  validateImportFormat(data) {
    try {
      // 检查必需字段
      if (!data.version || !data.source || !data.vectorData) {
        this.logger.error('缺少必需字段');
        return false;
      }
      
      // 检查版本兼容性
      const majorVersion = parseInt(data.version.split('.')[0]);
      if (majorVersion !== 1) {
        this.logger.error(`不支持的版本: ${data.version}`);
        return false;
      }
      
      // 检查数据结构
      if (!data.source.taskName || !data.vectorData.items || !Array.isArray(data.vectorData.items)) {
        this.logger.error('数据结构无效');
        return false;
      }
      
      // 检查数据项
      if (data.vectorData.items.length === 0) {
        this.logger.error('没有向量数据');
        return false;
      }
      
      // 检查数据项格式
      const validItems = data.vectorData.items.every(item => 
        item.hash !== undefined && 
        item.text !== undefined
      );
      
      if (!validItems) {
        this.logger.error('向量数据项格式无效');
        return false;
      }
      
      // 如果有向量引擎信息，记录警告
      if (data.vectorEngine) {
        const currentSource = this.extension_settings?.vectors_enhanced?.source;
        const currentModel = this.getVectorSourceModel();
        
        if (data.vectorEngine.source !== currentSource || data.vectorEngine.model !== currentModel) {
          this.logger.warn(`向量化引擎不匹配！导出时: ${data.vectorEngine.source}/${data.vectorEngine.model}, 当前: ${currentSource}/${currentModel}`);
        }
      }
      
      return true;
      
    } catch (error) {
      this.logger.error(`验证导入格式时出错: ${error.message}`);
      return false;
    }
  }

  /**
   * 获取集合ID
   * @param {Object} task - 任务对象
   * @param {string} chatId - 聊天ID
   * @returns {string} 集合ID
   */
  getCollectionId(task, chatId) {
    if (task.type === "external") {
      return `${task.sourceChat}_${task.sourceTaskId}`;
    }
    // 普通任务和导入任务都使用当前聊天的集合ID
    return `${chatId}_${task.taskId}`;
  }

  /**
   * 获取聊天任务列表
   * @param {string} chatId - 聊天ID
   * @returns {Array} 任务列表
   */
  getChatTasks(chatId) {
    try {
      const vectorTasks = this.extension_settings?.vectors_enhanced?.vector_tasks || {};
      return vectorTasks[chatId] || [];
    } catch (error) {
      this.logger.error(`获取聊天任务失败: ${chatId}`, error);
      return [];
    }
  }

  /**
   * 保存聊天任务列表
   * @param {string} chatId - 聊天ID
   * @param {Array} tasks - 任务列表
   */
  saveChatTasks(chatId, tasks) {
    try {
      if (!this.extension_settings?.vectors_enhanced) {
        this.extension_settings.vectors_enhanced = {};
      }
      if (!this.extension_settings.vectors_enhanced.vector_tasks) {
        this.extension_settings.vectors_enhanced.vector_tasks = {};
      }

      this.extension_settings.vectors_enhanced.vector_tasks[chatId] = tasks;
      
      // 触发保存
      if (typeof this.saveSettingsDebounced === 'function') {
        this.saveSettingsDebounced();
      }
    } catch (error) {
      this.logger.error(`保存聊天任务失败: ${chatId}`, error);
    }
  }

  /**
   * 生成导出文件名
   * @param {Object} task - 任务对象
   * @param {string} chatName - 聊天名称
   * @returns {string} 文件名
   */
  generateExportFilename(task, chatName = '') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const safeName = (chatName || 'unknown').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
    const taskName = task.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
    return `vector_export_${safeName}_${taskName}_${timestamp}.json`;
  }
}