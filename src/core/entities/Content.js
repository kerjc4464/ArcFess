// 定义内容的数据结构
export class Content {
  constructor(id, type, text, metadata = {}) {
    this.id = id;
    this.type = type; // 'chat', 'file', 'world'
    this.text = text;
    this.metadata = metadata;
    this.createdAt = new Date();
  }
}
