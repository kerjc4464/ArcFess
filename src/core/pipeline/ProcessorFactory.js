/**
 * @file ProcessorFactory.js
 * @description Factory for creating processor instances
 * @module core/pipeline/ProcessorFactory
 */

import { Logger } from '../../utils/Logger.js';
import { VectorizationProcessor } from './processors/VectorizationProcessor.js';
import { processorRegistry } from './ProcessorRegistry.js';

const logger = new Logger('ProcessorFactory');

/**
 * Factory class for creating text processor instances
 */
export class ProcessorFactory {
    constructor() {
        /**
         * Map of processor constructors
         * @type {Map<string, Function>}
         */
        this.constructors = new Map();

        /**
         * Map of singleton instances
         * @type {Map<string, ITextProcessor>}
         */
        this.singletons = new Map();

        // Register default processor constructors
        this.registerDefaults();
    }

    /**
     * Register default processor constructors
     * @private
     */
    registerDefaults() {
        // Register vectorization processor factory
        this.registerConstructor('vectorization', (options) => {
            // Get the existing VectorizationAdapter from the global context
            // This assumes the adapter is available globally (as it is in current code)
            const adapter = options.adapter || window.vectorizationAdapter;
            
            if (!adapter) {
                throw new Error('VectorizationAdapter not available');
            }

            return new VectorizationProcessor(adapter);
        });

        logger.log('Default processor constructors registered');
    }

    /**
     * Register a processor constructor
     * @param {string} type - Processor type
     * @param {Function} constructor - Constructor function
     */
    registerConstructor(type, constructor) {
        if (typeof constructor !== 'function') {
            throw new Error(`Constructor for ${type} must be a function`);
        }

        this.constructors.set(type, constructor);
        
        // Also register with the registry
        processorRegistry.factories.set(type, async (options, config) => {
            return this.create(type, options);
        });

        logger.log(`Registered constructor for: ${type}`);
    }

    /**
     * Create a processor instance
     * @param {string} type - Processor type
     * @param {Object} options - Creation options
     * @param {boolean} options.singleton - Whether to use singleton pattern
     * @returns {ITextProcessor} Processor instance
     */
    create(type, options = {}) {
        // Check if singleton is requested and exists
        if (options.singleton && this.singletons.has(type)) {
            logger.log(`Returning singleton instance for: ${type}`);
            return this.singletons.get(type);
        }

        // Get constructor
        const constructor = this.constructors.get(type);
        if (!constructor) {
            throw new Error(`No constructor registered for processor type: ${type}`);
        }

        logger.log(`Creating new processor instance: ${type}`);

        try {
            // Create instance
            const instance = constructor(options);

            // Store as singleton if requested
            if (options.singleton) {
                this.singletons.set(type, instance);
            }

            return instance;

        } catch (error) {
            logger.error(`Failed to create processor ${type}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Create multiple processor instances
     * @param {Array<Object>} specs - Array of processor specifications
     * @returns {Array<ITextProcessor>} Array of processor instances
     */
    createMultiple(specs) {
        const instances = [];

        for (const spec of specs) {
            try {
                const instance = this.create(spec.type, spec.options);
                instances.push(instance);
            } catch (error) {
                logger.error(`Failed to create ${spec.type}: ${error.message}`);
                if (!spec.optional) {
                    throw error;
                }
            }
        }

        return instances;
    }

    /**
     * Create processor with dependencies
     * @param {string} type - Processor type
     * @param {Object} options - Creation options
     * @param {TextPipeline} pipeline - Pipeline to register processors with
     * @returns {Promise<ITextProcessor>} Processor instance
     */
    async createWithDependencies(type, options, pipeline) {
        // Get dependencies from registry
        const dependencies = processorRegistry.getDependencies(type);
        
        if (dependencies.length > 0) {
            logger.log(`Creating dependencies for ${type}: ${dependencies.join(', ')}`);
            
            // Create and register dependencies first
            for (const depType of dependencies) {
                if (!pipeline.getProcessor(depType)) {
                    const depProcessor = await this.createWithDependencies(depType, options, pipeline);
                    pipeline.registerProcessor(depType, depProcessor);
                }
            }
        }

        // Create the main processor
        const processor = this.create(type, options);
        
        return processor;
    }

    /**
     * Get or create a processor
     * @param {string} type - Processor type
     * @param {Object} options - Creation options
     * @returns {ITextProcessor} Processor instance
     */
    getOrCreate(type, options = {}) {
        // Always use singleton for this method
        const singletonOptions = { ...options, singleton: true };
        return this.create(type, singletonOptions);
    }

    /**
     * Check if processor type is available
     * @param {string} type - Processor type
     * @returns {boolean} True if available
     */
    isAvailable(type) {
        return this.constructors.has(type);
    }

    /**
     * Get available processor types
     * @returns {Array<string>} Processor types
     */
    getAvailableTypes() {
        return Array.from(this.constructors.keys());
    }

    /**
     * Clear singleton instances
     * @param {string} [type] - Specific type to clear, or all if not specified
     */
    clearSingletons(type = null) {
        if (type) {
            const deleted = this.singletons.delete(type);
            if (deleted) {
                logger.log(`Cleared singleton: ${type}`);
            }
        } else {
            const count = this.singletons.size;
            this.singletons.clear();
            logger.log(`Cleared ${count} singleton instances`);
        }
    }

    /**
     * Create a lazy processor that initializes on first use
     * @param {string} type - Processor type
     * @param {Object} options - Creation options
     * @returns {Object} Lazy processor proxy
     */
    createLazy(type, options = {}) {
        let instance = null;

        return new Proxy({}, {
            get(target, prop) {
                // Initialize on first access
                if (!instance) {
                    logger.log(`Lazy initializing processor: ${type}`);
                    instance = factory.create(type, options);
                }
                
                // Forward property access
                return instance[prop];
            }
        });
    }
}

// Create singleton factory instance
export const processorFactory = new ProcessorFactory();

// Also export the class for testing or custom factories
export { ProcessorFactory as ProcessorFactoryClass };