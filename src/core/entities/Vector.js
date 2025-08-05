// 定义向量的数据结构
export class Vector {
  constructor(id, contentId, embedding, metadata = {}) {
    this.id = id;
    this.contentId = contentId;
    this.embedding = embedding;
    this.metadata = metadata;
    this.createdAt = new Date();
  }
}
