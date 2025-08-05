/**
 * @file HybridVectorManager.js
 * @description 混合向量管理器 - 结合本地缓存和服务器查询
 * @module core/export-import/HybridVectorManager
 */

import { Logger } from '../../utils/Logger.js';
import { InMemoryVectorDB } from './InMemoryVectorDB.js';
import { VectorCacheManager } from './VectorCacheManager.js';

/**
 * 混合向量管理器
 * 智能管理本地和远程向量数据
 */
export class HybridVectorManager {
  constructor(dependencies = {}) {
    this.logger = new Logger('HybridVectorManager');
    this.storageAdapter = dependencies.storageAdapter;
    this.memoryDB = new InMemoryVectorDB();
    this.cacheManager = new VectorCacheManager();
    this.loadedCollections = new Set();
  }

  /**
   * 初始化管理器
   */
  async initialize() {
    await this.cacheManager.initialize();
    this.logger.log('Hybrid vector manager initialized');
  }

  /**
   * 加载集合到内存
   * @param {string} collectionId - 集合ID
   * @param {Object} options - 加载选项
   */
  async loadCollection(collectionId, options = {}) {
    if (this.loadedCollections.has(collectionId)) {
      this.logger.log(`Collection ${collectionId} already loaded`);
      return;
    }

    try {
      // 先尝试从本地缓存加载
      const cachedData = await this.cacheManager.getVectorData(collectionId);
      if (cachedData) {
        this.logger.log(`Loading collection from cache: ${collectionId}`);
        await this.memoryDB.createFromImport(
          collectionId, 
          cachedData.vectorData,
          cachedData.hasEmbeddings
        );
        this.loadedCollections.add(collectionId);
        return;
      }

      // 如果没有缓存，从服务器加载
      if (this.storageAdapter) {
        this.logger.log(`Loading collection from server: ${collectionId}`);
        const serverData = await this.storageAdapter.getAllVectorData(collectionId);
        
        if (serverData && serverData.length > 0) {
          await this.memoryDB.createFromImport(collectionId, {
            items: serverData,
            metadata: { source: 'server' }
          }, false);
          
          // 保存到缓存
          if (options.cache) {
            await this.cacheManager.saveVectorData(
              collectionId,
              collectionId,
              this.memoryDB.exportCollection(collectionId, true),
              { cached: Date.now() }
            );
          }
          
          this.loadedCollections.add(collectionId);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to load collection ${collectionId}:`, error);
      throw error;
    }
  }

  /**
   * 混合查询 - 同时查询本地和服务器
   * @param {string} collectionId - 集合ID
   * @param {string} queryText - 查询文本
   * @param {Object} options - 查询选项
   */
  async hybridQuery(collectionId, queryText, options = {}) {
    const results = {
      local: [],
      server: [],
      combined: []
    };

    // 本地查询
    if (this.loadedCollections.has(collectionId)) {
      try {
        results.local = await this.memoryDB.query(
          collectionId,
          queryText,
          options.topK || 10,
          options.threshold || 0.5
        );
        this.logger.log(`Local query returned ${results.local.length} results`);
      } catch (error) {
        this.logger.error('Local query failed:', error);
      }
    }

    // 服务器查询
    if (this.storageAdapter && options.includeServer !== false) {
      try {
        const serverResult = await this.storageAdapter.queryCollection(
          collectionId,
          queryText,
          options.topK || 10,
          options.threshold || 0.5
        );
        
        if (serverResult && serverResult.items) {
          results.server = serverResult.items;
          this.logger.log(`Server query returned ${results.server.length} results`);
        }
      } catch (error) {
        this.logger.error('Server query failed:', error);
      }
    }

    // 合并结果
    results.combined = this.mergeResults(results.local, results.server, options.topK || 10);
    
    return results;
  }

  /**
   * 合并本地和服务器查询结果
   * @param {Array} localResults - 本地查询结果
   * @param {Array} serverResults - 服务器查询结果
   * @param {number} topK - 返回结果数
   */
  mergeResults(localResults, serverResults, topK) {
    const merged = new Map();
    
    // 添加本地结果
    for (const result of localResults) {
      merged.set(result.hash, {
        ...result,
        source: 'local'
      });
    }
    
    // 添加服务器结果（避免重复）
    for (const result of serverResults) {
      const hash = result.hash || result.index;
      if (!merged.has(hash)) {
        merged.set(hash, {
          ...result,
          source: 'server'
        });
      }
    }
    
    // 排序并返回前K个
    const allResults = Array.from(merged.values());
    allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
    
    return allResults.slice(0, topK);
  }

  /**
   * 预加载常用集合
   * @param {Array<string>} collectionIds - 集合ID列表
   */
  async preloadCollections(collectionIds) {
    const promises = collectionIds.map(id => 
      this.loadCollection(id, { cache: true }).catch(err => {
        this.logger.error(`Failed to preload ${id}:`, err);
      })
    );
    
    await Promise.all(promises);
    this.logger.log(`Preloaded ${this.loadedCollections.size} collections`);
  }

  /**
   * 获取管理器状态
   */
  getStatus() {
    const memoryUsage = this.memoryDB.getMemoryUsage();
    
    return {
      loadedCollections: Array.from(this.loadedCollections),
      memoryUsage: memoryUsage,
      cacheAvailable: true,
      serverAvailable: !!this.storageAdapter
    };
  }

  /**
   * 清理内存
   * @param {string} collectionId - 要清理的集合ID，不提供则清理所有
   */
  async cleanup(collectionId = null) {
    if (collectionId) {
      this.memoryDB.deleteCollection(collectionId);
      this.loadedCollections.delete(collectionId);
      this.logger.log(`Cleaned up collection: ${collectionId}`);
    } else {
      for (const id of this.loadedCollections) {
        this.memoryDB.deleteCollection(id);
      }
      this.loadedCollections.clear();
      this.logger.log('Cleaned up all collections');
    }
  }
}