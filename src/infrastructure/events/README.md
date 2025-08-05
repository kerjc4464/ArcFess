# 事件系统目录

本目录包含事件总线和相关事件处理机制的实现。

## 计划组件

- `EventBus.js` - 中央事件总线实现
- `events/` - 事件类型定义目录
  - `VectorEvents.js` - 向量相关事件
  - `TaskEvents.js` - 任务相关事件
  - `UIEvents.js` - UI相关事件

## 设计原则

1. **松耦合** - 通过事件实现组件间的松耦合通信
2. **类型安全** - 明确定义所有事件类型
3. **可追踪** - 支持事件日志和调试
4. **高性能** - 高效的事件分发机制
5. **错误隔离** - 一个监听器的错误不应影响其他监听器

## 使用示例

```javascript
// 订阅事件
eventBus.on('vector:created', (event) => {
  console.log('向量已创建:', event.data);
});

// 发布事件
eventBus.emit('vector:created', {
  vectorId: '123',
  content: 'example text'
});
