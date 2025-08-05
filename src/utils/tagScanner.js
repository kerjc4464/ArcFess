import { isValidTagName } from './contentFilter.js';

/**
 * Efficiently scans large text for available tags with performance optimization
 * @param {string} text Large text content to scan (can be hundreds of thousands of characters)
 * @param {object} options Scanning options
 * @param {number} options.chunkSize Size of text chunks to process (default: 50000)
 * @param {number} options.maxTags Maximum number of unique tags to find (default: 100)
 * @param {number} options.timeoutMs Maximum processing time in milliseconds (default: 5000)
 * @returns {Promise<object>} Object containing found tags and performance stats
 */
export async function scanTextForTags(text, options = {}) {
    const startTime = performance.now();
    const {
        chunkSize = 50000,
        maxTags = 100,
        timeoutMs = 5000
    } = options;

    const foundTags = new Set();
    // This regex is designed to find all valid tag names, including nested ones.
    // It captures the tag name from both start tags (<tag>) and end tags (</tag>).
    const tagRegex = /<(?:\/|)([a-zA-Z0-9_-]+)(?:[^>]*)>|\{([a-zA-Z0-9_-]+)(?:\||})/g;

    let processedChars = 0;
    let chunkCount = 0;

    for (let i = 0; i < text.length; i += chunkSize) {
        const chunk = text.slice(i, Math.min(i + chunkSize, text.length));
        chunkCount++;
        processedChars += chunk.length;

        if (performance.now() - startTime > timeoutMs) {
            console.warn(`Tag scanning timed out after ${timeoutMs}ms`);
            break;
        }

        let match;
        while ((match = tagRegex.exec(chunk)) !== null && foundTags.size < maxTags) {
            // match[1] is for <tag>, match[2] is for {tag}
            const tagName = (match[1] || match[2]).toLowerCase();
            if (isValidTagName(tagName)) {
                foundTags.add(tagName);
            }
        }

        if (foundTags.size >= maxTags) break;

        if (chunkCount % 5 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    const endTime = performance.now();
    const processingTime = endTime - startTime;

    const result = {
        tags: Array.from(foundTags).sort(),
        stats: {
            processingTimeMs: Math.round(processingTime),
            processedChars,
            totalChars: text.length,
            chunkCount,
            tagsFound: foundTags.size
        }
    };

    console.debug('Tag scanning completed:', result.stats);
    return result;
}

/**
 * Generates tag suggestions based on scanned content
 * @param {object} scanResult Result from scanTextForTags
 * @param {number} limit Maximum number of suggestions (default: 20)
 * @returns {object} Object with suggestions array and detailed stats
 */
export function generateTagSuggestions(scanResult, limit = 25) {
    const suggestions = scanResult.tags.slice(0, limit);

    console.debug('标签建议结果:', {
        总发现: scanResult.stats.tagsFound,
        最终建议: suggestions.length,
        建议列表: suggestions
    });

    return {
        suggestions: suggestions,
        stats: {
            totalFound: scanResult.stats.tagsFound,
            finalCount: suggestions.length
        }
    };
}
