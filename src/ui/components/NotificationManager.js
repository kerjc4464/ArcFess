/**
 * NotificationManager - Centralized notification system
 * 
 * Handles:
 * - Unified toastr/notification API
 * - Notification queue management
 * - Priority handling
 * - Template-based messages
 * - Notification history
 * - Custom notification styles
 */

export class NotificationManager {
    constructor(dependencies = {}) {
        this.eventBus = dependencies.eventBus;
        this.toastr = dependencies.toastr || window.toastr;
        
        // Notification queue
        this.notificationQueue = [];
        this.isProcessing = false;
        
        // Notification templates
        this.templates = new Map();
        
        // Notification history
        this.history = [];
        this.maxHistorySize = 100;
        
        // Default options
        this.defaultOptions = {
            timeOut: 3000,
            extendedTimeOut: 1000,
            closeButton: true,
            progressBar: true,
            positionClass: 'toast-top-right',
            preventDuplicates: true,
            newestOnTop: true
        };
        
        // Priority levels
        this.priorities = {
            CRITICAL: 4,
            HIGH: 3,
            NORMAL: 2,
            LOW: 1
        };
        
        this.initialized = false;
    }

    /**
     * Initialize NotificationManager
     */
    init() {
        if (this.initialized) {
            console.warn('NotificationManager: Already initialized');
            return;
        }

        try {
            this.initializeTemplates();
            this.bindEventListeners();
            this.configureToastr();
            this.initialized = true;
            console.log('NotificationManager: Initialized successfully');
        } catch (error) {
            console.error('NotificationManager: Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Initialize notification templates
     */
    initializeTemplates() {
        // Success templates
        this.templates.set('vectorization.complete', {
            type: 'success',
            title: '向量化完成',
            message: '已成功向量化 {count} 个项目',
            priority: this.priorities.NORMAL
        });

        this.templates.set('export.success', {
            type: 'success',
            title: '导出成功',
            message: '向量数据已导出',
            priority: this.priorities.NORMAL
        });

        this.templates.set('task.renamed', {
            type: 'success',
            title: '成功',
            message: '任务已重命名',
            priority: this.priorities.LOW
        });

        // Error templates
        this.templates.set('vectorization.failed', {
            type: 'error',
            title: '向量化失败',
            message: '{error}',
            priority: this.priorities.HIGH
        });

        this.templates.set('file.processing.failed', {
            type: 'error',
            title: '文件处理失败',
            message: '文件 "{filename}" 处理失败: {error}',
            priority: this.priorities.HIGH
        });

        this.templates.set('rerank.failed', {
            type: 'error',
            title: 'Rerank失败',
            message: 'Rerank失败，使用原始搜索结果',
            priority: this.priorities.NORMAL
        });

        this.templates.set('critical.error', {
            type: 'error',
            title: '严重错误',
            message: '向量化处理中发生严重错误，请检查控制台',
            priority: this.priorities.CRITICAL
        });

        // Warning templates
        this.templates.set('task.in.progress', {
            type: 'warning',
            title: '警告',
            message: '已有向量化任务在进行中',
            priority: this.priorities.NORMAL
        });

        this.templates.set('no.chat.selected', {
            type: 'warning',
            title: '未选择聊天',
            message: '请先选择一个聊天',
            priority: this.priorities.NORMAL
        });

        this.templates.set('no.content.selected', {
            type: 'warning',
            title: '未选择内容',
            message: '未选择要{action}的内容或过滤后内容为空',
            priority: this.priorities.NORMAL
        });

        this.templates.set('content.already.vectorized', {
            type: 'info',
            title: '信息',
            message: '所有选定内容均已被向量化，没有需要处理的新项目',
            priority: this.priorities.LOW
        });

        // Info templates
        this.templates.set('processing', {
            type: 'info',
            title: '处理中',
            message: '{message}',
            priority: this.priorities.NORMAL
        });

        this.templates.set('vectorization.aborted', {
            type: 'info',
            title: '中断',
            message: '向量化已中断，已清理部分数据',
            priority: this.priorities.NORMAL
        });

        this.templates.set('tags.found', {
            type: 'success',
            title: '标签扫描',
            message: '发现 {count} 个可用标签',
            priority: this.priorities.LOW
        });

        console.log('NotificationManager: Templates initialized');
    }

    /**
     * Configure toastr global options
     */
    configureToastr() {
        if (!this.toastr) {
            console.warn('NotificationManager: toastr not available');
            return;
        }

        // Apply default options
        this.toastr.options = { ...this.defaultOptions };

        console.log('NotificationManager: toastr configured');
    }

    /**
     * Bind event listeners
     */
    bindEventListeners() {
        if (!this.eventBus) {
            console.warn('NotificationManager: EventBus not available');
            return;
        }

        // Listen for notification requests
        this.eventBus.on('notification:show', (data) => {
            this.handleNotificationRequest(data);
        });

        this.eventBus.on('notification:queue', (data) => {
            this.queueNotification(data);
        });

        this.eventBus.on('notification:clear', () => {
            this.clearAll();
        });

        console.log('NotificationManager: Event listeners bound');
    }

    /**
     * Show notification using template
     */
    showFromTemplate(templateKey, params = {}, options = {}) {
        const template = this.templates.get(templateKey);
        if (!template) {
            console.warn(`NotificationManager: Template "${templateKey}" not found`);
            this.show('Unknown notification', 'info', options);
            return;
        }

        // Replace template variables
        let message = template.message;
        Object.entries(params).forEach(([key, value]) => {
            message = message.replace(`{${key}}`, value);
        });

        const title = template.title || '';
        const mergedOptions = {
            ...options,
            priority: template.priority
        };

        this.show(message, template.type, title, mergedOptions);
    }

    /**
     * Show notification directly
     */
    show(message, type = 'info', title = '', options = {}) {
        const notification = {
            message,
            type,
            title,
            options: { ...this.defaultOptions, ...options },
            timestamp: Date.now(),
            priority: options.priority || this.priorities.NORMAL
        };

        // Add to history
        this.addToHistory(notification);

        // Show immediately if high priority or no queue
        if (notification.priority >= this.priorities.HIGH || this.notificationQueue.length === 0) {
            this.displayNotification(notification);
        } else {
            this.queueNotification(notification);
        }
    }

    /**
     * Queue notification for later display
     */
    queueNotification(notification) {
        // Add to queue sorted by priority
        const insertIndex = this.notificationQueue.findIndex(n => n.priority < notification.priority);
        if (insertIndex === -1) {
            this.notificationQueue.push(notification);
        } else {
            this.notificationQueue.splice(insertIndex, 0, notification);
        }

        // Process queue if not already processing
        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    /**
     * Process notification queue
     */
    async processQueue() {
        if (this.isProcessing || this.notificationQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.notificationQueue.length > 0) {
            const notification = this.notificationQueue.shift();
            this.displayNotification(notification);
            
            // Brief delay between notifications
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.isProcessing = false;
    }

    /**
     * Display notification using toastr
     */
    displayNotification(notification) {
        if (!this.toastr) {
            console.log(`NotificationManager: [${notification.type}] ${notification.title} - ${notification.message}`);
            return;
        }

        // Emit event for other components to react
        if (this.eventBus) {
            this.eventBus.emit('notification:displayed', notification);
        }

        // Display using toastr
        const toastrMethod = this.toastr[notification.type] || this.toastr.info;
        toastrMethod(notification.message, notification.title, notification.options);
    }

    /**
     * Convenience methods
     */
    success(message, title = '成功', options = {}) {
        this.show(message, 'success', title, options);
    }

    error(message, title = '错误', options = {}) {
        this.show(message, 'error', title, { ...options, priority: this.priorities.HIGH });
    }

    warning(message, title = '警告', options = {}) {
        this.show(message, 'warning', title, options);
    }

    info(message, title = '信息', options = {}) {
        this.show(message, 'info', title, options);
    }

    /**
     * Clear all notifications
     */
    clearAll() {
        if (this.toastr) {
            this.toastr.clear();
        }
        this.notificationQueue = [];
    }

    /**
     * Handle notification request from event
     */
    handleNotificationRequest(data) {
        const { template, params, message, type, title, options } = data;

        if (template) {
            this.showFromTemplate(template, params, options);
        } else {
            this.show(message, type, title, options);
        }
    }

    /**
     * Add notification to history
     */
    addToHistory(notification) {
        this.history.unshift({
            ...notification,
            id: Date.now() + Math.random()
        });

        // Keep history size manageable
        if (this.history.length > this.maxHistorySize) {
            this.history = this.history.slice(0, this.maxHistorySize);
        }
    }

    /**
     * Get notification history
     */
    getHistory(filter = {}) {
        let filtered = [...this.history];

        if (filter.type) {
            filtered = filtered.filter(n => n.type === filter.type);
        }

        if (filter.since) {
            filtered = filtered.filter(n => n.timestamp >= filter.since);
        }

        if (filter.limit) {
            filtered = filtered.slice(0, filter.limit);
        }

        return filtered;
    }

    /**
     * Get notification statistics
     */
    getStats() {
        const stats = {
            total: this.history.length,
            byType: {
                success: 0,
                error: 0,
                warning: 0,
                info: 0
            },
            queueLength: this.notificationQueue.length,
            recentNotifications: this.history.slice(0, 5)
        };

        this.history.forEach(notification => {
            if (stats.byType[notification.type] !== undefined) {
                stats.byType[notification.type]++;
            }
        });

        return stats;
    }

    /**
     * Update notification options
     */
    updateOptions(options) {
        this.defaultOptions = { ...this.defaultOptions, ...options };
        if (this.toastr) {
            this.toastr.options = { ...this.defaultOptions };
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        console.log('NotificationManager: Destroying...');

        if (this.eventBus) {
            this.eventBus.off('notification:show');
            this.eventBus.off('notification:queue');
            this.eventBus.off('notification:clear');
        }

        this.clearAll();
        this.history = [];
        this.templates.clear();
        this.initialized = false;

        console.log('NotificationManager: Destroyed');
    }
}