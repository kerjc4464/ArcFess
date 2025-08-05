/**
 * State Analyzer
 * 状态分析器
 * 
 * 负责分析向量化插件的各种状态信息
 */

export class StateAnalyzer {
  constructor(api) {
    this.api = api;
  }
  
  /**
   * 分析向量状态 (原debugVectorStatus)
   */
  async analyzeVectorStatus() {
    console.log('=== 向量状态调试 ===');
    
    const chatId = this.api.getCurrentChatId();
    if (!chatId) {
      console.log('错误：未选择聊天');
      if (this.api.toastr) {
        this.api.toastr.error('未选择聊天');
      }
      return;
    }
    
    console.log(`当前聊天ID: ${chatId}`);
    
    // 检查任务列表
    const allTasks = this.api.getChatTasks(chatId);
    const enabledTasks = allTasks.filter(t => t.enabled);
    
    console.log(`总任务数: ${allTasks.length}, 启用任务数: ${enabledTasks.length}`);
    
    allTasks.forEach((task, index) => {
      console.log(`任务 ${index + 1}:`);
      console.log(`  - 名称: ${task.name}`);
      console.log(`  - ID: ${task.taskId}`);
      console.log(`  - 启用: ${task.enabled}`);
      console.log(`  - 时间: ${new Date(task.timestamp).toLocaleString()}`);
      console.log(`  - Collection ID: ${chatId}_${task.taskId}`);
    });
    
    // 检查向量数据 (如果API可用)
    if (typeof getSavedHashes === 'function') {
      for (const task of allTasks) {
        const collectionId = `${chatId}_${task.taskId}`;
        try {
          console.log(`\\n检查集合: ${collectionId}`);
          const hashes = await getSavedHashes(collectionId);
          console.log(`  - 向量数量: ${hashes.length}`);
          if (hashes.length > 0) {
            console.log(`  - 样本哈希: ${hashes.slice(0, 3).join(', ')}${hashes.length > 3 ? '...' : ''}`);
          }
        } catch (error) {
          console.log(`  - 错误: ${error.message}`);
        }
      }
    }
    
    // 检查缓存 (如果可用)
    if (typeof cachedVectors !== 'undefined') {
      console.log(`\\n缓存状态:`);
      console.log(`  - 缓存项数量: ${cachedVectors.size}`);
      for (const [key, value] of cachedVectors.entries()) {
        console.log(`  - ${key}: ${value.items?.length || 0} 个项目, 时间: ${new Date(value.timestamp).toLocaleString()}`);
      }
    }
    
    console.log('=== 调试完成 ===');
    
    if (this.api.toastr) {
      this.api.toastr.info(`任务: ${allTasks.length}个 (${enabledTasks.length}个启用), 详情见控制台`, '向量状态检查');
    }
  }
  
  /**
   * 分析内容选择状态 (原debugContentSelection)
   */
  analyzeContentSelection() {
    console.log('=== 内容选择状态调试 ===');
    
    const settings = this.api.getSettings();
    
    console.log('全局设置状态:', {
      master_enabled: settings.master_enabled,
      selected_content: settings.selected_content
    });
    
    // 调试聊天设置
    const chatSettings = settings.selected_content.chat;
    console.log('聊天记录设置:', {
      enabled: chatSettings.enabled,
      range: chatSettings.range,
      types: chatSettings.types,
      tags: chatSettings.tags,
      include_hidden: chatSettings.include_hidden
    });
    
    // 调试文件设置
    const filesSettings = settings.selected_content.files;
    console.log('文件设置:', {
      enabled: filesSettings.enabled,
      selected_count: filesSettings.selected.length,
      selected_files: filesSettings.selected
    });
    
    // 调试世界信息设置
    const wiSettings = settings.selected_content.world_info;
    console.log('世界信息设置:', {
      enabled: wiSettings.enabled,
      selected_worlds: Object.keys(wiSettings.selected),
      total_entries: Object.values(wiSettings.selected).flat().length,
      detailed_selection: wiSettings.selected
    });
    
    // 调试UI元素状态
    console.log('UI元素状态:');
    console.log('- 聊天启用复选框:', this.api.jQuery('#vectors_enhanced_chat_enabled').prop('checked'));
    console.log('- 文件启用复选框:', this.api.jQuery('#vectors_enhanced_files_enabled').prop('checked'));
    console.log('- 世界信息启用复选框:', this.api.jQuery('#vectors_enhanced_wi_enabled').prop('checked'));
    
    // 调试隐藏消息
    const hiddenMessages = this.api.getHiddenMessages();
    console.log('隐藏消息状态:', {
      count: hiddenMessages.length,
      messages: hiddenMessages
    });
    
    console.log('=== 调试完成 ===');
    
    if (this.api.toastr) {
      this.api.toastr.info(
        `内容选择状态已输出到控制台\\n聊天:${chatSettings.enabled}, 文件:${filesSettings.enabled}, 世界信息:${wiSettings.enabled}`, 
        '内容选择调试'
      );
    }
  }
  
  /**
   * 分析隐藏消息状态
   */
  analyzeHiddenMessagesStatus() {
    console.log('=== 隐藏消息状态分析 ===');
    
    const hiddenMessages = this.api.getHiddenMessages();
    
    console.log(`隐藏消息总数: ${hiddenMessages.length}`);
    
    if (hiddenMessages.length > 0) {
      // 按索引排序
      const sortedMessages = hiddenMessages.sort((a, b) => a.index - b.index);
      
      // 计算范围
      const indexes = sortedMessages.map(msg => msg.index);
      const minIndex = Math.min(...indexes);
      const maxIndex = Math.max(...indexes);
      
      console.log(`隐藏消息索引范围: ${minIndex} - ${maxIndex}`);
      
      // 按类型分组
      const byType = {
        user: sortedMessages.filter(msg => msg.is_user),
        assistant: sortedMessages.filter(msg => !msg.is_user)
      };
      
      console.log('按类型分组:');
      console.log(`  - 用户消息: ${byType.user.length}`);
      console.log(`  - AI消息: ${byType.assistant.length}`);
      
      // 显示前5条隐藏消息的详情
      console.log('\\n前5条隐藏消息详情:');
      sortedMessages.slice(0, 5).forEach((msg, idx) => {
        const msgType = msg.is_user ? '用户' : 'AI';
        const preview = msg.text ? msg.text.substring(0, 50) + '...' : '(无内容)';
        console.log(`  ${idx + 1}. #${msg.index} [${msgType}] ${preview}`);
      });
    }
    
    console.log('=== 分析完成 ===');
    
    if (this.api.toastr) {
      this.api.toastr.info(`发现 ${hiddenMessages.length} 条隐藏消息，详情见控制台`, '隐藏消息分析');
    }
  }
  
  /**
   * 检查系统完整性
   */
  checkSystemIntegrity() {
    console.log('=== 系统完整性检查 ===');
    
    const results = {
      api: {},
      ui: {},
      settings: {},
      functions: {}
    };
    
    // 检查API完整性
    const requiredAPIs = ['getSettings', 'getCurrentChatId', 'getSortedEntries', 'getChatTasks', 'getHiddenMessages'];
    requiredAPIs.forEach(apiName => {
      results.api[apiName] = typeof this.api[apiName] === 'function';
    });
    
    // 检查UI元素
    const requiredElements = ['#vectors_enhanced_container', '#vectors_enhanced_chat_enabled', '#vectors_enhanced_files_enabled', '#vectors_enhanced_wi_enabled'];
    requiredElements.forEach(selector => {
      results.ui[selector] = this.api.jQuery(selector).length > 0;
    });
    
    // 检查设置结构
    const settings = this.api.getSettings();
    results.settings.hasSettings = !!settings;
    results.settings.hasSelectedContent = !!(settings && settings.selected_content);
    results.settings.hasChatSettings = !!(settings && settings.selected_content && settings.selected_content.chat);
    results.settings.hasFileSettings = !!(settings && settings.selected_content && settings.selected_content.files);
    results.settings.hasWISettings = !!(settings && settings.selected_content && settings.selected_content.world_info);
    
    // 检查核心函数
    const coreFunctions = ['cleanupInvalidSelections', 'updateWorldInfoList'];
    coreFunctions.forEach(funcName => {
      results.functions[funcName] = typeof this.api[funcName] === 'function';
    });
    
    console.log('完整性检查结果:', results);
    
    // 统计问题
    const issues = [];
    Object.entries(results).forEach(([category, checks]) => {
      Object.entries(checks).forEach(([item, passed]) => {
        if (!passed) {
          issues.push(`${category}.${item}`);
        }
      });
    });
    
    if (issues.length > 0) {
      console.warn('发现问题:', issues);
    } else {
      console.log('✓ 系统完整性检查通过');
    }
    
    console.log('=== 检查完成 ===');
    
    if (this.api.toastr) {
      const message = issues.length > 0 ? `发现 ${issues.length} 个问题` : '系统完整性良好';
      this.api.toastr.info(message + '，详情见控制台', '完整性检查');
    }
    
    return results;
  }
  
  /**
   * 分析性能指标
   */
  analyzePerformanceMetrics() {
    console.log('=== 性能指标分析 ===');
    
    const metrics = {
      memory: {},
      timing: {},
      dom: {},
      api: {}
    };
    
    // 内存指标
    if (performance.memory) {
      metrics.memory = {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) + ' MB',
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024) + ' MB',
        limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024) + ' MB'
      };
    }
    
    // 时间指标
    const navigation = performance.getEntriesByType('navigation')[0];
    if (navigation) {
      metrics.timing = {
        domContentLoaded: Math.round(navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart) + ' ms',
        loadComplete: Math.round(navigation.loadEventEnd - navigation.loadEventStart) + ' ms'
      };
    }
    
    // DOM指标
    metrics.dom = {
      elements: document.querySelectorAll('*').length,
      vectorsElements: document.querySelectorAll('[id*="vectors"], [class*="vectors"]').length,
      hiddenElements: document.querySelectorAll('[style*="display: none"], [hidden]').length
    };
    
    // API响应性测试
    const startTime = performance.now();
    try {
      const settings = this.api.getSettings();
      const chatId = this.api.getCurrentChatId();
      metrics.api.settingsAccess = Math.round(performance.now() - startTime) + ' ms';
      metrics.api.functionsAvailable = Object.keys(this.api).length;
    } catch (error) {
      metrics.api.error = error.message;
    }
    
    console.log('性能指标:', metrics);
    console.log('=== 分析完成 ===');
    
    if (this.api.toastr) {
      this.api.toastr.info('性能指标已输出到控制台', '性能分析');
    }
    
    return metrics;
  }
}