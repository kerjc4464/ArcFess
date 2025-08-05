/**
 * SettingsPanel Component - Manages the main settings panel architecture
 *
 * Extracted from index.js template loading logic to centralize settings management
 * Coordinates between sub-components for different settings sections
 */

export class SettingsPanel {
    constructor(dependencies = {}) {
        this.renderExtensionTemplateAsync = dependencies.renderExtensionTemplateAsync;
        this.targetSelector = dependencies.targetSelector || '#extensions_settings2';

        // Sub-components (will be initialized as we create them)
        this.subComponents = {
            vectorizationSettings: null,
            querySettings: null,
            contentSelectionSettings: null
        };

        this.initialized = false;
        this.templateLoaded = false;
    }

    /**
     * Initialize the SettingsPanel - load template and initialize sub-components
     */
    async init() {
        if (this.initialized) {
            console.warn('SettingsPanel: Already initialized');
            return;
        }

        try {
            await this.loadTemplate();
            await this.initializeSubComponents();
            this.initialized = true;
            console.log('SettingsPanel: Initialized successfully');
        } catch (error) {
            console.error('SettingsPanel: Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Load the main settings template
     */
    async loadTemplate() {
        if (this.templateLoaded) {
            console.warn('SettingsPanel: Template already loaded');
            return;
        }

        try {
            console.log('SettingsPanel: Loading template...');

            // Use the same template loading logic as the original
            // Note: Using 'settings-modular' instead of 'settings' for the new modular template
            const template = await this.renderExtensionTemplateAsync('third-party/vectors-enhanced', 'settings-modular');
            $(this.targetSelector).append(template);
            this.templateLoaded = true;
            console.log('SettingsPanel: Template loaded and appended successfully');
        } catch (error) {
            console.error('SettingsPanel: Template loading failed:', error);
            throw new Error(`Failed to load settings template: ${error.message}`);
        }
    }

    /**
     * Initialize sub-components for different settings sections
     * TODO: Implement as we create the sub-components
     */
    async initializeSubComponents() {
        console.log('SettingsPanel: Initializing sub-components...');

        // TODO: Initialize VectorizationSettings component
        // if (VectorizationSettings) {
        //     this.subComponents.vectorizationSettings = new VectorizationSettings();
        //     await this.subComponents.vectorizationSettings.init();
        // }

        // TODO: Initialize QuerySettings component
        // if (QuerySettings) {
        //     this.subComponents.querySettings = new QuerySettings();
        //     await this.subComponents.querySettings.init();
        // }

        // TODO: Initialize InjectionSettings component
        // if (InjectionSettings) {
        //     this.subComponents.injectionSettings = new InjectionSettings();
        //     await this.subComponents.injectionSettings.init();
        // }

        // TODO: Initialize ContentSelectionSettings component
        // if (ContentSelectionSettings) {
        //     this.subComponents.contentSelectionSettings = new ContentSelectionSettings();
        //     await this.subComponents.contentSelectionSettings.init();
        // }

        console.log('SettingsPanel: Sub-components initialization completed (placeholder)');
    }

    /**
     * Refresh the settings panel - reload data without recreating the template
     */
    async refresh() {
        if (!this.initialized) {
            console.warn('SettingsPanel: Cannot refresh - not initialized');
            return;
        }

        console.log('SettingsPanel: Refreshing...');

        // Refresh all sub-components
        for (const [name, component] of Object.entries(this.subComponents)) {
            if (component && typeof component.refresh === 'function') {
                try {
                    await component.refresh();
                } catch (error) {
                    console.error(`SettingsPanel: Failed to refresh ${name}:`, error);
                }
            }
        }

        console.log('SettingsPanel: Refresh completed');
    }

    /**
     * Get the settings panel container element
     */
    getContainer() {
        return $('#vectors_enhanced_container');
    }

    /**
     * Get a specific settings section element
     */
    getSection(sectionId) {
        return $(`#vectors_enhanced_${sectionId}`);
    }

    /**
     * Show/hide the settings panel
     */
    setVisible(visible) {
        const container = this.getContainer();
        if (container.length) {
            if (visible) {
                container.show();
            } else {
                container.hide();
            }
        }
    }

    /**
     * Check if the settings panel is visible
     */
    isVisible() {
        const container = this.getContainer();
        return container.length && container.is(':visible');
    }

    /**
     * Get the initialization status
     */
    getStatus() {
        return {
            initialized: this.initialized,
            templateLoaded: this.templateLoaded,
            subComponents: Object.keys(this.subComponents).reduce((status, name) => {
                status[name] = !!this.subComponents[name];
                return status;
            }, {})
        };
    }

    /**
     * Add a sub-component to the settings panel
     */
    addSubComponent(name, component) {
        if (this.subComponents.hasOwnProperty(name)) {
            console.debug(`SettingsPanel: Sub-component ${name} already exists, replacing...`);
        } else {
            console.log(`SettingsPanel: Added sub-component: ${name}`);
        }

        this.subComponents[name] = component;
    }

    /**
     * Remove a sub-component from the settings panel
     */
    removeSubComponent(name) {
        if (this.subComponents[name]) {
            // Cleanup the component if it has a destroy method
            if (typeof this.subComponents[name].destroy === 'function') {
                this.subComponents[name].destroy();
            }

            delete this.subComponents[name];
            console.log(`SettingsPanel: Removed sub-component: ${name}`);
        }
    }

    /**
     * Cleanup - destroy all sub-components and reset state
     */
    destroy() {
        console.log('SettingsPanel: Destroying...');

        // Destroy all sub-components
        for (const [name, component] of Object.entries(this.subComponents)) {
            if (component && typeof component.destroy === 'function') {
                try {
                    component.destroy();
                } catch (error) {
                    console.error(`SettingsPanel: Failed to destroy ${name}:`, error);
                }
            }
        }

        // Reset state
        this.subComponents = {};
        this.initialized = false;
        this.templateLoaded = false;

        console.log('SettingsPanel: Destroyed');
    }

    /**
     * Update dependencies (for hot-reloading during development)
     */
    updateDependencies(dependencies) {
        Object.assign(this, dependencies);
        console.log('SettingsPanel: Dependencies updated');
    }

    /**
     * Validate that the settings panel DOM structure is correct
     */
    validateStructure() {
        const container = this.getContainer();
        if (!container.length) {
            throw new Error('SettingsPanel: Container not found');
        }

        // Check for required sections
        const requiredSections = [
            'main_settings',
            'content_settings',
            'tasks_settings',
            'actions_settings'
        ];

        const missingSections = requiredSections.filter(sectionId => {
            return this.getSection(sectionId).length === 0;
        });

        if (missingSections.length > 0) {
            console.warn('SettingsPanel: Missing sections:', missingSections);
        }

        return {
            containerExists: container.length > 0,
            missingSections,
            isValid: missingSections.length === 0
        };
    }
}
