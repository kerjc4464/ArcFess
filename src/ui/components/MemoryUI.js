/**
 * Memory UI Component
 * Handles the memory management interface (UI only)
 */

// Import updateWorldInfoList functions
import { updateWorldInfoList as updateSillyTavernWorldInfoList, loadWorldInfo, METADATA_KEY } from '../../../../../../world-info.js';
import { updateWorldInfoList as updatePluginWorldInfoList } from './WorldInfoList.js';
import { getContext, extension_settings } from '../../../../../../extensions.js';
import { chat_metadata, saveChatDebounced } from '../../../../../../../script.js';


// Using preset format - prompts removed

// Detail level configurations
const detailLevels = {
    concise: '每个分解事件不少于3句话，100字',
    normal: '每个分解事件不少于5句话，150字',
    detailed: '每个分解事件不少于7句话，250字'
};

// Default memory settings
const defaultMemorySettings = {
    source: 'google_openai', // 默认使用Google
    use_backend_proxy: true, // 默认走后端代理解决 CORS
    proxy_url: '', // 代理地址留空自动使用当前主机名:8999
    detailLevel: 'normal', // 默认详细程度
    maxTokens: 8192, // 默认最大token数
    summaryFormat: `总结应当遵循以下原则：
- 按时间顺序或逻辑顺序组织信息
- 保留关键事件和重要细节，省略冗余描述
- 直接陈述事实，避免主观评价
- 使用简洁清晰的语言，避免过度修饰
- 突出事件发展脉络和关键转折点
- 不使用任何xml标签包裹，使用纯文字进行叙述
- {{length}}
- 不回避任何敏感内容，保证记录完全还原前文

总结必须使用以下格式：
【关键事件标题】
关键事件概述。
发生地点:
关键角色:
• {分解事件1（小标题形式）}: {简要描述}
• {分解事件2（小标题形式）}: {简要描述}
• {分解事件3（小标题形式）}: {简要描述}
...`, // 默认总结格式
    autoCreateWorldBook: false, // 默认不自动生成世界书
    google_openai: {
        model: 'gemini-1.5-flash',  // 设置默认模型
        apiKey: ''  // 添加API密钥字段
    },
    openai_compatible: {
        url: '',
        model: '',
        apiKey: '',  // 添加API密钥字段
        proxyMode: false  // 反代专用模式，默认关闭
    },
    // prompts removed - using preset format
    autoSummarize: {
        enabled: false,
        interval: 20,  // 每20层自动总结
        messageCount: 6,  // 保留最近6层消息
        lastSummarizedFloor: 0  // 上次总结的楼层
    },
    disableWorldInfoAfterVectorize: false  // 向量化后禁用世界书条目
};

export class MemoryUI {
    constructor(dependencies = {}) {
        this.memoryService = dependencies.memoryService;
        this.toastr = dependencies.toastr;
        this.eventBus = dependencies.eventBus;
        this.getContext = dependencies.getContext;
        this.oai_settings = dependencies.oai_settings;
        this.settings = dependencies.settings; // 添加settings引用
        this.saveSettingsDebounced = dependencies.saveSettingsDebounced; // 添加保存函数引用
        this.generateRaw = dependencies.generateRaw; // 添加generateRaw API
        this.eventSource = dependencies.eventSource; // 添加eventSource
        this.event_types = dependencies.event_types; // 添加event_types
        this.saveChatConditional = dependencies.saveChatConditional; // 添加saveChatConditional
        this.initialized = false;

        // UI state
        this.isProcessing = false;
        this.isAutoSummarizing = false;  // 防止自动总结并发执行
        this.isCreatingWorldBook = false;  // 防止重复创建世界书
        this.lastResponseHash = null;  // 记录最后处理的响应哈希，防止重复处理

        // 【性能核心：UI防抖更新引擎】
        // 拦截高频瞬间爆发的事件，合并为单次极轻量刷新
        this._uiUpdateTimer = null;
        this._offsetSaveTimer = null;
        this._activeTimers = new Set();
        this._eventCallbacks = new Map(); // 存储 SillyTavern 全局事件回调，用于精确解绑
        this.scheduleUIUpdate = () => {
            if (this._uiUpdateTimer) clearTimeout(this._uiUpdateTimer);
            this._uiUpdateTimer = setTimeout(() => {
                this.updateChatFloorCount();
                this.updateAutoSummarizeStatus();
            }, 150); // 150ms 的绝佳黄金延迟
            this._activeTimers.add(this._uiUpdateTimer);
        };
    }

    async init() {
        if (this.initialized) return;
        this.initialized = true;

        // 先加载配置，再绑定事件
        await this.loadApiConfig();
        this.bindEventListeners();
        this.subscribeToEvents();
        
        // 初始化聊天楼层监控
        this.initializeChatFloorMonitor();
        
        // 初始化幽灵注入
        this.updateGhostInjection();
    }

    /**
     * 保存数据到当前聊天的元数据
     * @param {string} key - 数据键名
     * @param {*} value - 要保存的值
     */
    saveToChatMetadata(key, value) {
        // 直接使用导入的 chat_metadata
        if (!chat_metadata) {
            console.warn('[MemoryUI] chat_metadata not available');
            return;
        }
        
        // 初始化扩展元数据结构
        if (!chat_metadata.extensions) {
            chat_metadata.extensions = {};
        }
        if (!chat_metadata.extensions.vectors_enhanced) {
            chat_metadata.extensions.vectors_enhanced = {};
        }
        
        // 保存数据
        chat_metadata.extensions.vectors_enhanced[key] = value;
        
        console.log('[MemoryUI] Saved to chat metadata:', key, value);
        
        // 触发保存（防抖）- 使用导入的函数
        saveChatDebounced();
    }

    /**
     * 从当前聊天的元数据获取数据
     * @param {string} key - 数据键名
     * @returns {*} 存储的值或undefined
     */
    getFromChatMetadata(key) {
        // 直接使用导入的 chat_metadata
        if (!chat_metadata) {
            console.warn('[MemoryUI] chat_metadata not available for key:', key);
            return undefined;
        }
        
        const value = chat_metadata?.extensions?.vectors_enhanced?.[key];
        
        // 只在没有找到值时输出调试信息
        if (value === undefined && key === 'lastSummarizedFloor') {
            console.log('[MemoryUI] chat_metadata structure:', {
                hasMetadata: !!chat_metadata,
                hasExtensions: !!chat_metadata?.extensions,
                hasVectorsEnhanced: !!chat_metadata?.extensions?.vectors_enhanced,
                allExtensions: Object.keys(chat_metadata?.extensions || {}),
                vectorsEnhancedData: chat_metadata?.extensions?.vectors_enhanced
            });
        }
        
        return value;
    }

    bindEventListeners() {
        // Summarize button click handler
        $('#memory_summarize_btn').off('click').on('click', () => this.handleSummarizeClick());

        // Memory chat send button (Enter 发送, Shift+Enter 换行)
        $('#memory_send_btn').off('click').on('click', () => this.handleSendClick());
        $('#memory_input').off('keydown').on('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendClick();
            }
        });

        // API source change
        $('#memory_api_source').off('change').on('change', (e) => {
            this.handleApiSourceChange(e.target.value);
        });


        // Prompt buttons removed - using preset format

        // Save config on input changes (包括API密钥)
        $('#memory_openai_url, #memory_openai_api_key, #memory_openai_model, #memory_google_openai_api_key, #memory_google_openai_model, #memory_summary_format, #memory_max_tokens, #memory_proxy_url')
            .off('change input').on('change input', () => this.saveApiConfig());

        // 后端代理开关
        $('#memory_use_backend_proxy').off('change').on('change', (e) => {
            const enabled = e.target.checked;
            $('#memory_proxy_url_section').toggle(enabled);
            this.saveApiConfig();
        });
        $('#memory_proxy_url').off('change input').on('change input', () => this.saveApiConfig());

        // 新UI元素输入事件
        $('#memory_injection_depth').off('input').on('input', (e) => {
            const value = parseInt(e.target.value) || 2;
            extension_settings.vectors_enhanced.memory_injection_depth = value;
            this.saveApiConfig();
            this.updateGhostInjection();  // 更新幽灵注入
        });

        $('#memory_inject_count').off('input').on('input', (e) => {
            const value = parseInt(e.target.value) || 10;
            extension_settings.vectors_enhanced.memory_inject_count = value;
            this.saveApiConfig();
            this.updateGhostInjection();
        });

        $('#memory_retain_count').off('input').on('input', (e) => {
            const value = parseInt(e.target.value) || 0;
            extension_settings.vectors_enhanced.memory_retain_count = value;
            this.saveApiConfig();
        });

        $('#memory_chunk_separator').off('input').on('input', (e) => {
            const value = e.target.value || "===ARC_SPLIT===";
            extension_settings.vectors_enhanced.memory_chunk_separator = value;
            this.saveApiConfig();
        });

        // Reset button for summary format
        $('#reset_memory_summary_format').off('click').on('click', () => this.resetSummaryFormat());
        
        // 新按钮事件预留
        $('#memory_download_chunked').off('click').on('click', async () => {
            const { extension_settings, getContext } = await import('../../../../../../extensions.js');
            const context = getContext();
            const chatId = context.chatId;
            const chats = extension_settings.vectors_enhanced.chats?.[chatId] || [];
            const texts = chats.map(item => item.text);
            const separator = $('#memory_chunk_separator').val() || "===ARC_SPLIT===";
            const content = texts.join(separator);
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${chatId}_chunked.txt`;
            a.click();
            URL.revokeObjectURL(url);
        });

        $('#memory_download_full').off('click').on('click', async () => {
            const { extension_settings, getContext } = await import('../../../../../../extensions.js');
            const context = getContext();
            const chatId = context.chatId;
            const chats = extension_settings.vectors_enhanced.chats?.[chatId] || [];
            const texts = chats.map(item => item.text);
            const content = texts.join('\n\n');
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${chatId}_full.txt`;
            a.click();
            URL.revokeObjectURL(url);
        });

        $('#memory_clear_buffer').off('click').on('click', async () => {
            const { extension_settings, getContext } = await import('../../../../../../extensions.js');
            const context = getContext();
            const chatId = context.chatId;
            if (extension_settings.vectors_enhanced.chats) {
                extension_settings.vectors_enhanced.chats[chatId] = [];
            }
            this.saveSettingsDebounced?.() || window.saveSettingsDebounced?.();
            this.toastr?.success('短时缓冲池已清空');
            this.updateGhostInjection();  // 更新幽灵注入
        });
        
        // Auto-summarize settings
        $('#memory_auto_summarize_enabled').off('change').on('change', (e) => {
            const enabled = e.target.checked;
            $('#memory_auto_summarize_settings').toggle(enabled);
            $('#memory_auto_summarize_status').toggle(enabled);
            if (enabled) {
                let lastSummarized = this.getFromChatMetadata('lastSummarizedFloor');
                if (lastSummarized === undefined || lastSummarized === null || lastSummarized === 0) {
                    const context = this.getContext ? this.getContext() : getContext();
                    const currentFloor = context?.chat?.length - 1 || 0;
                    this.saveToChatMetadata('lastSummarizedFloor', currentFloor + 1);
                }
                this.updateAutoSummarizeStatus();
            }
            this.saveApiConfig();
        });
        
        $('#memory_auto_summarize_interval')
            .off('change input').on('change input', (e) => {
                this.updateAutoSummarizeStatus();
                this.saveApiConfig();
            });
        
        // UI视觉偏移量实时联动 (极致性能优化版)
        this._offsetSaveTimer = null;
        $('#memory_floor_offset').off('change input').on('input', () => {
            // 1. 纯视图层：极其轻量，0延迟瞬间跟随按键刷新
            this.updateChatFloorCount();
            this.updateAutoSummarizeStatus();
            
            // 2. 数据持久层：防抖拦截，等用户完全停手 500 毫秒后才执行昂贵的深拷贝与落盘
            if (this._offsetSaveTimer) clearTimeout(this._offsetSaveTimer);
            this._offsetSaveTimer = setTimeout(() => {
                this.saveApiConfig();
            }, 500);
            this._activeTimers.add(this._offsetSaveTimer);
        });
        
        // Reset auto-summarize button handler
        $('#memory_reset_auto_summarize').off('click').on('click', () => {
            this.resetAutoSummarize();
        });
        
        // 一键提纯按钮绑定
        $('#memory_force_auto_summarize').off('click').on('click', () => {
            if (this.isAutoSummarizing) return this.toastr?.warning('提纯正在进行中，请稍候...');
            const context = this.getContext ? this.getContext() : getContext();
            if (!context || !context.chat || context.chat.length === 0) return this.toastr?.warning('当前无聊天记录！');
            
            const currentFloor = context.chat.length - 1;
            const lastSummarized = this.getFromChatMetadata('lastSummarizedFloor') ?? 0;
            const chats = extension_settings.vectors_enhanced.chats?.[context.chatId] || [];
            if (currentFloor < lastSummarized && chats.length > 0) return this.toastr?.info('无新对话。');

            this.isAutoSummarizing = true;
            this.performAutoSummarize(currentFloor).catch(e => {
                console.error('[MemoryUI] 强制提纯报错:', e);
                this.isAutoSummarizing = false;
            });
        });

        // Memory save edit button handler
        $('#memory_save_edit').off('click').on('click', () => {
            const context = this.getContext ? this.getContext() : getContext();
            const chats = extension_settings.vectors_enhanced.chats?.[context.chatId];
            
            if (!chats || chats.length === 0) {
                this.toastr?.warning('缓冲池为空，没有可覆写的记忆');
                return;
            }
            
            const editedText = $('#memory_output').val();
            if (!editedText.trim()) {
                this.toastr?.warning('内容不能为空');
                return;
            }
            
            chats[chats.length - 1].text = editedText;
            
            this.saveSettingsDebounced?.() || window.saveSettingsDebounced?.();
            this.updateGhostInjection();
            this.toastr?.success('最新记忆快照已成功覆写');
        });

        // 全量潜意识池覆写 (纯净数据版)
        $('#memory_save_all_edits').off('click').on('click', () => {
            const context = this.getContext ? this.getContext() : getContext();
            const chatId = context.chatId;
            const rawText = $('#memory_ghost_preview').val();
            
            if (!rawText.trim()) {
                if (extension_settings.vectors_enhanced.chats) {
                    extension_settings.vectors_enhanced.chats[chatId] = [];
                }
                this.saveSettingsDebounced?.() || window.saveSettingsDebounced?.();
                this.updateGhostInjection();
                return this.toastr?.success('潜意识池已清空！');
            }
            
            // 直接以双回车切分，不用再费心清理头部标签了
            const chunks = rawText.split(/[\r\n]{2,}/).map(t => t.trim()).filter(t => t.length > 0);
            if (chunks.length === 0) return this.toastr?.warning('没有提取到有效的记忆！');

            if (!extension_settings.vectors_enhanced.chats) extension_settings.vectors_enhanced.chats = {};
            extension_settings.vectors_enhanced.chats[chatId] = chunks.map(text => ({ floor: 0, text: text }));
            
            this.saveSettingsDebounced?.() || window.saveSettingsDebounced?.();
            this.updateGhostInjection();
            this.toastr?.success('潜意识池已强制覆写并落盘！');
        });

        // 不在这里初始化API源显示，因为loadApiConfig已经处理了
    }

    subscribeToEvents() {
        if (!this.eventBus) return;

        // Subscribe to memory service events
        this.eventBus.on('memory:message-start', () => {
            this.showLoading();
        });

        this.eventBus.on('memory:message-complete', async (data) => {
            const response = data.response || '';
            
            // 生成响应哈希以检测重复
            const responseHash = this.generateHash(response + Date.now().toString().slice(-5));
            
            // 检查是否是重复的响应
            if (this.lastResponseHash === responseHash) {
                console.log('[MemoryUI] 忽略重复的响应');
                return;
            }
            this.lastResponseHash = responseHash;
            
            // 检查响应是否有效
            if (!response || response.trim().length < 2) {
                console.error('[MemoryUI] AI返回空内容');
                // 确保错误提示能显示
                setTimeout(() => {
                    if (this.toastr) {
                        this.toastr.error('AI返回了空内容，请检查API设置和网络连接', '总结失败', {
                            timeOut: 5000,
                            extendedTimeOut: 2000,
                            preventDuplicates: true
                        });
                    } else {
                        alert('AI返回了空内容，请检查API设置和网络连接');
                    }
                }, 100);
                this.displayResponse('');
                this.hideLoading();
                return;
            }
            
            // 检查是否包含错误信息（短响应中包含错误关键词）
            const errorKeywords = ['error', 'Error', 'ERROR', '错误', '失败', 'failed', 'Failed'];
            const lowerResponse = response.toLowerCase();
            const isError = errorKeywords.some(keyword => 
                lowerResponse.includes(keyword.toLowerCase()) && response.length < 100
            );
            
            if (isError) {
                console.warn('[MemoryUI] AI可能返回了错误:', response);
                this.toastr?.warning('AI响应可能包含错误：' + response.substring(0, 50) + '...');
            }
            
            this.displayResponse(response);
            this.hideLoading();
            
            // 只有有效响应才继续后续逻辑
            if (response && response.trim().length >= 2) {
                // 自动创建世界书已移除
                console.log('[MemoryUI] 自动创建世界书功能已移除，跳过此逻辑');
            }
        });

        this.eventBus.on('memory:message-error', (data) => {
            this.displayError(data.error);
            this.hideLoading();
        });

        this.eventBus.on('memory:history-updated', () => {
            // Future: Update history display
        });
    }

    /**
     * Handle summarize button click
     */
    async handleSummarizeClick() {
        if (this.isProcessing) return;

        try {
            // 获取 extension_settings 和 context
            const { extension_settings, getContext } = await import('../../../../../../extensions.js');
            const settings = extension_settings.vectors_enhanced;
            const context = getContext();
            
            // 检查主开关是否启用
            if (!settings.master_enabled) {
                this.toastr?.warning('聊天记录超级管理器已禁用，请先启用主开关');
                return;
            }
            
            // 检查聊天内容是否启用
            if (!settings.selected_content.chat.enabled) {
                this.toastr?.warning('请先在内容选择中启用聊天记录');
                return;
            }
            
            // 检查是否有聊天记录
            if (!context.chat || context.chat.length === 0) {
                this.toastr?.warning('当前没有聊天记录');
                return;
            }
            
            // 导入必要的函数和工具
            const { getMessages } = await import('../../utils/chatUtils.js');
            const { extractTagContent } = await import('../../utils/tagExtractor.js');
            
            // 获取聊天设置
            const chatSettings = settings.selected_content.chat;
            const rules = chatSettings.tag_rules || settings.tag_extraction_rules || [];
            
            // 使用 getMessages 函数获取过滤后的消息
            const messageOptions = {
                includeHidden: chatSettings.include_hidden || false,
                types: chatSettings.types || { user: true, assistant: true },
                range: chatSettings.range,
                newRanges: chatSettings.newRanges
            };
            
            const messages = getMessages(context.chat, messageOptions);
            
            if (messages.length === 0) {
                this.toastr?.warning('没有找到符合条件的聊天内容');
                return;
            }
            
            // 获取楼层编号范围
            const indices = messages.map(msg => msg.index).sort((a, b) => a - b);
            const startIndex = indices[0];
            const endIndex = indices[indices.length - 1];
            const floorRange = { start: startIndex, end: endIndex, count: messages.length };
            
            // 处理并格式化聊天内容
            const chatTexts = messages.map(msg => {
                let extractedText;
                
                // 检查是否为首楼（index === 0）或用户楼层（msg.is_user === true）
                if (msg.index === 0 || msg.is_user === true) {
                    // 首楼或用户楼层：使用完整的原始文本，不应用标签提取规则
                    extractedText = msg.text;
                } else {
                    // 其他楼层：应用标签提取规则
                    extractedText = extractTagContent(msg.text, rules, this.settings.content_blacklist || []);
                }
                
                const msgType = msg.is_user ? '用户' : 'AI';
                return `#${msg.index} [${msgType}]: ${extractedText}`;
            }).join('\n\n');
            
            // 添加楼层信息头部
            const headerInfo = `【楼层 #${startIndex + 1} 至 #${endIndex + 1}，共 ${messages.length} 条消息】\n\n`;
            const contentWithHeader = headerInfo + chatTexts;
            
            // Get API configuration
            const apiSource = $('#memory_api_source').val();
            const apiConfig = this.getApiConfig();
            
            console.log('[MemoryUI] API配置:', {
                source: apiSource,
                config: apiConfig,
                hasApiKey: !!apiConfig.apiKey
            });
            
            // Get summary format and replace {{length}} macro
            let summaryFormat = $('#memory_summary_format').val() || this.settings.memory?.summaryFormat || defaultMemorySettings.summaryFormat;
            const detailLevel = this.settings?.memory?.detailLevel || defaultMemorySettings.detailLevel;
            summaryFormat = summaryFormat.replace('{{length}}', detailLevels[detailLevel] || detailLevels.normal);

            this.showLoading();
            
            // 显示总结开始提示
            this.toastr?.info(`开始总结楼层 #${startIndex + 1} 至 #${endIndex + 1} 的内容...`);
            
            // 临时存储楼层信息
            this._tempFloorRange = floorRange;
            
            // 设置处理标志，防止重复请求
            this.isProcessing = true;
            
            try {
                const maxTokens = parseInt($('#memory_max_tokens').val()) || this.settings.memory?.maxTokens || defaultMemorySettings.maxTokens;
                const result = await this.memoryService.sendMessage(contentWithHeader, {
                    apiSource: apiSource,
                    apiConfig: apiConfig,
                    summaryFormat: summaryFormat,
                    maxTokens: maxTokens
                });
                
                if (result.success) {
                    this.toastr?.success(`已总结楼层 #${startIndex + 1} 至 #${endIndex + 1} 的内容`);
                }
            } catch (error) {
                console.error('[MemoryUI] 总结失败:', error);
                this.toastr?.error('总结失败: ' + error.message);
                this.hideLoading();
            } finally {
                // 重置处理标志
                this.isProcessing = false;
            }
        } catch (error) {
            console.error('[MemoryUI] 获取聊天内容失败:', error);
            this.toastr?.error('获取聊天内容失败: ' + error.message);
        }
    }

    /**
     * Handle send button click
     */
    async handleSendClick() {
        if (this.isProcessing) return;

        const input = $('#memory_input').val().trim();
        if (!input) {
            this.toastr?.warning('请输入消息');
            return;
        }

        // Get API configuration
        const apiSource = $('#memory_api_source').val();
        const apiConfig = this.getApiConfig();
        
        // Get summary format and replace {{length}} macro
        let summaryFormat = $('#memory_summary_format').val() || this.settings.memory?.summaryFormat || defaultMemorySettings.summaryFormat;
        const detailLevel = this.settings?.memory?.detailLevel || defaultMemorySettings.detailLevel;
        summaryFormat = summaryFormat.replace('{{length}}', detailLevels[detailLevel] || detailLevels.normal);

        // Get UI settings - prompts removed, using preset format
        const maxTokens = parseInt($('#memory_max_tokens').val()) || this.settings.memory?.maxTokens || defaultMemorySettings.maxTokens;
        const options = {
            apiSource: apiSource,
            apiConfig: apiConfig,
            summaryFormat: summaryFormat,
            maxTokens: maxTokens
        };

        // Delegate to service
        this.isProcessing = true;
        this.setUIState(false);

        try {
            const result = await this.memoryService.sendMessage(input, options); // 只传递用户输入

            if (result.success) {
                // Clear input on success
                $('#memory_input').val('');
            }

        } catch (error) {
            // Error handling is done via events
            console.error('Memory UI error:', error);
        } finally {
            this.isProcessing = false;
            this.setUIState(true);
        }
    }


    /**
     * Show loading state
     */
    showLoading() {
        $('#memory_loading').show();
        $('#memory_output').val('');
    }

    /**
     * Hide loading state
     */
    hideLoading() {
        $('#memory_loading').hide();
    }

    /**
     * Display AI response
     * @param {string} response - AI response text
     */
    displayResponse(response) {
        $('#memory_output').val(response);
    }


    /**
     * Display error message
     * @param {Error} error - Error object
     */
    displayError(error) {
        this.toastr?.error(`发送失败: ${error.message}`);
        $('#memory_output').val(`错误: ${error.message}`);
    }

    /**
     * Enable/disable UI elements
     * @param {boolean} enabled - Whether to enable UI
     */
    setUIState(enabled) {
        $('#memory_input').prop('disabled', !enabled);
        $('#memory_send_btn').prop('disabled', !enabled);
    }

    /**
     * Get current UI values
     * @returns {Object} Current UI values
     */
    getUIValues() {
        return {
            input: $('#memory_input').val()
        };
    }

    /**
     * Set UI values
     * @param {Object} values - Values to set
     */
    setUIValues(values) {
        if (values.input !== undefined) {
            $('#memory_input').val(values.input);
        }
    }

    /**
     * Update ghost injection using SillyTavern's extension_prompt mechanism
     */
    updateGhostInjection() {
        const context = this.getContext ? this.getContext() : getContext();
        const chatId = context.chatId;
        
        // 检查数据是否存在
        const chats = extension_settings.vectors_enhanced?.chats?.[chatId];
        const hasData = chats && chats.length > 0;
        
        // 检查主开关
        const masterEnabled = extension_settings.vectors_enhanced?.master_enabled;
        
        if (!hasData || !masterEnabled) {
            // 删除注入
            delete window.extension_prompt?.['arc_short_term'];
            delete window.extension_prompt_depth?.['arc_short_term'];
            delete window.extension_prompt_roles?.['arc_short_term'];
            $('#memory_ghost_preview').val('');
            return;
        }
        
        // 获取最后N条记录
        const injectCount = extension_settings.vectors_enhanced?.memory_inject_count ?? 10;
        const recentChats = chats.slice(-injectCount);
        const texts = recentChats.map(item => item.text);
        const injectionText = texts.join('\n\n');
        
        // 赋值给酒馆大模型的底层注入文本（带标签）
        if (!window.extension_prompt) window.extension_prompt = {};
        window.extension_prompt['arc_short_term'] = "【近期情境快照】\n" + injectionText;
        
        // 赋值给前端 UI 面板的文本（保持纯净，不带标签，方便用户编辑）
        $('#memory_ghost_preview').val(injectionText);
        
        // 赋值注入深度
        if (!window.extension_prompt_depth) window.extension_prompt_depth = {};
        window.extension_prompt_depth['arc_short_term'] = parseInt($('#memory_injection_depth').val()) || 2;
        
        // 赋值注入角色
        if (!window.extension_prompt_roles) window.extension_prompt_roles = {};
        window.extension_prompt_roles['arc_short_term'] = 0; // 0代表作为System提示词
    }


    // Prompt restore methods removed - using preset format


    /**
     * Simple hash function for duplicate detection
     */
    generateHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString(36);
    }

    /**
     * Create a new world book
     */
    async createWorldBook() {
        // 防止重复创建
        if (this.isCreatingWorldBook) {
            console.log('[MemoryUI] 世界书创建正在进行中，跳过重复请求');
            return;
        }
        
        try {
            this.isCreatingWorldBook = true;
            // 检查是否有AI回复内容
            const outputContent = $('#memory_output').val();
            const hasSummaryContent = outputContent && outputContent.trim();
            
            // 获取楼层信息（使用临时存储的信息）
            const floorRange = this._tempFloorRange;
            
            // 调用服务层方法创建世界书，传入总结标志和楼层信息
            const result = await this.memoryService.createWorldBook(hasSummaryContent, floorRange);
            
            // 清除临时存储的楼层信息
            this._tempFloorRange = null;
            
            if (result.success) {
                // 根据不同操作构建不同的成功消息
                let successMessage = '';
                
                if (result.isNewWorldBook) {
                    // 新建世界书的情况
                    successMessage = `成功创建世界书: ${result.name}`;
                    if (result.newEntry) {
                        successMessage += '，并添加了第一个总结条目';
                    }
                } else {
                    // 世界书已存在的情况
                    if (result.newEntry) {
                        successMessage = `在世界书"${result.name}"中添加了新的总结条目`;
                    } else {
                        successMessage = `世界书"${result.name}"已存在`;
                    }
                }
                
                if (result.boundToChatLore) {
                    successMessage += '，已绑定为当前聊天的知识库';
                }
                
                this.toastr?.success(successMessage);
                
                // 触发世界书更新事件
                if (this.eventSource && this.event_types) {
                    this.eventSource.emit(this.event_types.WORLDINFO_UPDATED, result.name, result.data);
                }
                
                // 调用 SillyTavern 的更新函数来刷新主界面列表
                await updateSillyTavernWorldInfoList();
                
                // 调用插件的更新函数来刷新插件内部列表
                await updatePluginWorldInfoList();
            }
            
        } catch (error) {
            console.error('[MemoryUI] 创建世界书失败:', error);
            this.toastr?.error('创建世界书失败: ' + error.message);
        } finally {
            // 无论成功还是失败，都要重置标志
            this.isCreatingWorldBook = false;
        }
    }


    /**
     * Initialize API source display without saving
     * @param {string} source - Selected API source
     */
    initializeApiSourceDisplay(source) {
        // Hide all settings
        $('#memory_openai_settings, #memory_google_openai_settings').hide();

        // Show relevant settings
        switch(source) {
            case 'openai_compatible':
                $('#memory_openai_settings').show();
                break;
            case 'google_openai':
                $('#memory_google_openai_settings').show();
                break;
        }
    }

    /**
     * Handle API source change
     * @param {string} source - Selected API source
     */
    handleApiSourceChange(source) {
        // Hide all settings
        $('#memory_openai_settings, #memory_google_openai_settings').hide();

        // Show relevant settings
        switch(source) {
            case 'openai_compatible':
                $('#memory_openai_settings').show();
                break;
            case 'google_openai':
                $('#memory_google_openai_settings').show();
                break;
        }

        // Save selection
        this.saveApiConfig();
    }


    /**
     * Get current API configuration
     * @returns {Object} API configuration
     */
    getApiConfig() {
        const source = $('#memory_api_source').val();
        const useBackendProxy = $('#memory_use_backend_proxy').prop('checked');
        const proxyUrl = $('#memory_proxy_url').val() || '';

        switch(source) {
            case 'openai_compatible':
                return {
                    url: $('#memory_openai_url').val(),
                    apiKey: $('#memory_openai_api_key').val(),
                    model: $('#memory_openai_model').val() || '',
                    proxyMode: $('#memory_openai_proxy_mode').prop('checked') || false,
                    use_backend_proxy: useBackendProxy,
                    proxy_url: proxyUrl
                };
            case 'google_openai':
                return {
                    apiKey: $('#memory_google_openai_api_key').val(),
                    model: $('#memory_google_openai_model').val() || '',
                    use_backend_proxy: useBackendProxy,
                    proxy_url: proxyUrl
                };
            default:
                return { use_backend_proxy: useBackendProxy, proxy_url: proxyUrl };
        }
    }

    /**
     * 保存API配置到扩展设置
     */
    async saveApiConfig() {
        // 使用传入的settings引用
        if (!this.settings) {
            console.error('[MemoryUI] settings引用不可用');
            return;
        }

        // 直接保存到settings对象
        // 校验 source：下拉框为空(null)或非法值时回退到 google_openai，防止写入脏数据
        const selectedSource = $('#memory_api_source').val();
        const source = (selectedSource === 'openai_compatible' || selectedSource === 'google_openai') ? selectedSource : 'google_openai';
        if (selectedSource !== source) {
            $('#memory_api_source').val(source);
        }
        const memoryConfig = {
            source: source,
            use_backend_proxy: $('#memory_use_backend_proxy').prop('checked'),
            proxy_url: $('#memory_proxy_url').val() || '',
            detailLevel: this.settings?.memory?.detailLevel || 'normal', // 保留 detailLevel，防止重建对象时被抹掉
            summaryFormat: $('#memory_summary_format').val() || defaultMemorySettings.summaryFormat,
            floorOffset: parseInt($('#memory_floor_offset').val()) || 0,
            // detailLevel 已从UI绑定中移除，仅从 settings.memory.detailLevel 读取
            maxTokens: parseInt($('#memory_max_tokens').val()) || defaultMemorySettings.maxTokens,
            openai_compatible: {
                url: $('#memory_openai_url').val(),
                model: $('#memory_openai_model').val() || '',
                apiKey: $('#memory_openai_api_key').val() || '',  // 直接保存API密钥
                proxyMode: $('#memory_openai_proxy_mode').prop('checked') || false
            },
            google_openai: {
                model: $('#memory_google_openai_model').val() || '',
                apiKey: $('#memory_google_openai_api_key').val() || ''  // 直接保存API密钥
            },
            // prompts removed - using preset format
            autoSummarize: {
                enabled: $('#memory_auto_summarize_enabled').prop('checked'),
                interval: parseInt($('#memory_auto_summarize_interval').val()) || 20,
                messageCount: Math.max(1, parseInt($('#memory_auto_summarize_count').val()) || 1),
                // 不再保存 lastSummarizedFloor 到全局设置，它现在存储在聊天元数据中
                lastSummarizedFloor: this.settings?.memory?.autoSummarize?.lastSummarizedFloor || 0
            }
        };
        
        this.settings.memory = memoryConfig;

        // 保存设置 - 需要先同步到extension_settings
        const context = this.getContext();
        if (context && context.extensionSettings && context.extensionSettings.vectors_enhanced) {
            // 深度复制memory设置到extension_settings
            context.extensionSettings.vectors_enhanced.memory = JSON.parse(JSON.stringify(this.settings.memory));
        }
        
        if (this.saveSettingsDebounced) {
            this.saveSettingsDebounced();
        } else if (window.saveSettingsDebounced) {
            window.saveSettingsDebounced();
        }
    }

    /**
     * 加载API配置
     */
    async loadApiConfig() {
        // 使用传入的settings引用
        if (!this.settings) {
            console.error('[MemoryUI] settings引用不可用');
            return;
        }
        
        // 如果没有memory配置，使用默认设置初始化
        if (!this.settings.memory) {
            this.settings.memory = { ...defaultMemorySettings };
            // 保存默认设置
            if (this.saveSettingsDebounced) {
                this.saveSettingsDebounced();
            }
        }
        
        // 获取配置
        const config = this.settings.memory;

        // 加载配置到UI

        // 校验 API 来源：只接受下拉框支持的合法值，非法值（如旧版的 'main' 或 null）统一回退到 google_openai，
        // 并立即修正存档，避免下拉框空白、配置面板全部隐藏、总结时报"不支持的API源"。
        const validSources = ['openai_compatible', 'google_openai'];
        const source = validSources.includes(config.source) ? config.source : 'google_openai';
        if (config.source !== source) {
            config.source = source;
            if (this.saveSettingsDebounced) {
                this.saveSettingsDebounced();
            }
        }

        // 后端代理设置（默认 true，老存档兼容）
        const useBackendProxy = config.use_backend_proxy !== undefined ? config.use_backend_proxy : true;
        const proxyUrl = config.proxy_url || '';
        $('#memory_use_backend_proxy').prop('checked', useBackendProxy);
        $('#memory_proxy_url').val(proxyUrl);
        $('#memory_proxy_url_section').toggle(useBackendProxy);

        $('#memory_api_source').val(source);
        this.initializeApiSourceDisplay(source);
        $('#memory_summary_format').val(config.summaryFormat || defaultMemorySettings.summaryFormat);
        $('#memory_floor_offset').val(config.floorOffset || 0);
        $('#memory_max_tokens').val(config.maxTokens || defaultMemorySettings.maxTokens);
        $('#memory_openai_url').val(config.openai_compatible?.url || '');
        $('#memory_openai_model').val(config.openai_compatible?.model || '');
        $('#memory_openai_api_key').val(config.openai_compatible?.apiKey || '');  // 从设置加载API密钥
        $('#memory_openai_proxy_mode').prop('checked', config.openai_compatible?.proxyMode || false);
        $('#memory_google_openai_model').val(config.google_openai?.model || '');
        $('#memory_google_openai_api_key').val(config.google_openai?.apiKey || '');  // 从设置加载API密钥
        
        // 读取新UI元素的值
        const injectionDepth = extension_settings.vectors_enhanced?.memory_injection_depth ?? 2;
        const injectCount = extension_settings.vectors_enhanced?.memory_inject_count ?? 10;
        const retainCount = extension_settings.vectors_enhanced?.memory_retain_count ?? 0;
        const chunkSeparator = extension_settings.vectors_enhanced?.memory_chunk_separator ?? "===ARC_SPLIT===";
        
        // 赋值给DOM
        $('#memory_injection_depth').val(injectionDepth);
        $('#memory_inject_count').val(injectCount);
        $('#memory_retain_count').val(retainCount);
        $('#memory_chunk_separator').val(chunkSeparator);
        
        // Auto-summarize settings
        if (config.autoSummarize) {
            $('#memory_auto_summarize_enabled').prop('checked', config.autoSummarize.enabled || false);
            $('#memory_auto_summarize_interval').val(config.autoSummarize.interval || 20);
            $('#memory_auto_summarize_count').val(config.autoSummarize.messageCount || 6);
            $('#memory_auto_summarize_settings').toggle(config.autoSummarize.enabled || false);
            $('#memory_auto_summarize_status').toggle(config.autoSummarize.enabled || false);
            if (config.autoSummarize.enabled) {
                this.updateAutoSummarizeStatus();
            }
        }
    }

    /**
     * 注入选中的聊天内容到输入框
     */
    async injectSelectedContent() {
        try {
            // 获取 extension_settings 和 context
            const { extension_settings, getContext } = await import('../../../../../../extensions.js');
            const settings = extension_settings.vectors_enhanced;
            const context = getContext();
            
            // 检查聊天内容是否启用
            if (!settings.selected_content.chat.enabled) {
                this.toastr?.warning('请先在内容选择中启用聊天记录');
                return;
            }
            
            // 检查是否有聊天记录
            if (!context.chat || context.chat.length === 0) {
                this.toastr?.warning('当前没有聊天记录');
                return;
            }
            
            // 导入必要的函数和工具
            const { getMessages } = await import('../../utils/chatUtils.js');
            const { extractTagContent } = await import('../../utils/tagExtractor.js');
            
            // 获取聊天设置
            const chatSettings = settings.selected_content.chat;
            const rules = chatSettings.tag_rules || settings.tag_extraction_rules || [];
            
            // 使用 getMessages 函数获取过滤后的消息
            const messageOptions = {
                includeHidden: chatSettings.include_hidden || false,
                types: chatSettings.types || { user: true, assistant: true },
                range: chatSettings.range,
                newRanges: chatSettings.newRanges
            };
            
            const messages = getMessages(context.chat, messageOptions);
            
            if (messages.length === 0) {
                this.toastr?.warning('没有找到符合条件的聊天内容');
                return;
            }
            
            // 获取楼层编号范围
            const indices = messages.map(msg => msg.index).sort((a, b) => a - b);
            const startIndex = indices[0];
            const endIndex = indices[indices.length - 1];
            
            // 处理并格式化聊天内容
            const chatTexts = messages.map(msg => {
                let extractedText;
                
                // 检查是否为首楼（index === 0）或用户楼层（msg.is_user === true）
                if (msg.index === 0 || msg.is_user === true) {
                    // 首楼或用户楼层：使用完整的原始文本，不应用标签提取规则
                    extractedText = msg.text;
                } else {
                    // 其他楼层：应用标签提取规则
                    extractedText = extractTagContent(msg.text, rules, this.settings.content_blacklist || []);
                }
                
                const msgType = msg.is_user ? '用户' : 'AI';
                return `#${msg.index} [${msgType}]: ${extractedText}`;
            }).join('\n\n');
            
            // 添加楼层信息头部
            const headerInfo = `【注入内容：楼层 #${startIndex + 1} 至 #${endIndex + 1}，共 ${messages.length} 条消息】\n\n`;
            const contentWithHeader = headerInfo + chatTexts;
            
            // 注入到输入框
            const inputElement = $('#memory_input');
            const currentValue = inputElement.val();
            
            // 如果输入框已有内容，添加分隔符
            if (currentValue && currentValue.trim()) {
                inputElement.val(currentValue + '\n\n---\n\n' + contentWithHeader);
            } else {
                inputElement.val(contentWithHeader);
            }
            
            // 触发 input 事件，以防有其他监听器
            inputElement.trigger('input');
            
            // 存储楼层信息到数据属性，以便其他功能使用
            inputElement.data('injected-range', { start: startIndex, end: endIndex, count: messages.length });
            
            // 显示更详细的提示
            this.toastr?.info(`已注入楼层 #${startIndex + 1} 至 #${endIndex + 1} 的 ${messages.length} 条聊天记录`);
            
        } catch (error) {
            console.error('[MemoryUI] 注入内容失败:', error);
            this.toastr?.error('注入内容失败: ' + error.message);
        }
    }

    /**
     * 向量化当前聊天的总结内容
     */
    async vectorizeChatLore() {
        try {
            // 检查主开关是否启用
            if (!this.settings?.master_enabled) {
                this.toastr?.warning('聊天记录超级管理器已禁用，请先启用主开关');
                return;
            }
            // 尝试多种方式获取chat world
            let chatWorld = chat_metadata?.[METADATA_KEY];
            
            // 如果直接获取失败，尝试从getContext获取
            if (!chatWorld) {
                const context = this.getContext ? this.getContext() : window.getContext?.();
                if (context && context.chat_metadata) {
                    chatWorld = context.chat_metadata[METADATA_KEY];
                }
            }
            
            // 如果还是没有，尝试window.chat_metadata
            if (!chatWorld && window.chat_metadata) {
                chatWorld = window.chat_metadata[METADATA_KEY];
            }
            
            console.log('[MemoryUI] Chat world from various sources:', {
                fromImport: chat_metadata?.[METADATA_KEY],
                fromContext: this.getContext?.()?.chat_metadata?.[METADATA_KEY],
                fromWindow: window.chat_metadata?.[METADATA_KEY],
                final: chatWorld
            });
            
            if (!chatWorld) {
                this.toastr?.warning('当前聊天没有绑定的世界书');
                return;
            }
            
            // 直接执行，不需要确认
            
            // 加载世界书数据
            const worldData = await loadWorldInfo(chatWorld);
            if (!worldData || !worldData.entries) {
                this.toastr?.error('无法加载世界书数据');
                return;
            }
            
            // 获取所有有效条目（不筛选，但排除禁用的条目）
            const validEntries = Object.values(worldData.entries).filter(entry => 
                !entry.disable && entry.content && entry.content.trim()
            );
            
            if (validEntries.length === 0) {
                this.toastr?.warning('世界书中没有有效条目');
                return;
            }
            
            // 准备向量化的内容
            const contentToVectorize = validEntries.map(entry => ({
                uid: entry.uid,
                world: chatWorld,
                key: entry.key,
                keysecondary: entry.keysecondary,
                comment: entry.comment,
                content: entry.content,
                order: entry.order,
                position: entry.position,
                disable: entry.disable
            }));
            
            // 调用向量化功能
            const settings = extension_settings.vectors_enhanced;
            
            // 创建一个特殊的向量化任务
            const taskName = `${chatWorld} - 世界书向量化`;
            const taskId = `worldbook_${Date.now()}`;
            
            // 触发向量化
            const event = new CustomEvent('vectors:vectorize-summary', {
                detail: {
                    taskName,
                    taskId,
                    content: contentToVectorize,
                    worldName: chatWorld
                }
            });
            document.dispatchEvent(event);
            
            this.toastr?.info(`开始向量化世界书 "${chatWorld}"，共 ${validEntries.length} 个条目...`);
            
        } catch (error) {
            console.error('[MemoryUI] 向量化总结失败:', error);
            this.toastr?.error('向量化总结失败: ' + error.message);
        }
    }

    /**
     * 迁移旧的 lastSummarizedFloor 数据
     */
    migrateLastSummarizedFloor() {
        try {
            // 检查是否已有聊天元数据中的值
            const existingValue = this.getFromChatMetadata('lastSummarizedFloor');
            
            // 如果已经有值，说明已经迁移过或是新的数据，不需要处理
            if (existingValue !== undefined) {
                console.log('[MemoryUI] lastSummarizedFloor already exists in chat metadata:', existingValue);
                return;
            }
            
            // 检查全局设置中是否有旧数据
            const globalValue = this.settings?.memory?.autoSummarize?.lastSummarizedFloor;
            
            if (globalValue && globalValue > 0) {
                // 获取当前聊天的上下文
                const context = this.getContext ? this.getContext() : window.getContext?.();
                const currentFloor = context?.chat?.length - 1 || 0;
                
                // 只有当全局值合理时才迁移（不能大于当前楼层）
                if (globalValue <= currentFloor) {
                    console.log('[MemoryUI] Migrating lastSummarizedFloor from global settings:', globalValue);
                    this.saveToChatMetadata('lastSummarizedFloor', globalValue);
                } else {
                    // 如果全局值不合理，不初始化（让它保持undefined，这样会使用0）
                    console.log('[MemoryUI] Global lastSummarizedFloor is invalid, not migrating');
                }
            } else {
                // 没有旧数据，不需要初始化（让它保持undefined）
                console.log('[MemoryUI] No existing lastSummarizedFloor to migrate');
            }
        } catch (error) {
            console.error('[MemoryUI] Error during migration:', error);
            // 出错时不做处理，让它保持undefined
        }
    }

    /**
     * Initialize chat floor monitor
     */
    initializeChatFloorMonitor() {
        // 立即更新一次
        this.updateChatFloorCount();
        
        // 执行数据迁移
        this.migrateLastSummarizedFloor();
        
        // 监听SillyTavern的消息事件
        if (this.eventSource && this.event_types) {
            // 保存回调引用以便精确解绑
            const onMessageSent = () => this.scheduleUIUpdate();
            const onMessageReceived = () => {
                this.scheduleUIUpdate();
                // 确保 DOM 完全渲染、数据落盘后，再进行提纯判定
                setTimeout(() => this.checkAutoSummarize(), 500);
            };
            const onMessageDeleted = () => this.scheduleUIUpdate();
            const onMessageSwiped = () => this.scheduleUIUpdate();
            const onChatChanged = () => {
                setTimeout(() => {
                    this.migrateLastSummarizedFloor();
                    this.scheduleUIUpdate();
                    this.updateGhostInjection();
                }, 100);
            };
            const onChatLoaded = () => {
                setTimeout(() => {
                    this.migrateLastSummarizedFloor();
                    this.scheduleUIUpdate();
                    this.updateGhostInjection();
                }, 100);
            };

            this._eventCallbacks.set('MESSAGE_SENT', onMessageSent);
            this._eventCallbacks.set('MESSAGE_RECEIVED', onMessageReceived);
            this._eventCallbacks.set('MESSAGE_DELETED', onMessageDeleted);
            if (this.event_types.MESSAGE_SWIPED) {
                this._eventCallbacks.set('MESSAGE_SWIPED', onMessageSwiped);
            }
            this._eventCallbacks.set('CHAT_CHANGED', onChatChanged);
            this._eventCallbacks.set('CHAT_LOADED', onChatLoaded);

            // 1. 发送消息 (极速响应)
            this.eventSource.on(this.event_types.MESSAGE_SENT, onMessageSent);
            
            // 2. 接收完毕 (真/假流式的终极安全锚点)
            this.eventSource.on(this.event_types.MESSAGE_RECEIVED, onMessageReceived);
            
            // 3. 删除消息 (触发时空修补)
            this.eventSource.on(this.event_types.MESSAGE_DELETED, onMessageDeleted);
            
            // 4. 刷卡/滑动切换 (应对 Swipe 修改回复的场景)
            if (this.event_types.MESSAGE_SWIPED) {
                this.eventSource.on(this.event_types.MESSAGE_SWIPED, onMessageSwiped);
            }
            
            // 5. 聊天切换
            this.eventSource.on(this.event_types.CHAT_CHANGED, onChatChanged);
            
            // 6. 聊天加载
            this.eventSource.on(this.event_types.CHAT_LOADED, onChatLoaded);
        }
    }
    
    /**
     * Update chat floor count display
     */
    updateChatFloorCount() {
        try {
            const context = this.getContext ? this.getContext() : getContext();
            const floorElement = $('#memory_chat_floor_count');
            
            if (!context || !context.chat) {
                floorElement.text('无聊天');
                return;
            }
            
            // O(1) 极速获取，彻底干掉遍历
            const totalMessages = context.chat.length;
            const latestFloor = totalMessages > 0 ? totalMessages - 1 : 0;
            
            // 视觉偏移逻辑
            const offset = parseInt($('#memory_floor_offset').val()) || 0;
            const baseFloor = latestFloor + 1;
            let floorText = `楼层 #${baseFloor}`;
            if (offset !== 0) {
                floorText += ` → #${baseFloor + offset}`;
            }
            
            floorElement.text(`${floorText} (共${totalMessages}条)`);
            
            // 根据规模渲染颜色
            if (totalMessages > 100) {
                floorElement.css('color', 'var(--warning)');
                floorElement.attr('title', '消息数量较多，考虑总结部分内容以提高性能');
            } else if (totalMessages > 50) {
                floorElement.css('color', 'var(--SmartThemeQuoteColor)');
                floorElement.attr('title', '消息数量适中');
            } else {
                floorElement.css('color', 'var(--SmartThemeEmColor)');
                floorElement.attr('title', '当前聊天楼层信息');
            }
        } catch (error) {
            console.error('[MemoryUI] 更新聊天楼层失败:', error);
            $('#memory_chat_floor_count').text('错误');
        }
    }

    /**
     * Update auto-summarize status display
     */
    updateAutoSummarizeStatus() {
        const interval = parseInt($('#memory_auto_summarize_interval').val()) || 6;
        const context = this.getContext ? this.getContext() : getContext();
        if (!context || !context.chat) {
            $('#memory_next_auto_summarize_floor').text('-');
            return;
        }

        const currentFloor = context.chat.length - 1;
        let lastSummarized = this.getFromChatMetadata('lastSummarizedFloor');

        // 初始化：将基准点指向"下一句话"
        if ((lastSummarized === undefined || lastSummarized === null) && this.settings?.memory?.autoSummarize?.enabled) {
            lastSummarized = currentFloor + 1;
            this.saveToChatMetadata('lastSummarizedFloor', lastSummarized);
        }
        lastSummarized = lastSummarized ?? 0;

        // 【新增：时空回溯自我修复】
        // 如果用户删除了聊天记录，导致当前楼层被削减到了基准点之前
        // 我们必须让系统自动"时光倒流"，将基准点强行拉回当前楼层的下一句，防止倒计时卡死
        if (currentFloor < lastSummarized - 1) {
            lastSummarized = currentFloor + 1;
            this.saveToChatMetadata('lastSummarizedFloor', lastSummarized);
        }

        // 完美数学倒数：目标楼层 = 起点 + 间隔 - 1
        const nextTriggerFloor = lastSummarized + interval - 1;
        const messagesLeft = nextTriggerFloor - currentFloor;
        
        // 视觉偏移逻辑
        const offset = parseInt($('#memory_floor_offset').val()) || 0;
        const baseTarget = nextTriggerFloor + 1;
        let statusText = `目标 #${baseTarget}`;
        if (offset !== 0) {
            statusText += ` → #${baseTarget + offset}`;
        }

        if (messagesLeft > 0) {
            statusText += ` (距下次 ${messagesLeft} 句)`;
        } else {
            statusText += ` (等待触发)`;
        }
        $('#memory_next_auto_summarize_floor').text(statusText);
    }
    
    /**
     * Reset auto-summarize base floor to current floor
     */
    resetAutoSummarize() {
        const context = this.getContext ? this.getContext() : getContext();
        if (!context || !context.chat) return this.toastr?.warning('无法重置：聊天上下文不可用');
        const currentFloor = context.chat.length - 1;
        
        // 核心修复：重置的起点必须是下一句话，而不是当前这句话
        this.saveToChatMetadata('lastSummarizedFloor', currentFloor + 1);
        this.updateAutoSummarizeStatus();
        
        const interval = parseInt($('#memory_auto_summarize_interval').val()) || 6;
        this.toastr?.success(`已重置！重新倒数 ${interval} 句话后触发`);
    }
    
    /**
     * Check if auto-summarize should be triggered
     */
    async checkAutoSummarize() {
        try {
            if (!this.settings?.master_enabled || this.isAutoSummarizing || !this.settings?.memory?.autoSummarize?.enabled) return;
            const context = this.getContext ? this.getContext() : getContext();
            if (!context || !context.chat || context.chat.length < 2) return;

            const currentFloor = context.chat.length - 1;
            const interval = parseInt($('#memory_auto_summarize_interval').val()) || 6;
            let lastSummarized = this.getFromChatMetadata('lastSummarizedFloor');

            if (lastSummarized === undefined || lastSummarized === null) {
                lastSummarized = currentFloor + 1;
                this.saveToChatMetadata('lastSummarizedFloor', lastSummarized);
                return;
            }

            const nextTriggerFloor = lastSummarized + interval - 1;
            if (currentFloor < nextTriggerFloor) return;

            const latestMessage = context.chat[currentFloor];
            if (!latestMessage || latestMessage.is_user) return;

            this.isAutoSummarizing = true;
            await this.performAutoSummarize(currentFloor);
        } catch (error) {
            console.error('[MemoryUI] 自动总结检查失败:', error);
            this.isAutoSummarizing = false;
        }
    }
    
    /**
     * Perform auto-summarization
     */
    async performAutoSummarize(currentFloor) {
        try {
            const { extension_settings, getContext } = await import('../../../../../../extensions.js');
            const { extractTagContent } = await import('../../utils/tagExtractor.js');
            const settings = extension_settings.vectors_enhanced;
            const context = getContext();
            
            if (!settings.master_enabled) return;
            this.toastr?.info('开始记忆提纯...');
            
            const rules = settings.tag_extraction_rules || [];
            let lastSummarized = this.getFromChatMetadata('lastSummarizedFloor') ?? 0;
            const chats = settings.chats?.[context.chatId] || [];
            if (chats.length === 0 && lastSummarized >= currentFloor) {
                const interval = parseInt($('#memory_auto_summarize_interval').val()) || 6;
                lastSummarized = Math.max(0, currentFloor - interval + 1);
            }
            const startIndex = lastSummarized;
            const endIndex = currentFloor; // 完美切片
            
            if (endIndex < startIndex) return this.toastr?.warning('没有新的对话需要提纯');
            
            const chatMessages = [];
            for (let i = startIndex; i <= endIndex; i++) {
                const msg = context.chat[i];
                if (msg && !msg.is_system) chatMessages.push({ ...msg, index: i });
            }
            if (chatMessages.length === 0) return;
            
            const chatTexts = chatMessages.map(msg => {
                const messageText = msg.mes || msg.text || '';
                if (!messageText) return `#${msg.index + 1} [${msg.is_user ? 'User' : 'AI'}]: （空消息）`;
                const extractedText = extractTagContent(messageText, rules, this.settings.content_blacklist || []);
                return `#${msg.index + 1} [${msg.is_user ? 'User' : 'AI'}]: ${extractedText}`;
            }).join('\n\n');
            
            const contentWithHeader = `【近期对话快照：楼层 #${startIndex + 1} 至 #${endIndex + 1}，共 ${chatMessages.length} 条消息】\n\n` + chatTexts;
            
            const apiSource = $('#memory_api_source').val();
            const apiConfig = this.getApiConfig();
            const summaryFormat = $('#memory_summary_format').val() || '';
            const maxTokens = parseInt($('#memory_max_tokens').val()) || 8192;
            
            const result = await this.memoryService.sendMessage(contentWithHeader, {
                apiSource, apiConfig, summaryFormat, maxTokens
            });
            
            if (result && result.success) {
                const response = result.response || '';
                if (!response || response.trim().length < 2) return this.toastr?.error('提纯失败：AI返回了空内容');
                
                this.saveToChatMetadata('lastSummarizedFloor', endIndex + 1);
                
                const chatId = context.chatId;
                if (!extension_settings.vectors_enhanced.chats) extension_settings.vectors_enhanced.chats = {};
                if (!extension_settings.vectors_enhanced.chats[chatId]) extension_settings.vectors_enhanced.chats[chatId] = [];
                extension_settings.vectors_enhanced.chats[chatId].push({ floor: endIndex + 1, text: response });
                
                // 检查本地最大保留数限制并自动清理旧快照
                const retainCount = extension_settings.vectors_enhanced?.memory_retain_count ?? 0;
                if (retainCount > 0 && extension_settings.vectors_enhanced.chats[chatId].length > retainCount) {
                    const removeCount = extension_settings.vectors_enhanced.chats[chatId].length - retainCount;
                    extension_settings.vectors_enhanced.chats[chatId].splice(0, removeCount);
                }
                
                this.saveSettingsDebounced?.() || window.saveSettingsDebounced?.();
                this.toastr?.success(`快照生成完毕：包含 ${chatMessages.length} 句话`);
                this.updateAutoSummarizeStatus();
                this.updateGhostInjection();
            } else {
                this.toastr?.error('提纯失败：' + (result?.error || '未知错误'));
            }
        } catch (error) {
            console.error('[MemoryUI] 自动提纯失败:', error);
            this.toastr?.error('自动提纯报错: ' + error.message);
        } finally {
            this.isAutoSummarizing = false;
            this.hideLoading();
        }
    }

    /**
     * Hide floors if enabled in settings
     * @param {number} startIndex - Start index of AI messages
     * @param {number} endIndex - End index of AI messages
     * @param {boolean} isAutoSummarize - Whether this is from auto-summarize
     */


    /**
     * Reset summary format to default
     */
    resetSummaryFormat() {
        const defaultFormat = `总结应当遵循以下原则：
- 按时间顺序或逻辑顺序组织信息
- 保留关键事件和重要细节，省略冗余描述
- 直接陈述事实，避免主观评价
- 使用简洁清晰的语言，避免过度修饰
- 突出事件发展脉络和关键转折点
- 不使用任何xml标签包裹，使用纯文字进行叙述
- {{length}}
- 不回避任何敏感内容，保证记录完全还原前文

总结必须使用以下格式：
【关键事件标题】
关键事件概述。
发生地点:
关键角色:
• {分解事件1（小标题形式）}: {简要描述}
• {分解事件2（小标题形式）}: {简要描述}
• {分解事件3（小标题形式）}: {简要描述}
...`;
        
        $('#memory_summary_format').val(defaultFormat);
        this.saveApiConfig();
        
        // Show feedback
        if (this.toastr) {
            this.toastr.success('已重置为默认总结格式');
        }
    }

    destroy() {
        // 【内存泄漏修复】清理所有活跃的定时器
        this._activeTimers.forEach(timerId => clearTimeout(timerId));
        this._activeTimers.clear();
        if (this._uiUpdateTimer) {
            clearTimeout(this._uiUpdateTimer);
            this._uiUpdateTimer = null;
        }
        if (this._offsetSaveTimer) {
            clearTimeout(this._offsetSaveTimer);
            this._offsetSaveTimer = null;
        }

        // Unbind event listeners - 必须与绑定时使用完全一致的事件名
        $('#memory_summarize_btn').off('click');
        $('#memory_send_btn').off('click');
        $('#memory_input').off('keydown');
        $('#memory_api_source').off('change');
        $('#memory_openai_url, #memory_openai_api_key, #memory_openai_model, #memory_google_openai_api_key, #memory_google_openai_model, #memory_summary_format, #memory_max_tokens, #memory_proxy_url').off('change input');
        $('#memory_use_backend_proxy').off('change');
        $('#memory_proxy_url').off('change input');
        $('#memory_injection_depth').off('input');
        $('#memory_inject_count').off('input');
        $('#memory_retain_count').off('input');
        $('#memory_chunk_separator').off('input');
        $('#reset_memory_summary_format').off('click');
        $('#memory_download_chunked').off('click');
        $('#memory_download_full').off('click');
        $('#memory_clear_buffer').off('click');
        $('#memory_auto_summarize_enabled').off('change');
        $('#memory_auto_summarize_interval').off('change input');
        $('#memory_floor_offset').off('change input');
        $('#memory_reset_auto_summarize').off('click');
        $('#memory_force_auto_summarize').off('click');
        $('#memory_save_edit').off('click');
        $('#memory_save_all_edits').off('click');

        // Unsubscribe from events
        if (this.eventBus) {
            this.eventBus.off('memory:message-start');
            this.eventBus.off('memory:message-complete');
            this.eventBus.off('memory:message-error');
            this.eventBus.off('memory:history-updated');
        }
        
        // 【内存泄漏修复】使用保存的回调引用精确解绑 SillyTavern 全局事件，避免误拆其他监听器
        if (this.eventSource && this.event_types && this._eventCallbacks) {
            this._eventCallbacks.forEach((callback, eventName) => {
                if (this.event_types[eventName]) {
                    this.eventSource.off(this.event_types[eventName], callback);
                }
            });
            this._eventCallbacks.clear();
        }

        this.initialized = false;
    }

}
