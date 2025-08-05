/**
 * @file ITextProcessor.js
 * @description Interface for text processors in the pipeline
 * @module core/pipeline/ITextProcessor
 */

/**
 * Abstract interface for text processors
 * @interface
 */
export class ITextProcessor {
    /**
     * Process the input data
     * @param {Object} input - Input data to process
     * @param {string} input.content - Text content to process
     * @param {Object} input.metadata - Additional metadata
     * @param {Object} context - Processing context
     * @param {string} context.chatId - Chat identifier
     * @param {Object} context.settings - Processing settings
     * @param {Object} context.options - Additional options
     * @returns {Promise<Object>} Processed output
     * @abstract
     */
    async process(input, context) {
        throw new Error('process() must be implemented by subclasses');
    }

    /**
     * Check if this processor can handle the given input
     * @param {Object} input - Input data to check
     * @param {Object} context - Processing context
     * @returns {boolean} True if can process
     */
    canProcess(input, context) {
        return true;
    }

    /**
     * Get processor type identifier
     * @returns {string} Processor type
     * @abstract
     */
    getType() {
        throw new Error('getType() must be implemented by subclasses');
    }

    /**
     * Get processor name for display
     * @returns {string} Processor name
     */
    getName() {
        return this.constructor.name;
    }

    /**
     * Initialize the processor
     * @param {Object} config - Processor configuration
     * @returns {Promise<void>}
     */
    async initialize(config) {
        // Optional initialization
        this._isInitialized = false;
        this._initializationTime = null;
        this._stats = {
            processCount: 0,
            errorCount: 0,
            totalProcessingTime: 0,
            lastProcessedAt: null
        };
    }

    /**
     * Cleanup processor resources
     * @returns {Promise<void>}
     */
    async destroy() {
        // Optional cleanup
        this._isInitialized = false;
    }

    /**
     * Check if processor is initialized and ready
     * @returns {boolean} True if ready
     */
    isReady() {
        return this._isInitialized === true;
    }

    /**
     * Perform health check on the processor
     * @returns {Promise<Object>} Health status
     */
    async healthCheck() {
        const baseHealth = {
            status: this.isReady() ? 'healthy' : 'not_ready',
            initialized: this._isInitialized,
            initializationTime: this._initializationTime,
            stats: this.getStats(),
            timestamp: Date.now()
        };

        // Allow subclasses to add custom health checks
        if (typeof this._customHealthCheck === 'function') {
            try {
                const customHealth = await this._customHealthCheck();
                return { ...baseHealth, ...customHealth };
            } catch (error) {
                return {
                    ...baseHealth,
                    status: 'error',
                    error: error.message
                };
            }
        }

        return baseHealth;
    }

    /**
     * Get processor statistics
     * @returns {Object} Statistics
     */
    getStats() {
        return {
            ...this._stats,
            averageProcessingTime: this._stats.processCount > 0 
                ? this._stats.totalProcessingTime / this._stats.processCount 
                : 0,
            errorRate: this._stats.processCount > 0 
                ? this._stats.errorCount / this._stats.processCount 
                : 0
        };
    }

    /**
     * Reset processor statistics
     */
    resetStats() {
        this._stats = {
            processCount: 0,
            errorCount: 0,
            totalProcessingTime: 0,
            lastProcessedAt: null
        };
    }

    /**
     * Get processor configuration schema
     * @returns {Object} Configuration schema
     */
    getConfigSchema() {
        return {
            type: 'object',
            properties: {},
            additionalProperties: true
        };
    }

    /**
     * Validate processor configuration
     * @param {Object} config - Configuration to validate
     * @returns {Object} Validation result
     */
    validateConfig(config) {
        // Basic validation - subclasses can override
        return { valid: true };
    }

    /**
     * Start processor (called after initialization)
     * @returns {Promise<void>}
     */
    async start() {
        if (!this._isInitialized) {
            throw new Error('Processor must be initialized before starting');
        }
        // Optional start hook for subclasses
    }

    /**
     * Stop processor (called before destroy)
     * @returns {Promise<void>}
     */
    async stop() {
        // Optional stop hook for subclasses
    }

    /**
     * Pause processor
     * @returns {Promise<void>}
     */
    async pause() {
        this._isPaused = true;
        // Optional pause hook for subclasses
    }

    /**
     * Resume processor
     * @returns {Promise<void>}
     */
    async resume() {
        this._isPaused = false;
        // Optional resume hook for subclasses
    }

    /**
     * Check if processor is paused
     * @returns {boolean} True if paused
     */
    isPaused() {
        return this._isPaused === true;
    }

    /**
     * Validate input before processing
     * @param {Object} input - Input to validate
     * @param {Object} context - Processing context
     * @returns {Object} Validation result
     * @returns {boolean} result.valid - Whether input is valid
     * @returns {string} [result.error] - Error message if invalid
     */
    validateInput(input, context) {
        if (!input || typeof input !== 'object') {
            return { valid: false, error: 'Input must be an object' };
        }
        if (!input.content) {
            return { valid: false, error: 'Input must have content property' };
        }
        return { valid: true };
    }
}