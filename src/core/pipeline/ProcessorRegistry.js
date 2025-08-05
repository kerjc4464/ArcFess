/**
 * @file ProcessorRegistry.js
 * @description Registry for managing text processor types
 * @module core/pipeline/ProcessorRegistry
 */

import { Logger } from '../../utils/Logger.js';

const logger = new Logger('ProcessorRegistry');

/**
 * Registry for text processors
 * Manages processor types and their configurations
 */
export class ProcessorRegistry {
    constructor() {
        /**
         * Map of processor types to their configurations
         * @type {Map<string, Object>}
         */
        this.processors = new Map();

        /**
         * Map of processor types to their factory functions
         * @type {Map<string, Function>}
         */
        this.factories = new Map();

        /**
         * Processor dependencies graph
         * @type {Map<string, Set<string>>}
         */
        this.dependencies = new Map();

        // Register built-in processor types
        this.registerBuiltinTypes();
    }

    /**
     * Register built-in processor types
     * @private
     */
    registerBuiltinTypes() {
        // Define standard processor types
        const builtinTypes = {
            'vectorization': {
                name: 'Vectorization',
                description: 'Convert text to vector embeddings',
                category: 'embedding',
                priority: 1
            },
            'rerank': {
                name: 'Rerank',
                description: 'Rerank search results',
                category: 'search',
                priority: 2
            },
            'summary': {
                name: 'Summary',
                description: 'Generate text summaries',
                category: 'generation',
                priority: 3
            },
            'extraction': {
                name: 'Content Extraction',
                description: 'Extract content from various sources',
                category: 'preprocessing',
                priority: 0
            }
        };

        for (const [type, config] of Object.entries(builtinTypes)) {
            this.processors.set(type, config);
        }

        logger.log(`Registered ${this.processors.size} built-in processor types`);
    }

    /**
     * Register a processor type
     * @param {string} type - Processor type identifier
     * @param {Object} config - Processor configuration
     * @param {string} config.name - Display name
     * @param {string} config.description - Description
     * @param {string} config.category - Category
     * @param {number} config.priority - Processing priority
     * @param {Function} [factory] - Factory function to create processor instance
     */
    register(type, config, factory = null) {
        if (!type || typeof type !== 'string') {
            throw new Error('Type must be a non-empty string');
        }
        if (!config || !config.name) {
            throw new Error('Config must include at least a name');
        }

        // Store configuration
        this.processors.set(type, {
            ...config,
            registeredAt: Date.now()
        });

        // Store factory if provided
        if (factory) {
            this.factories.set(type, factory);
        }

        logger.log(`Registered processor type: ${type} (${config.name})`);
    }

    /**
     * Unregister a processor type
     * @param {string} type - Processor type to remove
     * @returns {boolean} True if removed
     */
    unregister(type) {
        const removed = this.processors.delete(type);
        this.factories.delete(type);
        this.dependencies.delete(type);
        
        // Remove from other dependencies
        for (const deps of this.dependencies.values()) {
            deps.delete(type);
        }

        if (removed) {
            logger.log(`Unregistered processor type: ${type}`);
        }
        return removed;
    }

    /**
     * Get processor configuration
     * @param {string} type - Processor type
     * @returns {Object|null} Processor config or null
     */
    getConfig(type) {
        return this.processors.get(type) || null;
    }

    /**
     * Get all registered processor types
     * @returns {Array<string>} Processor types
     */
    getTypes() {
        return Array.from(this.processors.keys());
    }

    /**
     * Get processors by category
     * @param {string} category - Category to filter by
     * @returns {Array<Object>} Processors in category
     */
    getByCategory(category) {
        const results = [];
        for (const [type, config] of this.processors) {
            if (config.category === category) {
                results.push({ type, ...config });
            }
        }
        return results.sort((a, b) => (a.priority || 0) - (b.priority || 0));
    }

    /**
     * Create processor instance
     * @param {string} type - Processor type
     * @param {Object} options - Creation options
     * @returns {Promise<ITextProcessor>} Processor instance
     */
    async createProcessor(type, options = {}) {
        const factory = this.factories.get(type);
        if (!factory) {
            throw new Error(`No factory registered for type: ${type}`);
        }

        const config = this.processors.get(type);
        if (!config) {
            throw new Error(`Unknown processor type: ${type}`);
        }

        logger.log(`Creating processor instance: ${type}`);
        
        try {
            const processor = await factory(options, config);
            return processor;
        } catch (error) {
            logger.error(`Failed to create processor ${type}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Set processor dependencies
     * @param {string} type - Processor type
     * @param {Array<string>} dependencies - Required processor types
     */
    setDependencies(type, dependencies) {
        if (!this.processors.has(type)) {
            throw new Error(`Unknown processor type: ${type}`);
        }

        this.dependencies.set(type, new Set(dependencies));
        logger.log(`Set dependencies for ${type}: ${dependencies.join(', ')}`);
    }

    /**
     * Get processor dependencies
     * @param {string} type - Processor type
     * @returns {Array<string>} Required processor types
     */
    getDependencies(type) {
        const deps = this.dependencies.get(type);
        return deps ? Array.from(deps) : [];
    }

    /**
     * Check if all dependencies are satisfied
     * @param {string} type - Processor type
     * @param {Array<string>} available - Available processor types
     * @returns {boolean} True if all dependencies satisfied
     */
    areDependenciesSatisfied(type, available) {
        const deps = this.getDependencies(type);
        return deps.every(dep => available.includes(dep));
    }

    /**
     * Get processors in dependency order
     * @param {Array<string>} types - Processor types to order
     * @returns {Array<string>} Ordered processor types
     */
    getInDependencyOrder(types) {
        const result = [];
        const visited = new Set();
        const visiting = new Set();

        const visit = (type) => {
            if (visited.has(type)) return;
            if (visiting.has(type)) {
                throw new Error(`Circular dependency detected: ${type}`);
            }

            visiting.add(type);
            
            // Visit dependencies first
            const deps = this.getDependencies(type);
            for (const dep of deps) {
                if (types.includes(dep)) {
                    visit(dep);
                }
            }

            visiting.delete(type);
            visited.add(type);
            result.push(type);
        };

        // Visit all types
        for (const type of types) {
            visit(type);
        }

        return result;
    }

    /**
     * Validate processor configuration
     * @param {Object} config - Configuration to validate
     * @returns {Object} Validation result
     */
    validateConfig(config) {
        const errors = [];

        if (!config.name || typeof config.name !== 'string') {
            errors.push('Name must be a non-empty string');
        }
        if (config.category && typeof config.category !== 'string') {
            errors.push('Category must be a string');
        }
        if (config.priority !== undefined && typeof config.priority !== 'number') {
            errors.push('Priority must be a number');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Export registry data
     * @returns {Object} Registry data
     */
    export() {
        const data = {
            processors: {},
            dependencies: {}
        };

        for (const [type, config] of this.processors) {
            data.processors[type] = { ...config };
        }

        for (const [type, deps] of this.dependencies) {
            data.dependencies[type] = Array.from(deps);
        }

        return data;
    }

    /**
     * Import registry data
     * @param {Object} data - Registry data to import
     */
    import(data) {
        if (data.processors) {
            for (const [type, config] of Object.entries(data.processors)) {
                this.processors.set(type, config);
            }
        }

        if (data.dependencies) {
            for (const [type, deps] of Object.entries(data.dependencies)) {
                this.dependencies.set(type, new Set(deps));
            }
        }

        logger.log('Imported registry data');
    }
}

// Create singleton instance
export const processorRegistry = new ProcessorRegistry();