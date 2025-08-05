/**
 * Data Cleaner
 * 数据清理工具
 * 
 * 负责各种数据清理和重置操作
 */

export class DataCleaner {
  constructor(api) {
    this.api = api;
  }
  
  /**
   * 清空世界信息选择 (原clearWorldInfoSelection)
   */
  async clearWorldInfoSelection() {
    console.log('=== 清除世界信息选择 ===');
    
    const settings = this.api.getSettings();
    const beforeState = JSON.stringify(settings.selected_content.world_info.selected);
    console.log('清除前的选择状态:', beforeState);
    
    // 清除所有世界信息选择
    settings.selected_content.world_info.selected = {};
    settings.selected_content.world_info.enabled = false;
    
    // 保存设置
    Object.assign(this.api.extension_settings.vectors_enhanced, settings);
    this.api.saveSettingsDebounced();
    
    // 更新UI
    this.api.jQuery('#vectors_enhanced_wi_enabled').prop('checked', false);
    
    // 调用主模块的UI更新功能
    if (typeof this.api.updateWorldInfoList === 'function') {
      await this.api.updateWorldInfoList();
    }
    
    console.log('清除后的选择状态:', JSON.stringify(settings.selected_content.world_info.selected));
    console.log('=== 清除完成 ===');
    
    if (this.api.toastr) {
      this.api.toastr.success('已清除所有世界信息选择状态', '清除完成');
    }
  }
  
  /**
   * 运行核心清理功能
   */
  async runCoreCleanup() {
    console.log('=== 运行核心清理功能 ===');
    
    try {
      if (typeof this.api.cleanupInvalidSelections === 'function') {
        await this.api.cleanupInvalidSelections();
        console.log('✓ 核心清理功能执行成功');
        
        if (this.api.toastr) {
          this.api.toastr.success('核心清理功能执行完成，详情见控制台', '清理完成');
        }
      } else {
        console.warn('核心清理功能不可用');
        if (this.api.toastr) {
          this.api.toastr.warning('核心清理功能不可用', '清理失败');
        }
      }
    } catch (error) {
      console.error('核心清理功能执行失败:', error);
      if (this.api.toastr) {
        this.api.toastr.error(`核心清理功能执行失败: ${error.message}`, '清理错误');
      }
    }
    
    console.log('=== 清理完成 ===');
  }
  
  /**
   * 清空文件选择
   */
  async clearFileSelections() {
    console.log('=== 清空文件选择 ===');
    
    const settings = this.api.getSettings();
    const beforeCount = settings.selected_content.files.selected.length;
    
    console.log(`清除前选择的文件数: ${beforeCount}`);
    console.log('文件列表:', settings.selected_content.files.selected);
    
    // 清空文件选择
    settings.selected_content.files.selected = [];
    settings.selected_content.files.enabled = false;
    
    // 保存设置
    Object.assign(this.api.extension_settings.vectors_enhanced, settings);
    this.api.saveSettingsDebounced();
    
    // 更新UI
    this.api.jQuery('#vectors_enhanced_files_enabled').prop('checked', false);
    this.api.jQuery('#vectors_enhanced_files_list input[type="checkbox"]').prop('checked', false);
    
    console.log('清除后选择的文件数: 0');
    console.log('=== 清空完成 ===');
    
    if (this.api.toastr) {
      this.api.toastr.success(`已清空 ${beforeCount} 个文件选择`, '清空完成');
    }
  }
  
  /**
   * 重置聊天设置
   */
  resetChatSettings() {
    console.log('=== 重置聊天设置 ===');
    
    const settings = this.api.getSettings();
    const beforeSettings = JSON.parse(JSON.stringify(settings.selected_content.chat));
    
    console.log('重置前的聊天设置:', beforeSettings);
    
    // 重置为默认值
    settings.selected_content.chat = {
      enabled: false,
      range: { start: 0, end: -1 },
      types: { user: true, assistant: true },
      tags: '',
      include_hidden: false
    };
    
    // 保存设置
    Object.assign(this.api.extension_settings.vectors_enhanced, settings);
    this.api.saveSettingsDebounced();
    
    // 更新UI
    this.api.jQuery('#vectors_enhanced_chat_enabled').prop('checked', false);
    this.api.jQuery('#vectors_enhanced_chat_start').val(0);
    this.api.jQuery('#vectors_enhanced_chat_end').val(-1);
    this.api.jQuery('#vectors_enhanced_chat_user').prop('checked', true);
    this.api.jQuery('#vectors_enhanced_chat_assistant').prop('checked', true);
    this.api.jQuery('#vectors_enhanced_chat_include_hidden').prop('checked', false);
    this.api.jQuery('#vectors_enhanced_chat_tags').val('');
    
    console.log('重置后的聊天设置:', settings.selected_content.chat);
    console.log('=== 重置完成 ===');
    
    if (this.api.toastr) {
      this.api.toastr.success('聊天设置已重置为默认值', '重置完成');
    }
  }
  
  /**
   * 重置所有设置
   */
  async resetAllSettings() {
    console.log('=== 重置所有设置 ===');
    
    const settings = this.api.getSettings();
    const backup = JSON.parse(JSON.stringify(settings));
    
    console.log('创建设置备份完成');
    
    try {
      // 重置各个部分
      await this.clearWorldInfoSelection();
      await this.clearFileSelections();
      this.resetChatSettings();
      
      // 重置主开关和其他设置
      settings.master_enabled = true;
      settings.enabled = true;
      
      // 保存设置
      Object.assign(this.api.extension_settings.vectors_enhanced, settings);
      this.api.saveSettingsDebounced();
      
      // 更新主开关UI
      this.api.jQuery('#vectors_enhanced_master_enabled').prop('checked', true);
      this.api.jQuery('#vectors_enhanced_enabled').prop('checked', true);
      
      console.log('=== 重置完成 ===');
      
      if (this.api.toastr) {
        this.api.toastr.success('所有设置已重置为默认值', '重置完成');
      }
      
      return true;
    } catch (error) {
      console.error('重置设置时出错，正在恢复备份:', error);
      
      // 恢复备份
      Object.assign(this.api.extension_settings.vectors_enhanced, backup);
      this.api.saveSettingsDebounced();
      
      if (this.api.toastr) {
        this.api.toastr.error(`重置失败，已恢复备份: ${error.message}`, '重置错误');
      }
      
      return false;
    }
  }
  
  /**
   * 清除向量数据
   */
  async purgeVectorData() {
    console.log('=== 清除向量数据 ===');
    
    const chatId = this.api.getCurrentChatId();
    if (!chatId) {
      console.log('错误：未选择聊天');
      if (this.api.toastr) {
        this.api.toastr.error('未选择聊天');
      }
      return false;
    }
    
    try {
      // 如果有purgeVectorIndex函数可用
      if (typeof purgeVectorIndex === 'function') {
        const result = await purgeVectorIndex(chatId);
        
        if (result) {
          console.log('✓ 向量数据清除成功');
          if (this.api.toastr) {
            this.api.toastr.success('向量数据已清除', '清除完成');
          }
          return true;
        } else {
          console.log('向量数据清除失败');
          if (this.api.toastr) {
            this.api.toastr.warning('向量数据清除失败', '清除失败');
          }
          return false;
        }
      } else {
        console.warn('purgeVectorIndex函数不可用');
        
        // 尝试清除任务列表
        const settings = this.api.getSettings();
        if (settings.vector_tasks && settings.vector_tasks[chatId]) {
          delete settings.vector_tasks[chatId];
          Object.assign(this.api.extension_settings.vectors_enhanced, settings);
          this.api.saveSettingsDebounced();
          
          console.log('✓ 任务列表已清除');
          if (this.api.toastr) {
            this.api.toastr.success('任务列表已清除', '清除完成');
          }
          return true;
        }
        
        return false;
      }
    } catch (error) {
      console.error('清除向量数据时出错:', error);
      if (this.api.toastr) {
        this.api.toastr.error(`清除向量数据失败: ${error.message}`, '清除错误');
      }
      return false;
    }
  }
  
  /**
   * 清理缓存
   */
  async cleanupCache() {
    console.log('=== 清理缓存 ===');
    
    let cleanedItems = 0;
    
    try {
      // 清理向量缓存（如果可用）
      if (typeof cachedVectors !== 'undefined' && cachedVectors.clear) {
        const beforeSize = cachedVectors.size;
        cachedVectors.clear();
        cleanedItems += beforeSize;
        console.log(`✓ 清理了 ${beforeSize} 个向量缓存项`);
      }
      
      // 清理localStorage中的相关数据
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('vectors')) {
          keysToRemove.push(key);
        }
      }
      
      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        cleanedItems++;
      });
      
      if (keysToRemove.length > 0) {
        console.log(`✓ 清理了 ${keysToRemove.length} 个localStorage项:`, keysToRemove);
      }
      
      // 清理sessionStorage中的相关数据
      const sessionKeysToRemove = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.includes('vectors')) {
          sessionKeysToRemove.push(key);
        }
      }
      
      sessionKeysToRemove.forEach(key => {
        sessionStorage.removeItem(key);
        cleanedItems++;
      });
      
      if (sessionKeysToRemove.length > 0) {
        console.log(`✓ 清理了 ${sessionKeysToRemove.length} 个sessionStorage项:`, sessionKeysToRemove);
      }
      
      console.log(`=== 缓存清理完成，共清理 ${cleanedItems} 个项目 ===`);
      
      if (this.api.toastr) {
        this.api.toastr.success(`缓存清理完成，共清理 ${cleanedItems} 个项目`, '清理完成');
      }
      
      return true;
    } catch (error) {
      console.error('清理缓存时出错:', error);
      if (this.api.toastr) {
        this.api.toastr.error(`缓存清理失败: ${error.message}`, '清理错误');
      }
      return false;
    }
  }
  
  /**
   * 批量清理
   */
  async bulkCleanup(options = {}) {
    console.log('=== 开始批量清理 ===');
    
    const defaultOptions = {
      clearWorldInfo: true,
      clearFiles: true,
      resetChat: true,
      purgeVectors: false,
      cleanCache: true,
      resetSettings: false
    };
    
    const cleanupOptions = { ...defaultOptions, ...options };
    const results = {};
    
    console.log('清理选项:', cleanupOptions);
    
    try {
      // 世界信息清理
      if (cleanupOptions.clearWorldInfo) {
        console.log('\\n执行世界信息清理...');
        await this.clearWorldInfoSelection();
        results.worldInfo = true;
      }
      
      // 文件清理
      if (cleanupOptions.clearFiles) {
        console.log('\\n执行文件清理...');
        await this.clearFileSelections();
        results.files = true;
      }
      
      // 聊天设置重置
      if (cleanupOptions.resetChat) {
        console.log('\\n执行聊天设置重置...');
        this.resetChatSettings();
        results.chat = true;
      }
      
      // 向量数据清除
      if (cleanupOptions.purgeVectors) {
        console.log('\\n执行向量数据清除...');
        results.vectors = await this.purgeVectorData();
      }
      
      // 缓存清理
      if (cleanupOptions.cleanCache) {
        console.log('\\n执行缓存清理...');
        results.cache = await this.cleanupCache();
      }
      
      // 设置重置
      if (cleanupOptions.resetSettings) {
        console.log('\\n执行设置重置...');
        results.settings = await this.resetAllSettings();
      }
      
      // 运行核心清理
      console.log('\\n执行核心清理...');
      await this.runCoreCleanup();
      results.coreCleanup = true;
      
      console.log('\\n=== 批量清理完成 ===');
      console.log('清理结果:', results);
      
      const successCount = Object.values(results).filter(Boolean).length;
      const totalCount = Object.keys(results).length;
      
      if (this.api.toastr) {
        this.api.toastr.success(`批量清理完成: ${successCount}/${totalCount} 项成功`, '清理完成');
      }
      
      return results;
    } catch (error) {
      console.error('批量清理时出错:', error);
      if (this.api.toastr) {
        this.api.toastr.error(`批量清理失败: ${error.message}`, '清理错误');
      }
      return results;
    }
  }
  
  /**
   * 验证清理结果
   */
  validateCleanupResults() {
    console.log('=== 验证清理结果 ===');
    
    const settings = this.api.getSettings();
    const validation = {
      worldInfo: {
        enabled: settings.selected_content.world_info.enabled,
        selectedCount: Object.values(settings.selected_content.world_info.selected).flat().length,
        isClean: !settings.selected_content.world_info.enabled && 
                Object.keys(settings.selected_content.world_info.selected).length === 0
      },
      files: {
        enabled: settings.selected_content.files.enabled,
        selectedCount: settings.selected_content.files.selected.length,
        isClean: !settings.selected_content.files.enabled && 
                settings.selected_content.files.selected.length === 0
      },
      chat: {
        enabled: settings.selected_content.chat.enabled,
        isClean: !settings.selected_content.chat.enabled
      }
    };
    
    const allClean = Object.values(validation).every(item => item.isClean);
    
    console.log('清理验证结果:', validation);
    console.log(`整体清理状态: ${allClean ? '✓ 干净' : '✗ 仍有残留'}`);
    
    if (!allClean) {
      console.log('发现以下残留:');
      Object.entries(validation).forEach(([key, result]) => {
        if (!result.isClean) {
          console.log(`  - ${key}: 仍有数据残留`);
        }
      });
    }
    
    console.log('=== 验证完成 ===');
    
    if (this.api.toastr) {
      const message = allClean ? '清理验证通过' : '发现数据残留';
      this.api.toastr.info(message + '，详情见控制台', '清理验证');
    }
    
    return {
      isClean: allClean,
      details: validation
    };
  }
  
  /**
   * 创建设置备份
   */
  createSettingsBackup() {
    console.log('=== 创建设置备份 ===');
    
    const settings = this.api.getSettings();
    const backup = {
      timestamp: Date.now(),
      settings: JSON.parse(JSON.stringify(settings)),
      version: '1.0.0'
    };
    
    try {
      const backupJson = JSON.stringify(backup, null, 2);
      const blob = new Blob([backupJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vectors-settings-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log('✓ 设置备份已下载');
      
      if (this.api.toastr) {
        this.api.toastr.success('设置备份已下载', '备份完成');
      }
      
      return backup;
    } catch (error) {
      console.error('创建设置备份失败:', error);
      if (this.api.toastr) {
        this.api.toastr.error(`备份失败: ${error.message}`, '备份错误');
      }
      return null;
    }
  }
}