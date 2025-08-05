/**
 * ProgressManager Component - Centralized progress display and status management
 * 
 * Handles:
 * - Progress bar display and updates
 * - Status messages and notifications
 * - Error state visualization
 * - Loading state management
 * - Multi-task progress coordination
 */

export class ProgressManager {
    constructor(dependencies = {}) {
        this.eventBus = dependencies.eventBus;
        this.notificationManager = dependencies.notificationManager;
        
        // Progress state
        this.progressState = {
            isVisible: false,
            current: 0,
            total: 0,
            message: '',
            isError: false,
            isComplete: false
        };
        
        // DOM elements
        this.progressContainer = null;
        this.progressBar = null;
        this.progressText = null;
        this.statusContainer = null;
        
        // Progress history for analytics
        this.progressHistory = [];
        
        this.initialized = false;
    }

    /**
     * Initialize ProgressManager
     */
    init() {
        if (this.initialized) {
            console.warn('ProgressManager: Already initialized');
            return;
        }

        try {
            this.initializeDOMElements();
            this.bindEventListeners();
            this.initialized = true;
            console.log('ProgressManager: Initialized successfully');
        } catch (error) {
            console.error('ProgressManager: Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Initialize DOM elements
     */
    initializeDOMElements() {
        this.progressContainer = $('#vectors_enhanced_progress');
        this.progressBar = $('.progress-bar-inner', this.progressContainer);
        this.progressText = $('.progress-text', this.progressContainer);
        this.statusContainer = $('#vectors_enhanced_status');

        if (this.progressContainer.length === 0) {
            console.warn('ProgressManager: Progress container not found, creating fallback');
            this.createFallbackProgressElement();
        }

        console.log('ProgressManager: DOM elements initialized');
    }

    /**
     * Create fallback progress element if not found in HTML
     */
    createFallbackProgressElement() {
        const fallbackHTML = `
            <div id="vectors_enhanced_progress" class="vectors-enhanced-progress m-t-1" style="display: none">
                <div class="progress-bar">
                    <div class="progress-bar-inner" style="width: 0%"></div>
                </div>
                <div class="progress-text">准备中...</div>
            </div>
            <div id="vectors_enhanced_status" class="vectors-enhanced-status m-t-1" style="display: none">
                <!-- Status messages will be displayed here -->
            </div>
        `;
        
        // Insert after the action buttons
        const actionsContainer = $('#vectors_enhanced_actions_settings');
        if (actionsContainer.length > 0) {
            actionsContainer.after(fallbackHTML);
            this.initializeDOMElements();
        }
    }

    /**
     * Bind event listeners
     */
    bindEventListeners() {
        if (this.eventBus) {
            // Listen to progress events
            this.eventBus.on('progress:start', (data) => this.handleProgressStart(data));
            this.eventBus.on('progress:update', (data) => this.handleProgressUpdate(data));
            this.eventBus.on('progress:complete', (data) => this.handleProgressComplete(data));
            this.eventBus.on('progress:error', (data) => this.handleProgressError(data));
            this.eventBus.on('progress:hide', () => this.hide());
        }

        console.log('ProgressManager: Event listeners bound');
    }

    /**
     * Show progress with initial values
     */
    show(current = 0, total = 100, message = '处理中...') {
        this.progressState = {
            isVisible: true,
            current,
            total,
            message,
            isError: false,
            isComplete: false
        };

        this.updateDisplay();
        this.progressContainer.show();
        
        // Record start time
        this.progressHistory.push({
            action: 'start',
            timestamp: Date.now(),
            current,
            total,
            message
        });

        console.log(`ProgressManager: Progress shown - ${current}/${total} - ${message}`);
    }

    /**
     * Update progress values
     */
    update(current, total, message) {
        if (!this.progressState.isVisible) {
            console.warn('ProgressManager: Attempting to update hidden progress');
            return;
        }

        this.progressState.current = current;
        this.progressState.total = total;
        this.progressState.message = message;
        this.progressState.isError = false;

        this.updateDisplay();

        // Record progress update
        this.progressHistory.push({
            action: 'update',
            timestamp: Date.now(),
            current,
            total,
            message
        });

        console.debug(`ProgressManager: Progress updated - ${current}/${total} - ${message}`);
    }

    /**
     * Mark progress as complete
     */
    complete(message = '完成') {
        this.progressState.current = this.progressState.total;
        this.progressState.message = message;
        this.progressState.isComplete = true;
        this.progressState.isError = false;

        this.updateDisplay();

        // Show completion for a moment, then hide
        setTimeout(() => {
            this.hide();
        }, 2000);

        // Record completion
        this.progressHistory.push({
            action: 'complete',
            timestamp: Date.now(),
            current: this.progressState.current,
            total: this.progressState.total,
            message
        });

        console.log(`ProgressManager: Progress completed - ${message}`);
    }

    /**
     * Show error state
     */
    error(message = '处理失败') {
        this.progressState.message = message;
        this.progressState.isError = true;
        this.progressState.isComplete = false;

        this.updateDisplay();

        // Record error
        this.progressHistory.push({
            action: 'error',
            timestamp: Date.now(),
            current: this.progressState.current,
            total: this.progressState.total,
            message
        });

        console.error(`ProgressManager: Progress error - ${message}`);

        // Hide after showing error for a moment
        setTimeout(() => {
            this.hide();
        }, 3000);
    }

    /**
     * Hide progress
     */
    hide() {
        this.progressState.isVisible = false;
        this.progressContainer.hide();
        this.statusContainer.hide();

        // Record hide action
        this.progressHistory.push({
            action: 'hide',
            timestamp: Date.now()
        });

        console.log('ProgressManager: Progress hidden');
    }

    /**
     * Update the visual display
     */
    updateDisplay() {
        if (!this.progressContainer || this.progressContainer.length === 0) {
            console.warn('ProgressManager: No progress container available');
            return;
        }

        // Calculate percentage
        const percentage = this.progressState.total > 0 
            ? Math.round((this.progressState.current / this.progressState.total) * 100)
            : 0;

        // Update progress bar
        this.progressBar.css('width', `${percentage}%`);
        
        // Update text with block count and message
        const displayText = `${this.progressState.message} (${this.progressState.current}/${this.progressState.total})`;
        this.progressText.text(displayText);

        // Update container classes based on state
        this.progressContainer.removeClass('error complete').addClass('active');
        
        if (this.progressState.isError) {
            this.progressContainer.addClass('error');
            this.progressBar.css('background-color', 'var(--SmartThemeRedColor, #ff4444)');
        } else if (this.progressState.isComplete) {
            this.progressContainer.addClass('complete');
            // 保持默认颜色，不变绿
            this.progressBar.css('background-color', 'var(--SmartThemeQuoteColor)');
        } else {
            this.progressBar.css('background-color', 'var(--SmartThemeQuoteColor)');
        }

        console.debug(`ProgressManager: Display updated - ${this.progressState.current}/${this.progressState.total} (${percentage}%) - ${this.progressState.message}`);
    }

    /**
     * Show status message
     */
    showStatus(message, type = 'info') {
        if (!this.statusContainer || this.statusContainer.length === 0) {
            console.warn('ProgressManager: No status container available');
            return;
        }

        const statusHTML = `
            <div class="status-message status-${type}">
                <i class="fa-solid fa-${this.getStatusIcon(type)}"></i>
                <span>${message}</span>
            </div>
        `;

        this.statusContainer.html(statusHTML).show();

        // Auto-hide info messages after 5 seconds
        if (type === 'info') {
            setTimeout(() => {
                this.statusContainer.hide();
            }, 5000);
        }

        console.log(`ProgressManager: Status shown - ${type}: ${message}`);
    }

    /**
     * Get icon for status type
     */
    getStatusIcon(type) {
        const icons = {
            info: 'info-circle',
            success: 'check-circle',
            warning: 'exclamation-triangle',
            error: 'exclamation-circle'
        };
        return icons[type] || 'info-circle';
    }

    /**
     * Clear status message
     */
    clearStatus() {
        if (this.statusContainer) {
            this.statusContainer.hide().empty();
        }
    }

    /**
     * Event handlers
     */
    handleProgressStart(data) {
        const { current = 0, total = 100, message = '开始处理...' } = data;
        this.show(current, total, message);
    }

    handleProgressUpdate(data) {
        const { current, total, message } = data;
        this.update(current, total, message);
    }

    handleProgressComplete(data) {
        const { message = '处理完成' } = data;
        this.complete(message);
    }

    handleProgressError(data) {
        const { message = '处理失败' } = data;
        this.error(message);
    }

    /**
     * Get progress statistics
     */
    getProgressStats() {
        if (this.progressHistory.length === 0) {
            return null;
        }

        const startTime = this.progressHistory[0].timestamp;
        const endTime = this.progressHistory[this.progressHistory.length - 1].timestamp;
        const duration = endTime - startTime;

        const lastEntry = this.progressHistory[this.progressHistory.length - 1];
        const isCompleted = lastEntry.action === 'complete';
        const isError = lastEntry.action === 'error';

        return {
            duration,
            totalSteps: this.progressHistory.filter(h => h.action === 'update').length,
            isCompleted,
            isError,
            finalMessage: lastEntry.message || '',
            averageStepTime: this.progressHistory.length > 1 ? duration / (this.progressHistory.length - 1) : 0
        };
    }

    /**
     * Clear progress history
     */
    clearHistory() {
        this.progressHistory = [];
        console.log('ProgressManager: Progress history cleared');
    }

    /**
     * Get current progress state
     */
    getState() {
        return { ...this.progressState };
    }

    /**
     * Check if progress is currently visible
     */
    isVisible() {
        return this.progressState.isVisible;
    }

    /**
     * Cleanup - remove event listeners
     */
    destroy() {
        console.log('ProgressManager: Destroying...');

        if (this.eventBus) {
            this.eventBus.off('progress:start');
            this.eventBus.off('progress:update');
            this.eventBus.off('progress:complete');
            this.eventBus.off('progress:error');
            this.eventBus.off('progress:hide');
        }

        this.hide();
        this.clearHistory();
        this.initialized = false;

        console.log('ProgressManager: Destroyed');
    }
}