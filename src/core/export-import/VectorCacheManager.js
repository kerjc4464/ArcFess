/**
 * @file VectorCacheManager.js
 * @description 本地向量数据缓存管理器，使用 IndexedDB 存储向量数据
 * @module core/export-import/VectorCacheManager
 */

import { Logger } from '../../utils/Logger.js';

/**
 * 向量缓存管理器
 * 使用 IndexedDB 在浏览器本地存储向量数据
 */
export class VectorCacheManager {
  constructor() {
    this.dbName = 'VectorsEnhancedCache';
    this.dbVersion = 1;
    this.storeName = 'vectorData';
    this.db = null;
    this.logger = new Logger('VectorCacheManager');
  }

  /**
   * 初始化数据库
   */
  async initialize() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => {
        this.logger.error('Failed to open IndexedDB');
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        this.logger.log('IndexedDB initialized');
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('collectionId', 'collectionId', { unique: false });
          store.createIndex('taskId', 'taskId', { unique: false });
          this.logger.log('Object store created');
        }
      };
    });
  }

  /**
   * 保存向量数据到本地缓存
   * @param {string} taskId - 任务ID
   * @param {string} collectionId - 集合ID
   * @param {Array} vectorData - 向量数据
   * @param {Object} metadata - 元数据
   */
  async saveVectorData(taskId, collectionId, vectorData, metadata) {
    if (!this.db) await this.initialize();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      const data = {
        id: `${collectionId}_cache`,
        taskId: taskId,
        collectionId: collectionId,
        vectorData: vectorData,
        metadata: metadata,
        timestamp: Date.now()
      };
      
      const request = store.put(data);
      
      request.onsuccess = () => {
        this.logger.log(`Saved vector data for task ${taskId}`);
        resolve();
      };
      
      request.onerror = () => {
        this.logger.error('Failed to save vector data');
        reject(request.error);
      };
    });
  }

  /**
   * 获取缓存的向量数据
   * @param {string} collectionId - 集合ID
   * @returns {Promise<Object|null>} 缓存的数据
   */
  async getVectorData(collectionId) {
    if (!this.db) await this.initialize();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(`${collectionId}_cache`);
      
      request.onsuccess = () => {
        if (request.result) {
          this.logger.log(`Retrieved cached vector data for ${collectionId}`);
          resolve(request.result);
        } else {
          resolve(null);
        }
      };
      
      request.onerror = () => {
        this.logger.error('Failed to retrieve vector data');
        reject(request.error);
      };
    });
  }

  /**
   * 删除缓存的向量数据
   * @param {string} collectionId - 集合ID
   */
  async deleteVectorData(collectionId) {
    if (!this.db) await this.initialize();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(`${collectionId}_cache`);
      
      request.onsuccess = () => {
        this.logger.log(`Deleted cached vector data for ${collectionId}`);
        resolve();
      };
      
      request.onerror = () => {
        this.logger.error('Failed to delete vector data');
        reject(request.error);
      };
    });
  }

  /**
   * 获取所有缓存的任务
   * @returns {Promise<Array>} 缓存的任务列表
   */
  async getAllCachedTasks() {
    if (!this.db) await this.initialize();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      
      request.onsuccess = () => {
        resolve(request.result || []);
      };
      
      request.onerror = () => {
        this.logger.error('Failed to get all cached tasks');
        reject(request.error);
      };
    });
  }

  /**
   * 清空所有缓存
   */
  async clearAllCache() {
    if (!this.db) await this.initialize();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();
      
      request.onsuccess = () => {
        this.logger.log('Cleared all cached vector data');
        resolve();
      };
      
      request.onerror = () => {
        this.logger.error('Failed to clear cache');
        reject(request.error);
      };
    });
  }

  /**
   * 导出缓存数据为文件
   * @param {string} taskId - 任务ID
   * @returns {Promise<Blob>} 导出的文件数据
   */
  async exportCacheToFile(taskId) {
    const data = await this.getVectorData(taskId);
    if (!data) {
      throw new Error('No cached data found for task');
    }
    
    const exportData = {
      version: '2.0',
      type: 'vector_cache',
      exportDate: new Date().toISOString(),
      data: data
    };
    
    const json = JSON.stringify(exportData, null, 2);
    return new Blob([json], { type: 'application/json' });
  }

  /**
   * 从文件导入缓存数据
   * @param {File} file - 导入的文件
   * @returns {Promise<Object>} 导入的数据
   */
  async importCacheFromFile(file) {
    const text = await file.text();
    const importData = JSON.parse(text);
    
    if (importData.type !== 'vector_cache' || !importData.data) {
      throw new Error('Invalid cache file format');
    }
    
    await this.saveVectorData(
      importData.data.taskId,
      importData.data.collectionId,
      importData.data.vectorData,
      importData.data.metadata
    );
    
    return importData.data;
  }
}