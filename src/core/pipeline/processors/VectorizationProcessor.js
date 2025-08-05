/**
 * @file VectorizationProcessor.js
 * @description Processor wrapper for vectorization functionality
 * @module core/pipeline/processors/VectorizationProcessor
 */

import { ITextProcessor } from '../ITextProcessor.js';
import { Logger } from '../../../utils/Logger.js';

const logger = new Logger('VectorizationProcessor');

/**
 * Processor that wraps the existing VectorizationAdapter
 * Provides a bridge between the pipeline and legacy vectorization code
 */
export class VectorizationProcessor extends ITextProcessor {
    /**
     * @param {VectorizationAdapter} vectorizationAdapter - Existing vectorization adapter
     */
    constructor(vectorizationAdapter) {
        super();
        
        if (!vectorizationAdapter) {
            throw new Error('VectorizationAdapter is required');
        }
        
        /**
         * Reference to the existing adapter
         * We wrap it instead of modifying it
         */
        this.adapter = vectorizationAdapter;
        
        /**
         * Processor configuration
         */
        this.config = {
            batchSize: 10,
            maxRetries: 3,
            timeout: 30000
        };

        logger.log('VectorizationProcessor initialized');
    }

    /**
     * Get processor type
     * @returns {string} Processor type identifier
     */
    getType() {
        return 'vectorization';
    }

    /**
     * Get processor name
     * @returns {string} Processor display name
     */
    getName() {
        return 'Vectorization Processor';
    }

    /**
     * Process input through vectorization
     * @param {Object} input - Input data
     * @param {string|Array} input.content - Text content to vectorize
     * @param {Object} input.metadata - Additional metadata
     * @param {Object} context - Processing context
     * @returns {Promise<Object>} Processing result
     */
    async process(input, context) {
        const startTime = performance.now();
        
        try {
            logger.log(`Processing content for vectorization (content type: ${typeof input.content})`);
            logger.log(`VectorizationProcessor input content preview:`, {
                isArray: Array.isArray(input.content),
                length: Array.isArray(input.content) ? input.content.length : input.content?.length,
                contentPreview: Array.isArray(input.content) 
                    ? input.content.slice(0, 2).map(item => ({ type: item?.type, hasText: !!item?.text, textLength: item?.text?.length }))
                    : input.content?.substring(0, 100) + '...'
            });

            // Extract necessary data from input and context
            const content = input.content;
            const metadata = input.metadata || {};
            const settings = context.settings || {};
            const vectorizationSettings = context.vectorizationSettings || {};
            
            // Log metadata to track taskType flow
            logger.log('VectorizationProcessor received metadata:', {
                taskType: metadata.taskType,
                source: metadata.source,
                type: metadata.type,
                collectionId: metadata.collectionId,
                allMetadataKeys: Object.keys(metadata)
            });
            
            // Determine vectorization source
            const source = vectorizationSettings.source || metadata.source || settings.source || 'transformers';
            
            // Prepare chunks for vectorization
            const chunks = this.prepareVectorizationChunks(content, metadata, vectorizationSettings);
            
            logger.log(`VectorizationProcessor prepared chunks:`, {
                chunkCount: chunks.length,
                chunks: chunks.map(chunk => ({
                    hasText: !!chunk.text,
                    textLength: chunk.text?.length,
                    textPreview: chunk.text?.substring(0, 50) + '...'
                }))
            });
            
            logger.log(`Vectorizing ${chunks.length} chunks using ${source}`);
            
            // Actually vectorize chunks using the existing adapter
            logger.log(`Calling vectorization adapter for ${chunks.length} chunks`);
            
            // Convert chunks to the format expected by the legacy vectorization
            const vectorItems = chunks.map((chunk, index) => ({
                id: `chunk_${this.generateHash(chunk.text)}`,
                text: chunk.text,
                type: metadata.type || 'pipeline',
                metadata: {
                    ...metadata,
                    ...chunk.metadata,
                    chunk_index: index,
                    chunk_total: chunks.length,
                    pipeline_processed: true
                },
                selected: true
            }));
            
            // Call the actual vectorization adapter
            // VectorizationAdapter.vectorize(items, signal) - only takes 2 parameters
            const vectorizationResult = await this.adapter.vectorize(
                vectorItems,
                context.abortSignal
            );
            
            logger.log(`Vectorization adapter result:`, {
                success: vectorizationResult.success,
                itemCount: vectorizationResult.items?.length || 0
            });
            
            // Convert adapter result to pipeline format - use the actual vectorized results
            const processedChunks = vectorizationResult.items || [];
            
            logger.log(`VectorizationProcessor: Generated ${processedChunks.length} vectorized chunks`);

            // Transform result to pipeline format
            const processingTime = performance.now() - startTime;
            
            return {
                success: true,
                vectorized: processedChunks.length,
                vectors: processedChunks,
                source: source,
                processingTime: processingTime,
                metadata: {
                    ...metadata,
                    itemCount: processedChunks.length,
                    chunkSize: vectorizationSettings.chunk_size || 1000,
                    overlapPercent: vectorizationSettings.overlap_percent || 10
                }
            };

        } catch (error) {
            logger.error(`Vectorization failed: ${error.message}`);
            
            // Add error to context if the method exists
            if (context.addError && typeof context.addError === 'function') {
                context.addError(error, {
                    processor: this.getName(),
                    input: String(input.content).substring(0, 100)
                });
            }

            throw error;
        }
    }

    /**
     * Validate input before processing
     * @param {Object} input - Input to validate
     * @param {Object} context - Processing context
     * @returns {Object} Validation result
     */
    validateInput(input, context) {
        const validation = super.validateInput(input, context);
        if (!validation.valid) {
            return validation;
        }

        // Additional validation specific to vectorization
        if (typeof input.content !== 'string' || input.content.trim().length === 0) {
            return {
                valid: false,
                error: 'Content must be a non-empty string'
            };
        }

        // Check content length
        const maxLength = context.settings?.maxContentLength || 100000;
        if (input.content.length > maxLength) {
            return {
                valid: false,
                error: `Content exceeds maximum length of ${maxLength} characters`
            };
        }

        return { valid: true };
    }

    /**
     * Check if processor can handle the input
     * @param {Object} input - Input to check
     * @param {Object} context - Processing context
     * @returns {boolean} True if can process
     */
    canProcess(input, context) {
        // Check if adapter is available and configured
        if (!this.adapter || typeof this.adapter.vectorize !== 'function') {
            logger.warn('VectorizationAdapter not properly configured');
            return false;
        }

        // Check if we have valid input
        if (!input || !input.content) {
            return false;
        }

        // Check if source is supported
        const source = input.metadata?.source || context.settings?.source;
        if (source && !this.adapter.isSourceAvailable?.(source)) {
            logger.warn(`Vectorization source not available: ${source}`);
            return false;
        }

        return true;
    }

    /**
     * Prepare chunks for vectorization
     * Converts content to chunks using text chunking logic
     * @private
     */
    prepareVectorizationChunks(content, metadata, vectorizationSettings) {
        const chunkSize = vectorizationSettings.chunk_size || 1000;
        const overlapPercent = vectorizationSettings.overlap_percent || 10;
        const forceChunkDelimiter = vectorizationSettings.force_chunk_delimiter;
        
        // Log metadata at the start of prepareVectorizationChunks
        logger.log('prepareVectorizationChunks received metadata:', {
            taskType: metadata.taskType,
            source: metadata.source,
            type: metadata.type,
            extractorType: metadata.extractorType,
            itemCount: metadata.itemCount,
            originalIndex: metadata.originalIndex,
            allKeys: Object.keys(metadata)
        });
        
        // Also log content structure if it's an array
        if (Array.isArray(content) && content.length > 0) {
            logger.log('First item in content array:', {
                type: content[0].type,
                hasMetadata: !!content[0].metadata,
                metadataKeys: content[0].metadata ? Object.keys(content[0].metadata) : [],
                originalIndex: content[0].metadata?.originalIndex
            });
        }
        
        // Check if this is summary vectorization mode
        if (metadata.taskType === 'summary_vectorization' && 
            typeof content === 'string' && 
            content.includes('</history_story>')) {
            logger.log('Using history_story tag-based chunking for summary vectorization');
            logger.log(`Content preview: ${content.substring(0, 200)}...`);
            return this.splitByHistoryStoryTags(content, metadata, chunkSize, overlapPercent);
        }
        
        // Apply type-specific chunking strategies
        if (metadata.type === 'chat' && !Array.isArray(content)) {
            logger.log('Using chat-specific chunking strategy');
            return this.chunkChatMessage(content, metadata, chunkSize, overlapPercent, forceChunkDelimiter);
        }
        
        if (metadata.type === 'world_info' && !Array.isArray(content)) {
            logger.log('Using world_info-specific chunking strategy');
            return this.chunkWorldInfo(content, metadata, chunkSize, overlapPercent, forceChunkDelimiter);
        }
        
        if (metadata.type === 'file' && !Array.isArray(content)) {
            logger.log('Using file-specific (chapter-aware) chunking strategy');
            return this.chunkFileContent(content, metadata, chunkSize, overlapPercent, forceChunkDelimiter);
        }
        
        let chunks = [];
        
        // Handle different content types
        if (Array.isArray(content)) {
            // IMPORTANT: Don't merge array items! Each item should be processed separately
            // This preserves individual item metadata and boundaries
            logger.log(`Processing array content with ${content.length} items`);
            
            for (let i = 0; i < content.length; i++) {
                const item = content[i];
                let itemText = '';
                let itemMetadata = { ...metadata };
                
                // Log the initial itemMetadata (should include taskType from parent metadata)
                logger.log(`Array item ${i} - initial itemMetadata:`, {
                    taskType: itemMetadata.taskType,
                    source: itemMetadata.source,
                    allKeys: Object.keys(itemMetadata)
                });
                
                // Extract text and metadata from each item
                if (typeof item === 'string') {
                    itemText = item;
                } else if (item && typeof item === 'object') {
                    itemText = item.text || item.content || String(item);
                    // Preserve original item metadata but don't override critical fields
                    if (item.metadata) {
                        logger.log(`Array item ${i} has its own metadata, merging...`);
                        logger.log(`Item metadata before merge:`, {
                            originalIndex: item.metadata.originalIndex,
                            index: item.metadata.index,
                            type: item.metadata.type
                        });
                        // Keep taskType from parent metadata if it exists
                        const preservedTaskType = itemMetadata.taskType;
                        itemMetadata = { ...itemMetadata, ...item.metadata };
                        if (preservedTaskType) {
                            itemMetadata.taskType = preservedTaskType;
                        }
                        logger.log(`Item metadata after merge:`, {
                            originalIndex: itemMetadata.originalIndex,
                            index: itemMetadata.index,
                            type: itemMetadata.type
                        });
                    }
                    if (item.id) itemMetadata.originalId = item.id;
                    if (item.type) itemMetadata.originalType = item.type;
                    if (item.index !== undefined) itemMetadata.originalIndex = item.index;
                } else {
                    itemText = String(item);
                }
                
                // Log the final itemMetadata after merging
                logger.log(`Array item ${i} - final itemMetadata:`, {
                    taskType: itemMetadata.taskType,
                    source: itemMetadata.source,
                    originalType: itemMetadata.originalType,
                    allKeys: Object.keys(itemMetadata)
                });
                
                // Skip empty items
                if (!itemText.trim()) {
                    logger.log(`Skipping empty item at index ${i}`);
                    continue;
                }
                
                // Debug: Log item metadata for summary vectorization
                if (itemMetadata.taskType === 'summary_vectorization') {
                    logger.log(`[DEBUG] Summary vectorization item ${i}:`, {
                        taskType: itemMetadata.taskType,
                        hasHistoryStoryTag: itemText.includes('</history_story>'),
                        textLength: itemText.length,
                        textPreview: itemText.substring(0, 300)
                    });
                }
                
                // Check if this is summary vectorization mode with history_story tags
                if (itemMetadata.taskType === 'summary_vectorization' && 
                    itemText.includes('</history_story>')) {
                    logger.log(`Using history_story tag-based chunking for array item ${i}`);
                    logger.log(`Item preview: ${itemText.substring(0, 200)}...`);
                    const tagChunks = this.splitByHistoryStoryTags(itemText, itemMetadata, chunkSize, overlapPercent);
                    chunks.push(...tagChunks);
                    continue;
                } else if (itemMetadata.taskType === 'summary_vectorization') {
                    logger.warn(`[WARNING] Summary vectorization item ${i} does not contain history_story tags!`);
                }
                
                // Apply type-specific chunking for array items
                if (itemMetadata.type === 'chat') {
                    const chatChunks = this.chunkChatMessage(itemText, itemMetadata, chunkSize, overlapPercent, forceChunkDelimiter);
                    chunks.push(...chatChunks);
                } else if (itemMetadata.type === 'world_info') {
                    const wiChunks = this.chunkWorldInfo(itemText, itemMetadata, chunkSize, overlapPercent, forceChunkDelimiter);
                    chunks.push(...wiChunks);
                } else if (itemMetadata.type === 'file') {
                    // Use chapter-aware chunking for files (which might be novels)
                    logger.log(`Processing file with metadata:`, {
                        name: itemMetadata.name,
                        originalIndex: itemMetadata.originalIndex,
                        type: itemMetadata.type,
                        allKeys: Object.keys(itemMetadata)
                    });
                    const fileChunks = this.chunkFileContent(itemText, itemMetadata, chunkSize, overlapPercent, forceChunkDelimiter);
                    chunks.push(...fileChunks);
                } else {
                    // Default chunking for other types
                    if (itemText.length > chunkSize) {
                        const itemChunks = this.splitTextIntoChunks(itemText, chunkSize, overlapPercent, forceChunkDelimiter);
                        itemChunks.forEach((chunkText, chunkIndex) => {
                            chunks.push({
                                text: chunkText,
                                metadata: {
                                    ...itemMetadata,
                                    item_index: i,
                                    item_total: content.length,
                                    chunk_index: chunkIndex,
                                    chunk_total: itemChunks.length,
                                    is_chunked: true
                                }
                            });
                        });
                    } else {
                        // Keep small items as single chunks
                        chunks.push({
                            text: itemText,
                            metadata: {
                                ...itemMetadata,
                                item_index: i,
                                item_total: content.length,
                                chunk_index: 0,
                                chunk_total: 1,
                                is_chunked: false
                            }
                        });
                    }
                }
            }
            
            logger.log(`Converted ${content.length} array items into ${chunks.length} chunks`);
            
        } else if (typeof content === 'string') {
            // Single string content - split into chunks
            const textChunks = this.splitTextIntoChunks(content, chunkSize, overlapPercent, forceChunkDelimiter);
            chunks = textChunks.map((chunkText, index) => ({
                text: chunkText,
                metadata: {
                    ...metadata,
                    chunk_index: index,
                    chunk_total: textChunks.length,
                    is_chunked: textChunks.length > 1
                }
            }));
        } else if (content && content.text) {
            // Object with text property
            const textChunks = this.splitTextIntoChunks(content.text, chunkSize, overlapPercent, forceChunkDelimiter);
            chunks = textChunks.map((chunkText, index) => ({
                text: chunkText,
                metadata: {
                    ...metadata,
                    chunk_index: index,
                    chunk_total: textChunks.length,
                    is_chunked: textChunks.length > 1
                }
            }));
        } else {
            // Fallback: convert to string and process
            const textContent = String(content);
            const textChunks = this.splitTextIntoChunks(textContent, chunkSize, overlapPercent, forceChunkDelimiter);
            chunks = textChunks.map((chunkText, index) => ({
                text: chunkText,
                metadata: {
                    ...metadata,
                    chunk_index: index,
                    chunk_total: textChunks.length,
                    is_chunked: textChunks.length > 1
                }
            }));
        }
        
        return chunks;
    }
    
    /**
     * Split text into chunks (adapted from main system)
     * @private
     */
    splitTextIntoChunks(text, chunkSize = 1000, overlapPercent = 10, forceChunkDelimiter = null) {
        if (!text || text.length <= chunkSize) {
            return [text];
        }
        
        // 如果提供了自定义分隔符，先尝试按分隔符分割
        if (forceChunkDelimiter && forceChunkDelimiter.trim()) {
            const delimiter = forceChunkDelimiter.trim();
            const parts = text.split(delimiter);
            
            // 如果分割成功且产生了多个部分
            if (parts.length > 1) {
                const delimiterChunks = [];
                
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    
                    // 处理每个部分
                    if (part.length <= chunkSize) {
                        // 如果部分小于 chunkSize，直接作为一个块
                        if (part.trim()) {
                            delimiterChunks.push(part.trim());
                        }
                    } else {
                        // 如果部分大于 chunkSize，需要进一步分割
                        const subChunks = this.splitTextIntoChunksWithoutDelimiter(part, chunkSize, overlapPercent);
                        delimiterChunks.push(...subChunks);
                    }
                }
                
                return delimiterChunks.filter(chunk => chunk.length > 0);
            }
        }
        
        // 如果没有自定义分隔符或分隔符分割失败，使用原有的智能分割逻辑
        return this.splitTextIntoChunksWithoutDelimiter(text, chunkSize, overlapPercent);
    }
    
    /**
     * 原有的智能分块逻辑（不使用自定义分隔符）
     * @private
     */
    splitTextIntoChunksWithoutDelimiter(text, chunkSize = 1000, overlapPercent = 10) {
        const chunks = [];
        const overlapSize = Math.floor(chunkSize * overlapPercent / 100);
        let start = 0;
        
        while (start < text.length) {
            let end = start + chunkSize;
            
            // If this isn't the last chunk, try to break at a sentence or word boundary
            if (end < text.length) {
                // First priority: Look for double newlines (paragraph boundaries)
                const doubleNewlineIndex = text.lastIndexOf('\n\n', end);
                if (doubleNewlineIndex > start + chunkSize * 0.5) {
                    end = doubleNewlineIndex + 2; // Include the newlines
                } else {
                    // Second priority: Look for single newline
                    const newlineIndex = text.lastIndexOf('\n', end);
                    if (newlineIndex > start + chunkSize * 0.7) {
                        end = newlineIndex + 1; // Include the newline
                    } else {
                        // Third priority: Look for sentence boundaries (支持中英文标点)
                        const sentenceMarkers = [
                            '.', '?', '!',  // 英文标点
                            '。', '？', '！' // 中文标点
                        ];
                        
                        let bestEnd = -1;
                        for (const marker of sentenceMarkers) {
                            const markerIndex = text.lastIndexOf(marker, end);
                            if (markerIndex > start + chunkSize * 0.7 && markerIndex > bestEnd) {
                                bestEnd = markerIndex;
                            }
                        }
                        
                        if (bestEnd > -1) {
                            // 在标点后移动一位
                            end = bestEnd + 1;
                        } else {
                            // Fall back to word boundary (for English text)
                            const spaceIndex = text.lastIndexOf(' ', end);
                            if (spaceIndex > start + chunkSize * 0.7) {
                                end = spaceIndex;
                            }
                            // 对于纯中文文本，如果没有找到合适的分割点，就直接按长度切分
                        }
                    }
                }
            }
            
            const chunk = text.slice(start, end).trim();
            if (chunk) {
                chunks.push(chunk);
            }
            
            // Move start position with overlap
            start = end - overlapSize;
            
            // Ensure we don't go backwards
            if (start <= chunks.length > 1 ? text.indexOf(chunks[chunks.length - 2]) : 0) {
                start = end;
            }
        }
        
        // 过滤掉空块
        let filteredChunks = chunks.filter(chunk => chunk.length > 0);
        
        // 处理过小的块 - 合并最后一个块如果它太小
        const minChunkSize = Math.min(50, chunkSize * 0.1); // 最小块大小为50字符或块大小的10%
        if (filteredChunks.length > 1) {
            const lastChunk = filteredChunks[filteredChunks.length - 1];
            if (lastChunk.length < minChunkSize) {
                filteredChunks.pop(); // 移除最后一个块
                const secondLastChunk = filteredChunks.pop(); // 获取倒数第二个块
                
                // 合并最后两个块
                const mergedChunk = secondLastChunk + '\n\n' + lastChunk;
                
                // 如果合并后不超过最大大小的1.2倍，就合并
                if (mergedChunk.length <= chunkSize * 1.2) {
                    filteredChunks.push(mergedChunk);
                } else {
                    // 否则还是保持分开
                    filteredChunks.push(secondLastChunk);
                    filteredChunks.push(lastChunk);
                }
            }
        }
        
        return filteredChunks;
    }
    
    /**
     * Generate hash for text content
     * @private
     */
    generateHash(text) {
        // Simple hash function - in production you might want to use a better one
        let hash = 0;
        if (text.length === 0) return hash.toString();
        
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        
        return Math.abs(hash).toString(36);
    }
    
    /**
     * Prepare items for vectorization (legacy method, kept for compatibility)
     * @private
     */
    prepareItems(content, metadata) {
        // If content is already an array of items, use it
        if (Array.isArray(content)) {
            return content;
        }

        // If content is a string, create a single item
        if (typeof content === 'string') {
            return [{
                id: metadata.id || `item_${Date.now()}`,
                text: content,
                metadata: metadata
            }];
        }

        // If content is an object with text property
        if (content && content.text) {
            return [{
                id: content.id || metadata.id || `item_${Date.now()}`,
                text: content.text,
                metadata: { ...metadata, ...content.metadata }
            }];
        }

        // Default: convert to string and create item
        return [{
            id: metadata.id || `item_${Date.now()}`,
            text: String(content),
            metadata: metadata
        }];
    }

    /**
     * Initialize the processor
     * @param {Object} config - Initialization configuration
     */
    async initialize(config) {
        logger.log('Initializing VectorizationProcessor');
        
        // Merge configuration
        this.config = { ...this.config, ...config };
        
        // Initialize adapter if it has an init method
        if (this.adapter.initialize && typeof this.adapter.initialize === 'function') {
            await this.adapter.initialize();
        }
    }

    /**
     * Destroy the processor
     */
    async destroy() {
        logger.log('Destroying VectorizationProcessor');
        
        // Cleanup adapter if it has a cleanup method
        if (this.adapter.destroy && typeof this.adapter.destroy === 'function') {
            await this.adapter.destroy();
        }
    }

    /**
     * Get processor statistics
     * @returns {Object} Processor stats
     */
    getStats() {
        return {
            type: this.getType(),
            name: this.getName(),
            available: this.adapter !== null,
            config: this.config
        };
    }
    
    /**
     * Split content by <history_story> tags for summary vectorization
     * @param {string} content - The content containing history_story tags
     * @param {Object} metadata - Metadata for chunks
     * @param {number} maxChunkSize - Maximum size for secondary chunking (3000 chars)
     * @param {number} overlapPercent - Overlap percentage for secondary chunking
     * @returns {Array} Array of chunks
     * @private
     */
    splitByHistoryStoryTags(content, metadata, maxChunkSize, overlapPercent) {
        const chunks = [];
        const regex = /<history_story>(.*?)<\/history_story>/gs;
        const matches = [...content.matchAll(regex)];
        
        if (matches.length === 0) {
            logger.warn('No history_story tags found in content, falling back to normal chunking');
            return this.splitTextIntoChunks(content, maxChunkSize, overlapPercent, metadata.forceChunkDelimiter).map((chunkText, index) => ({
                text: chunkText,
                metadata: {
                    ...metadata,
                    chunk_index: index,
                    chunk_total: 1,
                    is_chunked: false
                }
            }));
        }
        
        logger.log(`Found ${matches.length} history_story tags`);
        
        matches.forEach((match, tagIndex) => {
            const tagContent = match[1].trim();
            
            // If content exceeds 3000 characters, perform secondary chunking
            if (tagContent.length > 3000) {
                logger.log(`History story tag ${tagIndex} exceeds 3000 chars (${tagContent.length}), applying secondary chunking`);
                
                const secondaryChunks = this.splitTextIntoChunks(tagContent, maxChunkSize, overlapPercent, metadata.forceChunkDelimiter);
                
                secondaryChunks.forEach((chunkText, chunkIndex) => {
                    chunks.push({
                        text: chunkText,
                        metadata: {
                            ...metadata,
                            history_story_index: tagIndex,
                            history_story_total: matches.length,
                            chunk_index: chunkIndex,
                            chunk_total: secondaryChunks.length,
                            is_chunked: true,
                            chunk_type: 'history_story',
                            original_length: tagContent.length
                        }
                    });
                });
            } else {
                // Keep as single chunk
                chunks.push({
                    text: tagContent,
                    metadata: {
                        ...metadata,
                        history_story_index: tagIndex,
                        history_story_total: matches.length,
                        chunk_index: 0,
                        chunk_total: 1,
                        is_chunked: false,
                        chunk_type: 'history_story',
                        original_length: tagContent.length
                    }
                });
            }
        });
        
        logger.log(`Split ${matches.length} history_story tags into ${chunks.length} chunks`);
        return chunks;
    }
    
    /**
     * Chunk chat messages with floor priority
     * @param {string} content - Chat message content
     * @param {Object} metadata - Message metadata including floor index
     * @param {number} maxChunkSize - Maximum chunk size
     * @param {number} overlapPercent - Overlap percentage
     * @param {string} forceChunkDelimiter - Custom delimiter for chunking
     * @returns {Array} Array of chunks
     * @private
     */
    chunkChatMessage(content, metadata, maxChunkSize, overlapPercent, forceChunkDelimiter) {
        const chunks = [];
        const floorIndex = metadata.index !== undefined ? metadata.index : 'unknown';
        
        // Priority 1: Keep floor complete if possible
        if (content.length <= maxChunkSize) {
            chunks.push({
                text: `[META:floor=${floorIndex}] ${content}`,
                metadata: {
                    ...metadata,
                    chunk_index: 0,
                    chunk_total: 1,
                    is_chunked: false,
                    chunk_type: 'chat_floor'
                }
            });
            return chunks;
        }
        
        // Priority 2: Try tag-based chunking if contains tags
        if (content.includes('</') && content.includes('<')) {
            logger.log(`Chat message at floor ${floorIndex} contains tags, attempting tag-based chunking`);
            
            // Try to split by common tag patterns in chat messages
            const tagPatterns = [
                /<system>(.*?)<\/system>/gs,
                /<prompt>(.*?)<\/prompt>/gs,
                /<response>(.*?)<\/response>/gs,
                /<thinking>(.*?)<\/thinking>/gs,
                /<action>(.*?)<\/action>/gs,
                /<dialogue>(.*?)<\/dialogue>/gs,
                /<narration>(.*?)<\/narration>/gs,
                /<ooc>(.*?)<\/ooc>/gs  // Out of character
            ];
            
            let tagChunks = [];
            let remainingContent = content;
            
            for (const pattern of tagPatterns) {
                const matches = [...content.matchAll(pattern)];
                if (matches.length > 0) {
                    matches.forEach((match, tagIndex) => {
                        const tagContent = match[1].trim();
                        const tagName = match[0].match(/<(\w+)>/)[1];
                        
                        if (tagContent.length <= maxChunkSize) {
                            tagChunks.push({
                                text: `[META:floor=${floorIndex},tag=${tagName}] ${tagContent}`,
                                metadata: {
                                    ...metadata,
                                    tag_name: tagName,
                                    tag_index: tagIndex,
                                    is_tag_chunk: true
                                }
                            });
                        } else {
                            // Tag content too large, need to split
                            const subChunks = this.splitTextIntoChunks(tagContent, maxChunkSize, overlapPercent, forceChunkDelimiter);
                            subChunks.forEach((subChunk, subIndex) => {
                                tagChunks.push({
                                    text: `[META:floor=${floorIndex},tag=${tagName},chunk=${subIndex + 1}/${subChunks.length}] ${subChunk}`,
                                    metadata: {
                                        ...metadata,
                                        tag_name: tagName,
                                        tag_index: tagIndex,
                                        sub_chunk_index: subIndex,
                                        sub_chunk_total: subChunks.length,
                                        is_tag_chunk: true
                                    }
                                });
                            });
                        }
                        
                        // Remove matched content from remaining
                        remainingContent = remainingContent.replace(match[0], '');
                    });
                }
            }
            
            // If we found tags and have remaining content, add it as a separate chunk
            if (tagChunks.length > 0) {
                remainingContent = remainingContent.trim();
                if (remainingContent.length > 0) {
                    if (remainingContent.length <= maxChunkSize) {
                        tagChunks.push({
                            text: `[META:floor=${floorIndex},tag=other] ${remainingContent}`,
                            metadata: {
                                ...metadata,
                                tag_name: 'other',
                                is_tag_chunk: true
                            }
                        });
                    } else {
                        const remainingChunks = this.splitTextIntoChunks(remainingContent, maxChunkSize, overlapPercent, forceChunkDelimiter);
                        remainingChunks.forEach((chunk, index) => {
                            tagChunks.push({
                                text: `[META:floor=${floorIndex},tag=other,chunk=${index + 1}/${remainingChunks.length}] ${chunk}`,
                                metadata: {
                                    ...metadata,
                                    tag_name: 'other',
                                    sub_chunk_index: index,
                                    sub_chunk_total: remainingChunks.length,
                                    is_tag_chunk: true
                                }
                            });
                        });
                    }
                }
                
                // Add chunk indexing to all tag chunks
                tagChunks.forEach((chunk, index) => {
                    chunk.metadata.chunk_index = index;
                    chunk.metadata.chunk_total = tagChunks.length;
                    chunk.metadata.is_chunked = tagChunks.length > 1;
                    chunk.metadata.chunk_type = 'chat_floor';
                });
                
                logger.log(`Chat message at floor ${floorIndex} split into ${tagChunks.length} tag-based chunks`);
                return tagChunks;
            }
        }
        
        // Priority 3: Size-based chunking with intelligent boundaries
        logger.log(`Chat message at floor ${floorIndex} exceeds ${maxChunkSize} chars, applying size-based chunking`);
        const sizeChunks = this.splitTextIntoChunks(content, maxChunkSize, overlapPercent, forceChunkDelimiter);
        
        sizeChunks.forEach((chunkText, chunkIndex) => {
            chunks.push({
                text: `[META:floor=${floorIndex},chunk=${chunkIndex + 1}/${sizeChunks.length}] ${chunkText}`,
                metadata: {
                    ...metadata,
                    chunk_index: chunkIndex,
                    chunk_total: sizeChunks.length,
                    is_chunked: true,
                    chunk_type: 'chat_floor'
                }
            });
        });
        
        logger.log(`Chat message at floor ${floorIndex} split into ${chunks.length} chunks`);
        return chunks;
    }
    
    /**
     * Chunk world info entries with entry priority
     * @param {string} content - World info entry content
     * @param {Object} metadata - Entry metadata including comment
     * @param {number} maxChunkSize - Maximum chunk size
     * @param {number} overlapPercent - Overlap percentage
     * @param {string} forceChunkDelimiter - Custom delimiter for chunking
     * @returns {Array} Array of chunks
     * @private
     */
    chunkWorldInfo(content, metadata, maxChunkSize, overlapPercent, forceChunkDelimiter) {
        const chunks = [];
        const entryIdentifier = metadata.comment || metadata.name || `Entry ${metadata.uid || 'unknown'}`;
        
        // Priority 1: Keep entry complete if possible
        if (content.length <= maxChunkSize) {
            chunks.push({
                text: `[META:entry=${entryIdentifier}] ${content}`,
                metadata: {
                    ...metadata,
                    chunk_index: 0,
                    chunk_total: 1,
                    is_chunked: false,
                    chunk_type: 'world_info_entry'
                }
            });
            return chunks;
        }
        
        // Priority 2: Try tag-based chunking if contains tags
        if (content.includes('</') && content.includes('<')) {
            logger.log(`World info entry "${entryIdentifier}" contains tags, attempting tag-based chunking`);
            
            // Try to split by common tag patterns
            const tagPatterns = [
                /<history_story>(.*?)<\/history_story>/gs,
                /<scenario>(.*?)<\/scenario>/gs,
                /<character>(.*?)<\/character>/gs,
                /<world>(.*?)<\/world>/gs
            ];
            
            let tagChunks = [];
            let remainingContent = content;
            
            for (const pattern of tagPatterns) {
                const matches = [...content.matchAll(pattern)];
                if (matches.length > 0) {
                    matches.forEach((match, tagIndex) => {
                        const tagContent = match[1].trim();
                        const tagName = match[0].match(/<(\w+)>/)[1];
                        
                        if (tagContent.length <= maxChunkSize) {
                            tagChunks.push({
                                text: `[META:entry=${entryIdentifier},tag=${tagName}] ${tagContent}`,
                                metadata: {
                                    ...metadata,
                                    tag_name: tagName,
                                    tag_index: tagIndex,
                                    is_tag_chunk: true
                                }
                            });
                        } else {
                            // Tag content too large, need to split
                            const subChunks = this.splitTextIntoChunks(tagContent, maxChunkSize, overlapPercent, forceChunkDelimiter);
                            subChunks.forEach((subChunk, subIndex) => {
                                tagChunks.push({
                                    text: `[META:entry=${entryIdentifier},tag=${tagName},chunk=${subIndex + 1}/${subChunks.length}] ${subChunk}`,
                                    metadata: {
                                        ...metadata,
                                        tag_name: tagName,
                                        tag_index: tagIndex,
                                        sub_chunk_index: subIndex,
                                        sub_chunk_total: subChunks.length,
                                        is_tag_chunk: true
                                    }
                                });
                            });
                        }
                        
                        // Remove matched content from remaining
                        remainingContent = remainingContent.replace(match[0], '');
                    });
                }
            }
            
            // If we found tags and have remaining content, add it as a separate chunk
            if (tagChunks.length > 0) {
                remainingContent = remainingContent.trim();
                if (remainingContent.length > 0) {
                    if (remainingContent.length <= maxChunkSize) {
                        tagChunks.push({
                            text: `[META:entry=${entryIdentifier},tag=other] ${remainingContent}`,
                            metadata: {
                                ...metadata,
                                tag_name: 'other',
                                is_tag_chunk: true
                            }
                        });
                    } else {
                        const remainingChunks = this.splitTextIntoChunks(remainingContent, maxChunkSize, overlapPercent, forceChunkDelimiter);
                        remainingChunks.forEach((chunk, index) => {
                            tagChunks.push({
                                text: `[META:entry=${entryIdentifier},tag=other,chunk=${index + 1}/${remainingChunks.length}] ${chunk}`,
                                metadata: {
                                    ...metadata,
                                    tag_name: 'other',
                                    sub_chunk_index: index,
                                    sub_chunk_total: remainingChunks.length,
                                    is_tag_chunk: true
                                }
                            });
                        });
                    }
                }
                
                // Add chunk indexing to all tag chunks
                tagChunks.forEach((chunk, index) => {
                    chunk.metadata.chunk_index = index;
                    chunk.metadata.chunk_total = tagChunks.length;
                    chunk.metadata.is_chunked = tagChunks.length > 1;
                    chunk.metadata.chunk_type = 'world_info_entry';
                });
                
                return tagChunks;
            }
        }
        
        // Priority 3: Size-based chunking with intelligent boundaries
        logger.log(`World info entry "${entryIdentifier}" exceeds ${maxChunkSize} chars, applying size-based chunking`);
        const sizeChunks = this.splitTextIntoChunks(content, maxChunkSize, overlapPercent, forceChunkDelimiter);
        
        sizeChunks.forEach((chunkText, chunkIndex) => {
            chunks.push({
                text: `[META:entry=${entryIdentifier},chunk=${chunkIndex + 1}/${sizeChunks.length}] ${chunkText}`,
                metadata: {
                    ...metadata,
                    chunk_index: chunkIndex,
                    chunk_total: sizeChunks.length,
                    is_chunked: true,
                    chunk_type: 'world_info_entry'
                }
            });
        });
        
        logger.log(`World info entry "${entryIdentifier}" split into ${chunks.length} chunks`);
        return chunks;
    }
    
    /**
     * Chunk file content with chapter detection support
     * Prioritizes chapter integrity for novel-like content
     * @param {string} content - File content
     * @param {Object} metadata - File metadata including name
     * @param {number} maxChunkSize - Maximum chunk size
     * @param {number} overlapPercent - Overlap percentage
     * @param {string} forceChunkDelimiter - Custom delimiter for chunking
     * @returns {Array} Array of chunks
     * @private
     */
    chunkFileContent(content, metadata, maxChunkSize, overlapPercent, forceChunkDelimiter) {
        const chunks = [];
        const fileName = metadata.name || metadata.filename || 'Unknown File';
        let globalChunkIndex = 0;  // 添加全局块索引计数器
        
        // Enhanced chapter detection regex
        // Pattern 1: Standard numbered chapters (第1章, Chapter 1, etc.)
        // Match patterns like: 第1章, 第一章, Chapter 1, etc. but NOT 第一卷
        const numberedChapterRegex = /^[\s\u3000]*(?:第\s*([一二三四五六七八九十百千万零壹贰叁肆伍陆柒捌玖拾佰仟萬]+|\d+)\s*(章|节|節|回|話|话|章節)|(?:Chapter|chapter|CHAPTER)\s*([一二三四五六七八九十百千万零壹贰叁肆伍陆柒捌玖拾佰仟萬]+|\d+|[IVXivx]+)\s*\.?)(?:\s*[:：\-—]\s*|\s+)([^\n\r]{0,100})/gm;
        
        // Pattern 2: Special chapters (序章, 前言, 后记, etc.)
        const specialChapterRegex = /^[\s\u3000]*(序章|序言|序|前言|引言|楔子|尾声|后记|後記|终章|終章|番外|外传|外傳|Prologue|Epilogue|Preface|Introduction|Afterword|Extra|Side Story)(?:\s*[:：\-—]\s*|\s+)?([^\n\r]{0,100})?/gim;
        
        // Detect all chapters (both numbered and special)
        const allMatches = [];
        
        // Find numbered chapters
        let match;
        while ((match = numberedChapterRegex.exec(content)) !== null) {
            // Extract chapter number and title based on which pattern matched
            let chapterNumber, chapterTitle;
            if (match[1]) {
                // Chinese pattern: 第X章
                chapterNumber = match[1];
                chapterTitle = match[4] ? match[4].trim() : '';
            } else if (match[3]) {
                // English pattern: Chapter X
                chapterNumber = match[3];
                chapterTitle = match[4] ? match[4].trim() : '';
            }
            
            allMatches.push({
                index: match.index,
                fullMatch: match[0],
                type: 'numbered',
                number: chapterNumber,
                title: chapterTitle
            });
        }
        
        // Find special chapters
        while ((match = specialChapterRegex.exec(content)) !== null) {
            allMatches.push({
                index: match.index,
                fullMatch: match[0],
                type: 'special',
                specialType: match[1],
                title: match[2] ? match[2].trim() : match[1]
            });
        }
        
        // Sort all matches by position
        allMatches.sort((a, b) => a.index - b.index);
        
        // Convert to chapters array
        const chapters = [];
        let lastIndex = 0;
        
        allMatches.forEach((match, idx) => {
            if (match.index > lastIndex) {
                // Update previous chapter's end index
                if (chapters.length > 0) {
                    chapters[chapters.length - 1].endIndex = match.index;
                }
            }
            
            const chapter = {
                startIndex: match.index,
                endIndex: content.length, // Will be updated by next match
                fullMatch: match.fullMatch,
                type: match.type
            };
            
            if (match.type === 'numbered') {
                chapter.number = match.number;
                chapter.title = match.title;
            } else {
                chapter.specialType = match.specialType;
                chapter.number = match.specialType; // Use special type as "number" for consistency
                chapter.title = match.title;
            }
            
            chapters.push(chapter);
            lastIndex = match.index;
        });
        
        // If chapters were found, use chapter-based chunking
        if (chapters.length > 0) {
            logger.log(`File "${fileName}" contains ${chapters.length} chapters, using chapter-aware chunking`);
            
            // Check if there's a short preamble that wasn't chunked separately
            let shortPreamble = '';
            if (chapters.length > 0 && chapters[0].startIndex > 0) {
                const preambleCheck = content.substring(0, chapters[0].startIndex).trim();
                if (preambleCheck && preambleCheck.length <= 50) {
                    shortPreamble = preambleCheck + '\n\n';
                }
            }
            
            // Process each chapter
            chapters.forEach((chapter, chapterIndex) => {
                let chapterContent = content.substring(chapter.startIndex, chapter.endIndex).trim();
                
                // For the first chapter, prepend any short preamble
                if (chapterIndex === 0 && shortPreamble) {
                    chapterContent = shortPreamble + chapterContent;
                }
                const chapterIdentifier = chapter.number ? 
                    (chapter.title ? `第${chapter.number}章 ${chapter.title}` : `第${chapter.number}章`) : 
                    (chapter.title || `Chapter ${chapterIndex + 1}`);
                
                // If chapter fits in one chunk, keep it intact
                if (chapterContent.length <= maxChunkSize) {
                    chunks.push({
                        text: `[META:file=${fileName},chapter=${chapter.number},chapterName=${chapter.title || ''},originalIndex=${globalChunkIndex++}] ${chapterContent}`,
                        metadata: {
                            ...metadata,
                            chapter_number: chapter.number,
                            chapter_title: chapter.title,
                            chapter_index: chapterIndex,
                            chapter_total: chapters.length,
                            chunk_index: 0,
                            chunk_total: 1,
                            is_chunked: false,
                            chunk_type: 'file_chapter'
                        }
                    });
                } else {
                    // Chapter is too large, need to split while preserving chapter info
                    logger.log(`Chapter "${chapterIdentifier}" exceeds ${maxChunkSize} chars, applying sub-chunking`);
                    
                    // Try to split by tags first if present
                    let subChunks = [];
                    if (chapterContent.includes('</') && chapterContent.includes('<')) {
                        // Similar tag patterns as in other methods
                        const tagPatterns = [
                            /<scene>(.*?)<\/scene>/gs,
                            /<dialogue>(.*?)<\/dialogue>/gs,
                            /<description>(.*?)<\/description>/gs,
                            /<action>(.*?)<\/action>/gs
                        ];
                        
                        let tagFound = false;
                        let remainingChapterContent = chapterContent;
                        
                        for (const pattern of tagPatterns) {
                            const tagMatches = [...chapterContent.matchAll(pattern)];
                            if (tagMatches.length > 0) {
                                tagFound = true;
                                tagMatches.forEach((tagMatch) => {
                                    const tagContent = tagMatch[1].trim();
                                    const tagName = tagMatch[0].match(/<(\w+)>/)[1];
                                    
                                    if (tagContent.length <= maxChunkSize) {
                                        subChunks.push({
                                            text: tagContent,
                                            tag: tagName
                                        });
                                    } else {
                                        // Tag content still too large
                                        const tagSubChunks = this.splitTextIntoChunks(tagContent, maxChunkSize, overlapPercent, forceChunkDelimiter);
                                        tagSubChunks.forEach((chunk, idx) => {
                                            subChunks.push({
                                                text: chunk,
                                                tag: tagName,
                                                tagChunkIndex: idx,
                                                tagChunkTotal: tagSubChunks.length
                                            });
                                        });
                                    }
                                    remainingChapterContent = remainingChapterContent.replace(tagMatch[0], '');
                                });
                            }
                        }
                        
                        // Add remaining content if any
                        if (tagFound && remainingChapterContent.trim()) {
                            const remainingChunks = this.splitTextIntoChunks(remainingChapterContent, maxChunkSize, overlapPercent, forceChunkDelimiter);
                            remainingChunks.forEach(chunk => {
                                subChunks.push({ text: chunk, tag: 'other' });
                            });
                        }
                    }
                    
                    // If no tags found or no tag splitting done, use regular chunking
                    if (subChunks.length === 0) {
                        const regularChunks = this.splitTextIntoChunks(chapterContent, maxChunkSize, overlapPercent, forceChunkDelimiter);
                        subChunks = regularChunks.map(chunk => ({ text: chunk }));
                    }
                    
                    // Add all sub-chunks with proper metadata
                    subChunks.forEach((subChunk, subIndex) => {
                        const metaTag = subChunk.tag ? `,tag=${subChunk.tag}` : '';
                        const chunkInfo = `,chunk=${subIndex + 1}/${subChunks.length}`;
                        
                        chunks.push({
                            text: `[META:file=${fileName},chapter=${chapter.number},chapterName=${chapter.title || ''}${metaTag}${chunkInfo},originalIndex=${globalChunkIndex++}] ${subChunk.text}`,
                            metadata: {
                                ...metadata,
                                chapter_number: chapter.number,
                                chapter_title: chapter.title,
                                chapter_index: chapterIndex,
                                chapter_total: chapters.length,
                                chunk_index: subIndex,
                                chunk_total: subChunks.length,
                                is_chunked: true,
                                chunk_type: 'file_chapter',
                                ...(subChunk.tag && { tag_name: subChunk.tag }),
                                ...(subChunk.tagChunkIndex !== undefined && { 
                                    tag_chunk_index: subChunk.tagChunkIndex,
                                    tag_chunk_total: subChunk.tagChunkTotal
                                })
                            }
                        });
                    });
                }
            });
            
            // Handle any content before the first chapter
            if (chapters.length > 0 && chapters[0].startIndex > 0) {
                const preamble = content.substring(0, chapters[0].startIndex).trim();
                // Only create preamble chunk if it's substantial content (more than 50 characters)
                if (preamble && preamble.length > 50) {
                    // Check if the first chapter is already a special chapter like 序章 or 前言
                    const firstChapterIsSpecial = chapters[0].type === 'special' && 
                        ['序章', '序言', '序', '前言', '引言', '楔子', 'Prologue', 'Preface', 'Introduction'].includes(chapters[0].specialType);
                    
                    // If first chapter is already a preamble-type chapter, treat this content as "未标记内容"
                    const preambleTitle = firstChapterIsSpecial ? '未标记内容' : '前言';
                    const preambleNumber = firstChapterIsSpecial ? 'unmarked' : '0';
                    
                    if (preamble.length <= maxChunkSize) {
                        chunks.unshift({
                            text: `[META:file=${fileName},chapter=${preambleNumber},chapterName=${preambleTitle},originalIndex=${globalChunkIndex++}] ${preamble}`,
                            metadata: {
                                ...metadata,
                                chapter_number: preambleNumber,
                                chapter_title: preambleTitle,
                                chapter_index: -1,
                                chapter_total: chapters.length,
                                chunk_index: 0,
                                chunk_total: 1,
                                is_chunked: false,
                                chunk_type: 'file_preamble'
                            }
                        });
                    } else {
                        const preambleChunks = this.splitTextIntoChunks(preamble, maxChunkSize, overlapPercent, forceChunkDelimiter);
                        preambleChunks.forEach((chunk, idx) => {
                            chunks.unshift({
                                text: `[META:file=${fileName},chapter=${preambleNumber},chapterName=${preambleTitle},chunk=${idx + 1}/${preambleChunks.length},originalIndex=${globalChunkIndex++}] ${chunk}`,
                                metadata: {
                                    ...metadata,
                                    chapter_number: preambleNumber,
                                    chapter_title: preambleTitle,
                                    chapter_index: -1,
                                    chapter_total: chapters.length,
                                    chunk_index: idx,
                                    chunk_total: preambleChunks.length,
                                    is_chunked: true,
                                    chunk_type: 'file_preamble'
                                }
                            });
                        });
                    }
                }
            }
            
            // Handle any content after the last chapter (e.g., epilogue, afterword that wasn't detected)
            const lastChapter = chapters[chapters.length - 1];
            if (lastChapter && lastChapter.endIndex < content.length) {
                const epilogue = content.substring(lastChapter.endIndex).trim();
                if (epilogue) {
                    // Check if the last chapter is already an epilogue-type chapter
                    const lastChapterIsEpilogue = lastChapter.type === 'special' && 
                        ['尾声', '后记', '後記', '终章', '終章', '番外', 'Epilogue', 'Afterword', 'Extra'].includes(lastChapter.specialType);
                    
                    const epilogueTitle = lastChapterIsEpilogue ? '附录' : '后记';
                    const epilogueNumber = lastChapterIsEpilogue ? 'appendix' : 'epilogue';
                    
                    if (epilogue.length <= maxChunkSize) {
                        chunks.push({
                            text: `[META:file=${fileName},chapter=${epilogueNumber},chapterName=${epilogueTitle},originalIndex=${globalChunkIndex++}] ${epilogue}`,
                            metadata: {
                                ...metadata,
                                chapter_number: epilogueNumber,
                                chapter_title: epilogueTitle,
                                chapter_index: chapters.length,
                                chapter_total: chapters.length,
                                chunk_index: 0,
                                chunk_total: 1,
                                is_chunked: false,
                                chunk_type: 'file_epilogue'
                            }
                        });
                    } else {
                        const epilogueChunks = this.splitTextIntoChunks(epilogue, maxChunkSize, overlapPercent, forceChunkDelimiter);
                        epilogueChunks.forEach((chunk, idx) => {
                            chunks.push({
                                text: `[META:file=${fileName},chapter=${epilogueNumber},chapterName=${epilogueTitle},chunk=${idx + 1}/${epilogueChunks.length},originalIndex=${globalChunkIndex++}] ${chunk}`,
                                metadata: {
                                    ...metadata,
                                    chapter_number: epilogueNumber,
                                    chapter_title: epilogueTitle,
                                    chapter_index: chapters.length,
                                    chapter_total: chapters.length,
                                    chunk_index: idx,
                                    chunk_total: epilogueChunks.length,
                                    is_chunked: true,
                                    chunk_type: 'file_epilogue'
                                }
                            });
                        });
                    }
                }
            }
            
            logger.log(`File "${fileName}" split into ${chunks.length} chunks across ${chapters.length} chapters`);
            return chunks;
        }
        
        // No chapters found, treat as regular file
        logger.log(`File "${fileName}" has no detected chapters, using regular chunking`);
        
        if (content.length <= maxChunkSize) {
            chunks.push({
                text: `[META:file=${fileName},originalIndex=${globalChunkIndex++}] ${content}`,
                metadata: {
                    ...metadata,
                    chunk_index: 0,
                    chunk_total: 1,
                    is_chunked: false,
                    chunk_type: 'file_content'
                }
            });
        } else {
            const regularChunks = this.splitTextIntoChunks(content, maxChunkSize, overlapPercent, forceChunkDelimiter);
            regularChunks.forEach((chunkText, chunkIndex) => {
                chunks.push({
                    text: `[META:file=${fileName},chunk=${chunkIndex + 1}/${regularChunks.length},originalIndex=${globalChunkIndex++}] ${chunkText}`,
                    metadata: {
                        ...metadata,
                        chunk_index: chunkIndex,
                        chunk_total: regularChunks.length,
                        is_chunked: true,
                        chunk_type: 'file_content'
                    }
                });
            });
        }
        
        logger.log(`File "${fileName}" split into ${chunks.length} chunks`);
        return chunks;
    }
}