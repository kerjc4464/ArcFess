/**
 * FusionManager.js
 * 负责增量向量化的核心逻辑：参数守卫、区间去重、元数据合并
 */
// 修正了引用路径：从 src/core/ 到 src/utils/ 只需要一级 ../
import { getHashValue } from '../utils/hash.js';

export class FusionManager {
    /**
     * 检查新旧任务的兼容性
     * @param {Object} currentSettings 当前UI上的设置
     * @param {Object} targetTask 目标任务对象
     * @returns {Object} { compatible: boolean, warnings: Array }
     */
    static checkCompatibility(currentSettings, targetTask) {
        const warnings = [];
        const oldSettings = targetTask.settings;

        // 1. 致命检查：模型源与名称 (防止维度爆炸)
        if (currentSettings.source !== oldSettings.source) {
            return { compatible: false, fatal: `向量源不匹配: 目标是 ${oldSettings.source}, 当前是 ${currentSettings.source}` };
        }
        
        // 字符串宽松比对，忽略大小写
        const oldModel = (oldSettings.model || '').toLowerCase();
        const curModel = (currentSettings.model || '').toLowerCase();
        // 处理 ollama 模型名可能带 tag 的情况，简单比对
        if (oldModel !== curModel) {
             return { compatible: false, fatal: `模型不匹配: 目标库使用 ${oldSettings.model}, 当前使用 ${currentSettings.model}。维度可能不同，禁止合并。` };
        }

        // 2. 警告检查：切片参数
        if (currentSettings.chunk_size !== oldSettings.chunk_size) {
            warnings.push({ param: 'Chunk Size', old: oldSettings.chunk_size, new: currentSettings.chunk_size });
        }
        if (currentSettings.overlap_percent !== oldSettings.overlap_percent) {
            warnings.push({ param: 'Overlap', old: oldSettings.overlap_percent, new: currentSettings.overlap_percent });
        }

        return { compatible: true, warnings };
    }

    /**
     * 核心去重：过滤掉已经存在于目标任务中的内容
     * @param {Array} items 准备向量化的原始项目
     * @param {Object} targetTask 目标任务
     * @returns {Object} { items: Array, skippedCount: number }
     */
    static filterContent(items, targetTask) {
        const ledger = targetTask.metadata?.processed_chat_ranges || {};
        const fileManifest = targetTask.metadata?.processed_files || [];
        
        const filteredItems = [];
        let skippedCount = 0;

        for (const item of items) {
            // === 策略 A: 文件去重 (基于 URL/文件名) ===
            if (item.type === 'file') {
                const fileId = item.metadata?.url || item.metadata?.name;
                // 如果文件名已经在清单里，跳过
                if (fileManifest.includes(fileId)) {
                    skippedCount++;
                    continue; 
                }
                filteredItems.push(item);
            }
            
            // === 策略 B: 聊天记录去重 (Index Ledger) ===
            else if (item.type === 'chat') {
                const chatId = item.metadata?.chatId;
                // 如果没有记录账本，或者该聊天还没被记录过，直接通过
                if (!chatId || !ledger[chatId]) {
                    filteredItems.push(item);
                    continue;
                }

                // 获取楼层号
                const msgIndex = item.metadata?.originalIndex ?? item.metadata?.index;
                if (msgIndex === undefined) {
                    filteredItems.push(item);
                    continue;
                }

                // 检查该楼层是否在已处理区间内
                // processed_chat_ranges 结构: [[0, 100], [200, 300]]
                const isProcessed = ledger[chatId].some(range => msgIndex >= range[0] && msgIndex <= range[1]);

                if (isProcessed) {
                    skippedCount++;
                } else {
                    filteredItems.push(item);
                }
            } 
            
            // 其他类型 (WI) 暂时直接通过
            else {
                filteredItems.push(item);
            }
        }

        console.log(`[Fusion] 智能过滤: 保留 ${filteredItems.length}, 跳过 ${skippedCount} (重复)`);
        return { items: filteredItems, skippedCount };
    }

    /**
     * 合并任务元数据 (用于更新 settings.json)
     * @param {Object} oldTask 原始任务
     * @param {Object} newTaskData 本次新增的数据统计
     * @param {Array} processedItems 本次实际处理的 items (用于更新账本)
     */
    static mergeTaskMetadata(oldTask, newTaskData, processedItems) {
        const merged = JSON.parse(JSON.stringify(oldTask));

        // 1. 更新基础统计
        merged.itemCount = (merged.itemCount || 0) + newTaskData.itemCount;
        merged.timestamp = Date.now(); // 更新时间
        if (!merged.name.includes('(Fusion)')) {
             merged.name = `${merged.name} (Fusion)`;
        }

        // 2. 初始化 metadata (如果旧任务没有)
        if (!merged.metadata) merged.metadata = {};
        if (!merged.metadata.processed_files) merged.metadata.processed_files = [];
        if (!merged.metadata.processed_chat_ranges) merged.metadata.processed_chat_ranges = {};

        // 3. 更新文件清单
        const newFiles = processedItems
            .filter(i => i.type === 'file')
            .map(i => i.metadata?.url || i.metadata?.name)
            .filter(Boolean);
        
        // 去重合并
        merged.metadata.processed_files = [...new Set([...merged.metadata.processed_files, ...newFiles])];

        // 4. 更新聊天账本 (区间合并算法)
        const chatItems = processedItems.filter(i => i.type === 'chat');
        // 按 ChatID 分组收集本次的所有 index
        const newIndicesMap = {};
        chatItems.forEach(item => {
            // 注意：这里我们假设外部已经注入了 chatId 到 item.metadata
            // 如果 extractor 没注入，可能需要从 context 获取，但在 fusion 逻辑里最好依赖 metadata
            // 在 index.js 的 extractedContent 构建时，最好确保注入了 chatId
            // 这里做一个 fallback: 如果 item 没有 chatId，尝试用当前全局 chatId (但在此时可能不准确，所以依赖 item)
            const cid = item.metadata?.chatId || SillyTavern.getContext().chatId;
            const idx = item.metadata?.originalIndex ?? item.metadata?.index;
            
            if (cid && idx !== undefined) {
                if (!newIndicesMap[cid]) newIndicesMap[cid] = [];
                newIndicesMap[cid].push(idx);
            }
        });

        // 执行合并
        for (const [chatId, indices] of Object.entries(newIndicesMap)) {
            if (indices.length === 0) continue;
            
            // 排序
            const sorted = indices.sort((a, b) => a - b);

            // 将本次离散的点转换为区间 [[1,1], [3,5]]
            const currentBatchRanges = [];
            let start = sorted[0], end = sorted[0];
            for (let i = 1; i < sorted.length; i++) {
                if (sorted[i] === end + 1) {
                    end = sorted[i];
                } else {
                    currentBatchRanges.push([start, end]);
                    start = sorted[i];
                    end = sorted[i];
                }
            }
            currentBatchRanges.push([start, end]);

            // 取出旧区间
            const existingRanges = merged.metadata.processed_chat_ranges[chatId] || [];
            
            // 合并旧区间和新区间
            merged.metadata.processed_chat_ranges[chatId] = this._mergeIntervals([...existingRanges, ...currentBatchRanges]);
        }

        return merged;
    }

    /**
     * 标准区间合并算法
     * @param {Array} intervals [[1,5], [2,6], [8,10]]
     * @returns {Array} [[1,6], [8,10]]
     */
    static _mergeIntervals(intervals) {
        if (!intervals.length) return [];
        // 按 start 排序
        intervals.sort((a, b) => a[0] - b[0]);
        
        const merged = [intervals[0]];
        for (let i = 1; i < intervals.length; i++) {
            const last = merged[merged.length - 1];
            const current = intervals[i];
            
            // 如果重叠或相邻 (current.start <= last.end + 1)，合并
            // 例如 [1,5] 和 [6,10] 也可以合并为 [1,10]
            if (current[0] <= last[1] + 1) {
                last[1] = Math.max(last[1], current[1]);
            } else {
                merged.push(current);
            }
        }
        return merged;
    }
}