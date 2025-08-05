/**
 * @file TextDispatcher.js
 * @description Dispatcher for routing text to appropriate processors
 * @module core/pipeline/TextDispatcher
 */

import { Logger } from '../../utils/Logger.js';
import { eventBus } from '../../infrastructure/events/eventBus.instance.js';

const logger = new Logger('TextDispatcher');

/**
 * Dispatches text content to appropriate processors based on task type
 */
export class TextDispatcher {
    /**
     * @param {TextPipeline} pipeline - Text pipeline instance
     * @param {ProcessorRegistry} registry - Processor registry instance
     */
    constructor(pipeline, registry) {
        this.pipeline = pipeline;
        this.registry = registry;
        
        /**
         * Routing rules for different task types
         * @type {Map<string, Function>}
         */
        this.routes = new Map();
        
        /**
         * Pre-processing hooks
         * @type {Map<string, Array<Function>>}
         */
        this.preHooks = new Map();
        
        /**
         * Post-processing hooks
         * @type {Map<string, Array<Function>>}
         */
        this.postHooks = new Map();

        this.setupDefaultRoutes();
    }

    /**
     * Setup default routing rules
     * @private
     */
    setupDefaultRoutes() {
        // Default route - direct mapping
        this.route('default', (content, taskType, config) => ({
            processorType: taskType,
            input: { content, metadata: config }
        }));

        // Vectorization route
        this.route('vectorization', (content, taskType, config) => ({
            processorType: 'vectorization',
            input: {
                content,
                metadata: {
                    ...config,
                    source: config.source || 'unknown',
                    contentType: config.contentType || 'text'
                }
            }
        }));

        logger.log('Default routes configured');
    }

    /**
     * Add a routing rule
     * @param {string} taskType - Task type to route
     * @param {Function} router - Routing function
     * @returns {TextDispatcher} This instance for chaining
     */
    route(taskType, router) {
        if (typeof router !== 'function') {
            throw new Error('Router must be a function');
        }

        this.routes.set(taskType, router);
        logger.log(`Added route for task type: ${taskType}`);
        
        return this;
    }

    /**
     * Add pre-processing hook
     * @param {string} taskType - Task type
     * @param {Function} hook - Hook function
     * @returns {TextDispatcher} This instance for chaining
     */
    addPreHook(taskType, hook) {
        if (!this.preHooks.has(taskType)) {
            this.preHooks.set(taskType, []);
        }
        this.preHooks.get(taskType).push(hook);
        return this;
    }

    /**
     * Add post-processing hook
     * @param {string} taskType - Task type
     * @param {Function} hook - Hook function
     * @returns {TextDispatcher} This instance for chaining
     */
    addPostHook(taskType, hook) {
        if (!this.postHooks.has(taskType)) {
            this.postHooks.set(taskType, []);
        }
        this.postHooks.get(taskType).push(hook);
        return this;
    }

    /**
     * Dispatch content to appropriate processor
     * @param {string|Object} content - Content to process
     * @param {string} taskType - Type of task
     * @param {Object} config - Task configuration
     * @param {Object} context - Processing context
     * @returns {Promise<Object>} Processing result
     */
    async dispatch(content, taskType, config = {}, context = {}) {
        const startTime = performance.now();

        try {
            logger.log(`Dispatching ${taskType} task`);

            // Normalize content
            const normalizedContent = this.normalizeContent(content);

            // Apply pre-processing hooks
            let processedContent = normalizedContent;
            const preHooks = this.preHooks.get(taskType) || [];
            for (const hook of preHooks) {
                processedContent = await hook(processedContent, config, context);
            }

            // Get routing information
            const router = this.routes.get(taskType) || this.routes.get('default');
            const routingResult = router(processedContent, taskType, config);

            if (!routingResult || !routingResult.processorType) {
                throw new Error(`No processor type determined for task: ${taskType}`);
            }

            // Check if processor exists
            if (!this.pipeline.getProcessor(routingResult.processorType)) {
                throw new Error(`Processor not available: ${routingResult.processorType}`);
            }

            // Emit dispatch event
            eventBus.emit('dispatcher:task-dispatched', {
                taskType,
                processorType: routingResult.processorType,
                contentLength: processedContent.length
            });

            // Process through pipeline
            const result = await this.pipeline.process(
                routingResult.input,
                routingResult.processorType,
                { ...context, taskType, config }
            );

            // Apply post-processing hooks
            let finalResult = result;
            const postHooks = this.postHooks.get(taskType) || [];
            for (const hook of postHooks) {
                finalResult = await hook(finalResult, config, context);
            }

            // Add dispatch metadata
            finalResult._dispatch = {
                taskType,
                processorUsed: routingResult.processorType,
                dispatchTime: performance.now() - startTime
            };

            logger.log(`Dispatch completed for ${taskType} in ${finalResult._dispatch.dispatchTime}ms`);
            return finalResult;

        } catch (error) {
            logger.error(`Dispatch failed for ${taskType}: ${error.message}`);
            
            eventBus.emit('dispatcher:task-failed', {
                taskType,
                error: error.message
            });

            throw error;
        }
    }

    /**
     * Batch dispatch multiple contents
     * @param {Array<Object>} items - Items to process
     * @param {string} taskType - Task type for all items
     * @param {Object} config - Shared configuration
     * @param {Object} context - Processing context
     * @returns {Promise<Array<Object>>} Processing results
     */
    async batchDispatch(items, taskType, config = {}, context = {}) {
        logger.log(`Batch dispatching ${items.length} items for ${taskType}`);

        const results = [];
        const errors = [];

        // Process in parallel with concurrency limit
        const concurrency = config.concurrency || 5;
        const chunks = this.chunkArray(items, concurrency);

        for (const chunk of chunks) {
            const promises = chunk.map(item => 
                this.dispatch(item.content, taskType, { ...config, ...item.config }, context)
                    .then(result => ({ success: true, result, item }))
                    .catch(error => ({ success: false, error, item }))
            );

            const chunkResults = await Promise.all(promises);
            
            for (const result of chunkResults) {
                if (result.success) {
                    results.push(result.result);
                } else {
                    errors.push(result);
                }
            }
        }

        // Emit batch completion event
        eventBus.emit('dispatcher:batch-complete', {
            taskType,
            total: items.length,
            successful: results.length,
            failed: errors.length
        });

        return {
            results,
            errors,
            summary: {
                total: items.length,
                successful: results.length,
                failed: errors.length
            }
        };
    }

    /**
     * Chain multiple processing tasks
     * @param {string|Object} content - Initial content
     * @param {Array<Object>} taskChain - Chain of tasks to execute
     * @param {Object} context - Processing context
     * @returns {Promise<Object>} Final processing result
     */
    async chain(content, taskChain, context = {}) {
        logger.log(`Executing task chain with ${taskChain.length} tasks`);

        let currentResult = { content: this.normalizeContent(content) };
        const chainResults = [];

        for (let i = 0; i < taskChain.length; i++) {
            const task = taskChain[i];
            const { taskType, config = {}, transform } = task;

            try {
                // Use previous result as input
                const input = transform 
                    ? transform(currentResult) 
                    : currentResult.content || currentResult;

                // Dispatch task
                currentResult = await this.dispatch(input, taskType, config, {
                    ...context,
                    chainIndex: i,
                    chainLength: taskChain.length
                });

                chainResults.push({
                    taskType,
                    success: true,
                    result: currentResult
                });

            } catch (error) {
                logger.error(`Chain failed at task ${i} (${taskType}): ${error.message}`);
                
                if (task.optional) {
                    // Skip optional tasks on error
                    chainResults.push({
                        taskType,
                        success: false,
                        error: error.message,
                        skipped: true
                    });
                    continue;
                }

                // Re-throw for required tasks
                error.chainIndex = i;
                error.chainResults = chainResults;
                throw error;
            }
        }

        return {
            finalResult: currentResult,
            chainResults,
            summary: {
                totalTasks: taskChain.length,
                successful: chainResults.filter(r => r.success).length,
                failed: chainResults.filter(r => !r.success).length
            }
        };
    }

    /**
     * Normalize content appropriately
     * @private
     */
    normalizeContent(content) {
        if (typeof content === 'string') {
            return content;
        }
        
        // IMPORTANT: Don't convert arrays to strings! Arrays should be preserved for vectorization
        if (Array.isArray(content)) {
            logger.log(`TextDispatcher: Preserving array content with ${content.length} items`);
            return content; // 保持数组格式
        }
        
        // For objects, check if they have meaningful content
        if (content && typeof content === 'object') {
            // If it has a text property, use that
            if (content.text && typeof content.text === 'string') {
                return content.text;
            }
            // If it has a content property, use that
            if (content.content) {
                return this.normalizeContent(content.content); // Recursive call
            }
            // Otherwise, try JSON stringification
            return JSON.stringify(content);
        }
        
        // For other types, convert to string
        if (content && typeof content.toString === 'function') {
            return content.toString();
        }
        
        return JSON.stringify(content);
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
     * Get available task types
     * @returns {Array<string>} Task types
     */
    getTaskTypes() {
        return Array.from(this.routes.keys());
    }

    /**
     * Check if task type is supported
     * @param {string} taskType - Task type to check
     * @returns {boolean} True if supported
     */
    isSupported(taskType) {
        return this.routes.has(taskType) || this.routes.has('default');
    }
}