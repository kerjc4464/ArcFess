// @ts-nocheck
import {
  eventSource,
  event_types,
  extension_prompt_roles,
  extension_prompt_types,
  getCurrentChatId,
  getRequestHeaders,
  is_send_press,
  saveSettingsDebounced,
  setExtensionPrompt,
  substituteParams,
  substituteParamsExtended,
  generateRaw,
  saveChatConditional,
  chat_metadata,
  saveChatDebounced,
} from '../../../../script.js';
import { getDataBankAttachments, getDataBankAttachmentsForSource, getFileAttachment } from '../../../chats.js';
import { debounce_timeout } from '../../../constants.js';
import {
  ModuleWorkerWrapper,
  extension_settings,
  getContext,
  renderExtensionTemplateAsync,
} from '../../../extensions.js';
import { oai_settings } from '../../../openai.js';
import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from '../../../popup.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { textgen_types, textgenerationwebui_settings } from '../../../textgen-settings.js';
import {
  debounce,
  getStringHash,
  onlyUnique,
  waitUntilCondition,
} from '../../../utils.js';
import { getSortedEntries, saveWorldInfo, loadWorldInfo } from '../../../world-info.js';
import { shouldSkipContent } from './src/utils/contentFilter.js';
import { extractTagContent, extractSimpleTag, extractComplexTag, extractHtmlFormatTag } from './src/utils/tagExtractor.js';
import { scanTextForTags, generateTagSuggestions } from './src/utils/tagScanner.js';
import { updateMasterSwitchState as updateMasterSwitchStateNew, hideProgress as hideProgressNew, updateProgress as updateProgressNew, triggerDownload } from './src/ui/domUtils.js';
import { SettingsManager } from './src/ui/settingsManager.js';
import { ConfigManager } from './src/infrastructure/ConfigManager.js';
import { updateChatSettings } from './src/ui/components/ChatSettings.js';
import { renderTagRulesUI } from './src/ui/components/TagRulesEditor.js';
import { updateTaskList } from './src/ui/components/TaskList.js';
import { updateFileList } from './src/ui/components/FileList.js';
import { updateWorldInfoList } from './src/ui/components/WorldInfoList.js';
import { clearTagSuggestions, displayTagSuggestions, showTagExamples } from './src/ui/components/TagUI.js';
import { MessageUI } from './src/ui/components/MessageUI.js';
import { ActionButtons } from './src/ui/components/ActionButtons.js';
import { SettingsPanel } from './src/ui/components/SettingsPanel.js';
import { VectorizationSettings } from './src/ui/components/VectorizationSettings.js';
import { QuerySettings } from './src/ui/components/QuerySettings.js';
import { ContentSelectionSettings } from './src/ui/components/ContentSelectionSettings.js';
import { ProgressManager } from './src/ui/components/ProgressManager.js';
import { EventManager } from './src/ui/EventManager.js';
import { StateManager } from './src/ui/StateManager.js';
import { getMessages, createVectorItem, getHiddenMessages, getTextWithoutAttachments } from './src/utils/chatUtils.js';
import { StorageAdapter } from './src/infrastructure/storage/StorageAdapter.js';
import { VectorizationAdapter } from './src/infrastructure/api/VectorizationAdapter.js';
import { eventBus } from './src/infrastructure/events/eventBus.instance.js';
import { RerankService } from './src/services/rerank/index.js';
/**
 * 辅助函数：从全局设置中提取纯净的向量化参数，剔除任务列表防止递归爆炸
 * (这是解决 "Settings could not be saved" 的关键)
 */
function getCleanSettings(settings) {
    const clean = { ...settings };
    // 移除巨大的任务列表引用
    if (clean.vector_tasks) delete clean.vector_tasks; 
    // 移除其他可能导致循环引用的字段
    if (clean.content_tags) delete clean.content_tags;
    return clean;
}
/**
 * @typedef {object} HashedMessage
 * @property {string} text - The hashed message text
 * @property {number} hash - The hash used as the vector key
 * @property {number} index - The index of the message in the chat
 */

/**
 * @typedef {object} VectorItem
 * @property {string} type - Type of the item ('chat', 'file', 'world_info')
 * @property {string} text - The text content
 * @property {Object} metadata - Additional metadata for the item
 * @property {boolean} selected - Whether the item is selected for vectorization
 */

window.saveSettingsDebounced = saveSettingsDebounced;
window.extension_settings = extension_settings; // [新增] 打通外挂管理器的数据桥梁

const MODULE_NAME = 'ArcFess';

export const EXTENSION_PROMPT_TAG = '3_vectors_enhanced';
export const MEMORY_EXTENSION_TAG = '4_memory';

// 保存最后注入的内容，供预览功能使用
let lastInjectedContent = null;
let lastInjectedStats = null;
let lastQueryDetails = null; // 保存查询的详细信息，包括重排前后的数据

// --- 执行锁相关变量 ---
let isQuerying = false;          // 标记是否正在检索
let lastQueryTimestamp = 0;      // 记录上次成功触发的时间戳
const QUERY_COOLDOWN = 1500;     // 冷却时间设为 1.5 秒


// Global ActionButtons instance (initialized in jQuery ready)
let globalActionButtons = null;

// Global SettingsPanel instance (initialized in jQuery ready)
let globalSettingsPanel = null;

// Global UI infrastructure instances (initialized in jQuery ready)
let globalProgressManager = null;
let globalEventManager = null;
let globalStateManager = null;
let globalSettingsManager = null;

const settings = {
  // Master switch - controls all plugin functionality
  master_enabled: true, // 主开关：控制整个插件的所有功能，默认启用
  realtime_sync_enabled: false, // 实时增量同步开关
  realtime_sync_user: true, // 同步用户消息
  realtime_sync_assistant: true, // 同步AI消息
  realtime_sync_hidden: false, // 同步隐藏消息
  realtime_retrieval_enabled: true, // 启用实时记忆检索
  realtime_quota: 5, // 实时专属保底
  realtime_boost: 1.0, // 实时专属倍率

  // Hierarchical Realtime Engine settings
  ve_hierarchical_floor_enabled: false,
  ve_hierarchical_floor_trigger: 30,
  ve_hierarchical_date_enabled: false,
  ve_hierarchical_date_tag: "<ArcTime:\\s*(.*?)\\s*>",
  ve_hierarchical_inject_date_rule: true,
  ve_hierarchical_big_trigger: 4,
  ve_hierarchical_inject_count: 5,
  ve_hierarchical_prompt: "请总结以下内容的剧情发展，保留关键细节，字数不要超过100字。",
  ve_hierarchical_big_prompt: "请根据以下数个子事件，总结提炼出这一阶段整体的情节大纲，字数不要超过200字。",
  ve_hierarchical_manager_prompt_r1: '你是一个记忆总管。根据用户目前输入，若需要查询历史记忆来辅助回答，请大结目录中挑选出一个或数个最相关的大结名称或小结名称，并以如下JSON数组格式返回：[{"target": "大结的名称或ID", "reason": "原因"}...]。如果不需要查询，请直接回复空数组 []。绝对不要返回除JSON以外的其他废话。',
  ve_hierarchical_manager_prompt_r2: '你已经锁定了目标大结，现在请在以下子事件中，挑选出最相关的几个具体小结，并为每一个小结提供具体的相似检索词数组用于执行精确检索。必须严格以如下JSON格式返回：[{"target": "小结ID", "queries": ["关键词1", "关键词2"]}...]。绝对不能回复其他废话。',
  ve_summary_api_type: "main",
  ve_summary_api_url: "",
  ve_summary_api_key: "",
  ve_summary_api_model: "",
  ve_manager_api_type: "main",
  ve_manager_api_url: "",
  ve_manager_api_key: "",
  ve_manager_api_model: "",

  // Vector source settings
  source: 'transformers',
  local_model: '', // 本地transformers模型名称
  vllm_model: '',
  vllm_url: '',
  vllm_api_key: '', // vLLM API key
  ollama_model: 'rjmalagon/gte-qwen2-1.5b-instruct-embed-f16',
  ollama_url: '', // ollama API地址
  ollama_keep: false,
  openai_model: 'BAAI/bge-m3',
  openai_url: 'https://api.siliconflow.cn/v1',
  openai_api_key: '', // OpenAI API key

  // General vectorization settings
  chunk_size: 768,
  overlap_percent: 0,
  score_threshold: 0.25,
  safety_floor: 0.05, // 🛡️ 新增：保底熔断阈值
  allow_quota_overflow: true, // 🛡️ 新增：允许配额超标
  gen_batch_size: 6, // 🟢 新增：默认批次大小
  force_chunk_delimiter: '',
  // lightweight_storage: 已移除，所有文本都存储在向量数据库中

  // Query settings
  enabled: true, // 是否启用向量查询
  query_messages: 3, // 查询使用的最近消息数
  max_results: 10, // 返回的最大结果数
  show_query_notification: false, // 是否显示查询结果通知
  detailed_notification: false, // 是否显示详细通知（来源分布）

  // Rerank settings
  rerank_enabled: false,
  rerank_url: 'https://api.siliconflow.cn/v1/rerank',
  rerank_apiKey: '',
  rerank_model: 'Pro/BAAI/bge-reranker-v2-m3',
  rerank_top_n: 20,
  rerank_hybrid_alpha: 1.0, // Rerank score weight (v7.1: pure reranker, no hybrid)
  rerank_success_notify: true, // 是否显示Rerank成功通知
  rerank_use_proxy: true, // Rerank 走后端代理解决 CORS

  // Thought Engine settings
  thought_engine_enabled: false,
  thought_engine_use_proxy: true,
  thought_engine_proxy_url: '',
  thought_engine_url: 'https://api.siliconflow.cn/v1/chat/completions',
  thought_engine_apiKey: '',
  thought_engine_auth_type: 'bearer',
  thought_engine_model: 'Qwen/Qwen2.5-7B-Instruct',
  thought_engine_timeout: 90,
  thought_engine_max_tokens: 4096,
  thought_engine_temperature: 0.9,
  thought_engine_top_p: 1.0,
  thought_engine_top_k: 0,
  thought_engine_frequency_penalty: 0,
  thought_engine_presence_penalty: 0,
  thought_engine_reasoning_effort: '',
  thought_engine_context_size: 3,
  thought_engine_prompt: '你是一个记忆检索分析中枢。请按以下步骤思考，最后输出检索关键词：\n\n第一步-场景识别：分析最近对话中的时间/地点/角色状态/情节走向\n第二步-意图推断：基于场景，推断用户深层需求（创作方向/情感倾向/剧情预期）\n第三步-关键词输出：将意图转化为精确的向量检索关键词\n\n严格按格式输出（不要加任何额外解释）：\n场景：... | 意图：... | 关键词：关键词1 关键词2 关键词3\n\n最近对话：\n{{chat_history}}',

  // v7.1 Thought Engine modes
  thought_engine_mode: 'cot', // 'cot' | 'multi_call'
  thought_engine_content_mode: 'strip_think', // 'strip_think' | 'content_only' | 'raw'
  thought_engine_step1_prompt: '分析以下对话的场景与上下文（时间、地点、角色状态、情节走向）。只输出简洁的场景描述，不超过100字。\n\n{{chat_history}}',
  thought_engine_step2_prompt: '基于以下场景分析，推断用户的深层意图和需求（创作方向、情感倾向、剧情预期）。只输出意图描述，不超过100字。\n\n场景分析：{{scene_analysis}}\n\n对话：{{chat_history}}',
  thought_engine_step3_prompt: '基于以下完整分析，将意图转化为精确的向量检索关键词（实体名、动作、情感、设定等）。只输出关键词，用空格分隔，不超过30字。\n\n场景：{{scene_analysis}}\n意图：{{intent_analysis}}\n\n对话：{{chat_history}}',

  // v7.2 Per-Step custom API override (multi_call mode)
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

  // v7.3 重试设置（Agent模式多步调用容错）
  thought_engine_retry_enabled: true,
  thought_engine_retry_count: 3,
  thought_engine_retry_delay: 1000,

  // 双支混合参数
  sense_reason_ratio: 0.6, // α: 理性分支在截断池中的配额比例 (0=全感性, 1=全理性)
  // pre_rerank_limit → 统一使用 rerank_top_n

  // Experimental settings
  query_instruction_enabled: false, // Enable query instruction
  query_instruction_template: 'Given a query, retrieve relevant passages from the context. Consider all available metadata including floor (chronological position), world info entries, and chapter/section markers to ensure comprehensive retrieval.', // Query instruction template
  query_instruction_preset: 'general', // Current selected preset
  query_instruction_presets: {
    character: 'Given a character-related query, retrieve passages that describe character traits, personality, relationships, or actions. Consider metadata such as floor (chronological position), world info entries, and chapter markers when evaluating relevance.',
    plot: 'Given a story context, retrieve passages that contain plot-relevant details, foreshadowing, or significant events. Pay attention to metadata including floor numbers (temporal ordering), chapter divisions, and world book entries for contextual relevance.',
    worldview: 'Given a world-building query, retrieve passages that contain setting details, lore information, or world mechanics. Utilize metadata like world info entry names, chapter context, and chronological floor positions to identify relevant content.',
    writing_style: 'Given a writing style query, retrieve passages that exemplify narrative techniques, prose style, or linguistic patterns. Consider metadata such as chapter markers and floor positions to understand stylistic evolution throughout the narrative.',
    general: 'Given a query, retrieve relevant passages from the context. Consider all available metadata including floor (chronological position), world info entries, and chapter/section markers to ensure comprehensive retrieval.'
  },
  rerank_deduplication_enabled: false, // Enable Rerank deduplication
  rerank_deduplication_instruction: 'Execute the following operations:\n1. Sort documents by relevance in descending order\n2. Consider documents as duplicates if they meet ANY of these conditions:\n   - Core content overlap exceeds 60% (reduced from 80% for better precision)\n   - Contains identical continuous passages of 5+ words\n   - Shares the same examples, data points, or evidence\n3. When evaluating duplication, consider metadata differences:\n   - Different originalIndex values indicate temporal separation\n   - Different chunk numbers (chunk=X/Y) from the same entry should be preserved\n   - Different floor numbers represent different chronological positions\n   - Different world info entries or chapter markers indicate distinct contexts\n4. For identified duplicates, keep only the most relevant one, demote others to bottom 30% positions (reduced from 50% for gentler deduplication)', // Rerank deduplication instruction

  // Contextual Compression (LLM Summarization)
  compression_enabled: false,
  compression_url: 'https://api.groq.com/openai/v1/chat/completions',
  compression_apiKey: '',
  compression_model: 'llama3-8b-8192',
  compression_temperature: 0.7,
  compression_max_tokens: 4096,
  compression_top_p: 1.0,
  compression_top_k: 0,
  compression_frequency_penalty: 0,
  compression_presence_penalty: 0,
  compression_reasoning_effort: '',
  compression_context_messages: 3,
  compression_batch_size: 5,
  compression_use_proxy: false,
  compression_prompt: '你是一个精准的记忆过滤中枢。请判断下面的历史记忆是否对当前对话有帮助。如果有，请提取并总结其最核心的内容（至少150字），请务必在总结的最开头保留原记忆发生的时间日期等元数据（如[2026-xx-xx]）；如果完全无关，请仅输出“【丢弃】”二字。',

  // Injection settings
  template: '<recalled_memories>\n以下是从记忆库检索到的相关片段，已按语义相关性从高到低排列。\n请从中选择最自然、贴合上下文的引用融入回复，不要求全部引用：\n\n{{text}}\n</recalled_memories>',
  position: extension_prompt_types.IN_PROMPT,
  depth: 2,
  depth_role: extension_prompt_roles.SYSTEM,
  include_wi: false,

  // Template presets
  template_presets: {
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
  },
  active_preset_id: null,

  // Content tags
  content_tags: {
    chat: 'past_chat',
    file: 'databank',
    world_info: 'world_part',
  },

  // Content selection
  selected_content: {
    chat: {
      enabled: false,
      range: { start: 0, end: -1 },
      types: { user: true, assistant: true },
      tag_rules: [], // structured tag rules
      include_hidden: false, // 是否包含隐藏消息
    },
    files: { enabled: false, selected: [] },
    world_info: { enabled: false, selected: {} }, // { worldId: [entryIds] }
  },

  // Content filtering
  content_blacklist: [], // Array of keywords to filter out content

  // Vector tasks management
  vector_tasks: {}, // { chatId: [{ taskId, name, timestamp, settings, enabled }] }
  tag_rules_version: 2,

  // Memory management settings
  memory: {
    source: 'google_openai', // 默认使用 Google（与模板下拉选项一致，'main' 不是合法值）
    use_backend_proxy: true, // 默认走后端代理解决 CORS
    proxy_url: '',
    detailLevel: 'normal', // 默认详细程度
    maxTokens: 8192, // 默认最大token数
    google: {
      model: ''
    },
    openai_compatible: {
      url: '',
      model: ''
    },
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
...`
  },

};

const moduleWorker = new ModuleWorkerWrapper(synchronizeChat);

/**
 * LRU Cache with size limit
 * Extends Map to maintain full API compatibility while evicting oldest entries
 */
class LRUCache extends Map {
    constructor(maxSize) {
        super();
        this.maxSize = maxSize;
    }
    set(key, value) {
        const existed = this.delete(key);
        if (!existed && this.size >= this.maxSize) {
            this.delete(this.keys().next().value);
        }
        super.set(key, value);
    }
}
const cachedVectors = new LRUCache(50); // Cache for vectorized content, max 50 entries
let syncBlocked = false;

// 创建存储适配器实例
let storageAdapter = null;
// 创建向量化适配器实例
let vectorizationAdapter = null;
// 创建 Rerank 服务实例
let rerankService = null;

// 防重复通知机制
let lastNotificationTime = 0;
const NOTIFICATION_COOLDOWN = 5000; // 5秒冷却时间
let lastRerankNotifyTime = 0;

// 向量化状态管理
let isVectorizing = false;
let vectorizationAbortController = null;

/**
 * Deep merge utility function
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object} Merged object
 */
function deepMerge(target, source) {
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key] || typeof target[key] !== 'object') {
          target[key] = {};
        }
        deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
  return target;
}

/**
 * Generates a unique task ID
 * @returns {string} Unique task ID
 */
function generateTaskId() {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Gets all vector tasks for a chat
 * @param {string} chatId Chat ID
 * @returns {Array} Array of tasks
 */
function getChatTasks(chatId) {
  if (!chatId || chatId === 'null' || chatId === 'undefined') {
    console.warn('Vectors: getChatTasks called with invalid chatId:', chatId);
    return [];
  }
  if (!settings.vector_tasks[chatId]) {
    settings.vector_tasks[chatId] = [];
  }
  return settings.vector_tasks[chatId];
}

/**
 * Adds a new vector task
 * @param {string} chatId Chat ID
 * @param {object} task Task object
 */
function addVectorTask(chatId, task) {
  if (!chatId || chatId === 'null' || chatId === 'undefined') {
    console.error('Vectors: addVectorTask called with invalid chatId:', chatId);
    return;
  }
  const tasks = getChatTasks(chatId);
  tasks.push(task);
  settings.vector_tasks[chatId] = tasks;

  deepMerge(extension_settings.vectors_enhanced, settings);
  saveSettingsDebounced();
}

/**
 * Removes a vector task
 * @param {string} chatId Chat ID
 * @param {string} taskId Task ID to remove
 */
async function removeVectorTask(chatId, taskId) {
  if (!chatId || chatId === 'null' || chatId === 'undefined') {
    console.error('Vectors: removeVectorTask called with invalid chatId:', chatId);
    return;
  }
  const tasks = getChatTasks(chatId);
  const index = tasks.findIndex(t => t.taskId === taskId);
  if (index !== -1) {
    // === 修复开始：使用 TaskID 物理删除 ===
    try {
        await storageAdapter.deleteTask(taskId);
        
        // 清理内存缓存
        const collectionId = `${chatId}_${taskId}`;
        if (cachedVectors && cachedVectors.has(collectionId)) {
            cachedVectors.delete(collectionId);
        }
    } catch (e) {
        console.error("Task deletion failed:", e);
    }
    // === 修复结束 ===

    // Remove from tasks list
    tasks.splice(index, 1);
    settings.vector_tasks[chatId] = tasks;

    // === 新增：清理引用此任务的所有外挂任务 ===
    let externalCleaned = 0;
    for (const [otherChatId, otherTasks] of Object.entries(settings.vector_tasks)) {
        if (!Array.isArray(otherTasks)) continue;
        const beforeCount = otherTasks.length;
        const filtered = otherTasks.filter(t => !(t.type === 'external' && t.sourceTaskId === taskId));
        if (filtered.length !== beforeCount) {
            settings.vector_tasks[otherChatId] = filtered;
            externalCleaned += (beforeCount - filtered.length);
        }
    }
    if (externalCleaned > 0) {
        console.log(`Vectors: Removed ${externalCleaned} external task reference(s) pointing to deleted task ${taskId}`);
    }
    // === 新增结束 ===

    Object.assign(extension_settings.vectors_enhanced, settings);
    saveSettingsDebounced();
  }
}

/**
 * Renames a vector task
 * @param {string} chatId Chat ID
 * @param {string} taskId Task ID to rename
 * @param {string} currentName Current task name
 */
async function renameVectorTask(chatId, taskId, currentName) {
  // Try to generate a smart name as default if we have task data
  let defaultName = currentName;
  const tasks = getChatTasks(chatId);
  const task = tasks.find(t => t.taskId === taskId);

  if (task && task.actualProcessedItems && (task.actualProcessedItems.chat || task.actualProcessedItems.files || task.actualProcessedItems.world_info)) {
    // Import TaskNameGenerator
    const { TaskNameGenerator } = await import('./src/utils/taskNaming.js');

    // Construct items for name generation
    const items = [];

    // Add chat items
    if (task.actualProcessedItems.chat) {
      task.actualProcessedItems.chat.forEach(index => {
        items.push({
          type: 'chat',
          metadata: { index: index, is_user: index % 2 === 1 }
        });
      });
    }

    // Generate smart name as default
    defaultName = TaskNameGenerator.generateSmartName(items, task.settings);
  }

  const newName = await callGenericPopup(
    '请输入新的任务名称：',
    POPUP_TYPE.INPUT,
    defaultName,
    {
      okButton: '确认',
      cancelButton: '取消',
    }
  );

  if (newName && newName.trim() && newName.trim() !== currentName) {
    const taskIndex = tasks.findIndex(t => t.taskId === taskId);

    if (taskIndex !== -1) {
      console.log('[Vectors] Renaming task:', {
        chatId,
        taskId,
        oldName: currentName,
        newName: newName.trim(),
        taskIndex,
        task: tasks[taskIndex]
      });

      tasks[taskIndex].name = newName.trim();
      tasks[taskIndex].isCustomName = true; // 标记为用户自定义名称
      settings.vector_tasks[chatId] = tasks;

      // 确保 extension_settings.vectors_enhanced 存在
      if (!extension_settings.vectors_enhanced) {
        extension_settings.vectors_enhanced = {};
      }

      Object.assign(extension_settings.vectors_enhanced, settings);
      saveSettingsDebounced();

      console.log('[Vectors] After rename:', {
        taskName: tasks[taskIndex].name,
        settingsTaskName: settings.vector_tasks[chatId][taskIndex].name,
        extensionSettingsTaskName: extension_settings.vectors_enhanced?.vector_tasks?.[chatId]?.[taskIndex]?.name
      });

      // Refresh the task list UI
      await updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);
      toastr.success('任务已重命名');
    }
  }
}

/**
 * Gets the Collection ID for a file embedded in the chat.
 * @param {string} fileUrl URL of the file
 * @returns {string} Collection ID
 */
function getFileCollectionId(fileUrl) {
  return `file_${getHashValue(fileUrl)}`;
}


/**
 * Gets all available files from different sources
 * @returns {Map<string, object>} Map of file URL to file object
 */
function getAllAvailableFiles() {
  const fileMap = new Map();
  const context = getContext();

  try {
    // Add files from different sources
    getDataBankAttachments().forEach(file => {
      if (file && file.url) fileMap.set(file.url, file);
    });

    getDataBankAttachmentsForSource('global').forEach(file => {
      if (file && file.url) fileMap.set(file.url, file);
    });

    getDataBankAttachmentsForSource('character').forEach(file => {
      if (file && file.url) fileMap.set(file.url, file);
    });

    getDataBankAttachmentsForSource('chat').forEach(file => {
      if (file && file.url) fileMap.set(file.url, file);
    });

    // Add files from chat messages
    if (context.chat) {
      context.chat.filter(x => x.extra?.file).forEach(msg => {
        const file = msg.extra.file;
        if (file && file.url) fileMap.set(file.url, file);
      });
    }
  } catch (error) {
    console.error('Vectors: Error getting files:', error);
  }

  return fileMap;
}

/**
 * Parses tag configuration with exclusion syntax
 * @param {string} tagConfig Tag configuration string
 * @returns {object} Object with mainTag and excludeTags
 */


// Note: Content filtering functions have been moved to src/utils/contentFilter.js
// Note: escapeRegex has been moved to src/utils/contentFilter.js

/**
 * Gets all raw content for scanning, bypassing tag extraction rules.
 * @returns {Promise<VectorItem[]>} Array of vector items with raw text
 */
async function getRawContentForScanning() {
  const items = [];
  const context = getContext();
  const selectedContent = settings.selected_content;

  // Chat messages
  if (selectedContent.chat.enabled && context.chat) {
    const chatSettings = selectedContent.chat;

    // 使用新的 getMessages 函数获取过滤后的消息
    const messageOptions = {
      includeHidden: chatSettings.include_hidden || false,
      types: chatSettings.types || { user: true, assistant: true },
      range: chatSettings.range
    };

    const messages = getMessages(context.chat, messageOptions);

    messages.forEach(msg => {
      // Use raw message content, bypassing extractTagContent
      items.push(createVectorItem(msg, msg.text));
    });
  }

  // Files
  if (selectedContent.files.enabled) {
    const fileMap = getAllAvailableFiles();
    const allFiles = Array.from(fileMap.values());
    let fileIndex = 0;  // 为文件添加索引
    for (const file of allFiles) {
      if (!selectedContent.files.selected.includes(file.url)) continue;
      try {
        const text = await getFileAttachment(file.url);
        if (text && text.trim()) {
          items.push({
            type: 'file',
            text: text,
            metadata: {
              name: file.name,
              originalIndex: fileIndex  // 添加原始索引
            },
            selected: true
          });
          fileIndex++;  // 递增文件索引
        }
      } catch (error) {
        console.error(`Vectors: Error processing file for scanning ${file.name}:`, error);
      }
    }
  }

  // World Info
  if (selectedContent.world_info.enabled) {
    const entries = await getSortedEntries();
    for (const entry of entries) {
      if (!entry.world || !entry.content || entry.disable) continue;
      const selectedEntries = selectedContent.world_info.selected[entry.world] || [];
      if (!selectedEntries.includes(entry.uid)) continue;
      items.push({ type: 'world_info', text: entry.content, metadata: { world: entry.world, uid: entry.uid }, selected: true });
    }
  }

  return items;
}
/**
 * Gets all vectorizable content based on provided settings
 * (v9.5 File Masquerade Edition)
 */
async function getVectorizableContent(contentSettings = null) {
  const items = [];
  const context = getContext();
  const selectedContent = contentSettings || settings.selected_content;

  // 1. Chat messages (Normal)
  if (selectedContent.chat.enabled && context.chat) {
        const chatSettings = selectedContent.chat;
        const rules = chatSettings.tag_rules || [];

        const messageOptions = {
            includeHidden: chatSettings.include_hidden || false,
            types: chatSettings.types || { user: true, assistant: true },
            range: chatSettings.range,
            newRanges: chatSettings.newRanges
        };

        const messages = getMessages(context.chat, messageOptions);

        messages.forEach(msg => {
            let extractedText;
            if (msg.index === 0 || msg.is_user === true) {
                extractedText = msg.text;
            } else {
                extractedText = extractTagContent(msg.text, rules, settings.content_blacklist || []);
            }
            items.push(createVectorItem(msg, extractedText, extractedText));
        });
    }

  // 2. Files (🎭 Masquerading as Chat)
  if (selectedContent.files.enabled) {
    const fileMap = getAllAvailableFiles();
    const allFiles = Array.from(fileMap.values());
    console.debug(`Vectors: Total unique files found: ${allFiles.length}`);

    let processedFileCount = 0;
    let fileIndex = 0;
    
    for (const file of allFiles) {
      if (!selectedContent.files.selected.includes(file.url)) continue;

      try {
        const text = await getFileAttachment(file.url);
        if (text && text.trim()) {
          // 🔥🔥🔥 核心修改：身份伪装 🔥🔥🔥
          items.push({
            type: 'chat', // <--- 强行改为 chat，骗过检索系统
            text: text,
            metadata: {
              name: file.name,
              url: file.url,
              size: file.size,
              // 给一个超大的虚假楼层，确保它排在真实聊天记录后面
              originalIndex: 1000000 + fileIndex,  
              index: 1000000 + fileIndex, 
              is_user: false, // 伪装成 AI 发言
              is_file_masked: true // 标记：这是一个伪装的文件
            },
            selected: true,
          });
          processedFileCount++;
          fileIndex++;
          console.debug(`Vectors: File masquerading as chat: ${file.name}`);
        } else {
          console.warn(`Vectors: File ${file.name} is empty`);
        }
      } catch (error) {
        console.error(`Vectors: Error processing file ${file.name}:`, error);
        toastr.warning(`文件 "${file.name}" 处理失败: ${error.message}`);
      }
    }
  }

  // 3. World Info (Normal)
  if (selectedContent.world_info.enabled) {
    const entries = await getSortedEntries();
    let processedWICount = 0;

    for (const entry of entries) {
      if (!entry.world || !entry.content || entry.disable) continue;

      const selectedEntries = selectedContent.world_info.selected[entry.world] || [];
      if (!selectedEntries.includes(entry.uid)) continue;

      items.push({
        type: 'world_info',
        text: entry.content,
        metadata: {
          world: entry.world,
          uid: entry.uid,
          key: entry.key.join(', '),
          comment: entry.comment,
        },
        selected: true,
      });
      processedWICount++;
    }
  }

  // Debug Stats
  const finalCounts = {
    chat: items.filter(item => item.type === 'chat').length,
    file: items.filter(item => item.type === 'file').length, // 应该是 0
    world_info: items.filter(item => item.type === 'world_info').length,
    total: items.length
  };

  console.debug('Vectors: Content extraction complete (Files masked as Chat):', finalCounts);
  return items;
}



/**
 * Generates a task name based on actual processed items
 * @param {object} contentSettings The actual content settings being processed
 * @param {Array} actualItems Array of actual items that were processed
 * @returns {Promise<string>} Task name
 */
async function generateTaskName(contentSettings, actualItems) {
  console.log('Debug: Generating task name with settings:', JSON.stringify(contentSettings, null, 2));
  const parts = [];

  console.debug('Vectors: generateTaskName input:', {
    contentSettings,
    actualItemsCount: actualItems.length,
    actualItems: actualItems.map(item => ({ type: item.type, metadata: item.metadata }))
  });

  // Count actual items by type
  const itemCounts = {
    chat: 0,
    file: 0,
    world_info: 0
  };

  actualItems.forEach(item => {
    if (itemCounts.hasOwnProperty(item.type)) {
      itemCounts[item.type]++;
    }
  });

  console.debug('Vectors: Actual item counts:', itemCounts);

  // Chat range - use newRanges if available for accurate naming
    const chatItems = actualItems.filter(item => item.type === 'chat');
    if (chatItems.length > 0) {
        const indices = chatItems.map(item => item.metadata.index).sort((a, b) => a - b);

        // Format non-continuous ranges properly
        const ranges = [];
        let start = indices[0];
        let end = indices[0];

        for (let i = 1; i < indices.length; i++) {
            if (indices[i] === end + 1) {
                // Continuous, extend the range
                end = indices[i];
            } else {
                // Not continuous, save current range and start new one
                if (start === end) {
                    ranges.push(`#${start}`);
                } else {
                    ranges.push(`#${start}-${end}`);
                }
                start = indices[i];
                end = indices[i];
            }
        }

        // Add the last range
        if (start === end) {
            ranges.push(`#${start}`);
        } else {
            ranges.push(`#${start}-${end}`);
        }

        // Join ranges with proper formatting
        if (ranges.length === 1) {
            parts.push(`消息 ${ranges[0]}`);
        } else if (ranges.length <= 3) {
            parts.push(`消息 ${ranges.join('、')}`);
        } else {
            // For many ranges, show first few and count
            parts.push(`消息 ${ranges.slice(0, 2).join('、')}等 (${chatItems.length}条)`);
        }

        console.debug('Vectors: Added chat part (from actual items):', parts[parts.length - 1]);
    }

  // Files - use actual file count
  if (contentSettings.files && contentSettings.files.enabled && itemCounts.file > 0) {
    parts.push(`${itemCounts.file} 个文件`);
    console.debug('Vectors: Added file part (actual count):', parts[parts.length - 1]);
  }

  // World info - use actual world info count
  if (contentSettings.world_info && contentSettings.world_info.enabled && itemCounts.world_info > 0) {
    parts.push(`${itemCounts.world_info} 条世界信息`);
    console.debug('Vectors: Added world info part (actual count):', parts[parts.length - 1]);
  }

  // If no specific content selected, use generic name
  if (parts.length === 0) {
    parts.push(`${actualItems.length} 个项目`);
    console.debug('Vectors: Added generic part:', parts[parts.length - 1]);
  }

  // Add timestamp
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const finalName = `${parts.join(', ')} (${time})`;
  console.debug('Vectors: Final task name:', finalName);
  return finalName;
}

/**
 * Checks for existing tasks that overlap with current selection
 * @param {string} chatId Chat ID
 * @param {object} currentSettings Current content selection settings
 * @returns {object} Analysis result with conflicts and new content
 */
function analyzeTaskOverlap(chatId, currentSettings) {
  const existingTasks = getChatTasks(chatId).filter(t => t.enabled);
  const conflicts = [];
  const newContentSources = [];

  console.debug('Vectors: Starting overlap analysis:', {
    chatId,
    existingTaskCount: existingTasks.length,
    existingTasks: existingTasks.map(t => ({ name: t.name, taskId: t.taskId })),
    currentSettings: {
      chat: currentSettings.chat.enabled,
      files: currentSettings.files.enabled ? currentSettings.files.selected.length : 0,
      world_info: currentSettings.world_info.enabled ? Object.values(currentSettings.world_info.selected).flat().length : 0
    }
  });

  // Check chat message overlap
  if (currentSettings.chat.enabled) {
    const currentStart = currentSettings.chat.range?.start || 0;
    const currentEnd = currentSettings.chat.range?.end || -1;
    const currentTags = currentSettings.chat.tags || '';
    const currentTypes = currentSettings.chat.types || { user: true, assistant: true };
    const currentHidden = currentSettings.chat.include_hidden || false;

    let hasCompleteMatch = false;
    let hasPartialOverlap = false;

    for (const task of existingTasks) {
      const taskChat = task.settings?.chat;
      if (taskChat?.enabled) {
        const taskStart = taskChat.range?.start || 0;
        const taskEnd = taskChat.range?.end || -1;
        const taskTags = taskChat.tags || '';
        const taskTypes = taskChat.types || { user: true, assistant: true };
        const taskHidden = taskChat.include_hidden || false;

        // Check if settings are identical
        const sameSettings = (
          taskTags === currentTags &&
          JSON.stringify(taskTypes) === JSON.stringify(currentTypes) &&
          taskHidden === currentHidden
        );

        if (sameSettings) {
          // Check for exact match
          const isExactMatch = (taskStart === currentStart && taskEnd === currentEnd);

          // Check if current range is completely contained in existing task
          const isContained = (
            taskStart <= currentStart &&
            (taskEnd === -1 || (currentEnd !== -1 && currentEnd <= taskEnd))
          );

          // Check for any overlap (more precise logic)
          const hasOverlap = (() => {
            // Handle -1 (end) cases
            const actualCurrentEnd = currentEnd === -1 ? Infinity : currentEnd;
            const actualTaskEnd = taskEnd === -1 ? Infinity : taskEnd;

            // Ranges overlap if they intersect
            return (
              currentStart <= actualTaskEnd &&
              taskStart <= actualCurrentEnd
            );
          })();

          if (isExactMatch || isContained) {
            hasCompleteMatch = true;
            conflicts.push({
              type: 'chat_duplicate',
              taskName: task.name,
              taskRange: { start: taskStart, end: taskEnd },
              message: `楼层 #${currentStart}-#${currentEnd === -1 ? '最后' : currentEnd} 已在任务"${task.name}"中向量化`
            });
          } else if (hasOverlap) {
            hasPartialOverlap = true;
            conflicts.push({
              type: 'chat_partial',
              taskName: task.name,
              taskRange: { start: taskStart, end: taskEnd },
              currentRange: { start: currentStart, end: currentEnd },
              message: `楼层与任务"${task.name}"(#${taskStart}-#${taskEnd === -1 ? '最后' : taskEnd})存在重叠`
            });
          }
        }
      }
    }

    // Only add as new content if there's no complete match
    if (!hasCompleteMatch) {
      newContentSources.push('聊天记录');
    }
  }

  // Check file overlap
  if (currentSettings.files.enabled && currentSettings.files.selected.length > 0) {
    const existingFiles = new Set();
    const fileTaskMap = new Map(); // 记录每个文件在哪些任务中

    // 收集所有已存在的文件
    for (const task of existingTasks) {
      if (task.settings?.files?.enabled && task.settings.files.selected) {
        task.settings.files.selected.forEach(url => {
          existingFiles.add(url);
          if (!fileTaskMap.has(url)) {
            fileTaskMap.set(url, []);
          }
          fileTaskMap.get(url).push(task.name);
        });
      }
    }

    // Initialize main UI manager

    console.debug('Vectors: File overlap analysis:', {
      currentSelected: currentSettings.files.selected,
      currentSelectedCount: currentSettings.files.selected.length,
      existingFiles: Array.from(existingFiles),
      existingFilesCount: existingFiles.size,
      fileTaskMap: Object.fromEntries(fileTaskMap),
      allExistingTaskFiles: existingTasks.map(task => ({
        taskName: task.name,
        files: task.settings?.files?.selected || []
      }))
    });

    const newFiles = currentSettings.files.selected.filter(url => !existingFiles.has(url));
    const duplicateFiles = currentSettings.files.selected.filter(url => existingFiles.has(url));

    console.debug('Vectors: File analysis result:', {
      newFiles,
      duplicateFiles,
      newFileCount: newFiles.length,
      duplicateFileCount: duplicateFiles.length
    });

    if (duplicateFiles.length > 0) {
      conflicts.push({
        type: 'files_partial',
        message: `${duplicateFiles.length} 个文件已被向量化`,
        details: duplicateFiles,
        taskInfo: duplicateFiles.map(url => ({
          url,
          tasks: fileTaskMap.get(url) || []
        }))
      });
    }

    if (newFiles.length > 0) {
      newContentSources.push(`${newFiles.length} 个新文件`);
    }
  }

  // Check world info overlap
  if (currentSettings.world_info.enabled) {
    const existingEntries = new Set();
    for (const task of existingTasks) {
      if (task.settings?.world_info?.enabled && task.settings.world_info.selected) {
        Object.values(task.settings.world_info.selected).flat().forEach(uid => existingEntries.add(uid));
      }
    }

    const currentEntries = Object.values(currentSettings.world_info.selected).flat();
    const newEntries = currentEntries.filter(uid => !existingEntries.has(uid));
    const duplicateEntries = currentEntries.filter(uid => existingEntries.has(uid));

    if (duplicateEntries.length > 0) {
      conflicts.push({
        type: 'worldinfo_partial',
        message: `${duplicateEntries.length} 个世界信息条目已被向量化`,
        details: duplicateEntries
      });
    }

    if (newEntries.length > 0) {
      newContentSources.push(`${newEntries.length} 个新世界信息条目`);
    }
  }

  const result = {
    hasConflicts: conflicts.length > 0,
    conflicts,
    newContentSources,
    hasNewContent: newContentSources.length > 0
  };

  console.debug('Vectors: Overlap analysis complete:', {
    result,
    conflictDetails: conflicts.map(c => ({
      type: c.type,
      message: c.message,
      details: c.details || 'no details'
    }))
  });

  return result;
}

/**
 * Creates filtered settings with only new content
 * @param {object} currentSettings Current settings
 * @param {string} chatId Chat ID
 * @param {Array} conflicts Array of conflict objects
 * @returns {object} Filtered settings with only new content
 */
function createIncrementalSettings(currentSettings, chatId, conflicts) {
  const existingTasks = getChatTasks(chatId).filter(t => t.enabled);
  const newSettings = JSON.parse(JSON.stringify(currentSettings));

  // Initialize coveredRanges at function scope for debugging
  let coveredRanges = [];

  // Handle chat message ranges - calculate new range based on conflicts
  if (newSettings.chat.enabled) {
    const currentStart = currentSettings.chat.range?.start || 0;
    const currentEnd = currentSettings.chat.range?.end || -1;
    const currentTags = currentSettings.chat.tags || '';
    const currentTypes = currentSettings.chat.types || { user: true, assistant: true };
    const currentHidden = currentSettings.chat.include_hidden || false;

    // Find all existing covered ranges with same settings
    coveredRanges = [];
    for (const task of existingTasks) {
      const taskChat = task.settings?.chat;
      if (taskChat?.enabled) {
        const taskStart = taskChat.range?.start || 0;
        const taskEnd = taskChat.range?.end || -1;
        const taskTags = taskChat.tags || '';
        const taskTypes = taskChat.types || { user: true, assistant: true };
        const taskHidden = taskChat.include_hidden || false;

        // Only consider ranges with same settings
        const sameSettings = (
          taskTags === currentTags &&
          JSON.stringify(taskTypes) === JSON.stringify(currentTypes) &&
          taskHidden === currentHidden
        );

        if (sameSettings) {
          coveredRanges.push({ start: taskStart, end: taskEnd });
        }
      }
    }

    // Calculate the new range that's not covered using a more robust algorithm
    if (coveredRanges.length === 0) {
      // No existing ranges, keep current range
      // hasNewRange is already true by default
    } else {
      // Sort covered ranges by start position
      coveredRanges.sort((a, b) => a.start - b.start);

      // Find gaps and uncovered areas
      const newRanges = [];
      let checkStart = currentStart;
      const actualCurrentEnd = currentEnd === -1 ? 999999 : currentEnd; // Use large number for -1

      for (const covered of coveredRanges) {
        const coveredStart = covered.start;
        const coveredEnd = covered.end === -1 ? 999999 : covered.end;

        // Skip if covered range is completely outside current range
        if (coveredEnd < currentStart || coveredStart > actualCurrentEnd) {
          continue;
        }

        // If there's a gap before this covered range
        if (checkStart < coveredStart) {
          const gapEnd = Math.min(actualCurrentEnd, coveredStart - 1);
          if (checkStart <= gapEnd) {
            newRanges.push({ start: checkStart, end: gapEnd === 999999 ? -1 : gapEnd });
          }
        }

        // Move checkStart to after this covered range
        checkStart = Math.max(checkStart, coveredEnd + 1);
      }

      // Check if there's remaining range after all covered ranges
      if (checkStart <= actualCurrentEnd) {
        newRanges.push({ start: checkStart, end: currentEnd });
      }

      // Handle multiple new ranges
    if (newRanges.length > 0) {
        // Store all new ranges for display and processing purposes.
        // Our enhanced getVectorizableContent will now use this array directly.
        newSettings.chat.newRanges = newRanges;

        // We no longer create a single, large, incorrect range.
        // We also don't need to set isMultiRange anymore.
        // The original `range` property in newSettings will be ignored by the new getVectorizableContent logic.
    } else {
        // No new content found for chat messages.
        newSettings.chat.enabled = false;
    }
    }
  }

  console.debug('Vectors: createIncrementalSettings result:', {
    originalChat: currentSettings.chat,
    newChat: newSettings.chat,
    coveredRanges: newSettings.chat.enabled ? coveredRanges : 'N/A'
  });

  // Filter out existing files
  if (newSettings.files.enabled) {
    const existingFiles = new Set();
    for (const task of existingTasks) {
      if (task.settings?.files?.enabled && task.settings.files.selected) {
        task.settings.files.selected.forEach(url => existingFiles.add(url));
      }
    }
    newSettings.files.selected = newSettings.files.selected.filter(url => !existingFiles.has(url));
    if (newSettings.files.selected.length === 0) {
      newSettings.files.enabled = false;
    }
  }

  // Filter out existing world info
  if (newSettings.world_info.enabled) {
    const existingEntries = new Set();
    for (const task of existingTasks) {
      if (task.settings?.world_info?.enabled && task.settings.world_info.selected) {
        Object.values(task.settings.world_info.selected).flat().forEach(uid => existingEntries.add(uid));
      }
    }

    for (const [world, uids] of Object.entries(newSettings.world_info.selected)) {
      newSettings.world_info.selected[world] = uids.filter(uid => !existingEntries.has(uid));
      if (newSettings.world_info.selected[world].length === 0) {
        delete newSettings.world_info.selected[world];
      }
    }

    if (Object.keys(newSettings.world_info.selected).length === 0) {
      newSettings.world_info.enabled = false;
    }
  }

  console.log('Debug: Incremental settings created:', JSON.stringify(newSettings, null, 2));
  return newSettings;
}

/**
 * Performs the actual vectorization with given settings
 * @param {object} contentSettings Settings for content selection
 * @param {string} chatId Chat ID
 * @param {boolean} isIncremental Whether this is incremental vectorization
 */

/**
 * Pipeline version of performVectorization (v9.6 File Masquerade Support)
 * 包含：识别伪装文件并强制切分、动态Batch、中断恢复
 */
async function performVectorization(contentSettings, chatId, isIncremental, items, options = {}) {
  console.log('Pipeline: Starting Vectorization (v9.6 Masquerade Fix)...');
  const { skipDeduplication = false, taskType = 'vectorization', customTaskName = null } = options;

  // 1. 获取 UI 设置
  const targetTaskId = $('#vectors_target_task').val();
  const isFusionMode = targetTaskId && targetTaskId !== '__NEW__';
  
  // 动态导入
  const { pipelineIntegration } = await import('./src/core/pipeline/PipelineIntegration.js');
  const { FusionManager } = await import('./src/core/FusionManager.js');

  // ==========================================
  // 🔪 预切分逻辑 (Pre-Slicer) - 修复伪装文件的切分问题
  // ==========================================
  
  const readFileAsText = (file) => {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = (e) => reject(e);
          reader.readAsText(file);
      });
  };

  try {
      // 🔥 核心修复：检查 type 为 file 或者 被标记为伪装的文件
      if (items.some(i => i.type === 'file' || i.metadata?.is_file_masked)) {
          const expandedItems = [];
          
          let separator = $('#vectors_custom_separator').val();
          if (!separator || separator.trim() === '') {
              separator = '#####ARCMEMORYCUT#####'; 
              console.log(`[Pre-Slicer] 启用Arc协议分隔符: "${separator}"`);
          } else {
              console.log(`[Pre-Slicer] 使用UI分隔符: "${separator}"`);
          }
          
          toastr.info('正在执行外科手术级切分...', '系统消息');

          for (const item of items) {
              // 🔥 核心修复：对伪装文件也执行切分
              if (item.type === 'file' || item.metadata?.is_file_masked) {
                  console.log(`[Pre-Slicer] Processing: ${item.metadata.name}`);
                  
                  // 获取文本：如果是真实文件读文件，如果是伪装Chat直接读text
                  let rawText = "";
                  if (item.file) {
                      rawText = await readFileAsText(item.file);
                  } else if (item.metadata.url && !item.text) {
                      rawText = await fetch(item.metadata.url).then(r => r.blob()).then(readFileAsText);
                  } else {
                      rawText = item.text || "";
                  }

                  const cleanText = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                  
                  let chunks = cleanText.split(separator);
                  chunks = chunks.filter(c => c.trim().length > 0);
                  
                  console.log(`[Pre-Slicer] 切分为 ${chunks.length} 个记忆碎片`);

                  const baseFileIndex = item.metadata.originalIndex || 0;

                  chunks.forEach((chunkText, idx) => {
                      const compoundIndex = (baseFileIndex * 100000) + idx;
                      
                      // 保持原来的类型（如果是chat伪装的就继续用chat）
                      const finalType = item.type === 'chat' ? 'chat' : 'file';

                      expandedItems.push({
                          type: finalType, 
                          text: chunkText.trim(), 
                          content: chunkText.trim(),
                          metadata: { 
                              ...item.metadata, 
                              originalIndex: compoundIndex, 
                              fileName: item.metadata.name,
                              isManualChunk: true,
                              chunkIndex: idx,
                              // 确保伪装标记传递下去
                              is_file_masked: item.metadata?.is_file_masked
                          }
                      });
                  });
              } else {
                  expandedItems.push(item);
              }
          }
          items = expandedItems;
      }
  } catch (err) {
      console.error("预切分异常:", err);
      toastr.error("切分失败: " + err.message);
  }

  // ==========================================
  // 🛡️ 启动引擎
  // ==========================================

  let allProcessedChunksCount = 0; 
  let taskId = isFusionMode ? targetTaskId : generateTaskId(); 
  let taskName;
  let targetTaskObj = null;
  let lastSavedChunk = null; 
  let vectorsInserted = false; 

  const processedItemsSummary = { chat: [], files: [], world_info: [] };

  try {
    if (isFusionMode) {
        const tasks = getChatTasks(chatId);
        targetTaskObj = tasks.find(t => t.taskId === targetTaskId);
        if (!targetTaskObj) throw new Error("目标任务不存在");

        const check = FusionManager.checkCompatibility(settings, targetTaskObj);
        if (!check.compatible) throw new Error(check.fatal);

        const filterResult = FusionManager.filterContent(items, targetTaskObj);
        items = filterResult.items; 
        
        if (filterResult.skippedCount > 0) toastr.info(`跳过 ${filterResult.skippedCount} 条重复`, "ArcFess Fusion");
        if (items.length === 0) {
             toastr.success("无需更新。", "完成");
             return { success: true };
        }
    }

    if (!pipelineIntegration.isEnabled()) {
      await pipelineIntegration.initialize({ vectorizationAdapter, settings });
      pipelineIntegration.setEnabled(true);
    }

    taskName = customTaskName || (isFusionMode ? targetTaskObj.name : await generateTaskName(contentSettings, items));

    isVectorizing = true;
    vectorizationAbortController = new AbortController();
    $('#vectors_enhanced_vectorize').hide();
    $('#vectors_enhanced_abort').show();

    const collectionId = `${chatId}_${taskId}`;
    
    let uiBatchSize = parseInt($('#vectors_gen_batch_size').val());
    if (isNaN(uiBatchSize) || uiBatchSize < 1) uiBatchSize = 6;
    const GEN_BATCH_SIZE = uiBatchSize;
    console.log(`[Pipeline] 动态批次大小: ${GEN_BATCH_SIZE}`);

    try {
      const startMsg = isFusionMode ? `融合: ${taskName}` : '向量化协议启动...';
      toastr.info(startMsg, '处理中');

      // PHASE 1: Grouping
      const groups = { chat: [], file: [], world_info: [] };
      items.forEach(item => { 
          if (groups[item.type]) groups[item.type].push(item); 
      });

      const queue = [];
      if (groups.chat.length) queue.push({ type: 'chat', items: groups.chat });
      if (groups.file.length) queue.push({ type: 'file', items: groups.file });
      if (groups.world_info.length) queue.push({ type: 'world_info', items: groups.world_info });

      if (globalProgressManager) globalProgressManager.show(0, items.length, '准备数据...');
      else updateProgressNew(0, items.length, '准备数据...');

      let processedItemsCount = 0;
      const dispatcher = pipelineIntegration.dispatcher;
      
      const processingContext = {
        chatId, taskId, collectionId, isIncremental,
        settings: contentSettings,
        abortSignal: vectorizationAbortController.signal,
        source: 'chat_vectorization',
        taskType: taskType,
        vectorizationSettings: settings
      };

      // PHASE 2, 3, 4: STREAM LOOP
      const currentApiDelay = parseInt($('#vectors_api_delay').val() || '0');
      for (const group of queue) {
          const groupItems = group.items;
          
          for (let i = 0; i < groupItems.length; i += GEN_BATCH_SIZE) {
              if (vectorizationAbortController.signal.aborted) throw new Error('用户中断');

              const batchItems = groupItems.slice(i, i + GEN_BATCH_SIZE);
              
              const dispatchResult = await dispatcher.dispatch(
                  batchItems, 
                  'vectorization',
                  { type: group.type, collectionId, source: 'stream_extraction' },
                  processingContext
              );

              if (dispatchResult.success && dispatchResult.vectors && dispatchResult.vectors.length > 0) {
                  const chunks = dispatchResult.vectors.map((vector, idx) => {
                      const rawText = vector.text || vector.content;
                      let finalIndex = vector.metadata?.originalIndex;
                      
                      if (finalIndex === undefined && idx < batchItems.length) {
                           finalIndex = batchItems[idx].metadata?.originalIndex ?? batchItems[idx].metadata?.index;
                      }

                      return {
                          text: rawText,
                          index: allProcessedChunksCount + idx, 
                          metadata: { 
                            ...vector.metadata, 
                            type: group.type, 
                            chunk_index: idx,
                            originalIndex: finalIndex 
                          }
                      };
                  });

                  // Retry Loop
                  let attempts = 0;
                  let saved = false;
                  while (!saved && attempts < 3) {
                      try {
                          attempts++;
                          await storageAdapter.insertVectorItems(
                              collectionId, chunks, vectorizationAbortController.signal, 
                              { skipDeduplication, taskId: taskId }
                          );
                          saved = true;
                          vectorsInserted = true;
                      } catch (err) {
                          if (vectorizationAbortController.signal.aborted) throw err;
                          await new Promise(r => setTimeout(r, 2000));
                      }
                  }
                  
                  allProcessedChunksCount += chunks.length;
                  if (chunks.length > 0) lastSavedChunk = chunks[chunks.length - 1];

                  batchItems.forEach(item => {
                      if (item.type === 'chat') processedItemsSummary.chat.push(item.metadata.index);
                      else if (item.metadata.fileName) {
                          if (!processedItemsSummary.files.includes(item.metadata.fileName)) {
                              processedItemsSummary.files.push(item.metadata.fileName);
                          }
                      }
                  });
              }

              processedItemsCount += batchItems.length;
              
              const progressMsg = `已存 ${allProcessedChunksCount} 块 (API冷却: ${currentApiDelay}ms)`;
              
              if (globalProgressManager) {
                  globalProgressManager.update(processedItemsCount, items.length, progressMsg);
              } else {
                  updateProgressNew(processedItemsCount, items.length, progressMsg);
              }

              if (currentApiDelay > 0) {
                  await new Promise(r => setTimeout(r, currentApiDelay));
              }
          }
      }

      // PHASE 5: COMPLETION
      if (isFusionMode) {
          const mergedTask = FusionManager.mergeTaskMetadata(targetTaskObj, { itemCount: allProcessedChunksCount }, items);
          const tasks = getChatTasks(chatId);
          const idx = tasks.findIndex(t => t.taskId === taskId);
          if (idx !== -1) {
              tasks[idx] = mergedTask;
              settings.vector_tasks[chatId] = tasks;
          }
      } else {
          const task = {
            taskId, name: taskName, timestamp: Date.now(), 
            settings: { ...getCleanSettings(contentSettings), ...getCleanSettings(settings) }, 
            enabled: true, itemCount: allProcessedChunksCount, originalItemCount: items.length,
            isIncremental, actualProcessedItems: processedItemsSummary, version: '2.0',
            metadata: { processed_files: processedItemsSummary.files, processed_chat_ranges: {} }
          };
          addVectorTask(chatId, task);
      }

      if (!extension_settings.vectors_enhanced.vector_tasks) extension_settings.vectors_enhanced.vector_tasks = {};
      extension_settings.vectors_enhanced.vector_tasks[chatId] = settings.vector_tasks[chatId];
      saveSettingsDebounced();

      if (cachedVectors.has(collectionId)) cachedVectors.delete(collectionId);
      
      if (globalProgressManager) globalProgressManager.complete('完成');
      else hideProgressNew();

      toastr.success(`完成: ${allProcessedChunksCount} 记忆块`, 'ArcFess');
      await updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);

      return { success: true };

    } catch (error) {
      console.error('Vectorization failed:', error);
      
      if (globalProgressManager) globalProgressManager.error('停止');
      else hideProgressNew();

      const isAbort = error.name === 'AbortError' || error.message.includes('用户中断');

      if (vectorsInserted) {
        const title = isAbort ? '向量化已暂停' : '发生错误';
        
        if (isFusionMode && isAbort) {
             const tasks = getChatTasks(chatId);
             const tIdx = tasks.findIndex(t => t.taskId === taskId);
             if (tIdx !== -1) {
                 tasks[tIdx].isPartial = true;
                 tasks[tIdx].itemCount = allProcessedChunksCount; 
                 settings.vector_tasks[chatId] = tasks;
                 extension_settings.vectors_enhanced.vector_tasks[chatId] = tasks;
                 saveSettingsDebounced();
             }
             toastr.warning(`进度已保存 (${allProcessedChunksCount} 块)`, "暂停");
             return { success: false, partial: true };
        }

        const confirm = await callGenericPopup(
            `<div><strong>${title}</strong><p>已成功写入 ${allProcessedChunksCount} 个向量块。</p><p>是否保存当前进度？</p></div>`,
            POPUP_TYPE.CONFIRM, { okButton: '保存', cancelButton: '丢弃' }
        );

        if (confirm === POPUP_RESULT.AFFIRMATIVE) {
            const partialTask = {
                taskId, name: taskName + " (Partial)", timestamp: Date.now(), 
                settings: { ...getCleanSettings(contentSettings), ...getCleanSettings(settings) }, 
                enabled: true, itemCount: allProcessedChunksCount, originalItemCount: items.length,
                isIncremental, isPartial: true, version: '2.0',
                actualProcessedItems: processedItemsSummary,
                metadata: { processed_files: processedItemsSummary.files, processed_chat_ranges: {} }
            };

            if (!settings.vector_tasks[chatId]) settings.vector_tasks[chatId] = [];
            settings.vector_tasks[chatId].push(partialTask);
            extension_settings.vectors_enhanced.vector_tasks[chatId] = settings.vector_tasks[chatId];
            
            saveSettingsDebounced();
            await updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);
            toastr.info('进度已保存', '保存成功');
        } else {
            await storageAdapter.deleteTask(taskId);
            toastr.info('数据已清理', '已丢弃');
        }

      } else {
         if (!isAbort) toastr.error(error.message, '错误');
      }
      return { success: false, aborted: isAbort };

    } finally {
      isVectorizing = false;
      vectorizationAbortController = null;
      $('#vectors_enhanced_vectorize').show();
      $('#vectors_enhanced_abort').hide();
    }
  } catch (e) {
      console.error("Fatal:", e);
      toastr.error(e.message);
  }
}


/**
 * Actively cleanup invalid selections before processing
 */
async function cleanupInvalidSelections() {
  console.debug('Vectors: Starting active cleanup of invalid selections');

  let hasChanges = false;

  // Cleanup world info selections
  if (settings.selected_content.world_info.enabled) {
    const entries = await getSortedEntries();
    const allValidUids = new Set();
    const currentValidWorlds = new Set();

    entries.forEach(entry => {
      // Only include entries that are not disabled and have content
      if (entry.world && entry.content && !entry.disable) {
        allValidUids.add(entry.uid);
        currentValidWorlds.add(entry.world);
      }
    });

    console.debug('Vectors: Valid world info UIDs:', Array.from(allValidUids));
    console.debug('Vectors: Current valid worlds:', Array.from(currentValidWorlds));

    const originalCount = Object.values(settings.selected_content.world_info.selected).flat().length;

    // Clean each world's selection
    for (const [world, selectedUids] of Object.entries(settings.selected_content.world_info.selected)) {
      // Remove worlds that don't exist in current context
      if (!currentValidWorlds.has(world)) {
        console.debug(`Vectors: Removing world "${world}" - not available in current context`);
        delete settings.selected_content.world_info.selected[world];
        hasChanges = true;
        continue;
      }

      const validUids = selectedUids.filter(uid => {
        const isValid = allValidUids.has(uid);
        if (!isValid) {
          console.debug(`Vectors: Removing invalid world info UID: ${uid} from world ${world}`);
        }
        return isValid;
      });

      if (validUids.length !== selectedUids.length) {
        hasChanges = true;
        if (validUids.length === 0) {
          delete settings.selected_content.world_info.selected[world];
          console.debug(`Vectors: Removed empty world: ${world}`);
        } else {
          settings.selected_content.world_info.selected[world] = validUids;
        }
      }
    }

    const newCount = Object.values(settings.selected_content.world_info.selected).flat().length;
    const removedCount = originalCount - newCount;

    if (removedCount > 0) {
      console.debug(`Vectors: Cleaned up ${removedCount} invalid world info selections:`, {
        original: originalSelected,
        cleaned: settings.selected_content.world_info.selected,
        originalCount,
        newCount
      });
      hasChanges = true;
    }
  }

  // TODO: Add file cleanup here if needed

  if (hasChanges) {
    Object.assign(extension_settings.vectors_enhanced, settings);
    saveSettingsDebounced();
    console.debug('Vectors: Active cleanup completed with changes');
  } else {
    console.debug('Vectors: Active cleanup completed - no changes needed');
  }
}

/**
 * Gets a set of unique identifiers for all items already processed in enabled tasks.
 * @param {string} chatId Chat ID
 * @returns {{chat: Set<number>, file: Set<string>, world_info: Set<string>}}
 */
function getProcessedItemIdentifiers(chatId) {
    const identifiers = {
        chat: new Set(),
        file: new Set(),
        world_info: new Set(),
        world_info_with_world: new Map() // 新增：存储 uid -> world 的映射
    };
    const enabledTasks = getChatTasks(chatId).filter(t => t.enabled);

    for (const task of enabledTasks) {
        // Use actualProcessedItems if available (new tasks)
        if (task.actualProcessedItems) {
            // New tasks with actual processed items tracking
            if (task.actualProcessedItems.chat) {
                task.actualProcessedItems.chat.forEach(index => identifiers.chat.add(index));
            }
            if (task.actualProcessedItems.files) {
                task.actualProcessedItems.files.forEach(url => identifiers.file.add(url));
            }
            if (task.actualProcessedItems.world_info) {
                task.actualProcessedItems.world_info.forEach(item => {
                    // Handle both old format (string uid) and new format (object with uid)
                    if (typeof item === 'string') {
                        identifiers.world_info.add(item);
                        // 旧格式没有世界书名字信息
                    } else if (item.uid !== undefined && item.uid !== null) {
                        // 统一转换为字符串以确保类型一致
                        const uidStr = String(item.uid);
                        identifiers.world_info.add(uidStr);
                        // 新格式：记录 uid 对应的世界书名字
                        if (item.world) {
                            identifiers.world_info_with_world.set(uidStr, item.world);
                        }
                    }
                });
            }
        } else {
            // 外挂任务没有settings，跳过
            if (task.type === 'external') {
                continue;
            }

            // Legacy tasks without actualProcessedItems - fallback to settings ranges
            const taskSettings = task.settings;
            if (taskSettings && taskSettings.chat && taskSettings.chat.enabled) {
                const start = taskSettings.chat.range.start;
                const end = taskSettings.chat.range.end === -1
                    ? getContext().chat.length - 1
                    : taskSettings.chat.range.end;
                for (let i = start; i <= end; i++) {
                    identifiers.chat.add(i);
                }
            }
            if (taskSettings && taskSettings.files && taskSettings.files.enabled) {
                taskSettings.files.selected.forEach(url => identifiers.file.add(url));
            }
            if (taskSettings && taskSettings.world_info && taskSettings.world_info.enabled) {
                Object.values(taskSettings.world_info.selected).flat().forEach(uid => identifiers.world_info.add(uid));
            }
        }
    }
    return identifiers;
}

/**
 * Formats an array of chat items into a human-readable range string.
 * e.g., [0, 1, 5, 6, 7, 10] becomes "#0-#1, #5-#7, #10"
 * @param {Array<object>} chatItems - Array of chat items, each with metadata.index
 * @returns {string} A formatted string representing the ranges.
 */
function formatRanges(chatItems) {
    if (!chatItems || chatItems.length === 0) {
        return '没有新的聊天记录';
    }

    const indices = chatItems.map(item => item.metadata.index).sort((a, b) => a - b);

    const ranges = [];
    let start = indices[0];
    let end = indices[0];

    for (let i = 1; i < indices.length; i++) {
        if (indices[i] === end + 1) {
            end = indices[i];
        } else {
            ranges.push(start === end ? `#${start}` : `#${start}-${end}`);
            start = end = indices[i];
        }
    }
    ranges.push(start === end ? `#${start}` : `#${start}-${end}`);

    return `楼层 ${ranges.join('、')}`;
}

/**
 * 格式化消息项的楼层范围（用于向量化弹窗）
 * 例如：[5, 6, 7, 10] 变成 "5-7层、10层"
 * @param {Array<object>} messageItems - 消息项数组，每个项包含 metadata.index
 * @returns {string} 格式化的楼层范围字符串
 */
function formatMessageRanges(messageItems) {
    if (!messageItems || messageItems.length === 0) {
        return '无';
    }

    const indices = messageItems.map(item => item.metadata.index).sort((a, b) => a - b);
    const ranges = [];
    let start = indices[0];
    let end = indices[0];

    for (let i = 1; i < indices.length; i++) {
        if (indices[i] === end + 1) {
            end = indices[i];
        } else {
            ranges.push(start === end ? `${start}层` : `${start}-${end}层`);
            start = end = indices[i];
        }
    }
    ranges.push(start === end ? `${start}层` : `${start}-${end}层`);

    return ranges.join('、');
}

/**
 * Disables all entries in a world info book
 * @param {string} worldName - Name of the world info book
 * @param {Array} entries - Array of world info entries to disable
 * @returns {Promise<void>}
 */
async function disableWorldInfoEntries(worldName, entries) {
    try {
        console.log('[Vectors] 开始禁用世界书条目:', worldName);

        // 加载世界书数据
        const worldData = await loadWorldInfo(worldName);
        if (!worldData || !worldData.entries) {
            console.error('[Vectors] 无法加载世界书数据:', worldName);
            return;
        }

        let disabledCount = 0;

        // 禁用所有条目
        for (const entry of entries) {
            if (worldData.entries[entry.uid]) {
                worldData.entries[entry.uid].disable = true;
                disabledCount++;
                console.log(`[Vectors] 禁用条目 UID: ${entry.uid}, comment: ${entry.comment}`);
            }
        }

        if (disabledCount > 0) {
            // 使用立即保存模式确保数据被写入
            await saveWorldInfo(worldName, worldData, true);
            console.log(`[Vectors] 成功禁用 ${disabledCount} 个世界书条目`);
            toastr.success(`已禁用 ${disabledCount} 个世界书条目`, '世界书更新');
        } else {
            console.log('[Vectors] 没有需要禁用的条目');
        }
    } catch (error) {
        console.error('[Vectors] 禁用世界书条目失败:', error);
        toastr.error('禁用世界书条目失败: ' + error.message);
    }
}

/**
 * Vectorizes selected content
 * @returns {Promise<void>}
 */
async function vectorizeContent() {
    if (isVectorizing) {
        toastr.warning('已有向量化任务在进行中');
        return;
    }
    const chatId = getCurrentChatId();
    if (!chatId || chatId === 'null' || chatId === 'undefined') {
        toastr.error('未选择聊天');
        return;
    }

    await cleanupInvalidSelections();

    // 1. Get initial items based on UI selection
    const initialItems = await getVectorizableContent();

    // 2. Filter out empty items to get "valid" items
    const validItems = initialItems.filter(item => item.text && item.text.trim() !== '');
    if (validItems.length === 0) {
        toastr.warning('未选择要向量化的内容或过滤后内容为空');
        return;
    }

    // 3. Get identifiers of already processed items
    const processedIdentifiers = getProcessedItemIdentifiers(chatId);

    // 4. Filter valid items to get only "new" items
    const newItems = validItems.filter(item => {
        switch (item.type) {
            case 'chat': return !processedIdentifiers.chat.has(item.metadata.index);
            case 'file': return !processedIdentifiers.file.has(item.metadata.url);
            case 'world_info': {
                // 对于世界书，需要同时检查 UID 和世界书名字
                // 统一转换为字符串以确保类型一致
                const uidStr = String(item.metadata.uid);
                if (!processedIdentifiers.world_info.has(uidStr)) {
                    // UID 未被处理过，这是新项目
                    return true;
                }
                // UID 已存在，检查是否来自同一个世界书
                const processedWorld = processedIdentifiers.world_info_with_world.get(uidStr);
                if (!processedWorld) {
                    // 旧格式任务，没有世界书信息，保守起见认为是重复的
                    return false;
                }
                // 如果世界书名字不同，则认为是新项目（不同世界书的相同 UID）
                return processedWorld !== item.metadata.world;
            }
            default: return true;
        }
    });

    // 5. Determine interaction flow based on what was filtered
    const hasEmptyItems = validItems.length < initialItems.length;
    const hasProcessedItems = newItems.length < validItems.length;

    let itemsToProcess = newItems;
    let isIncremental = hasProcessedItems; // Any task with pre-existing items is considered incremental

    if (newItems.length === 0) {
        // Case: All selected items have already been processed.
        const processedChatItems = validItems.filter(i => i.type === 'chat' && processedIdentifiers.chat.has(i.metadata.index));
        const processedFileItems = validItems.filter(i => i.type === 'file' && processedIdentifiers.file.has(i.metadata.url));
        const processedWorldInfoItems = validItems.filter(i => i.type === 'world_info' && processedIdentifiers.world_info.has(i.metadata.uid));

        const processedParts = [];
        if (processedChatItems.length > 0) processedParts.push(`聊天记录: ${formatRanges(processedChatItems)}`);
        if (processedFileItems.length > 0) processedParts.push(`文件: ${processedFileItems.length}个`);
        if (processedWorldInfoItems.length > 0) {
            // Group world info by world name
            const worldGroups = {};
            processedWorldInfoItems.forEach(item => {
                const worldName = item.metadata.world || '未知';
                if (!worldGroups[worldName]) worldGroups[worldName] = [];
                worldGroups[worldName].push(item.metadata.comment || item.metadata.uid);
            });

            const worldDetails = Object.entries(worldGroups).map(([world, entries]) =>
                `${world} (${entries.length}条)`
            ).join(', ');

            processedParts.push(`世界信息: ${worldDetails}`);
        }

        const confirm = await callGenericPopup(
            `<div>
                <p>所有选定内容均已被向量化：</p>
                <ul style="text-align: left; margin: 10px 0;">
                    ${processedParts.map(part => `<li>${part}</li>`).join('')}
                </ul>
                <p>是否要强制重新向量化这些内容？</p>
            </div>`,
            POPUP_TYPE.CONFIRM,
            { okButton: '是', cancelButton: '否' }
        );

        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
            return; // User chose 'No' or cancelled
        }

        // User chose 'Yes', force re-vectorization of all valid items
        itemsToProcess = validItems;
        isIncremental = false;
    }
    else if (hasProcessedItems && newItems.length > 0) {
        // Case: Partial overlap. Some items are new, some are already processed.
        const newChatItems = newItems.filter(i => i.type === 'chat');
        const newFileItems = newItems.filter(i => i.type === 'file');
        const newWorldInfoItems = newItems.filter(i => i.type === 'world_info');

        const processedChatItems = validItems.filter(i => i.type === 'chat' && processedIdentifiers.chat.has(i.metadata.index));
        const processedFileItems = validItems.filter(i => i.type === 'file' && processedIdentifiers.file.has(i.metadata.url));
        const processedWorldInfoItems = validItems.filter(i => i.type === 'world_info' && processedIdentifiers.world_info.has(i.metadata.uid));

        const newParts = [];
        const processedParts = [];

        if (newChatItems.length > 0) newParts.push(`新增聊天: ${formatRanges(newChatItems)}`);
        if (newFileItems.length > 0) newParts.push(`新增文件: ${newFileItems.length}个`);
        if (newWorldInfoItems.length > 0) {
            // Group new world info by world name
            const newWorldGroups = {};
            newWorldInfoItems.forEach(item => {
                const worldName = item.metadata.world || '未知';
                if (!newWorldGroups[worldName]) newWorldGroups[worldName] = [];
                newWorldGroups[worldName].push(item.metadata.comment || item.metadata.uid);
            });

            const newWorldDetails = Object.entries(newWorldGroups).map(([world, entries]) =>
                `${world} (${entries.length}条)`
            ).join(', ');

            newParts.push(`新增世界信息: ${newWorldDetails}`);
        }

        if (processedChatItems.length > 0) processedParts.push(`已处理聊天: ${formatRanges(processedChatItems)}`);
        if (processedFileItems.length > 0) processedParts.push(`已处理文件: ${processedFileItems.length}个`);
        if (processedWorldInfoItems.length > 0) {
            // Group processed world info by world name
            const processedWorldGroups = {};
            processedWorldInfoItems.forEach(item => {
                const worldName = item.metadata.world || '未知';
                if (!processedWorldGroups[worldName]) processedWorldGroups[worldName] = [];
                processedWorldGroups[worldName].push(item.metadata.comment || item.metadata.uid);
            });

            const processedWorldDetails = Object.entries(processedWorldGroups).map(([world, entries]) =>
                `${world} (${entries.length}条)`
            ).join(', ');

            processedParts.push(`已处理世界信息: ${processedWorldDetails}`);
        }

        const confirm = await callGenericPopup(
            `<div>
                <p><strong>检测到部分内容已被处理：</strong></p>
                <div style="text-align: left; margin: 10px 0;">
                    <p>已处理：</p>
                    <ul style="margin: 5px 0 15px 20px;">
                        ${processedParts.map(part => `<li>${part}</li>`).join('')}
                    </ul>
                    <p>新增内容：</p>
                    <ul style="margin: 5px 0 10px 20px;">
                        ${newParts.map(part => `<li>${part}</li>`).join('')}
                    </ul>
                </div>
                <p>是否只进行增量向量化（只处理新增内容）？</p>
            </div>`,
            POPUP_TYPE.CONFIRM,
            { okButton: '是', cancelButton: '否' }
        );

        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
            // User chose 'No' or cancelled
            return;
        }

        // User chose 'Yes', so we proceed with incremental vectorization (the default).
        itemsToProcess = newItems;
        isIncremental = true;
    }
    else if (hasEmptyItems) {
        // 分析有效项目的详细信息
        const validChatItems = validItems.filter(item => item.type === 'chat');
        const validFileItems = validItems.filter(item => item.type === 'file');
        const validWorldInfoItems = validItems.filter(item => item.type === 'world_info');

        // 按消息类型分组聊天项目
        const userMessages = validChatItems.filter(item => item.metadata.is_user === true);
        const aiMessages = validChatItems.filter(item => item.metadata.is_user === false);

        // 格式化楼层信息
        let detailParts = [];

        if (userMessages.length > 0) {
            const userRanges = formatMessageRanges(userMessages);
            detailParts.push(`用户消息（${userRanges}）`);
        }

        if (aiMessages.length > 0) {
            const aiRanges = formatMessageRanges(aiMessages);
            detailParts.push(`AI消息（${aiRanges}）`);
        }

        if (validFileItems.length > 0) {
            detailParts.push(`${validFileItems.length}个文件`);
        }

        if (validWorldInfoItems.length > 0) {
            detailParts.push(`${validWorldInfoItems.length}条世界信息`);
        }

        const detailText = detailParts.length > 0 ? `\n\n包含：${detailParts.join('、')}` : '';

        const confirm = await callGenericPopup(
            `您选择了 ${initialItems.length} 个项目，但只有 ${validItems.length} 个包含有效内容。${detailText}\n\n是否继续处理这 ${validItems.length} 个项目？`,
            POPUP_TYPE.CONFIRM,
            { okButton: '继续', cancelButton: '取消' }
        );
        if (confirm !== POPUP_RESULT.AFFIRMATIVE) return;
        // In this case, we process ALL valid items, not just new ones (as there are no "processed" items)
        itemsToProcess = validItems;
        isIncremental = false; // This is a new task, not an incremental addition
    }

    // 6. Perform vectorization with the final, clean set of items
    console.log('Vectors: Using pipeline implementation for vectorization');
    await performVectorization(structuredClone(settings.selected_content), chatId, isIncremental, itemsToProcess);
}

/**
 * Exports vectorized content
 * @returns {Promise<void>}
 */
async function exportVectors() {
  const context = getContext();
  const chatId = getCurrentChatId();

  if (!chatId || chatId === 'null' || chatId === 'undefined') {
    toastr.error('未选择聊天');
    return;
  }

  let items = await getVectorizableContent();
  // Filter out empty items for consistency with vectorization process
  items = items.filter(item => item.text && item.text.trim() !== '');

  if (items.length === 0) {
    toastr.warning('未选择要导出的内容或过滤后内容为空');
    return;
  }

  // Build export content
  let exportText = `角色卡：${context.name || '未知'}\n`;
  exportText += `时间：${new Date().toLocaleString('zh-CN')}\n\n`;

  // Group items by type
  const grouped = items.reduce((acc, item) => {
    if (!acc[item.type]) acc[item.type] = [];
    acc[item.type].push(item);
    return acc;
  }, {});

  // Files
  exportText += '=== 数据库文件 ===\n';
  if (grouped.file && grouped.file.length > 0) {
    grouped.file.forEach(item => {
      exportText += `文件名：${item.metadata.name}\n`;
      exportText += `内容：\n${item.text}\n\n`;
    });
  } else {
    exportText += '无\n\n';
  }

  // World Info
  exportText += '=== 世界书 ===\n';
  if (grouped.world_info && grouped.world_info.length > 0) {
    grouped.world_info.forEach(item => {
      exportText += `世界：${item.metadata.world}\n`;
      exportText += `注释：${item.metadata.comment || '无'}\n`;
      exportText += `内容：${item.text}\n\n`;
    });
  } else {
    exportText += '无\n\n';
  }

  // Chat messages
  exportText += '=== 聊天记录 ===\n';
  if (grouped.chat && grouped.chat.length > 0) {
    grouped.chat.forEach(item => {
      exportText += `#${item.metadata.index}：${item.text}\n\n`;
    });
  } else {
    exportText += '无\n\n';
  }

  // Create and download file
  const filename = `向量导出_${context.name || chatId}_${Date.now()}.txt`;
  triggerDownload(exportText, filename);

  toastr.success('导出成功');
}

/**
 * Previews vectorizable content
 * @returns {Promise<void>}
 */

/**
 * Cache object for storing hash values
 * @type {Map<string, number>}
 */
const hashCache = new Map();
const HASH_CACHE_MAX_SIZE = 500;

/**
 * Gets the hash value for a given string
 * @param {string} str Input string
 * @returns {number} Hash value
 */
function getHashValue(str) {
  if (hashCache.has(str)) {
    return hashCache.get(str);
  }
  // 容量限制：超500条时删掉最旧的（FIFO）
  if (hashCache.size >= HASH_CACHE_MAX_SIZE) {
    const firstKey = hashCache.keys().next().value;
    hashCache.delete(firstKey);
  }
  const hash = getStringHash(str);
  hashCache.set(str, hash);
  return hash;
}

/**
 * Decode metadata from encoded text
 * @param {string} encodedText - Text with metadata prefix
 * @returns {{text: string, metadata: {type?: string, originalIndex?: number, floor?: number, entry?: string, tag?: string, chunk?: string}}}
 */
function decodeMetadataFromText(encodedText) {
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
 * Synchronizes chat vectors
 * @param {number} batchSize Batch size for processing
 * @returns {Promise<number>} Number of remaining items
 */
async function synchronizeChat(batchSize = 5) {
  // 检查主开关是否启用
  if (!settings.master_enabled) {
    return -1;
  }


  try {
    await waitUntilCondition(() => !syncBlocked && !is_send_press, 1000);
  } catch {
    console.log('Vectors: Synchronization blocked by another process');
    return -1;
  }

  try {
    syncBlocked = true;
    // Auto-vectorization logic will be implemented based on settings
    return -1;
  } finally {
    syncBlocked = false;
  }
}

/**
 * Retrieves vectorized content for injection (Dual-Track Version with Thought Engine)
 */
async function rearrangeChat(chat, contextSize, abort, type) {
  const now = Date.now();

  // 1. 拦截逻辑：正在检索或处于冷却期（预览模式除外）则直接跳过
  if (isQuerying) {
      console.log('[Vectors] 拦截：上一个检索任务尚未完成');
      return;
  }
  if (type !== 'preview' && (now - lastQueryTimestamp < QUERY_COOLDOWN)) {
      console.log('[Vectors] 拦截：触发频率过高，进入冷却');
      return;
  }

  // 2. 加锁并记录时间
  isQuerying = true;
  lastQueryTimestamp = now;

  const queryStartTime = performance.now();
  const logTimingAndReturn = (reason = '', isError = false) => {
    const queryEndTime = performance.now();
    console.log(`[Vectors] 查询${isError ? '失败' : '跳过'} (${reason}) - 耗时: ${(queryEndTime - queryStartTime).toFixed(2)}ms`);
  };

  try {
    if (type === 'quiet') return;

    setExtensionPrompt(EXTENSION_PROMPT_TAG, '', settings.position, settings.depth, settings.include_wi, settings.depth_role);
    lastInjectedContent = null;
    lastInjectedStats = null;
    lastQueryDetails = null;

    if (!settings.master_enabled || !settings.enabled) {
      logTimingAndReturn('功能已禁用');
      return;
    }

    const chatId = getCurrentChatId();
    if (!chatId) return;

    const queryMessages = Math.min(settings.query_messages || 3, chat.length);
    let queryText = chat.slice(-queryMessages).map(x => getTextWithoutAttachments(x)).join('\n');
    if (!queryText.trim()) {
      logTimingAndReturn('查询文本为空');
      return;
    }

    // 1. 强力净水：剔除所有系统消息、隐藏状态栏和空消息，只保留真实的对话
    const validChat = chat.filter(x => !x.is_system && !x.is_group_greeting && x.mes);
    
    // 2. v7.1: 理性分支取最近 N 条消息（由上下文长度设置控制）
    const ctxSize = settings.thought_engine_context_size || 3;
    const thoughtContextMessages = validChat.slice(-ctxSize);
    let thoughtContextText = thoughtContextMessages.map(x => {
        const speaker = x.is_user ? 'Jc_ker' : (x.name || 'Char');
        // 剥离附件内容 + 清洗残留的 HTML 标签
        let cleanMes = getTextWithoutAttachments(x).replace(/<[^>]*>/g, '').trim(); 
        return `${speaker}: ${cleanMes}`;
    }).join('\n');

    if (settings.query_instruction_enabled && settings.query_instruction_template) {
      queryText = `Instruct: ${settings.query_instruction_template}\nQuery:${queryText}`;
    }

    const allTasks = getChatTasks(chatId);
    const tasks = allTasks.filter(t => {
      if (t.isRealtime) return settings.realtime_retrieval_enabled !== false;
      return t.enabled;
    });
    if (tasks.length === 0) {
      logTimingAndReturn('无启用任务');
      return;
    }

    const FETCH_LIMIT = settings.max_results || 10;

    // 辅助引擎 1：本地 FAISS 检索发射器（并行查询多个 collection）
    const fetchFaiss = async (searchText, tag) => {
      const taskQueries = tasks.map(async (task) => {
        let collectionId = (task.type === 'external' && task.source) ? task.source : `${chatId}_${task.taskId}`;
        if (task.isRealtime) collectionId = task.taskId; // Fix: 实时库的 taskId 本身就是 collectionId (例如 rt_chatId)

        try {
          const res = await storageAdapter.queryCollection(collectionId, searchText, FETCH_LIMIT);
          if (!res || (!res.metadata && !res.items)) return [];
          const items = res.metadata || res.items || [];
          const distances = res.distances || [];
          const similarities = res.similarities || [];
          const strategy = task.isRealtime ? {
            quota: settings.realtime_quota || 0,
            boost: settings.realtime_boost !== undefined ? settings.realtime_boost : 1.0
          } : (task.retrievalSettings || { quota: 0, boost: 1.0 });
          return items.reduce((acc, item, idx) => {
            if (!item.text) return acc;
            const rawScore = item.score !== undefined ? item.score : (similarities[idx] !== undefined ? similarities[idx] : 1 / (1 + distances[idx]));
            const finalScore = rawScore * strategy.boost; // 乘以倍率
            acc.push({
              text: item.text,
              score: finalScore,
              rawScore: rawScore,
              sourceTag: tag,
              metadata: {
                ...item,
                taskName: task.name,
                taskId: task.taskId,
                strategy: strategy,
                originalIndex: item.decodedOriginalIndex !== undefined ? item.decodedOriginalIndex : (item.originalIndex ?? 0),
                type: item.decodedType || item.type || 'unknown'
              }
            });
            return acc;
          }, []);
        } catch (err) {
          console.error(`[Vectors] Task query failed [${task.name}]:`, err);
          return [];
        }
      });
      const allResults = await Promise.all(taskQueries);
      return allResults.flat();
    };

    // 辅助引擎 2：BM25 关键词检索发射器
    const fetchBM25 = async (searchText) => {
      if (!settings.bm25_enabled) return [];
      try {
        const collectionIds = tasks.map(t => {
          if (t.isRealtime) return t.taskId;
          return (t.type === 'external' && t.source) ? t.source : `${chatId}_${t.taskId}`;
        });
        const res = await storageAdapter.hybridQuery(searchText, FETCH_LIMIT, collectionIds, {
          k1: settings.bm25_k1 ?? 1.2,
          b: settings.bm25_b ?? 0.75,
          min_score: settings.bm25_min_score ?? 0.01
        });

        // 更新 debug UI
        if (res.debug) {
          try {
            $('#bm25_debug_tokens').text(res.debug.query_tokens || '-');
            $('#bm25_debug_matches').text(res.debug.fts_matches || 0);
            $('#bm25_debug_time').text(res.debug.elapsed_ms || 0);
            const preview = (res.items || [])
              .map((r, i) => `${i+1}. [${(r.score || 0).toFixed(3)}] ${(r.text || '')}`)
              .join('\n\n');
            $('#bm25_debug_output').val(preview || '无匹配结果');
          } catch(e) {}
        }

        if (!res || !res.items) return [];
        return res.items.map(item => {
          const tId = item.metadata?.taskId;
          const task = tasks.find(t => t.taskId === tId);
          const strategy = task ? (task.isRealtime ? {
            boost: settings.realtime_boost !== undefined ? settings.realtime_boost : 1.0
          } : (task.retrievalSettings || { boost: 1.0 })) : { boost: 1.0 };
          const finalScore = (item.score || 0) * (strategy.boost ?? 1.0);
          return {
            text: item.text,
            score: finalScore,
            rawScore: item.score || 0,
            sourceTag: 'BM25',
            metadata: {
              ...item,
              taskName: task ? task.name : 'BM25',
              taskId: tId || 'bm25',
              type: 'bm25'
            }
          };
        });
      } catch (err) {
        console.error('[Vectors] BM25 query failed:', err);
        return [];
      }
    };

    // ========== v7.1 Egos（理性分支）==========
    // 前端直调 LLM API 或通过 ArcFess /thought_proxy 后端代理
    const _stepSettingsCache = {};
    const _resolveStepSettings = (stepNum) => {
      if (_stepSettingsCache[stepNum] !== undefined) return _stepSettingsCache[stepNum];
      const custom = settings[`thought_engine_step${stepNum}_custom`];
      if (!custom) { _stepSettingsCache[stepNum] = null; return null; }
      const result = {
        url: settings[`thought_engine_step${stepNum}_url`] || settings.thought_engine_url,
        apiKey: settings[`thought_engine_step${stepNum}_apiKey`] || settings.thought_engine_apiKey,
        model: settings[`thought_engine_step${stepNum}_model`] || settings.thought_engine_model,
        max_tokens: settings[`thought_engine_step${stepNum}_max_tokens`] || settings.thought_engine_max_tokens,
        timeout: settings[`thought_engine_step${stepNum}_timeout`] || settings.thought_engine_timeout,
      };
      _stepSettingsCache[stepNum] = result;
      return result;
    };

    // 🔧 v7.3: 统一的内容提取函数，消除代理/直连两段重复代码
    const _extractContent = (msg, contentMode) => {
      if (!msg) return null;
      let content;
      if (contentMode === 'content_only') {
        content = msg.content || null;
      } else {
        // Use logical OR (||) instead of null coalescing (??) so that empty string "" falls back to reasoning
        content = msg.content || msg.reasoning_content || msg.reasoning;
        if (!content && msg.reasoning_details?.length) {
          content = msg.reasoning_details[0].text || msg.reasoning_details[0];
        }
      }
      if (content && contentMode !== 'raw' && content.includes('\u003Cthink\u003E')) {
        content = content.replace(/\u003Cthink\u003E[\s\S]*?\u003C\/think\u003E/g, '').trim();
      }
      return content || null;
    };

    // 🔧 v7.3: 带指数退避重试的 LLM 调用函数 (致命.Fix#2)
    const callLLM = async (promptText, label, stepOverrides = null) => {
      const useProxy = stepOverrides?.useProxy !== undefined ? stepOverrides.useProxy : (settings.thought_engine_use_proxy !== false);
      let proxyUrl = settings.thought_engine_proxy_url || `http://${window.location.hostname}:8999/thought_proxy`;
      if (proxyUrl.includes('127.0.0.1') && window.location.hostname !== '127.0.0.1') {
          proxyUrl = proxyUrl.replace(/127\.0\.0\.1/g, window.location.hostname);
      }
      if (proxyUrl.includes('localhost') && window.location.hostname !== 'localhost') {
          proxyUrl = proxyUrl.replace(/localhost/g, window.location.hostname);
      }
      const apiUrl = stepOverrides?.url || settings.thought_engine_url;
      const apiKey = stepOverrides?.apiKey || settings.thought_engine_apiKey;
      const model = stepOverrides?.model || settings.thought_engine_model || 'Qwen/Qwen2.5-7B-Instruct';
      const timeoutSec = stepOverrides?.timeout || settings.thought_engine_timeout || 90;
      const maxTokens = stepOverrides?.max_tokens || settings.thought_engine_max_tokens || 4096;
      const temperature = stepOverrides?.temperature !== undefined ? stepOverrides.temperature : (settings.thought_engine_temperature !== undefined ? settings.thought_engine_temperature : 0.9);
      const topP = stepOverrides?.top_p !== undefined ? stepOverrides.top_p : (settings.thought_engine_top_p !== undefined ? settings.thought_engine_top_p : 1.0);
      const topK = stepOverrides?.top_k !== undefined ? stepOverrides.top_k : (settings.thought_engine_top_k !== undefined ? settings.thought_engine_top_k : 0);
      const freqPen = stepOverrides?.frequency_penalty !== undefined ? stepOverrides.frequency_penalty : (settings.thought_engine_frequency_penalty !== undefined ? settings.thought_engine_frequency_penalty : 0);
      const presPen = stepOverrides?.presence_penalty !== undefined ? stepOverrides.presence_penalty : (settings.thought_engine_presence_penalty !== undefined ? settings.thought_engine_presence_penalty : 0);
      const reasoningEffort = stepOverrides?.reasoning_effort !== undefined ? stepOverrides.reasoning_effort : (settings.thought_engine_reasoning_effort || '');

      const retryEnabled = settings.thought_engine_retry_enabled !== false;
      const maxRetries = retryEnabled ? Math.max(0, settings.thought_engine_retry_count ?? 3) : 0;
      const retryDelay = Math.max(100, settings.thought_engine_retry_delay ?? 1000);

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const t0 = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutSec * 1000);

        try {
          let response;
          if (useProxy) {
            let reqBody = {
              url: apiUrl,
              api_key: apiKey,
              auth_type: settings.thought_engine_auth_type || 'bearer',
              model: model,
              messages: [{ role: 'user', content: promptText }],
              temperature: temperature,
              top_p: topP,
              top_k: topK,
              frequency_penalty: freqPen,
              presence_penalty: presPen,
              max_tokens: maxTokens,
              timeout: timeoutSec,
              verify_ssl: false
            };
            if (reasoningEffort) reqBody.reasoning_effort = reasoningEffort;

            response = await fetch(proxyUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(reqBody),
              signal: controller.signal
            });
          } else {
            let reqBody2 = {
              model: model,
              messages: [{ role: 'user', content: promptText }],
              temperature: temperature,
              top_p: topP,
              top_k: topK,
              frequency_penalty: freqPen,
              presence_penalty: presPen,
              max_tokens: maxTokens
            };
            if (reasoningEffort) reqBody2.reasoning_effort = reasoningEffort;

            response = await fetch(apiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
              },
              body: JSON.stringify(reqBody2),
              signal: controller.signal
            });
          }
          clearTimeout(timeoutId);

          let data;
          try {
            data = await response.json();
          } catch (jsonErr) {
            const errMsg = `Non-JSON response: ${jsonErr.message}`;
            if (attempt >= maxRetries) {
              console.warn(`[Vectors] ❌ ${label} 返回非 JSON 格式 (${Date.now() - t0}ms)`, jsonErr.message);
              if (typeof toastr !== 'undefined') toastr.error(`Egos ${label}: API 返回非 JSON 格式`, "Egos Debug", { timeOut: 10000 });
              return null;
            }
            throw new Error(errMsg);
          }
          console.log(`[Vectors] 👁️ ${label} 返回 ->`, data);

          if (!response.ok) {
            const errObj = data.error;
            const errMsg = (typeof errObj === 'object' && errObj !== null)
              ? (errObj.message || errObj.code || JSON.stringify(errObj))
              : (errObj || `HTTP ${response.status}`);
            throw new Error(errMsg);
          }

          // 统一调用提取函数
          if (data.choices && data.choices[0] && data.choices[0].message) {
            const contentMode = settings.thought_engine_content_mode || 'strip_think';
            const content = _extractContent(data.choices[0].message, contentMode);
            if (content != null) return content.trim();
            console.warn(`[Vectors] ❌ ${label} content 为空 (推理模型端点格式)`, JSON.stringify(data.choices[0].message).slice(0, 500));
            return null;
          }

          if (attempt >= maxRetries) {
            console.warn(`[Vectors] ❌ ${label} 拆包失败`, data);
            return null;
          }
          throw new Error(`${label} 拆包格式异常`);

        } catch (err) {
          clearTimeout(timeoutId);
          const elapsed = Date.now() - t0;

          // 还有重试次数 → 延迟后继续
          if (attempt < maxRetries) {
            const delay = retryDelay * (attempt + 1);
            console.warn(`[Vectors] 🔄 ${label} 第 ${attempt + 1}/${maxRetries + 1} 次失败 (${elapsed}ms)，${delay}ms 后重试...`, err.name, err.message);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }

          // 最终失败：报告错误
          console.warn(`[Vectors] ❌ ${label} 全部 ${maxRetries + 1} 次尝试失败 (${elapsed}ms / 配置超时${timeoutSec}s):`, err.name, err.message);
          if (typeof toastr !== 'undefined') {
            const isCompression = label === 'Compression';
            const toastPrefix = isCompression ? "压缩异常" : "Egos异常";
            const toastTitle = isCompression ? "Compression Debug" : "Egos Debug";
            
            if (err.name === 'AbortError') {
              toastr.error(`${toastPrefix} (${(elapsed/1000).toFixed(1)}s / 配置 ${timeoutSec}s)，已降级。`, toastTitle, { timeOut: 10000 });
            } else if (err.message && err.message.includes("429")) {
              toastr.error(`${toastPrefix}被限流 (429)，已降级。`, toastTitle, { timeOut: 10000 });
            } else if (err.message && (err.message.includes("timeout") || err.message.includes("Timeout"))) {
              toastr.error(`${toastPrefix} (API 层超时)，已降级。`, toastTitle, { timeOut: 10000 });
            } else if (err.name === 'TypeError' && err.message && err.message.includes('Failed to fetch')) {
              const modeHint = useProxy
                ? '代理无法连接到 ArcFess 后端 (请检查 vector_server.py 是否运行在 8999 端口)'
                : 'CORS 拦截或端点不可达';
              toastr.error(`${toastPrefix}网络不通: ${modeHint}`, toastTitle, { timeOut: 10000 });
            } else {
              toastr.error(`${toastPrefix} (${(elapsed/1000).toFixed(1)}s): ${err.message}`, toastTitle, { timeOut: 10000 });
            }
          }
          return null;
        }
      }
      return null;
    };

    const fetchThought = async (chatHistoryText) => {
      // 预格式化所有消息，避免多 step 重复做 replace/map 计算
      const formattedLines = validChat.map(x => {
        const speaker = x.is_user ? 'Jc_ker' : (x.name || 'Char');
        const cleanMes = getTextWithoutAttachments(x).replace(/<[^>]*>/g, '').trim();
        return `${speaker}: ${cleanMes}`;
      });
      const stepCtxCache = {};
      const _buildChatHistory = (stepNum) => {
        const stepCtx = settings[`thought_engine_step${stepNum}_context_size`];
        const ctxSize = (stepCtx !== '' && stepCtx !== undefined)
            ? parseInt(stepCtx)
            : (settings.thought_engine_context_size || 3);
        if (stepCtxCache[ctxSize]) return stepCtxCache[ctxSize];
        const text = formattedLines.slice(-ctxSize).join('\n');
        stepCtxCache[ctxSize] = text;
        return text;
      };

      if (!settings.thought_engine_enabled) return null;
      // v7.3: 检查全局 API 设置 OR 任一 Step 的自定义 API 是否可用，不再因全局空而拦截分步配置
      const _hasAnyValidStepApi = () => {
        for (let n = 1; n <= 3; n++) {
          if (settings[`thought_engine_step${n}_enabled`] !== false &&
              settings[`thought_engine_step${n}_custom`] === true &&
              settings[`thought_engine_step${n}_url`] &&
              settings[`thought_engine_step${n}_apiKey`]) {
            return true;
          }
        }
        return false;
      };
      const hasGlobalApi = !!(settings.thought_engine_url && settings.thought_engine_apiKey);
      if (!hasGlobalApi && !_hasAnyValidStepApi()) {
        if (typeof toastr !== 'undefined') toastr.warning("未配置Egos API（全局及分步均无有效设置）", "Egos Debug", { timeOut: 10000 });
        return null;
      }

      const mode = settings.thought_engine_mode || 'cot';

      // ── 多步调用模式：3 次串行 LLM 调用（任一步可独立开关，失败降级而非归零）──
      if (mode === 'multi_call') {
        const step1Enabled = settings.thought_engine_step1_enabled !== false;
        const step2Enabled = settings.thought_engine_step2_enabled !== false;
        const step3Enabled = settings.thought_engine_step3_enabled !== false;

        if (!step1Enabled && !step2Enabled && !step3Enabled) {
          if (typeof toastr !== 'undefined') toastr.warning("多步调用全部禁用，降级为纯感性检索", "Egos Debug", { timeOut: 10000 });
          return null;
        }

        // Step 1: 场景分析
        let sceneAnalysis = '';
        if (step1Enabled) {
          if (typeof toastr !== 'undefined') toastr.info("🧠 Step 1/3: 场景分析...", "Egos", { timeOut: 5000 });
          const step1ChatHistory = _buildChatHistory(1);
          const step1Prompt = settings.thought_engine_step1_prompt.replace('{{chat_history}}', step1ChatHistory);
          sceneAnalysis = await callLLM(step1Prompt, 'Step1-场景', _resolveStepSettings(1));
          if (!sceneAnalysis) {
            sceneAnalysis = '';
            if (typeof toastr !== 'undefined') toastr.warning("场景分析失败，继续执行后续步骤 (场景上下文为空)", "Egos Debug", { timeOut: 10000 });
          }
        } else {
          if (typeof toastr !== 'undefined') toastr.info("⏭️ Step 1/3: 场景分析已跳过", "Egos", { timeOut: 5000 });
        }

        // Step 2: 意图推断（失败时用场景分析兜底）
        let intentAnalysis = null;
        if (step2Enabled) {
          if (typeof toastr !== 'undefined') toastr.info("🧠 Step 2/3: 意图推断...", "Egos", { timeOut: 5000 });
          const step2ChatHistory = _buildChatHistory(2);
          const step2Prompt = settings.thought_engine_step2_prompt
            .replace('{{scene_analysis}}', sceneAnalysis)
            .replace('{{chat_history}}', step2ChatHistory);
          intentAnalysis = await callLLM(step2Prompt, 'Step2-意图', _resolveStepSettings(2));
          if (!intentAnalysis) {
            if (typeof toastr !== 'undefined') toastr.warning("意图推断失败，跳过 Step 2 继续", "Egos Debug", { timeOut: 10000 });
          }
        } else {
          if (typeof toastr !== 'undefined') toastr.info("⏭️ Step 2/3: 意图推断已跳过", "Egos", { timeOut: 5000 });
        }

        // Step 3: 关键词生成（失败时用意图推断兜底，意图推断也失败时用场景分析兜底）
        let keywords = null;
        if (step3Enabled) {
          if (typeof toastr !== 'undefined') toastr.info("🧠 Step 3/3: 关键词生成...", "Egos", { timeOut: 5000 });
          const step3ChatHistory = _buildChatHistory(3);
          const step3Prompt = settings.thought_engine_step3_prompt
            .replace('{{scene_analysis}}', sceneAnalysis)
            .replace('{{intent_analysis}}', intentAnalysis || sceneAnalysis)
            .replace('{{chat_history}}', step3ChatHistory);
          keywords = await callLLM(step3Prompt, 'Step3-关键词', _resolveStepSettings(3));
          if (!keywords) {
            if (typeof toastr !== 'undefined') toastr.warning("关键词生成失败，使用意图推断作为关键词", "Egos Debug", { timeOut: 10000 });
          }
        } else {
          if (typeof toastr !== 'undefined') toastr.info("⏭️ Step 3/3: 关键词生成已跳过", "Egos", { timeOut: 5000 });
        }

        const fallbackKeywords = keywords || intentAnalysis || sceneAnalysis;
        // 更新持久化展示
        const fullOutput = `场景：${sceneAnalysis || '(已禁用)'}\n意图：${intentAnalysis || '(已禁用/跳过)'}\n关键词：${keywords || '(降级: 使用意图推断)'}`;
        try { $('#vectors_enhanced_thought_output').val(fullOutput); $('#thought_output_mode').text('多步调用'); } catch(e) {}

        if (fallbackKeywords && typeof toastr !== 'undefined') {
          const preview = fallbackKeywords.length > 80 ? fallbackKeywords.slice(0, 80) + '...' : fallbackKeywords;
          toastr.success(`✅ 萃取意图: ${preview}`, "Egos", { timeOut: 15000 });
        }
        return fallbackKeywords;
      }

      // ── CoT 模式（默认）：单次调用，内置思维链 ──
      const cotPrompt = settings.thought_engine_prompt.replace('{{chat_history}}', chatHistoryText);
      if (typeof toastr !== 'undefined') toastr.info("🧠 Egos运转中...", "Egos", { timeOut: 5000 });
      const thoughtStart = Date.now();
      const result = await callLLM(cotPrompt, 'CoT');

      if (result) {
        try {
          $('#vectors_enhanced_thought_output').val(result);
          $('#thought_output_mode').text('CoT');
          $('#thought_output_time').text((Date.now() - thoughtStart) + 'ms');
        } catch(e) {}
        if (typeof toastr !== 'undefined') {
          const preview = result.length > 80 ? result.slice(0, 80) + '...' : result;
          toastr.success(`✅ 萃取意图: ${preview}`, "Egos", { timeOut: 15000 });
        }
        // v7.3: 从CoT完整输出中提取纯关键词部分用于向量检索 (致命.Fix#6)
        const kwIdx = result.search(/关键词[：:]/);
        if (kwIdx !== -1) {
          const extracted = result.substring(kwIdx).replace(/^关键词[：:]\s*/, '').trim();
          if (extracted.length > 0 && extracted.length < 200) return extracted;
        }
      }
      return result;
    };

    // ═══════════════════════════════════════════════
    // v7.2 三轨并发启动 + 4_Track 层级总管 -> 四轨并发 + 权重融合
    // ═══════════════════════════════════════════════
    let kimiKeywords = null;
    let rawQueryPromise = fetchFaiss(queryText, 'RAW');
    let thoughtQueryPromise = Promise.resolve([]);
    let bm25Promise = fetchBM25(queryText);
    let hierarchicalPromise = Promise.resolve('');

    if (settings.realtime_sync_enabled && settings.realtime_retrieval_enabled && (settings.ve_hierarchical_floor_enabled || settings.ve_hierarchical_date_enabled)) {
      hierarchicalPromise = fetchHierarchicalMemory(chatId, queryText);
    }

    if (settings.thought_engine_enabled) {
      if (typeof toastr !== 'undefined') toastr.info("🔍 三轨检索启动...", "ArcFess", { timeOut: 4000 });
      thoughtQueryPromise = fetchThought(thoughtContextText).then(async (thoughtOutput) => {
        if (thoughtOutput) {
          kimiKeywords = thoughtOutput;
          console.log("[Vectors] Egos输出 ->", thoughtOutput);
          return await fetchFaiss(thoughtOutput, 'THOUGHT');
        }
        if (typeof toastr !== 'undefined') toastr.warning("理性分支无产出，降级为双轨检索", "ArcFess", { timeOut: 10000 });
        return [];
      });
    }

    // 等待四条时间线收束
    const [rawResults, thoughtResults, bm25Results, hierarchicalText] = await Promise.all([
      rawQueryPromise, 
      thoughtQueryPromise, 
      bm25Promise, 
      hierarchicalPromise
    ]);

    // ── v7.2 权重融合 ──
    const preLimit = settings.rerank_top_n || 20;
    const wRaw = settings.weight_raw ?? 40;
    const wThought = settings.weight_thought ?? 40;
    const wBM25 = settings.weight_bm25 ?? 20;
    const wTotal = (wRaw + wThought + wBM25) || 1;

    rawResults.sort((a, b) => b.score - a.score);
    thoughtResults.sort((a, b) => b.score - a.score);
    bm25Results.sort((a, b) => b.score - a.score);

    const rawQuota = Math.round(preLimit * wRaw / wTotal);
    const thoughtQuota = Math.round(preLimit * wThought / wTotal);
    const bm25Quota = Math.round(preLimit * wBM25 / wTotal);

    let combinedPool = [
      ...thoughtResults.slice(0, thoughtQuota),
      ...rawResults.slice(0, rawQuota),
      ...bm25Results.slice(0, bm25Quota)
    ];

    // 不足 → 按分数补位
    if (combinedPool.length < preLimit) {
      const usedTexts = new Set(combinedPool.map(i => i.text));
      const overflow = [...rawResults, ...thoughtResults, ...bm25Results]
        .filter(i => !usedTexts.has(i.text))
        .sort((a, b) => b.score - a.score)
        .slice(0, preLimit - combinedPool.length);
      combinedPool.push(...overflow);
    }

    // 三轨收束统计 toast
    if (typeof toastr !== 'undefined') {
      toastr.info(`📊 感性${rawResults.length} + 理性${thoughtResults.length} + BM25:${bm25Results.length} → 去重前${combinedPool.length}条`, "三轨收束", { timeOut: 6000 });
    }

    // ── 文本去重（按 text 内容完全匹配） ──
    const uniquePool = new Map();
    combinedPool.forEach(item => {
      if (!uniquePool.has(item.text) || uniquePool.get(item.text).score < item.score) {
        uniquePool.set(item.text, item);
      }
    });

    let allRawResults = Array.from(uniquePool.values());
    allRawResults.sort((a, b) => b.score - a.score); // v7.1: 全局排序，确保 Reranker 关闭时 top N 为最高分
    const resultsBeforeRerank = allRawResults.slice();
    let rerankApplied = false;

    // ── Reranker 双 Prompt 编码 ──
    if (rerankService && rerankService.isEnabled() && allRawResults.length > 0) {
      if (typeof toastr !== 'undefined') toastr.info("🔄 Reranker 精排中...", "ArcFess", { timeOut: 5000 });

      const rerankQuery = kimiKeywords
        ? `${queryText} [意图:${kimiKeywords}]`
        : queryText;
      allRawResults = await rerankService.rerankResults(rerankQuery, allRawResults);
      rerankApplied = true;

      if (typeof toastr !== 'undefined') {
        toastr.success(`✅ 精排完成: ${resultsBeforeRerank.length} → ${allRawResults.length} 条`, "ArcFess Reranker", { timeOut: 10000 });
      }
    }

    // ── 【核心重构】底层保底算法与溢出回退机制 ──
    const MAX_RESULTS = settings.max_results || 10;
    
    let reservedItems = [];
    let remainingItems = [];
    
    const groupedByTask = new Map();
    allRawResults.forEach(item => {
        const tId = item.metadata?.taskId || 'unknown';
        if (!groupedByTask.has(tId)) groupedByTask.set(tId, []);
        groupedByTask.get(tId).push(item);
    });

    const taskQuotas = new Map();
    tasks.forEach(t => {
        let q = t.retrievalSettings?.quota || 0;
        if (t.isRealtime) q = settings.realtime_quota || 0;
        if (q > 0) taskQuotas.set(t.taskId, q);
    });

    groupedByTask.forEach((items, tId) => {
        const quota = taskQuotas.get(tId) || 0;
        if (quota > 0) {
            reservedItems.push(...items.slice(0, quota));
            remainingItems.push(...items.slice(quota));
        } else {
            remainingItems.push(...items);
        }
    });

    let topResults = [];
    if (reservedItems.length > MAX_RESULTS) {
        if (settings.allow_quota_overflow) {
            topResults = reservedItems;
        } else {
            reservedItems.sort((a, b) => b.score - a.score);
            topResults = reservedItems.slice(0, MAX_RESULTS);
        }
    } else {
        remainingItems.sort((a, b) => b.score - a.score);
        const remainingSlots = MAX_RESULTS - reservedItems.length;
        topResults = [...reservedItems, ...remainingItems.slice(0, remainingSlots)];
    }

    topResults.sort((a, b) => b.score - a.score);

    // ── Contextual Compression (LLM Summarization) ──
    if (settings.compression_enabled && topResults.length > 0) {
      if (typeof toastr !== 'undefined') toastr.info("🔄 上下文压缩中...", "ArcFess", { timeOut: 5000 });
      
      const contextCount = parseInt(settings.compression_context_messages) || 3;
      const recentContext = chat.slice(-contextCount)
        .map(m => `${m.is_user ? 'User' : (m.name || 'Char')}: ${m.mes}`)
        .join('\n\n');
      
      const batchSize = Math.max(1, parseInt(settings.compression_batch_size) || 5);
      const compressedResults = [];
      
      for (let i = 0; i < topResults.length; i += batchSize) {
        const batch = topResults.slice(i, i + batchSize);
        const batchPromises = batch.map(async (item) => {
          const prompt = `${settings.compression_prompt}\n\n[当前对话上下文]\n${recentContext}\n\n[待判断的记忆碎片]\n${item.text}`;
          
          try {
            const response = await callLLM(prompt, 'Compression', {
              url: settings.compression_url,
              apiKey: settings.compression_apiKey,
              model: settings.compression_model,
              useProxy: settings.compression_use_proxy,
              timeout: 90,
              max_tokens: settings.compression_max_tokens || 4096,
              temperature: settings.compression_temperature,
              top_p: settings.compression_top_p,
              top_k: settings.compression_top_k,
              frequency_penalty: settings.compression_frequency_penalty,
              presence_penalty: settings.compression_presence_penalty,
              reasoning_effort: settings.compression_reasoning_effort
            });
            
            // 兼容推理模型：推理模型会在思考过程中（reasoning_content）重复 prompt，导致普通的 includes 误杀。
            // 因此我们只检查最终输出的末尾部分（最后30个字符）是否包含【丢弃】，或者全文就是丢弃。
            const cleanResponse = response ? response.trim() : '';
            const isDiscarded = response && (
              cleanResponse === '【丢弃】' || 
              cleanResponse === '丢弃' || 
              cleanResponse.slice(-30).includes('【丢弃】')
            );

            if (isDiscarded) {
              return null; // 剔除
            } else if (response) {
              // 替换文本
              return { ...item, text: response };
            } else {
              return item; // 异常/空返回，保留原样
            }
          } catch (e) {
            console.warn('[Vectors] Compression failed for chunk, keeping original text', e);
            return item; // 原样保留
          }
        });
        
        const processedBatch = await Promise.all(batchPromises);
        compressedResults.push(...processedBatch.filter(Boolean));
      }
      
      topResults = compressedResults;
      
      if (typeof toastr !== 'undefined') {
        toastr.success(`✅ 压缩完成: 剩余 ${topResults.length} 条`, "ArcFess Compression", { timeOut: 5000 });
      }
    }

    // ── v7.1 Prompt 组装（并合 4_Track 层级与时间规则） ──
    let insertedText = '';

    if (topResults.length > 0) {
      const memoryTexts = topResults.map(r => r.text).filter(onlyUnique).join('\n\n---\n\n');
      insertedText = substituteParamsExtended(settings.template, { text: memoryTexts });
    }

    if (hierarchicalText) {
      insertedText = (insertedText ? (insertedText + '\n\n') : '') + hierarchicalText;
    }

    let injectRuleText = '';
    if (settings.realtime_sync_enabled && (settings.ve_hierarchical_floor_enabled || settings.ve_hierarchical_date_enabled) && settings.ve_hierarchical_inject_date_rule) {
      const today = getCurrentDateString();
      injectRuleText = `\n\n[System Rule: The current real-world date is ${today}. You MUST append <ArcTime: ${today}> at the very end of your response to mark the current story time.]`;
    }

    if (insertedText || injectRuleText) {
      insertedText = (insertedText || '') + injectRuleText;

      lastInjectedContent = insertedText;
      lastInjectedStats = {
        totalChars: insertedText.length,
        finalCount: topResults.length,
        senseCount: rawResults.length,
        reasonCount: thoughtResults.length,
        bm25Count: bm25Results.length,
        rerankApplied: rerankApplied,
      };

      lastQueryDetails = {
        queryText: queryText,
        resultsBeforeRerank: resultsBeforeRerank,
        resultsAfterRerank: topResults,
        finalSortedResults: topResults,
        rerankApplied: rerankApplied,
        kimiKeywords: kimiKeywords,
        _resultsBeforeRerankSnapshot: resultsBeforeRerank,
        _deepCopyDone: false
      };

      setExtensionPrompt(EXTENSION_PROMPT_TAG, insertedText, settings.position, settings.depth, settings.include_wi, settings.depth_role);
    } else {
      setExtensionPrompt(EXTENSION_PROMPT_TAG, '', settings.position, settings.depth, settings.include_wi, settings.depth_role);
    }

    // ── 通知 ──
    if (settings.show_query_notification) {
      const currentTime = Date.now();
      if (currentTime - lastNotificationTime >= NOTIFICATION_COOLDOWN) {
        const count = topResults.length;
        let msg = count > 0
          ? `检索完成: 汇聚 ${count} 条碎片`
          : `检索完成: 记忆之海寂静无声`;

        if (settings.detailed_notification && count > 0) {
          msg += `<br><small>感性${rawResults.length} | 理性${thoughtResults.length} | BM25:${bm25Results.length} | 精排后${count}</small>`;
        }
        
        const rtHits = topResults.filter(r => r.metadata?.taskId?.startsWith('rt_')).length;
        if (rtHits > 0 || window.vectors_rt_last_synced_index !== undefined) {
          let rtMsg = `⚡ 实时`;
          if (window.vectors_rt_last_synced_index !== undefined) {
             const offset = settings.realtime_floor_offset || 0;
             const displayLayer = window.vectors_rt_last_synced_index + offset;
             rtMsg += ` (已同步至 #${displayLayer} 层)`;
          }
          if (rtHits > 0) {
             rtMsg += ` 命中: ${rtHits} 条`;
          }
          msg += `<br><small style="color: #38bdf8; font-weight: bold;">${rtMsg}</small>`;
        }

        toastr[count > 0 ? 'info' : 'warning'](msg, 'ArcFess');
        lastNotificationTime = currentTime;
      }
    }

    console.log(`[Vectors] 全链路完成 - 耗时: ${(performance.now() - queryStartTime).toFixed(2)}ms`);

  } catch (error) {
    console.error('[Vectors] 检索失败', error);
  } finally {
    // 3. 无论成功失败，最后必须释放锁，否则下次无法运行
    isQuerying = false;
  }
}

window['vectors_enhanced_rearrangeChat'] = rearrangeChat;

/**
 * Get the last injected content for preview
 * @returns {Object} Last injected content and stats
 */
function getLastInjectedContent() {
  // 【Plan B 懒加载】只有用户点击预览时才执行深拷贝
  if (lastQueryDetails && lastQueryDetails._resultsBeforeRerankSnapshot && !lastQueryDetails._deepCopyDone) {
    lastQueryDetails.resultsBeforeRerank = JSON.parse(JSON.stringify(lastQueryDetails._resultsBeforeRerankSnapshot));
    lastQueryDetails._deepCopyDone = true;
  }
  return {
    content: lastInjectedContent,
    stats: lastInjectedStats,
    details: lastQueryDetails
  };
}

window['vectors_getLastInjectedContent'] = getLastInjectedContent;




/**
 * Gets request body for vector operations
 * @param {object} args Additional arguments
 * @returns {object} Request body
 */
function getVectorsRequestBody(args = {}) {
  const body = Object.assign({}, args);

  switch (settings.source) {
    case 'transformers':
      // Local transformers
      if (settings.local_model) {
        body.model = settings.local_model;
      }
      break;
    case 'vllm':
      body.apiUrl = settings.vllm_url || textgenerationwebui_settings.server_urls[textgen_types.VLLM];
      body.model = settings.vllm_model;
      // 优先使用插件设置的API key，如果为空则使用文本生成API的设置
      body.apiKey = settings.vllm_api_key || textgenerationwebui_settings.api_key_vllm || '';
      break;
    case 'ollama':
      body.model = settings.ollama_model;
      body.apiUrl =
        settings.ollama_url ||
        textgenerationwebui_settings.server_urls[textgen_types.OLLAMA] ||
        'http://localhost:11434';
      body.keep = !!settings.ollama_keep;
      break;
    case 'openai':
      body.apiUrl = settings.openai_url || 'https://api.openai.com/v1';
      body.model = settings.openai_model || 'text-embedding-3-small';
      body.apiKey = settings.openai_api_key || '';
      break;
  }

  body.source = settings.source;
  return body;
}

/**
 * Throws if the vector source is invalid
 */
function throwIfSourceInvalid() {
  if (settings.source === 'vllm') {
    if (!settings.vllm_url && !textgenerationwebui_settings.server_urls[textgen_types.VLLM]) {
      throw new Error('vLLM URL not configured');
    }
    if (!settings.vllm_model) {
      throw new Error('vLLM model not specified');
    }
  }

  if (settings.source === 'ollama') {
    if (!settings.ollama_url && !textgenerationwebui_settings.server_urls[textgen_types.OLLAMA]) {
      throw new Error('Ollama URL not configured');
    }
    if (!settings.ollama_model) {
      throw new Error('Ollama model not specified');
    }
    // ollama_url 是可选的，因为有默认值 http://localhost:11434
  }

  if (settings.source === 'openai') {
    if (!settings.openai_url) {
      throw new Error('OpenAI URL not configured');
    }
    if (!settings.openai_model) {
      throw new Error('OpenAI model not specified');
    }
    if (!settings.openai_api_key) {
      throw new Error('OpenAI API Key not configured');
    }
  }
}












function updateRealtimeDashboard() {
  const context = getContext();
  if (!context || !context.chatId) return;

  const collectionId = `rt_${context.chatId}`;
  const rtTask = settings.vector_tasks?.[context.chatId]?.find(t => t.taskId === collectionId);
  const chat = context.chat || [];

  // 计算预计符合同步条件的总消息数
  let expectedCount = 0;
  chat.forEach((msg, index) => {
    if (index === chat.length - 1 && !msg.is_user && !msg.is_system) return; // Swipe Immunity: 跳过处于最末尾的AI消息

    if (!msg.mes || !msg.mes.trim()) return;
    if (msg.is_user && !settings.realtime_sync_user) return;
    if (!msg.is_user && !msg.is_system && !settings.realtime_sync_assistant) return;
    if (msg.is_system && !settings.realtime_sync_hidden) return;
    
    const fileLength = msg?.extra?.fileLength || 0;
    let text = msg.mes;
    if (fileLength > 0 && fileLength <= text.length) {
        text = text.substring(fileLength).trim();
    }
    if (text) {
      expectedCount++;
    }
  });

  const syncedCount = rtTask ? (rtTask.itemCount || 0) : 0;
  const pendingCount = Math.max(0, expectedCount - syncedCount);

  if (rtTask) {
    if (pendingCount > 0) {
      $('#ve_rt_status').html(`<i class="fa-solid fa-rotate fa-spin-hover"></i> 有 ${pendingCount} 条未同步`).css('color', '#fbbf24');
    } else {
      $('#ve_rt_status').html('<i class="fa-solid fa-check"></i> 实时同步中').css('color', '#34d399');
    }
    $('#ve_rt_id').text(rtTask.taskId);
    $('#ve_rt_count').text(syncedCount);
    $('#ve_rt_expected').text(expectedCount);
    $('#ve_rt_pending').text(pendingCount);
    $('#ve_rt_last_sync').text(new Date(rtTask.timestamp).toLocaleTimeString());
    
    let percentage = expectedCount > 0 ? (syncedCount / expectedCount) * 100 : 0;
    if (percentage > 100) percentage = 100;
    $('#ve_rt_progress_bar').css('width', `${percentage}%`);
  } else {
    $('#ve_rt_status').text(`❌ 未建库 (请点击下方扫描建库)`).css('color', '#fbbf24');
    $('#ve_rt_id').text(collectionId);
    $('#ve_rt_count').text('0');
    $('#ve_rt_expected').text(expectedCount);
    $('#ve_rt_pending').text(expectedCount);
    $('#ve_rt_last_sync').text('-');
    $('#ve_rt_progress_bar').css('width', `0%`);
    $('#ve_rt_cutoff_notice').hide();
  }
}

// ================= 实时向量化 (增量同步) 逻辑 =================
const rtSyncLocks = new Set();
const rtSyncFollowUps = new Set();

async function syncChatVectors(manualTrigger = false) {
  if (!settings.master_enabled || !settings.realtime_sync_enabled) return;
  const context = getContext();
  if (!context || !context.chatId || !context.chat) return;

  const chatId = context.chatId;
  const chat = context.chat;
  
  if (rtSyncLocks.has(chatId)) {
    if (manualTrigger) {
      toastr.warning('实时同步任务已在后台运行中，请等待其完成。');
    } else {
      rtSyncFollowUps.add(chatId);
    }
    return;
  }
  
  const collectionId = `rt_${chatId}`; // 使用独立前缀，避免与旧版全量冲突

  try {
    rtSyncLocks.add(chatId);
    
    // --- 极速启动：初始化截断机制 (startIndex) ---
    // 寻找该聊天是否已经注册过专属任务，获取截断点
    let rtTaskIndex = settings.vector_tasks?.[chatId]?.findIndex(t => t.taskId === collectionId) ?? -1;
    let rtTask = rtTaskIndex !== -1 ? settings.vector_tasks[chatId][rtTaskIndex] : null;

    let startIndex = 0;
    if (manualTrigger) {
      startIndex = 0; // 手动强制全量扫描
    } else if (rtTask && rtTask.startIndex !== undefined) {
      startIndex = Math.min(rtTask.startIndex, Math.max(0, chat.length - 50));
    } else if (chat.length > 100) {
      // 如果没注册过，并且聊天很长，为了防止初始化炸手机，只取最后 50 条
      startIndex = chat.length - 50;
    }

    const localMsgs = new Map();
    chat.forEach((msg, index) => {
      if (index < startIndex) return; // 屏蔽掉长对话的古老历史，防止级联重构爆炸
      if (index === chat.length - 1 && !msg.is_user && !msg.is_system) return; // Swipe Immunity

      if (!msg.mes || !msg.mes.trim()) return;
      if (msg.is_user && !settings.realtime_sync_user) return;
      if (!msg.is_user && !msg.is_system && !settings.realtime_sync_assistant) return;
      if (msg.is_system && !settings.realtime_sync_hidden) return;
      
      const fileLength = msg?.extra?.fileLength || 0;
      let text = msg.mes;
      if (fileLength > 0 && fileLength <= text.length) {
          text = text.substring(fileLength).trim();
      }
      if (!text) return;

      const roleName = msg.name || (msg.is_user ? 'User' : 'Character');
      
      // 【核心修复】废弃 index，采用“角色+内容”生成绝对稳定的 Hash
      const stableString = `${roleName}_${text}`;
      const stableHash = stableString.split('').reduce((a,b)=>{a=((a<<5)-a)+b.charCodeAt(0);return a&a},0).toString(36);
      const uid = `${chatId}_${stableHash}`;

      // 这里依旧可以在文本里保留日期前缀供模型阅读，但不参与 Hash
      let datePrefix = '';
      if (msg.send_date) {
        try {
          const d = new Date(msg.send_date);
          if (!isNaN(d.getTime())) {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            datePrefix = `[${yyyy}-${mm}-${dd}] `;
          }
        } catch (e) {}
      }
      const finalText = `${datePrefix}[${roleName}]: ${text}`;
      
      localMsgs.set(uid, {
        text: finalText,
        metadata: { uid, index, is_user: msg.is_user, name: msg.name, is_hidden: msg.is_system === true }
      });
    });

    // --- 引入“幽灵缓存” (Memory Cache) ---
    if (!window.vectors_rt_cache) window.vectors_rt_cache = new Map();
    let remoteUidSet;
    if (window.vectors_rt_cache.has(collectionId)) {
      remoteUidSet = window.vectors_rt_cache.get(collectionId);
    } else {
      const remoteUids = await storageAdapter.getCollectionIds(collectionId);
      remoteUidSet = new Set(remoteUids);
      window.vectors_rt_cache.set(collectionId, remoteUidSet);
    }

    const toInsert = [];
    for (const [uid, data] of localMsgs.entries()) {
      if (!remoteUidSet.has(uid)) toInsert.push(data);
    }
    const toDelete = [];
    for (const uid of remoteUidSet) {
      if (!localMsgs.has(uid)) toDelete.push(uid);
    }

    // --- 拦截大量同步机制 ---
    // 如果是首次建库（remote 为空）或者存在大量未同步记录，拦截并询问用户
    if ((manualTrigger || remoteUidSet.size === 0) && toInsert.length > 5) {
      const confirm = await callGenericPopup(
        `<div><strong>创建专属向量库</strong><p>检测到当前会话有 <b>${toInsert.length}</b> 条记录未同步。</p><p>要继续使用实时同步，必须先将其写入专属库。这可能需要消耗一定时间，是否立即执行？</p><small style="color:var(--warning)">点击“否”将自动关闭该对话的实时同步功能。</small></div>`,
        POPUP_TYPE.CONFIRM, { okButton: '立即建库/同步', cancelButton: '否' }
      );
      if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
        settings.realtime_sync_enabled = false;
        $('#vectors_enhanced_realtime_sync_enabled').prop('checked', false);
        $('#vectors_enhanced_realtime_settings').slideUp();
        saveSettingsDebounced();
        return; // 用户反悔，直接退出
      }
    }

    // --- 确保专属实时任务已注册，以便 updateRealtimeDashboard 读取数据并展示正确的初始状态 ---
    let currentRtTaskIndex = -1;
    if (!settings.vector_tasks) settings.vector_tasks = {};
    if (!settings.vector_tasks[chatId]) settings.vector_tasks[chatId] = [];
    const initialItemCount = remoteUidSet.size - toDelete.length;
    
    currentRtTaskIndex = settings.vector_tasks[chatId].findIndex(t => t.taskId === collectionId);
    if (currentRtTaskIndex === -1) {
      settings.vector_tasks[chatId].push({
        taskId: collectionId,
        name: '[专属实时记忆库]',
        type: 'realtime',
        isRealtime: true,
        itemCount: initialItemCount,
        originalItemCount: chat.length,
        timestamp: Date.now(),
        enabled: true,
        startIndex: startIndex
      });
      currentRtTaskIndex = settings.vector_tasks[chatId].length - 1;
    } else {
      settings.vector_tasks[chatId][currentRtTaskIndex].itemCount = initialItemCount;
      settings.vector_tasks[chatId][currentRtTaskIndex].originalItemCount = chat.length;
      settings.vector_tasks[chatId][currentRtTaskIndex].timestamp = Date.now();
      settings.vector_tasks[chatId][currentRtTaskIndex].startIndex = startIndex;
    }
    saveSettingsDebounced();
    updateRealtimeDashboard();

    if (toInsert.length > 0 || toDelete.length > 0) {
      console.log(`[Vectors Realtime] Sync started. Insert: ${toInsert.length}, Delete: ${toDelete.length}`);
      const progressDiv = $('#vectors_enhanced_realtime_progress');
      const progressBar = $('#vectors_enhanced_realtime_progress_bar');
      const progressText = $('#vectors_enhanced_realtime_progress_text');
      progressDiv.show();

      if (toDelete.length > 0) {
        await storageAdapter.delete(toDelete);
        toDelete.forEach(uid => remoteUidSet.delete(uid));
      }

      if (toInsert.length > 0) {
        const BATCH_SIZE = settings.gen_batch_size || 6;

        for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
          const batch = toInsert.slice(i, i + BATCH_SIZE);
          const dynamicApiDelay = parseInt($('#vectors_api_delay').val() || '0') || 0;
          progressText.text(`${i + batch.length}/${toInsert.length} (延时: ${dynamicApiDelay}ms)`);
          progressBar.val(((i + batch.length) / toInsert.length) * 100);
          
          await storageAdapter.insertVectorItems(collectionId, batch, null, { taskId: `rt_${chatId}` });
          batch.forEach(item => remoteUidSet.add(item.metadata.uid));

          // 实时将写入进度同步到面板 UI 中，实现动态百分比滚动和精确对应的数目对齐
          const currentSyncedCount = remoteUidSet.size + i + batch.length;
          if (currentRtTaskIndex !== -1 && settings.vector_tasks[chatId][currentRtTaskIndex]) {
            settings.vector_tasks[chatId][currentRtTaskIndex].itemCount = currentSyncedCount;
            settings.vector_tasks[chatId][currentRtTaskIndex].timestamp = Date.now();
            saveSettingsDebounced();
            updateRealtimeDashboard();
          }

          if (dynamicApiDelay > 0 && i + BATCH_SIZE < toInsert.length) {
              await new Promise(r => setTimeout(r, dynamicApiDelay));
          }
        }
      }
      
      console.log(`[Vectors Realtime] Sync completed.`);
      if (toInsert.length > 0) {
        window.vectors_rt_last_synced_index = Math.max(...toInsert.map(item => item.metadata.index));
      }
      
      if (manualTrigger) {
        toastr.success('专属记忆库同步已完成！');
      }
      setTimeout(() => progressDiv.fadeOut(), 2000);
    } else {
      window.vectors_rt_last_synced_index = chat.length > 0 ? chat.length - 1 : 0;
      if (manualTrigger) {
        toastr.success('专属记忆库已是最新状态，无需同步。');
      }
    }

    // --- 注册专属库到任务面板 ---
    if (!settings.vector_tasks) settings.vector_tasks = {};
    if (!settings.vector_tasks[chatId]) settings.vector_tasks[chatId] = [];
    const finalItemCount = remoteUidSet.size + toInsert.length - toDelete.length;
    
    // 如果最终库里有东西，就在任务列表中注册/更新它
    if (finalItemCount > 0) {
      const rtTaskIndex = settings.vector_tasks[chatId].findIndex(t => t.taskId === collectionId);
      if (rtTaskIndex === -1) {
        settings.vector_tasks[chatId].push({
          taskId: collectionId,
          name: '[专属实时记忆库]',
          timestamp: Date.now(),
          enabled: true,
          itemCount: finalItemCount,
          originalItemCount: chat.length,
          isRealtime: true, // 用于后续 UI 识别
          startIndex: startIndex
        });
      } else {
        settings.vector_tasks[chatId][rtTaskIndex].itemCount = finalItemCount;
        settings.vector_tasks[chatId][rtTaskIndex].originalItemCount = chat.length;
        settings.vector_tasks[chatId][rtTaskIndex].timestamp = Date.now();
        settings.vector_tasks[chatId][rtTaskIndex].startIndex = startIndex;
      }
      saveSettingsDebounced();
      if (typeof updateTaskList === 'function') {
         updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);
      }
    }

    // === 触发层级引擎实时同步 (第四轨后台流水线) ===
    if (settings.realtime_sync_enabled && (settings.ve_hierarchical_floor_enabled || settings.ve_hierarchical_date_enabled)) {
      syncHierarchicalMemory(chatId, chat).catch(err => console.error('[Hierarchical] Sync error:', err));
    }

  } catch (err) {
    console.error("[Vectors Realtime] Sync failed:", err);
  } finally {
    rtSyncLocks.delete(chatId);
    updateRealtimeDashboard();
    
    if (rtSyncFollowUps.has(chatId)) {
      rtSyncFollowUps.delete(chatId);
      setTimeout(() => syncChatVectors(), 1000);
    }
  }
}

// ==========================================================

// Event handlers
const onChatEvent = debounce(async () => {
  // Update UI lists when chat changes
  await updateFileList();
  updateChatSettings();
  await updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);
  
  // 更新 dashboard 状态（以防它只是被删除了）
  updateRealtimeDashboard();

  // 触发实时同步
  await syncChatVectors();
}, debounce_timeout.relaxed);

/**
 * Cleans up orphaned external tasks when a source chat is deleted
 * @param {string} deletedChatId - The ID of the deleted chat
 */
async function cleanupOrphanedExternalTasks(deletedChatId) {
  console.log(`Vectors: Cleaning up orphaned external tasks for deleted chat: ${deletedChatId}`);

  let totalRemoved = 0;

  // 扫描所有聊天的外挂任务
  for (const [chatId, tasks] of Object.entries(settings.vector_tasks)) {
    if (!tasks || !Array.isArray(tasks)) continue;

    // === 修改：直接删除引用了被删除聊天的外挂任务 ===
    const beforeCount = tasks.length;
    const filtered = tasks.filter(task => {
      if (task.type === "external") {
        const isOrphan = task.sourceChat === deletedChatId || (task.source && task.source.startsWith(`${deletedChatId}_`));
        if (isOrphan) {
          console.log(`Vectors: Removing orphaned external task "${task.name}" from chat ${chatId}`);
        }
        return !isOrphan;
      }
      return true;
    });

    if (filtered.length !== beforeCount) {
      settings.vector_tasks[chatId] = filtered;
      totalRemoved += (beforeCount - filtered.length);
      console.log(`Vectors: Removed ${beforeCount - filtered.length} orphaned external task(s) from chat ${chatId}`);
    }
    // === 修改结束 ===
  }

  if (totalRemoved > 0) {
    Object.assign(extension_settings.vectors_enhanced, settings);
    saveSettingsDebounced();
  }

  // 清理被删除聊天本身的 vector_tasks 记录
  if (settings.vector_tasks[deletedChatId]) {
    delete settings.vector_tasks[deletedChatId];
    Object.assign(extension_settings.vectors_enhanced, settings);
    saveSettingsDebounced();
    console.log(`Vectors: Removed vector_tasks entry for deleted chat ${deletedChatId}`);
  }

  // 顺带清理所有已无任何有效本地任务的僵尸聊天键
  cleanupDeadChatEntries();
}

/**
 * Cleans up invalid chat IDs from vector_tasks
 */
function cleanupInvalidChatIds() {
  if (!settings.vector_tasks) {
    return;
  }

  let hasChanges = false;
  const invalidKeys = [];

  for (const [chatId, tasks] of Object.entries(settings.vector_tasks)) {
    if (!chatId || chatId === 'null' || chatId === 'undefined' || chatId.trim() === '') {
      invalidKeys.push(chatId);
      hasChanges = true;
    }
  }

  if (hasChanges) {
    console.warn('Vectors: Cleaning up invalid chat IDs:', invalidKeys);
    invalidKeys.forEach(key => {
      delete settings.vector_tasks[key];
    });
    console.log('Vectors: Cleaned up invalid chat IDs from vector_tasks');
  }
}

/**
 * 检查一个聊天是否包含有效的本地任务（有实际向量数据的非外挂任务）
 * @param {string} chatId - 聊天ID
 * @returns {boolean}
 */
function hasValidLocalTasks(chatId) {
  const tasks = settings.vector_tasks?.[chatId];
  if (!tasks || !Array.isArray(tasks)) return false;
  return tasks.some(t => t.type !== 'external' && t.itemCount > 0);
}

/**
 * 迁移旧格式外挂任务：补全 sourceChat 和 sourceTaskId
 */
function migrateExternalTaskFields() {
  if (!settings.vector_tasks) return;

  let migratedCount = 0;
  for (const [chatId, tasks] of Object.entries(settings.vector_tasks)) {
    if (!Array.isArray(tasks)) continue;

    for (const task of tasks) {
      if (task.type === 'external' && task.source && (!task.sourceChat || !task.sourceTaskId)) {
        // 从 source 字段解析：source 格式为 "chatId_task_timestamp_random"
        // taskId 总是以 task_ 开头且包含数字时间戳，用正则从末尾可靠提取
        const match = task.source.match(/^(.*)_(task_\d+_[a-zA-Z0-9]+)$/);
        if (match) {
          task.sourceChat = match[1];
          task.sourceTaskId = match[2];
          migratedCount++;
        }
      }
    }
  }

  if (migratedCount > 0) {
    console.log(`Vectors: Migrated ${migratedCount} old external task(s) to new format`);
    Object.assign(extension_settings.vectors_enhanced, settings);
    saveSettingsDebounced();
  }
}

/**
 * 清理已无任何有效本地任务的僵尸聊天键
 */
function cleanupDeadChatEntries() {
  if (!settings.vector_tasks) return;

  let removedCount = 0;
  for (const chatId of Object.keys(settings.vector_tasks)) {
    const tasks = settings.vector_tasks[chatId];
    if (!Array.isArray(tasks)) continue;

    // 保留有有效本地任务的聊天键
    if (!hasValidLocalTasks(chatId)) {
      // 如果该键下还有外挂任务，先检查这些外挂任务是否指向其他有效源
      // 如果指向的源也无效，则一并清理
      const validExternalTasks = tasks.filter(t => {
        if (t.type !== 'external') return false;
        return hasValidLocalTasks(t.sourceChat);
      });

      if (validExternalTasks.length === 0) {
        delete settings.vector_tasks[chatId];
        removedCount++;
      } else if (validExternalTasks.length !== tasks.length) {
        // 只保留有效的外挂任务
        settings.vector_tasks[chatId] = validExternalTasks;
        removedCount += (tasks.length - validExternalTasks.length);
      }
    }
  }

  if (removedCount > 0) {
    console.log(`Vectors: Removed ${removedCount} dead chat entry/entries from vector_tasks`);
    Object.assign(extension_settings.vectors_enhanced, settings);
    saveSettingsDebounced();
  }
}

/**
 * 与后端同步任务列表：删除前端有记录但后端无数据的僵尸本地任务
 * @returns {Promise<number>} 删除的僵尸任务数量
 */
async function syncWithBackendTasks() {
  if (!storageAdapter) {
    console.warn('Vectors: syncWithBackendTasks called before storageAdapter initialized');
    return 0;
  }

  try {
    const activeTaskIds = await storageAdapter.getActiveTasks();
    if (activeTaskIds === null) {
      console.log('Vectors: Backend unreachable, skipping sync');
      return 0;
    }

    let removedCount = 0;
    const allTasks = settings.vector_tasks || {};

    for (const [chatId, tasks] of Object.entries(allTasks)) {
      if (!Array.isArray(tasks)) continue;

      const beforeCount = tasks.length;
      const filtered = tasks.filter(task => {
        // 只检查本地任务（外挂任务不在这里删除，由源有效性检查处理）
        if (task.type === 'external') return true;
        if (!activeTaskIds.has(task.taskId)) {
          console.log(`Vectors Sync: Removing zombie local task "${task.name}" (${task.taskId}) from chat ${chatId} — not found in backend`);
          return false;
        }
        return true;
      });

      if (filtered.length !== beforeCount) {
        settings.vector_tasks[chatId] = filtered;
        removedCount += (beforeCount - filtered.length);
      }
    }

    if (removedCount > 0) {
      Object.assign(extension_settings.vectors_enhanced, settings);
      saveSettingsDebounced();
      console.log(`Vectors: Sync complete. Removed ${removedCount} zombie local task(s).`);
    } else {
      console.log('Vectors: Sync complete. No zombie local tasks found.');
    }

    // 同步后顺带清理僵尸聊天键
    cleanupDeadChatEntries();

    return removedCount;
  } catch (error) {
    console.error('Vectors: syncWithBackendTasks failed:', error);
    return 0;
  }
}

/**
 * Migrates old tag settings to the new structured format.
 * This is a one-time migration that runs if the old `tags` property is found.
 */
function migrateTagSettings() {
  // Check if migration is needed by detecting the presence of the old 'tags' property.
  if (settings.selected_content?.chat?.hasOwnProperty('tags')) {
    console.log('[Vectors] Tag settings migrated to new format.');

    const oldTags = settings.selected_content.chat.tags;
    const newRules = [];

    if (typeof oldTags === 'string' && oldTags.trim()) {
      // Example: "content - thinking" becomes [{type:'include', value:'content'}, {type:'exclude', value:'thinking'}]
      const parts = oldTags.split(' - ');
      const includePart = parts[0].trim();
      const excludePart = parts.length > 1 ? parts[1].trim() : '';

      if (includePart) {
        includePart.split(',').forEach(tag => {
          const trimmedTag = tag.trim();
          if (trimmedTag) {
            newRules.push({ type: 'include', value: trimmedTag, enabled: true });
          }
        });
      }

      if (excludePart) {
        excludePart.split(',').forEach(tag => {
          const trimmedTag = tag.trim();
          if (trimmedTag) {
            newRules.push({ type: 'exclude', value: trimmedTag, enabled: true });
          }
        });
      }
    }

    // Assign the new rules and clean up old properties
    settings.selected_content.chat.tag_rules = newRules;
    delete settings.selected_content.chat.tags;
    settings.tag_rules_version = 2;

    // Settings will be saved later in the initialization process.
  }
}

/**
 * 初始化辅助函数：单个步骤失败只跳过该步骤，不中断整个初始化流程，
 * 避免出现"设置 UI 半绑定、事件未注册"的配置不上状态。
 */
async function safeInit(name, fn) {
  try {
    await fn();
    return true;
  } catch (error) {
    console.error(`Vectors Enhanced: ${name} 初始化失败 (已跳过):`, error);
    if (typeof toastr !== 'undefined') {
      toastr.warning(`ArcFess ${name} 初始化失败: ${error.message}，请刷新页面重试`);
    }
    return false;
  }
}

jQuery(async () => {
  try {
    console.log('Vectors Enhanced: Starting initialization...');

    // 使用独立的设置键避免冲突
    const SETTINGS_KEY = 'vectors_enhanced';

    if (!extension_settings[SETTINGS_KEY]) {
      extension_settings[SETTINGS_KEY] = settings;
    }

    // 深度合并设置，确保所有必需的属性都存在
    deepMerge(settings, extension_settings[SETTINGS_KEY]);
    extension_settings[SETTINGS_KEY] = settings;

    // Setup global settings object on window if not exists
    window.vectorsEnhancedSettings = settings;

  // 在设置加载后运行迁移
  migrateTagSettings();

  // 清理无效的聊天ID
  cleanupInvalidChatIds();

  // 迁移旧格式外挂任务字段
  migrateExternalTaskFields();

  // 清理已无任何有效本地任务的僵尸聊天键
  cleanupDeadChatEntries();


  // 确保 chat types 存在（处理旧版本兼容性）
  if (!settings.selected_content.chat.types) {
    settings.selected_content.chat.types = { user: true, assistant: true };
  }

  // 确保 include_hidden 属性存在
  if (settings.selected_content.chat.include_hidden === undefined) {
    settings.selected_content.chat.include_hidden = false;
  }

  // 确保rerank成功通知设置存在
  if (settings.rerank_success_notify === undefined) {
    settings.rerank_success_notify = true;
  }

  // 确保实验性功能设置存在
  if (settings.query_instruction_enabled === undefined) {
    settings.query_instruction_enabled = false;
  }
  if (settings.query_instruction_template === undefined) {
    settings.query_instruction_template = 'Given a query, retrieve relevant passages from the context. Consider all available metadata including floor (chronological position), world info entries, and chapter/section markers to ensure comprehensive retrieval.';
  }
  if (settings.query_instruction_preset === undefined) {
    settings.query_instruction_preset = 'general';
  }
  if (settings.query_instruction_presets === undefined) {
    settings.query_instruction_presets = {
      character: 'Given a character-related query, retrieve passages that describe character traits, personality, relationships, or actions. Consider metadata such as floor (chronological position), world info entries, and chapter markers when evaluating relevance.',
      plot: 'Given a story context, retrieve passages that contain plot-relevant details, foreshadowing, or significant events. Pay attention to metadata including floor numbers (temporal ordering), chapter divisions, and world book entries for contextual relevance.',
      worldview: 'Given a world-building query, retrieve passages that contain setting details, lore information, or world mechanics. Utilize metadata like world info entry names, chapter context, and chronological floor positions to identify relevant content.',
      writing_style: 'Given a writing style query, retrieve passages that exemplify narrative techniques, prose style, or linguistic patterns. Consider metadata such as chapter markers and floor positions to understand stylistic evolution throughout the narrative.',
      general: 'Given a query, retrieve relevant passages from the context. Consider all available metadata including floor (chronological position), world info entries, and chapter/section markers to ensure comprehensive retrieval.'
    };
  }
  if (settings.rerank_deduplication_enabled === undefined) {
    settings.rerank_deduplication_enabled = false;
  }
  if (settings.rerank_deduplication_instruction === undefined) {
    settings.rerank_deduplication_instruction = 'Execute the following operations:\n1. Sort documents by relevance in descending order\n2. Consider documents as duplicates if they meet ANY of these conditions:\n   - Core content overlap exceeds 60% (reduced from 80% for better precision)\n   - Contains identical continuous passages of 5+ words\n   - Shares the same examples, data points, or evidence\n3. When evaluating duplication, consider metadata differences:\n   - Different originalIndex values indicate temporal separation\n   - Different chunk numbers (chunk=X/Y) from the same entry should be preserved\n   - Different floor numbers represent different chronological positions\n   - Different world info entries or chapter markers indicate distinct contexts\n4. For identified duplicates, keep only the most relevant one, demote others to bottom 30% positions (reduced from 50% for gentler deduplication)';
  }

  // 迁移模板预设数据结构
  if (settings.template_presets) {
    // 确保有3个默认的自定义模板
    if (!settings.template_presets.custom || settings.template_presets.custom.length === 0) {
      settings.template_presets.custom = [
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
      ];
    } else if (settings.template_presets.custom.length > 0) {
      // 如果用户有旧的自定义预设，保留前3个并确保ID正确
      const existingCustom = settings.template_presets.custom;
      const newCustom = [
        existingCustom[0] || { id: 'custom1', name: '自定义模板1', template: '', description: '用户自定义模板' },
        existingCustom[1] || { id: 'custom2', name: '自定义模板2', template: '', description: '用户自定义模板' },
        existingCustom[2] || { id: 'custom3', name: '自定义模板3', template: '', description: '用户自定义模板' }
      ];

      // 确保ID正确
      newCustom[0].id = 'custom1';
      newCustom[1].id = 'custom2';
      newCustom[2].id = 'custom3';

      settings.template_presets.custom = newCustom;
    }
  }

   // 确保所有必需的结构都存在
  if (!settings.selected_content.chat.range) {
    settings.selected_content.chat.range = { start: 0, end: -1 };
  }

  // 确保 vector_tasks 存在
  if (!settings.vector_tasks) {
    settings.vector_tasks = {};
  }

  // 确保 vllm_api_key 存在
  if (settings.vllm_api_key === undefined) {
    settings.vllm_api_key = '';
  }

  // 保存修正后的设置 - 使用深度合并而不是浅拷贝
  deepMerge(extension_settings[SETTINGS_KEY], settings);
  saveSettingsDebounced();

  // 创建 SettingsPanel 实例
  console.log('Vectors Enhanced: Creating SettingsPanel...');
  const settingsPanel = new SettingsPanel({
    renderExtensionTemplateAsync,
    targetSelector: '#extensions_settings2'
  });

  // 初始化 SettingsPanel
  console.log('Vectors Enhanced: Initializing SettingsPanel...');
  await safeInit('设置面板', async () => settingsPanel.init());

  // 设置全局SettingsPanel引用
  globalSettingsPanel = settingsPanel;

  // 创建 ConfigManager 实例
  console.log('Vectors Enhanced: Creating ConfigManager...');
  const configManager = new ConfigManager(extension_settings, saveSettingsDebounced);

  // 创建并初始化设置子组件
  console.log('Vectors Enhanced: Creating settings sub-components...');

  const vectorizationSettings = new VectorizationSettings({
    settings,
    configManager,
    onSettingsChange: (field, value) => {
      console.debug(`VectorizationSettings: ${field} changed to:`, value);
      Object.assign(extension_settings.vectors_enhanced, settings);
      saveSettingsDebounced();
    }
  });

  const querySettings = new QuerySettings({
    settings,
    configManager,
    toastr,
    callGenericPopup,
    POPUP_TYPE,
    rearrangeChat,
    getContext,
    getCurrentChatId,
    onSettingsChange: (field, value) => {
      console.debug(`QuerySettings: ${field} changed to:`, value);
      Object.assign(extension_settings.vectors_enhanced, settings);
      saveSettingsDebounced();
    }
  });


  const contentSelectionSettings = new ContentSelectionSettings({
    settings,
    configManager,
    onSettingsChange: (field, value) => {
      console.debug(`ContentSelectionSettings: ${field} changed to:`, value);
      Object.assign(extension_settings.vectors_enhanced, settings);
      saveSettingsDebounced();
    },
    // Inject dependency functions
    updateFileList,
    updateWorldInfoList,
    updateChatSettings,
    renderTagRulesUI,
    showTagExamples,
    scanAndSuggestTags: () => {
      if (typeof scanAndSuggestTags === 'function') {
        scanAndSuggestTags();
      }
    },
    clearTagSuggestions,
    toggleMessageRangeVisibility: (show) => {
      // Implementation for message range visibility toggle
      console.log(`Toggling message range visibility: ${show}`);
    }
  });

  // 初始化设置子组件
  console.log('Vectors Enhanced: Initializing settings sub-components...');
  await safeInit('向量化设置', () => vectorizationSettings.init());
  await safeInit('查询设置', () => querySettings.init());
  await safeInit('内容选择设置', () => contentSelectionSettings.init());

  // 将子组件添加到 SettingsPanel
  settingsPanel.addSubComponent('vectorizationSettings', vectorizationSettings);
  settingsPanel.addSubComponent('querySettings', querySettings);
  settingsPanel.addSubComponent('contentSelectionSettings', contentSelectionSettings);

  // 创建 UI Infrastructure 实例
  console.log('Vectors Enhanced: Creating UI Infrastructure...');

  // 创建 StateManager
  const stateManager = new StateManager({
    eventBus,
    settings,
    configManager
  });

  // 创建 ProgressManager
  const progressManager = new ProgressManager({
    eventBus
  });

  // 创建 EventManager
  const eventManager = new EventManager({
    eventBus,
    eventSource,
    event_types,
    progressManager,
    stateManager
  });

  // 初始化 UI Infrastructure
  console.log('Vectors Enhanced: Initializing UI Infrastructure...');
  stateManager.init();
  progressManager.init();
  eventManager.init();

  // 设置全局引用
  globalStateManager = stateManager;
  globalProgressManager = progressManager;
  globalEventManager = eventManager;

// 创建存储适配器实例
  console.log('Vectors Enhanced: Creating StorageAdapter...');
  storageAdapter = new StorageAdapter({
    getRequestHeaders,
    getVectorsRequestBody,
    throwIfSourceInvalid,
    cachedVectors // <--- 👈 必须确认这一行存在！否则 Adapter 拿不到缓存
  });

  // 创建向量化适配器实例
  console.log('Vectors Enhanced: Creating VectorizationAdapter...');
  vectorizationAdapter = new VectorizationAdapter({
    getRequestHeaders,
    getVectorsRequestBody,
    throwIfSourceInvalid,
    settings,
    textgenerationwebui_settings,
    textgen_types
  });

  // 创建 Rerank 服务实例
  console.log('Vectors Enhanced: Creating RerankService...');
  rerankService = new RerankService(settings, {
    toastr: toastr
  });

  // 暴露到全局以便测试（仅在开发环境）
  if (window.location.hostname === 'localhost' || window.location.search.includes('debug=true')) {
    window.rerankService = rerankService;
  }

  // 创建 SettingsManager 实例
  console.log('Vectors Enhanced: Creating SettingsManager...');
  const settingsManager = new SettingsManager(settings, configManager, {
    extension_settings,
    saveSettingsDebounced,
    updateFileList,
    updateWorldInfoList,
    getChatTasks,
    renameVectorTask,
    removeVectorTask,
    updateTaskList,  // 添加这个函数引用
    toggleMessageRangeVisibility,
    showTagExamples,
    setExtensionPrompt,  // 添加注入API
    substituteParamsExtended,  // 添加模板替换API
    scanAndSuggestTags,
    getContext,
    generateRaw,
    saveChatConditional,  // 添加saveChatConditional
    chat_metadata,  // 添加chat_metadata
    saveChatDebounced,  // 添加saveChatDebounced
    toastr,
    oai_settings,
    getRequestHeaders,
    eventSource,  // 添加eventSource
    event_types,   // 添加event_types
    callGenericPopup,  // 添加callGenericPopup
    POPUP_TYPE,    // 添加POPUP_TYPE
    updateRealtimeDashboard // 添加dashboard刷新
  });

  // TaskManager removed - using legacy format only

  // 添加全局处理函数作为后备
  window.handleExternalTaskImport = async () => {
    console.log('handleExternalTaskImport called');
    if (globalSettingsManager?.externalTaskUI?.showImportDialog) {
      try {
        await globalSettingsManager.externalTaskUI.showImportDialog();
      } catch (error) {
        console.error('Error in showImportDialog:', error);
        if (typeof toastr !== 'undefined') {
          toastr.error('无法打开导入对话框: ' + error.message);
        } else {
          alert('无法打开导入对话框: ' + error.message);
        }
      }
    } else {
      console.error('ExternalTaskUI not initialized');
      if (typeof toastr !== 'undefined') {
        toastr.error('外挂任务UI未初始化，请稍后重试');
      } else {
        alert('外挂任务UI未初始化，请稍后重试');
      }
    }
  };




  // 创建 ActionButtons 实例
  console.log('Vectors Enhanced: Creating ActionButtons...');
  const actionButtons = new ActionButtons({
    settings,
    getVectorizableContent,
    shouldSkipContent,
    extractComplexTag,
    extractHtmlFormatTag,
    extractSimpleTag,
    substituteParams,
    exportVectors,
    vectorizeContent,
    isVectorizing: () => isVectorizing,
    vectorizationAbortController: () => vectorizationAbortController
  });

  // 初始化 ActionButtons
  console.log('Vectors Enhanced: Initializing ActionButtons...');
  actionButtons.init();

  // 设置全局ActionButtons引用
  globalActionButtons = actionButtons;

  // Task system status (legacy mode only)
  window.vectorsTaskSystemStatus = () => {
    const status = {
      taskManagerAvailable: false,
      legacyMode: true,
      storageReady: false,
      systemMode: 'Legacy'
    };
    console.log('Vectors Enhanced Task System Status:', status);
    return status;
  };

  // 初始化所有设置UI
  console.log('Vectors Enhanced: Initializing settings UI...');
  await safeInit('设置UI', () => settingsManager.initialize());
  console.log('Vectors Enhanced: Settings UI initialized');

  // 保存全局引用
  globalSettingsManager = settingsManager;

  // 初始化列表和任务
  await safeInit('列表刷新', () => settingsManager.initializeLists());
  await safeInit('任务列表', () => settingsManager.initializeTaskList());

  // 与后端同步任务列表：删除前端有记录但后端无数据的僵尸本地任务
  const syncedRemoved = await syncWithBackendTasks();
  if (syncedRemoved > 0) {
    // 如果删除了僵尸任务，刷新任务列表UI
    await updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);
  }

  // 初始化标签规则UI
  await safeInit('标签规则UI', () => renderTagRulesUI());

  // 初始化隐藏消息信息
  await safeInit('隐藏消息信息', () => MessageUI.updateHiddenMessagesInfo());

  // Event listeners
  eventSource.on(event_types.MESSAGE_DELETED, onChatEvent);
  eventSource.on(event_types.MESSAGE_EDITED, onChatEvent);
  eventSource.on(event_types.MESSAGE_SENT, onChatEvent);
  eventSource.on(event_types.MESSAGE_RECEIVED, onChatEvent);
  eventSource.on(event_types.MESSAGE_SWIPED, onChatEvent);
  eventSource.on(event_types.CHAT_DELETED, async chatId => {
    console.log(`Vectors: Cleaning up data for deleted chat: ${chatId}`);

    // 清除内存缓存
    cachedVectors.delete(chatId);

    // 获取要删除的任务
    const tasksToDelete = getChatTasks(chatId);

    // 清理向量数据文件
    for (const task of tasksToDelete) {
      // 外挂任务不删除向量文件（向量文件属于源任务）
      if (task.type === 'external') {
        console.log(`Vectors: Skipping external task ${task.taskId} - no vector data to delete`);
        continue;
      }

      try {
        const collectionId = `${chatId}_${task.taskId}`;
        console.log(`Vectors: Deleting vector collection: ${collectionId}`);
        await storageAdapter.purgeVectorIndex(collectionId);
      } catch (error) {
        console.error(`Vectors: Failed to delete vector collection for task ${task.taskId}:`, error);
      }
    }

    // 清理孤儿外挂任务
    await cleanupOrphanedExternalTasks(chatId);

    // 删除任务元数据
    delete settings.vector_tasks[chatId];
    Object.assign(extension_settings.vectors_enhanced, settings);
    saveSettingsDebounced();
  });
  eventSource.on(event_types.GROUP_CHAT_DELETED, chatId => {
    cachedVectors.delete(chatId);
    delete settings.vector_tasks[chatId];
    Object.assign(extension_settings.vectors_enhanced, settings);
    saveSettingsDebounced();
  });
  eventSource.on(event_types.CHAT_CHANGED, async () => {
    await updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);
    MessageUI.updateHiddenMessagesInfo();
    // Auto-cleanup invalid world info selections when switching chats
    if (settings.selected_content.world_info.enabled) {
      await cleanupInvalidSelections();
      await updateWorldInfoList();
    }
  });

  // 监听聊天重新加载事件，以便在使用 /hide 和 /unhide 命令后更新
  eventSource.on(event_types.CHAT_LOADED, async () => {
    await updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);
    MessageUI.updateHiddenMessagesInfo();
  });

  // 添加页面卸载处理器，确保设置立即保存
  $(window).on('beforeunload', () => {
    if (extension_settings.vectors_enhanced) {
      // 使用非防抖版本立即保存
      console.log('Vectors: Page unloading, saving settings immediately');
      // 直接调用保存，绕过防抖
      if (typeof window.SillyTavern !== 'undefined' && window.SillyTavern.saveSettings) {
        window.SillyTavern.saveSettings();
      } else {
        // 备用方案：尝试直接保存到localStorage
        try {
          localStorage.setItem('extensions_settings', JSON.stringify(extension_settings));
        } catch (e) {
          console.error('Vectors: Failed to save settings on unload:', e);
        }
      }
    }
  });

  // 监听向量化总结事件
  document.addEventListener('vectors:vectorize-summary', async (event) => {
    const { taskName, taskId, content, worldName } = event.detail;

    try {
      console.log('[Vectors] 准备向量化总结:', {
        taskName,
        worldName,
        contentCount: content.length,
        content: content
      });

      const chatId = getCurrentChatId();
      if (!chatId || chatId === 'null' || chatId === 'undefined') {
        toastr.error('未选择聊天');
        return;
      }

      // 保存当前选择的完整备份
      const originalSelectedContent = JSON.parse(JSON.stringify(settings.selected_content));

      // 清空所有选择，然后只选中指定的世界书条目
      settings.selected_content = {
        chat: {
          enabled: false,
          range: { start: 0, end: -1 },
          user: true,
          assistant: true,
          include_hidden: false
        },
        files: {
          enabled: false,
          selected: []
        },
        world_info: {
          enabled: true,
          selected: {}  // 先清空
        },
        tag_rules: settings.selected_content.tag_rules || [],
        content_blacklist: settings.selected_content.content_blacklist || ''
      };

      // 只添加指定世界书的指定条目
      settings.selected_content.world_info.selected[worldName] = content.map(entry => entry.uid);

      console.log('[Vectors] 临时设置:', {
        worldInfoSelected: settings.selected_content.world_info.selected
      });

      // 获取要向量化的内容
      const items = await getVectorizableContent(settings.selected_content);

      // 过滤出有效的项目（非空）
      const validItems = items.filter(item => item.text && item.text.trim() !== '');

      if (validItems.length === 0) {
        toastr.warning('世界书条目内容为空或被过滤');
        // 恢复原始设置
        settings.selected_content = originalSelectedContent;
        saveSettingsDebounced();
        return;
      }

      // 获取已处理的项目标识符
      const processedIdentifiers = getProcessedItemIdentifiers(chatId);

      // 过滤出新项目（未被向量化的）
      const newItems = validItems.filter(item => {
        switch (item.type) {
          case 'chat': return !processedIdentifiers.chat.has(item.metadata.index);
          case 'file': return !processedIdentifiers.file.has(item.metadata.url);
          case 'world_info': {
            // 对于世界书，需要同时检查 UID 和世界书名字
            // 统一转换为字符串以确保类型一致
            const uidStr = String(item.metadata.uid);
            if (!processedIdentifiers.world_info.has(uidStr)) {
              // UID 未被处理过，这是新项目
              return true;
            }
            // UID 已存在，检查是否来自同一个世界书
            const processedWorld = processedIdentifiers.world_info_with_world.get(uidStr);
            if (!processedWorld) {
              // 旧格式任务，没有世界书信息，保守起见认为是重复的
              return false;
            }
            // 如果世界书名字不同，则认为是新项目（不同世界书的相同 UID）
            return processedWorld !== item.metadata.world;
          }
          default: return true;
        }
      });

      // 生成自定义任务名称
      const entryNames = content.map(entry => entry.comment || `UID:${entry.uid}`).join('、');
      const customTaskName = `${entryNames} (总结向量化)`;

      // 检查是否有已处理的项目
      const hasProcessedItems = newItems.length < validItems.length;
      let itemsToProcess = newItems;
      let isIncremental = hasProcessedItems;

      if (newItems.length === 0) {
        // 所有项目都已被向量化
        const processedCount = validItems.length;
        const confirm = await callGenericPopup(
          `<div>
            <p>世界书 "${worldName}" 的所有选定条目（${processedCount}条）均已被向量化。</p>
            <p>是否要强制重新向量化这些内容？</p>
          </div>`,
          POPUP_TYPE.CONFIRM,
          { okButton: '是', cancelButton: '否' }
        );

        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
          // 用户选择不重新向量化，恢复设置并返回
          settings.selected_content = originalSelectedContent;
          saveSettingsDebounced();
          return;
        }

        // 用户选择重新向量化
        itemsToProcess = validItems;
        isIncremental = false;
      } else if (hasProcessedItems) {
        // 部分项目已被向量化
        const newCount = newItems.length;
        const processedCount = validItems.length - newCount;

        const confirm = await callGenericPopup(
          `<div>
            <p><strong>世界书 "${worldName}" 的部分条目已被向量化：</strong></p>
            <div style="text-align: left; margin: 10px 0;">
              <p>已处理：${processedCount} 条</p>
              <p>新增内容：${newCount} 条</p>
            </div>
            <p>是否只进行增量向量化（只处理新增内容）？</p>
          </div>`,
          POPUP_TYPE.CONFIRM,
          { okButton: '是，只处理新增', cancelButton: '取消' }
        );

        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
          // 用户取消，恢复设置并返回
          settings.selected_content = originalSelectedContent;
          saveSettingsDebounced();
          return;
        }

        // 用户选择增量向量化
        itemsToProcess = newItems;
        isIncremental = true;
      }

      // 使用自定义任务名进行向量化
      const result = await performVectorization(
        settings.selected_content,
        chatId,
        isIncremental,
        itemsToProcess,
        {
          taskType: 'summary_vectorization',
          customTaskName: customTaskName
        }
      );

      // 恢复原始设置
      settings.selected_content = originalSelectedContent;
      saveSettingsDebounced();

      // 如果向量化成功，且启用了禁用世界书条目的选项
      if (result?.success && extension_settings?.vectors_enhanced?.memory?.disableWorldInfoAfterVectorize) {
        console.log('[Vectors] 准备禁用世界书条目...');
        await disableWorldInfoEntries(worldName, content);
      }

    } catch (error) {
      console.error('[Vectors] 向量化总结失败:', error);
      toastr.error('向量化总结失败: ' + error.message);
      // 确保恢复原始设置
      if (originalSelectedContent) {
        settings.selected_content = originalSelectedContent;
        saveSettingsDebounced();
      }
    }
  });

  // 添加生成空白任务按钮的事件处理器
  $(document).on('click', '#vectors_enhanced_generate_blank_task', async (e) => {
    e.preventDefault();
    console.log('生成空白任务按钮被点击');

    const chatId = getCurrentChatId();
    if (!chatId || chatId === 'null' || chatId === 'undefined') {
      toastr.error('未选择聊天');
      return;
    }

    if (isVectorizing) {
      toastr.warning('已有向量化任务在进行中');
      return;
    }

    try {
      // 创建一个包含占位文本的内容项
      // 使用 file 类型，防止与其他向量化任务冲突
      const blankItem = {
        type: 'file',
        identifier: `import_${Date.now()}`,
        text: '[导入任务占位内容]', // 使用占位文本而不是空白，确保不被过滤
        metadata: {
          url: `import_placeholder_${Date.now()}.txt`,
          name: '导入占位文件',
          size: 1,
          timestamp: new Date().toISOString(),
          source: 'import_task'
        }
      };

      // 使用固定的任务名称
      const customTaskName = '导入任务';

      // 创建一个临时的 content settings，只启用 files
      const blankContentSettings = {
        chat: {
          enabled: false,
          range: { start: 0, end: -1 },
          user: true,
          assistant: true,
          include_hidden: false
        },
        files: {
          enabled: true,
          selected: [blankItem.metadata.url]
        },
        world_info: {
          enabled: false,
          selected: {}
        },
        tag_rules: [],
        content_blacklist: ''
      };

      // 直接执行向量化
      const result = await performVectorization(
        blankContentSettings,
        chatId,
        false, // 不是增量
        [blankItem], // 只包含空白项
        {
          taskType: 'import_task',
          customTaskName: customTaskName,
          skipDeduplication: true // 跳过去重检查
        }
      );

      if (result?.success) {
        toastr.success(`成功创建导入任务`);
        // 刷新任务列表
        await updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);

        // 显示存储路径弹窗
        showImportTaskStoragePath(chatId, result.taskId, customTaskName);
      }
    } catch (error) {
      console.error('创建导入任务失败:', error);
      toastr.error('创建导入任务失败: ' + error.message);
    }
  });

  // === 新增：清理无效任务按钮的事件处理器 ===
  $(document).on('click', '#vectors_enhanced_cleanup_invalid_tasks', async (e) => {
    e.preventDefault();
    console.log('清理无效任务按钮被点击');

    try {
      let totalRemoved = 0;

      // === 步骤1：与后端同步，删除前端有记录但后端无数据的本地僵尸任务 ===
      const backendRemoved = await syncWithBackendTasks();
      totalRemoved += backendRemoved;

      // === 步骤2：扫描外挂任务，检查源是否仍然有效 ===
      const allTasks = settings.vector_tasks || {};
      for (const [chatId, tasks] of Object.entries(allTasks)) {
        if (!tasks || !Array.isArray(tasks)) continue;

        const beforeCount = tasks.length;
        const filtered = tasks.filter(task => {
          if (task.type !== 'external') return true;

          // 使用 hasValidLocalTasks 判断源聊天是否真正有效
          const sourceChatValid = hasValidLocalTasks(task.sourceChat);
          const sourceTaskExists = sourceChatValid && allTasks[task.sourceChat]?.some(t => t.taskId === task.sourceTaskId);

          if (!sourceChatValid || !sourceTaskExists) {
            console.log(`Vectors Cleanup: Removing invalid external task "${task.name}" from chat ${chatId} (sourceChatValid=${sourceChatValid}, sourceTaskExists=${sourceTaskExists})`);
            return false;
          }
          return true;
        });

        if (filtered.length !== beforeCount) {
          settings.vector_tasks[chatId] = filtered;
          totalRemoved += (beforeCount - filtered.length);
        }
      }

      // 步骤3：顺带删除已无任何有效本地任务的僵尸聊天键
      cleanupDeadChatEntries();

      if (totalRemoved > 0) {
        Object.assign(extension_settings.vectors_enhanced, settings);
        saveSettingsDebounced();
        toastr.success(`已清理 ${totalRemoved} 个无效任务（含 ${backendRemoved} 个后端僵尸任务）`);
        // 刷新任务列表
        await updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);
      } else {
        toastr.info('没有发现无效任务');
      }
    } catch (error) {
      console.error('清理无效任务失败:', error);
      toastr.error('清理无效任务失败: ' + error.message);
    }
  });
  // === 新增结束 ===

  // 绑定专属实时库的 UI 手动控制按钮 (使用事件委托，防止 DOM 动态加载导致绑定失效)
  $(document).on('click', '#vectors_enhanced_realtime_build', async (e) => {
    e.preventDefault();
    if (!settings.realtime_sync_enabled) {
      toastr.warning('请先开启上方的 [启用实时记忆同步] 开关');
      return;
    }
    await syncChatVectors(true); // 强制弹窗确认
  });

  $(document).on('click', '#vectors_enhanced_realtime_legacy_purge', async (e) => {
    e.preventDefault();
    const context = getContext();
    if (!context || !context.chatId) return;
    const confirm = await callGenericPopup('确定要清空并删除当前会话的【旧版】实时对话向量库（rt_*）吗？该操作不可逆，将彻底解决以前遗留的破库问题。', POPUP_TYPE.CONFIRM);
    if (confirm === POPUP_RESULT.AFFIRMATIVE) {
      const collectionId = `rt_${context.chatId}`;
      try {
        await storageAdapter.purgeVectorIndex(collectionId);
        // 从任务列表中剥离
        if (settings.vector_tasks[context.chatId]) {
          settings.vector_tasks[context.chatId] = settings.vector_tasks[context.chatId].filter(t => t.taskId !== collectionId);
          saveSettingsDebounced();
          await updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);
        }
        
        // 斩草除根：清理幽灵缓存，防止幻觉
        if (window.vectors_rt_cache) {
          window.vectors_rt_cache.delete(collectionId);
        }
        
        toastr.success('旧版专属实时库清理成功！');
        updateRealtimeDashboard(); // 刷新 UI 状态
      } catch (err) {
        toastr.error('清空失败: ' + err.message);
      }
    }
  });

  /**
   * Show storage path for import task
   * @param {string} chatId - Chat ID
   * @param {string} taskId - Task ID
   * @param {string} taskName - Task name
   */
  function showImportTaskStoragePath(chatId, taskId, taskName) {
    // Get current vector source and model
    const vectorSource = settings?.source || 'unknown';
    const vectorModel = getVectorModel();

    // Construct the full path
    const dataRoot = 'sillytavern/data/default-user';
    const collectionId = `${chatId}_${taskId}`;
    const relativePath = `vectors/${vectorSource}/${collectionId}/${vectorModel || 'default'}/`;
    const fullPath = `${dataRoot}/${relativePath}`;

    // Create modal HTML
    const modalHtml = `
      <div class="vector-storage-modal-overlay" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;">
        <div class="vector-storage-modal" style="background: var(--SmartThemeBlurTintColor); border-radius: 8px; padding: 20px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3); margin: auto; position: relative;">
          <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h3 style="margin: 0;">导入任务存储地址</h3>
            <button class="menu_button" id="close-import-modal" style="padding: 5px 10px;">
              <i class="fa-solid fa-times"></i>
            </button>
          </div>

          <div style="margin-bottom: 1rem;">
            <strong>任务名称:</strong> ${taskName}
          </div>

          <div style="margin-bottom: 1rem;">请将您获取的向量化文件粘贴至下列路径并覆盖：</div>
          <div style="padding: 0.75rem; background: rgba(0,0,0,0.3); border-radius: 4px; font-size: 0.9em; font-family: monospace; word-break: break-all;">
            ${fullPath}
          </div>

          <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--SmartThemeBorderColor);">
            <small style="color: var(--SmartThemeQuoteColor);">
              请您确保使用与分享方相同的向量化模型。
            </small>
          </div>

          <div class="flex-container" style="justify-content: flex-end; gap: 10px; margin-top: 1.5rem;">
            <button class="menu_button" id="copy-import-path" style="width: auto; min-width: fit-content;">
              <i class="fa-solid fa-copy"></i> 复制路径
            </button>
            <button class="menu_button" id="confirm-import-modal" style="width: auto; min-width: fit-content;">
              <i class="fa-solid fa-check"></i> 确定
            </button>
          </div>
        </div>
      </div>
    `;

    // Remove any existing modal
    $('.vector-storage-modal-overlay').remove();

    // Add modal to body
    const $modal = $(modalHtml);
    $('body').append($modal);

    // Bind events
    $modal.on('click', function(e) {
      if (e.target === e.currentTarget) {
        $modal.remove();
      }
    });

    $modal.find('#close-import-modal, #confirm-import-modal').on('click', function() {
      $modal.remove();
    });

    $modal.find('#copy-import-path').on('click', function() {
      const $button = $(this);
      const originalHtml = $button.html();

      // Copy to clipboard
      navigator.clipboard.writeText(fullPath).then(() => {
        $button.html('<i class="fa-solid fa-check"></i> 已复制');
        setTimeout(() => {
          $button.html(originalHtml);
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy path:', err);
        toastr.error('复制失败');
      });
    });
  }

  /**
   * Get vector model based on current settings
   * @returns {string} Model name or empty string
   */
  function getVectorModel() {
    const source = settings?.source;
    if (!source) return '';

    // Different sources have different model settings
    switch (source) {
      case 'openai':
      case 'mistral':
      case 'togetherai':
        return settings?.openai_model || '';
      case 'cohere':
        return settings?.cohere_model || '';
      case 'ollama':
        return settings?.ollama_model || '';
      case 'llamacpp':
        return settings?.llamacpp_model || '';
      case 'vllm':
        return settings?.vllm_model || '';
      case 'voyageai':
        return settings?.voyageai_model || '';
      case 'gemini':
        return settings?.google_model || '';
      case 'google':
        return settings?.google_model || '';
      default:
        return '';
    }
  }

  // Register slash commands
  SlashCommandParser.addCommandObject(
    SlashCommand.fromProps({
      name: 'vec-preview',
      callback: async () => {
        await MessageUI.previewContent(getVectorizableContent, shouldSkipContent, extractComplexTag, extractHtmlFormatTag, extractSimpleTag, settings, substituteParams);
        return '';
      },
      helpString: '预览选中的向量化内容',
    }),
  );

  SlashCommandParser.addCommandObject(
    SlashCommand.fromProps({
      name: 'vec-export',
      callback: async () => {
        await exportVectors();
        return '';
      },
      helpString: '导出向量化内容到文本文件',
    }),
  );

  SlashCommandParser.addCommandObject(
    SlashCommand.fromProps({
      name: 'vec-process',
      callback: async () => {
        await vectorizeContent();
        return '';
      },
      helpString: '处理并向量化选中的内容',
    }),
  );


  // 内容过滤黑名单设置
  $('#vectors_enhanced_content_blacklist').on('input', function () {
    const blacklistText = $(this).val();
    settings.content_blacklist = blacklistText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line);
    Object.assign(extension_settings.vectors_enhanced, settings);
    saveSettingsDebounced();
  });

  // 内容过滤黑名单UI初始化
  $('#vectors_enhanced_content_blacklist').val(
    Array.isArray(settings.content_blacklist) ? settings.content_blacklist.join('\n') : '',
  );

  // 初始化隐藏消息信息显示
  await safeInit('隐藏消息信息显示', () => MessageUI.updateHiddenMessagesInfo());



  // 创建内容提取器接口，供其他组件使用
  window.VectorsEnhanced = window.VectorsEnhanced || {};
  window.VectorsEnhanced.contentExtractor = {
    extractContent: async () => {
      try {
        // 使用现有的 getVectorizableContent 函数
        const content = await getVectorizableContent();
        return content;
      } catch (error) {
        console.error('Failed to extract content:', error);
        return [];
      }
    }
  };

  // 初始化调试模块（如果启用）- 不阻塞主初始化
  initializeDebugModule().catch(err => {
    console.debug('[Vectors] Debug module initialization failed (this is normal in production):', err.message);
  });

    console.log('Vectors Enhanced: Initialization completed successfully');
  } catch (error) {
    console.error('Vectors Enhanced: Failed to initialize:', error);
    toastr.error(`Vectors Enhanced 初始化失败: ${error.message}`);
  }
});

/**
 * 初始化调试模块
 * 根据环境条件动态加载调试功能
 */
async function initializeDebugModule() {
  try {
    // 检查是否应该加载调试模块
    const shouldLoadDebug = (
      window.location.hostname === 'localhost' ||
      window.location.search.includes('debug=true') ||
      localStorage.getItem('vectors_debug_enabled') === 'true'
    );

    if (!shouldLoadDebug) {
      console.debug('[Vectors] Debug module not loaded (not in debug environment)');
      return;
    }

    console.log('[Vectors] Loading debug module...');

    // 动态导入调试模块
    const { createDebugger } = await import('./debug/debugger.js');

    // 创建API接口对象
    const debugAPI = createDebugAPI();

    // 创建并初始化调试器
    const debuggerInstance = await createDebugger(debugAPI);

    console.log('[Vectors] Debug module loaded successfully');

  } catch (error) {
    console.warn('[Vectors] Failed to load debug module (this is normal in production):', error.message);
  }
}

/**
 * Scans current selected content for tags and displays suggestions
 */
async function scanAndSuggestTags() {
    try {

        // Use the new function to get raw content
        const content = await getRawContentForScanning();
        if (!content || content.length === 0) {
            toastr.warning('没有选择任何内容进行扫描');
            return;
        }

        const combinedText = content.map(item => item.text).join('\n\n');
        if (combinedText.length === 0) {
            toastr.warning('选择的内容为空');
            return;
        }

        console.log(`开始扫描标签，总文本长度: ${combinedText.length} 字符`);

        const scanOptions = {
            chunkSize: 50000,
            maxTags: 100,
            timeoutMs: 5000
        };

        const scanResult = await scanTextForTags(combinedText, scanOptions);
        const suggestionResult = generateTagSuggestions(scanResult);
        displayTagSuggestions(suggestionResult.suggestions, scanResult.stats);

        console.log(`标签扫描完成，发现 ${scanResult.stats.tagsFound} 个标签，生成 ${suggestionResult.suggestions.length} 个建议，耗时 ${scanResult.stats.processingTimeMs}ms`);

        if (suggestionResult.suggestions.length > 0) {
            toastr.success(`发现 ${suggestionResult.suggestions.length} 个可用标签`);
        } else {
            toastr.info('未发现可提取的标签');
        }

    } catch (error) {
        console.error('标签扫描失败:', error);
        toastr.error('标签扫描失败: ' + error.message);
    }
}



/**
 * 创建调试API接口
 * 为调试模块提供访问主插件功能的接口
 */
function createDebugAPI() {
  return {
    // jQuery 访问
    jQuery: $,

    // 设置管理
    getSettings: () => settings,
    extension_settings: extension_settings,
    saveSettingsDebounced: saveSettingsDebounced,

    // 聊天管理
    getCurrentChatId: getCurrentChatId,
    getChatTasks: getChatTasks,

    // 内容访问
    getSortedEntries: getSortedEntries,
    getHiddenMessages: getHiddenMessages,

    // 核心功能
    cleanupInvalidSelections: cleanupInvalidSelections,
    updateWorldInfoList: updateWorldInfoList,
    updateTaskList: (getChatTasks, renameVectorTask, removeVectorTask) => updateTaskList(getChatTasks, renameVectorTask, removeVectorTask),
    analyzeTaskOverlap: analyzeTaskOverlap,

    // UI更新
    updateMasterSwitchState: () => updateMasterSwitchStateNew(settings),
    updateChatSettings: updateChatSettings,
    updateFileList: updateFileList,
    updateHiddenMessagesInfo: MessageUI.updateHiddenMessagesInfo,

    // 消息管理
    toggleMessageVisibility: toggleMessageVisibility,
    toggleMessageRangeVisibility: toggleMessageRangeVisibility,

    // 向量操作（如果可用）
    getSavedHashes: storageAdapter ? (collectionId) => storageAdapter.getSavedHashes(collectionId) : null,
    purgeVectorIndex: storageAdapter ? (collectionId) => storageAdapter.purgeVectorIndex(collectionId) : null,

    // 缓存访问（只读）
    cachedVectors: cachedVectors,

    // 通知系统
    toastr: typeof toastr !== 'undefined' ? toastr : null,

    // 事件系统
    eventSource: eventSource,
    event_types: event_types,

    // 调试注册（如果可用）
    registerDebugFunction: null,

    // 上下文访问
    getContext: getContext,

    // 工具函数
    generateTaskId: generateTaskId,
    extractTagContent: extractTagContent,

    // 模块信息
    MODULE_NAME: MODULE_NAME,
    EXTENSION_PROMPT_TAG: EXTENSION_PROMPT_TAG
  };
}




/**
 * 更新隐藏消息信息显示
 */

/**
 * 切换消息的隐藏状态
 * @param {number} messageIndex 消息索引
 * @param {boolean} hide 是否隐藏
 * @returns {Promise<boolean>} 是否成功
 */
async function toggleMessageVisibility(messageIndex, hide) {
  const context = getContext();
  if (!context.chat || messageIndex < 0 || messageIndex >= context.chat.length) {
    console.error('无效的消息索引:', messageIndex);
    return false;
  }

  try {
    // 修改消息的 is_system 属性
    context.chat[messageIndex].is_system = hide;

    // 触发保存
    await context.saveChat();

    // 刷新界面
    await context.reloadCurrentChat();

    return true;
  } catch (error) {
    console.error('切换消息可见性失败:', error);
    return false;
  }
}

/**
 * 批量切换消息范围的隐藏状态
 * @param {number} startIndex 开始索引
 * @param {number} endIndex 结束索引（不包含）
 * @param {boolean} hide 是否隐藏
 * @returns {Promise<void>}
 */
async function toggleMessageRangeVisibility(startIndex, endIndex, hide) {
  const context = getContext();
  if (!context.chat) {
    toastr.error('没有可用的聊天记录');
    return;
  }

  const start = Math.max(0, startIndex);
  const end = Math.min(context.chat.length, endIndex === -1 ? context.chat.length : endIndex + 1);

  if (start >= end) {
    toastr.error('无效的消息范围');
    return;
  }

  try {
    // 批量修改消息的 is_system 属性
    for (let i = start; i < end; i++) {
      context.chat[i].is_system = hide;
    }

    // 触发保存
    await context.saveChat();

    // 刷新界面
    await context.reloadCurrentChat();

    const action = hide ? '隐藏' : '显示';
    toastr.success(`已${action}消息 #${start} 到 #${endIndex}`);
  } catch (error) {
    console.error('批量切换消息可见性失败:', error);
    toastr.error('操作失败');
  }
}

// =========================================================================
// ArcFess 层级记忆引擎 (Hierarchical Engine) 核心实现
// =========================================================================

function getCurrentDateString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function callLlmAPI(prompt, apiType, apiUrl, apiKey, apiModel, systemPrompt = '') {
  if (apiType === 'main') {
    if (typeof generateRaw === 'function') {
      try {
        console.log(`[Hierarchical] Calling SillyTavern main model with prompt length: ${prompt.length}`);
        const response = await generateRaw({
          prompt: prompt,
          systemPrompt: systemPrompt
        });
        return response ? response.trim() : '';
      } catch (err) {
        console.error('[Hierarchical] generateRaw failed:', err);
        throw err;
      }
    } else {
      throw new Error('SillyTavern generateRaw function not found');
    }
  } else {
    const proxyUrl = `http://${window.location.hostname}:8999/thought_proxy`;
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: apiUrl,
        api_key: apiKey,
        auth_type: 'bearer',
        model: apiModel,
        messages: messages,
        temperature: 0.3,
        max_tokens: 4096,
        timeout: 90,
        verify_ssl: false
      })
    });

    if (!response.ok) throw new Error(`API Error: HTTP ${response.status}`);
    const data = await response.json();
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content.trim();
    }
    throw new Error('Malformed API response');
  }
}

// 缓存上一次处理的日期，以防消息轮询重复触发
let lastProcessedDate = '';

async function syncHierarchicalMemory(chatId, chat) {
  if (!settings.realtime_sync_enabled) return;
  const floorEnabled = settings.ve_hierarchical_floor_enabled;
  const dateEnabled = settings.ve_hierarchical_date_enabled;
  if (!floorEnabled && !dateEnabled) return;

  const dummyVector = Array(storageAdapter.embeddingDim || 1024).fill(0);

  // === 1. 楼层轨同步 ===
  if (floorEnabled) {
    const colId = `rt_hier_floor_${chatId}`;
    const dbMemories = await storageAdapter.getCollectionMemories(colId);
    
    const rawMsgs = dbMemories.filter(m => m.metadata && m.metadata.level === 0);
    const lastRawIndex = rawMsgs.length > 0 ? Math.max(...rawMsgs.map(m => m.metadata.index)) : -1;
    
    const toInsert = [];
    chat.forEach((msg, index) => {
      if (index <= lastRawIndex) return;
      if (index === chat.length - 1 && !msg.is_user && !msg.is_system) return; // Swipe Immunity
      if (!msg.mes || !msg.mes.trim()) return;
      if (msg.is_user && !settings.realtime_sync_user) return;
      if (!msg.is_user && !msg.is_system && !settings.realtime_sync_assistant) return;
      if (msg.is_system && !settings.realtime_sync_hidden) return;
      
      const roleName = msg.name || (msg.is_user ? 'User' : 'Character');
      const text = `[楼层 #${index}] [${roleName}]: ${msg.mes}`;
      const uid = `${chatId}_floor_raw_${index}`;
      
      toInsert.push({
        text: text,
        metadata: { uid, index, level: 0, parent_small_id: null }
      });
    });
    
    if (toInsert.length > 0) {
      console.log(`[Hierarchical] Inserting ${toInsert.length} raw messages to ${colId}`);
      const BATCH_SIZE = settings.gen_batch_size || 6;
      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE);
        await storageAdapter.insertVectorItems(colId, batch, null, { taskId: colId });
      }
      dbMemories.push(...toInsert.map(item => ({
        id: item.metadata.uid,
        text: item.text,
        metadata: item.metadata
      })));
    }
    
    // 检查是否需要触发小结 (每 30 楼)
    const floorTrigger = settings.ve_hierarchical_floor_trigger || 30;
    const currentRawMsgs = dbMemories.filter(m => m.metadata && m.metadata.level === 0);
    currentRawMsgs.sort((a, b) => a.metadata.index - b.metadata.index);
    
    const unsummarizedRaw = currentRawMsgs.filter(m => !m.metadata.parent_small_id);
    
    if (unsummarizedRaw.length >= floorTrigger) {
      if (typeof toastr !== 'undefined') toastr.info('🧱 ArcFess: 正在静默生成楼层小总结...', 'Hierarchical Engine');
      const batchToSummarize = unsummarizedRaw.slice(0, floorTrigger);
      const textToSummarize = batchToSummarize.map(m => m.text).join('\n');
      
      const startIndex = batchToSummarize[0].metadata.index;
      const endIndex = batchToSummarize[batchToSummarize.length - 1].metadata.index;
      const scopeTag = `[第${startIndex}层-第${endIndex}层]`;
      
      const prompt = `请为以下对话记录生成一段剧情小结。总结要求：${settings.ve_hierarchical_prompt}\n\n对话记录：\n${textToSummarize}`;
      
      try {
        const summaryText = await callLlmAPI(
          prompt,
          settings.ve_summary_api_type,
          settings.ve_summary_api_url,
          settings.ve_summary_api_key,
          settings.ve_summary_api_model,
          "你是一个小说剧情总结助手。"
        );
        
        if (summaryText) {
          const smallSummaryId = `${chatId}_floor_small_${startIndex}_${endIndex}`;
          const finalSummaryText = `${scopeTag} ${summaryText}`;
          
          const summaryItem = {
            id: smallSummaryId,
            text: finalSummaryText,
            metadata: {
              level: 1,
              node_id: smallSummaryId,
              scope_tag: scopeTag,
              parent_big_id: null,
              message_count: batchToSummarize.length,
              timestamp: Date.now()
            },
            vector: dummyVector,
            collection_id: colId
          };
          
          await storageAdapter.insert(summaryItem);
          
          // 更新原文的 parent_small_id 关联（由于新增了 updateMetadata 接口，这里不需要覆盖向量！）
          for (const msg of batchToSummarize) {
            await storageAdapter.updateMetadata(msg.id, { parent_small_id: smallSummaryId });
          }
          console.log(`[Hierarchical] Floor small summary created: ${smallSummaryId}`);
          
          // 触发大总结检测
          await checkAndCreateBigSummary(chatId, colId, dbMemories, dummyVector);
        }
      } catch (err) {
        console.error('[Hierarchical] Floor summary failed:', err);
      }
    }
  }

  // === 2. 日期轨同步 ===
  if (dateEnabled) {
    const colId = `rt_hier_date_${chatId}`;
    const dbMemories = await storageAdapter.getCollectionMemories(colId);
    
    const rawMsgs = dbMemories.filter(m => m.metadata && m.metadata.level === 0);
    const lastRawIndex = rawMsgs.length > 0 ? Math.max(...rawMsgs.map(m => m.metadata.index)) : -1;
    
    const toInsert = [];
    const dateRegex = new RegExp(settings.ve_hierarchical_date_tag || "<ArcTime:\\s*(.*?)\\s*>");
    
    chat.forEach((msg, index) => {
      if (index <= lastRawIndex) return;
      if (index === chat.length - 1 && !msg.is_user && !msg.is_system) return;
      if (!msg.mes || !msg.mes.trim()) return;
      if (msg.is_user && !settings.realtime_sync_user) return;
      if (!msg.is_user && !msg.is_system && !settings.realtime_sync_assistant) return;
      if (msg.is_system && !settings.realtime_sync_hidden) return;
      
      const match = msg.mes.match(dateRegex);
      const dateVal = match ? match[1].trim() : '';
      
      const roleName = msg.name || (msg.is_user ? 'User' : 'Character');
      const text = `[日期: ${dateVal || '未知'}] [${roleName}]: ${msg.mes}`;
      const uid = `${chatId}_date_raw_${index}`;
      
      toInsert.push({
        text: text,
        metadata: { uid, index, level: 0, date_val: dateVal, parent_small_id: null }
      });
    });
    
    if (toInsert.length > 0) {
      console.log(`[Hierarchical] Inserting ${toInsert.length} raw messages to ${colId}`);
      const BATCH_SIZE = settings.gen_batch_size || 6;
      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE);
        await storageAdapter.insertVectorItems(colId, batch, null, { taskId: colId });
      }
      dbMemories.push(...toInsert.map(item => ({
        id: item.metadata.uid,
        text: item.text,
        metadata: item.metadata
      })));
    }
    
    // 检查日期变更并触发小结
    const currentRawMsgs = dbMemories.filter(m => m.metadata && m.metadata.level === 0);
    currentRawMsgs.sort((a, b) => a.metadata.index - b.metadata.index);
    
    if (currentRawMsgs.length > 0) {
      const lastMsg = currentRawMsgs[currentRawMsgs.length - 1];
      const newDate = lastMsg.metadata.date_val;
      
      if (newDate && lastProcessedDate && newDate !== lastProcessedDate) {
        const targetDateToSummarize = lastProcessedDate;
        const targetMsgs = currentRawMsgs.filter(m => m.metadata.date_val === targetDateToSummarize && !m.metadata.parent_small_id);
        
        if (targetMsgs.length > 0) {
          if (typeof toastr !== 'undefined') toastr.info(`📅 ArcFess: 日期变更 (${targetDateToSummarize} -> ${newDate})，正在生成小结...`, 'Hierarchical Engine');
          const textToSummarize = targetMsgs.map(m => m.text).join('\n');
          const scopeTag = `[${targetDateToSummarize}]`;
          const prompt = `请为以下对话记录生成一段剧情小结。总结要求：${settings.ve_hierarchical_prompt}\n\n对话记录：\n${textToSummarize}`;
          
          try {
            const summaryText = await callLlmAPI(
              prompt,
              settings.ve_summary_api_type,
              settings.ve_summary_api_url,
              settings.ve_summary_api_key,
              settings.ve_summary_api_model,
              "你是一个小说剧情总结助手。"
            );
            
            if (summaryText) {
              const smallSummaryId = `${chatId}_date_small_${targetDateToSummarize.replace(/-/g, '_')}`;
              const finalSummaryText = `${scopeTag} ${summaryText}`;
              
              const summaryItem = {
                id: smallSummaryId,
                text: finalSummaryText,
                metadata: {
                  level: 1,
                  node_id: smallSummaryId,
                  scope_tag: scopeTag,
                  parent_big_id: null,
                  message_count: targetMsgs.length,
                  timestamp: Date.now()
                },
                vector: dummyVector,
                collection_id: colId
              };
              
              await storageAdapter.insert(summaryItem);
              
              for (const msg of targetMsgs) {
                await storageAdapter.updateMetadata(msg.id, { parent_small_id: smallSummaryId });
              }
              console.log(`[Hierarchical] Date small summary created: ${smallSummaryId}`);
              
              await checkAndCreateBigSummary(chatId, colId, dbMemories, dummyVector);
            }
          } catch (err) {
            console.error('[Hierarchical] Date summary failed:', err);
          }
        }
      }
      
      if (newDate) {
        lastProcessedDate = newDate;
      }
    }
  }
}

async function checkAndCreateBigSummary(chatId, colId, dbMemories, dummyVector) {
  const latestMemories = await storageAdapter.getCollectionMemories(colId);
  const smallSummaries = latestMemories.filter(m => m.metadata && m.metadata.level === 1);
  smallSummaries.sort((a, b) => a.timestamp - b.timestamp);
  
  const unsummarizedSmall = smallSummaries.filter(m => !m.metadata.parent_big_id);
  const bigTrigger = settings.ve_hierarchical_big_trigger || 4;
  
  if (unsummarizedSmall.length >= bigTrigger) {
    if (typeof toastr !== 'undefined') toastr.info('📚 ArcFess: 正在打包生成阶段性大总结...', 'Hierarchical Engine');
    const batchToSummarize = unsummarizedSmall.slice(0, bigTrigger);
    const textToSummarize = batchToSummarize.map(m => m.text).join('\n');
    
    const startTag = batchToSummarize[0].metadata.scope_tag;
    const endTag = batchToSummarize[batchToSummarize.length - 1].metadata.scope_tag;
    const scopeTag = `${startTag.replace(/[\[\]]/g, '')} ~ ${endTag.replace(/[\[\]]/g, '')}`;
    
    const prompt = `请根据以下小结，归纳提炼出这段剧情的章节大纲。大纲要求：${settings.ve_hierarchical_big_prompt}\n\n剧情小结列表：\n${textToSummarize}`;
    
    try {
      const bigSummaryText = await callLlmAPI(
        prompt,
        settings.ve_summary_api_type,
        settings.ve_summary_api_url,
        settings.ve_summary_api_key,
        settings.ve_summary_api_model,
        "你是一个章节大纲总结大师。"
      );
      
      if (bigSummaryText) {
        const bigSummaryId = `${chatId}_big_${Date.now()}`;
        const finalBigText = `[大纲: ${scopeTag}] ${bigSummaryText}`;
        
        const bigItem = {
          id: bigSummaryId,
          text: finalBigText,
          metadata: {
            level: 2,
            node_id: bigSummaryId,
            scope_tag: scopeTag,
            timestamp: Date.now()
          },
          vector: dummyVector,
          collection_id: colId
        };
        
        await storageAdapter.insert(bigItem);
        
        for (const small of batchToSummarize) {
          await storageAdapter.updateMetadata(small.id, { parent_big_id: bigSummaryId });
        }
        console.log(`[Hierarchical] Big summary created: ${bigSummaryId}`);
      }
    } catch (err) {
      console.error('[Hierarchical] Big summary failed:', err);
    }
  }
}

// Helper to parse JSON arrays from LLM responses robustly
function parseJsonArray(text) {
  if (!text) return null;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end >= start) {
    const jsonStr = text.substring(start, end + 1);
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      let repaired = jsonStr
        .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1')
        .replace(/,\s*([\]}])/g, '$1');
      try {
        return JSON.parse(repaired);
      } catch (innerErr) {
        console.warn('[Hierarchical] Failed to parse and repair JSON:', innerErr, 'Original text:', text);
      }
    }
  }
  return null;
}

async function fetchHierarchicalMemory(chatId, queryText) {
  const floorEnabled = settings.ve_hierarchical_floor_enabled;
  const dateEnabled = settings.ve_hierarchical_date_enabled;
  
  const cols = [];
  if (floorEnabled) cols.push(`rt_hier_floor_${chatId}`);
  if (dateEnabled) cols.push(`rt_hier_date_${chatId}`);
  
  try {
    let allMemories = [];
    for (const col of cols) {
      const mems = await storageAdapter.getCollectionMemories(col);
      allMemories.push(...mems);
    }
    
    const bigSummaries = allMemories.filter(m => m.metadata && m.metadata.level === 2);
    const smallSummaries = allMemories.filter(m => m.metadata && m.metadata.level === 1);
    
    if (bigSummaries.length === 0 && smallSummaries.length === 0) {
      return '';
    }
    
    bigSummaries.sort((a, b) => a.timestamp - b.timestamp);
    smallSummaries.sort((a, b) => a.timestamp - b.timestamp);
    
    const recentInjectCount = settings.ve_hierarchical_inject_count || 5;
    const recentSmalls = smallSummaries.slice(-recentInjectCount);
    
    // ── 第一轮下钻决策：总管分析大结目录 ──
    if (typeof toastr !== 'undefined') toastr.info('🧠 总管AI: 正在分析记忆大纲...', 'Hierarchical Engine');
    
    const r1Map = new Map();
    const bigCatalog = bigSummaries.map((b, i) => {
      const shortId = `B${i+1}`;
      r1Map.set(shortId, b);
      r1Map.set(b.id, b);
      r1Map.set(String(i+1), b);
      return `${i+1}. [大结ID: ${shortId}] ${b.text}`;
    }).join('\n');
    
    const recentCatalog = recentSmalls.map((s, i) => {
      const shortId = `S${i+1}`;
      r1Map.set(shortId, s);
      r1Map.set(s.id, s);
      r1Map.set(String(i+1), s);
      return `${i+1}. [近期小结ID: ${shortId}] ${s.text}`;
    }).join('\n');
    
    const r1Prompt = `历史故事大纲目录：\n${bigCatalog || '无'}\n\n近期发生小结（不可下钻）：\n${recentCatalog || '无'}\n\n当前情境：\n${queryText}\n\n请决定需要下钻哪一个大结，返回对应的 JSON 数组。`;
    
    const r1Result = await callLlmAPI(
      r1Prompt,
      settings.ve_manager_api_type,
      settings.ve_manager_api_url,
      settings.ve_manager_api_key,
      settings.ve_manager_api_model,
      settings.ve_hierarchical_manager_prompt_r1
    );
    
    console.log('[Hierarchical] R1 Decision:', r1Result);
    
    const decisions = parseJsonArray(r1Result);
    
    if (!decisions || decisions.length === 0) {
      return '';
    }
    
    const findR1Target = (targetVal) => {
      if (!targetVal) return null;
      let cleanVal = String(targetVal).trim();
      
      const idMatch = cleanVal.match(/(?:ID|名称)?:\s*([BS]\d+|\d+)/i) || cleanVal.match(/([BS]\d+)/i);
      if (idMatch) {
        cleanVal = idMatch[1];
      }
      
      if (r1Map.has(cleanVal)) return r1Map.get(cleanVal);
      
      for (const [key, value] of r1Map.entries()) {
        if (key.toLowerCase() === cleanVal.toLowerCase()) return value;
      }
      
      for (const b of bigSummaries) {
        if (b.id.includes(cleanVal) || cleanVal.includes(b.id)) return b;
      }
      for (const s of smallSummaries) {
        if (s.id.includes(cleanVal) || cleanVal.includes(s.id)) return s;
      }
      
      const lowerVal = cleanVal.toLowerCase();
      for (const b of bigSummaries) {
        const lowerText = b.text.toLowerCase();
        if (lowerText.includes(lowerVal) || lowerVal.includes(lowerText)) return b;
      }
      for (const s of smallSummaries) {
        const lowerText = s.text.toLowerCase();
        if (lowerText.includes(lowerVal) || lowerVal.includes(lowerText)) return s;
      }
      return null;
    };
    
    let targetSmallSummaries = [];
    let selectedSmallIds = new Set();
    
    for (const dec of decisions) {
      const resolvedNode = findR1Target(dec.target);
      if (resolvedNode) {
        if (resolvedNode.metadata && resolvedNode.metadata.level === 1) {
          selectedSmallIds.add(resolvedNode.id);
        } else if (resolvedNode.metadata && resolvedNode.metadata.level === 2) {
          const children = smallSummaries.filter(s => s.metadata.parent_big_id === resolvedNode.id);
          targetSmallSummaries.push(...children);
        }
      }
    }
    
    // ── 第二轮下钻决策：挑选细节小结与检索词 ──
    let r2Decisions = [];
    const r2Map = new Map();
    
    if (targetSmallSummaries.length > 0) {
      if (typeof toastr !== 'undefined') toastr.info('🧠 总管AI: 锁定了大纲，正在下钻事件细节...', 'Hierarchical Engine');
      
      const smallCatalog = targetSmallSummaries.map((s, i) => {
        const shortId = `S${i+1}`;
        r2Map.set(shortId, s);
        r2Map.set(s.id, s);
        r2Map.set(String(i+1), s);
        return `${i+1}. [小结ID: ${shortId}] ${s.text}`;
      }).join('\n');
      
      const r2Prompt = `被锁定大总结辖区小结列表：\n${smallCatalog}\n\n当前情境：\n${queryText}\n\n请输出要进行向量检索的小总结 ID 与其具体的查询检索词 JSON 数组。`;
      
      const r2Result = await callLlmAPI(
        r2Prompt,
        settings.ve_manager_api_type,
        settings.ve_manager_api_url,
        settings.ve_manager_api_key,
        settings.ve_manager_api_model,
        settings.ve_hierarchical_manager_prompt_r2
      );
      
      console.log('[Hierarchical] R2 Decision:', r2Result);
      r2Decisions = parseJsonArray(r2Result) || [];
    }
    
    const findR2Target = (targetVal) => {
      if (!targetVal) return null;
      let cleanVal = String(targetVal).trim();
      
      const idMatch = cleanVal.match(/(?:ID|名称)?:\s*([S]\d+|\d+)/i) || cleanVal.match(/([S]\d+)/i);
      if (idMatch) {
        cleanVal = idMatch[1];
      }
      
      if (r2Map.has(cleanVal)) return r2Map.get(cleanVal);
      
      for (const [key, value] of r2Map.entries()) {
        if (key.toLowerCase() === cleanVal.toLowerCase()) return value;
      }
      
      for (const s of targetSmallSummaries) {
        if (s.id.includes(cleanVal) || cleanVal.includes(s.id)) return s;
      }
      
      const lowerVal = cleanVal.toLowerCase();
      for (const s of targetSmallSummaries) {
        const lowerText = s.text.toLowerCase();
        if (lowerText.includes(lowerVal) || lowerVal.includes(lowerText)) return s;
      }
      return null;
    };
    
    let resolvedR2Decisions = [];
    for (const r2Dec of r2Decisions) {
      const resolvedSmall = findR2Target(r2Dec.target);
      if (resolvedSmall) {
        resolvedR2Decisions.push({
          target: resolvedSmall.id,
          queries: r2Dec.queries || []
        });
      }
    }
    
    // 补充第一轮直接锁定的小结，不指定特定 keywords 时默认以 queryText 为检索词
    selectedSmallIds.forEach(id => {
      if (!resolvedR2Decisions.some(d => d.target === id)) {
        resolvedR2Decisions.push({ target: id, queries: [queryText] });
      }
    });

    const searchTasks = [];
    for (const r2Dec of resolvedR2Decisions) {
      const smallId = r2Dec.target;
      const queries = r2Dec.queries || [];
      if (smallSummaries.some(s => s.id === smallId) && queries.length > 0) {
        queries.forEach(q => {
          searchTasks.push({ smallId, query: q });
        });
      }
    }
    
    const retrievedRawChunks = [];
    if (searchTasks.length > 0) {
      if (typeof toastr !== 'undefined') toastr.info(`🧠 总管AI: 提取局部原文碎片中...`, 'Hierarchical Engine');
      
      const queryPromises = searchTasks.map(async (task) => {
        try {
          const vector = await getEmbeddingVector(task.query);
          if (!vector) return [];
          
          const response = await fetch(`${storageAdapter.baseUrl}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              vector: vector,
              k: 3, // 每个小结下通常只需要取最相关的 3 句话
              collections: cols,
              filters: { parent_small_id: task.smallId }
            })
          });
          if (response.ok) {
            const resJson = await response.json();
            return resJson.results || [];
          }
        } catch(err) {
          console.error('[Hierarchical] Precise query failed:', err);
        }
        return [];
      });
      
      const resultsArray = await Promise.all(queryPromises);
      retrievedRawChunks.push(...resultsArray.flat());
    }
    
    // 原话去重
    const uniqueRaw = [];
    const seenRawIds = new Set();
    retrievedRawChunks.forEach(item => {
      if (!seenRawIds.has(item.id)) {
        seenRawIds.add(item.id);
        uniqueRaw.push(item);
      }
    });
    
    if (uniqueRaw.length > 0) {
      let outputText = '\n\n=== [ArcFess] 总管AI提取的历史精准剧情记忆 ===\n';
      
      const groupedBySmall = new Map();
      uniqueRaw.forEach(item => {
        const smallId = item.metadata?.parent_small_id;
        if (smallId) {
          if (!groupedBySmall.has(smallId)) groupedBySmall.set(smallId, []);
          groupedBySmall.get(smallId).push(item);
        }
      });
      
      groupedBySmall.forEach((chunks, smallId) => {
        const smallNode = smallSummaries.find(s => s.id === smallId);
        if (smallNode) {
          const bigId = smallNode.metadata?.parent_big_id;
          const bigNode = bigSummaries.find(b => b.id === bigId);
          
          outputText += `【历史大纲】：${bigNode ? bigNode.text : '无分类大纲'}\n`;
          outputText += `  —— 【关联事件总结】：${smallNode.text}\n`;
          chunks.forEach(chunk => {
            // 清理掉[楼层 #X]或[日期]的前缀展示，更自然地喂给LLM
            let cleanText = chunk.text.replace(/^\[楼层\s*#\d+\]\s*/, '').replace(/^\[日期:\s*.*?\]\s*/, '');
            outputText += `    ———— 【历史对话还原】：${cleanText}\n`;
          });
          outputText += '\n';
        }
      });
      
      return outputText;
    }
  } catch(err) {
    console.error('[Hierarchical] fetchHierarchicalMemory failed:', err);
  }
  return '';
}

async function getEmbeddingVector(text) {
  const config = storageAdapter.getVectorsRequestBody ? storageAdapter.getVectorsRequestBody() : {};
  let vectors = [];
  if (config.source === 'vllm' || config.source === 'openai') {
    vectors = await storageAdapter._fetchOpenAIEmbeddings([text], config);
  } else if (config.source === 'ollama') {
    vectors = await storageAdapter._fetchOllamaEmbeddings([text], config);
  }
  return vectors.length > 0 ? vectors[0] : null;
}

// === 可视化层级记忆浏览器与编辑器 ===
window.vectors_enhanced_showHierarchicalPreview = async function() {
  const context = getContext();
  if (!context || !context.chatId) {
    toastr.warning('请先加载一个聊天存档');
    return;
  }

  const chatId = context.chatId;
  
  if (typeof toastr !== 'undefined') toastr.info('正在读取层级记忆数据...', 'ArcFess Viewer');
  
  try {
    const floorMems = await storageAdapter.getCollectionMemories(`rt_hier_floor_${chatId}`);
    const dateMems = await storageAdapter.getCollectionMemories(`rt_hier_date_${chatId}`);
    const allMems = [...floorMems, ...dateMems];
    
    if (allMems.length === 0) {
      callGenericPopup(
        '<div><strong>层级记忆库为空</strong><p>当前存档还没有生成任何层级总结。请在启用层级引擎后，进行更多聊天以生成记忆节点。</p></div>',
        POPUP_TYPE.TEXT,
        { okButton: '确认' }
      );
      return;
    }
    
    // 构建 Modal HTML
    const modalStyle = `
      <style>
        .ve-modal-container { display: flex; width: 100%; height: 500px; gap: 15px; color: var(--SmartThemeTextColor); }
        .ve-tree-pane { flex: 1.2; border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; background: var(--black30a); padding: 10px; overflow-y: auto; height: 100%; }
        .ve-editor-pane { flex: 1; border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; background: var(--black30a); padding: 15px; display: flex; flex-direction: column; gap: 10px; height: 100%; }
        .ve-tree-item { margin-bottom: 6px; }
        .ve-tree-header { display: flex; align-items: center; cursor: pointer; padding: 6px 10px; border-radius: 6px; background: var(--black10a); border: 1px dashed transparent; }
        .ve-tree-header:hover { border-color: var(--SmartThemeQuoteColor); background: var(--black20a); }
        .ve-tree-header.selected { background: var(--SmartThemeQuoteColor); color: #000; font-weight: bold; }
        .ve-tree-children { margin-left: 20px; display: none; margin-top: 4px; }
        .ve-tree-children.open { display: block; }
        .ve-btn { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--SmartThemeBorderColor); cursor: pointer; font-weight: bold; text-align: center; }
        .ve-btn-primary { background: var(--SmartThemeQuoteColor); color: #000; border-color: var(--SmartThemeQuoteColor); }
        .ve-btn-danger { background: var(--warning); color: #fff; border-color: var(--warning); }
      </style>
    `;
    
    const popupContent = `
      ${modalStyle}
      <div style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
        <h3>🔍 ArcFess 层级记忆浏览器与编辑器</h3>
        <select id="ve_viewer_track_select" class="text_pole" style="width: 140px;">
          <option value="floor">🧱 楼层轨道</option>
          <option value="date">📅 日期轨道</option>
        </select>
      </div>
      <div class="ve-modal-container">
        <div class="ve-tree-pane" id="ve_viewer_tree">
          <!-- 动态装填树 -->
        </div>
        <div class="ve-editor-pane" id="ve_viewer_editor">
          <div style="text-align: center; color: var(--SmartThemeQuoteColor); margin-top: 150px;">
            <i class="fa-solid fa-hand-pointer" style="font-size: 3rem; margin-bottom: 10px;"></i>
            <p>请点击左侧节点浏览或修改总结内容</p>
          </div>
        </div>
      </div>
    `;
    
    // 打开ST modal
    const dialog = callGenericPopup(popupContent, POPUP_TYPE.TEXT, { okButton: '关闭浏览器' });
    
    // 渲染函数
    const renderTree = (trackType) => {
      const colId = trackType === 'floor' ? `rt_hier_floor_${chatId}` : `rt_hier_date_${chatId}`;
      const trackMems = trackType === 'floor' ? floorMems : dateMems;
      
      const treeContainer = $('#ve_viewer_tree');
      treeContainer.empty();
      
      if (trackMems.length === 0) {
        treeContainer.html('<div style="text-align:center;color:gray;margin-top:100px;">该轨道尚无记忆节点</div>');
        return;
      }
      
      const bigs = trackMems.filter(m => m.metadata && m.metadata.level === 2);
      const smalls = trackMems.filter(m => m.metadata && m.metadata.level === 1);
      const raws = trackMems.filter(m => m.metadata && m.metadata.level === 0);
      
      bigs.sort((a, b) => a.timestamp - b.timestamp);
      smalls.sort((a, b) => a.timestamp - b.timestamp);
      
      // 树渲染
      let treeHtml = '';
      
      // 1. 大结
      bigs.forEach(b => {
        const childSmalls = smalls.filter(s => s.metadata.parent_big_id === b.id);
        treeHtml += `
          <div class="ve-tree-item" data-id="${b.id}" data-type="big" data-col="${colId}">
            <div class="ve-tree-header ve-big-header" data-id="${b.id}">
              <i class="fa-solid fa-folder-closed" style="margin-right: 6px;"></i>
              <span style="flex:1;">${b.text.slice(0, 40)}...</span>
              <small style="color: gray;">[大总结]</small>
            </div>
            <div class="ve-tree-children" id="children_${b.id}">
        `;
        
        childSmalls.forEach(s => {
          const rawCount = raws.filter(r => r.metadata.parent_small_id === s.id).length;
          treeHtml += `
            <div class="ve-tree-item ve-tree-header ve-small-header" data-id="${s.id}" data-type="small" data-col="${colId}" style="margin-left: 20px;">
              <i class="fa-solid fa-file-invoice" style="margin-right: 6px;"></i>
              <span style="flex:1;">${s.text.slice(0, 30)}...</span>
              <small style="color: var(--SmartThemeQuoteColor);">[小结] (${rawCount}条原话)</small>
            </div>
          `;
        });
        
        treeHtml += `
            </div>
          </div>
        `;
      });
      
      // 孤儿小结 (还没有被打包成大结的)
      const orphanSmalls = smalls.filter(s => !s.metadata.parent_big_id);
      if (orphanSmalls.length > 0) {
        treeHtml += `<h4 style="margin: 15px 0 5px 0; border-bottom: 1px solid var(--SmartThemeBorderColor); padding-bottom: 4px;">近期未归档小结</h4>`;
        orphanSmalls.forEach(s => {
          const rawCount = raws.filter(r => r.metadata.parent_small_id === s.id).length;
          treeHtml += `
            <div class="ve-tree-item ve-tree-header ve-small-header" data-id="${s.id}" data-type="small" data-col="${colId}">
              <i class="fa-solid fa-file-invoice" style="margin-right: 6px;"></i>
              <span style="flex:1;">${s.text.slice(0, 30)}...</span>
              <small style="color: var(--SmartThemeQuoteColor);">[近期小结] (${rawCount}条原话)</small>
            </div>
          `;
        });
      }
      
      treeContainer.html(treeHtml);
      
      // 绑定点击展开/折叠大结
      $('.ve-big-header').on('click', function(e) {
        e.stopPropagation();
        const id = $(this).attr('data-id');
        $(`#children_${id}`).toggleClass('open');
        $(this).find('i').toggleClass('fa-folder-closed fa-folder-open');
        selectNode(id, 'big', colId, trackMems);
      });
      
      // 绑定点击小结
      $('.ve-small-header').on('click', function(e) {
        e.stopPropagation();
        const id = $(this).attr('data-id');
        selectNode(id, 'small', colId, trackMems);
      });
    };
    
    // 选择并进入编辑
    const selectNode = (id, type, colId, trackMems) => {
      $('.ve-tree-header').removeClass('selected');
      $(`.ve-tree-item[data-id="${id}"] > .ve-tree-header, .ve-tree-header[data-id="${id}"]`).addClass('selected');
      
      const node = trackMems.find(m => m.id === id);
      if (!node) return;
      
      const editorPane = $('#ve_viewer_editor');
      editorPane.empty().html(`
        <div style="display:flex; flex-direction:column; gap:10px; height: 100%;">
          <div>
            <strong>节点类型:</strong> <span style="color: var(--SmartThemeQuoteColor); font-weight:bold;">${type === 'big' ? '📖 大总结 (Outline)' : '📄 小总结 (Summary)'}</span>
          </div>
          <div>
            <strong>关联范围:</strong> <small style="color:gray;">${node.metadata?.scope_tag || '无范围标记'}</small>
          </div>
          <div style="flex:1; display:flex; flex-direction:column;">
            <label for="ve_editor_textarea" style="font-weight:bold; margin-bottom:5px;">修改正文内容:</label>
            <textarea id="ve_editor_textarea" class="text_pole" style="flex:1; width:100%; resize:none; padding:10px; font-size:14px; line-height:1.5;">${node.text}</textarea>
          </div>
          <div style="display:flex; gap:10px; justify-content: flex-end;">
            <button id="ve_editor_delete" class="ve-btn ve-btn-danger"><i class="fa-solid fa-trash"></i> 删除节点</button>
            <button id="ve_editor_save" class="ve-btn ve-btn-primary"><i class="fa-solid fa-floppy-disk"></i> 保存修改</button>
          </div>
        </div>
      `);
      
      // 保存修改
      $('#ve_editor_save').on('click', async () => {
        const newText = $('#ve_editor_textarea').val();
        if (!newText.trim()) {
          toastr.warning('内容不能为空');
          return;
        }
        
        node.text = newText;
        
        const dummyVector = Array(storageAdapter.embeddingDim || 1024).fill(0);
        const updatePayload = {
          id: node.id,
          text: newText,
          metadata: node.metadata,
          vector: dummyVector,
          collection_id: colId
        };
        
        try {
          await storageAdapter.insert(updatePayload);
          toastr.success('保存修改成功！');
          renderTree($('#ve_viewer_track_select').val());
          selectNode(id, type, colId, trackMems);
        } catch(err) {
          toastr.error('保存失败: ' + err.message);
        }
      });
      
      // 删除节点
      $('#ve_editor_delete').on('click', async () => {
        const confirmDelete = await callGenericPopup(
          `<div><strong>确认删除节点?</strong><p>删除总结节点不会影响底层的原文对话，但会使这部分聊天记录在下钻时失去目录关联。是否继续？</p></div>`,
          POPUP_TYPE.CONFIRM, { okButton: '确认删除', cancelButton: '取消' }
        );
        if (confirmDelete !== POPUP_RESULT.AFFIRMATIVE) return;
        
        try {
          await storageAdapter.delete([node.id]);
          toastr.success('删除成功');
          // 从内存数组中剔除
          const idx = trackMems.findIndex(m => m.id === id);
          if (idx !== -1) trackMems.splice(idx, 1);
          
          renderTree($('#ve_viewer_track_select').val());
          editorPane.empty().html(`
            <div style="text-align: center; color: var(--SmartThemeQuoteColor); margin-top: 150px;">
              <i class="fa-solid fa-hand-pointer" style="font-size: 3rem; margin-bottom: 10px;"></i>
              <p>请点击左侧节点浏览或修改总结内容</p>
            </div>
          `);
        } catch(err) {
          toastr.error('删除失败: ' + err.message);
        }
      });
    };
    
    // 初始化渲染 floor
    renderTree('floor');
    
    // 切换轨道事件
    $('#ve_viewer_track_select').on('change', function() {
      renderTree($(this).val());
      $('#ve_viewer_editor').html(`
        <div style="text-align: center; color: var(--SmartThemeQuoteColor); margin-top: 150px;">
          <i class="fa-solid fa-hand-pointer" style="font-size: 3rem; margin-bottom: 10px;"></i>
          <p>请点击左侧节点浏览或修改总结内容</p>
        </div>
      `);
    });
    
  } catch(err) {
    console.error('[Hierarchical] Open preview failed:', err);
    toastr.error('打不开浏览器，错误: ' + err.message);
  }
};

// === 从其他会话克隆/继承层级记忆 ===
window.vectors_enhanced_inheritHierarchicalMemory = async function() {
  const context = getContext();
  if (!context || !context.chatId) {
    toastr.warning('请先加载当前会话存档');
    return;
  }
  
  const destChatId = context.chatId;
  
  try {
    const res = await fetch(`http://${window.location.hostname}:8999/collections`);
    if (!res.ok) throw new Error('无法连接到后端服务器');
    const data = await res.json();
    const collections = data.collections || [];
    
    // 找出所有前缀是 rt_hier_floor_ 的 collection，提取 chatId 作为可用源存档
    const chats = new Set();
    collections.forEach(col => {
      if (col.name.startsWith('rt_hier_floor_')) {
        const id = col.name.replace('rt_hier_floor_', '');
        if (id !== destChatId) chats.add(id);
      }
    });
    
    if (chats.size === 0) {
      callGenericPopup(
        '<div><strong>没有发现可用的历史层级记忆库</strong><p>后端目前没有任何其他会话开启了层级记忆引擎，没有记忆数据可供克隆。</p></div>',
        POPUP_TYPE.TEXT, { okButton: '确认' }
      );
      return;
    }
    
    let optionsHtml = '';
    chats.forEach(c => {
      optionsHtml += `<option value="${c}">${c}</option>`;
    });
    
    const popupContent = `
      <div>
        <strong>选择要克隆的源会话：</strong>
        <select id="ve_inherit_source_select" class="text_pole" style="width: 100%; margin-top: 10px;">
          ${optionsHtml}
        </select>
        <p style="margin-top:15px; color: var(--warning);"><small>警告：克隆会把源会话的所有大总结、小总结以及关联的原文向量完整复制并覆盖当前的层级记忆。这是一个不可逆的操作！</small></p>
      </div>
    `;
    
    const confirm = await callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, { okButton: '开始继承/克隆', cancelButton: '取消' });
    if (confirm !== POPUP_RESULT.AFFIRMATIVE) return;
    
    const sourceChatId = $('#ve_inherit_source_select').val();
    if (!sourceChatId) return;
    
    if (typeof toastr !== 'undefined') toastr.info(`正在把 ${sourceChatId} 的记忆克隆到当前会话...`, 'ArcFess Clone');
    
    // 开始克隆楼层轨与日期轨
    const tracks = ['floor', 'date'];
    let clonedCount = 0;
    
    for (const track of tracks) {
      const srcCol = `rt_hier_${track}_${sourceChatId}`;
      const destCol = `rt_hier_${track}_${destChatId}`;
      
      const srcMemories = await storageAdapter.getCollectionMemories(srcCol);
      if (srcMemories.length > 0) {
        // 将每一条记忆修改为 destination 的 collection_id，并且更新 ID 中的 chatId 前缀以防冲突
        const mappedMemories = srcMemories.map(m => {
          const newId = m.id.replace(new RegExp(`^${sourceChatId}`), destChatId);
          const newMeta = { ...m.metadata };
          if (newMeta.uid) newMeta.uid = newMeta.uid.replace(new RegExp(`^${sourceChatId}`), destChatId);
          if (newMeta.node_id) newMeta.node_id = newMeta.node_id.replace(new RegExp(`^${sourceChatId}`), destChatId);
          if (newMeta.parent_small_id) newMeta.parent_small_id = newMeta.parent_small_id.replace(new RegExp(`^${sourceChatId}`), destChatId);
          if (newMeta.parent_big_id) newMeta.parent_big_id = newMeta.parent_big_id.replace(new RegExp(`^${sourceChatId}`), destChatId);
          
          return {
            id: newId,
            text: m.text,
            metadata: newMeta,
            vector: m.vector || Array(storageAdapter.embeddingDim || 1024).fill(0),
            collection_id: destCol
          };
        });
        
        await storageAdapter.insert(mappedMemories);
        clonedCount += mappedMemories.length;
      }
    }
    
    toastr.success(`🎉 记忆克隆完成！成功继承了 ${clonedCount} 条记忆节点。`);
    
  } catch(err) {
    console.error('[Hierarchical] Inherit failed:', err);
    toastr.error('克隆失败，错误: ' + err.message);
  }
};

// === 清空层级记忆库 ===
window.vectors_enhanced_purgeHierarchicalMemory = async function() {
  const context = getContext();
  if (!context || !context.chatId) {
    toastr.warning('当前存档没有被加载');
    return;
  }
  
  const chatId = context.chatId;
  const colFloor = `rt_hier_floor_${chatId}`;
  const colDate = `rt_hier_date_${chatId}`;
  
  const confirm = await callGenericPopup(
    `<div><strong>清空所有层级总结与记忆?</strong><p style="color:var(--warning)">此操作将彻底删除本存档下的所有大总结、小总结以及底层原文。无法找回，是否继续？</p></div>`,
    POPUP_TYPE.CONFIRM, { okButton: '确认清空', cancelButton: '取消' }
  );
  if (confirm !== POPUP_RESULT.AFFIRMATIVE) return;
  
  try {
    if (typeof toastr !== 'undefined') toastr.info('正在清空数据...', 'ArcFess Purge');
    await storageAdapter.purgeVectorIndex(colFloor);
    await storageAdapter.purgeVectorIndex(colDate);
    toastr.success('层级记忆已全部清空！');
  } catch(err) {
    toastr.error('清空失败: ' + err.message);
  }
};


