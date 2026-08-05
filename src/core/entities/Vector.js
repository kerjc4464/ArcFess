/**
 * @fileoverview 向量实体定义
 *
 * @typedef {Object} VectorMetadata
 * @property {string} [source] - 来源标识（如 chat、file、world_info）
 * @property {string} [tag] - 记忆标签
 * @property {string} [collectionId] - 所属集合ID
 * @property {number} [timestamp] - 原始时间戳
 */

/**
 * 向量数据结构——封装一条高维嵌入向量及其关联的原始内容引用。
 *
 * 职责:
 *   - 存储 embedding（浮点数组），用于相似度检索
 *   - 关联 contentId 指向原始内容实体，形成"向量 → 原始文本"的双向链路
 *   - 携带 metadata 实现可扩展的属性存储（标签、来源、时间戳等）
 *   - 自动记录创建时间 createdAt 用于排序和过期判断
 *
 * 与 Content 实体的关系:
 *   - Content 存储原始文本及类型（chat/file/world）
 *   - Vector 存储对应文本的嵌入向量
 *   - 通过 contentId 实现 1:1 或 N:1 的关联
 *
 * @class Vector
 */
export class Vector {
  /**
   * 创建一个向量实例。
   *
   * @param {string} id - 向量的唯一标识符（通常由后端数据库生成）
   * @param {string} contentId - 关联的 Content 实体的ID，用于追溯原始文本
   * @param {number[]} embedding - 高维嵌入向量（浮点数组，维度由模型决定）
   * @param {VectorMetadata} [metadata={}] - 可选的元数据字典
   */
  constructor(id, contentId, embedding, metadata = {}) {
    this.id = id;
    this.contentId = contentId;
    this.embedding = embedding;
    this.metadata = metadata;
    this.createdAt = new Date();
  }
}
