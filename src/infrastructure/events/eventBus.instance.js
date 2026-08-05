/**
 * @fileoverview EventBus 单例实例——插件全局唯一的事件中枢。
 *
 * 使用方式:
 *   - 发布方: import { eventBus } from '...'; eventBus.emit('task:done', data);
 *   - 订阅方: import { eventBus } from '...'; eventBus.on('task:done', callback);
 *
 * 为什么是单例:
 *   - 插件内所有模块（UI、Core、Infrastructure）共享同一个事件命名空间
 *   - 避免多个 EventBus 实例导致的跨实例事件丢失
 *   - 统一的调试入口——所有事件流经同一个实例，方便日志/审计
 *
 * 生命周期:
 *   - 创建: 随模块首次被 import 时实例化（ES Module 的静态加载保证单次执行）
 *   - 销毁: 无需手动清理——页面卸载时随全局作用域销毁
 *
 * 注意:
 *   EventBus 实例本身不区分"系统事件"和"UI 事件"，所有事件混在同一个命名空间。
 *   建议使用 `:` 分隔的命名空间前缀以避免事件名冲突:
 *     - `vector:before` / `vector:done` — 向量化事件
 *     - `task:changed` / `task:error` — 任务状态事件
 *     - `ui:refresh` / `ui:notify` — UI 更新事件
 *     - `storage:sync` — 存储同步事件
 */
import { EventBus } from './EventBus.js';

/** @type {EventBus} 插件全局唯一的事件总线实例 */
export const eventBus = new EventBus();
