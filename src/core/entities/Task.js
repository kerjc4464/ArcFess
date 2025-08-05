// 定义任务的数据结构，兼容旧格式
export class Task {
  constructor(data) {
    // 兼容旧格式
    if (typeof data === 'string') {
      // 旧格式：任务ID是字符串
      this.id = data;
      this.legacy = true;
    } else {
      // 新格式
      this.id = data.id;
      this.type = data.type;
      this.status = data.status || 'pending';
      this.content = data.content;
      this.metadata = data.metadata || {};
      this.legacy = false;
    }
  }
}
