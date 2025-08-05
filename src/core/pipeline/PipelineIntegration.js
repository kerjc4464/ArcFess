/**
 * @file PipelineIntegration.js
 * @description Helper for integrating pipeline with existing code
 * @module core/pipeline/PipelineIntegration
 */

import { Logger } from '../../utils/Logger.js';
import { TextPipeline } from './TextPipeline.js';
import { TextDispatcher } from './TextDispatcher.js';
import { ProcessingContext } from './ProcessingContext.js';
import { processorRegistry } from './ProcessorRegistry.js';
import { processorFactory } from './ProcessorFactory.js';
import { ExtractorPipeline } from './adapters/ExtractorPipeline.js';
import { LoggingMiddleware } from './middleware/LoggingMiddleware.js';
import { ValidationMiddleware } from './middleware/ValidationMiddleware.js';

const logger = new Logger('PipelineIntegration');

/**
 * Helper class for integrating the pipeline with existing vectorization code
 * Provides convenience methods and maintains backward compatibility
 */
export class PipelineIntegration {
    constructor() {
        /**
         * Main pipeline instance
         */
        this.pipeline = new TextPipeline();
        
        /**
         * Dispatcher instance
         */
        this.dispatcher = new TextDispatcher(this.pipeline, processorRegistry);
        
        /**
         * Extractor pipeline
         */
        this.extractorPipeline = new ExtractorPipeline();
        
        /**
         * Integration state
         */
        this.initialized = false;
        this.config = {
            useNewPipeline: false, // Feature flag
            enableLogging: true,
            enableMetrics: true
        };
    }

    /**
     * Initialize the pipeline integration
     * @param {Object} options - Initialization options
     * @param {VectorizationAdapter} options.vectorizationAdapter - Existing adapter
     * @param {Object} options.settings - Extension settings
     * @returns {Promise<void>}
     */
    async initialize(options = {}) {
        if (this.initialized) {
            logger.warn('Pipeline integration already initialized');
            return;
        }

        try {
            logger.log('Initializing pipeline integration');

            // Store references
            this.vectorizationAdapter = options.vectorizationAdapter;
            this.settings = options.settings || {};

            // Create and register vectorization processor
            if (this.vectorizationAdapter) {
                const processor = processorFactory.create('vectorization', {
                    adapter: this.vectorizationAdapter,
                    singleton: true
                });
                
                this.pipeline.registerProcessor('vectorization', processor);
                logger.log('Registered vectorization processor');
            }

            // Configure pipeline
            this.pipeline.configure({
                enableLogging: this.config.enableLogging,
                enableMetrics: this.config.enableMetrics
            });

            // Add default middleware
            this.setupDefaultMiddleware();

            // Initialize pipeline components
            await this.pipeline.initialize();

            this.initialized = true;
            logger.log('Pipeline integration initialized successfully');

        } catch (error) {
            logger.error(`Failed to initialize pipeline: ${error.message}`);
            throw error;
        }
    }

    /**
     * Setup default middleware
     * @private
     */
    setupDefaultMiddleware() {
        // Logging middleware
        if (this.config.enableLogging) {
            const loggingMiddleware = new LoggingMiddleware({
                logLevel: 'debug',
                includeData: false,
                logPerformance: true
            });
            this.pipeline.use('logging', loggingMiddleware);
        }

        // Validation middleware
        const validationMiddleware = new ValidationMiddleware({
            rules: {
                type: 'object',
                custom: (input, context) => {
                    // Ensure input has required structure
                    if (!input.content && !input.items) {
                        return 'Input must have content or items property';
                    }
                    return true;
                }
            },
            throwOnValidationError: true
        });
        this.pipeline.use('validation', validationMiddleware);
    }

    /**
     * Create a wrapper function that matches the existing performVectorization signature
     * @returns {Function} Wrapper function
     */
    createVectorizationWrapper() {
        return async (contentSettings, chatId, isIncremental, items) => {
            // Check feature flag
            if (!this.config.useNewPipeline) {
                // Call original function (must be provided)
                if (this.originalPerformVectorization) {
                    return this.originalPerformVectorization(contentSettings, chatId, isIncremental, items);
                }
                throw new Error('Original performVectorization not set');
            }

            // Use new pipeline
            logger.log('Using new pipeline for vectorization');
            
            try {
                // Create processing context
                const context = new ProcessingContext({
                    chatId,
                    settings: contentSettings,
                    metadata: {
                        isIncremental,
                        source: 'chat_vectorization'
                    }
                });

                // Prepare input
                const input = {
                    content: items,
                    metadata: {
                        contentSettings,
                        isIncremental
                    }
                };

                // Process through pipeline
                const result = await this.dispatcher.dispatch(
                    input,
                    'vectorization',
                    contentSettings,
                    context
                );

                // Transform result to match expected format
                return this.transformPipelineResult(result);

            } catch (error) {
                logger.error(`Pipeline vectorization failed: ${error.message}`);
                
                // Fallback to original on error
                if (this.originalPerformVectorization) {
                    logger.warn('Falling back to original implementation');
                    return this.originalPerformVectorization(contentSettings, chatId, isIncremental, items);
                }
                
                throw error;
            }
        };
    }

    /**
     * Transform pipeline result to match legacy format
     * @private
     */
    transformPipelineResult(pipelineResult) {
        // Extract what the legacy code expects
        return {
            success: pipelineResult.success,
            vectorized: pipelineResult.vectorized,
            taskId: pipelineResult.metadata?.taskId,
            collectionId: pipelineResult.metadata?.collectionId
        };
    }

    /**
     * Enable or disable the new pipeline
     * @param {boolean} enabled - Whether to enable the pipeline
     */
    setEnabled(enabled) {
        this.config.useNewPipeline = enabled;
        logger.log(`Pipeline ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Check if pipeline is enabled
     * @returns {boolean} True if enabled
     */
    isEnabled() {
        return this.config.useNewPipeline && this.initialized;
    }

    /**
     * Set the original function for fallback
     * @param {Function} originalFunction - Original performVectorization function
     */
    setOriginalFunction(originalFunction) {
        this.originalPerformVectorization = originalFunction;
    }

    /**
     * Create an A/B test wrapper
     * @returns {Function} A/B test function
     */
    createABTestWrapper() {
        return async (...args) => {
            if (!this.originalPerformVectorization) {
                throw new Error('Original function not set for A/B testing');
            }

            const startOld = performance.now();
            const oldResult = await this.originalPerformVectorization(...args);
            const oldDuration = performance.now() - startOld;

            const startNew = performance.now();
            const newResult = await this.createVectorizationWrapper()(...args);
            const newDuration = performance.now() - startNew;

            // Compare results
            const comparison = {
                oldDuration,
                newDuration,
                speedup: oldDuration / newDuration,
                resultsMatch: JSON.stringify(oldResult) === JSON.stringify(newResult)
            };

            logger.log('A/B Test Results:', comparison);

            // Return the result based on config
            return this.config.useNewPipeline ? newResult : oldResult;
        };
    }

    /**
     * Get pipeline statistics
     * @returns {Object} Pipeline stats
     */
    getStats() {
        return {
            initialized: this.initialized,
            enabled: this.isEnabled(),
            pipelineStats: this.pipeline.getStats(),
            extractorStats: this.extractorPipeline.getStats()
        };
    }

    /**
     * Cleanup resources
     */
    async destroy() {
        logger.log('Destroying pipeline integration');
        
        if (this.pipeline) {
            await this.pipeline.destroy();
        }
        
        this.initialized = false;
    }
}

// Create singleton instance
export const pipelineIntegration = new PipelineIntegration();

// Export for use in index.js
export function initializePipeline(options) {
    return pipelineIntegration.initialize(options);
}

export function createPipelineWrapper() {
    return pipelineIntegration.createVectorizationWrapper();
}

export function enablePipeline(enabled = true) {
    pipelineIntegration.setEnabled(enabled);
}

export function isPipelineEnabled() {
    return pipelineIntegration.isEnabled();
}