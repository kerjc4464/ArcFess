/**
 * @file ExtractorPipeline.js
 * @description Pipeline adapter for content extractors
 * @module core/pipeline/adapters/ExtractorPipeline
 */

import { Logger } from '../../../utils/Logger.js';
import { ChatExtractor } from '../../extractors/ChatExtractor.js';
import { FileExtractor } from '../../extractors/FileExtractor.js';
import { WorldInfoExtractor } from '../../extractors/WorldInfoExtractor.js';

const logger = new Logger('ExtractorPipeline');

/**
 * Adapter that integrates content extractors with the pipeline
 * Wraps existing extractors without modifying them
 */
export class ExtractorPipeline {
    constructor() {
        /**
         * Map of extractor instances
         * @type {Map<string, IContentExtractor>}
         */
        this.extractors = new Map();
        
        /**
         * Extraction configuration
         */
        this.config = {
            enableCaching: true,
            cacheTimeout: 300000, // 5 minutes
            maxConcurrent: 3
        };

        /**
         * Cache for extracted content
         * @type {Map<string, Object>}
         */
        this.cache = new Map();

        // Initialize default extractors
        this.initializeExtractors();
    }

    /**
     * Initialize built-in extractors
     * @private
     */
    initializeExtractors() {
        try {
            // Register built-in extractors
            this.registerExtractor('chat', new ChatExtractor());
            this.registerExtractor('file', new FileExtractor());
            this.registerExtractor('world_info', new WorldInfoExtractor());
            
            logger.log(`Initialized ${this.extractors.size} extractors`);
        } catch (error) {
            logger.error(`Failed to initialize extractors: ${error.message}`);
        }
    }

    /**
     * Register an extractor
     * @param {string} type - Extractor type
     * @param {IContentExtractor} extractor - Extractor instance
     */
    registerExtractor(type, extractor) {
        if (!extractor || typeof extractor.extract !== 'function') {
            throw new Error(`Invalid extractor for type: ${type}`);
        }

        this.extractors.set(type, extractor);
        logger.log(`Registered extractor: ${type}`);
    }

    /**
     * Extract content using appropriate extractors
     * @param {Object} request - Extraction request
     * @param {string} request.type - Content type to extract
     * @param {Object} request.options - Extraction options
     * @param {Object} context - Processing context
     * @returns {Promise<Object>} Extracted content
     */
    async extract(request, context) {
        const { type, options = {} } = request;
        const startTime = performance.now();

        try {
            // Check cache first
            const cacheKey = this.getCacheKey(type, options);
            if (this.config.enableCaching && this.cache.has(cacheKey)) {
                const cached = this.cache.get(cacheKey);
                if (Date.now() - cached.timestamp < this.config.cacheTimeout) {
                    logger.log(`Returning cached content for ${type}`);
                    return cached.content;
                }
                this.cache.delete(cacheKey);
            }

            // Get appropriate extractor
            const extractor = this.extractors.get(type);
            if (!extractor) {
                throw new Error(`No extractor available for type: ${type}`);
            }

            logger.log(`Extracting content using ${type} extractor`);
            
            // Extract content
            const content = await extractor.extract(options);
            
            // Process extracted content
            const processed = await this.processExtractedContent(content, type, context);

            // Cache if enabled
            if (this.config.enableCaching) {
                this.cache.set(cacheKey, {
                    content: processed,
                    timestamp: Date.now()
                });
            }

            // Add extraction metadata
            const result = {
                ...processed,
                _extraction: {
                    type,
                    extractionTime: performance.now() - startTime,
                    timestamp: Date.now()
                }
            };

            return result;

        } catch (error) {
            logger.error(`Extraction failed for ${type}: ${error.message}`);
            
            if (context) {
                context.addError(error, {
                    extractorType: type,
                    options
                });
            }

            throw error;
        }
    }

    /**
     * Extract content from multiple sources
     * @param {Array<Object>} requests - Array of extraction requests
     * @param {Object} context - Processing context
     * @returns {Promise<Object>} Combined extracted content
     */
    async extractMultiple(requests, context) {
        logger.log(`Extracting from ${requests.length} sources`);

        const results = {
            contents: [],
            errors: [],
            metadata: {}
        };

        // Process requests with concurrency control
        const chunks = this.chunkArray(requests, this.config.maxConcurrent);
        
        for (const chunk of chunks) {
            const promises = chunk.map(request =>
                this.extract(request, context)
                    .then(content => ({ success: true, content, request }))
                    .catch(error => ({ success: false, error, request }))
            );

            const chunkResults = await Promise.all(promises);
            
            for (const result of chunkResults) {
                if (result.success) {
                    results.contents.push(result.content);
                } else {
                    results.errors.push({
                        type: result.request.type,
                        error: result.error.message
                    });
                }
            }
        }

        // Combine metadata
        results.metadata = {
            totalRequested: requests.length,
            successful: results.contents.length,
            failed: results.errors.length,
            extractors: requests.map(r => r.type).filter((v, i, a) => a.indexOf(v) === i)
        };

        return results;
    }

    /**
     * Process extracted content
     * @private
     */
    async processExtractedContent(content, type, context) {
        // If content is already in the expected format, return it
        if (content && typeof content === 'object' && content.items) {
            return content;
        }

        // Convert to standard format
        const processed = {
            items: [],
            metadata: {
                extractorType: type,
                extractedAt: Date.now()
            }
        };

        // Handle different content formats
        if (Array.isArray(content)) {
            processed.items = content;
        } else if (typeof content === 'string') {
            processed.items = [{ text: content, id: `extracted_${Date.now()}` }];
        } else if (content && typeof content === 'object') {
            // Single item object
            processed.items = [content];
        }

        // Add item count
        processed.metadata.itemCount = processed.items.length;

        return processed;
    }

    /**
     * Create a pipeline-compatible extraction function
     * @param {string} type - Extractor type
     * @returns {Function} Extraction function for pipeline use
     */
    createPipelineFunction(type) {
        return async (input, context) => {
            const options = {
                ...input.metadata?.extractorOptions,
                ...context.settings?.extractorOptions
            };

            const result = await this.extract({ type, options }, context);
            
            // Transform to pipeline output format
            return {
                content: result.items.map(item => item.text).join('\n'),
                items: result.items,
                metadata: {
                    ...input.metadata,
                    ...result.metadata,
                    extraction: result._extraction
                }
            };
        };
    }

    /**
     * Get available extractor types
     * @returns {Array<string>} Extractor types
     */
    getExtractorTypes() {
        return Array.from(this.extractors.keys());
    }

    /**
     * Get extractor by type
     * @param {string} type - Extractor type
     * @returns {IContentExtractor|null} Extractor instance
     */
    getExtractor(type) {
        return this.extractors.get(type) || null;
    }

    /**
     * Clear extraction cache
     */
    clearCache() {
        const size = this.cache.size;
        this.cache.clear();
        logger.log(`Cleared ${size} cached entries`);
    }

    /**
     * Get cache key for extraction request
     * @private
     */
    getCacheKey(type, options) {
        return `${type}:${JSON.stringify(options)}`;
    }

    /**
     * Chunk array for parallel processing
     * @private
     */
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Configure the extractor pipeline
     * @param {Object} config - Configuration options
     */
    configure(config) {
        this.config = { ...this.config, ...config };
        logger.log('ExtractorPipeline configured:', this.config);
    }

    /**
     * Get pipeline statistics
     * @returns {Object} Pipeline stats
     */
    getStats() {
        return {
            extractorCount: this.extractors.size,
            extractorTypes: this.getExtractorTypes(),
            cacheSize: this.cache.size,
            config: this.config
        };
    }
}