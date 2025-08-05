/**
 * EventManager - Centralized UI event coordination and management
 * 
 * Handles:
 * - SillyTavern lifecycle events (chat changes, message events)
 * - UI component event coordination
 * - Event delegation patterns
 * - Cross-component communication
 * - Memory-efficient event handling
 */

export class EventManager {
    constructor(dependencies = {}) {
        this.eventBus = dependencies.eventBus;
        this.eventSource = dependencies.eventSource;
        this.event_types = dependencies.event_types;
        this.progressManager = dependencies.progressManager;
        this.stateManager = dependencies.stateManager;
        
        // Event handler registry
        this.handlers = new Map();
        this.delegatedHandlers = new Map();
        
        // Event history for debugging
        this.eventHistory = [];
        this.maxHistorySize = 100;
        
        // Debounced handlers cache
        this.debouncedHandlers = new Map();
        
        this.initialized = false;
    }

    /**
     * Initialize EventManager
     */
    init() {
        if (this.initialized) {
            console.warn('EventManager: Already initialized');
            return;
        }

        try {
            this.initializeSillyTavernEvents();
            this.initializeUIEventDelegation();
            this.initializeCustomEvents();
            this.initialized = true;
            console.log('EventManager: Initialized successfully');
        } catch (error) {
            console.error('EventManager: Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Initialize SillyTavern lifecycle events
     */
    initializeSillyTavernEvents() {
        if (!this.eventSource || !this.event_types) {
            console.warn('EventManager: SillyTavern eventSource not available');
            return;
        }

        // Chat lifecycle events
        this.registerSillyTavernEvent(this.event_types.CHAT_CHANGED, (chatId) => {
            this.handleChatChanged(chatId);
        });

        this.registerSillyTavernEvent(this.event_types.CHAT_LOADED, () => {
            this.handleChatLoaded();
        });

        this.registerSillyTavernEvent(this.event_types.CHAT_DELETED, (chatId) => {
            this.handleChatDeleted(chatId);
        });

        this.registerSillyTavernEvent(this.event_types.GROUP_CHAT_DELETED, (chatId) => {
            this.handleGroupChatDeleted(chatId);
        });

        // Message lifecycle events
        this.registerSillyTavernEvent(this.event_types.MESSAGE_SENT, () => {
            this.handleMessageEvent('sent');
        });

        this.registerSillyTavernEvent(this.event_types.MESSAGE_RECEIVED, () => {
            this.handleMessageEvent('received');
        });

        this.registerSillyTavernEvent(this.event_types.MESSAGE_EDITED, () => {
            this.handleMessageEvent('edited');
        });

        this.registerSillyTavernEvent(this.event_types.MESSAGE_DELETED, () => {
            this.handleMessageEvent('deleted');
        });

        this.registerSillyTavernEvent(this.event_types.MESSAGE_SWIPED, () => {
            this.handleMessageEvent('swiped');
        });

        console.log('EventManager: SillyTavern events initialized');
    }

    /**
     * Initialize UI event delegation for better performance
     */
    initializeUIEventDelegation() {
        // Delegate button clicks within vectors enhanced sections
        this.delegateEvent('click', '[id^="vectors_enhanced_"] .menu_button', (e, target) => {
            this.handleDelegatedButtonClick(e, target);
        });

        // Delegate input changes for settings
        this.delegateEvent('change', '[id^="vectors_enhanced_"] input, [id^="vectors_enhanced_"] select, [id^="vectors_enhanced_"] textarea', (e, target) => {
            this.handleDelegatedInputChange(e, target);
        });

        // Delegate checkbox toggles
        this.delegateEvent('change', '[id^="vectors_enhanced_"] input[type="checkbox"]', (e, target) => {
            this.handleDelegatedCheckboxChange(e, target);
        });

        // Delegate radio button changes
        this.delegateEvent('change', '[id^="vectors_enhanced_"] input[type="radio"]', (e, target) => {
            this.handleDelegatedRadioChange(e, target);
        });

        console.log('EventManager: UI event delegation initialized');
    }

    /**
     * Initialize custom internal events
     */
    initializeCustomEvents() {
        if (!this.eventBus) {
            console.warn('EventManager: EventBus not available for custom events');
            return;
        }

        // Settings change events
        this.eventBus.on('settings:changed', (data) => {
            this.handleSettingsChanged(data);
        });

        // Task events
        this.eventBus.on('task:created', (data) => {
            this.handleTaskCreated(data);
        });

        this.eventBus.on('task:completed', (data) => {
            this.handleTaskCompleted(data);
        });

        this.eventBus.on('task:failed', (data) => {
            this.handleTaskFailed(data);
        });

        // Content events
        this.eventBus.on('content:selected', (data) => {
            this.handleContentSelected(data);
        });

        this.eventBus.on('content:refreshed', (data) => {
            this.handleContentRefreshed(data);
        });

        console.log('EventManager: Custom events initialized');
    }

    /**
     * Register a SillyTavern event handler
     */
    registerSillyTavernEvent(eventType, handler) {
        if (!this.eventSource) return;

        const wrappedHandler = (...args) => {
            this.logEvent('sillytavern', eventType, args);
            try {
                handler(...args);
            } catch (error) {
                console.error(`EventManager: Error in SillyTavern event handler for ${eventType}:`, error);
            }
        };

        this.eventSource.on(eventType, wrappedHandler);
        this.handlers.set(`sillytavern_${eventType}`, wrappedHandler);
    }

    /**
     * Delegate event handling for performance
     */
    delegateEvent(eventType, selector, handler) {
        const delegatedHandler = (e) => {
            if ($(e.target).is(selector) || $(e.target).closest(selector).length > 0) {
                const target = $(e.target).is(selector) ? $(e.target) : $(e.target).closest(selector);
                this.logEvent('ui', `${eventType}:${selector}`, { target: target.attr('id') || target[0].tagName });
                
                try {
                    handler.call(this, e, target);
                } catch (error) {
                    console.error(`EventManager: Error in delegated event handler for ${eventType}:${selector}:`, error);
                }
            }
        };

        $(document).on(eventType, delegatedHandler);
        this.delegatedHandlers.set(`${eventType}_${selector}`, delegatedHandler);
    }

    /**
     * Create debounced handler
     */
    createDebouncedHandler(key, handler, delay = 300) {
        if (this.debouncedHandlers.has(key)) {
            return this.debouncedHandlers.get(key);
        }

        let timeoutId;
        const debouncedHandler = (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                handler(...args);
            }, delay);
        };

        this.debouncedHandlers.set(key, debouncedHandler);
        return debouncedHandler;
    }

    /**
     * SillyTavern event handlers
     */
    handleChatChanged(chatId) {
        console.log(`EventManager: Chat changed to ${chatId}`);
        
        // Emit internal event
        if (this.eventBus) {
            this.eventBus.emit('chat:changed', { chatId });
        }

        // Update state
        if (this.stateManager) {
            this.stateManager.updateChatState(chatId);
        }
    }

    handleChatLoaded() {
        console.log('EventManager: Chat loaded');
        
        // Emit internal event
        if (this.eventBus) {
            this.eventBus.emit('chat:loaded', {});
        }

        // Refresh UI components
        this.refreshUIComponents();
    }

    handleChatDeleted(chatId) {
        console.log(`EventManager: Chat deleted: ${chatId}`);
        
        // Emit internal event
        if (this.eventBus) {
            this.eventBus.emit('chat:deleted', { chatId });
        }

        // Clean up chat-specific data
        this.cleanupChatData(chatId);
    }

    handleGroupChatDeleted(chatId) {
        console.log(`EventManager: Group chat deleted: ${chatId}`);
        
        // Emit internal event  
        if (this.eventBus) {
            this.eventBus.emit('groupchat:deleted', { chatId });
        }

        // Clean up group chat data
        this.cleanupChatData(chatId);
    }

    handleMessageEvent(eventType) {
        console.debug(`EventManager: Message ${eventType}`);
        
        // Use debounced handler to avoid excessive processing
        const debouncedHandler = this.createDebouncedHandler(
            `message_${eventType}`,
            () => this.processMessageEvent(eventType),
            500
        );
        
        debouncedHandler();
    }

    processMessageEvent(eventType) {
        // Emit internal event
        if (this.eventBus) {
            this.eventBus.emit('message:changed', { eventType });
        }

        // Auto-vectorization logic would go here
        this.checkAutoVectorization(eventType);
    }

    /**
     * Delegated UI event handlers
     */
    handleDelegatedButtonClick(e, target) {
        const buttonId = target.attr('id');
        console.debug(`EventManager: Button clicked: ${buttonId}`);
        
        // Emit button click event
        if (this.eventBus) {
            this.eventBus.emit('ui:button:clicked', { 
                buttonId, 
                target: target[0] 
            });
        }
    }

    handleDelegatedInputChange(e, target) {
        const inputId = target.attr('id');
        const value = target.val();
        
        console.debug(`EventManager: Input changed: ${inputId} = ${value}`);
        
        // Emit input change event
        if (this.eventBus) {
            this.eventBus.emit('ui:input:changed', { 
                inputId, 
                value, 
                target: target[0] 
            });
        }
    }

    handleDelegatedCheckboxChange(e, target) {
        const checkboxId = target.attr('id');
        const checked = target.is(':checked');
        
        console.debug(`EventManager: Checkbox changed: ${checkboxId} = ${checked}`);
        
        // Emit checkbox change event
        if (this.eventBus) {
            this.eventBus.emit('ui:checkbox:changed', { 
                checkboxId, 
                checked, 
                target: target[0] 
            });
        }
    }

    handleDelegatedRadioChange(e, target) {
        const radioId = target.attr('id');
        const value = target.val();
        const name = target.attr('name');
        
        console.debug(`EventManager: Radio changed: ${name} = ${value}`);
        
        // Emit radio change event
        if (this.eventBus) {
            this.eventBus.emit('ui:radio:changed', { 
                radioId, 
                name, 
                value, 
                target: target[0] 
            });
        }
    }

    /**
     * Custom event handlers
     */
    handleSettingsChanged(data) {
        console.debug('EventManager: Settings changed:', data);
        
        // Update UI state based on settings
        if (this.stateManager) {
            this.stateManager.syncWithSettings(data);
        }
    }

    handleTaskCreated(data) {
        console.log('EventManager: Task created:', data);
        
        // Show progress if needed
        if (this.progressManager && data.showProgress) {
            this.progressManager.show(0, 100, data.message || '任务开始...');
        }
    }

    handleTaskCompleted(data) {
        console.log('EventManager: Task completed:', data);
        
        // Complete progress if active
        if (this.progressManager && this.progressManager.isVisible()) {
            this.progressManager.complete(data.message || '任务完成');
        }
    }

    handleTaskFailed(data) {
        console.error('EventManager: Task failed:', data);
        
        // Show error in progress if active
        if (this.progressManager && this.progressManager.isVisible()) {
            this.progressManager.error(data.message || '任务失败');
        }
    }

    handleContentSelected(data) {
        console.debug('EventManager: Content selected:', data);
        
        // Update state
        if (this.stateManager) {
            this.stateManager.updateContentSelection(data);
        }
    }

    handleContentRefreshed(data) {
        console.debug('EventManager: Content refreshed:', data);
        
        // Refresh related UI components
        this.refreshUIComponents(data.contentType);
    }

    /**
     * Utility methods
     */
    refreshUIComponents(specific = null) {
        console.debug(`EventManager: Refreshing UI components${specific ? ` (${specific})` : ''}`);
        
        // Emit refresh event
        if (this.eventBus) {
            this.eventBus.emit('ui:refresh', { specific });
        }
    }

    cleanupChatData(chatId) {
        console.debug(`EventManager: Cleaning up data for chat: ${chatId}`);
        
        // Emit cleanup event
        if (this.eventBus) {
            this.eventBus.emit('data:cleanup', { chatId });
        }
    }

    checkAutoVectorization(eventType) {
        // Auto-vectorization logic
        console.debug(`EventManager: Checking auto-vectorization for ${eventType}`);
        
        // This would integrate with settings to determine if auto-vectorization should trigger
        if (this.eventBus) {
            this.eventBus.emit('auto:vectorization:check', { eventType });
        }
    }

    /**
     * Event logging for debugging
     */
    logEvent(source, type, data) {
        const logEntry = {
            timestamp: Date.now(),
            source,
            type,
            data
        };

        this.eventHistory.unshift(logEntry);
        
        // Keep history size manageable
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory = this.eventHistory.slice(0, this.maxHistorySize);
        }

        console.debug(`EventManager: ${source}:${type}`, data);
    }

    /**
     * Get event statistics
     */
    getEventStats() {
        const stats = {
            totalEvents: this.eventHistory.length,
            bySource: {},
            byType: {},
            recentEvents: this.eventHistory.slice(0, 10)
        };

        this.eventHistory.forEach(event => {
            stats.bySource[event.source] = (stats.bySource[event.source] || 0) + 1;
            stats.byType[event.type] = (stats.byType[event.type] || 0) + 1;
        });

        return stats;
    }

    /**
     * Clear event history
     */
    clearEventHistory() {
        this.eventHistory = [];
        console.log('EventManager: Event history cleared');
    }

    /**
     * Cleanup - remove all event listeners
     */
    destroy() {
        console.log('EventManager: Destroying...');

        // Remove SillyTavern event handlers
        if (this.eventSource) {
            this.handlers.forEach((handler, key) => {
                const eventType = key.replace('sillytavern_', '');
                this.eventSource.off(eventType, handler);
            });
        }

        // Remove delegated event handlers
        this.delegatedHandlers.forEach((handler, key) => {
            const [eventType] = key.split('_');
            $(document).off(eventType, handler);
        });

        // Remove custom event handlers
        if (this.eventBus) {
            this.eventBus.off('settings:changed');
            this.eventBus.off('task:created');
            this.eventBus.off('task:completed');
            this.eventBus.off('task:failed');
            this.eventBus.off('content:selected');
            this.eventBus.off('content:refreshed');
        }

        // Clear all collections
        this.handlers.clear();
        this.delegatedHandlers.clear();
        this.debouncedHandlers.clear();
        this.clearEventHistory();

        this.initialized = false;
        console.log('EventManager: Destroyed');
    }
}