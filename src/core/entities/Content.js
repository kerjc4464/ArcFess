/**
 * @fileoverview 内容实体定义——表示一段待向量化或已向量化的原始文本。
 *
 * 内容类型（type）决定提取器和加工策略:
 *   - 'chat'    → ChatExtractor 提取聊天消息文本
 *   - 'file'    → FileExtractor 提取文件内容
 *   - 'world'   → WorldInfoExtractor 提取世界书/世界信息条目
 *
 * @typedef {Object} ContentMetadata
 * @property {string} [fileName] - 文件名（type='file' 时）
 * @property {string} [characterName] - 角色名（type='chat' 时）
 * @property {string} [worldInfoName] - 世界书条目名（type='world' 时）
 * @property {number} [messageIndex] - 消息序号（type='chat' 时）
 * @property {string} [tag] - 自动或手动附加的标签
 */

/**
 * 内容数据结构——封装一段原始文本及其类型标识和元数据。
 *
 * 职责:
 *   - 存储原始文本（text），作为向量化的输入来源
 *   - 标记类型（type），路由到对应的内容提取器（IContentExtractor）
 *   - 携带元数据（metadata），存储来源上下文信息
 *   - 自动记录创建时间（createdAt）
 *
 * 生命周期:
 *   1. 创建 → 由 UI 或系统从聊天/文件/世界书中提取
 *   2. 向量化 → 通过 ContentExtractor → VectorizationProcessor 生成 Vector
 *   3. 存储 → Vector 存入后端数据库，Content 保留用于 re-vectorize
 *
 * @class Content
 */
export class Content {
  /**
   * 创建一个内容实体。
   *
   * @param {string} id - 内容的唯一标识符
   * @param {'chat'|'file'|'world'} type - 内容类型，决定后续处理策略和提取器选择
   * @param {string} text - 原始文本内容
   * @param {ContentMetadata} [metadata={}] - 可选的元数据字典（来源、角色、标签等）
   */
  constructor(id, type, text, metadata = {}) {
    this.id = id;
    this.type = type; // 'chat', 'file', 'world'
    this.text = text;
    this.metadata = metadata;
    this.createdAt = new Date();
  }
}
