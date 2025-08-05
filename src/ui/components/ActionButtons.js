/**
 * ActionButtons Component - Manages main action buttons (Preview, Export, Vectorize, Abort)
 * 
 * Extracted from index.js lines 2022-2081 to centralize button handling and state management
 */

import { MessageUI } from './MessageUI.js';

export class ActionButtons {
    constructor(dependencies = {}) {
        // Dependencies injection to avoid circular references
        this.settings = dependencies.settings;
        this.getVectorizableContent = dependencies.getVectorizableContent;
        this.shouldSkipContent = dependencies.shouldSkipContent;
        this.extractComplexTag = dependencies.extractComplexTag;
        this.extractHtmlFormatTag = dependencies.extractHtmlFormatTag;
        this.extractSimpleTag = dependencies.extractSimpleTag;
        this.substituteParams = dependencies.substituteParams;
        this.exportVectors = dependencies.exportVectors;
        this.vectorizeContent = dependencies.vectorizeContent;
        this.isVectorizing = dependencies.isVectorizing;
        this.getVectorizationAbortController = dependencies.vectorizationAbortController;
        
        // Button state management
        this.buttonStates = {
            preview: { enabled: true, loading: false },
            export: { enabled: true, loading: false },
            vectorize: { enabled: true, loading: false },
            abort: { enabled: false, loading: false }
        };
        
        this.initialized = false;
    }

    /**
     * Initialize ActionButtons component - bind event listeners
     */
    init() {
        if (this.initialized) {
            console.warn('ActionButtons: Already initialized');
            return;
        }

        this.bindEventListeners();
        this.initialized = true;
        console.log('ActionButtons: Initialized successfully');
    }

    /**
     * Bind event listeners for all action buttons
     */
    bindEventListeners() {
        // Preview button
        $(document).on('click', '#vectors_enhanced_preview', (e) => this.handlePreviewClick(e));
        
        // Export button  
        $(document).on('click', '#vectors_enhanced_export', (e) => this.handleExportClick(e));
        
        // Vectorize button
        $(document).on('click', '#vectors_enhanced_vectorize', (e) => this.handleVectorizeClick(e));
        
        // Abort button
        $(document).on('click', '#vectors_enhanced_abort', (e) => this.handleAbortClick(e));
        
        console.log('ActionButtons: Event listeners bound');
    }

    /**
     * Handle Preview button click
     */
    async handlePreviewClick(e) {
        e.preventDefault();
        console.log('预览按钮被点击 (ActionButtons组件)');

        if (!this.validateMasterEnabled()) return;
        if (!this.setButtonLoading('preview', true)) return;

        try {
            // Check if raw content preview is enabled
            const showRawContent = $('#vectors_enhanced_preview_raw').prop('checked');
            
            await MessageUI.previewContent(
                this.getVectorizableContent,
                this.shouldSkipContent,
                this.extractComplexTag,
                this.extractHtmlFormatTag,
                this.extractSimpleTag,
                this.settings,
                this.substituteParams,
                showRawContent
            );
            // 不显示额外的成功消息，previewContent 内部已处理
        } catch (error) {
            this.handleError('预览', error);
        } finally {
            this.setButtonLoading('preview', false);
        }
    }

    /**
     * Handle Export button click
     */
    async handleExportClick(e) {
        e.preventDefault();
        console.log('导出按钮被点击 (ActionButtons组件)');

        if (!this.validateMasterEnabled()) return;
        if (!this.setButtonLoading('export', true)) return;

        try {
            await this.exportVectors();
            // 不显示额外的成功消息，exportVectors 内部已处理
        } catch (error) {
            this.handleError('导出', error);
        } finally {
            this.setButtonLoading('export', false);
        }
    }

    /**
     * Handle Vectorize button click
     */
    async handleVectorizeClick(e) {
        e.preventDefault();
        console.log('向量化按钮被点击 (ActionButtons组件)');

        if (!this.validateMasterEnabled()) return;
        if (!this.setButtonLoading('vectorize', true)) return;

        try {
            // Enable abort button when vectorization starts
            this.setButtonEnabled('abort', true);
            this.switchToAbortMode();
            
            await this.vectorizeContent();
            // 不显示额外的成功消息，vectorizeContent 内部已处理
        } catch (error) {
            this.handleError('向量化', error);
        } finally {
            this.setButtonLoading('vectorize', false);
            this.setButtonEnabled('abort', false);
            this.switchToVectorizeMode();
        }
    }

    /**
     * Handle Abort button click
     */
    async handleAbortClick(e) {
        e.preventDefault();
        console.log('中断向量化按钮被点击 (ActionButtons组件)');

        if (this.isVectorizing() && this.getVectorizationAbortController()) {
            this.getVectorizationAbortController().abort();
            this.showInfo('正在中断向量化...', '中断');
            this.setButtonEnabled('abort', false);
            this.switchToVectorizeMode();
        }
    }

    /**
     * Validate master switch is enabled
     */
    validateMasterEnabled() {
        if (!this.settings.master_enabled) {
            this.showWarning('请先启用聊天记录超级管理器');
            return false;
        }
        return true;
    }

    /**
     * Set button loading state
     */
    setButtonLoading(buttonName, loading) {
        if (!this.buttonStates[buttonName]) {
            console.error(`ActionButtons: Unknown button ${buttonName}`);
            return false;
        }

        this.buttonStates[buttonName].loading = loading;
        const button = $(`#vectors_enhanced_${buttonName}`);
        
        if (loading) {
            button.prop('disabled', true).addClass('loading');
        } else {
            button.prop('disabled', false).removeClass('loading');
        }

        return true;
    }

    /**
     * Set button enabled state
     */
    setButtonEnabled(buttonName, enabled) {
        if (!this.buttonStates[buttonName]) {
            console.error(`ActionButtons: Unknown button ${buttonName}`);
            return false;
        }

        this.buttonStates[buttonName].enabled = enabled;
        const button = $(`#vectors_enhanced_${buttonName}`);
        button.prop('disabled', !enabled);

        return true;
    }

    /**
     * Switch UI to show abort button (during vectorization)
     */
    switchToAbortMode() {
        $('#vectors_enhanced_vectorize').hide();
        $('#vectors_enhanced_abort').show();
    }

    /**
     * Switch UI to show vectorize button (normal state)
     */
    switchToVectorizeMode() {
        $('#vectors_enhanced_abort').hide();
        $('#vectors_enhanced_vectorize').show();
    }

    /**
     * Standardized error handling
     */
    handleError(operation, error) {
        console.error(`${operation}错误:`, error);
        toastr.error(`${operation}失败: ${error.message}`);
    }

    /**
     * Show success message
     */
    showSuccess(message) {
        toastr.success(message);
    }

    /**
     * Show warning message
     */
    showWarning(message) {
        toastr.warning(message);
    }

    /**
     * Show info message
     */
    showInfo(message, title = '') {
        toastr.info(message, title);
    }

    /**
     * Get current button states (for debugging)
     */
    getButtonStates() {
        return { ...this.buttonStates };
    }

    /**
     * Update dependencies (for hot-reloading during development)
     */
    updateDependencies(dependencies) {
        Object.assign(this, dependencies);
        console.log('ActionButtons: Dependencies updated');
    }

    /**
     * Cleanup - remove event listeners
     */
    destroy() {
        $(document).off('click', '#vectors_enhanced_preview');
        $(document).off('click', '#vectors_enhanced_export');
        $(document).off('click', '#vectors_enhanced_vectorize');
        $(document).off('click', '#vectors_enhanced_abort');
        
        this.initialized = false;
        console.log('ActionButtons: Destroyed');
    }
}