/**
 * Vector Storage Path UI Component - Custom Modal Version
 * Handles UI for querying vector storage paths without using SillyTavern's popup system
 */

import { getCurrentChatId } from '../../../../../../../script.js';
import { extension_settings } from '../../../../../../extensions.js';

export class VectorStoragePathUI {
    constructor() {
        this.settings = null;
        this.currentChatId = null;
        this.initialized = false;
        this.modal = null;
    }

    /**
     * Initialize the component
     * @param {Object} settings - Settings object containing vector_tasks
     */
    async init(settings) {
        console.log('VectorStoragePathUI: Initializing...');

        if (this.initialized) {
            console.warn('VectorStoragePathUI already initialized');
            return;
        }

        this.settings = settings;
        this.bindEvents();
        this.initialized = true;
        console.log('VectorStoragePathUI initialized successfully');
    }

    /**
     * Bind UI events
     */
    bindEvents() {
        console.log('VectorStoragePathUI: Binding events');

        // Remove any existing handlers first
        $('#vectors_enhanced_query_storage_path').off('click');

        // Bind query button click event
        $('#vectors_enhanced_query_storage_path').on('click', async (e) => {
            console.log('VectorStoragePathUI: Query button clicked');
            e.preventDefault();
            e.stopPropagation();

            try {
                await this.showStoragePathDialog();
            } catch (error) {
                console.error('VectorStoragePathUI: Error in showStoragePathDialog:', error);
                toastr.error('无法显示存储路径对话框: ' + error.message);
            }
        });
    }

    /**
     * Show storage path dialog using custom modal
     */
    async showStoragePathDialog() {
        console.log('VectorStoragePathUI: showStoragePathDialog called');

        try {
            // Get current chat ID
            const currentChatId = getCurrentChatId();
            if (!currentChatId) {
                toastr.warning('请先打开一个聊天');
                return;
            }

            // Get tasks for current chat
            const tasks = this.getTasksForChat(currentChatId);
            if (tasks.length === 0) {
                toastr.info('当前聊天没有向量化任务');
                return;
            }

            // Create modal HTML
            const modalHtml = `
                <div class="vector-storage-modal-overlay" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;">
                    <div class="vector-storage-modal" style="background: var(--SmartThemeBlurTintColor); border-radius: 8px; padding: 20px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3); margin: auto; position: relative;">
                        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                            <h3 style="margin: 0;">查询向量存储地址</h3>
                            <button class="menu_button" id="close-modal" style="padding: 5px 10px;">
                                <i class="fa-solid fa-times"></i>
                            </button>
                        </div>
                        
                        <div class="form-group" style="margin-bottom: 1rem;">
                            <label for="task-select" style="display: block; margin-bottom: 0.5rem;">选择向量化任务:</label>
                            <select id="task-select" class="form-control" style="width: 100%;">
                                <option value="">-- 选择任务 --</option>
                                ${tasks.map(task => 
                                    `<option value="${task.taskId}" data-task-type="${task.type || 'regular'}">${task.name} ${task.type === 'external' ? '[外挂]' : ''}</option>`
                                ).join('')}
                            </select>
                        </div>
                        
                        <div class="form-group" id="storage-path-info" style="display: none; margin-bottom: 1rem;">
                            <label style="display: block; margin-bottom: 0.5rem;">存储路径信息:</label>
                            <div id="storage-path-details" style="padding: 1rem; background: var(--SmartThemeBlurTintColor); border-radius: 5px; font-family: monospace; word-break: break-all; line-height: 1.5; border: 1px solid var(--SmartThemeBorderColor);"></div>
                            <div style="margin-top: 0.5rem;">
                                <small style="color: var(--SmartThemeQuoteColor);">
                                    * 向量数据存储在服务器端，完整路径基于 SillyTavern 的数据目录结构
                                </small>
                            </div>
                        </div>
                        
                        <div class="flex-container" style="justify-content: flex-end; gap: 10px; margin-top: 1.5rem;">
                            <button class="menu_button" id="copy-path" style="display: none; width: auto; min-width: fit-content;">
                                <i class="fa-solid fa-copy"></i> 复制路径
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // Remove any existing modal
            $('.vector-storage-modal-overlay').remove();

            // Add modal to body
            this.modal = $(modalHtml);
            $('body').append(this.modal);

            // Bind modal events
            this.bindModalEvents(currentChatId);

        } catch (error) {
            console.error('VectorStoragePathUI: Error in showStoragePathDialog:', error);
            throw error;
        }
    }

    /**
     * Bind modal events
     * @param {string} chatId - Current chat ID
     */
    bindModalEvents(chatId) {
        // Close modal when clicking overlay
        this.modal.on('click', (e) => {
            if (e.target === e.currentTarget) {
                this.closeModal();
            }
        });

        // Close button
        this.modal.find('#close-modal').on('click', () => {
            this.closeModal();
        });

        // Task selection event
        this.modal.find('#task-select').on('change', (e) => {
            const taskId = e.target.value;
            const taskType = $(e.target).find(':selected').data('task-type');
            
            if (taskId) {
                this.displayStoragePath(chatId, taskId, taskType);
            } else {
                this.modal.find('#storage-path-info').hide();
                this.modal.find('#copy-path').hide();
            }
        });

        // Copy button
        this.modal.find('#copy-path').on('click', () => {
            const pathText = this.modal.find('#storage-path-details').text();
            this.copyToClipboard(pathText);
        });

        // ESC key to close
        $(document).on('keydown.vectorStorageModal', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
            }
        });
    }

    /**
     * Close the modal
     */
    closeModal() {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
            $(document).off('keydown.vectorStorageModal');
        }
    }

    /**
     * Display storage path for selected task
     * @param {string} chatId - Chat ID
     * @param {string} taskId - Task ID
     * @param {string} taskType - Task type (regular or external)
     */
    displayStoragePath(chatId, taskId, taskType) {
        console.log('VectorStoragePathUI: displayStoragePath called', { chatId, taskId, taskType });
        
        // Get current vector source and model
        const vectorSource = this.settings?.source || 'unknown';
        const vectorModel = this.getVectorModel();
        
        console.log('VectorStoragePathUI: Vector settings', { vectorSource, vectorModel });

        let pathInfo = '';
        
        // Construct the full path structure
        const dataRoot = 'sillytavern/data/default-user'; // Full SillyTavern path structure
        
        if (taskType === 'external') {
            // External task - find the source
            const task = this.getTask(chatId, taskId);
            console.log('VectorStoragePathUI: External task found', task);
            
            if (task && task.source) {
                const relativePath = `vectors/${vectorSource}/${task.source}/${vectorModel || 'default'}/`;
                const fullPath = `${dataRoot}/${relativePath}`;
                
                pathInfo = `
                    <div style="margin-bottom: 1rem;">请前往下列地址复制index.json文件：</div>
                    <div style="padding: 0.75rem; background: rgba(0,0,0,0.3); border-radius: 4px; font-size: 0.9em;">
                        ${fullPath}
                    </div>
                `;
            } else {
                pathInfo = '<div style="color: var(--SmartThemeErrorColor);">无法获取外挂任务的源信息</div>';
            }
        } else {
            // Regular task
            const collectionId = `${chatId}_${taskId}`;
            const relativePath = `vectors/${vectorSource}/${collectionId}/${vectorModel || 'default'}/`;
            const fullPath = `${dataRoot}/${relativePath}`;
            
            pathInfo = `
                <div style="margin-bottom: 1rem;">请前往下列地址复制index.json文件：</div>
                <div style="padding: 0.75rem; background: rgba(0,0,0,0.3); border-radius: 4px; font-size: 0.9em;">
                    ${fullPath}
                </div>
            `;
        }

        // Add vector engine info
        pathInfo += `
            <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--SmartThemeBorderColor);">
                <div style="margin-bottom: 0.5rem;"><strong>向量化引擎:</strong> ${vectorSource}</div>
                <div><strong>模型:</strong> ${vectorModel || '默认'}</div>
            </div>
        `;

        // Update DOM
        this.modal.find('#storage-path-details').html(pathInfo);
        this.modal.find('#storage-path-info').show();
        this.modal.find('#copy-path').show();
    }

    /**
     * Get tasks for a specific chat
     * @param {string} chatId - Chat ID
     * @returns {Array} Tasks array
     */
    getTasksForChat(chatId) {
        if (!this.settings?.vector_tasks || !this.settings.vector_tasks[chatId]) {
            return [];
        }
        return this.settings.vector_tasks[chatId];
    }

    /**
     * Get a specific task
     * @param {string} chatId - Chat ID
     * @param {string} taskId - Task ID
     * @returns {Object|null} Task object or null
     */
    getTask(chatId, taskId) {
        const tasks = this.getTasksForChat(chatId);
        return tasks.find(t => t.taskId === taskId) || null;
    }

    /**
     * Get vector model based on current settings
     * @returns {string} Model name or empty string
     */
    getVectorModel() {
        const source = this.settings?.source;
        if (!source) return '';

        // Get the actual settings from extension_settings
        const vectorSettings = extension_settings?.vectors_enhanced || this.settings;

        // Different sources have different model settings
        switch (source) {
            case 'openai':
            case 'mistral':
            case 'togetherai':
                return vectorSettings?.openai_model || '';
            case 'cohere':
                return vectorSettings?.cohere_model || '';
            case 'ollama':
                return vectorSettings?.ollama_model || '';
            case 'vllm':
                return vectorSettings?.vllm_model || '';
            default:
                return '';
        }
    }

    /**
     * Copy text to clipboard
     * @param {string} text - Text to copy
     */
    async copyToClipboard(text) {
        try {
            // Extract the path from the storage path details element
            const pathElement = this.modal.find('#storage-path-details > div').filter(function() {
                return $(this).css('padding') === '0.75rem' || $(this).css('padding') === '12px';
            });
            
            const pathToCopy = pathElement.text().trim() || text;

            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(pathToCopy);
                toastr.success('路径已复制到剪贴板');
            } else {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = pathToCopy;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                toastr.success('路径已复制到剪贴板');
            }
        } catch (error) {
            console.error('Failed to copy to clipboard:', error);
            toastr.error('复制失败: ' + error.message);
        }
    }
}