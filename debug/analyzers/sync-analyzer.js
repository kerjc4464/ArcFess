/**
 * Sync Analyzer
 * 同步分析器
 * 
 * 负责分析UI与后端设置的同步状态
 */

export class SyncAnalyzer {
  constructor(api) {
    this.api = api;
  }
  
  /**
   * 分析UI同步状态 (原debugUiSync)
   */
  analyzeUiSync() {
    console.log('=== UI同步状态调试 ===');
    
    const settings = this.api.getSettings();
    
    // 检查文件UI状态
    console.log('\\n=== 文件选择状态 ===');
    console.log('设置中的文件选择:', {
      enabled: settings.selected_content.files.enabled,
      selected: settings.selected_content.files.selected,
      count: settings.selected_content.files.selected.length
    });
    
    // 检查UI中实际勾选的文件
    const checkedFiles = [];
    this.api.jQuery('#vectors_enhanced_files_list input[type="checkbox"]:checked').each(function() {
      checkedFiles.push(this.api.jQuery(this).val());
    });
    
    console.log('UI中勾选的文件:', {
      checkedFiles,
      count: checkedFiles.length
    });
    
    // 比较差异
    const settingsSet = new Set(settings.selected_content.files.selected);
    const uiSet = new Set(checkedFiles);
    
    const onlyInSettings = settings.selected_content.files.selected.filter(url => !uiSet.has(url));
    const onlyInUI = checkedFiles.filter(url => !settingsSet.has(url));
    
    console.log('同步状态分析:', {
      isSync: onlyInSettings.length === 0 && onlyInUI.length === 0,
      onlyInSettings: onlyInSettings,
      onlyInUI: onlyInUI
    });
    
    // 检查世界信息状态
    console.log('\\n=== 世界信息选择状态 ===');
    console.log('设置中的世界信息选择:', {
      enabled: settings.selected_content.world_info.enabled,
      selected: settings.selected_content.world_info.selected,
      totalCount: Object.values(settings.selected_content.world_info.selected).flat().length
    });
    
    const checkedWI = [];
    this.api.jQuery('#vectors_enhanced_wi_list input[type="checkbox"]:checked').each(function() {
      if (!this.api.jQuery(this).hasClass('world-select-all')) {
        checkedWI.push(this.api.jQuery(this).val());
      }
    }.bind(this));
    
    console.log('UI中勾选的世界信息:', {
      checkedWI,
      count: checkedWI.length
    });
    
    // 比较世界信息差异
    const settingsWI = Object.values(settings.selected_content.world_info.selected).flat();
    const settingsWISet = new Set(settingsWI);
    const uiWISet = new Set(checkedWI);
    
    const onlyInSettingsWI = settingsWI.filter(uid => !uiWISet.has(uid));
    const onlyInUIWI = checkedWI.filter(uid => !settingsWISet.has(uid));
    
    console.log('世界信息同步状态:', {
      isSync: onlyInSettingsWI.length === 0 && onlyInUIWI.length === 0,
      onlyInSettings: onlyInSettingsWI,
      onlyInUI: onlyInUIWI,
      settingsCount: settingsWI.length,
      uiCount: checkedWI.length
    });
    
    // 检查聊天设置
    console.log('\\n=== 聊天设置状态 ===');
    console.log('设置中的聊天配置:', settings.selected_content.chat);
    console.log('UI中的聊天配置:', {
      enabled: this.api.jQuery('#vectors_enhanced_chat_enabled').prop('checked'),
      start: this.api.jQuery('#vectors_enhanced_chat_start').val(),
      end: this.api.jQuery('#vectors_enhanced_chat_end').val(),
      user: this.api.jQuery('#vectors_enhanced_chat_user').prop('checked'),
      assistant: this.api.jQuery('#vectors_enhanced_chat_assistant').prop('checked'),
      include_hidden: this.api.jQuery('#vectors_enhanced_chat_include_hidden').prop('checked'),
      tags: this.api.jQuery('#vectors_enhanced_chat_tags').val()
    });
    
    console.log('=== 调试完成 ===');
    
    const syncIssues = onlyInSettings.length + onlyInUI.length + onlyInSettingsWI.length + onlyInUIWI.length;
    if (this.api.toastr) {
      this.api.toastr.info(`UI同步检查完成，发现 ${syncIssues} 个不同步项目，详情见控制台`, 'UI同步调试');
    }
    
    return {
      files: {
        isSync: onlyInSettings.length === 0 && onlyInUI.length === 0,
        onlyInSettings,
        onlyInUI
      },
      worldInfo: {
        isSync: onlyInSettingsWI.length === 0 && onlyInUIWI.length === 0,
        onlyInSettings: onlyInSettingsWI,
        onlyInUI: onlyInUIWI
      },
      totalIssues: syncIssues
    };
  }
  
  /**
   * 深度分析世界信息 (原debugWorldInfoDeep)
   */
  async analyzeWorldInfoDeep() {
    console.log('=== 深度世界信息调试 ===');
    
    const chatId = this.api.getCurrentChatId();
    console.log('当前聊天ID:', chatId);
    
    // 获取所有世界信息条目
    const allEntries = await this.api.getSortedEntries();
    console.log(`\\n总共获取到 ${allEntries.length} 个世界信息条目`);
    
    // 按来源分组分析
    const sourceAnalysis = {
      global: [],
      character: [],
      chat: [],
      other: []
    };
    
    allEntries.forEach(entry => {
      // 分析条目来源
      if (entry.world) {
        // 简单的启发式分类
        if (entry.world.includes('global') || entry.world === 'global') {
          sourceAnalysis.global.push(entry);
        } else if (entry.world.includes('character') || entry.world.includes('角色')) {
          sourceAnalysis.character.push(entry);
        } else if (entry.world.includes('chat') || entry.world.includes('聊天')) {
          sourceAnalysis.chat.push(entry);
        } else {
          sourceAnalysis.other.push(entry);
        }
      }
    });
    
    console.log('\\n=== 按来源分析 ===');
    Object.entries(sourceAnalysis).forEach(([source, entries]) => {
      console.log(`${source.toUpperCase()}: ${entries.length} 个条目`);
      entries.forEach(entry => {
        console.log(`  - ${entry.world}: ${entry.comment || entry.uid} (disabled: ${entry.disable})`);
      });
    });
    
    // 分析所有世界
    const worldGroups = {};
    allEntries.forEach(entry => {
      if (!worldGroups[entry.world]) {
        worldGroups[entry.world] = [];
      }
      worldGroups[entry.world].push(entry);
    });
    
    console.log('\\n=== 按世界分组 ===');
    Object.entries(worldGroups).forEach(([world, entries]) => {
      const enabledCount = entries.filter(e => !e.disable).length;
      const totalCount = entries.length;
      console.log(`${world}: ${enabledCount}/${totalCount} 个启用条目`);
      
      entries.forEach(entry => {
        const status = entry.disable ? '❌禁用' : '✅启用';
        const hasContent = entry.content ? '有内容' : '❌无内容';
        console.log(`  - ${status} ${hasContent} ${entry.comment || entry.uid}`);
      });
    });
    
    // 分析当前设置
    const settings = this.api.getSettings();
    console.log('\\n=== 当前设置分析 ===');
    console.log('设置中的世界信息选择:', settings.selected_content.world_info.selected);
    
    Object.entries(settings.selected_content.world_info.selected).forEach(([world, uids]) => {
      console.log(`\\n世界 "${world}": 选择了 ${uids.length} 个条目`);
      
      uids.forEach(uid => {
        const entry = allEntries.find(e => e.uid === uid);
        if (entry) {
          const status = entry.disable ? '❌禁用' : '✅启用';
          const hasContent = entry.content ? '有内容' : '❌无内容';
          console.log(`  - ${status} ${hasContent} ${entry.comment || uid} (UID: ${uid})`);
        } else {
          console.log(`  - ❌不存在 UID: ${uid}`);
        }
      });
    });
    
    // 分析UI显示的内容
    console.log('\\n=== UI显示分析 ===');
    const visibleWorlds = new Set();
    this.api.jQuery('#vectors_enhanced_wi_list .wi-world-group').each(function() {
      const worldName = this.api.jQuery(this).find('.wi-world-name').text();
      visibleWorlds.add(worldName);
    }.bind(this));
    
    console.log('UI中显示的世界:', Array.from(visibleWorlds));
    
    // 找出差异
    const settingsWorlds = new Set(Object.keys(settings.selected_content.world_info.selected));
    const onlyInSettings = Array.from(settingsWorlds).filter(w => !visibleWorlds.has(w));
    const onlyInUI = Array.from(visibleWorlds).filter(w => !settingsWorlds.has(w));
    
    console.log('\\n=== 差异分析 ===');
    console.log('只在设置中存在的世界:', onlyInSettings);
    console.log('只在UI中显示的世界:', onlyInUI);
    
    console.log('=== 调试完成 ===');
    
    if (this.api.toastr) {
      this.api.toastr.info('深度世界信息调试完成，详情见控制台', '调试完成');
    }
    
    return {
      totalEntries: allEntries.length,
      sourceAnalysis,
      worldGroups,
      currentSettings: settings.selected_content.world_info.selected,
      visibleWorlds: Array.from(visibleWorlds),
      discrepancies: {
        onlyInSettings,
        onlyInUI
      }
    };
  }
  
  /**
   * 检查文件同步状态
   */
  checkFileSyncStatus() {
    console.log('=== 文件同步状态检查 ===');
    
    const settings = this.api.getSettings();
    const fileSettings = settings.selected_content.files;
    
    // 获取UI状态
    const uiEnabled = this.api.jQuery('#vectors_enhanced_files_enabled').prop('checked');
    const checkedFiles = [];
    this.api.jQuery('#vectors_enhanced_files_list input[type="checkbox"]:checked').each(function() {
      checkedFiles.push(this.api.jQuery(this).val());
    });
    
    const syncStatus = {
      enabled: {
        settings: fileSettings.enabled,
        ui: uiEnabled,
        synced: fileSettings.enabled === uiEnabled
      },
      selections: {
        settingsCount: fileSettings.selected.length,
        uiCount: checkedFiles.length,
        settingsFiles: fileSettings.selected,
        uiFiles: checkedFiles,
        synced: JSON.stringify(fileSettings.selected.sort()) === JSON.stringify(checkedFiles.sort())
      }
    };
    
    console.log('文件同步状态:', syncStatus);
    console.log('=== 检查完成 ===');
    
    return syncStatus;
  }
  
  /**
   * 检查世界信息同步状态
   */
  checkWorldInfoSyncStatus() {
    console.log('=== 世界信息同步状态检查 ===');
    
    const settings = this.api.getSettings();
    const wiSettings = settings.selected_content.world_info;
    
    // 获取UI状态
    const uiEnabled = this.api.jQuery('#vectors_enhanced_wi_enabled').prop('checked');
    const checkedEntries = [];
    this.api.jQuery('#vectors_enhanced_wi_list input[type="checkbox"]:checked').each(function() {
      if (!this.api.jQuery(this).hasClass('world-select-all')) {
        checkedEntries.push(this.api.jQuery(this).val());
      }
    }.bind(this));
    
    const settingsEntries = Object.values(wiSettings.selected).flat();
    
    const syncStatus = {
      enabled: {
        settings: wiSettings.enabled,
        ui: uiEnabled,
        synced: wiSettings.enabled === uiEnabled
      },
      selections: {
        settingsCount: settingsEntries.length,
        uiCount: checkedEntries.length,
        settingsEntries: settingsEntries,
        uiEntries: checkedEntries,
        synced: JSON.stringify(settingsEntries.sort()) === JSON.stringify(checkedEntries.sort())
      },
      worlds: {
        settingsWorlds: Object.keys(wiSettings.selected),
        settingsWorldCount: Object.keys(wiSettings.selected).length
      }
    };
    
    console.log('世界信息同步状态:', syncStatus);
    console.log('=== 检查完成 ===');
    
    return syncStatus;
  }
  
  /**
   * 检查聊天同步状态
   */
  checkChatSyncStatus() {
    console.log('=== 聊天同步状态检查 ===');
    
    const settings = this.api.getSettings();
    const chatSettings = settings.selected_content.chat;
    
    // 获取UI状态
    const uiState = {
      enabled: this.api.jQuery('#vectors_enhanced_chat_enabled').prop('checked'),
      start: parseInt(this.api.jQuery('#vectors_enhanced_chat_start').val()) || 0,
      end: parseInt(this.api.jQuery('#vectors_enhanced_chat_end').val()) || -1,
      user: this.api.jQuery('#vectors_enhanced_chat_user').prop('checked'),
      assistant: this.api.jQuery('#vectors_enhanced_chat_assistant').prop('checked'),
      include_hidden: this.api.jQuery('#vectors_enhanced_chat_include_hidden').prop('checked'),
      tags: this.api.jQuery('#vectors_enhanced_chat_tags').val()
    };
    
    const syncStatus = {
      enabled: chatSettings.enabled === uiState.enabled,
      range: {
        start: (chatSettings.range?.start || 0) === uiState.start,
        end: (chatSettings.range?.end || -1) === uiState.end
      },
      types: {
        user: (chatSettings.types?.user || true) === uiState.user,
        assistant: (chatSettings.types?.assistant || true) === uiState.assistant
      },
      include_hidden: (chatSettings.include_hidden || false) === uiState.include_hidden,
      tags: (chatSettings.tags || '') === uiState.tags,
      settings: chatSettings,
      ui: uiState
    };
    
    const allSynced = Object.values(syncStatus).every(val => 
      typeof val === 'boolean' ? val : Object.values(val).every(subVal => 
        typeof subVal === 'boolean' ? subVal : true
      )
    );
    
    syncStatus.allSynced = allSynced;
    
    console.log('聊天同步状态:', syncStatus);
    console.log('=== 检查完成 ===');
    
    return syncStatus;
  }
  
  /**
   * 查找所有同步差异
   */
  findSyncDiscrepancies() {
    console.log('=== 综合同步差异分析 ===');
    
    const discrepancies = {
      files: this.checkFileSyncStatus(),
      worldInfo: this.checkWorldInfoSyncStatus(),
      chat: this.checkChatSyncStatus()
    };
    
    // 统计总问题数
    let totalIssues = 0;
    const issues = [];
    
    // 文件问题
    if (!discrepancies.files.enabled.synced) {
      totalIssues++;
      issues.push('文件启用状态不同步');
    }
    if (!discrepancies.files.selections.synced) {
      totalIssues++;
      issues.push('文件选择不同步');
    }
    
    // 世界信息问题
    if (!discrepancies.worldInfo.enabled.synced) {
      totalIssues++;
      issues.push('世界信息启用状态不同步');
    }
    if (!discrepancies.worldInfo.selections.synced) {
      totalIssues++;
      issues.push('世界信息选择不同步');
    }
    
    // 聊天问题
    if (!discrepancies.chat.allSynced) {
      totalIssues++;
      issues.push('聊天设置不同步');
    }
    
    console.log(`\\n发现 ${totalIssues} 个同步问题:`);
    issues.forEach((issue, index) => {
      console.log(`  ${index + 1}. ${issue}`);
    });
    
    console.log('=== 分析完成 ===');
    
    if (this.api.toastr) {
      this.api.toastr.info(`发现 ${totalIssues} 个同步问题，详情见控制台`, '同步差异分析');
    }
    
    return {
      discrepancies,
      totalIssues,
      issues
    };
  }
  
  /**
   * 生成同步报告
   */
  generateSyncReport() {
    console.log('=== 生成同步状态报告 ===');
    
    const report = this.findSyncDiscrepancies();
    const timestamp = new Date().toLocaleString('zh-CN');
    
    const reportText = `
向量化插件同步状态报告
生成时间: ${timestamp}

=== 概览 ===
总同步问题: ${report.totalIssues}

=== 详细问题 ===
${report.issues.map((issue, index) => `${index + 1}. ${issue}`).join('\\n')}

=== 文件同步状态 ===
启用状态同步: ${report.discrepancies.files.enabled.synced ? '✓' : '✗'}
选择状态同步: ${report.discrepancies.files.selections.synced ? '✓' : '✗'}
设置中文件数: ${report.discrepancies.files.selections.settingsCount}
UI中文件数: ${report.discrepancies.files.selections.uiCount}

=== 世界信息同步状态 ===
启用状态同步: ${report.discrepancies.worldInfo.enabled.synced ? '✓' : '✗'}
选择状态同步: ${report.discrepancies.worldInfo.selections.synced ? '✓' : '✗'}
设置中条目数: ${report.discrepancies.worldInfo.selections.settingsCount}
UI中条目数: ${report.discrepancies.worldInfo.selections.uiCount}
设置中世界数: ${report.discrepancies.worldInfo.worlds.settingsWorldCount}

=== 聊天同步状态 ===
整体同步: ${report.discrepancies.chat.allSynced ? '✓' : '✗'}
启用状态: ${report.discrepancies.chat.enabled ? '✓' : '✗'}
范围设置: ${report.discrepancies.chat.range.start && report.discrepancies.chat.range.end ? '✓' : '✗'}
类型设置: ${report.discrepancies.chat.types.user && report.discrepancies.chat.types.assistant ? '✓' : '✗'}
    `.trim();
    
    console.log(reportText);
    
    // 下载报告
    try {
      const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vectors-sync-report-${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      if (this.api.toastr) {
        this.api.toastr.success('同步报告已下载', '报告生成');
      }
    } catch (error) {
      console.error('下载报告失败:', error);
    }
    
    console.log('=== 报告生成完成 ===');
    
    return report;
  }
}