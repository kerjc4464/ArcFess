/**
 * VectorizationSettings Component - Manages vectorization source selection and model configuration
 * (Updated: Throttler Input Box & Range Sync & Full Completeness)
 */

export class VectorizationSettings {
    constructor(dependencies = {}) {
        this.settings = dependencies.settings;
        this.configManager = dependencies.configManager;
        this.onSettingsChange = dependencies.onSettingsChange || (() => {});

        // Source configurations
        this.sourceConfigs = {
            transformers: {
                selector: '#vectors_enhanced_transformers_settings',
                fields: ['local_model']
            },
            vllm: {
                selector: '#vectors_enhanced_vllm_settings',
                fields: ['vllm_model', 'vllm_url', 'vllm_api_key']
            },
            ollama: {
                selector: '#vectors_enhanced_ollama_settings',
                fields: ['ollama_model', 'ollama_url', 'ollama_keep']
            },
            openai: {
                selector: '#vectors_enhanced_openai_settings',
                fields: ['openai_model', 'openai_url', 'openai_api_key']
            }
        };

        // Injection-related fields from InjectionSettings.js
        this.injectionFields = [
            'template',
            'depth',
            'depth_role',
            'include_wi',
        ];
        this.contentTagFields = ['tag_chat', 'tag_wi', 'tag_file'];

        this.initialized = false;
    }

    /**
     * Initialize VectorizationSettings component
     */
    async init() {
        if (this.initialized) {
            console.warn('VectorizationSettings: Already initialized');
            return;
        }

        try {
            // === 核心修改：动态注入 Fusion UI ===
            this.injectFusionUI(); 
            // =================================

            this.bindEventListeners();
            this.loadCurrentSettings();
            this.updateSourceVisibility();
            this.updatePositionVisibility(); // From InjectionSettings
            
            // 填充任务下拉菜单
            this._populateTaskDropdown();
            
            this.initialized = true;
            console.log('VectorizationSettings: Initialized successfully');
        } catch (error) {
            console.error('VectorizationSettings: Initialization failed:', error);
            throw error;
        }
    }

/**
     * [修改] 动态注入 Fusion UI (包含 Batch Size 滑块)
     */
    injectFusionUI() {
        const sourceSelect = $('#vectors_enhanced_source');
        if (sourceSelect.length === 0) return;

        const targetPoint = sourceSelect.parent(); 

        // 默认值处理
        const defaultBatchSize = this.settings.gen_batch_size || 6;

        const fusionTemplate = `
            <hr style="border-color: var(--SmartThemeBorderColor); opacity: 0.3; margin: 15px 0;">
            
            <div class="setting-item">
                <div class="setting-label" style="display:flex; justify-content:space-between;">
                    <div>
                        <small>Target Task (目标容器)</small>
                        <span class="setting-info" title="选择'新建任务'将创建新数据库。选择现有任务将执行增量融合(Fusion)。">ℹ️</span>
                    </div>
                    <span id="vectors_refresh_tasks" style="cursor:pointer; opacity:0.7;" title="刷新任务列表">🔄</span>
                </div>
                <select id="vectors_target_task" class="text_pole" style="width: 100%; margin-bottom: 5px;">
                    <option value="__NEW__">✨ 新建任务 (New Task)</option>
                </select>
            </div>

            <div class="setting-item" style="margin-top: 10px;">
                <div class="setting-label" style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <small>Generation Batch Size</small>
                        <span id="vectors_batch_status_label" style="font-size: 0.8em; margin-left: 8px; font-weight: bold;"></span>
                    </div>
                    <span class="range_value_label" id="vectors_gen_batch_size_value">${defaultBatchSize}</span>
                </div>
                <input type="range" id="vectors_gen_batch_size" min="1" max="30" step="1" value="${defaultBatchSize}" style="width:100%; margin-top: 5px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.7em; opacity: 0.5; margin-bottom: 2px;">
                    <span>1 (最稳/Stable)</span>
                    <span>30 (极速/Fast)</span>
                </div>
            </div>

            <div class="setting-item" style="margin-top: 10px;">
                <div class="setting-label" style="display:flex; justify-content:space-between; align-items:center;">
                    <small>API Request Delay (ms)</small>
                    <input type="number" id="vectors_api_delay" class="text_pole" min="0" step="100" value="4500" placeholder="ms" style="width: 80px; padding: 2px 5px; text-align: right;">
                </div>
                <input type="range" id="vectors_api_delay_range" min="0" max="10000" step="100" value="4500" style="width:100%; margin-top: 5px;">
                <small style="color:#888; font-size:0.8em; display:block; margin-top:2px; line-height: 1.4;">
                    <strong>💡 流量控制指南：</strong><br>
                    • <strong>Batch Size</strong>: 决定每次发多少块。API 容易报错(500)请调小。<br>
                    • <strong>Delay</strong>: 决定发完一批歇多久。API 限制频率(RPM)请调大。<br>
                </small>
            </div>
            
            <hr style="border-color: var(--SmartThemeBorderColor); opacity: 0.3; margin: 15px 0;">
        `;

        targetPoint.after(fusionTemplate);
        
        // 初始化状态文字颜色
        this._updateBatchStatusUI(defaultBatchSize);
    }

    /**
     * [新增] 辅助方法：更新 Batch Size 的状态文字和颜色
     */
    _updateBatchStatusUI(val) {
        const value = parseInt(val);
        const $label = $('#vectors_batch_status_label');
        
        if (value <= 3) {
            $label.text("🐢 安全模式").css('color', '#4caf50'); // 绿色
        } else if (value <= 8) {
            $label.text("⚖️ 平衡模式").css('color', 'var(--SmartThemeBodyColor)'); // 默认色
        } else if (value <= 15) {
            $label.text("🚀 性能模式").css('color', '#ff9800'); // 橙色
        } else {
            $label.text("🔥 狂暴模式").css('color', '#f44336'); // 红色
        }
    }

    /**
     * [修改] 填充任务下拉菜单 (支持自动刷新)
     */
    _populateTaskDropdown() {
        const select = $('#vectors_target_task');
        if (select.length === 0) return;

        // 保存当前选中的值
        const currentVal = select.val();

        // 清空现有选项（保留新建）
        select.find('option:not([value="__NEW__"])').remove();

        try {
            const context = SillyTavern.getContext();
            const chatId = context.chatId;
            
            if (!chatId) return;

            // 强制从全局变量读取最新设置
            const latestSettings = window.extension_settings?.vectors_enhanced || this.settings;
            const allTasks = latestSettings.vector_tasks?.[chatId] || [];

            // 按时间倒序
            const sortedTasks = [...allTasks].sort((a, b) => b.timestamp - a.timestamp);

            sortedTasks.forEach(task => {
                const date = new Date(task.timestamp).toLocaleString('zh-CN', {
                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                });
                const icon = task.isPartial ? '⚠️' : '📦';
                const name = task.name || '未命名任务';
                
                const opt = $('<option>', {
                    value: task.taskId,
                    text: `${icon} ${name} [${date}]`
                });
                select.append(opt);
            });

            // 恢复选中
            if (currentVal && select.find(`option[value="${currentVal}"]`).length > 0) {
                select.val(currentVal);
            } else {
                select.val('__NEW__');
            }

            // 重新绑定事件
            select.off('change').on('change', (e) => {
                if (e.target.value !== '__NEW__') {
                    const targetTask = allTasks.find(t => t.taskId === e.target.value);
                    this._checkFusionGuard(targetTask);
                }
            });
            
            console.log(`[Vectors] Dropdown refreshed. Found ${allTasks.length} tasks.`);

        } catch (e) {
            console.error("Fusion Dropdown Error:", e);
        }
    }

    /**
     * [新增] 检查融合兼容性
     */
    async _checkFusionGuard(targetTask) {
        if (!targetTask) return;
        
        try {
            const { FusionManager } = await import('../../core/FusionManager.js');
            const currentSettings = this.getSettings();
            
            const check = FusionManager.checkCompatibility(currentSettings, targetTask);
            
            if (!check.compatible) {
                toastr.error(check.fatal, "禁止合并 (Guard)");
                $('#vectors_target_task').val('__NEW__');
            } else if (check.warnings.length > 0) {
                let msg = check.warnings.map(w => `${w.param}: ${w.old} -> ${w.new}`).join('<br>');
                toastr.warning(`参数不一致 (建议修正):<br>${msg}`, "Fusion 警告");
            }
        } catch (e) {
            console.error("Fusion Check Failed:", e);
        }
    }

    /**
     * Bind event listeners
     */
    bindEventListeners() {
        // Source selection change
        $('#vectors_enhanced_source').on('change', (e) => {
            const newSource = e.target.value;
            this.handleSourceChange(newSource);
        });

        // Model and URL inputs
        this.bindSourceSpecificListeners('transformers');
        this.bindSourceSpecificListeners('vllm');
        this.bindSourceSpecificListeners('ollama');
        this.bindSourceSpecificListeners('openai');

        // General parameters
        this.bindParameterListeners();

        // === Fusion UI Listeners (Updated) ===
        
        // 1. Batch Size 滑块监听 [新增]
        $(document).on('input', '#vectors_gen_batch_size', (e) => {
            const val = parseInt(e.target.value);
            // 更新数字显示
            $('#vectors_gen_batch_size_value').text(val);
            // 更新状态文字
            this._updateBatchStatusUI(val);
            
            // 保存到设置
            this.settings.gen_batch_size = val;
            this.saveSettings();
            this.onSettingsChange('gen_batch_size', val);
        });

        // 2. API Delay 双向绑定
        $(document).on('input', '#vectors_api_delay', (e) => {
            const val = e.target.value;
            $('#vectors_api_delay_range').val(val);
            // 别忘了保存 Delay 设置
            // (通常 index.js 会直接读取 DOM，但为了规范最好也保存到 settings)
        });
        
        $(document).on('input', '#vectors_api_delay_range', (e) => {
            const val = e.target.value;
            $('#vectors_api_delay').val(val);
        });

        // 3. 任务列表刷新
        $(document).on('mousedown', '#vectors_target_task', () => {
             this._populateTaskDropdown();
        });

        $(document).on('click', '#vectors_refresh_tasks', () => {
            this._populateTaskDropdown();
            toastr.success('任务列表已刷新');
        });

        console.log('VectorizationSettings: Event listeners bound');

        // Injection Settings listeners
        $('#vectors_enhanced_template').on('input', (e) => this.handleFieldChange('template', e.target.value));
        this.contentTagFields.forEach(field => {
            $(`#vectors_enhanced_${field}`).on('input', (e) => {
                const key = field.replace('tag_', '');
                this.settings.content_tags[key] = e.target.value;
                this.saveSettings();
                this.onSettingsChange(`content_tags.${key}`, e.target.value);
            });
        });
        $('input[name="vectors_position"]').on('change', (e) => this.handlePositionChange(e.target.value));
        $('#vectors_enhanced_depth').on('input', (e) => this.handleFieldChange('depth', parseInt(e.target.value) || 0));
        $('#vectors_enhanced_depth_role').on('change', (e) => this.handleFieldChange('depth_role', parseInt(e.target.value) || 0));
        $('#vectors_enhanced_include_wi').on('change', (e) => this.handleFieldChange('include_wi', e.target.checked));
    }

    /**
     * Bind event listeners for a specific source
     */
    bindSourceSpecificListeners(source) {
        const config = this.sourceConfigs[source];
        if (!config) return;

        config.fields.forEach(field => {
            const fieldId = `#vectors_enhanced_${field}`;
            $(fieldId).on('input change', (e) => {
                this.handleFieldChange(field, e.target.value, e.target.type === 'checkbox' ? e.target.checked : undefined);
            });
        });
    }

    /**
     * Bind event listeners for general parameters
     * (Fixed: Handles both ID formats and registers safety settings)
     */
    bindParameterListeners() {
        const parameters = [
            'chunk_size',
            'overlap_percent',
            'score_threshold',
            'force_chunk_delimiter',
            'query_messages',
            'max_results',
            'enabled',
            'show_query_notification',
            'detailed_notification',
            // 🔥 新增：注册策略与熔断参数
            'safety_floor',
            'allow_quota_overflow'
        ];

        parameters.forEach(param => {
            // 🔍 智能 ID 查找：尝试带前缀和不带前缀两种 ID
            let field = $(`#vectors_enhanced_${param}`);
            if (field.length === 0) {
                field = $(`#vectors_${param}`);
            }

            if (field.length) {
                // 先解绑防止重复，再绑定
                field.off('input change').on('input change', (e) => {
                    let value = e.target.value;

                    // Handle different input types
                    if (e.target.type === 'checkbox') {
                        value = e.target.checked;
                    } else if (e.target.type === 'number' || e.target.type === 'range') {
                        value = parseFloat(value) || 0;
                    }

                    this.handleFieldChange(param, value);
                });
            }
        });

        // Special handling for notification details visibility
        $('#vectors_enhanced_show_query_notification').on('change', (e) => {
            this.toggleNotificationDetails(e.target.checked);
        });
    }

    /**
     * Handle position selection change (from InjectionSettings)
     */
    handlePositionChange(positionValue) {
        console.log(`VectorizationSettings: Position changed to ${positionValue}`);
        this.settings.position = parseInt(positionValue);
        this.saveSettings();
        this.updatePositionVisibility();
        this.onSettingsChange('position', this.settings.position);
    }

    /**
     * Handle source selection change
     */
    handleSourceChange(newSource) {
        console.log(`VectorizationSettings: Source changed to ${newSource}`);

        // Update settings
        this.settings.source = newSource;
        this.saveSettings();

        // Update UI visibility
        this.updateSourceVisibility();

        // Validate source configuration
        this.validateSourceConfig(newSource);

        // Notify settings change
        this.onSettingsChange('source', newSource);
    }

    /**
     * Handle individual field changes
     */
    handleFieldChange(field, value, checkboxValue) {
        console.log(`VectorizationSettings: Field ${field} changed to:`, value);

        // Handle checkbox fields
        if (checkboxValue !== undefined) {
            value = checkboxValue;
        }

        // Update settings object
        if (this.settings.hasOwnProperty(field)) {
            this.settings[field] = value;
        }
        this.saveSettings();

        // Special handling for certain fields
        if (field === 'show_query_notification') {
            this.toggleNotificationDetails(value);
        } else if (field === 'enabled' && !value) {
            // When vector query is disabled, also disable rerank
            this.disableRerank();
        } else if (field === 'template') {
            this.validateTemplate(value);
        }

        // Notify settings change
        this.onSettingsChange(field, value);
    }

    /**
     * Update source-specific settings visibility
     */
    updateSourceVisibility() {
        const currentSource = this.settings.source;

        // Hide all source-specific settings
        Object.values(this.sourceConfigs).forEach(config => {
            $(config.selector).hide();
        });

        // Show current source settings
        if (this.sourceConfigs[currentSource]) {
            $(this.sourceConfigs[currentSource].selector).show();
        }

        console.log(`VectorizationSettings: Updated visibility for source: ${currentSource}`);
    }

    /**
     * Toggle notification details visibility
     */
    toggleNotificationDetails(show) {
        const detailsSection = $('#vectors_enhanced_notification_details');
        if (show) {
            detailsSection.show();
        } else {
            detailsSection.hide();
        }
    }

    /**
     * Disable rerank when vector query is disabled
     */
    disableRerank() {
        console.log('VectorizationSettings: Disabling rerank due to vector query being disabled');

        // Update rerank settings
        this.settings.rerank_enabled = false;

        // Update the UI checkbox
        const rerankCheckbox = $('#vectors_enhanced_rerank_enabled');
        if (rerankCheckbox.length) {
            rerankCheckbox.prop('checked', false);
            // Trigger change event to update the QuerySettings component
            rerankCheckbox.trigger('change');
        }

        // Save settings
        this.saveSettings();

        // Notify the change
        this.onSettingsChange('rerank_enabled', false);
    }

    /**
     * Load current settings into UI elements
     * (Fixed: Loads safety settings and Fusion UI elements correctly)
     */
    loadCurrentSettings() {
        console.log('VectorizationSettings: Loading current settings...');
        
        // 1. 加载 Fusion UI (Batch Size) - 必须防止为空
        const batchSize = this.settings.gen_batch_size || 6;
        const $batchInput = $('#vectors_gen_batch_size');
        if ($batchInput.length) {
            $batchInput.val(batchSize);
            $('#vectors_gen_batch_size_value').text(batchSize);
            if (this._updateBatchStatusUI) this._updateBatchStatusUI(batchSize);
        }

        // 2. 加载源选择
        $('#vectors_enhanced_source').val(this.settings.source);

        // 3. 加载源特定设置
        Object.entries(this.sourceConfigs).forEach(([source, config]) => {
            config.fields.forEach(field => {
                const fieldId = `#vectors_enhanced_${field}`;
                const element = $(fieldId);

                if (element.length && this.settings[field] !== undefined) {
                    if (element.attr('type') === 'checkbox') {
                        element.prop('checked', this.settings[field]);
                    } else {
                        element.val(this.settings[field]);
                    }
                }
            });
        });

        // 4. 加载通用参数 (包含新参数)
        const parameters = [
            'chunk_size', 'overlap_percent', 'score_threshold', 'force_chunk_delimiter',
            'query_messages', 'max_results', 'enabled', 'show_query_notification', 'detailed_notification',
            // 🔥 新增：加载策略与熔断参数
            'safety_floor',
            'allow_quota_overflow'
        ];

        parameters.forEach(param => {
            // 🔍 智能 ID 查找
            let element = $(`#vectors_enhanced_${param}`);
            if (element.length === 0) {
                element = $(`#vectors_${param}`);
            }

            if (element.length && this.settings[param] !== undefined) {
                if (element.attr('type') === 'checkbox') {
                    element.prop('checked', this.settings[param]);
                } else {
                    element.val(this.settings[param]);
                }
            }
        });

        // Update notification details visibility
        this.toggleNotificationDetails(this.settings.show_query_notification);

        console.log('VectorizationSettings: Settings loaded');

        // 5. 加载注入设置 (InjectionSettings)
        this.injectionFields.forEach(field => {
            const element = $(`#vectors_enhanced_${field}`);
            if (element.length && this.settings[field] !== undefined) {
                if (element.attr('type') === 'checkbox') {
                    element.prop('checked', this.settings[field]);
                } else {
                    element.val(this.settings[field]);
                }
            }
        });
        this.contentTagFields.forEach(field => {
            const key = field.replace('tag_', '');
            const element = $(`#vectors_enhanced_${field}`);
            if (element.length && this.settings.content_tags[key] !== undefined) {
                element.val(this.settings.content_tags[key]);
            }
        });
        if (this.settings.position !== undefined) {
            $(`input[name="vectors_position"][value="${this.settings.position}"]`).prop('checked', true);
        }
    }

    /**
     * Validate source configuration
     */
    validateSourceConfig(source) {
        const config = this.sourceConfigs[source];
        if (!config) {
            console.warn(`VectorizationSettings: Unknown source: ${source}`);
            return false;
        }

        let isValid = true;
        const errors = [];

        // Validate required fields for each source
        switch (source) {
            case 'vllm':
                if (!this.settings.vllm_model) {
                    errors.push('vLLM model name is required');
                    isValid = false;
                }
                break;
            case 'ollama':
                if (!this.settings.ollama_model) {
                    errors.push('Ollama model name is required');
                    isValid = false;
                }
                break;
            // Transformers doesn't require specific validation
        }

        // Validate numerical parameters
        if (this.settings.chunk_size < 100) {
            errors.push('Chunk size must be at least 100');
            isValid = false;
        }

        if (this.settings.overlap_percent < 0 || this.settings.overlap_percent > 50) {
            errors.push('Overlap percentage must be between 0 and 50');
            isValid = false;
        }

        if (this.settings.score_threshold < 0 || this.settings.score_threshold > 1) {
            errors.push('Score threshold must be between 0 and 1');
            isValid = false;
        }

        if (errors.length > 0) {
            console.warn('VectorizationSettings: Validation errors:', errors);
        }

        return isValid;
    }

    /**
     * Save settings using ConfigManager
     */
    saveSettings() {
        if (this.configManager) {
            // ConfigManager will handle the actual saving
            console.debug('VectorizationSettings: Settings saved via ConfigManager');
        } else {
            console.warn('VectorizationSettings: No ConfigManager available for saving');
        }
    }

    /**
     * Refresh the component - reload settings and update UI
     */
    async refresh() {
        console.log('VectorizationSettings: Refreshing...');
        // 重新填充下拉菜单
        this._populateTaskDropdown();
        this.loadCurrentSettings();
        this.updateSourceVisibility();
        console.log('VectorizationSettings: Refresh completed');
    }

    /**
     * Get current source configuration status
     */
    getSourceStatus() {
        const currentSource = this.settings.source;
        return {
            source: currentSource,
            isValid: this.validateSourceConfig(currentSource),
            config: this.sourceConfigs[currentSource] || null
        };
    }

    /**
     * Get all vectorization settings
     */
    getSettings() {
        return {
            source: this.settings.source,
            local_model: this.settings.local_model,
            vllm_model: this.settings.vllm_model,
            vllm_url: this.settings.vllm_url,
            ollama_model: this.settings.ollama_model,
            ollama_url: this.settings.ollama_url,
            ollama_keep: this.settings.ollama_keep,
            chunk_size: this.settings.chunk_size,
            overlap_percent: this.settings.overlap_percent,
            score_threshold: this.settings.score_threshold,
            force_chunk_delimiter: this.settings.force_chunk_delimiter,
            query_messages: this.settings.query_messages,
            max_results: this.settings.max_results,
            enabled: this.settings.enabled,
            show_query_notification: this.settings.show_query_notification,
            detailed_notification: this.settings.detailed_notification
        };
    }

    /**
     * Cleanup - remove event listeners
     */
    destroy() {
        console.log('VectorizationSettings: Destroying...');

        // Remove event listeners
        $('#vectors_enhanced_source').off('change');

        // Remove source-specific listeners
        Object.entries(this.sourceConfigs).forEach(([source, config]) => {
            config.fields.forEach(field => {
                $(`#vectors_enhanced_${field}`).off('input change');
            });
        });

        // Remove parameter listeners
        const parameters = [
            'chunk_size', 'overlap_percent', 'score_threshold', 'force_chunk_delimiter',
            'query_messages', 'max_results', 'enabled', 'show_query_notification', 'detailed_notification'
        ];

        parameters.forEach(param => {
            $(`#vectors_enhanced_${param}`).off('input change');
        });
        
        // Remove Fusion Listeners
        $(document).off('input', '#vectors_api_delay');
        $(document).off('input', '#vectors_api_delay_range');
        $(document).off('mousedown', '#vectors_target_task');
        $(document).off('click', '#vectors_refresh_tasks');

        this.initialized = false;
        console.log('VectorizationSettings: Destroyed');
    }
}

// Helper methods from InjectionSettings.js
Object.assign(VectorizationSettings.prototype, {
    updatePositionVisibility() {
        const position = this.settings.position;
        const depthControls = $('#vectors_enhanced_depth_controls');
        if (position === 1) { // at_depth
            depthControls.show();
        } else {
            depthControls.hide();
        }
        console.log(`VectorizationSettings: Updated position visibility (position: ${position})`);
    },

    validateTemplate(template) {
        const errors = [];
        let isValid = true;
        if (!template || template.trim() === '') {
            errors.push('Injection template cannot be empty');
            isValid = false;
        } else if (!template.includes('{{text}}')) {
            errors.push('Template must contain {{text}} placeholder');
            isValid = false;
        }
        if (errors.length > 0) {
            this.showTemplateErrors(errors);
        } else {
            this.clearTemplateErrors();
        }
        return isValid;
    },

    showTemplateErrors(errors) {
        let errorContainer = $('#vectors_enhanced_template_errors');
        if (errorContainer.length === 0) {
            errorContainer = $('<div>', {
                id: 'vectors_enhanced_template_errors',
                class: 'text-danger m-t-0-5',
                style: 'font-size: 0.9em;'
            });
            $('#vectors_enhanced_template').after(errorContainer);
        }
        const errorHtml = errors.map(error => `<div>• ${error}</div>`).join('');
        errorContainer.html(`<strong>模板错误:</strong>${errorHtml}`).show();
    },

    clearTemplateErrors() {
        $('#vectors_enhanced_template_errors').hide();
    }
});