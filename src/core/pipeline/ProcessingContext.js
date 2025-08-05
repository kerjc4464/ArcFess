/**
 * @file ProcessingContext.js
 * @description Context object for pipeline processing
 * @module core/pipeline/ProcessingContext
 */

import { Logger } from '../../utils/Logger.js';

const logger = new Logger('ProcessingContext');

/**
 * Context object that carries information through the processing pipeline
 */
export class ProcessingContext {
    /**
     * @param {Object} params - Context parameters
     * @param {string} params.chatId - Chat identifier
     * @param {Object} params.user - User information
     * @param {Object} params.settings - Processing settings
     * @param {Object} params.metadata - Additional metadata
     */
    constructor(params = {}) {
        // Core properties
        this.id = this.generateId();
        this.chatId = params.chatId || null;
        this.user = params.user || {};
        this.settings = params.settings || {};
        this.metadata = params.metadata || {};
        
        // Timing information
        this.createdAt = Date.now();
        this.startTime = null;
        this.endTime = null;
        
        // Processing state
        this.state = 'initialized';
        this.currentProcessor = null;
        this.processingChain = [];
        
        // Data accumulation
        this.data = new Map();
        this.errors = [];
        this.warnings = [];
        this.logs = [];
        
        // Feature flags
        this.features = {
            enableLogging: true,
            enableMetrics: true,
            enableValidation: true,
            ...params.features
        };

        logger.log(`Context created: ${this.id}`);
    }

    /**
     * Generate unique context ID
     * @private
     */
    generateId() {
        return `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Start processing
     * @param {string} processorName - Name of the processor
     */
    startProcessing(processorName) {
        this.startTime = Date.now();
        this.state = 'processing';
        this.currentProcessor = processorName;
        this.processingChain.push({
            processor: processorName,
            startTime: this.startTime,
            endTime: null
        });
        
        this.log(`Started processing with ${processorName}`);
    }

    /**
     * End processing
     * @param {boolean} success - Whether processing was successful
     */
    endProcessing(success = true) {
        this.endTime = Date.now();
        this.state = success ? 'completed' : 'failed';
        
        if (this.processingChain.length > 0) {
            const current = this.processingChain[this.processingChain.length - 1];
            current.endTime = this.endTime;
            current.duration = this.endTime - current.startTime;
            current.success = success;
        }
        
        this.currentProcessor = null;
        this.log(`Ended processing: ${this.state}`);
    }

    /**
     * Get processing duration
     * @returns {number|null} Duration in milliseconds
     */
    getDuration() {
        if (this.startTime && this.endTime) {
            return this.endTime - this.startTime;
        }
        if (this.startTime) {
            return Date.now() - this.startTime;
        }
        return null;
    }

    /**
     * Store data in context
     * @param {string} key - Data key
     * @param {*} value - Data value
     * @returns {ProcessingContext} This instance for chaining
     */
    set(key, value) {
        this.data.set(key, {
            value,
            timestamp: Date.now(),
            processor: this.currentProcessor
        });
        return this;
    }

    /**
     * Get data from context
     * @param {string} key - Data key
     * @param {*} defaultValue - Default value if not found
     * @returns {*} Data value
     */
    get(key, defaultValue = undefined) {
        const entry = this.data.get(key);
        return entry ? entry.value : defaultValue;
    }

    /**
     * Check if data exists
     * @param {string} key - Data key
     * @returns {boolean} True if exists
     */
    has(key) {
        return this.data.has(key);
    }

    /**
     * Delete data from context
     * @param {string} key - Data key
     * @returns {boolean} True if deleted
     */
    delete(key) {
        return this.data.delete(key);
    }

    /**
     * Add error to context
     * @param {Error|string} error - Error object or message
     * @param {Object} details - Additional error details
     */
    addError(error, details = {}) {
        const errorEntry = {
            message: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : null,
            processor: this.currentProcessor,
            timestamp: Date.now(),
            details
        };
        
        this.errors.push(errorEntry);
        logger.error(`Context error: ${errorEntry.message}`);
    }

    /**
     * Add warning to context
     * @param {string} message - Warning message
     * @param {Object} details - Additional warning details
     */
    addWarning(message, details = {}) {
        const warningEntry = {
            message,
            processor: this.currentProcessor,
            timestamp: Date.now(),
            details
        };
        
        this.warnings.push(warningEntry);
        logger.warn(`Context warning: ${message}`);
    }

    /**
     * Add log entry
     * @param {string} message - Log message
     * @param {string} level - Log level
     */
    log(message, level = 'info') {
        if (!this.features.enableLogging) return;

        const logEntry = {
            message,
            level,
            processor: this.currentProcessor,
            timestamp: Date.now()
        };
        
        this.logs.push(logEntry);
    }

    /**
     * Get all data as plain object
     * @returns {Object} Context data
     */
    getData() {
        const data = {};
        for (const [key, entry] of this.data) {
            data[key] = entry.value;
        }
        return data;
    }

    /**
     * Get processing metrics
     * @returns {Object} Processing metrics
     */
    getMetrics() {
        if (!this.features.enableMetrics) return null;

        return {
            contextId: this.id,
            duration: this.getDuration(),
            state: this.state,
            processorsUsed: this.processingChain.length,
            processingChain: this.processingChain.map(p => ({
                processor: p.processor,
                duration: p.duration,
                success: p.success
            })),
            errorCount: this.errors.length,
            warningCount: this.warnings.length,
            dataEntries: this.data.size
        };
    }

    /**
     * Create child context
     * @param {Object} overrides - Properties to override
     * @returns {ProcessingContext} Child context
     */
    createChild(overrides = {}) {
        const child = new ProcessingContext({
            ...this.toJSON(),
            ...overrides,
            metadata: {
                ...this.metadata,
                parentId: this.id,
                ...overrides.metadata
            }
        });

        // Copy data references
        for (const [key, entry] of this.data) {
            child.data.set(key, { ...entry });
        }

        return child;
    }

    /**
     * Merge another context into this one
     * @param {ProcessingContext} other - Context to merge
     * @param {Object} options - Merge options
     */
    merge(other, options = {}) {
        const { overwriteData = false, mergeErrors = true } = options;

        // Merge data
        for (const [key, entry] of other.data) {
            if (!this.data.has(key) || overwriteData) {
                this.data.set(key, { ...entry });
            }
        }

        // Merge errors and warnings
        if (mergeErrors) {
            this.errors.push(...other.errors);
            this.warnings.push(...other.warnings);
        }

        // Merge processing chain
        this.processingChain.push(...other.processingChain);
    }

    /**
     * Convert to JSON
     * @returns {Object} JSON representation
     */
    toJSON() {
        return {
            id: this.id,
            chatId: this.chatId,
            user: this.user,
            settings: this.settings,
            metadata: this.metadata,
            state: this.state,
            createdAt: this.createdAt,
            features: this.features,
            data: this.getData(),
            metrics: this.getMetrics()
        };
    }

    /**
     * Create context from JSON
     * @param {Object} json - JSON data
     * @returns {ProcessingContext} Context instance
     */
    static fromJSON(json) {
        const context = new ProcessingContext(json);
        
        // Restore data
        if (json.data) {
            for (const [key, value] of Object.entries(json.data)) {
                context.set(key, value);
            }
        }

        return context;
    }
}