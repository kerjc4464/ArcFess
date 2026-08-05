/**
 * 设置管理器模块
 * 负责UI设置的初始化、事件绑定和状态同步
 */

import { ConfigManager } from '../infrastructure/ConfigManager.js';
import { updateFileList } from './components/FileList.js';
import { updateWorldInfoList } from './components/WorldInfoList.js';
import { renderTagRulesUI } from './components/TagRulesEditor.js';
import { tagPresetManager } from './components/TagPresetManager.js';
import { updateTaskList } from './components/TaskList.js';
import { MessageUI } from './components/MessageUI.js';
import { MemoryUI } from './components/MemoryUI.js';
import { MemoryService } from '../core/memory/MemoryService.js';
import { 
  updateMasterSwitchState, 
  updateContentSelection,
  toggleSettings
} from './domUtils.js';
import { updateChatSettings } from './components/ChatSettings.js';
import { clearTagSuggestions } from './components/TagUI.js';
import { eventBus } from '../infrastructure/events/eventBus.instance.js';

/**
 * 设置管理器类
 * 集中管理所有设置相关的UI初始化和事件处理
 */
export class SettingsManager {
  constructor(settings, configManager, dependencies) {
    this.settings = settings;
    this.configManager = configManager;
    this.dependencies = dependencies;
    this.initialized = false;
  }

  /**
   * 初始化所有设置UI
   * 每个分区独立 try/catch：单个分区失败只跳过该分区，不影响其余设置绑定；
   * initialized 标志在全部完成后才置位，失败后可安全重试。
   */
  async initialize() {
    if (this.initialized) {
      console.warn('SettingsManager already initialized');
      return;
    }

    const safeStep = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        console.error(`SettingsManager: ${name} 初始化失败 (已跳过):`, e);
        if (typeof toastr !== 'undefined') {
          toastr.warning(`设置分区 "${name}" 初始化失败: ${e.message}`);
        }
      }
    };

    // 初始化主开关
    await safeStep('主开关', () => this.initializeMasterSwitch());

    // 初始化实时同步开关
    await safeStep('实时同步', () => this.initializeRealtimeSyncSettings());

    // 初始化总管层级记忆设置
    await safeStep('层级记忆', () => this.initializeHierarchicalSettings());

    // 初始化基础设置
    await safeStep('基础设置', () => this.initializeBasicSettings());

    // 初始化向量化源设置
    await safeStep('向量化源', () => this.initializeVectorizationSettings());

    // 初始化 Rerank 设置
    await safeStep('Rerank', () => this.initializeRerankSettings());

    // 初始化 BM25 设置
    await safeStep('BM25', () => this.initializeBM25Settings());

    // 初始化权重混合设置
    await safeStep('权重混合', () => this.initializeWeightMixing());

    // 初始化查询设置
    await safeStep('查询设置', () => this.initializeQuerySettings());

    // 初始化内容选择设置
    await safeStep('内容选择', () => this.initializeContentSelectionSettings());

    // 初始化内容标签设置
    await safeStep('内容标签', () => this.initializeContentTagSettings());

    // 初始化注入设置
    await safeStep('注入设置', () => this.initializeInjectionSettings());

    // 初始化压缩提纯设置
    await safeStep('压缩提纯', () => this.initializeCompressionSettings());

    // 初始化其他设置
    await safeStep('其他设置', () => this.initializeMiscellaneousSettings());

    // 初始化外挂任务UI
    await safeStep('外挂任务', () => this.initializeExternalTaskUI());

    // 初始化向量存储路径UI
    await safeStep('向量存储路径', () => this.initializeVectorStoragePathUI());

    // 初始化实验性设置
    await safeStep('实验性设置', () => this.initializeExperimentalSettings());

    // 初始化记忆管理UI
    await safeStep('记忆管理', () => this.initializeMemoryUI());

    // 初始化UI状态
    await safeStep('UI状态', () => this.initializeUIState());

    // 绑定其他事件
    await safeStep('其他事件', () => this.bindOtherEvents());

    // 清除标签建议（防止空的"发现的标签"框显示）
    await safeStep('标签建议清理', () => clearTagSuggestions());

    this.initialized = true;
  }

  /**
   * 初始化主开关
   */
  initializeMasterSwitch() {
    const { saveSettingsDebounced } = this.dependencies;

    $('#vectors_enhanced_master_enabled')
      .prop('checked', this.settings.master_enabled)
      .on('change', () => {
        this.settings.master_enabled = $('#vectors_enhanced_master_enabled').prop('checked');
        this.updateAndSave();
        updateMasterSwitchState(this.settings);
      });

    // 初始化主开关状态
    updateMasterSwitchState(this.settings);
  }

  /**
   * 初始化实时同步设置
   */
  initializeRealtimeSyncSettings() {
    const { eventSource, event_types } = this.dependencies;
    
    // 初始化默认值（向后兼容）
    if (this.settings.realtime_sync_user === undefined) this.settings.realtime_sync_user = true;
    if (this.settings.realtime_sync_assistant === undefined) this.settings.realtime_sync_assistant = true;
    if (this.settings.realtime_sync_hidden === undefined) this.settings.realtime_sync_hidden = false;
    if (this.settings.realtime_quota === undefined) this.settings.realtime_quota = 5;
    if (this.settings.realtime_boost === undefined) this.settings.realtime_boost = 1.0;
    if (this.settings.realtime_retrieval_enabled === undefined) this.settings.realtime_retrieval_enabled = true;

     $('#vectors_enhanced_realtime_retrieval_enabled')
      .prop('checked', this.settings.realtime_retrieval_enabled)
      .on('change', () => {
        this.settings.realtime_retrieval_enabled = $('#vectors_enhanced_realtime_retrieval_enabled').prop('checked');
        this.updateAndSave();
      });

    $('#vectors_enhanced_realtime_sync_enabled')
      .prop('checked', this.settings.realtime_sync_enabled)
      .on('change', () => {
        this.settings.realtime_sync_enabled = $('#vectors_enhanced_realtime_sync_enabled').prop('checked');
        this.updateAndSave();
        
        // 显示或隐藏详细设定
        if (this.settings.realtime_sync_enabled) {
          $('#vectors_enhanced_realtime_settings').slideDown();
        } else {
          $('#vectors_enhanced_realtime_settings').slideUp();
        }
        
        // 如果开启，则立刻触发一次同步检查 (Catch-up)
        if (this.settings.realtime_sync_enabled && eventSource && event_types) {
          eventSource.emit(event_types.CHAT_LOADED); // 复用CHAT_LOADED逻辑触发全量扫描
        }
      });
      
    // 初始化显示状态
    if (this.settings.realtime_sync_enabled) {
      $('#vectors_enhanced_realtime_settings').show();
      if (typeof this.dependencies.updateRealtimeDashboard === 'function') {
        this.dependencies.updateRealtimeDashboard();
      }
    }
    
    // 监听折叠面板展开事件以刷新状态
    $('#vectors_enhanced_realtime_settings').closest('details').on('toggle', (e) => {
      if (e.target.open && typeof this.dependencies.updateRealtimeDashboard === 'function') {
        this.dependencies.updateRealtimeDashboard();
      }
    });

    // 绑定详细设定事件
    $('#vectors_enhanced_realtime_user')
      .prop('checked', this.settings.realtime_sync_user)
      .on('change', () => {
        this.settings.realtime_sync_user = $('#vectors_enhanced_realtime_user').prop('checked');
        this.updateAndSave();
        if (typeof this.dependencies.updateRealtimeDashboard === 'function') {
          this.dependencies.updateRealtimeDashboard();
        }
        if (eventSource && event_types) eventSource.emit(event_types.CHAT_LOADED);
      });
      
    $('#vectors_enhanced_realtime_assistant')
      .prop('checked', this.settings.realtime_sync_assistant)
      .on('change', () => {
        this.settings.realtime_sync_assistant = $('#vectors_enhanced_realtime_assistant').prop('checked');
        this.updateAndSave();
        if (typeof this.dependencies.updateRealtimeDashboard === 'function') {
          this.dependencies.updateRealtimeDashboard();
        }
        if (eventSource && event_types) eventSource.emit(event_types.CHAT_LOADED);
      });
      
    $('#vectors_enhanced_realtime_hidden')
      .prop('checked', this.settings.realtime_sync_hidden)
      .on('change', () => {
        this.settings.realtime_sync_hidden = $('#vectors_enhanced_realtime_hidden').prop('checked');
        this.updateAndSave();
        if (typeof this.dependencies.updateRealtimeDashboard === 'function') {
          this.dependencies.updateRealtimeDashboard();
        }
        if (eventSource && event_types) eventSource.emit(event_types.CHAT_LOADED);
      });
  }

  /**
   * 初始化层级实时引擎设置
   */
  initializeHierarchicalSettings() {
    // 楼层轨开关
    $('#ve_hierarchical_floor_enabled')
      .prop('checked', this.settings.ve_hierarchical_floor_enabled || false)
      .on('change', () => {
        this.settings.ve_hierarchical_floor_enabled = $('#ve_hierarchical_floor_enabled').prop('checked');
        this.updateAndSave();
        this.toggleHierarchicalSettingsVisibility();
      });

    $('#ve_hierarchical_floor_trigger')
      .val(this.settings.ve_hierarchical_floor_trigger || 30)
      .on('input', () => {
        this.settings.ve_hierarchical_floor_trigger = parseInt($('#ve_hierarchical_floor_trigger').val(), 10) || 30;
        this.updateAndSave();
      });

    // 日期轨开关
    $('#ve_hierarchical_date_enabled')
      .prop('checked', this.settings.ve_hierarchical_date_enabled || false)
      .on('change', () => {
        this.settings.ve_hierarchical_date_enabled = $('#ve_hierarchical_date_enabled').prop('checked');
        this.updateAndSave();
        this.toggleHierarchicalSettingsVisibility();
      });

    $('#ve_hierarchical_date_tag')
      .val(this.settings.ve_hierarchical_date_tag || "<ArcTime:\\s*(.*?)\\s*>")
      .on('input', () => {
        this.settings.ve_hierarchical_date_tag = $('#ve_hierarchical_date_tag').val();
        this.updateAndSave();
      });

    $('#ve_hierarchical_inject_date_rule')
      .prop('checked', this.settings.ve_hierarchical_inject_date_rule !== false)
      .on('change', () => {
        this.settings.ve_hierarchical_inject_date_rule = $('#ve_hierarchical_inject_date_rule').prop('checked');
        this.updateAndSave();
      });

    // 全局层级配置
    $('#ve_hierarchical_big_trigger')
      .val(this.settings.ve_hierarchical_big_trigger || 4)
      .on('input', () => {
        this.settings.ve_hierarchical_big_trigger = parseInt($('#ve_hierarchical_big_trigger').val(), 10) || 4;
        this.updateAndSave();
      });

    $('#ve_hierarchical_inject_count')
      .val(this.settings.ve_hierarchical_inject_count || 5)
      .on('input', () => {
        this.settings.ve_hierarchical_inject_count = parseInt($('#ve_hierarchical_inject_count').val(), 10) || 5;
        this.updateAndSave();
      });

    // Prompts
    $('#ve_hierarchical_prompt')
      .val(this.settings.ve_hierarchical_prompt || "请总结以下内容的剧情发展，保留关键细节，字数不要超过100字。")
      .on('input', () => {
        this.settings.ve_hierarchical_prompt = $('#ve_hierarchical_prompt').val();
        this.updateAndSave();
      });

    $('#ve_hierarchical_big_prompt')
      .val(this.settings.ve_hierarchical_big_prompt || "请根据以下数个子事件，总结提炼出这一阶段整体的情节大纲，字数不要超过200字。")
      .on('input', () => {
        this.settings.ve_hierarchical_big_prompt = $('#ve_hierarchical_big_prompt').val();
        this.updateAndSave();
      });

    $('#ve_hierarchical_manager_prompt_r1')
      .val(this.settings.ve_hierarchical_manager_prompt_r1 || '你是一个记忆总管。根据用户目前输入，若需要查询历史记忆来辅助回答，请大结目录中挑选出一个或数个最相关的大结名称或小结名称，并以如下JSON数组格式返回：[{"target": "大结的名称或ID", "reason": "原因"}...]。如果不需要查询，请直接回复空数组 []。绝对不要返回除JSON以外的其他废话。')
      .on('input', () => {
        this.settings.ve_hierarchical_manager_prompt_r1 = $('#ve_hierarchical_manager_prompt_r1').val();
        this.updateAndSave();
      });

    $('#ve_hierarchical_manager_prompt_r2')
      .val(this.settings.ve_hierarchical_manager_prompt_r2 || '你已经锁定了目标大结，现在请在以下子事件中，挑选出最相关的几个具体小结，并为每一个小结提供具体的相似检索词数组用于执行精确检索。必须严格以如下JSON格式返回：[{"target": "小结ID", "queries": ["关键词1", "关键词2"]}...]。绝对不能回复其他废话。')
      .on('input', () => {
        this.settings.ve_hierarchical_manager_prompt_r2 = $('#ve_hierarchical_manager_prompt_r2').val();
        this.updateAndSave();
      });

    // 总结 API
    $('#ve_summary_api_type')
      .val(this.settings.ve_summary_api_type || "main")
      .on('change', () => {
        this.settings.ve_summary_api_type = $('#ve_summary_api_type').val();
        this.updateAndSave();
        this.toggleApiSettingsVisibility();
      });

    $('#ve_summary_api_url')
      .val(this.settings.ve_summary_api_url || "")
      .on('input', () => {
        this.settings.ve_summary_api_url = $('#ve_summary_api_url').val();
        this.updateAndSave();
      });

    $('#ve_summary_api_key')
      .val(this.settings.ve_summary_api_key || "")
      .on('input', () => {
        this.settings.ve_summary_api_key = $('#ve_summary_api_key').val();
        this.updateAndSave();
      });

    $('#ve_summary_api_model')
      .val(this.settings.ve_summary_api_model || "")
      .on('input', () => {
        this.settings.ve_summary_api_model = $('#ve_summary_api_model').val();
        this.updateAndSave();
      });

    // 总管 API
    $('#ve_manager_api_type')
      .val(this.settings.ve_manager_api_type || "main")
      .on('change', () => {
        this.settings.ve_manager_api_type = $('#ve_manager_api_type').val();
        this.updateAndSave();
        this.toggleApiSettingsVisibility();
      });

    $('#ve_manager_api_url')
      .val(this.settings.ve_manager_api_url || "")
      .on('input', () => {
        this.settings.ve_manager_api_url = $('#ve_manager_api_url').val();
        this.updateAndSave();
      });

    $('#ve_manager_api_key')
      .val(this.settings.ve_manager_api_key || "")
      .on('input', () => {
        this.settings.ve_manager_api_key = $('#ve_manager_api_key').val();
        this.updateAndSave();
      });

    $('#ve_manager_api_model')
      .val(this.settings.ve_manager_api_model || "")
      .on('input', () => {
        this.settings.ve_manager_api_model = $('#ve_manager_api_model').val();
        this.updateAndSave();
      });

    // 功能按钮绑定
    $('#ve_hierarchical_preview').on('click', () => {
      if (typeof window.vectors_enhanced_showHierarchicalPreview === 'function') {
        window.vectors_enhanced_showHierarchicalPreview();
      } else {
        toastr.warning('记忆查看器模块尚未加载完成');
      }
    });

    $('#ve_hierarchical_inherit').on('click', () => {
      if (typeof window.vectors_enhanced_inheritHierarchicalMemory === 'function') {
        window.vectors_enhanced_inheritHierarchicalMemory();
      } else {
        toastr.warning('记忆继承模块尚未加载完成');
      }
    });

    $('#ve_hierarchical_purge').on('click', () => {
      if (typeof window.vectors_enhanced_purgeHierarchicalMemory === 'function') {
        window.vectors_enhanced_purgeHierarchicalMemory();
      } else {
        toastr.warning('记忆管理模块尚未加载完成');
      }
    });

    // 初始化显示状态
    this.toggleHierarchicalSettingsVisibility();
    this.toggleApiSettingsVisibility();
  }

  toggleHierarchicalSettingsVisibility() {
    const isFloorEnabled = $('#ve_hierarchical_floor_enabled').prop('checked');
    const isDateEnabled = $('#ve_hierarchical_date_enabled').prop('checked');

    if (isFloorEnabled) {
      $('#ve_hierarchical_floor_settings').slideDown();
    } else {
      $('#ve_hierarchical_floor_settings').slideUp();
    }

    if (isDateEnabled) {
      $('#ve_hierarchical_date_settings').slideDown();
    } else {
      $('#ve_hierarchical_date_settings').slideUp();
    }

    if (isFloorEnabled || isDateEnabled) {
      $('#ve_hierarchical_global_settings').slideDown();
    } else {
      $('#ve_hierarchical_global_settings').slideUp();
    }
  }

  toggleApiSettingsVisibility() {
    if ($('#ve_summary_api_type').val() === 'custom') {
      $('#ve_summary_api_settings').css('display', 'flex').slideDown();
    } else {
      $('#ve_summary_api_settings').slideUp();
    }

    if ($('#ve_manager_api_type').val() === 'custom') {
      $('#ve_manager_api_settings').css('display', 'flex').slideDown();
    } else {
      $('#ve_manager_api_settings').slideUp();
    }
  }

  /**
   * 初始化基础设置
   */
  initializeBasicSettings() {
    // 向量化源
    $('#vectors_enhanced_source')
      .val(this.settings.source)
      .on('change', () => {
        this.settings.source = String($('#vectors_enhanced_source').val());
        this.updateAndSave();
        toggleSettings(this.settings);
      });


    // 块大小
    $('#vectors_enhanced_chunk_size')
      .val(this.settings.chunk_size)
      .on('input', () => {
        this.settings.chunk_size = Number($('#vectors_enhanced_chunk_size').val());
        this.updateAndSave();
      });

    // 重叠百分比
    $('#vectors_enhanced_overlap_percent')
      .val(this.settings.overlap_percent)
      .on('input', () => {
        this.settings.overlap_percent = Number($('#vectors_enhanced_overlap_percent').val());
        this.updateAndSave();
      });

    // 分块分隔符
    $('#vectors_enhanced_force_chunk_delimiter')
      .val(this.settings.force_chunk_delimiter)
      .on('input', () => {
        this.settings.force_chunk_delimiter = String($('#vectors_enhanced_force_chunk_delimiter').val());
        this.updateAndSave();
      });

    // 分数阈值
    $('#vectors_enhanced_score_threshold')
      .val(this.settings.score_threshold)
      .on('input', () => {
        this.settings.score_threshold = Number($('#vectors_enhanced_score_threshold').val());
        this.updateAndSave();
      });
  }

  /**
   * 初始化向量化源设置
   */
  initializeVectorizationSettings() {
    // vLLM 设置
    $('#vectors_enhanced_vllm_model')
      .val(this.settings.vllm_model)
      .on('input', () => {
        this.settings.vllm_model = String($('#vectors_enhanced_vllm_model').val());
        this.updateAndSave();
      });

    $('#vectors_enhanced_vllm_url')
      .val(this.settings.vllm_url)
      .on('input', () => {
        this.settings.vllm_url = String($('#vectors_enhanced_vllm_url').val());
        this.updateAndSave();
      });

    // 本地模型设置
    $('#vectors_enhanced_local_model')
      .val(this.settings.local_model)
      .on('input', () => {
        this.settings.local_model = String($('#vectors_enhanced_local_model').val());
        this.updateAndSave();
      });

    // Ollama 设置
    $('#vectors_enhanced_ollama_model')
      .val(this.settings.ollama_model)
      .on('input', () => {
        this.settings.ollama_model = String($('#vectors_enhanced_ollama_model').val());
        this.updateAndSave();
      });

    $('#vectors_enhanced_ollama_url')
      .val(this.settings.ollama_url)
      .on('input', () => {
        this.settings.ollama_url = String($('#vectors_enhanced_ollama_url').val());
        this.updateAndSave();
      });

    $('#vectors_enhanced_ollama_keep')
      .prop('checked', this.settings.ollama_keep)
      .on('input', () => {
        this.settings.ollama_keep = $('#vectors_enhanced_ollama_keep').prop('checked');
        this.updateAndSave();
      });

    // OpenAI 设置
    $('#vectors_enhanced_openai_model')
      .val(this.settings.openai_model)
      .on('input', () => {
        this.settings.openai_model = String($('#vectors_enhanced_openai_model').val());
        this.updateAndSave();
      });

    $('#vectors_enhanced_openai_url')
      .val(this.settings.openai_url)
      .on('input', () => {
        this.settings.openai_url = String($('#vectors_enhanced_openai_url').val());
        this.updateAndSave();
      });

    $('#vectors_enhanced_openai_api_key')
      .val(this.settings.openai_api_key)
      .on('input', () => {
        this.settings.openai_api_key = String($('#vectors_enhanced_openai_api_key').val());
        this.updateAndSave();
      });
  }

  /**
   * 初始化 Rerank 设置
   */
  initializeRerankSettings() {
    $('#vectors_enhanced_rerank_enabled')
      .prop('checked', this.settings.rerank_enabled)
      .on('input', () => {
        this.settings.rerank_enabled = $('#vectors_enhanced_rerank_enabled').prop('checked');
        
        // 如果 Rerank 被启用，确保向量查询也被启用
        if (this.settings.rerank_enabled) {
          $('#vectors_enhanced_enabled').prop('checked', true);
          this.settings.enabled = true;
        } else {
          // 如果 Rerank 被禁用，同时禁用依赖的去重功能
          if (this.settings.rerank_deduplication_enabled) {
            this.settings.rerank_deduplication_enabled = false;
            $('#vectors_enhanced_rerank_deduplication_enabled').prop('checked', false);
            $('#rerank_deduplication_settings').slideUp();
          }
        }
        
        this.updateAndSave();
      });

    $('#vectors_enhanced_rerank_url')
      .val(this.settings.rerank_url)
      .on('input', () => {
        this.settings.rerank_url = $('#vectors_enhanced_rerank_url').val();
        this.updateAndSave();
      });

    $('#vectors_enhanced_rerank_apiKey')
      .val(this.settings.rerank_apiKey)
      .on('input', () => {
        this.settings.rerank_apiKey = $('#vectors_enhanced_rerank_apiKey').val();
        this.updateAndSave();
      });

    $('#vectors_enhanced_rerank_model')
      .val(this.settings.rerank_model)
      .on('input', () => {
        this.settings.rerank_model = $('#vectors_enhanced_rerank_model').val();
        this.updateAndSave();
      });

    $('#vectors_enhanced_rerank_top_n')
      .val(this.settings.rerank_top_n)
      .on('input', () => {
        this.settings.rerank_top_n = Number($('#vectors_enhanced_rerank_top_n').val());
        this.updateAndSave();
      });

    $('#vectors_enhanced_rerank_hybrid_alpha')
      .val(this.settings.rerank_hybrid_alpha)
      .on('input', () => {
        this.settings.rerank_hybrid_alpha = Number($('#vectors_enhanced_rerank_hybrid_alpha').val());
        this.updateAndSave();
      });

    $('#vectors_enhanced_rerank_success_notify')
      .prop('checked', this.settings.rerank_success_notify)
      .on('input', () => {
        this.settings.rerank_success_notify = $('#vectors_enhanced_rerank_success_notify').prop('checked');
        this.updateAndSave();
      });
  }

  /**
   * 初始化 BM25 设置
   */
  initializeBM25Settings() {
    // 启用开关
    $('#vectors_enhanced_bm25_enabled')
      .prop('checked', this.settings.bm25_enabled || false)
      .on('input', () => {
        this.settings.bm25_enabled = $('#vectors_enhanced_bm25_enabled').prop('checked');
        this.updateAndSave();
      });

    // BM25 参数绑定 (k1, b, min_score)
    const bm25Params = [
      { key: 'bm25_k1', default: 1.2 },
      { key: 'bm25_b', default: 0.75 },
      { key: 'bm25_min_score', default: 0.01 }
    ];

    bm25Params.forEach(({ key, default: defaultVal }) => {
      if (this.settings[key] === undefined) this.settings[key] = defaultVal;

      const slider = $(`#vectors_enhanced_${key}`);
      const input = $(`#vectors_enhanced_${key}_input`);

      slider.val(this.settings[key]);
      input.val(this.settings[key]);

      slider.on('input', () => {
        const val = Number(slider.val());
        input.val(val);
        this.settings[key] = val;
        this.updateAndSave();
      });

      input.on('input', () => {
        const val = Number(input.val());
        slider.val(val);
        this.settings[key] = val;
        this.updateAndSave();
      });
    });

    // 复制 BM25 输出按钮
    $('#copy_bm25_output').on('click', () => {
      const text = $('#bm25_debug_output').val();
      if (text) navigator.clipboard.writeText(text);
    });

    // BM25 测试检索按钮
    $('#bm25_test_button').on('click', async () => {
      const statusEl = $('#bm25_test_status');
      try {
        // 获取最后一条消息
        const context = SillyTavern.getContext ? SillyTavern.getContext() : null;
        const chat = context?.chat || [];
        const lastMsg = [...chat].reverse().find(m => m.mes && m.mes.trim());
        if (!lastMsg) {
          statusEl.text('⚠️ 当前聊天为空').css('color', 'var(--SmartThemeQuoteColor)');
          return;
        }

        const testText = lastMsg.mes.slice(0, 500); // 截取前500字
        statusEl.text('🔄 检索中...').css('color', 'var(--SmartThemeEmColor)');

        // 调用后端
        const baseUrl = `http://${window.location.hostname}:8999`;
        const resp = await fetch(`${baseUrl}/hybrid_query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: testText,
            k: 5,
            collections: [],
            k1: this.settings.bm25_k1 ?? 1.2,
            b: this.settings.bm25_b ?? 0.75,
            min_score: this.settings.bm25_min_score ?? 0.01
          })
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        // 更新 debug UI
        $('#bm25_debug_tokens').text(data.debug?.query_tokens || '-');
        $('#bm25_debug_matches').text(data.debug?.fts_matches || 0);
        $('#bm25_debug_time').text(data.debug?.elapsed_ms || 0);
        const results = data.results || [];
        const preview = results
          .map((r, i) => `${i+1}. [${(r.score || 0).toFixed(3)}] ${(r.text || '')}`)
          .join('\n\n');
        $('#bm25_debug_output').val(preview || '无匹配结果');

        statusEl.text(`✅ 匹配 ${results.length} 条 (${data.debug?.elapsed_ms || 0}ms)`).css('color', 'var(--SmartThemeEmColor)');
      } catch (err) {
        console.error('[BM25 Test] Failed:', err);
        statusEl.text(`❌ 测试失败: ${err.message}`).css('color', 'var(--SmartThemeQuoteColor)');
      }
    });
  }

  /**
   * 初始化权重混合设置
   */
  initializeWeightMixing() {
    const defaults = { raw: 40, thought: 40, bm25: 20 };
    const sliders = ['raw', 'thought', 'bm25'];

    // 初始化默认值
    if (this.settings.weight_raw === undefined) this.settings.weight_raw = defaults.raw;
    if (this.settings.weight_thought === undefined) this.settings.weight_thought = defaults.thought;
    if (this.settings.weight_bm25 === undefined) this.settings.weight_bm25 = defaults.bm25;

    // 绑定滑块和输入框
    sliders.forEach(key => {
      const slider = $(`#vectors_enhanced_weight_${key}`);
      const input = $(`#vectors_enhanced_weight_${key}_input`);

      slider.val(this.settings[`weight_${key}`]);
      input.val(this.settings[`weight_${key}`]);

      // 滑块 → 输入框
      slider.on('input', () => {
        const val = Number(slider.val());
        input.val(val);
        this.settings[`weight_${key}`] = val;
        this.updateAndSave();
      });

      // 输入框 → 滑块
      input.on('input', () => {
        const val = Number(input.val());
        slider.val(val);
        this.settings[`weight_${key}`] = val;
        this.updateAndSave();
      });
    });

    // 自动归一化按钮
    $('#vectors_enhanced_weight_normalize').on('click', () => {
      const total = sliders.reduce((sum, k) => sum + (this.settings[`weight_${k}`] || 0), 0);
      if (total > 0) {
        sliders.forEach(key => {
          const normalized = Math.round((this.settings[`weight_${key}`] || 0) / total * 100);
          this.settings[`weight_${key}`] = normalized;
          $(`#vectors_enhanced_weight_${key}`).val(normalized);
          $(`#vectors_enhanced_weight_${key}_input`).val(normalized);
        });
        this.updateAndSave();
      }
    });

    // 恢复默认按钮
    $('#vectors_enhanced_weight_reset').on('click', () => {
      sliders.forEach(key => {
        this.settings[`weight_${key}`] = defaults[key];
        $(`#vectors_enhanced_weight_${key}`).val(defaults[key]);
        $(`#vectors_enhanced_weight_${key}_input`).val(defaults[key]);
      });
      this.updateAndSave();
    });
  }

  /**
   * 初始化查询设置
   */
  initializeQuerySettings() {
    // 启用向量查询
    $('#vectors_enhanced_enabled')
      .prop('checked', this.settings.enabled)
      .on('input', () => {
        this.settings.enabled = $('#vectors_enhanced_enabled').prop('checked');
        
        // 如果向量查询被禁用，同时禁用依赖的功能
        if (!this.settings.enabled) {
          // 禁用查询指令增强
          if (this.settings.query_instruction_enabled) {
            this.settings.query_instruction_enabled = false;
            $('#vectors_enhanced_query_instruction_enabled').prop('checked', false);
            $('#query_instruction_settings').slideUp();
          }
        }
        
        this.updateAndSave();
      });

    // 查询消息数
    $('#vectors_enhanced_query_messages')
      .val(this.settings.query_messages)
      .on('input', () => {
        this.settings.query_messages = Number($('#vectors_enhanced_query_messages').val());
        this.updateAndSave();
      });

    // 最大结果数
    $('#vectors_enhanced_max_results')
      .val(this.settings.max_results)
      .on('input', () => {
        this.settings.max_results = Number($('#vectors_enhanced_max_results').val());
        this.updateAndSave();
      });

    // 显示查询通知
    $('#vectors_enhanced_show_query_notification')
      .prop('checked', this.settings.show_query_notification)
      .on('input', () => {
        this.settings.show_query_notification = $('#vectors_enhanced_show_query_notification').prop('checked');
        this.updateAndSave();
        // 控制详细选项的显示/隐藏
        $('#vectors_enhanced_notification_details').toggle(this.settings.show_query_notification);
      });

    // 详细通知模式
    $('#vectors_enhanced_detailed_notification')
      .prop('checked', this.settings.detailed_notification)
      .on('input', () => {
        this.settings.detailed_notification = $('#vectors_enhanced_detailed_notification').prop('checked');
        this.updateAndSave();
      });
      
    // 初始化详细选项的显示状态
    $('#vectors_enhanced_notification_details').toggle(this.settings.show_query_notification);
  }

  /**
   * 初始化上下文压缩提纯设置
   */
  initializeCompressionSettings() {
    // 启用压缩
    $('#vectors_enhanced_compression_enabled')
      .prop('checked', this.settings.compression_enabled)
      .on('input', () => {
        this.settings.compression_enabled = $('#vectors_enhanced_compression_enabled').prop('checked');
        this.updateAndSave();
      });

    // API URL
    $('#vectors_enhanced_compression_url')
      .val(this.settings.compression_url || '')
      .on('input', () => {
        this.settings.compression_url = $('#vectors_enhanced_compression_url').val();
        this.updateAndSave();
      });

    // API Key
    $('#vectors_enhanced_compression_apiKey')
      .val(this.settings.compression_apiKey || '')
      .on('input', () => {
        this.settings.compression_apiKey = $('#vectors_enhanced_compression_apiKey').val();
        this.updateAndSave();
      });

    // Model
    $('#vectors_enhanced_compression_model')
      .val(this.settings.compression_model || '')
      .on('input', () => {
        this.settings.compression_model = $('#vectors_enhanced_compression_model').val();
        this.updateAndSave();
      });

    // Advanced LLM settings for Compression
    $('#vectors_enhanced_compression_temperature')
      .val(this.settings.compression_temperature !== undefined ? this.settings.compression_temperature : 0.7)
      .on('input', () => {
        this.settings.compression_temperature = Number($('#vectors_enhanced_compression_temperature').val());
        this.updateAndSave();
      });
      
    $('#vectors_enhanced_compression_max_tokens')
      .val(this.settings.compression_max_tokens !== undefined ? this.settings.compression_max_tokens : 4096)
      .on('input', () => {
        this.settings.compression_max_tokens = parseInt($('#vectors_enhanced_compression_max_tokens').val());
        this.updateAndSave();
      });

    $('#vectors_enhanced_compression_top_p')
      .val(this.settings.compression_top_p !== undefined ? this.settings.compression_top_p : 1.0)
      .on('input', () => {
        this.settings.compression_top_p = Number($('#vectors_enhanced_compression_top_p').val());
        this.updateAndSave();
      });

    $('#vectors_enhanced_compression_top_k')
      .val(this.settings.compression_top_k !== undefined ? this.settings.compression_top_k : 0)
      .on('input', () => {
        this.settings.compression_top_k = parseInt($('#vectors_enhanced_compression_top_k').val());
        this.updateAndSave();
      });

    $('#vectors_enhanced_compression_frequency_penalty')
      .val(this.settings.compression_frequency_penalty !== undefined ? this.settings.compression_frequency_penalty : 0)
      .on('input', () => {
        this.settings.compression_frequency_penalty = Number($('#vectors_enhanced_compression_frequency_penalty').val());
        this.updateAndSave();
      });

    $('#vectors_enhanced_compression_presence_penalty')
      .val(this.settings.compression_presence_penalty !== undefined ? this.settings.compression_presence_penalty : 0)
      .on('input', () => {
        this.settings.compression_presence_penalty = Number($('#vectors_enhanced_compression_presence_penalty').val());
        this.updateAndSave();
      });

    $('#vectors_enhanced_compression_reasoning_effort')
      .val(this.settings.compression_reasoning_effort || '')
      .on('change', () => {
        this.settings.compression_reasoning_effort = $('#vectors_enhanced_compression_reasoning_effort').val();
        this.updateAndSave();
      });

    // Proxy Toggle
    $('#vectors_enhanced_compression_use_proxy')
      .prop('checked', this.settings.compression_use_proxy)
      .on('input', () => {
        this.settings.compression_use_proxy = $('#vectors_enhanced_compression_use_proxy').prop('checked');
        this.updateAndSave();
      });

    // Context Messages Depth
    $('#vectors_enhanced_compression_context_messages')
      .val(this.settings.compression_context_messages)
      .on('input', () => {
        this.settings.compression_context_messages = Number($('#vectors_enhanced_compression_context_messages').val());
        this.updateAndSave();
      });

    // Batch Size
    $('#vectors_enhanced_compression_batch_size')
      .val(this.settings.compression_batch_size)
      .on('input', () => {
        this.settings.compression_batch_size = Number($('#vectors_enhanced_compression_batch_size').val());
        this.updateAndSave();
      });

    // System Prompt
    $('#vectors_enhanced_compression_prompt')
      .val(this.settings.compression_prompt || '')
      .on('input', () => {
        this.settings.compression_prompt = $('#vectors_enhanced_compression_prompt').val();
        this.updateAndSave();
      });
  }

  /**
   * 初始化内容选择设置
   */
  async initializeContentSelectionSettings() {
    const { updateFileList, updateWorldInfoList } = this.dependencies;

    // 聊天消息
    $('#vectors_enhanced_chat_enabled')
      .prop('checked', this.settings.selected_content.chat.enabled)
      .on('input', () => {
        this.settings.selected_content.chat.enabled = $('#vectors_enhanced_chat_enabled').prop('checked');
        this.updateAndSave();
        updateContentSelection(this.settings);
      });

    // 文件
    $('#vectors_enhanced_files_enabled')
      .prop('checked', this.settings.selected_content.files.enabled)
      .on('input', async () => {
        this.settings.selected_content.files.enabled = $('#vectors_enhanced_files_enabled').prop('checked');
        this.updateAndSave();
        updateContentSelection(this.settings);
        if (this.settings.selected_content.files.enabled) {
          await updateFileList();
        }
      });

    // 世界信息
    $('#vectors_enhanced_wi_enabled')
      .prop('checked', this.settings.selected_content.world_info.enabled)
      .on('input', async () => {
        this.settings.selected_content.world_info.enabled = $('#vectors_enhanced_wi_enabled').prop('checked');
        this.updateAndSave();
        updateContentSelection(this.settings);
        if (this.settings.selected_content.world_info.enabled) {
          await updateWorldInfoList();
        }
        // 渲染标签规则UI
        renderTagRulesUI();
      });

    // 聊天设置
    this.initializeChatSettings();

    // 刷新按钮
    // File and WI refresh are handled in ContentSelectionSettings.js
    // Removed duplicate bindings to prevent double updates
  }

  /**
   * 初始化聊天设置
   */
  initializeChatSettings() {
    // 确保所有属性都存在
    const chatRange = this.settings.selected_content.chat.range || { start: 0, end: -1 };
    const chatTypes = this.settings.selected_content.chat.types || { user: true, assistant: true };

    // 消息范围
    $('#vectors_enhanced_chat_start')
      .val(chatRange.start)
      .on('input', () => {
        if (!this.settings.selected_content.chat.range) {
          this.settings.selected_content.chat.range = { start: 0, end: -1 };
        }
        this.settings.selected_content.chat.range.start = Number($('#vectors_enhanced_chat_start').val());
        this.updateAndSave();
      });

    $('#vectors_enhanced_chat_end')
      .val(chatRange.end)
      .on('input', () => {
        if (!this.settings.selected_content.chat.range) {
          this.settings.selected_content.chat.range = { start: 0, end: -1 };
        }
        this.settings.selected_content.chat.range.end = Number($('#vectors_enhanced_chat_end').val());
        this.updateAndSave();
      });

    // 消息类型
    $('#vectors_enhanced_chat_user')
      .prop('checked', chatTypes.user)
      .on('input', () => {
        if (!this.settings.selected_content.chat.types) {
          this.settings.selected_content.chat.types = { user: true, assistant: true };
        }
        this.settings.selected_content.chat.types.user = $('#vectors_enhanced_chat_user').prop('checked');
        this.updateAndSave();
      });

    $('#vectors_enhanced_chat_assistant')
      .prop('checked', chatTypes.assistant)
      .on('input', () => {
        if (!this.settings.selected_content.chat.types) {
          this.settings.selected_content.chat.types = { user: true, assistant: true };
        }
        this.settings.selected_content.chat.types.assistant = $('#vectors_enhanced_chat_assistant').prop('checked');
        this.updateAndSave();
      });

    // 包含隐藏消息
    $('#vectors_enhanced_chat_include_hidden')
      .prop('checked', this.settings.selected_content.chat.include_hidden || false)
      .on('input', () => {
        if (!this.settings.selected_content.chat) {
          this.settings.selected_content.chat = {};
        }
        this.settings.selected_content.chat.include_hidden = $('#vectors_enhanced_chat_include_hidden').prop('checked');
        this.updateAndSave();
      });

    // 对第0层应用标签提取规则
    $('#vectors_enhanced_apply_tags_to_first_message')
      .prop('checked', this.settings.selected_content.chat.apply_tags_to_first_message || false)
      .on('input', () => {
        if (!this.settings.selected_content.chat) {
          this.settings.selected_content.chat = {};
        }
        this.settings.selected_content.chat.apply_tags_to_first_message = $('#vectors_enhanced_apply_tags_to_first_message').prop('checked');
        this.updateAndSave();
      });
  }

  /**
   * 初始化内容标签设置
   */
  initializeContentTagSettings() {
    // 确保向后兼容
    if (!this.settings.content_tags) {
      this.settings.content_tags = {
        chat: 'past_chat',
        file: 'databank',
        world_info: 'world_part',
      };
    }

    $('#vectors_enhanced_tag_chat')
      .val(this.settings.content_tags.chat)
      .on('input', () => {
        const value = $('#vectors_enhanced_tag_chat').val().trim() || 'past_chat';
        this.settings.content_tags.chat = value;
        this.updateAndSave();
      });

    $('#vectors_enhanced_tag_wi')
      .val(this.settings.content_tags.world_info)
      .on('input', () => {
        const value = $('#vectors_enhanced_tag_wi').val().trim() || 'world_part';
        this.settings.content_tags.world_info = value;
        this.updateAndSave();
      });

    $('#vectors_enhanced_tag_file')
      .val(this.settings.content_tags.file)
      .on('input', () => {
        const value = $('#vectors_enhanced_tag_file').val().trim() || 'databank';
        this.settings.content_tags.file = value;
        this.updateAndSave();
      });
  }

  /**
   * 初始化注入设置
   */
  initializeInjectionSettings() {
    // 初始化模板预设
    this.initializeTemplatePresets();
    
    // 模板
    $('#vectors_enhanced_template')
      .val(this.settings.template)
      .on('input', () => {
        this.settings.template = String($('#vectors_enhanced_template').val());
        this.updateAndSave();
        // 用户手动修改了模板，但保持当前预设选择（允许用户基于预设进行修改）
      });

    // 深度
    $('#vectors_enhanced_depth')
      .val(this.settings.depth)
      .on('input', () => {
        this.settings.depth = Number($('#vectors_enhanced_depth').val());
        this.updateAndSave();
      });

    // 位置
    $(`input[name="vectors_position"][value="${this.settings.position}"]`).prop('checked', true);
    $('input[name="vectors_position"]').on('change', () => {
      this.settings.position = Number($('input[name="vectors_position"]:checked').val());
      this.updateAndSave();
    });

    // 深度角色
    $('#vectors_enhanced_depth_role')
      .val(this.settings.depth_role)
      .on('change', () => {
        this.settings.depth_role = Number($('#vectors_enhanced_depth_role').val());
        this.updateAndSave();
      });

    // 包含世界信息
    $('#vectors_enhanced_include_wi')
      .prop('checked', this.settings.include_wi)
      .on('input', () => {
        this.settings.include_wi = $('#vectors_enhanced_include_wi').prop('checked');
        this.updateAndSave();
      });
  }

  /**
   * 初始化模板预设功能
   */
  initializeTemplatePresets() {
    // 确保设置中有预设数据
    if (!this.settings.template_presets) {
      this.settings.template_presets = {
        default: [
          {
            id: 'style',
            name: '文风参考',
            template: '<writing_style>请参考以下文风和写作风格：\n{{text}}</writing_style>',
            description: '用于导入小说时参考文风'
          },
          {
            id: 'setting',
            name: '设定参考',
            template: '<world_setting>以下是世界观和设定信息：\n{{text}}</world_setting>',
            description: '用于参考世界观设定'
          },
          {
            id: 'character',
            name: '人设参考',
            template: '<character_info>以下是相关角色的人物设定：\n{{text}}</character_info>',
            description: '用于参考人物设定'
          },
          {
            id: 'plot',
            name: '剧情体验',
            template: '<story_plot>以下是相关的剧情内容，请参考但不要直接照搬：\n{{text}}</story_plot>',
            description: '用于体验小说剧情'
          },
          {
            id: 'context',
            name: '上下文记录',
            template: '<new_context>注意：以下是新添加的重要上下文记录：\n{{text}}</new_context>',
            description: '强调是新添加的记录'
          }
        ],
        custom: [
          {
            id: 'custom1',
            name: '自定义模板1',
            template: '',
            description: '用户自定义模板'
          },
          {
            id: 'custom2',
            name: '自定义模板2',
            template: '',
            description: '用户自定义模板'
          },
          {
            id: 'custom3',
            name: '自定义模板3',
            template: '',
            description: '用户自定义模板'
          }
        ]
      };
      this.updateAndSave();
    }

    // 初始化自定义预设的显示
    this.updateCustomPresetOptions();

    // 设置当前选中的预设
    if (this.settings.active_preset_id) {
      $('#vectors_enhanced_template_preset').val(this.settings.active_preset_id);
      this.updateRenameButtonVisibility();
    }

    // 预设选择变化事件
    $('#vectors_enhanced_template_preset').on('change', () => {
      const selectedId = $('#vectors_enhanced_template_preset').val();
      if (selectedId) {
        this.applyPreset(selectedId);
      }
      this.updateRenameButtonVisibility();
    });

    // 重命名预设按钮事件
    $('#vectors_enhanced_rename_preset').on('click', async () => {
      try {
        await this.renameCustomPreset();
      } catch (error) {
        console.error('Error renaming preset:', error);
        if (typeof toastr !== 'undefined') {
          toastr.error('重命名失败: ' + error.message);
        }
      }
    });
  }

  /**
   * 应用预设模板
   * @param {string} presetId 预设ID
   */
  applyPreset(presetId) {
    // 查找预设
    let preset = this.settings.template_presets.default.find(p => p.id === presetId);
    if (!preset) {
      preset = this.settings.template_presets.custom.find(p => p.id === presetId);
    }

    if (preset) {
      // 应用模板
      $('#vectors_enhanced_template').val(preset.template);
      this.settings.template = preset.template;
      this.settings.active_preset_id = presetId;
      this.updateAndSave();
      
      // 如果是自定义模板，保存用户的修改
      if (presetId.startsWith('custom')) {
        $('#vectors_enhanced_template').off('input.custom').on('input.custom', () => {
          const newTemplate = $('#vectors_enhanced_template').val();
          preset.template = newTemplate;
          this.settings.template = newTemplate;
          this.updateAndSave();
        });
      } else {
        $('#vectors_enhanced_template').off('input.custom');
      }
    }
  }

  /**
   * 重命名自定义预设
   */
  async renameCustomPreset() {
    const selectedId = $('#vectors_enhanced_template_preset').val();
    if (!selectedId || !selectedId.startsWith('custom')) {
      return;
    }

    const preset = this.settings.template_presets.custom.find(p => p.id === selectedId);
    if (!preset) {
      return;
    }

    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = await import('../../../../../popup.js');
    
    // 使用 INPUT 类型，直接传入当前名称作为默认值
    const result = await callGenericPopup(
      '请输入新的模板名称：', 
      POPUP_TYPE.INPUT, 
      preset.name,  // 默认值
      { 
        okButton: '确定',
        cancelButton: '取消'
      }
    );

    if (result !== null && result !== false) {
      // INPUT 类型会直接返回输入的字符串值
      const newName = String(result).trim();
      
      if (!newName) {
        if (typeof toastr !== 'undefined') {
          toastr.warning('请输入新名称');
        }
        return;
      }

      // 更新名称
      preset.name = newName;

      // 更新UI并保存
      this.updateCustomPresetOptions();
      
      // 保持选中状态
      $('#vectors_enhanced_template_preset').val(selectedId);
      
      this.updateAndSave();

      if (typeof toastr !== 'undefined') {
        toastr.success(`已重命名为"${newName}"`);
      }
    }
  }

  // /**
  //  * 删除自定义预设 - 已弃用，改为固定3个自定义模板
  //  */
  // async deleteCustomPreset() {
  //   const selectedId = $('#vectors_enhanced_template_preset').val();
  //   if (!selectedId || !selectedId.startsWith('custom_')) {
  //     return;
  //   }

  //   const preset = this.settings.template_presets.custom.find(p => p.id === selectedId);
  //   if (!preset) {
  //     return;
  //   }

  //   const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = await import('../../../popup.js');
    
  //   const result = await callGenericPopup(
  //     `确定要删除预设"${preset.name}"吗？`,
  //     POPUP_TYPE.CONFIRM,
  //     '删除预设'
  //   );

  //   if (result === POPUP_RESULT.AFFIRMATIVE) {
  //     // 从列表中移除
  //     const index = this.settings.template_presets.custom.findIndex(p => p.id === selectedId);
  //     if (index !== -1) {
  //       this.settings.template_presets.custom.splice(index, 1);
  //     }

  //     // 重置选择
  //     $('#vectors_enhanced_template_preset').val('');
  //     this.settings.active_preset_id = null;
      
  //     // 更新UI
  //     this.updateCustomPresetOptions();
  //     this.updateRenameButtonVisibility();
  //     this.updateAndSave();

  //     if (typeof toastr !== 'undefined') {
  //       toastr.success(`预设"${preset.name}"已删除`);
  //     }
  //   }
  // }

  /**
   * 更新自定义预设选项
   */
  updateCustomPresetOptions() {
    const customGroup = $('#vectors_enhanced_custom_presets_group');
    customGroup.empty();

    // 总是显示自定义预设，包括默认的3个
    if (this.settings.template_presets && this.settings.template_presets.custom) {
      this.settings.template_presets.custom.forEach(preset => {
        const option = $('<option></option>')
          .attr('value', preset.id)
          .attr('title', preset.description || '')
          .text(preset.name);
        customGroup.append(option);
      });
    }
    customGroup.show();
  }

  /**
   * 更新重命名按钮的可见性
   */
  updateRenameButtonVisibility() {
    const selectedId = $('#vectors_enhanced_template_preset').val();
    const isCustom = selectedId && selectedId.startsWith('custom');
    $('#vectors_enhanced_rename_preset').toggle(isCustom);
  }

  /**
   * 初始化其他设置
   */
  initializeMiscellaneousSettings() {
    // 内容过滤黑名单
    $('#vectors_enhanced_content_blacklist')
      .val(Array.isArray(this.settings.content_blacklist) ? this.settings.content_blacklist.join('\n') : '')
      .on('input', () => {
        const blacklistText = $('#vectors_enhanced_content_blacklist').val();
        this.settings.content_blacklist = blacklistText
          .split('\n')
          .map(line => line.trim())
          .filter(line => line);
        this.updateAndSave();
      });
  }

  /**
   * 初始化UI状态
   */
  initializeUIState() {
    // 切换设置显示
    toggleSettings(this.settings);
    
    // 更新内容选择
    updateContentSelection(this.settings);
    
    // 更新聊天设置
    updateChatSettings();
    
    // 初始化通知详细选项的显示状态
    $('#vectors_enhanced_notification_details').toggle(this.settings.show_query_notification);
    
    // 隐藏进度条和重置按钮状态
    $('#vectors_enhanced_progress').hide();
    $('#vectors_enhanced_vectorize').show();
    $('#vectors_enhanced_abort').hide();
    
    // 重置进度条样式
    $('#vectors_enhanced_progress .progress-bar-inner').css('width', '0%');
    $('#vectors_enhanced_progress .progress-text').text('准备中...');
  }

  /**
   * 绑定其他事件
   */
  bindOtherEvents() {
    const { 
      toggleMessageRangeVisibility, 
      showTagExamples, 
      scanAndSuggestTags 
    } = this.dependencies;

    // 隐藏消息管理按钮
    $('#vectors_enhanced_hide_range').on('click', async () => {
      const start = Number($('#vectors_enhanced_chat_start').val()) || 0;
      const end = Number($('#vectors_enhanced_chat_end').val()) || -1;
      await toggleMessageRangeVisibility(start, end, true);
      MessageUI.updateHiddenMessagesInfo();
    });

    $('#vectors_enhanced_unhide_range').on('click', async () => {
      const start = Number($('#vectors_enhanced_chat_start').val()) || 0;
      const end = Number($('#vectors_enhanced_chat_end').val()) || -1;
      await toggleMessageRangeVisibility(start, end, false);
      MessageUI.updateHiddenMessagesInfo();
    });

    $('#vectors_enhanced_show_hidden').on('click', async () => {
      await MessageUI.showHiddenMessages();
    });

    // 标签相关按钮
    $('#vectors_enhanced_tag_examples').on('click', async () => {
      await showTagExamples();
    });

    $('#vectors_enhanced_tag_scanner').on('click', async () => {
      await scanAndSuggestTags();
    });

    // 添加新规则按钮
    $('#vectors_enhanced_add_rule').on('click', () => {
      if (!this.settings.selected_content.chat.tag_rules) {
        this.settings.selected_content.chat.tag_rules = [];
      }
      this.settings.selected_content.chat.tag_rules.push({
        type: 'include',
        value: '',
        enabled: true,
      });
      this.updateAndSave();
      renderTagRulesUI();
    });

    // 清除标签建议按钮
    $('#vectors_enhanced_clear_suggestions').on('click', () => {
      clearTagSuggestions();
    });

    // 排除小CoT按钮
    $('#vectors_enhanced_exclude_cot').on('click', () => {
      if (!this.settings.selected_content.chat.tag_rules) {
        this.settings.selected_content.chat.tag_rules = [];
      }

      const cotRule = {
        type: 'regex_exclude',
        value: '<!--[\\s\\S]*?-->',
        enabled: true,
      };

      const alreadyExists = this.settings.selected_content.chat.tag_rules.some(
        rule => rule.type === cotRule.type && rule.value === cotRule.value
      );

      if (alreadyExists) {
        toastr.info('已存在排除HTML注释的规则。');
        return;
      }

      this.settings.selected_content.chat.tag_rules.push(cotRule);
      this.updateAndSave();
      renderTagRulesUI();
      toastr.success('已添加规则：排除HTML注释');
    });

    // 掉格式兼容按钮
    $('#vectors_enhanced_format_fix').on('click', async () => {
      if (!this.settings.selected_content.chat.tag_rules) {
        this.settings.selected_content.chat.tag_rules = [];
      }

      // 弹出输入框询问标签名称
      const { callGenericPopup, POPUP_TYPE } = this.dependencies;
      const tagName = await callGenericPopup(
        '请输入要保留的标签名称（如 content）：',
        POPUP_TYPE.INPUT,
        'content',
        {
          okButton: '确认',
          cancelButton: '取消',
        }
      );

      if (!tagName || !tagName.trim()) {
        return;
      }

      const formatFixRule = {
        type: 'regex_exclude',
        value: `^[\\s\\S]*?<${tagName.trim()}>`,
        enabled: true,
      };

      const alreadyExists = this.settings.selected_content.chat.tag_rules.some(
        rule => rule.type === formatFixRule.type && rule.value === formatFixRule.value
      );

      if (alreadyExists) {
        toastr.info(`已存在删除 <${tagName}> 之前内容的规则。`);
        return;
      }

      this.settings.selected_content.chat.tag_rules.push(formatFixRule);
      this.updateAndSave();
      renderTagRulesUI();
      toastr.success(`已添加规则：删除 <${tagName}> 标签之前的所有内容`);
    });

    // 初始化标签预设管理器
    tagPresetManager.initializeEventHandlers();
  }

  /**
   * 更新设置并保存
   */
  updateAndSave() {
    const { extension_settings, saveSettingsDebounced } = this.dependencies;
    // 使用深度合并以保留嵌套对象
    this.deepMerge(extension_settings.vectors_enhanced, this.settings);
    saveSettingsDebounced();
  }
  
  /**
   * 深度合并工具函数
   */
  deepMerge(target, source) {
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          if (!target[key] || typeof target[key] !== 'object') {
            target[key] = {};
          }
          this.deepMerge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    }
    return target;
  }

  /**
   * 初始化列表（如果启用）
   */
  async initializeLists() {
    const { updateFileList, updateWorldInfoList } = this.dependencies;

    if (this.settings.selected_content.files.enabled) {
      await updateFileList();
    }
    if (this.settings.selected_content.world_info.enabled) {
      await updateWorldInfoList();
    }
  }

  /**
   * 初始化任务列表
   */
  async initializeTaskList() {
    const { getChatTasks, renameVectorTask, removeVectorTask } = this.dependencies;
    await updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);
  }

  /**
   * 初始化记忆管理UI
   */
  async initializeMemoryUI() {
    const { getContext, toastr } = this.dependencies;
    
    // 创建记忆服务
    this.memoryService = new MemoryService({
      getContext,
      eventBus,
      getRequestHeaders: this.dependencies.getRequestHeaders
    });
    
    // 创建并初始化MemoryUI组件
    this.memoryUI = new MemoryUI({
      memoryService: this.memoryService,
      toastr,
      eventBus,
      getContext,
      oai_settings: this.dependencies.oai_settings,
      settings: this.settings, // 传入settings引用
      saveSettingsDebounced: this.dependencies.saveSettingsDebounced, // 传入保存函数
      setExtensionPrompt: this.dependencies.setExtensionPrompt, // 传入注入API
      substituteParamsExtended: this.dependencies.substituteParamsExtended, // 传入模板替换API
      generateRaw: this.dependencies.generateRaw, // 传入generateRaw API
      eventSource: this.dependencies.eventSource || window.eventSource, // 传入eventSource
      event_types: this.dependencies.event_types || window.event_types, // 传入event_types
      saveChatConditional: this.dependencies.saveChatConditional, // 传入saveChatConditional
      chat_metadata: this.dependencies.chat_metadata, // 传入chat_metadata
      saveChatDebounced: this.dependencies.saveChatDebounced // 传入saveChatDebounced
    });
    
    await this.memoryUI.init();
    
    // 暴露到全局作用域以便测试
    window.vectorsMemoryUI = this.memoryUI;
  }
  
  /**
   * 初始化实验性设置
   * 注：use_pipeline 开关已移除 —— 文本处理管道在向量化流程中是无条件运行的，
   * 该设置从未被任何代码消费，保留只会造成"配置了没反应"的困惑。
   */
  initializeExperimentalSettings() {
    // 预留：后续实验性设置在此绑定
  }

  /**
   * 初始化外挂任务UI
   */
  async initializeExternalTaskUI() {
    try {
      // 动态导入ExternalTaskUI - 优先相对路径（兼容子路径部署），失败再退回绝对路径
      let { ExternalTaskUI } = await import('./components/ExternalTaskUI.js').catch(() => ({}));
      if (!ExternalTaskUI) {
        ({ ExternalTaskUI } = await import('/scripts/extensions/third-party/ArcFess/src/ui/components/ExternalTaskUI.js'));
      }
      
      // 创建并初始化外挂任务UI
      const externalTaskUI = new ExternalTaskUI();
      
      // 使用 null 作为 taskManager（已移除）
      // 传入 null、settings 和 dependencies 对象
      await externalTaskUI.init(null, this.settings, this.dependencies);
        
        // 监听聊天切换事件以更新外挂任务列表
        if (window.eventSource) {
          window.eventSource.on('chatLoaded', async (chatId) => {
            await externalTaskUI.updateChatContext(chatId);
          });
        }
        
        // 初始更新
        try {
          const currentChatId = window.getContext?.()?.chatId;
          if (currentChatId && currentChatId !== 'null' && currentChatId !== 'undefined') {
            await externalTaskUI.updateChatContext(currentChatId);
          }
        } catch (error) {
          console.warn('Failed to get current chat context:', error);
        }
        
        // 保存引用以便后续使用
        this.externalTaskUI = externalTaskUI;
        
        console.log('External Task UI initialized successfully (legacy mode)');
    } catch (error) {
      console.error('Failed to initialize External Task UI:', error);
    }
  }

  /**
   * 初始化向量存储路径UI
   */
  async initializeVectorStoragePathUI() {
    try {
      // 动态导入VectorStoragePathUI - 优先相对路径（兼容子路径部署），失败再退回绝对路径
      let { VectorStoragePathUI } = await import('./components/VectorStoragePathUI.js').catch(() => ({}));
      if (!VectorStoragePathUI) {
        ({ VectorStoragePathUI } = await import('/scripts/extensions/third-party/ArcFess/src/ui/components/VectorStoragePathUI.js'));
      }
      
      // 创建并初始化向量存储路径UI
      const vectorStoragePathUI = new VectorStoragePathUI();
      
      // 传入settings对象
      await vectorStoragePathUI.init(this.settings);
        
      // 保存引用以便后续使用
      this.vectorStoragePathUI = vectorStoragePathUI;
        
      console.log('Vector Storage Path UI initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Vector Storage Path UI:', error);
    }
  }
}
