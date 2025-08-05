/**
 * StateManager - Centralized UI state management and synchronization
 * 
 * Handles:
 * - UI component state coordination
 * - Settings ↔ UI synchronization
 * - Form validation states
 * - Loading/disabled states
 * - Selection states
 * - Undo/Redo capabilities
 * - State persistence
 */

export class StateManager {
    constructor(dependencies = {}) {
        this.eventBus = dependencies.eventBus;
        this.settings = dependencies.settings;
        this.configManager = dependencies.configManager;
        
        // State stores
        this.uiState = {
            isLoading: false,
            currentChat: null,
            selectedContent: {
                chat: { enabled: false, items: [] },
                files: { enabled: false, items: [] },
                worldInfo: { enabled: false, items: [] }
            },
            formValidation: new Map(),
            componentStates: new Map(),
            panelVisibility: new Map()
        };
        
        // State history for undo/redo
        this.stateHistory = [];
        this.currentHistoryIndex = -1;
        this.maxHistorySize = 50;
        
        // Synchronization queue
        this.syncQueue = [];
        this.isSyncing = false;
        
        // Watchers for automatic state updates
        this.watchers = new Map();
        
        this.initialized = false;
    }

    /**
     * Initialize StateManager
     */
    init() {
        if (this.initialized) {
            console.warn('StateManager: Already initialized');
            return;
        }

        try {
            this.initializeState();
            this.bindEventListeners();
            this.setupWatchers();
            this.initialized = true;
            console.log('StateManager: Initialized successfully');
        } catch (error) {
            console.error('StateManager: Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Initialize initial state from settings and DOM
     */
    initializeState() {
        // Initialize from settings
        if (this.settings) {
            this.syncFromSettings();
        }

        // Initialize UI states
        this.initializeUIStates();
        
        // Save initial state
        this.saveStateSnapshot('initial');

        console.log('StateManager: Initial state initialized');
    }

    /**
     * Initialize UI component states
     */
    initializeUIStates() {
        // Panel visibility states
        this.uiState.panelVisibility.set('vectorization', true);
        this.uiState.panelVisibility.set('query', true);
        this.uiState.panelVisibility.set('injection', true);
        this.uiState.panelVisibility.set('content', true);
        
        // Component states
        this.uiState.componentStates.set('actionButtons', {
            preview: { enabled: true, loading: false },
            export: { enabled: true, loading: false },
            vectorize: { enabled: true, loading: false },
            abort: { enabled: false, loading: false }
        });
        
        this.uiState.componentStates.set('progress', {
            visible: false,
            current: 0,
            total: 0,
            message: ''
        });

        console.debug('StateManager: UI states initialized');
    }

    /**
     * Bind event listeners
     */
    bindEventListeners() {
        if (!this.eventBus) {
            console.warn('StateManager: EventBus not available');
            return;
        }

        // Settings synchronization
        this.eventBus.on('settings:changed', (data) => {
            this.handleSettingsChanged(data);
        });

        // UI state changes
        this.eventBus.on('ui:state:update', (data) => {
            this.updateComponentState(data.component, data.state);
        });

        // Content selection changes
        this.eventBus.on('content:selected', (data) => {
            this.updateContentSelection(data);
        });

        // Chat events
        this.eventBus.on('chat:changed', (data) => {
            this.updateChatState(data.chatId);
        });

        this.eventBus.on('chat:loaded', () => {
            this.refreshContentStates();
        });

        // Form validation events
        this.eventBus.on('form:validation', (data) => {
            this.updateFormValidation(data.field, data.validation);
        });

        console.log('StateManager: Event listeners bound');
    }

    /**
     * Setup automatic state watchers
     */
    setupWatchers() {
        // Watch for DOM changes that affect state
        this.addWatcher('masterSwitch', () => {
            return $('#vectors_enhanced_master_enabled').is(':checked');
        }, (newValue, oldValue) => {
            if (newValue !== oldValue) {
                this.updateMasterSwitchState(newValue);
            }
        });

        // Watch for content type toggles
        ['chat', 'files', 'wi'].forEach(type => {
            this.addWatcher(`content_${type}`, () => {
                return $(`#vectors_enhanced_${type}_enabled`).is(':checked');
            }, (newValue, oldValue) => {
                if (newValue !== oldValue) {
                    this.updateContentTypeState(type, newValue);
                }
            });
        });

        console.log('StateManager: Watchers setup complete');
    }

    /**
     * Add a state watcher
     */
    addWatcher(key, getter, callback) {
        this.watchers.set(key, {
            getter,
            callback,
            lastValue: getter()
        });
    }

    /**
     * Check all watchers for changes
     */
    checkWatchers() {
        this.watchers.forEach((watcher, key) => {
            try {
                const currentValue = watcher.getter();
                if (currentValue !== watcher.lastValue) {
                    watcher.callback(currentValue, watcher.lastValue);
                    watcher.lastValue = currentValue;
                }
            } catch (error) {
                console.error(`StateManager: Error in watcher ${key}:`, error);
            }
        });
    }

    /**
     * State management methods
     */
    updateComponentState(componentName, newState) {
        const currentState = this.uiState.componentStates.get(componentName) || {};
        const updatedState = { ...currentState, ...newState };
        
        this.uiState.componentStates.set(componentName, updatedState);
        
        // Emit state change event
        if (this.eventBus) {
            this.eventBus.emit('state:component:updated', {
                component: componentName,
                state: updatedState
            });
        }

        console.debug(`StateManager: Component state updated - ${componentName}:`, updatedState);
    }

    updateContentSelection(data) {
        const { type, enabled, items } = data;
        
        if (this.uiState.selectedContent[type]) {
            this.uiState.selectedContent[type].enabled = enabled;
            if (items !== undefined) {
                this.uiState.selectedContent[type].items = [...items];
            }
        }

        // Update UI visibility
        this.updateContentVisibility(type, enabled);
        
        // Save state change
        this.saveStateSnapshot(`content_${type}_${enabled ? 'enabled' : 'disabled'}`);

        console.debug(`StateManager: Content selection updated - ${type}:`, { enabled, itemCount: items?.length || 0 });
    }

    updateChatState(chatId) {
        const previousChat = this.uiState.currentChat;
        this.uiState.currentChat = chatId;
        
        // Clear chat-specific states when chat changes
        if (previousChat !== chatId) {
            this.clearChatSpecificStates();
        }

        console.log(`StateManager: Chat state updated - ${chatId}`);
    }

    updateFormValidation(field, validation) {
        this.uiState.formValidation.set(field, validation);
        
        // Apply validation styling
        this.applyValidationStyling(field, validation);
        
        // Emit validation update
        if (this.eventBus) {
            this.eventBus.emit('state:validation:updated', {
                field,
                validation
            });
        }

        console.debug(`StateManager: Form validation updated - ${field}:`, validation);
    }

    updateLoadingState(isLoading, message = '') {
        this.uiState.isLoading = isLoading;
        
        // Update UI elements
        this.applyLoadingState(isLoading, message);
        
        // Update component states
        this.updateComponentState('actionButtons', {
            preview: { enabled: !isLoading },
            export: { enabled: !isLoading },
            vectorize: { enabled: !isLoading },
            abort: { enabled: isLoading }
        });

        console.debug(`StateManager: Loading state updated - ${isLoading}`, message);
    }

    /**
     * Settings synchronization
     */
    syncFromSettings() {
        if (!this.settings) return;

        // Sync content selection from settings
        const contentTypes = ['chat', 'files', 'world_info'];
        contentTypes.forEach(type => {
            const settingsKey = type === 'world_info' ? 'wi' : type;
            const enabled = this.getNestedProperty(this.settings, `selected_content.${type}.enabled`);
            
            if (enabled !== undefined) {
                this.uiState.selectedContent[settingsKey] = {
                    enabled,
                    items: []
                };
            }
        });

        console.debug('StateManager: Synced from settings');
    }

    syncToSettings() {
        if (!this.settings || !this.configManager) return;

        // Add to sync queue to avoid excessive updates
        this.queueSync(() => {
            Object.entries(this.uiState.selectedContent).forEach(([type, state]) => {
                const settingsType = type === 'wi' ? 'world_info' : type;
                this.setNestedProperty(this.settings, `selected_content.${settingsType}.enabled`, state.enabled);
            });

            console.debug('StateManager: Synced to settings');
        });
    }

    queueSync(syncFunction) {
        this.syncQueue.push(syncFunction);
        
        if (!this.isSyncing) {
            this.processSyncQueue();
        }
    }

    async processSyncQueue() {
        if (this.syncQueue.length === 0) return;
        
        this.isSyncing = true;
        
        try {
            while (this.syncQueue.length > 0) {
                const syncFunction = this.syncQueue.shift();
                await syncFunction();
            }
        } catch (error) {
            console.error('StateManager: Error processing sync queue:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * UI state application methods
     */
    updateContentVisibility(type, enabled) {
        const settingsSelector = `#vectors_enhanced_${type}_settings`;
        const settingsElement = $(settingsSelector);
        
        if (settingsElement.length > 0) {
            if (enabled) {
                settingsElement.show().addClass('active');
            } else {
                settingsElement.hide().removeClass('active');
            }
        }
    }

    updateMasterSwitchState(enabled) {
        // Update all dependent UI elements
        const mainContainer = $('#vectors_enhanced_settings');
        if (mainContainer.length > 0) {
            if (enabled) {
                mainContainer.removeClass('disabled');
            } else {
                mainContainer.addClass('disabled');
            }
        }

        // Update component states
        this.updateComponentState('masterSwitch', { enabled });
    }

    updateContentTypeState(type, enabled) {
        this.updateContentSelection({
            type,
            enabled,
            items: this.uiState.selectedContent[type]?.items || []
        });
    }

    applyValidationStyling(field, validation) {
        const fieldElement = $(`#${field}`);
        if (fieldElement.length === 0) return;

        // Remove existing validation classes
        fieldElement.removeClass('vectors-input-error vectors-input-success');
        
        // Apply appropriate class
        if (validation.isValid === false) {
            fieldElement.addClass('vectors-input-error');
        } else if (validation.isValid === true) {
            fieldElement.addClass('vectors-input-success');
        }

        // Show/hide validation message
        this.updateValidationMessage(field, validation);
    }

    updateValidationMessage(field, validation) {
        const fieldElement = $(`#${field}`);
        const existingMessage = fieldElement.next('.vectors-validation-message');
        
        if (validation.message) {
            const messageClass = validation.isValid ? 'vectors-validation-success' : 'vectors-validation-error';
            const messageHTML = `<div class="vectors-validation-message ${messageClass}">${validation.message}</div>`;
            
            if (existingMessage.length > 0) {
                existingMessage.replaceWith(messageHTML);
            } else {
                fieldElement.after(messageHTML);
            }
        } else {
            existingMessage.remove();
        }
    }

    applyLoadingState(isLoading, message) {
        // Update action buttons
        const actionButtons = $('.vectors-enhanced-actions .menu_button');
        if (isLoading) {
            actionButtons.not('#vectors_enhanced_abort').prop('disabled', true).addClass('vectors-btn-disabled');
            $('#vectors_enhanced_abort').prop('disabled', false).removeClass('vectors-btn-disabled').show();
        } else {
            actionButtons.prop('disabled', false).removeClass('vectors-btn-disabled');
            $('#vectors_enhanced_abort').hide();
        }

        // Update form elements
        const formElements = $('#vectors_enhanced_settings input, #vectors_enhanced_settings select, #vectors_enhanced_settings textarea');
        formElements.prop('disabled', isLoading);
    }

    /**
     * State history and undo/redo
     */
    saveStateSnapshot(description = '') {
        const snapshot = {
            timestamp: Date.now(),
            description,
            state: JSON.parse(JSON.stringify(this.uiState))
        };

        // Remove any states after current index (for redo functionality)
        this.stateHistory = this.stateHistory.slice(0, this.currentHistoryIndex + 1);
        
        // Add new snapshot
        this.stateHistory.push(snapshot);
        this.currentHistoryIndex = this.stateHistory.length - 1;

        // Keep history size manageable
        if (this.stateHistory.length > this.maxHistorySize) {
            this.stateHistory = this.stateHistory.slice(-this.maxHistorySize);
            this.currentHistoryIndex = this.stateHistory.length - 1;
        }

        console.debug(`StateManager: State snapshot saved - ${description}`);
    }

    undo() {
        if (this.currentHistoryIndex > 0) {
            this.currentHistoryIndex--;
            const snapshot = this.stateHistory[this.currentHistoryIndex];
            this.restoreState(snapshot.state);
            console.log(`StateManager: Undo to ${snapshot.description}`);
            return true;
        }
        return false;
    }

    redo() {
        if (this.currentHistoryIndex < this.stateHistory.length - 1) {
            this.currentHistoryIndex++;
            const snapshot = this.stateHistory[this.currentHistoryIndex];
            this.restoreState(snapshot.state);
            console.log(`StateManager: Redo to ${snapshot.description}`);
            return true;
        }
        return false;
    }

    restoreState(state) {
        this.uiState = JSON.parse(JSON.stringify(state));
        this.applyStateToUI();
        
        if (this.eventBus) {
            this.eventBus.emit('state:restored', { state: this.uiState });
        }
    }

    applyStateToUI() {
        // Apply content selection states
        Object.entries(this.uiState.selectedContent).forEach(([type, state]) => {
            const checkbox = $(`#vectors_enhanced_${type}_enabled`);
            checkbox.prop('checked', state.enabled);
            this.updateContentVisibility(type, state.enabled);
        });

        // Apply component states
        this.uiState.componentStates.forEach((state, component) => {
            if (this.eventBus) {
                this.eventBus.emit('state:component:apply', { component, state });
            }
        });

        // Apply form validation
        this.uiState.formValidation.forEach((validation, field) => {
            this.applyValidationStyling(field, validation);
        });

        console.debug('StateManager: State applied to UI');
    }

    /**
     * Utility methods
     */
    clearChatSpecificStates() {
        // Clear content selections
        Object.keys(this.uiState.selectedContent).forEach(type => {
            this.uiState.selectedContent[type].items = [];
        });

        // Clear form validation
        this.uiState.formValidation.clear();

        console.debug('StateManager: Chat-specific states cleared');
    }

    refreshContentStates() {
        // Trigger refresh of content lists
        if (this.eventBus) {
            this.eventBus.emit('content:refresh:all', {});
        }

        console.debug('StateManager: Content states refreshed');
    }

    getNestedProperty(obj, path) {
        return path.split('.').reduce((current, key) => current && current[key], obj);
    }

    setNestedProperty(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((current, key) => {
            if (!current[key]) current[key] = {};
            return current[key];
        }, obj);
        target[lastKey] = value;
    }

    /**
     * Event handlers
     */
    handleSettingsChanged(data) {
        console.debug('StateManager: Settings changed:', data);
        
        // Queue sync from settings
        this.queueSync(() => this.syncFromSettings());
    }

    /**
     * Public API methods
     */
    getState() {
        return JSON.parse(JSON.stringify(this.uiState));
    }

    getComponentState(componentName) {
        return this.uiState.componentStates.get(componentName);
    }

    getContentSelection() {
        return { ...this.uiState.selectedContent };
    }

    getFormValidation() {
        return new Map(this.uiState.formValidation);
    }

    isLoading() {
        return this.uiState.isLoading;
    }

    canUndo() {
        return this.currentHistoryIndex > 0;
    }

    canRedo() {
        return this.currentHistoryIndex < this.stateHistory.length - 1;
    }

    /**
     * Cleanup
     */
    destroy() {
        console.log('StateManager: Destroying...');

        if (this.eventBus) {
            this.eventBus.off('settings:changed');
            this.eventBus.off('ui:state:update');
            this.eventBus.off('content:selected');
            this.eventBus.off('chat:changed');
            this.eventBus.off('chat:loaded');
            this.eventBus.off('form:validation');
        }

        // Clear all state
        this.uiState = null;
        this.stateHistory = [];
        this.watchers.clear();
        this.syncQueue = [];

        this.initialized = false;
        console.log('StateManager: Destroyed');
    }
}