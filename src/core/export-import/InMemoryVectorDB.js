/**
 * @file InMemoryVectorDB.js
 * @description 浏览器内存中的向量数据库实现
 * @module core/export-import/InMemoryVectorDB
 */

import { Logger } from '../../utils/Logger.js';

/**
 * 内存向量数据库
 * 在浏览器内存中存储和查询向量数据
 */
export class InMemoryVectorDB {
  constructor() {
    this.logger = new Logger('InMemoryVectorDB');
    this.collections = new Map(); // collectionId -> { vectors, metadata, index }
    this.vectorEngine = null; // 向量化引擎实例
  }

  /**
   * 设置向量化引擎
   * @param {Object} engine - 向量化引擎实例
   */
  setVectorEngine(engine) {
    this.vectorEngine = engine;
  }

  /**
   * 创建集合
   * @param {string} collectionId - 集合ID
   * @param {Object} metadata - 集合元数据
   */
  createCollection(collectionId, metadata = {}) {
    if (this.collections.has(collectionId)) {
      this.logger.warn(`Collection ${collectionId} already exists`);
      return;
    }

    this.collections.set(collectionId, {
      vectors: [],
      metadata: metadata,
      index: new Map() // hash -> index
    });

    this.logger.log(`Created collection: ${collectionId}`);
  }

  /**
   * 从导入的数据创建集合
   * @param {string} collectionId - 集合ID
   * @param {Object} importData - 导入的数据
   * @param {boolean} precomputed - 是否包含预计算的向量
   */
  async createFromImport(collectionId, importData, precomputed = false) {
    this.createCollection(collectionId, importData.metadata);
    
    const collection = this.collections.get(collectionId);
    
    for (const item of importData.items) {
      if (precomputed && item.embedding) {
        // 使用预计算的向量
        collection.vectors.push({
          hash: item.hash,
          text: item.text,
          embedding: item.embedding,
          metadata: item.metadata
        });
      } else {
        // 需要重新向量化
        if (!this.vectorEngine) {
          throw new Error('Vector engine not set');
        }
        
        const embedding = await this.vectorEngine.embed(item.text);
        collection.vectors.push({
          hash: item.hash,
          text: item.text,
          embedding: embedding,
          metadata: item.metadata
        });
      }
      
      collection.index.set(item.hash, collection.vectors.length - 1);
    }
    
    this.logger.log(`Imported ${collection.vectors.length} vectors into ${collectionId}`);
  }

  /**
   * 查询集合
   * @param {string} collectionId - 集合ID
   * @param {string} queryText - 查询文本
   * @param {number} topK - 返回结果数
   * @param {number} threshold - 相似度阈值
   * @returns {Promise<Array>} 查询结果
   */
  async query(collectionId, queryText, topK = 10, threshold = 0.5) {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection ${collectionId} not found`);
    }

    if (!this.vectorEngine) {
      throw new Error('Vector engine not set');
    }

    // 向量化查询文本
    const queryEmbedding = await this.vectorEngine.embed(queryText);
    
    // 计算相似度
    const results = [];
    for (const vector of collection.vectors) {
      const similarity = this.cosineSimilarity(queryEmbedding, vector.embedding);
      if (similarity >= threshold) {
        results.push({
          hash: vector.hash,
          text: vector.text,
          score: similarity,
          metadata: vector.metadata
        });
      }
    }
    
    // 排序并返回前K个结果
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * 计算余弦相似度
   * @param {number[]} vec1 - 向量1
   * @param {number[]} vec2 - 向量2
   * @returns {number} 相似度分数
   */
  cosineSimilarity(vec1, vec2) {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have the same dimension');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (norm1 * norm2);
  }

  /**
   * 删除集合
   * @param {string} collectionId - 集合ID
   */
  deleteCollection(collectionId) {
    if (this.collections.delete(collectionId)) {
      this.logger.log(`Deleted collection: ${collectionId}`);
    }
  }

  /**
   * 获取集合统计信息
   * @param {string} collectionId - 集合ID
   * @returns {Object} 统计信息
   */
  getCollectionStats(collectionId) {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      return { exists: false, count: 0 };
    }

    return {
      exists: true,
      count: collection.vectors.length,
      metadata: collection.metadata
    };
  }

  /**
   * 导出集合数据
   * @param {string} collectionId - 集合ID
   * @param {boolean} includeEmbeddings - 是否包含向量嵌入
   * @returns {Object} 导出的数据
   */
  exportCollection(collectionId, includeEmbeddings = false) {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection ${collectionId} not found`);
    }

    const items = collection.vectors.map(vector => {
      const item = {
        hash: vector.hash,
        text: vector.text,
        metadata: vector.metadata
      };
      
      if (includeEmbeddings) {
        item.embedding = vector.embedding;
      }
      
      return item;
    });

    return {
      collectionId: collectionId,
      metadata: collection.metadata,
      items: items,
      hasEmbeddings: includeEmbeddings
    };
  }

  /**
   * 获取内存使用估算
   * @returns {Object} 内存使用信息
   */
  getMemoryUsage() {
    let totalVectors = 0;
    let totalDimensions = 0;
    
    for (const [id, collection] of this.collections) {
      totalVectors += collection.vectors.length;
      if (collection.vectors.length > 0) {
        totalDimensions += collection.vectors[0].embedding?.length || 0;
      }
    }
    
    // 粗略估算：每个浮点数4字节
    const embeddingMemory = totalVectors * totalDimensions * 4;
    const estimatedTotalMemory = embeddingMemory * 1.5; // 加上文本和元数据
    
    return {
      collections: this.collections.size,
      totalVectors: totalVectors,
      estimatedMemoryMB: Math.round(estimatedTotalMemory / 1024 / 1024)
    };
  }
}