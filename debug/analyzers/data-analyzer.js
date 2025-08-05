/**
 * Data Analyzer
 * 数据分析器
 * 
 * 负责分析重复检测、数据完整性等数据相关问题
 */

export class DataAnalyzer {
  constructor(api) {
    this.api = api;
  }
  
  /**
   * 分析文件重复 (原debugFileOverlap)
   */
  analyzeFileOverlap() {
    console.log('=== 文件重复检测深度调试 ===');
    
    const chatId = this.api.getCurrentChatId();
    if (!chatId) {
      console.log('错误：未选择聊天');
      if (this.api.toastr) {
        this.api.toastr.error('未选择聊天');
      }
      return;
    }
    
    // 获取当前设置
    const settings = this.api.getSettings();
    const currentSettings = settings.selected_content;
    console.log('当前文件选择设置:', {
      enabled: currentSettings.files.enabled,
      selected: currentSettings.files.selected,
      selectedCount: currentSettings.files.selected.length
    });
    
    // 获取所有任务
    const allTasks = this.api.getChatTasks(chatId);
    const enabledTasks = allTasks.filter(t => t.enabled);
    
    console.log('任务状态:', {
      totalTasks: allTasks.length,
      enabledTasks: enabledTasks.length
    });
    
    // 详细分析每个任务的文件
    enabledTasks.forEach((task, index) => {
      console.log(`\\n任务 ${index + 1}: "${task.name}"`);
      console.log('- ID:', task.taskId);
      console.log('- 文件设置:', task.settings?.files);
      if (task.settings?.files?.enabled && task.settings.files.selected) {
        console.log('- 文件列表:', task.settings.files.selected);
        console.log('- 文件数量:', task.settings.files.selected.length);
      } else {
        console.log('- 没有文件或文件未启用');
      }
    });
    
    // 运行重复检测分析
    console.log('\\n=== 运行重复检测分析 ===');
    if (currentSettings.files.enabled && currentSettings.files.selected.length > 0) {
      // 如果有analyzeTaskOverlap函数可用
      if (typeof this.api.analyzeTaskOverlap === 'function') {
        const overlapAnalysis = this.api.analyzeTaskOverlap(chatId, currentSettings);
        console.log('重复检测结果:', overlapAnalysis);
      }
      
      // 手动验证
      console.log('\\n=== 手动验证 ===');
      const existingFiles = new Set();
      enabledTasks.forEach(task => {
        if (task.settings?.files?.enabled && task.settings.files.selected) {
          task.settings.files.selected.forEach(url => {
            console.log(`文件 "${url}" 来自任务 "${task.name}"`);
            existingFiles.add(url);
          });
        }
      });
      
      console.log('所有现有文件URL:', Array.from(existingFiles));
      console.log('当前选择的文件URL:', currentSettings.files.selected);
      
      const actualDuplicates = currentSettings.files.selected.filter(url => existingFiles.has(url));
      const actualNew = currentSettings.files.selected.filter(url => !existingFiles.has(url));
      
      console.log('实际重复文件:', actualDuplicates);
      console.log('实际新文件:', actualNew);
      console.log('重复数量验证:', actualDuplicates.length);
    } else {
      console.log('当前未启用文件或未选择文件');
    }
    
    console.log('=== 调试完成 ===');
    
    if (this.api.toastr) {
      this.api.toastr.info('文件重复检测调试信息已输出到控制台', '调试完成');
    }
  }
  
  /**
   * 分析世界信息重复
   */
  analyzeWorldInfoOverlap() {
    console.log('=== 世界信息重复分析 ===');
    
    const chatId = this.api.getCurrentChatId();
    if (!chatId) {
      console.log('错误：未选择聊天');
      return;
    }
    
    const settings = this.api.getSettings();
    const currentWI = settings.selected_content.world_info;
    
    console.log('当前世界信息选择:', currentWI);
    
    // 获取所有任务
    const allTasks = this.api.getChatTasks(chatId);
    const enabledTasks = allTasks.filter(t => t.enabled);
    
    // 分析每个任务的世界信息
    const taskWorldInfo = new Map();
    enabledTasks.forEach(task => {
      if (task.settings?.world_info?.enabled && task.settings.world_info.selected) {
        taskWorldInfo.set(task.name, task.settings.world_info.selected);
      }
    });
    
    console.log('各任务的世界信息选择:');
    taskWorldInfo.forEach((selected, taskName) => {
      const totalEntries = Object.values(selected).flat().length;
      console.log(`  - ${taskName}: ${totalEntries} 个条目`, selected);
    });
    
    // 检查重复的条目
    const allSelectedUIDs = new Set();
    const duplicateUIDs = new Set();
    
    taskWorldInfo.forEach((selected, taskName) => {
      Object.values(selected).flat().forEach(uid => {
        if (allSelectedUIDs.has(uid)) {
          duplicateUIDs.add(uid);
        }
        allSelectedUIDs.add(uid);
      });
    });
    
    if (duplicateUIDs.size > 0) {
      console.log('发现重复的世界信息条目UID:', Array.from(duplicateUIDs));
    } else {
      console.log('未发现重复的世界信息条目');
    }
    
    // 检查当前选择与已有任务的重复
    const currentUIDs = Object.values(currentWI.selected).flat();
    const conflictUIDs = currentUIDs.filter(uid => allSelectedUIDs.has(uid));
    
    console.log('当前选择与已有任务的冲突条目:', conflictUIDs);
    
    console.log('=== 分析完成 ===');
    
    return {
      taskWorldInfo: Object.fromEntries(taskWorldInfo),
      duplicateUIDs: Array.from(duplicateUIDs),
      conflictUIDs
    };
  }
  
  /**
   * 分析任务重复
   */
  analyzeTaskOverlap() {
    console.log('=== 任务重复分析 ===');
    
    const chatId = this.api.getCurrentChatId();
    if (!chatId) {
      console.log('错误：未选择聊天');
      return;
    }
    
    const allTasks = this.api.getChatTasks(chatId);
    console.log(`总任务数: ${allTasks.length}`);
    
    // 按启用状态分组
    const enabledTasks = allTasks.filter(t => t.enabled);
    const disabledTasks = allTasks.filter(t => !t.enabled);
    
    console.log(`启用任务: ${enabledTasks.length}, 禁用任务: ${disabledTasks.length}`);
    
    // 分析任务内容重复
    const contentAnalysis = {
      files: new Map(),
      worldInfo: new Map(),
      chat: new Map()
    };
    
    allTasks.forEach(task => {
      // 文件内容分析
      if (task.settings?.files?.enabled && task.settings.files.selected) {
        task.settings.files.selected.forEach(file => {
          if (!contentAnalysis.files.has(file)) {
            contentAnalysis.files.set(file, []);
          }
          contentAnalysis.files.get(file).push(task.name);
        });
      }
      
      // 世界信息内容分析
      if (task.settings?.world_info?.enabled && task.settings.world_info.selected) {
        Object.values(task.settings.world_info.selected).flat().forEach(uid => {
          if (!contentAnalysis.worldInfo.has(uid)) {
            contentAnalysis.worldInfo.set(uid, []);
          }
          contentAnalysis.worldInfo.get(uid).push(task.name);
        });
      }
      
      // 聊天范围分析
      if (task.settings?.chat?.enabled && task.settings.chat.range) {
        const rangeKey = `${task.settings.chat.range.start}-${task.settings.chat.range.end}`;
        if (!contentAnalysis.chat.has(rangeKey)) {
          contentAnalysis.chat.set(rangeKey, []);
        }
        contentAnalysis.chat.get(rangeKey).push(task.name);
      }
    });
    
    // 找出重复内容
    console.log('\\n=== 重复内容分析 ===');
    
    // 文件重复
    const duplicateFiles = Array.from(contentAnalysis.files.entries())
      .filter(([file, tasks]) => tasks.length > 1);
    
    if (duplicateFiles.length > 0) {
      console.log('重复的文件:');
      duplicateFiles.forEach(([file, tasks]) => {
        console.log(`  - ${file}: 被 ${tasks.join(', ')} 使用`);
      });
    }
    
    // 世界信息重复
    const duplicateWI = Array.from(contentAnalysis.worldInfo.entries())
      .filter(([uid, tasks]) => tasks.length > 1);
    
    if (duplicateWI.length > 0) {
      console.log('重复的世界信息条目:');
      duplicateWI.forEach(([uid, tasks]) => {
        console.log(`  - UID ${uid}: 被 ${tasks.join(', ')} 使用`);
      });
    }
    
    // 聊天范围重复
    const duplicateChat = Array.from(contentAnalysis.chat.entries())
      .filter(([range, tasks]) => tasks.length > 1);
    
    if (duplicateChat.length > 0) {
      console.log('重复的聊天范围:');
      duplicateChat.forEach(([range, tasks]) => {
        console.log(`  - 范围 ${range}: 被 ${tasks.join(', ')} 使用`);
      });
    }
    
    console.log('=== 分析完成 ===');
    
    return {
      totalTasks: allTasks.length,
      enabledTasks: enabledTasks.length,
      duplicates: {
        files: duplicateFiles,
        worldInfo: duplicateWI,
        chat: duplicateChat
      }
    };
  }
  
  /**
   * 验证数据完整性
   */
  validateDataIntegrity() {
    console.log('=== 数据完整性验证 ===');
    
    const issues = [];
    const settings = this.api.getSettings();
    
    // 检查设置结构完整性
    const requiredStructure = {
      'master_enabled': 'boolean',
      'selected_content': 'object',
      'selected_content.chat': 'object',
      'selected_content.files': 'object',
      'selected_content.world_info': 'object'
    };
    
    Object.entries(requiredStructure).forEach(([path, expectedType]) => {
      const value = path.split('.').reduce((obj, key) => obj?.[key], settings);
      if (typeof value !== expectedType) {
        issues.push(`设置结构错误: ${path} 应为 ${expectedType}, 实际为 ${typeof value}`);
      }
    });
    
    // 检查文件设置完整性
    const fileSettings = settings.selected_content?.files;
    if (fileSettings) {
      if (!Array.isArray(fileSettings.selected)) {
        issues.push('文件选择应为数组类型');
      }
      if (typeof fileSettings.enabled !== 'boolean') {
        issues.push('文件启用状态应为布尔类型');
      }
    }
    
    // 检查世界信息设置完整性
    const wiSettings = settings.selected_content?.world_info;
    if (wiSettings) {
      if (typeof wiSettings.selected !== 'object') {
        issues.push('世界信息选择应为对象类型');
      } else {
        // 检查每个世界的选择是否为数组
        Object.entries(wiSettings.selected).forEach(([world, selection]) => {
          if (!Array.isArray(selection)) {
            issues.push(`世界 "${world}" 的选择应为数组类型`);
          }
        });
      }
    }
    
    // 检查聊天设置完整性
    const chatSettings = settings.selected_content?.chat;
    if (chatSettings) {
      if (chatSettings.range && (
        typeof chatSettings.range.start !== 'number' || 
        typeof chatSettings.range.end !== 'number'
      )) {
        issues.push('聊天范围应为数字类型');
      }
      if (chatSettings.types && (
        typeof chatSettings.types.user !== 'boolean' ||
        typeof chatSettings.types.assistant !== 'boolean'
      )) {
        issues.push('聊天类型设置应为布尔类型');
      }
    }
    
    // 检查任务数据完整性
    const chatId = this.api.getCurrentChatId();
    if (chatId) {
      const tasks = this.api.getChatTasks(chatId);
      tasks.forEach((task, index) => {
        if (!task.taskId) {
          issues.push(`任务 ${index} 缺少taskId`);
        }
        if (!task.name) {
          issues.push(`任务 ${index} 缺少名称`);
        }
        if (typeof task.enabled !== 'boolean') {
          issues.push(`任务 ${index} 的启用状态应为布尔类型`);
        }
        if (!task.timestamp) {
          issues.push(`任务 ${index} 缺少时间戳`);
        }
      });
    }
    
    console.log(`数据完整性检查完成，发现 ${issues.length} 个问题:`);
    issues.forEach((issue, index) => {
      console.log(`  ${index + 1}. ${issue}`);
    });
    
    if (issues.length === 0) {
      console.log('✓ 数据完整性良好');
    }
    
    console.log('=== 验证完成 ===');
    
    if (this.api.toastr) {
      const message = issues.length > 0 ? `发现 ${issues.length} 个完整性问题` : '数据完整性良好';
      this.api.toastr.info(message + '，详情见控制台', '完整性验证');
    }
    
    return {
      isValid: issues.length === 0,
      issues
    };
  }
  
  /**
   * 检查数据一致性
   */
  checkDataConsistency() {
    console.log('=== 数据一致性检查 ===');
    
    const inconsistencies = [];
    const settings = this.api.getSettings();
    
    // 检查UI与设置的一致性
    const uiFileEnabled = this.api.jQuery('#vectors_enhanced_files_enabled').prop('checked');
    const settingFileEnabled = settings.selected_content?.files?.enabled;
    
    if (uiFileEnabled !== settingFileEnabled) {
      inconsistencies.push(`文件启用状态不一致: UI=${uiFileEnabled}, 设置=${settingFileEnabled}`);
    }
    
    const uiWIEnabled = this.api.jQuery('#vectors_enhanced_wi_enabled').prop('checked');
    const settingWIEnabled = settings.selected_content?.world_info?.enabled;
    
    if (uiWIEnabled !== settingWIEnabled) {
      inconsistencies.push(`世界信息启用状态不一致: UI=${uiWIEnabled}, 设置=${settingWIEnabled}`);
    }
    
    const uiChatEnabled = this.api.jQuery('#vectors_enhanced_chat_enabled').prop('checked');
    const settingChatEnabled = settings.selected_content?.chat?.enabled;
    
    if (uiChatEnabled !== settingChatEnabled) {
      inconsistencies.push(`聊天启用状态不一致: UI=${uiChatEnabled}, 设置=${settingChatEnabled}`);
    }
    
    // 检查选择数量的一致性
    const uiSelectedFiles = this.api.jQuery('#vectors_enhanced_files_list input:checked').length;
    const settingSelectedFiles = settings.selected_content?.files?.selected?.length || 0;
    
    if (uiSelectedFiles !== settingSelectedFiles) {
      inconsistencies.push(`文件选择数量不一致: UI=${uiSelectedFiles}, 设置=${settingSelectedFiles}`);
    }
    
    const uiSelectedWI = this.api.jQuery('#vectors_enhanced_wi_list input:checked:not(.world-select-all)').length;
    const settingSelectedWI = Object.values(settings.selected_content?.world_info?.selected || {}).flat().length;
    
    if (uiSelectedWI !== settingSelectedWI) {
      inconsistencies.push(`世界信息选择数量不一致: UI=${uiSelectedWI}, 设置=${settingSelectedWI}`);
    }
    
    console.log(`数据一致性检查完成，发现 ${inconsistencies.length} 个不一致:`);
    inconsistencies.forEach((inconsistency, index) => {
      console.log(`  ${index + 1}. ${inconsistency}`);
    });
    
    if (inconsistencies.length === 0) {
      console.log('✓ 数据一致性良好');
    }
    
    console.log('=== 检查完成 ===');
    
    return {
      isConsistent: inconsistencies.length === 0,
      inconsistencies
    };
  }
  
  /**
   * 分析数据流
   */
  analyzeDataFlow() {
    console.log('=== 数据流分析 ===');
    
    const flow = {
      settings: {},
      ui: {},
      api: {},
      tasks: {}
    };
    
    // 设置数据流
    const settings = this.api.getSettings();
    flow.settings = {
      source: 'extension_settings.vectors_enhanced',
      structure: Object.keys(settings || {}),
      size: JSON.stringify(settings || {}).length
    };
    
    // UI数据流
    flow.ui = {
      containers: this.api.jQuery('[id*="vectors_enhanced"]').length,
      inputs: this.api.jQuery('#vectors_enhanced_container input').length,
      checkboxes: this.api.jQuery('#vectors_enhanced_container input[type="checkbox"]').length,
      visibleElements: this.api.jQuery('#vectors_enhanced_container :visible').length
    };
    
    // API数据流
    flow.api = {
      availableFunctions: Object.keys(this.api).length,
      functionsUsed: ['getSettings', 'getCurrentChatId', 'getChatTasks'].filter(func => typeof this.api[func] === 'function').length
    };
    
    // 任务数据流
    const chatId = this.api.getCurrentChatId();
    if (chatId) {
      const tasks = this.api.getChatTasks(chatId);
      flow.tasks = {
        total: tasks.length,
        enabled: tasks.filter(t => t.enabled).length,
        withFiles: tasks.filter(t => t.settings?.files?.enabled).length,
        withWorldInfo: tasks.filter(t => t.settings?.world_info?.enabled).length,
        withChat: tasks.filter(t => t.settings?.chat?.enabled).length
      };
    }
    
    console.log('数据流分析结果:', flow);
    console.log('=== 分析完成 ===');
    
    return flow;
  }
  
  /**
   * 生成统计信息
   */
  generateStatistics() {
    console.log('=== 统计信息生成 ===');
    
    const stats = {};
    const settings = this.api.getSettings();
    const chatId = this.api.getCurrentChatId();
    
    // 基础统计
    stats.basic = {
      pluginEnabled: settings?.master_enabled || false,
      chatSelected: !!chatId,
      timestamp: new Date().toISOString()
    };
    
    // 内容选择统计
    stats.content = {
      chatEnabled: settings?.selected_content?.chat?.enabled || false,
      filesEnabled: settings?.selected_content?.files?.enabled || false,
      worldInfoEnabled: settings?.selected_content?.world_info?.enabled || false,
      
      selectedFiles: settings?.selected_content?.files?.selected?.length || 0,
      selectedWorlds: Object.keys(settings?.selected_content?.world_info?.selected || {}).length,
      selectedWIEntries: Object.values(settings?.selected_content?.world_info?.selected || {}).flat().length
    };
    
    // 任务统计
    if (chatId) {
      const tasks = this.api.getChatTasks(chatId);
      stats.tasks = {
        total: tasks.length,
        enabled: tasks.filter(t => t.enabled).length,
        disabled: tasks.filter(t => !t.enabled).length,
        avgAge: tasks.length > 0 ? 
          (Date.now() - tasks.reduce((sum, t) => sum + t.timestamp, 0) / tasks.length) / (1000 * 60 * 60 * 24) : 0
      };
    }
    
    // UI统计
    stats.ui = {
      totalInputs: this.api.jQuery('#vectors_enhanced_container input').length,
      checkedInputs: this.api.jQuery('#vectors_enhanced_container input:checked').length,
      visibleSections: this.api.jQuery('#vectors_enhanced_container .vectors-enhanced-section:visible').length
    };
    
    // 隐藏消息统计
    const hiddenMessages = this.api.getHiddenMessages();
    stats.hiddenMessages = {
      count: hiddenMessages.length,
      userMessages: hiddenMessages.filter(msg => msg.is_user).length,
      assistantMessages: hiddenMessages.filter(msg => !msg.is_user).length
    };
    
    console.log('统计信息:', stats);
    console.log('=== 生成完成 ===');
    
    if (this.api.toastr) {
      this.api.toastr.info('统计信息已输出到控制台', '统计生成');
    }
    
    return stats;
  }
  
  /**
   * 分析使用模式
   */
  analyzeUsagePatterns() {
    console.log('=== 使用模式分析 ===');
    
    const patterns = {};
    const settings = this.api.getSettings();
    const chatId = this.api.getCurrentChatId();
    
    // 功能使用模式
    patterns.features = {
      chatUsage: settings?.selected_content?.chat?.enabled ? 'active' : 'inactive',
      fileUsage: settings?.selected_content?.files?.enabled ? 'active' : 'inactive',
      worldInfoUsage: settings?.selected_content?.world_info?.enabled ? 'active' : 'inactive'
    };
    
    // 内容复杂度模式
    patterns.complexity = {
      fileSelectionSize: settings?.selected_content?.files?.selected?.length || 0,
      worldInfoSelectionSize: Object.values(settings?.selected_content?.world_info?.selected || {}).flat().length,
      complexityLevel: this.calculateComplexityLevel(settings)
    };
    
    // 任务管理模式
    if (chatId) {
      const tasks = this.api.getChatTasks(chatId);
      patterns.taskManagement = {
        taskCreationFrequency: this.calculateTaskFrequency(tasks),
        enabledRatio: tasks.length > 0 ? tasks.filter(t => t.enabled).length / tasks.length : 0,
        managementStyle: this.determineManagementStyle(tasks)
      };
    }
    
    // UI交互模式
    patterns.uiInteraction = {
      sectionsExpanded: this.api.jQuery('#vectors_enhanced_container details[open]').length,
      totalSections: this.api.jQuery('#vectors_enhanced_container details').length,
      interactionLevel: this.calculateInteractionLevel()
    };
    
    console.log('使用模式分析:', patterns);
    console.log('=== 分析完成 ===');
    
    return patterns;
  }
  
  /**
   * 计算复杂度级别
   */
  calculateComplexityLevel(settings) {
    let score = 0;
    
    if (settings?.selected_content?.chat?.enabled) score += 1;
    if (settings?.selected_content?.files?.enabled) score += 1;
    if (settings?.selected_content?.world_info?.enabled) score += 1;
    
    score += Math.min((settings?.selected_content?.files?.selected?.length || 0) / 5, 2);
    score += Math.min(Object.keys(settings?.selected_content?.world_info?.selected || {}).length / 3, 2);
    
    if (score <= 2) return 'simple';
    if (score <= 5) return 'moderate';
    return 'complex';
  }
  
  /**
   * 计算任务频率
   */
  calculateTaskFrequency(tasks) {
    if (tasks.length < 2) return 'low';
    
    const timestamps = tasks.map(t => t.timestamp).sort();
    const intervals = [];
    
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }
    
    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const dayInterval = avgInterval / (1000 * 60 * 60 * 24);
    
    if (dayInterval < 1) return 'high';
    if (dayInterval < 7) return 'moderate';
    return 'low';
  }
  
  /**
   * 确定管理风格
   */
  determineManagementStyle(tasks) {
    const enabledRatio = tasks.filter(t => t.enabled).length / tasks.length;
    
    if (enabledRatio > 0.8) return 'inclusive'; // 倾向于启用大部分任务
    if (enabledRatio < 0.3) return 'selective'; // 倾向于只启用少数任务
    return 'balanced'; // 平衡式管理
  }
  
  /**
   * 计算交互级别
   */
  calculateInteractionLevel() {
    const totalInteractables = this.api.jQuery('#vectors_enhanced_container input, #vectors_enhanced_container button').length;
    const activeInteractables = this.api.jQuery('#vectors_enhanced_container input:checked, #vectors_enhanced_container button:not(:disabled)').length;
    
    const ratio = activeInteractables / totalInteractables;
    
    if (ratio > 0.7) return 'high';
    if (ratio > 0.3) return 'moderate';
    return 'low';
  }
}