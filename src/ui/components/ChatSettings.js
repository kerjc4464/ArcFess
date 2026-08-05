/**
 * @fileoverview Chat 设置 UI 更新——动态同步聊天消息范围选择器的最大值。
 *
 * 当用户切换角色或聊天消息数量变化时，此函数被调用以更新
 * "起始消息"和"结束消息"两个滑块/输入框的 max 属性。
 *
 * DOM 依赖:
 *   - #vectors_enhanced_chat_start — 起始消息选择器
 *   - #vectors_enhanced_chat_end   — 结束消息选择器
 *
 * 调用时机:
 *   - 聊天切换后（chat change 事件）
 *   - 消息发送/接收后（message 事件）
 *   - 插件初始化时
 */

import { getContext } from '../../../../../../extensions.js';

/**
 * 根据当前聊天消息数量更新消息范围滑块的最大值。
 *
 * 读取 SillyTavern 全局上下文中的 chat.length 并设为选择器的 max 属性，
 * 确保用户无法选择超出实际消息数量的索引。
 */
export function updateChatSettings() {
    const context = getContext();
    const chat_len = context.chat.length;
    $('#vectors_enhanced_chat_start').attr('max', chat_len);
    $('#vectors_enhanced_chat_end').attr('max', chat_len);
}
