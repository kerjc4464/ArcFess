/**
 * ContentSelectionSettings Component - Manages Chat/File/WorldInfo selection panels
 * 
 * Handles:
 * - Chat message selection (range, types, hidden messages)
 * - File selection and management
 * - World Info selection and management
 * - Tag extraction rules and content filtering
 * - Cross-component selection coordination
 */

export class ContentSelectionSettings {
    constructor(dependencies = {}) {
        this.settings = dependencies.settings;
        this.configManager = dependencies.configManager;
        this.onSettingsChange = dependencies.onSettingsChange || (() => {});
        
        // Component management functions (injected dependencies)
        this.updateFileList = dependencies.updateFileList;
        this.updateWorldInfoList = dependencies.updateWorldInfoList;
        this.updateChatSettings = dependencies.updateChatSettings;
        this.renderTagRulesUI = dependencies.renderTagRulesUI;
        this.showTagExamples = dependencies.showTagExamples;
        this.scanAndSuggestTags = dependencies.scanAndSuggestTags;
        this.clearTagSuggestions = dependencies.clearTagSuggestions;
        this.toggleMessageRangeVisibility = dependencies.toggleMessageRangeVisibility;
        
        // Content type configurations
        this.contentTypes = {
            chat: {
                enabledId: 'vectors_enhanced_chat_enabled',
                settingsId: 'vectors_enhanced_chat_settings',
                settingsKey: 'selected_content.chat.enabled'
            },
            files: {
                enabledId: 'vectors_enhanced_files_enabled',
                settingsId: 'vectors_enhanced_files_settings',
                settingsKey: 'selected_content.files.enabled'
            },
            wi: {
                enabledId: 'vectors_enhanced_wi_enabled',
                settingsId: 'vectors_enhanced_wi_settings',
                settingsKey: 'selected_content.world_info.enabled'
            }
        };
        
        this.initialized = false;
    }

    /**
     * Initialize ContentSelectionSettings component
     */
    async init() {
        if (this.initialized) {
            console.warn('ContentSelectionSettings: Already initialized');
            return;
        }

        try {
            this.bindEventListeners();
            this.loadCurrentSettings();
            this.updateContentVisibility();
            this.initialized = true;
            console.log('ContentSelectionSettings: Initialized successfully');
        } catch (error) {
            console.error('ContentSelectionSettings: Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Bind event listeners for content selection settings
     */
    bindEventListeners() {
        // Content type enable/disable toggles
        this.bindContentTypeListeners();
        
        // Chat-specific settings
        this.bindChatSettingsListeners();
        
        // File and World Info refresh buttons
        this.bindRefreshButtonListeners();
        
        // Tag extraction and content filtering
        this.bindTagAndFilterListeners();
        
        console.log('ContentSelectionSettings: Event listeners bound');
    }

    /**
     * Bind content type toggle listeners
     */
    bindContentTypeListeners() {
        Object.entries(this.contentTypes).forEach(([type, config]) => {
            $(`#${config.enabledId}`).on('change', (e) => {
                this.handleContentTypeToggle(type, e.target.checked);
            });
        });
    }

    /**
     * Bind chat-specific settings listeners
     */
    bindChatSettingsListeners() {
        // Chat range settings
        $('#vectors_enhanced_chat_start').on('input', (e) => {
            this.handleChatRangeChange('start', parseInt(e.target.value) || 0);
        });

        $('#vectors_enhanced_chat_end').on('input', (e) => {
            this.handleChatRangeChange('end', parseInt(e.target.value) || -1);
        });

        // Chat message type settings
        $('#vectors_enhanced_chat_user').on('change', (e) => {
            this.handleChatTypeChange('user', e.target.checked);
        });

        $('#vectors_enhanced_chat_assistant').on('change', (e) => {
            this.handleChatTypeChange('assistant', e.target.checked);
        });

        $('#vectors_enhanced_chat_include_hidden').on('change', (e) => {
            this.handleChatIncludeHiddenChange(e.target.checked);
        });

        // Hidden message management buttons
        $('#vectors_enhanced_hide_range').on('click', () => {
            this.handleHideMessageRange();
        });

        $('#vectors_enhanced_unhide_range').on('click', () => {
            this.handleUnhideMessageRange();
        });

        $('#vectors_enhanced_show_hidden').on('click', () => {
            this.handleShowHiddenMessages();
        });

        // Content blacklist
        $('#vectors_enhanced_content_blacklist').on('input', (e) => {
            this.handleContentBlacklistChange(e.target.value);
        });
    }

    /**
     * Bind refresh button listeners
     */
    bindRefreshButtonListeners() {
        $('#vectors_enhanced_files_refresh').on('click', () => {
            this.handleFilesRefresh();
        });

        $('#vectors_enhanced_wi_refresh').on('click', () => {
            this.handleWorldInfoRefresh();
        });
    }

    /**
     * Bind tag extraction and content filtering listeners
     */
    bindTagAndFilterListeners() {
        // Note: tag_examples and tag_scanner buttons are handled in settingsManager.js
        // to avoid duplicate event bindings

        // Add rule button
        $('#vectors_enhanced_add_rule').on('click', () => {
            this.handleAddTagRule();
        });

        // Exclude CoT button
        $('#vectors_enhanced_exclude_cot').on('click', () => {
            this.handleExcludeCoT();
        });

        // Clear suggestions button
        $('#vectors_enhanced_clear_suggestions').on('click', () => {
            if (this.clearTagSuggestions) {
                this.clearTagSuggestions();
            }
        });
    }

    /**
     * Handle content type toggle (chat/files/wi)
     */
    async handleContentTypeToggle(type, enabled) {
        console.log(`ContentSelectionSettings: ${type} ${enabled ? 'enabled' : 'disabled'}`);

        // Update settings
        const keyPath = this.contentTypes[type].settingsKey.split('.');
        this.setNestedProperty(this.settings, keyPath, enabled);
        
        // IMPORTANT: Clear internal selections when disabling
        if (!enabled) {
            this.clearContentTypeSelections(type);
            console.log(`ContentSelectionSettings: Cleared ${type} selections`);
        }
        
        // Force immediate save (bypass debounce)
        this.saveSettings();
        this.forceImmediateSave();

        // Update UI visibility
        this.updateContentTypeVisibility(type, enabled);

        // Force immediate UI refresh to reflect cleared selections
        if (!enabled) {
            // Use await to ensure UI is updated before continuing
            await this.forceRefreshContentType(type);
        } else {
            // Normal refresh for enabling
            this.refreshContentType(type);
        }

        // Notify settings change
        this.onSettingsChange(`selected_content.${type}.enabled`, enabled);
    }

    /**
     * Handle chat range changes
     */
    handleChatRangeChange(type, value) {
        console.log(`ContentSelectionSettings: Chat ${type} range changed to:`, value);

        if (type === 'start') {
            this.settings.selected_content.chat.range.start = value;
        } else if (type === 'end') {
            this.settings.selected_content.chat.range.end = value;
        }

        this.saveSettings();
        this.onSettingsChange(`selected_content.chat.range.${type}`, value);
    }

    /**
     * Handle chat message type changes
     */
    handleChatTypeChange(type, enabled) {
        console.log(`ContentSelectionSettings: Chat ${type} messages ${enabled ? 'enabled' : 'disabled'}`);

        this.settings.selected_content.chat.types[type] = enabled;
        this.saveSettings();
        this.onSettingsChange(`selected_content.chat.types.${type}`, enabled);
    }

    /**
     * Handle chat include hidden messages change
     */
    handleChatIncludeHiddenChange(enabled) {
        console.log(`ContentSelectionSettings: Include hidden messages ${enabled ? 'enabled' : 'disabled'}`);

        this.settings.selected_content.chat.include_hidden = enabled;
        this.saveSettings();
        this.onSettingsChange('selected_content.chat.include_hidden', enabled);
    }

    /**
     * Handle hide message range
     */
    handleHideMessageRange() {
        if (this.toggleMessageRangeVisibility) {
            this.toggleMessageRangeVisibility(false); // false = hide
        }
    }

    /**
     * Handle unhide message range
     */
    handleUnhideMessageRange() {
        if (this.toggleMessageRangeVisibility) {
            this.toggleMessageRangeVisibility(true); // true = show
        }
    }

    /**
     * Handle show hidden messages
     */
    handleShowHiddenMessages() {
        // This would trigger the existing MessageUI functionality
        console.log('ContentSelectionSettings: Show hidden messages clicked');
        // The actual implementation is in MessageUI.showHiddenMessages()
    }

    /**
     * Handle content blacklist changes
     */
    handleContentBlacklistChange(value) {
        console.log('ContentSelectionSettings: Content blacklist updated');

        this.settings.content_blacklist = value;
        this.saveSettings();
        this.onSettingsChange('content_blacklist', value);
    }

    /**
     * Handle files refresh
     */
    async handleFilesRefresh() {
        console.log('ContentSelectionSettings: Refreshing files...');
        if (this.updateFileList) {
            await this.updateFileList();
            toastr.info('文件列表已刷新');
        }
    }

    /**
     * Handle world info refresh
     */
    async handleWorldInfoRefresh() {
        console.log('ContentSelectionSettings: Refreshing world info...');
        if (this.updateWorldInfoList) {
            await this.updateWorldInfoList();
            toastr.info('世界信息列表已刷新');
        }
    }

    /**
     * Handle add tag rule
     */
    handleAddTagRule() {
        console.log('ContentSelectionSettings: Adding new tag rule...');
        if (this.renderTagRulesUI) {
            // This would trigger adding a new rule in the tag rules editor
            this.renderTagRulesUI();
        }
    }

    /**
     * Handle exclude CoT (Chain of Thought)
     */
    handleExcludeCoT() {
        console.log('ContentSelectionSettings: Adding CoT exclusion rule...');
        
        // Add a predefined regex rule to exclude HTML comment-style CoT
        const cotRule = {
            type: 'regex',
            pattern: '<!--[\\s\\S]*?-->',
            description: '排除HTML注释格式的思维链'
        };

        // Add this rule to the tag extraction rules
        if (!this.settings.tag_extraction_rules) {
            this.settings.tag_extraction_rules = [];
        }

        this.settings.tag_extraction_rules.push(cotRule);
        this.saveSettings();

        // Refresh the tag rules UI
        if (this.renderTagRulesUI) {
            this.renderTagRulesUI();
        }

        this.onSettingsChange('tag_extraction_rules', this.settings.tag_extraction_rules);
    }

    /**
     * Update content type visibility
     */
    updateContentTypeVisibility(type, enabled) {
        const config = this.contentTypes[type];
        const settingsDiv = $(`#${config.settingsId}`);
        
        if (enabled) {
            settingsDiv.show();
        } else {
            settingsDiv.hide();
        }

        console.log(`ContentSelectionSettings: Updated ${type} visibility (enabled: ${enabled})`);
    }

    /**
     * Update all content visibility based on settings
     */
    updateContentVisibility() {
        Object.entries(this.contentTypes).forEach(([type, config]) => {
            const keyPath = config.settingsKey.split('.');
            const enabled = this.getNestedProperty(this.settings, keyPath);
            this.updateContentTypeVisibility(type, enabled);
        });
    }

    /**
     * Refresh content type data
     */
    refreshContentType(type) {
        switch (type) {
            case 'chat':
                if (this.updateChatSettings) {
                    this.updateChatSettings();
                }
                break;
            case 'files':
                if (this.updateFileList) {
                    this.updateFileList();
                }
                break;
            case 'wi':
                if (this.updateWorldInfoList) {
                    this.updateWorldInfoList();
                }
                break;
        }
    }

    /**
     * Load current settings into UI elements
     */
    loadCurrentSettings() {
        console.log('ContentSelectionSettings: Loading current settings...');

        // Load content type toggles
        Object.entries(this.contentTypes).forEach(([type, config]) => {
            const keyPath = config.settingsKey.split('.');
            const enabled = this.getNestedProperty(this.settings, keyPath);
            $(`#${config.enabledId}`).prop('checked', enabled);
        });

        // Load chat-specific settings
        this.loadChatSettings();

        // Load content blacklist
        $('#vectors_enhanced_content_blacklist').val(this.settings.content_blacklist || '');

        console.log('ContentSelectionSettings: Settings loaded');
    }

    /**
     * Load chat-specific settings
     */
    loadChatSettings() {
        const chatSettings = this.settings.selected_content.chat;

        // Chat range
        $('#vectors_enhanced_chat_start').val(chatSettings.range?.start || 0);
        $('#vectors_enhanced_chat_end').val(chatSettings.range?.end || -1);

        // Chat message types
        $('#vectors_enhanced_chat_user').prop('checked', chatSettings.types?.user !== false);
        $('#vectors_enhanced_chat_assistant').prop('checked', chatSettings.types?.assistant !== false);
        $('#vectors_enhanced_chat_include_hidden').prop('checked', chatSettings.include_hidden || false);
    }

    /**
     * Get nested property from object using dot notation path
     */
    getNestedProperty(obj, path) {
        return path.reduce((current, key) => current && current[key], obj);
    }

    /**
     * Set nested property in object using dot notation path
     */
    setNestedProperty(obj, path, value) {
        const lastKey = path.pop();
        const target = path.reduce((current, key) => {
            if (!current[key]) current[key] = {};
            return current[key];
        }, obj);
        target[lastKey] = value;
    }

    /**
     * Save settings using ConfigManager
     */
    saveSettings() {
        if (this.configManager) {
            console.debug('ContentSelectionSettings: Settings saved via ConfigManager');
        } else {
            console.warn('ContentSelectionSettings: No ConfigManager available for saving');
        }
    }

    /**
     * Refresh all content lists
     */
    async refreshAllContent() {
        console.log('ContentSelectionSettings: Refreshing all content...');
        
        Object.keys(this.contentTypes).forEach(type => {
            const keyPath = this.contentTypes[type].settingsKey.split('.');
            const enabled = this.getNestedProperty(this.settings, keyPath);
            if (enabled) {
                this.refreshContentType(type);
            }
        });
    }

    /**
     * Get content selection status
     */
    getContentSelectionStatus() {
        const status = {};
        
        Object.entries(this.contentTypes).forEach(([type, config]) => {
            const keyPath = config.settingsKey.split('.');
            status[type] = {
                enabled: this.getNestedProperty(this.settings, keyPath),
                settings: this.settings.selected_content[type]
            };
        });

        return status;
    }

    /**
     * Clear all selections for a content type
     */
    clearContentTypeSelections(type) {
        console.log(`ContentSelectionSettings: Clearing selections for ${type}`);
        
        switch(type) {
            case 'chat':
                // 对于聊天记录，不清除内部选择状态
                // 保留所有设置（range, types, include_hidden）
                console.log(`ContentSelectionSettings: Preserving chat internal selections`);
                break;
                
            case 'files':
                // Clear all file selections
                if (this.settings.selected_content.files.selected) {
                    this.settings.selected_content.files.selected = [];
                }
                break;
                
            case 'wi':
                // Clear all world info selections
                if (this.settings.selected_content.world_info.selected) {
                    this.settings.selected_content.world_info.selected = {};
                }
                break;
        }
        
        console.log(`ContentSelectionSettings: Cleared ${type} selections`);
    }

    /**
     * Force immediate save without debounce
     */
    forceImmediateSave() {
        console.log('ContentSelectionSettings: Forcing immediate save');
        
        // 直接调用保存，绕过防抖
        if (typeof window.SillyTavern !== 'undefined' && window.SillyTavern.saveSettings) {
            window.SillyTavern.saveSettings();
        } else {
            // 备用方案：尝试直接保存到localStorage
            try {
                const extensionSettings = window.extension_settings || {};
                localStorage.setItem('extensions_settings', JSON.stringify(extensionSettings));
                console.log('ContentSelectionSettings: Saved to localStorage directly');
            } catch (e) {
                console.error('ContentSelectionSettings: Failed to save immediately:', e);
            }
        }
    }

    /**
     * Force refresh UI for a content type
     */
    async forceRefreshContentType(type) {
        console.log(`ContentSelectionSettings: Force refreshing ${type} UI`);
        
        // 立即刷新对应类型的UI
        switch (type) {
            case 'chat':
                if (this.updateChatSettings) {
                    await Promise.resolve(this.updateChatSettings());
                }
                break;
                
            case 'files':
                if (this.updateFileList) {
                    await Promise.resolve(this.updateFileList());
                }
                break;
                
            case 'wi':
                if (this.updateWorldInfoList) {
                    await Promise.resolve(this.updateWorldInfoList());
                }
                break;
        }
        
        // 确保UI已经更新
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log(`ContentSelectionSettings: ${type} UI refresh completed`);
    }

    /**
     * Cleanup - remove event listeners
     */
    destroy() {
        console.log('ContentSelectionSettings: Destroying...');

        // Remove content type listeners
        Object.values(this.contentTypes).forEach(config => {
            $(`#${config.enabledId}`).off('change');
        });

        // Remove chat settings listeners
        $('#vectors_enhanced_chat_start').off('input');
        $('#vectors_enhanced_chat_end').off('input');
        $('#vectors_enhanced_chat_user').off('change');
        $('#vectors_enhanced_chat_assistant').off('change');
        $('#vectors_enhanced_chat_include_hidden').off('change');

        // Remove button listeners
        $('#vectors_enhanced_hide_range').off('click');
        $('#vectors_enhanced_unhide_range').off('click');
        $('#vectors_enhanced_show_hidden').off('click');
        $('#vectors_enhanced_files_refresh').off('click');
        $('#vectors_enhanced_wi_refresh').off('click');
        // Note: tag_examples and tag_scanner are handled in settingsManager.js
        $('#vectors_enhanced_add_rule').off('click');
        $('#vectors_enhanced_exclude_cot').off('click');
        $('#vectors_enhanced_clear_suggestions').off('click');

        // Remove other listeners
        $('#vectors_enhanced_content_blacklist').off('input');

        this.initialized = false;
        console.log('ContentSelectionSettings: Destroyed');
    }
}