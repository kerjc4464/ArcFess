/**
 * QuerySettings Component - Manages query-related settings including Rerank
 * 
 * Handles:
 * - Rerank enable/disable
 * - Rerank API configuration (URL, API Key, Model)
 * - Rerank parameters (Top N, Hybrid Alpha)
 * - Rerank notifications
 */

export class QuerySettings {
    constructor(dependencies = {}) {
        this.settings = dependencies.settings;
        this.configManager = dependencies.configManager;
        this.onSettingsChange = dependencies.onSettingsChange || (() => {});
        this.toastr = dependencies.toastr || window.toastr;
        
        // Dependencies for preview functionality
        this.callGenericPopup = dependencies.callGenericPopup;
        this.POPUP_TYPE = dependencies.POPUP_TYPE;
        this.rearrangeChat = dependencies.rearrangeChat;
        this.getContext = dependencies.getContext;
        this.getCurrentChatId = dependencies.getCurrentChatId;
        
        // Rerank configuration fields
        this.rerankFields = [
            'rerank_enabled',
            'rerank_success_notify',
            'rerank_use_proxy',
            'rerank_url',
            'rerank_apiKey',
            'rerank_model',
            'rerank_top_n',
            'rerank_hybrid_alpha'
        ];

        // 🧠 意图分析引擎字段 (v7.1)
        this.thoughtFields = [
            'thought_engine_enabled',
            'thought_engine_use_proxy',
            'thought_engine_proxy_url',
            'thought_engine_url',
            'thought_engine_apiKey',
            'thought_engine_auth_type',
            'thought_engine_model',
            'thought_engine_mode',
            'thought_engine_content_mode',
            'thought_engine_timeout',
            'thought_engine_max_tokens',
            'thought_engine_context_size',
            'thought_engine_prompt',
            'thought_engine_step1_prompt',
            'thought_engine_step2_prompt',
            'thought_engine_step3_prompt',
            'thought_engine_step1_enabled',
            'thought_engine_step1_custom',
            'thought_engine_step1_url',
            'thought_engine_step1_apiKey',
            'thought_engine_step1_model',
            'thought_engine_step1_context_size',
            'thought_engine_step1_max_tokens',
            'thought_engine_step1_timeout',
            'thought_engine_step2_enabled',
            'thought_engine_step2_custom',
            'thought_engine_step2_url',
            'thought_engine_step2_apiKey',
            'thought_engine_step2_model',
            'thought_engine_step2_context_size',
            'thought_engine_step2_max_tokens',
            'thought_engine_step2_timeout',
            'thought_engine_step3_enabled',
            'thought_engine_step3_custom',
            'thought_engine_step3_url',
            'thought_engine_step3_apiKey',
            'thought_engine_step3_model',
            'thought_engine_step3_context_size',
            'thought_engine_step3_max_tokens',
            'thought_engine_step3_timeout',
            'thought_engine_retry_enabled',
            'thought_engine_retry_count',
            'thought_engine_retry_delay',
            'sense_reason_ratio'
        ];
        
        this.initialized = false;
    }

    /**
     * Initialize QuerySettings component
     */
    async init() {
        if (this.initialized) {
            console.warn('QuerySettings: Already initialized');
            return;
        }

        try {
            this.bindEventListeners();
            this.loadCurrentSettings();
            // loadCurrentSettings() now calls updateRerankVisibility(), so no need to call it again
            this.initialized = true;
            console.log('QuerySettings: Initialized successfully');
        } catch (error) {
            console.error('QuerySettings: Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Bind event listeners for query settings
     */
    bindEventListeners() {
        // Rerank enable/disable
        $('#vectors_enhanced_rerank_enabled').on('change', (e) => {
            this.handleRerankToggle(e.target.checked);
        });

        // Rerank API configuration
        $('#vectors_enhanced_rerank_url').on('input', (e) => {
            this.handleFieldChange('rerank_url', e.target.value);
        });

        $('#vectors_enhanced_rerank_apiKey').on('input', (e) => {
            this.handleFieldChange('rerank_apiKey', e.target.value);
        });

        $('#vectors_enhanced_rerank_model').on('input', (e) => {
            this.handleFieldChange('rerank_model', e.target.value);
        });

        // Rerank parameters
        $('#vectors_enhanced_rerank_top_n').on('input', (e) => {
            const value = parseInt(e.target.value) || 1;
            this.handleFieldChange('rerank_top_n', value);
        });

        $('#vectors_enhanced_rerank_hybrid_alpha').on('input', (e) => {
            const value = parseFloat(e.target.value) || 0;
            this.handleFieldChange('rerank_hybrid_alpha', value);
        });

        // Rerank success notification
        $('#vectors_enhanced_rerank_success_notify').on('change', (e) => {
            this.handleFieldChange('rerank_success_notify', e.target.checked);
        });

        $('#vectors_enhanced_rerank_use_proxy').on('change', (e) => {
            this.handleFieldChange('rerank_use_proxy', e.target.checked);
        });

        // 🧠 新增：思考引擎事件绑定
        $('#vectors_enhanced_thought_engine_enabled').on('change', (e) => {
            this.handleThoughtToggle(e.target.checked);
        });
        $('#vectors_enhanced_thought_engine_use_proxy').on('change', (e) => {
            this.handleProxyToggle(e.target.checked);
        });
        $('#vectors_enhanced_thought_engine_proxy_url').on('input', (e) => {
            this.handleFieldChange('thought_engine_proxy_url', e.target.value);
        });
        $('#vectors_enhanced_thought_engine_url').on('input', (e) => {
            this.handleFieldChange('thought_engine_url', e.target.value);
        });
        $('#vectors_enhanced_thought_engine_apiKey').on('input', (e) => {
            this.handleFieldChange('thought_engine_apiKey', e.target.value);
        });
        $('#vectors_enhanced_thought_engine_auth_type').on('change', (e) => {
            this.handleFieldChange('thought_engine_auth_type', e.target.value);
        });
        $('#vectors_enhanced_thought_engine_model').on('input', (e) => {
            this.handleFieldChange('thought_engine_model', e.target.value);
        });
        $('#vectors_enhanced_thought_engine_timeout').on('input', (e) => {
            this.handleFieldChange('thought_engine_timeout', parseInt(e.target.value) || 10);
        });
        $('#vectors_enhanced_thought_engine_max_tokens').on('input', (e) => {
            this.handleFieldChange('thought_engine_max_tokens', parseInt(e.target.value) || 4096);
        });
        $('#vectors_enhanced_thought_engine_temperature').on('input', (e) => {
            this.handleFieldChange('thought_engine_temperature', Number(e.target.value));
        });
        $('#vectors_enhanced_thought_engine_top_p').on('input', (e) => {
            this.handleFieldChange('thought_engine_top_p', Number(e.target.value));
        });
        $('#vectors_enhanced_thought_engine_top_k').on('input', (e) => {
            this.handleFieldChange('thought_engine_top_k', parseInt(e.target.value));
        });
        $('#vectors_enhanced_thought_engine_frequency_penalty').on('input', (e) => {
            this.handleFieldChange('thought_engine_frequency_penalty', Number(e.target.value));
        });
        $('#vectors_enhanced_thought_engine_presence_penalty').on('input', (e) => {
            this.handleFieldChange('thought_engine_presence_penalty', Number(e.target.value));
        });
        $('#vectors_enhanced_thought_engine_reasoning_effort').on('change', (e) => {
            this.handleFieldChange('thought_engine_reasoning_effort', e.target.value);
        });
        $('#vectors_enhanced_thought_engine_context_size').on('input', (e) => {
            this.handleFieldChange('thought_engine_context_size', parseInt(e.target.value) || 6);
        });
        $('#vectors_enhanced_thought_engine_retry_enabled').on('change', (e) => {
            this.handleFieldChange('thought_engine_retry_enabled', e.target.checked);
            this.updateRetryFieldsVisibility();
        });
        $('#vectors_enhanced_thought_engine_retry_count').on('input', (e) => {
            this.handleFieldChange('thought_engine_retry_count', parseInt(e.target.value) || 3);
        });
        $('#vectors_enhanced_thought_engine_retry_delay').on('input', (e) => {
            this.handleFieldChange('thought_engine_retry_delay', parseInt(e.target.value) || 1000);
        });
        $('#vectors_enhanced_thought_engine_prompt').on('input', (e) => {
            this.handleFieldChange('thought_engine_prompt', e.target.value);
        });

        // v7.1 分析模式切换
        $('#vectors_enhanced_thought_engine_mode').on('change', (e) => {
            this.handleThoughtModeChange(e.target.value);
        });

        // v7.1 内容提取策略
        $('#vectors_enhanced_thought_engine_content_mode').on('change', (e) => {
            this.handleFieldChange('thought_engine_content_mode', e.target.value);
        });

        // v7.1 多步调用 Prompt 绑定
        $('#vectors_enhanced_thought_engine_step1_prompt').on('input', (e) => {
            this.handleFieldChange('thought_engine_step1_prompt', e.target.value);
        });
        $('#vectors_enhanced_thought_engine_step2_prompt').on('input', (e) => {
            this.handleFieldChange('thought_engine_step2_prompt', e.target.value);
        });
        $('#vectors_enhanced_thought_engine_step3_prompt').on('input', (e) => {
            this.handleFieldChange('thought_engine_step3_prompt', e.target.value);
        });

        // v7.2 Per-step custom API settings — checkbox toggles
        for (let i = 1; i <= 3; i++) {
            const n = i;
            $(`#vectors_enhanced_thought_engine_step${n}_enabled`).on('change', (e) => {
                this.handleFieldChange(`thought_engine_step${n}_enabled`, e.target.checked);
            });
            $(`#vectors_enhanced_thought_engine_step${n}_custom`).on('change', (e) => {
                this.handleFieldChange(`thought_engine_step${n}_custom`, e.target.checked);
                $(`#step${n}_custom_settings`).slideToggle(!!e.target.checked);
            });
            $(`#vectors_enhanced_thought_engine_step${n}_url`).on('input', (e) => {
                this.handleFieldChange(`thought_engine_step${n}_url`, e.target.value);
            });
            $(`#vectors_enhanced_thought_engine_step${n}_apiKey`).on('input', (e) => {
                this.handleFieldChange(`thought_engine_step${n}_apiKey`, e.target.value);
            });
            $(`#vectors_enhanced_thought_engine_step${n}_model`).on('input', (e) => {
                this.handleFieldChange(`thought_engine_step${n}_model`, e.target.value);
            });
            $(`#vectors_enhanced_thought_engine_step${n}_context_size`).on('input', (e) => {
                const val = e.target.value.trim();
                this.handleFieldChange(`thought_engine_step${n}_context_size`, val === '' ? '' : (parseInt(val) || 0));
            });
            $(`#vectors_enhanced_thought_engine_step${n}_max_tokens`).on('input', (e) => {
                const val = e.target.value.trim();
                this.handleFieldChange(`thought_engine_step${n}_max_tokens`, val === '' ? '' : (parseInt(val) || 0));
            });
            $(`#vectors_enhanced_thought_engine_step${n}_timeout`).on('input', (e) => {
                const val = e.target.value.trim();
                this.handleFieldChange(`thought_engine_step${n}_timeout`, val === '' ? '' : (parseInt(val) || 0));
            });
        }

        // v7.1 α 比例滑块
        $('#vectors_enhanced_sense_reason_ratio').on('input', (e) => {
            const val = parseFloat(e.target.value) || 0.6;
            this.handleFieldChange('sense_reason_ratio', val);
            this.updateAlphaDisplay(val);
        });

        // 复制思考输出
        $('#copy_thought_output').on('click', () => {
            const text = $('#vectors_enhanced_thought_output').val();
            if (text && text.trim()) {
                navigator.clipboard.writeText(text).then(() => {
                    if (typeof toastr !== 'undefined') toastr.success('已复制到剪贴板');
                }).catch(() => {
                    if (typeof toastr !== 'undefined') toastr.error('复制失败');
                });
            }
        });

        // 🧪 测试意图分析连接
        $('#test_thought_engine').on('click', async () => {
            await this.testThoughtConnection();
        });

        // Query instruction settings
        $('#vectors_enhanced_query_instruction_enabled').on('change', (e) => {
            this.handleQueryInstructionToggle(e.target.checked);
        });

        $('#vectors_enhanced_query_instruction_template').on('input', (e) => {
            this.handleFieldChange('query_instruction_template', e.target.value);
        });

        $('#vectors_enhanced_query_instruction_preset').on('change', (e) => {
            this.handlePresetChange(e.target.value);
        });

        $('#vectors_enhanced_rerank_deduplication_enabled').on('change', (e) => {
            this.handleRerankDeduplicationToggle(e.target.checked);
        });

        $('#vectors_enhanced_rerank_deduplication_instruction').on('input', (e) => {
            this.handleFieldChange('rerank_deduplication_instruction', e.target.value);
        });

        $('#reset_rerank_deduplication_instruction').on('click', () => {
            this.resetRerankDeduplicationInstruction();
        });

        $('#vectors_enhanced_preview_injection').on('click', () => {
            this.previewInjectedContent();
        });

        console.log('QuerySettings: Event listeners bound');
    }

    /**
     * Handle rerank enable/disable toggle
     */
    handleRerankToggle(enabled) {
        console.log(`QuerySettings: Rerank ${enabled ? 'enabled' : 'disabled'}`);
        
        this.settings.rerank_enabled = enabled;
        this.saveSettings();
        this.updateRerankVisibility();
        
        // Validate configuration if enabled
        if (enabled) {
            this.validateRerankConfig();
        }
        
        this.onSettingsChange('rerank_enabled', enabled);
    }

    /**
     * Handle individual field changes
     */
    handleFieldChange(field, value) {
        console.log(`QuerySettings: Field ${field} changed to:`, value);
        
        this.settings[field] = value;
        this.saveSettings();
        
        // Validate on changes if rerank is enabled
        if (this.settings.rerank_enabled) {
            this.validateRerankConfig();
        }
        
        this.onSettingsChange(field, value);
    }

    /**
     * Update rerank settings visibility based on enable state
     */
    updateRerankVisibility() {
        const rerankEnabled = this.settings.rerank_enabled;
        const rerankDetails = $('#vectors_enhanced_rerank_enabled').closest('details');
        
        // 注释掉自动展开的逻辑，保持用户的折叠状态
        // if (rerankEnabled) {
        //     rerankDetails.attr('open', true);
        // }
        
        // Enable/disable rerank configuration fields
        const configFields = [
            '#vectors_enhanced_rerank_url',
            '#vectors_enhanced_rerank_apiKey', 
            '#vectors_enhanced_rerank_model',
            '#vectors_enhanced_rerank_top_n',
            '#vectors_enhanced_rerank_hybrid_alpha',
            '#vectors_enhanced_rerank_success_notify',
            '#vectors_enhanced_rerank_use_proxy'
        ];
        
        configFields.forEach(fieldId => {
            const field = $(fieldId);
            if (field.length) {
                field.prop('disabled', !rerankEnabled);
                
                // Visual feedback - use proper CSS classes and opacity
                if (rerankEnabled) {
                    field.removeClass('disabled').css('opacity', '1');
                } else {
                    field.addClass('disabled').css('opacity', '0.5');
                }
            }
        });
        
        console.log(`QuerySettings: Updated rerank visibility (enabled: ${rerankEnabled})`);
    }
    /**
     * Handle Thought Engine toggle
     */
    handleThoughtToggle(enabled) {
        console.log(`QuerySettings: Thought Engine ${enabled ? 'enabled' : 'disabled'}`);
        this.settings.thought_engine_enabled = enabled;
        this.saveSettings();
        this.updateThoughtVisibility();
        this.onSettingsChange('thought_engine_enabled', enabled);
    }

    /**
     * Handle proxy toggle
     */
    handleProxyToggle(enabled) {
        this.settings.thought_engine_use_proxy = enabled;
        this.saveSettings();
        this.onSettingsChange('thought_engine_use_proxy', enabled);
        $('#proxy_url_section').toggle(enabled);
        console.log(`QuerySettings: Proxy mode ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Update Thought Engine visibility
     */
    updateThoughtVisibility() {
        const enabled = this.settings.thought_engine_enabled;
        const configFields = [
            '#vectors_enhanced_thought_engine_use_proxy',
            '#vectors_enhanced_thought_engine_proxy_url',
            '#vectors_enhanced_thought_engine_url',
            '#vectors_enhanced_thought_engine_apiKey',
            '#vectors_enhanced_thought_engine_auth_type',
            '#vectors_enhanced_thought_engine_model',
            '#vectors_enhanced_thought_engine_mode',
            '#vectors_enhanced_thought_engine_content_mode',
            '#vectors_enhanced_thought_engine_timeout',
            '#vectors_enhanced_thought_engine_max_tokens',
            '#vectors_enhanced_thought_engine_temperature',
            '#vectors_enhanced_thought_engine_top_p',
            '#vectors_enhanced_thought_engine_top_k',
            '#vectors_enhanced_thought_engine_frequency_penalty',
            '#vectors_enhanced_thought_engine_presence_penalty',
            '#vectors_enhanced_thought_engine_reasoning_effort',
            '#vectors_enhanced_thought_engine_context_size',
            '#vectors_enhanced_thought_engine_retry_enabled',
            '#vectors_enhanced_thought_engine_retry_count',
            '#vectors_enhanced_thought_engine_retry_delay',
            '#vectors_enhanced_thought_engine_prompt',
            '#vectors_enhanced_thought_engine_step1_prompt',
            '#vectors_enhanced_thought_engine_step2_prompt',
            '#vectors_enhanced_thought_engine_step3_prompt',
            '#vectors_enhanced_thought_engine_step1_custom',
            '#vectors_enhanced_thought_engine_step1_url',
            '#vectors_enhanced_thought_engine_step1_apiKey',
            '#vectors_enhanced_thought_engine_step1_model',
            '#vectors_enhanced_thought_engine_step1_max_tokens',
            '#vectors_enhanced_thought_engine_step1_timeout',
            '#vectors_enhanced_thought_engine_step2_custom',
            '#vectors_enhanced_thought_engine_step2_url',
            '#vectors_enhanced_thought_engine_step2_apiKey',
            '#vectors_enhanced_thought_engine_step2_model',
            '#vectors_enhanced_thought_engine_step2_max_tokens',
            '#vectors_enhanced_thought_engine_step2_timeout',
            '#vectors_enhanced_thought_engine_step3_custom',
            '#vectors_enhanced_thought_engine_step3_url',
            '#vectors_enhanced_thought_engine_step3_apiKey',
            '#vectors_enhanced_thought_engine_step3_model',
            '#vectors_enhanced_thought_engine_step3_max_tokens',
            '#vectors_enhanced_thought_engine_step3_timeout',
            '#vectors_enhanced_sense_reason_ratio',
        ];
        
        configFields.forEach(fieldId => {
            const field = $(fieldId);
            if (field.length) {
                field.prop('disabled', !enabled);
                if (enabled) {
                    field.removeClass('disabled').css('opacity', '1');
                } else {
                    field.addClass('disabled').css('opacity', '0.5');
                }
            }
        });

        // Mode-specific visibility (no save — UI init only)
        if (enabled) {
            this._updateModeUI(this.settings.thought_engine_mode || 'cot');
        } else {
            $('#cot_prompt_section, #multi_call_prompts').hide();
        }
        // Proxy section visibility
        $('#proxy_url_section').toggle(this.settings.thought_engine_use_proxy !== false);
        this.updateRetryFieldsVisibility();
        console.log(`QuerySettings: Updated thought engine visibility`);
    }

    /**
     * Update retry input fields visibility based on retry enabled state
     */
    updateRetryFieldsVisibility() {
        const retryEnabled = this.settings.thought_engine_retry_enabled !== false;
        const thoughtEnabled = this.settings.thought_engine_enabled;
        const actuallyEnabled = thoughtEnabled && retryEnabled;
        const retryInputs = [
            '#vectors_enhanced_thought_engine_retry_count',
            '#vectors_enhanced_thought_engine_retry_delay'
        ];
        retryInputs.forEach(fieldId => {
            const field = $(fieldId);
            if (field.length) {
                field.prop('disabled', !actuallyEnabled);
                if (actuallyEnabled) {
                    field.removeClass('disabled').css('opacity', '1');
                } else {
                    field.addClass('disabled').css('opacity', '0.5');
                }
            }
        });
    }

    /**
     * Handle thought engine mode change (CoT ↔ multi_call)
     */
    handleThoughtModeChange(mode) {
        this.settings.thought_engine_mode = mode;
        this.saveSettings();
        this.onSettingsChange('thought_engine_mode', mode);
        this._updateModeUI(mode);
        console.log(`QuerySettings: Thought mode changed to: ${mode}`);
    }

    /**
     * Update mode UI visibility only (no save — safe for init)
     */
    _updateModeUI(mode) {
        if (mode === 'multi_call') {
            $('#cot_prompt_section').hide();
            $('#multi_call_prompts').slideDown();
            for (let i = 1; i <= 3; i++) {
                const checked = this.settings[`thought_engine_step${i}_custom`];
                $(`#step${i}_custom_settings`).toggle(!!checked);
            }
        } else {
            $('#cot_prompt_section').show();
            $('#multi_call_prompts').slideUp();
            for (let i = 1; i <= 3; i++) {
                $(`#step${i}_custom_settings`).hide();
            }
        }
    }

    /**
     * Update alpha ratio display (slider value + quota preview)
     */
    updateAlphaDisplay(val) {
        $('#vectors_enhanced_sense_reason_ratio').val(val);
        $('#sense_reason_ratio_display').text(val.toFixed(2));
        const preLimit = this.settings.rerank_top_n || 20;
        const quota = Math.round(preLimit * val);
        $('#sense_reason_quota_display').text(quota);
    }

    /**
     * 🧪 测试意图分析引擎连接
     */
    async testThoughtConnection() {
        const resultEl = $('#test_thought_result');
        const useProxy = this.settings.thought_engine_use_proxy !== false;
        let proxyUrl = this.settings.thought_engine_proxy_url || `http://${window.location.hostname}:8999/thought_proxy`;
        if (proxyUrl.includes('127.0.0.1') && window.location.hostname !== '127.0.0.1') {
            proxyUrl = proxyUrl.replace(/127\.0\.0\.1/g, window.location.hostname);
        }
        if (proxyUrl.includes('localhost') && window.location.hostname !== 'localhost') {
            proxyUrl = proxyUrl.replace(/localhost/g, window.location.hostname);
        }
        const url = this.settings.thought_engine_url;
        const key = this.settings.thought_engine_apiKey;
        const model = this.settings.thought_engine_model;

        if (!url || !key) {
            resultEl.text('❌ 请先填写 API URL 和 Key').css('color', 'red');
            return;
        }

        resultEl.text(useProxy ? '⏳ 通过代理测试中...' : '⏳ 直连测试中...').css('color', '');

        const testPrompt = '只回复"OK"两个字，不要任何其他内容。';

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            let response;
            if (useProxy) {
                response = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: url,
                        api_key: key,
                        model: model || 'kimi-k2.6',
                        messages: [{ role: 'user', content: testPrompt }],
                        temperature: 0.1,
                        max_tokens: 10,
                        timeout: 15,
                        verify_ssl: false
                    }),
                    signal: controller.signal
                });
            } else {
                response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${key}`
                    },
                    body: JSON.stringify({
                        model: model || 'kimi-k2.6',
                        messages: [{ role: 'user', content: testPrompt }],
                        temperature: 0.1,
                        max_tokens: 10
                    }),
                    signal: controller.signal
                });
            }
            clearTimeout(timeoutId);

            // 后端返回标准 application/json（已改为同步直返）
            const data = await response.json();

            if (!response.ok) {
                const errMsg = (typeof data.error === 'object' && data.error !== null)
                    ? (data.error.message || data.error.code || JSON.stringify(data.error))
                    : (data.error || `HTTP ${response.status}`);
                resultEl.text(`❌ ${errMsg}`).css('color', 'red');
                return;
            }

            const msg = data.choices?.[0]?.message;
            if (msg) {
                // 兼容推理模型的 reasoning 字段
                let content = msg.content ?? msg.reasoning_content ?? msg.reasoning;
                if (content == null && msg.reasoning_details?.length) {
                    content = msg.reasoning_details[0].text || msg.reasoning_details[0];
                }
                if (content != null) {
                    const trimmed = content.trim();
                    if (trimmed) {
                        const modeLabel = useProxy ? '代理' : '直连';
                        resultEl.text(`✅ ${modeLabel}连接成功 | 回复: ${trimmed.slice(0, 80)}`).css('color', 'green');
                    } else {
                        resultEl.text('⚠️ 端点通但返回空内容').css('color', 'orange');
                    }
                } else {
                    resultEl.text(`⚠️ 端点通但格式异常: ${JSON.stringify(msg).slice(0, 300)}`).css('color', 'orange');
                }
            } else {
                resultEl.text(`⚠️ 端点通但缺 message: ${JSON.stringify(data).slice(0, 200)}`).css('color', 'orange');
            }
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                resultEl.text('❌ 请求超时 (15s)').css('color', 'red');
            } else if (err.name === 'TypeError' && err.message && err.message.includes('Failed to fetch')) {
                const hint = useProxy
                    ? '代理无法连接到 ArcFess 后端（请确认 vector_server.py 在 8999 端口运行）'
                    : 'CORS 拦截或端点不可达（非硅基流动端点建议启用代理模式）';
                resultEl.text(`❌ ${hint}`).css('color', 'red');
            } else {
                resultEl.text(`❌ 网络错误: ${err.message.slice(0, 100)}`).css('color', 'red');
            }
        }
    }

    /**
     * Handle query instruction toggle
     */
    handleQueryInstructionToggle(enabled) {
        // 检查是否已经启用了向量化查询
        if (enabled && !this.settings.enabled) {
            // 如果向量化查询未启用，则不允许启用查询增强
            this.toastr.warning('请先启用向量化查询功能');
            $('#vectors_enhanced_query_instruction_enabled').prop('checked', false);
            return;
        }
        
        console.log(`QuerySettings: Query instruction ${enabled ? 'enabled' : 'disabled'}`);
        
        this.settings.query_instruction_enabled = enabled;
        this.saveSettings();
        this.onSettingsChange('query_instruction_enabled', enabled);
        
        // 显示/隐藏查询指令设置
        if (enabled) {
            $('#query_instruction_settings').slideDown();
        } else {
            $('#query_instruction_settings').slideUp();
        }
    }

    /**
     * Handle preset change
     */
    handlePresetChange(presetKey) {
        console.log(`QuerySettings: Preset changed to: ${presetKey}`);
        
        this.settings.query_instruction_preset = presetKey;
        
        // Update template from preset
        if (this.settings.query_instruction_presets && this.settings.query_instruction_presets[presetKey]) {
            this.settings.query_instruction_template = this.settings.query_instruction_presets[presetKey];
            $('#vectors_enhanced_query_instruction_template').val(this.settings.query_instruction_template);
        }
        
        this.saveSettings();
        this.onSettingsChange('query_instruction_preset', presetKey);
        this.onSettingsChange('query_instruction_template', this.settings.query_instruction_template);
    }

    /**
     * Handle rerank deduplication toggle
     */
    handleRerankDeduplicationToggle(enabled) {
        // 检查是否已经启用了rerank
        if (enabled && !this.settings.rerank_enabled) {
            // 如果rerank未启用，则不允许启用去重
            this.toastr.warning('请先启用Rerank功能');
            $('#vectors_enhanced_rerank_deduplication_enabled').prop('checked', false);
            return;
        }
        
        console.log(`QuerySettings: Rerank deduplication ${enabled ? 'enabled' : 'disabled'}`);
        
        this.settings.rerank_deduplication_enabled = enabled;
        this.saveSettings();
        this.onSettingsChange('rerank_deduplication_enabled', enabled);
        
        // 显示/隐藏去重设置
        if (enabled) {
            $('#rerank_deduplication_settings').slideDown();
        } else {
            $('#rerank_deduplication_settings').slideUp();
        }
    }

    /**
     * Load current settings into UI elements
     */
    loadCurrentSettings() {
        console.log('QuerySettings: Loading current settings...');
        
        // 补齐新字段默认值（兼容旧 settings 无此 key 的情况）
        const thoughtDefaults = {
            thought_engine_use_proxy: true,
            thought_engine_proxy_url: `http://${window.location.hostname}:8999/thought_proxy`,
            thought_engine_timeout: 90,
            thought_engine_max_tokens: 4096,
            thought_engine_retry_enabled: true,
            thought_engine_retry_count: 3,
            thought_engine_retry_delay: 1000,
            thought_engine_content_mode: 'strip_think',
            thought_engine_step1_enabled: true,
            thought_engine_step1_custom: false,
            thought_engine_step1_url: '',
            thought_engine_step1_apiKey: '',
            thought_engine_step1_model: '',
            thought_engine_step1_context_size: '',
            thought_engine_step1_max_tokens: '',
            thought_engine_step1_timeout: '',
            thought_engine_step2_enabled: true,
            thought_engine_step2_custom: false,
            thought_engine_step2_url: '',
            thought_engine_step2_apiKey: '',
            thought_engine_step2_model: '',
            thought_engine_step2_context_size: '',
            thought_engine_step2_max_tokens: '',
            thought_engine_step2_timeout: '',
            thought_engine_step3_enabled: true,
            thought_engine_step3_custom: false,
            thought_engine_step3_url: '',
            thought_engine_step3_apiKey: '',
            thought_engine_step3_model: '',
            thought_engine_step3_context_size: '',
            thought_engine_step3_max_tokens: '',
            thought_engine_step3_timeout: '',
        };
        Object.keys(thoughtDefaults).forEach(key => {
            if (this.settings[key] === undefined) {
                this.settings[key] = thoughtDefaults[key];
                console.log(`QuerySettings: Backfilled default for missing key: ${key}`);
            }
        });
        
        this.rerankFields.forEach(field => {
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

        // 🧠 新增：加载思考引擎设定
        this.thoughtFields.forEach(field => {
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
        
        // Load experimental fields
        const experimentalFields = [
            'query_instruction_enabled',
            'query_instruction_template',
            'query_instruction_preset',
            'rerank_deduplication_enabled',
            'rerank_deduplication_instruction'
        ];
        
        experimentalFields.forEach(field => {
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
        
        if (this.settings.query_instruction_enabled) {
            $('#query_instruction_settings').show();
        } else {
            $('#query_instruction_settings').hide();
        }
        
        if (this.settings.rerank_deduplication_enabled) {
            $('#rerank_deduplication_settings').show();
        } else {
            $('#rerank_deduplication_settings').hide();
        }
        
        this.updateRerankVisibility();
        this.updateThoughtVisibility(); // 🧠 新增
        this.updateAlphaDisplay(this.settings.sense_reason_ratio ?? 0.6); // 🧠 新增：刷新后同步 α 显示

        console.log('QuerySettings: Settings loaded');
    }

    /**
     * Validate rerank configuration
     */
    validateRerankConfig() {
        if (!this.settings.rerank_enabled) {
            return true; // No validation needed if disabled
        }

        const errors = [];
        let isValid = true;

        // Required fields for rerank
        if (!this.settings.rerank_url || this.settings.rerank_url.trim() === '') {
            errors.push('Rerank API URL is required');
            isValid = false;
        }

        if (!this.settings.rerank_apiKey || this.settings.rerank_apiKey.trim() === '') {
            errors.push('Rerank API Key is required');
            isValid = false;
        }

        if (!this.settings.rerank_model || this.settings.rerank_model.trim() === '') {
            errors.push('Rerank model is required');
            isValid = false;
        }

        // Validate numeric parameters
        if (this.settings.rerank_top_n <= 0 || this.settings.rerank_top_n > 100) {
            errors.push('Rerank Top N must be between 1 and 100');
            isValid = false;
        }

        if (this.settings.rerank_hybrid_alpha < 0 || this.settings.rerank_hybrid_alpha > 1) {
            errors.push('Rerank hybrid alpha must be between 0 and 1');
            isValid = false;
        }

        // Validate URL format
        if (this.settings.rerank_url) {
            try {
                new URL(this.settings.rerank_url);
            } catch (e) {
                errors.push('Rerank API URL must be a valid URL');
                isValid = false;
            }
        }

        if (errors.length > 0) {
            console.warn('QuerySettings: Rerank validation errors:', errors);
            this.showValidationErrors(errors);
        } else {
            this.clearValidationErrors();
        }

        return isValid;
    }

    /**
     * Show validation errors in the UI
     */
    showValidationErrors(errors) {
        // Create or update error message display
        let errorContainer = $('#vectors_enhanced_rerank_errors');
        
        if (errorContainer.length === 0) {
            errorContainer = $('<div>', {
                id: 'vectors_enhanced_rerank_errors',
                class: 'text-danger m-t-0-5',
                style: 'font-size: 0.9em;'
            });
            
            $('#vectors_enhanced_rerank_enabled').closest('details').append(errorContainer);
        }
        
        const errorHtml = errors.map(error => `<div>• ${error}</div>`).join('');
        errorContainer.html(`<strong>配置错误:</strong>${errorHtml}`).show();
    }

    /**
     * Clear validation error display
     */
    clearValidationErrors() {
        $('#vectors_enhanced_rerank_errors').hide();
    }

    /**
     * Save settings using ConfigManager
     */
    saveSettings() {
        if (this.configManager) {
            console.debug('QuerySettings: Settings saved via ConfigManager');
        } else {
            console.warn('QuerySettings: No ConfigManager available for saving');
        }
    }

    /**
     * Refresh the component - reload settings and update UI
     */
    async refresh() {
        console.log('QuerySettings: Refreshing...');
        this.loadCurrentSettings();
        this.updateRerankVisibility();
        
        if (this.settings.rerank_enabled) {
            this.validateRerankConfig();
        }
        
        console.log('QuerySettings: Refresh completed');
    }

    /**
     * Get rerank configuration status
     */
    getRerankStatus() {
        return {
            enabled: this.settings.rerank_enabled,
            configured: this.validateRerankConfig(),
            settings: this.getRerankSettings()
        };
    }

    /**
     * Get all rerank settings
     */
    getRerankSettings() {
        return {
            rerank_enabled: this.settings.rerank_enabled,
            rerank_success_notify: this.settings.rerank_success_notify,
            rerank_url: this.settings.rerank_url,
            rerank_apiKey: this.settings.rerank_apiKey ? '***' : '', // Don't expose the actual key
            rerank_model: this.settings.rerank_model,
            rerank_top_n: this.settings.rerank_top_n,
            rerank_hybrid_alpha: this.settings.rerank_hybrid_alpha
        };
    }

    /**
     * Test rerank connection (for future implementation)
     */
    async testRerankConnection() {
        if (!this.validateRerankConfig()) {
            throw new Error('Rerank configuration is invalid');
        }

        // TODO: Implement actual connection test
        console.log('QuerySettings: Testing rerank connection...');
        
        // This would make an actual API call to test the connection
        // For now, just validate the configuration
        return {
            success: true,
            message: 'Configuration appears valid (connection test not implemented)'
        };
    }

    /**
     * Reset rerank settings to defaults
     */
    resetRerankSettings() {
        console.log('QuerySettings: Resetting rerank settings...');
        
        const defaults = {
            rerank_enabled: false,
            rerank_success_notify: true,
            rerank_url: '',
            rerank_apiKey: '',
            rerank_model: '',
            rerank_top_n: 10,
            rerank_hybrid_alpha: 0.7
        };

        Object.assign(this.settings, defaults);
        this.saveSettings();
        this.loadCurrentSettings();
        this.updateRerankVisibility();
        
        console.log('QuerySettings: Rerank settings reset to defaults');
    }

    /**
     * Reset rerank deduplication instruction to default
     */
    resetRerankDeduplicationInstruction() {
        const defaultInstruction = 'Execute the following operations:\n1. Sort documents by relevance in descending order\n2. Consider documents as duplicates if they meet ANY of these conditions:\n   - Core content overlap exceeds 60% (reduced from 80% for better precision)\n   - Contains identical continuous passages of 5+ words\n   - Shares the same examples, data points, or evidence\n3. When evaluating duplication, consider metadata differences:\n   - Different originalIndex values indicate temporal separation\n   - Different chunk numbers (chunk=X/Y) from the same entry should be preserved\n   - Different floor numbers represent different chronological positions\n   - Different world info entries or chapter markers indicate distinct contexts\n4. For identified duplicates, keep only the most relevant one, demote others to bottom 30% positions (reduced from 50% for gentler deduplication)';
        
        this.settings.rerank_deduplication_instruction = defaultInstruction;
        $('#vectors_enhanced_rerank_deduplication_instruction').val(defaultInstruction);
        
        this.saveSettings();
        this.onSettingsChange('rerank_deduplication_instruction', defaultInstruction);
        
        // Show feedback
        if (this.toastr) {
            this.toastr.success('已重置为默认去重指令');
        }
    }

    /**
     * Preview injected content with experimental features
     */
    async previewInjectedContent() {
        try {
            // 直接获取最后注入的内容
            const lastInjected = window.vectors_getLastInjectedContent ? window.vectors_getLastInjectedContent() : null;
            
            if (!lastInjected || !lastInjected.content) {
                this.toastr.info('还没有注入过任何内容，请先发送一条消息');
                return;
            }

            const capturedContent = lastInjected.content;
            const stats = lastInjected.stats || {};
            const details = lastInjected.details || null;

            // 分析内容
            const queryInstructionEnabled = stats.queryInstructionEnabled || false;
            const rerankEnabled = stats.rerankEnabled || false;
            const deduplicationEnabled = stats.deduplicationEnabled || false;
            
            // 构建显示内容
            let displayHtml = '<div style="max-height: 600px; overflow-y: auto; text-align: left;">';
            
            // 顶部信息栏 - 横向排列
            displayHtml += '<div style="margin-bottom: 15px; padding: 10px; background-color: var(--SmartThemeBlurTintColor); border-radius: 5px; display: flex; flex-wrap: wrap; gap: 20px; align-items: center;">';
            
            // 统计信息
            displayHtml += '<div style="display: flex; gap: 15px; flex-wrap: wrap;">';
            displayHtml += `<span><strong>${stats.totalChars || capturedContent.length}</strong> 字符</span>`;
            if (stats.originalQueryCount && stats.finalCount) {
                displayHtml += `<span>查询 <strong>${stats.originalQueryCount}</strong> → 注入 <strong>${stats.finalCount}</strong> 块</span>`;
            }
            if (stats.chatCount > 0) displayHtml += `<span>聊天 <strong>${stats.chatCount}</strong></span>`;
            if (stats.fileCount > 0) displayHtml += `<span>文件 <strong>${stats.fileCount}</strong></span>`;
            if (stats.worldInfoCount > 0) displayHtml += `<span>世界信息 <strong>${stats.worldInfoCount}</strong></span>`;
            displayHtml += '</div>';
            
            // 功能状态 - 只显示查询增强和rerank增强的开启状态
            displayHtml += '<div style="margin-left: auto; display: flex; gap: 10px; align-items: center; font-size: 0.9em;">';
            
            // 查询增强状态
            displayHtml += '<span style="padding: 2px 8px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 3px;">查询增强: ';
            displayHtml += queryInstructionEnabled ? '<span style="color: var(--SmartThemeQuoteColor);">开启</span>' : '<span style="opacity: 0.6;">关闭</span>';
            displayHtml += '</span>';
            
            // Rerank增强状态
            displayHtml += '<span style="padding: 2px 8px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 3px;">Rerank增强: ';
            displayHtml += rerankEnabled ? '<span style="color: var(--SmartThemeQuoteColor);">开启</span>' : '<span style="opacity: 0.6;">关闭</span>';
            displayHtml += '</span>';
            
            displayHtml += '</div>';
            
            displayHtml += '</div>';
            
            // 如果有详细信息，显示重排前后对比
            if (details && details.rerankApplied && details.resultsBeforeRerank && details.resultsAfterRerank) {
                displayHtml += '<div style="margin-bottom: 15px;">';
                displayHtml += '<div style="margin-bottom: 10px; font-weight: bold;">查询结果处理流程：</div>';
                
                // 使用表格显示对比 - 三列并排
                displayHtml += '<div style="display: flex; gap: 15px; margin-bottom: 15px; align-items: flex-start;">';
                
                // 重排前
                displayHtml += '<div style="flex: 1; min-width: 280px;">';
                displayHtml += '<div style="margin-bottom: 5px; font-weight: bold; font-size: 0.9em;">重排前（原始分数）</div>';
                displayHtml += '<div style="padding: 10px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 5px; height: 400px; overflow-y: auto;">';
                details.resultsBeforeRerank.forEach((result, index) => {
                    displayHtml += `<div style="margin-bottom: 8px; padding: 5px; border-bottom: 1px solid var(--SmartThemeBorderColor);">`;
                    displayHtml += `<div style="margin-bottom: 3px;">`;
                    displayHtml += `<span style="font-weight: bold;">#${index + 1}</span>`;
                    displayHtml += `</div>`;
                    displayHtml += `<div style="font-size: 0.85em; opacity: 0.9; white-space: pre-wrap;">${this._escapeHtml(result.text)}</div>`;
                    displayHtml += `</div>`;
                });
                displayHtml += '</div>';
                displayHtml += '</div>';
                
                // 重排后
                displayHtml += '<div style="flex: 1; min-width: 280px;">';
                displayHtml += '<div style="margin-bottom: 5px; font-weight: bold; font-size: 0.9em;">重排后（Rerank分数）</div>';
                displayHtml += '<div style="padding: 10px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 5px; height: 400px; overflow-y: auto;">';
                details.resultsAfterRerank.forEach((result, index) => {
                    displayHtml += `<div style="margin-bottom: 8px; padding: 5px; border-bottom: 1px solid var(--SmartThemeBorderColor);">`;
                    displayHtml += `<div style="margin-bottom: 3px;">`;
                    displayHtml += `<span style="font-weight: bold;">#${index + 1}</span>`;
                    displayHtml += `</div>`;
                    displayHtml += `<div style="font-size: 0.85em; opacity: 0.9; white-space: pre-wrap;">${this._escapeHtml(result.text)}</div>`;
                    displayHtml += `</div>`;
                });
                displayHtml += '</div>';
                displayHtml += '</div>';
                
                // 最终注入顺序（按originalIndex排序后）
                if (details.finalSortedResults) {
                    displayHtml += '<div style="flex: 1; min-width: 280px;">';
                    displayHtml += '<div style="margin-bottom: 5px; font-weight: bold; font-size: 0.9em;">最终注入顺序（按originalIndex排序）</div>';
                    displayHtml += '<div style="padding: 10px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 5px; height: 400px; overflow-y: auto;">';
                    details.finalSortedResults.forEach((result, index) => {
                        // 解码metadata以获取类型和originalIndex
                        const decoded = this._decodeMetadataFromText(result.text);
                        const type = decoded.metadata.type || result.metadata?.type || 'unknown';
                        const originalIndex = decoded.metadata.originalIndex ?? result.metadata?.originalIndex ?? '?';
                        
                        displayHtml += `<div style="margin-bottom: 8px; padding: 5px; border-bottom: 1px solid var(--SmartThemeBorderColor);">`;
                        displayHtml += `<div style="margin-bottom: 3px;">`;
                        displayHtml += `<span style="font-weight: bold;">#${index + 1}</span>`;
                        displayHtml += ` <span style="font-size: 0.8em; color: var(--SmartThemeQuoteColor);">[${type}, idx:${originalIndex}]</span>`;
                        displayHtml += `</div>`;
                        displayHtml += `<div style="font-size: 0.85em; opacity: 0.9; white-space: pre-wrap;">${this._escapeHtml(result.text)}</div>`;
                        displayHtml += `</div>`;
                    });
                    displayHtml += '</div>';
                    displayHtml += '</div>';
                }
                
                displayHtml += '</div>';
                displayHtml += '</div>';
            } else if (!details || !details.rerankApplied) {
                // 如果没有重排，但有最终排序结果
                if (details && details.finalSortedResults) {
                    displayHtml += '<div style="margin-bottom: 15px;">';
                    displayHtml += '<div style="margin-bottom: 10px; font-weight: bold;">查询结果（按originalIndex排序）：</div>';
                    displayHtml += '<div style="padding: 10px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 5px; max-height: 400px; overflow-y: auto;">';
                    details.finalSortedResults.forEach((result, index) => {
                        // 解码metadata以获取类型和originalIndex
                        const decoded = this._decodeMetadataFromText(result.text);
                        const type = decoded.metadata.type || result.metadata?.type || 'unknown';
                        const originalIndex = decoded.metadata.originalIndex ?? result.metadata?.originalIndex ?? '?';
                        
                        displayHtml += `<div style="margin-bottom: 8px; padding: 5px; border-bottom: 1px solid var(--SmartThemeBorderColor);">`;
                        displayHtml += `<div style="margin-bottom: 3px;">`;
                        displayHtml += `<span style="font-weight: bold;">#${index + 1}</span>`;
                        displayHtml += ` <span style="font-size: 0.8em; color: var(--SmartThemeQuoteColor);">[${type}, idx:${originalIndex}]</span>`;
                        displayHtml += `</div>`;
                        displayHtml += `<div style="font-size: 0.85em; opacity: 0.9; white-space: pre-wrap;">${this._escapeHtml(result.text)}</div>`;
                        displayHtml += `</div>`;
                    });
                    displayHtml += '</div>';
                    displayHtml += '</div>';
                } else {
                    // 兜底显示原始结果
                    displayHtml += '<div style="margin-bottom: 10px;">';
                    displayHtml += '<div style="margin-bottom: 5px; font-weight: bold;">查询结果：</div>';
                    displayHtml += '<pre style="white-space: pre-wrap; word-wrap: break-word; border: 1px solid var(--SmartThemeBorderColor); padding: 10px; border-radius: 5px; max-height: 400px; overflow-y: auto; margin: 0; text-align: left;">';
                    displayHtml += this._escapeHtml(capturedContent);
                    displayHtml += '</pre>';
                    displayHtml += '</div>';
                }
            }
            
            displayHtml += '</div>';

            // 显示弹窗
            if (this.callGenericPopup && this.POPUP_TYPE) {
                await this.callGenericPopup(displayHtml, this.POPUP_TYPE.TEXT, '', {
                    wide: true,
                    large: true,
                    okButton: '关闭',
                    allowHorizontalScrolling: true,
                    allowVerticalScrolling: true
                });
            } else {
                // 降级到 alert
                alert('注入内容预览:\n\n' + capturedContent);
            }
            
        } catch (error) {
            console.error('预览注入内容失败:', error);
            this.toastr.error('预览失败: ' + error.message);
        }
    }

    /**
     * Analyze injected content
     * @private
     */
    _analyzeInjectedContent(content) {
        const stats = {
            totalChars: content.length,
            chatCount: 0,
            fileCount: 0,
            worldInfoCount: 0
        };

        // Count different content types based on tags
        const chatMatches = content.match(/<past_chat>[\s\S]*?<\/past_chat>/g);
        const fileMatches = content.match(/<databank>[\s\S]*?<\/databank>/g);
        const worldInfoMatches = content.match(/<world_part>[\s\S]*?<\/world_part>/g);

        if (chatMatches) {
            // Count individual chat items within the tag
            chatMatches.forEach(match => {
                // Simple heuristic: count line breaks as rough message count
                const lines = match.split('\n').filter(line => line.trim().length > 0);
                stats.chatCount += Math.max(1, Math.floor(lines.length / 2)); // Rough estimate
            });
        }

        if (fileMatches) {
            stats.fileCount = fileMatches.length;
        }

        if (worldInfoMatches) {
            // Count individual world info items
            worldInfoMatches.forEach(match => {
                const lines = match.split('\n').filter(line => line.trim().length > 0);
                stats.worldInfoCount += Math.max(1, Math.floor(lines.length / 2)); // Rough estimate
            });
        }

        return stats;
    }

    /**
     * Escape HTML for safe display
     * @private
     */
    _escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    /**
     * Decode metadata from encoded text
     * @private
     * @param {string} encodedText - Text with metadata prefix
     * @returns {{text: string, metadata: {type?: string, originalIndex?: number}}}
     */
    _decodeMetadataFromText(encodedText) {
        if (!encodedText) {
            return { text: encodedText, metadata: {} };
        }
        
        const metaMatch = encodedText.match(/^\[META:([^\]]+)\]/);
        if (!metaMatch) {
            return { text: encodedText, metadata: {} };
        }
        
        const metaString = metaMatch[1];
        const text = encodedText.substring(metaMatch[0].length);
        const metadata = {};
        
        // Parse metadata key-value pairs
        const pairs = metaString.split(',');
        for (const pair of pairs) {
            const [key, value] = pair.split('=');
            if (key && value) {
                if (key === 'originalIndex' || key === 'floor' || key === 'chapter') {
                    metadata[key] = parseInt(value, 10);
                } else {
                    metadata[key] = value;
                }
            }
        }
        
        return { text, metadata };
    }

    /**
     * Cleanup - remove event listeners
     */
    destroy() {
        console.log('QuerySettings: Destroying...');
        
        // Remove event listeners
        this.rerankFields.forEach(field => {
            $(`#vectors_enhanced_${field}`).off('input change');
        });
        this.thoughtFields.forEach(field => {
            $(`#vectors_enhanced_${field}`).off('input change');
        });
        
        // Clear validation errors
        this.clearValidationErrors();
        
        this.initialized = false;
        console.log('QuerySettings: Destroyed');
    }
}