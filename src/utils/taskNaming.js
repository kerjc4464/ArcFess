/**
 * Task naming utility module
 * Provides intelligent task name generation based on content patterns
 */

/**
 * Generates smart task names based on content and settings
 */
export class TaskNameGenerator {
    /**
     * Generate a smart task name based on items and settings
     * @param {Array} items - Array of items (chat messages, files, etc.)
     * @param {Object} settings - Current settings including tag filters
     * @returns {string} Generated task name
     */
    static generateSmartName(items, settings) {
        if (!items || items.length === 0) {
            return '空任务';
        }

        // Count different types
        const chatItems = items.filter(item => item.type === 'chat');
        const fileItems = items.filter(item => item.type === 'file');
        const worldInfoItems = items.filter(item => item.type === 'world_info');
        
        const components = [];
        
        // Count sources
        const sourceCount = [
            chatItems.length > 0,
            fileItems.length > 0,
            worldInfoItems.length > 0
        ].filter(Boolean).length;
        
        // When only one source type
        if (sourceCount === 1) {
            if (chatItems.length > 0) {
                const range = this._getMergedRange(chatItems);
                components.push(`楼层 #${range}`);
                components.push(`${chatItems.length}条`);
            } else if (worldInfoItems.length > 0) {
                components.push(`世界书 ${worldInfoItems.length}条目`);
            } else if (fileItems.length > 0) {
                components.push(`文件 ${fileItems.length}个`);
            }
        } else if (sourceCount > 1) {
            // Multiple sources - show all counts in order: chat, world_info, files
            if (chatItems.length > 0) {
                components.push(`${chatItems.length}层楼`);
            }
            if (worldInfoItems.length > 0) {
                components.push(`${worldInfoItems.length}条世界书`);
            }
            if (fileItems.length > 0) {
                components.push(`${fileItems.length}个文件`);
            }
        }
        
        return components.join(' ');
    }


    /**
     * Get merged range string for indices (adjacent numbers are merged)
     * @private
     */
    static _getMergedRange(chatItems) {
        if (!chatItems || chatItems.length === 0) return '';
        
        const indices = chatItems
            .map(item => item.metadata?.index)
            .filter(index => index !== undefined)
            .sort((a, b) => a - b);
        
        if (indices.length === 0) return '';
        
        // Merge adjacent indices
        const segments = this._identifyContinuousSegments(indices);
        
        if (segments.length === 1) {
            return segments[0];
        } else if (segments.length <= 3) {
            return segments.join(', ');
        } else {
            // If too many segments, show first, second and last
            return `${segments[0]}, ${segments[1]}...${segments[segments.length - 1]}`;
        }
    }

    /**
     * Format segment (single number or range)
     * @private  
     */
    static _formatSegment(start, end) {
        if (start === end) {
            return `${start}`;
        }
        return `${start}-${end}`;
    }


    /**
     * Identify continuous segments in indices
     * @private
     */
    static _identifyContinuousSegments(indices) {
        if (indices.length === 0) return [];
        
        const segments = [];
        let segmentStart = indices[0];
        let segmentEnd = indices[0];
        
        for (let i = 1; i < indices.length; i++) {
            if (indices[i] === segmentEnd + 1) {
                // Continue current segment
                segmentEnd = indices[i];
            } else {
                // End current segment and start new one
                segments.push(this._formatSegment(segmentStart, segmentEnd));
                segmentStart = indices[i];
                segmentEnd = indices[i];
            }
        }
        
        // Add the last segment
        segments.push(this._formatSegment(segmentStart, segmentEnd));
        
        return segments;
    }

}