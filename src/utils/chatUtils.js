/**
 * @file chatUtils.js
 * @description 聊天消息工具函数，提供统一的消息过滤和处理功能
 * @module utils/chatUtils
 */

import { Logger } from './Logger.js';
import { substituteParams } from '../../../../../../script.js';

const logger = new Logger('chatUtils');

/**
 * 获取过滤后的消息列表
 * @param {Array} chat 聊天消息数组
 * @param {Object} options 过滤选项
 * @param {boolean} options.includeHidden 是否包含隐藏消息（is_system === true）
 * @param {Object} options.types 消息类型过滤 { user: boolean, assistant: boolean }
 * @param {Object} options.range 消息范围 { start: number, end: number }
 * @param {Array} options.newRanges 多个消息范围数组（用于增量更新）
 * @returns {Array} 过滤后的消息数组
 */
export function getMessages(chat, options = {}) {
    if (!chat || !Array.isArray(chat)) {
        if (logger.warn) {
            logger.warn('Invalid chat array provided');
        } else {
            console.warn('[chatUtils] Invalid chat array provided');
        }
        return [];
    }

    const {
        includeHidden = false,
        types = { user: true, assistant: true },
        range = null,
        newRanges = null
    } = options;

    let messages = [];

    // 处理多个范围（优先）
    if (newRanges && newRanges.length > 0) {
        logger.log(`Processing ${newRanges.length} message ranges`);
        newRanges.forEach(r => {
            const start = r.start;
            const end = r.end === -1 ? undefined : r.end + 1;
            const rangeMessages = chat.slice(start, end);

            rangeMessages.forEach((msg, idx) => {
                const absoluteIndex = start + idx;
                const processedMsg = processMessage(msg, absoluteIndex, { includeHidden, types });
                if (processedMsg) {
                    messages.push(processedMsg);
                }
            });
        });
    }
    // 处理单个范围
    else if (range) {
        const start = range.start || 0;
        const end = range.end === -1 ? undefined : (range.end || 0) + 1;
        const rangeMessages = chat.slice(start, end);

        rangeMessages.forEach((msg, idx) => {
            const absoluteIndex = start + idx;
            const processedMsg = processMessage(msg, absoluteIndex, { includeHidden, types });
            if (processedMsg) {
                messages.push(processedMsg);
            }
        });
    }
    // 处理整个聊天
    else {
        chat.forEach((msg, index) => {
            const processedMsg = processMessage(msg, index, { includeHidden, types });
            if (processedMsg) {
                messages.push(processedMsg);
            }
        });
    }

    logger.log(`Filtered ${messages.length} messages from ${chat.length} total`);
    return messages;
}

/**
 * 处理单个消息
 * @private
 * @param {Object} msg 消息对象
 * @param {number} index 消息索引
 * @param {Object} filters 过滤条件
 * @returns {Object|null} 处理后的消息对象或null（如果被过滤）
 */
function processMessage(msg, index, filters) {
    const { includeHidden, types } = filters;

    // 过滤隐藏消息
    if (msg.is_system === true && !includeHidden) {
        return null;
    }

    // 过滤消息类型
    if (!types.user && msg.is_user === true) {
        return null;
    }
    if (!types.assistant && msg.is_user !== true) {
        return null;
    }

    // 返回处理后的消息对象
    return {
        text: substituteParams(msg.mes),
        index: index,
        is_user: msg.is_user,
        is_system: msg.is_system === true,
        name: msg.name,
        metadata: {
            index: index,
            is_user: msg.is_user,
            name: msg.name,
            is_hidden: msg.is_system === true
        }
    };
}

/**
 * 获取隐藏的消息（is_system === true）
 * @param {Array} chat 聊天消息数组
 * @returns {Array} 隐藏消息数组
 */
export function getHiddenMessages(chat) {
    if (!chat || !Array.isArray(chat)) {
        return [];
    }

    const hiddenMessages = [];
    chat.forEach((msg, index) => {
        if (msg.is_system === true) {
            hiddenMessages.push({
                index: index,
                text: msg.mes ? msg.mes.substring(0, 100) + (msg.mes.length > 100 ? '...' : '') : '',
                is_user: msg.is_user,
                name: msg.name,
            });
        }
    });

    logger.log(`Found ${hiddenMessages.length} hidden messages`);
    return hiddenMessages;
}

/**
 * 统计消息信息
 * @param {Array} chat 聊天消息数组
 * @param {Object} options 统计选项
 * @returns {Object} 统计信息
 */
export function getMessageStats(chat, options = {}) {
    const stats = {
        total: chat?.length || 0,
        hidden: 0,
        visible: 0,
        user: 0,
        assistant: 0
    };

    if (!chat || !Array.isArray(chat)) {
        return stats;
    }

    chat.forEach(msg => {
        if (msg.is_system === true) {
            stats.hidden++;
        } else {
            stats.visible++;
        }

        if (msg.is_user === true) {
            stats.user++;
        } else if (msg.is_system !== true) {
            stats.assistant++;
        }
    });

    return stats;
}

/**
 * 检查消息是否应该被处理（用于向量化等操作）
 * @param {Object} msg 消息对象
 * @param {number} index 消息索引
 * @param {Object} settings 处理设置
 * @returns {boolean} 是否应该处理
 */
export function shouldProcessMessage(msg, index, settings = {}) {
    const {
        includeHidden = false,
        types = { user: true, assistant: true },
        skipFirstFloor = false,
        skipUserFloors = false
    } = settings;

    // 隐藏消息检查
    if (msg.is_system === true && !includeHidden) {
        return false;
    }

    // 消息类型检查
    if (!types.user && msg.is_user === true) {
        return false;
    }
    if (!types.assistant && msg.is_user !== true) {
        return false;
    }

    // 特殊楼层检查（用于标签提取等）
    if (skipFirstFloor && index === 0) {
        return false;
    }
    if (skipUserFloors && msg.is_user === true) {
        return false;
    }

    return true;
}

/**
 * 创建消息的向量化项
 * @param {Object} messageData 从 getMessages 返回的消息数据
 * @param {string} text 处理后的文本（可能经过标签提取）
 * @param {string} [rawText] - 可选的原始文本，用于预览
 * @returns {Object} 向量化项
 */
export function createVectorItem(messageData, text, rawText = null) {
    return {
        type: 'chat',
        text: text,
        rawText: rawText !== null ? rawText : text, // 如果没有提供rawText，则回退到使用处理后的文本
        metadata: messageData.metadata,
        selected: true
    };
}
