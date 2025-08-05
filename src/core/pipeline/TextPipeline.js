/**
 * @file TextPipeline.js
 * @description Core text processing pipeline implementation
 * @module core/pipeline/TextPipeline
 */

import { Logger } from '../../utils/Logger.js';
import { PipelineEventBus } from './events/PipelineEventBus.js';
import { MiddlewareManager } from './MiddlewareManager.js';
import { LifecycleManager } from './LifecycleManager.js';

const logger = new Logger('TextPipeline');

/**
 * Text processing pipeline that manages processors and middleware
 */
export class TextPipeline {
    constructor() {
        /**
         * Map of registered processors by type
         * @type {Map<string, ITextProcessor>}
         */
        this.processors = new Map();

        /**
         * Middleware manager instance
         * @type {MiddlewareManager}
         */
        this.middlewareManager = new MiddlewareManager();

        /**
         * Pipeline event bus instance
         * @type {PipelineEventBus}
         */
        this.eventBus = new PipelineEventBus();

        /**
         * Lifecycle manager instance
         * @type {LifecycleManager}
         */
        this.lifecycleManager = new LifecycleManager(this.eventBus);

        /**
         * Pipeline configuration
         * @type {Object}
         */
        this.config = {
            maxRetries: 3,
            timeout: 30000,
            enableLogging: true
        };

        this.stats = {
            totalProcessed: 0,
            totalErrors: 0,
            processingTime: 0
        };
    }

    /**
     * Register a processor
     * @param {string} type - Processor type identifier
     * @param {ITextProcessor} processor - Processor instance
     * @returns {TextPipeline} This instance for chaining
     */
    registerProcessor(type, processor) {
        if (!type || typeof type !== 'string') {
            throw new Error('Processor type must be a non-empty string');
        }
        if (!processor || typeof processor.process !== 'function') {
            throw new Error('Processor must implement ITextProcessor interface');
        }

        logger.log(`Registering processor: ${type}`);
        this.processors.set(type, processor);

        // Register with lifecycle manager
        this.lifecycleManager.registerProcessor(type, processor);

        // Emit registration event
        this.eventBus.emit('pipeline:processor-registered', { type, processor: processor.getName() });

        return this;
    }

    /**
     * Unregister a processor
     * @param {string} type - Processor type to remove
     * @returns {boolean} True if removed
     */
    unregisterProcessor(type) {
        const removed = this.processors.delete(type);
        if (removed) {
            logger.log(`Unregistered processor: ${type}`);
            this.eventBus.emit('pipeline:processor-unregistered', { type });
        }
        return removed;
    }

    /**
     * Add middleware to the pipeline
     * @param {string|IMiddleware} nameOrMiddleware - Middleware name or instance
     * @param {IMiddleware} [middleware] - Middleware instance if name provided
     * @param {object} [options] - Registration options
     * @returns {TextPipeline} This instance for chaining
     */
    use(nameOrMiddleware, middleware = null, options = {}) {
        if (typeof nameOrMiddleware === 'string') {
            // Register with name
            this.middlewareManager.register(nameOrMiddleware, middleware, options);
        } else if (nameOrMiddleware && typeof nameOrMiddleware.process === 'function') {
            // Register middleware instance with auto-generated name
            const name = nameOrMiddleware.name || `middleware_${Date.now()}`;
            this.middlewareManager.register(name, nameOrMiddleware, options);
        } else {
            throw new Error('Invalid middleware: must be IMiddleware instance or provide name and instance');
        }

        logger.log(`Added middleware: ${nameOrMiddleware.name || nameOrMiddleware}`);
        return this;
    }

    /**
     * Remove middleware from the pipeline
     * @param {string} name - Middleware name
     * @returns {Promise<boolean>} True if removed
     */
    async removeMiddleware(name) {
        return await this.middlewareManager.unregister(name);
    }

    /**
     * Get middleware by name
     * @param {string} name - Middleware name
     * @returns {IMiddleware|undefined} Middleware instance
     */
    getMiddleware(name) {
        return this.middlewareManager.get(name);
    }

    /**
     * Process input through the pipeline
     * @param {Object} input - Input data
     * @param {string} processorType - Type of processor to use
     * @param {Object} context - Processing context
     * @returns {Promise<Object>} Processing result
     */
    async process(input, processorType, context = {}) {
        const startTime = performance.now();

        try {
            // Get processor
            const processor = this.processors.get(processorType);
            if (!processor) {
                throw new Error(`Processor not found: ${processorType}`);
            }

            // Create processing context
            const processContext = {
                ...context,
                id: `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                processorType,
                pipelineConfig: this.config,
                startTime,
                validationErrors: [],
                addValidationErrors: function(errors) {
                    this.validationErrors.push(...errors);
                },
                setOriginalInput: function(input) {
                    this.originalInput = input;
                }
            };

            // Emit processing start event
            this.eventBus.emitProcessingStart(processorType, input.content?.length || 0, processContext.id);

            // Create middleware execution chain
            const executeChain = this.middlewareManager.createExecutionChain(processContext);
            
            // Execute processor through middleware chain
            const result = await this.processWithTimeout(
                executeChain(input, processor),
                this.config.timeout
            );

            // Update stats
            const processingTime = performance.now() - startTime;
            this.stats.totalProcessed++;
            this.stats.processingTime += processingTime;

            // Emit processing complete event
            this.eventBus.emitProcessingComplete(processorType, processingTime, processContext.id, {
                inputSize: input.content?.length || 0,
                outputSize: result.content?.length || 0
            });

            // Return result with metadata
            return {
                ...result,
                _pipeline: {
                    processorType,
                    processingTime,
                    timestamp: Date.now(),
                    contextId: processContext.id,
                    validationErrors: processContext.validationErrors
                }
            };

        } catch (error) {
            // Update error stats
            this.stats.totalErrors++;

            // Log error
            logger.error(`Pipeline processing failed: ${error.message}`);

            // Emit error event
            this.eventBus.emitProcessingError(processorType, error, context.id, {
                processingTime: performance.now() - startTime
            });

            // Re-throw with context
            error.pipelineContext = {
                processorType,
                processingTime: performance.now() - startTime,
                contextId: context.id
            };
            throw error;
        }
    }


    /**
     * Process with timeout
     * @private
     */
    async processWithTimeout(promise, timeout) {
        return Promise.race([
            promise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Processing timeout')), timeout)
            )
        ]);
    }

    /**
     * Get registered processor types
     * @returns {Array<string>} Processor types
     */
    getProcessorTypes() {
        return Array.from(this.processors.keys());
    }

    /**
     * Get processor by type
     * @param {string} type - Processor type
     * @returns {ITextProcessor|null} Processor instance or null
     */
    getProcessor(type) {
        return this.processors.get(type) || null;
    }

    /**
     * Configure pipeline
     * @param {Object} config - Configuration options
     * @returns {TextPipeline} This instance for chaining
     */
    configure(config) {
        this.config = { ...this.config, ...config };
        logger.log('Pipeline configured:', this.config);
        return this;
    }

    /**
     * Get pipeline statistics
     * @returns {Object} Pipeline stats
     */
    getStats() {
        return {
            ...this.stats,
            averageProcessingTime: this.stats.totalProcessed > 0
                ? this.stats.processingTime / this.stats.totalProcessed
                : 0,
            successRate: this.stats.totalProcessed > 0
                ? (this.stats.totalProcessed - this.stats.totalErrors) / this.stats.totalProcessed
                : 0
        };
    }

    /**
     * Reset pipeline statistics
     */
    resetStats() {
        this.stats = {
            totalProcessed: 0,
            totalErrors: 0,
            processingTime: 0
        };
        logger.log('Pipeline stats reset');
    }

    /**
     * Initialize pipeline, processors and middleware
     * @param {Object} config - Initialization config
     * @returns {Promise<void>}
     */
    async initialize(config = {}) {
        logger.log('Initializing pipeline...');
        
        // Initialize lifecycle manager first
        await this.lifecycleManager.init(config);
        
        // Initialize middleware manager
        await this.middlewareManager.init();
        
        // Initialize processors through lifecycle manager
        const promises = [];
        for (const [type, processor] of this.processors) {
            promises.push(
                this.lifecycleManager.initializeProcessor(type, config)
                    .then(() => logger.log(`Initialized processor: ${type}`))
                    .catch(error => logger.error(`Failed to initialize ${type}: ${error.message}`))
            );
        }

        await Promise.all(promises);
        logger.log('Pipeline initialization complete');
    }

    /**
     * Destroy pipeline and cleanup resources
     * @returns {Promise<void>}
     */
    async destroy() {
        logger.log('Destroying pipeline...');

        // Destroy lifecycle manager first (this will stop all processors)
        await this.lifecycleManager.destroy();
        
        // Destroy middleware manager
        await this.middlewareManager.destroy();
        
        this.processors.clear();
        this.resetStats();
        
        logger.log('Pipeline destroyed');
    }

    /**
     * Get middleware manager statistics
     * @returns {object} Middleware manager stats
     */
    getMiddlewareStats() {
        return this.middlewareManager.getStats();
    }

    /**
     * Get middleware health check report
     * @returns {Promise<object>} Health check report
     */
    async getMiddlewareHealth() {
        return await this.middlewareManager.healthCheck();
    }

    /**
     * Get pipeline event bus
     * @returns {PipelineEventBus} Event bus instance
     */
    getEventBus() {
        return this.eventBus;
    }

    /**
     * Get pipeline event statistics
     * @returns {object} Event statistics
     */
    getEventStats() {
        return this.eventBus.getPipelineStats();
    }

    /**
     * Get pipeline event history
     * @param {string} [eventType] - Filter by event type
     * @param {number} [limit] - Number of events to return
     * @returns {Array} Event history
     */
    getEventHistory(eventType = null, limit = 100) {
        return this.eventBus.getEventHistory(eventType, limit);
    }

    /**
     * Wait for a specific pipeline event
     * @param {string} event - Event name to wait for
     * @param {number} [timeout] - Timeout in milliseconds
     * @param {Function} [condition] - Additional condition function
     * @returns {Promise} Promise that resolves when event occurs
     */
    async waitForEvent(event, timeout = 30000, condition = null) {
        return await this.eventBus.waitForEvent(event, timeout, condition);
    }

    /**
     * Add event middleware to the pipeline event bus
     * @param {Function} middleware - Event middleware function
     */
    addEventMiddleware(middleware) {
        this.eventBus.addEventMiddleware(middleware);
    }

    /**
     * Set event filter for the pipeline event bus
     * @param {string} event - Event name
     * @param {Function} filter - Filter function
     */
    setEventFilter(event, filter) {
        this.eventBus.setEventFilter(event, filter);
    }

    /**
     * Get lifecycle manager
     * @returns {LifecycleManager} Lifecycle manager instance
     */
    getLifecycleManager() {
        return this.lifecycleManager;
    }

    /**
     * Get processor health status
     * @param {string} [name] - Specific processor name
     * @returns {Promise<object>} Health status
     */
    async getProcessorHealth(name = null) {
        return await this.lifecycleManager.performHealthCheck(name);
    }

    /**
     * Start a processor
     * @param {string} name - Processor name
     * @returns {Promise<void>}
     */
    async startProcessor(name) {
        return await this.lifecycleManager.startProcessor(name);
    }

    /**
     * Stop a processor
     * @param {string} name - Processor name
     * @returns {Promise<void>}
     */
    async stopProcessor(name) {
        return await this.lifecycleManager.stopProcessor(name);
    }

    /**
     * Restart a processor
     * @param {string} name - Processor name
     * @returns {Promise<boolean>} Success status
     */
    async restartProcessor(name) {
        return await this.lifecycleManager.restartProcessor(name);
    }

    /**
     * Pause a processor
     * @param {string} name - Processor name
     * @returns {Promise<void>}
     */
    async pauseProcessor(name) {
        return await this.lifecycleManager.pauseProcessor(name);
    }

    /**
     * Resume a processor
     * @param {string} name - Processor name
     * @returns {Promise<void>}
     */
    async resumeProcessor(name) {
        return await this.lifecycleManager.resumeProcessor(name);
    }
}