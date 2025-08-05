/**
 * Inspector Tools
 * 检查工具
 * 
 * 负责检查隐藏消息、系统状态等详细信息
 */

export class Inspector {
  constructor(api) {
    this.api = api;
  }
  
  /**
   * 检查隐藏消息
   */
  inspectHiddenMessages() {
    console.log('=== 隐藏消息检查 ===');
    
    const hiddenMessages = this.api.getHiddenMessages();
    
    if (hiddenMessages.length === 0) {
      console.log('✓ 没有隐藏消息');
      if (this.api.toastr) {
        this.api.toastr.info('没有隐藏消息', '检查完成');
      }
      return;
    }
    
    console.log(`发现 ${hiddenMessages.length} 条隐藏消息:`);
    
    // 按索引排序
    const sortedMessages = hiddenMessages.sort((a, b) => a.index - b.index);
    
    // 详细信息
    sortedMessages.forEach((msg, idx) => {
      console.log(`\\n消息 ${idx + 1}:`);
      console.log(`  - 索引: ${msg.index}`);
      console.log(`  - 类型: ${msg.is_user ? '用户' : 'AI'}`);
      console.log(`  - 是否系统消息: ${msg.is_system || false}`);
      console.log(`  - 时间戳: ${msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '无'}`);
      console.log(`  - 内容长度: ${msg.text ? msg.text.length : 0} 字符`);
      if (msg.text) {
        const preview = msg.text.length > 100 ? msg.text.substring(0, 100) + '...' : msg.text;
        console.log(`  - 内容预览: ${preview}`);
      }
      
      // 检查消息的元数据
      const metadata = Object.keys(msg).filter(key => 
        !['index', 'is_user', 'is_system', 'timestamp', 'text'].includes(key)
      );
      if (metadata.length > 0) {
        console.log(`  - 其他属性: ${metadata.join(', ')}`);
      }
    });
    
    // 统计信息
    const stats = {
      total: hiddenMessages.length,
      userMessages: hiddenMessages.filter(msg => msg.is_user).length,
      assistantMessages: hiddenMessages.filter(msg => !msg.is_user).length,
      systemMessages: hiddenMessages.filter(msg => msg.is_system).length,
      indexRange: {
        min: Math.min(...hiddenMessages.map(msg => msg.index)),
        max: Math.max(...hiddenMessages.map(msg => msg.index))
      },
      totalLength: hiddenMessages.reduce((sum, msg) => sum + (msg.text ? msg.text.length : 0), 0)
    };
    
    console.log('\\n=== 统计信息 ===');
    console.log(`总数: ${stats.total}`);
    console.log(`用户消息: ${stats.userMessages}`);
    console.log(`AI消息: ${stats.assistantMessages}`);
    console.log(`系统消息: ${stats.systemMessages}`);
    console.log(`索引范围: ${stats.indexRange.min} - ${stats.indexRange.max}`);
    console.log(`总字符数: ${stats.totalLength}`);
    
    console.log('=== 检查完成 ===');
    
    if (this.api.toastr) {
      this.api.toastr.info(`发现 ${stats.total} 条隐藏消息，详情见控制台`, '检查完成');
    }
    
    return {
      messages: sortedMessages,
      stats
    };
  }
  
  /**
   * 检查系统状态
   */
  inspectSystemStatus() {
    console.log('=== 系统状态检查 ===');
    
    const status = {
      environment: {},
      api: {},
      ui: {},
      performance: {},
      errors: []
    };
    
    // 环境信息
    status.environment = {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      cookieEnabled: navigator.cookieEnabled,
      onLine: navigator.onLine,
      url: window.location.href,
      timestamp: new Date().toISOString()
    };
    
    // API状态
    try {
      const chatId = this.api.getCurrentChatId();
      const settings = this.api.getSettings();
      
      status.api = {
        chatId: chatId || 'none',
        hasSettings: !!settings,
        apiMethods: Object.keys(this.api).length,
        settingsSize: settings ? JSON.stringify(settings).length : 0
      };
    } catch (error) {
      status.errors.push(`API检查失败: ${error.message}`);
    }
    
    // UI状态
    try {
      status.ui = {
        vectorsContainer: this.api.jQuery('#vectors_enhanced_container').length > 0,
        totalElements: this.api.jQuery('#vectors_enhanced_container *').length,
        visibleElements: this.api.jQuery('#vectors_enhanced_container *:visible').length,
        inputElements: this.api.jQuery('#vectors_enhanced_container input').length,
        checkedInputs: this.api.jQuery('#vectors_enhanced_container input:checked').length,
        debugPanel: this.api.jQuery('#vectors-debug-panel').length > 0
      };
    } catch (error) {
      status.errors.push(`UI检查失败: ${error.message}`);
    }
    
    // 性能信息
    try {
      if (performance.memory) {
        status.performance = {
          memoryUsed: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) + 'MB',
          memoryTotal: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024) + 'MB',
          memoryLimit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024) + 'MB'
        };
      }
      
      // 添加页面加载信息
      const navigation = performance.getEntriesByType('navigation')[0];
      if (navigation) {
        status.performance.loadTime = Math.round(navigation.loadEventEnd - navigation.loadEventStart) + 'ms';
        status.performance.domContentLoaded = Math.round(navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart) + 'ms';
      }
    } catch (error) {
      status.errors.push(`性能检查失败: ${error.message}`);
    }
    
    console.log('系统状态:', status);
    
    if (status.errors.length > 0) {
      console.warn('检查过程中发现错误:', status.errors);
    }
    
    console.log('=== 检查完成 ===');
    
    if (this.api.toastr) {
      const message = status.errors.length > 0 ? 
        `系统检查完成，发现 ${status.errors.length} 个错误` : 
        '系统状态检查完成';
      this.api.toastr.info(message + '，详情见控制台', '系统检查');
    }
    
    return status;
  }
  
  /**
   * 检查向量数据完整性
   */
  async inspectVectorDataIntegrity() {
    console.log('=== 向量数据完整性检查 ===');
    
    const chatId = this.api.getCurrentChatId();
    if (!chatId) {
      console.log('错误：未选择聊天');
      return;
    }
    
    const tasks = this.api.getChatTasks(chatId);
    const results = {
      totalTasks: tasks.length,
      enabledTasks: tasks.filter(t => t.enabled).length,
      taskDetails: [],
      issues: []
    };
    
    console.log(`检查 ${tasks.length} 个任务的向量数据...`);
    
    for (const task of tasks) {
      const taskResult = {
        taskId: task.taskId,
        name: task.name,
        enabled: task.enabled,
        collectionId: `${chatId}_${task.taskId}`,
        vectors: 0,
        issues: []
      };
      
      try {
        // 如果有getSavedHashes函数可用
        if (typeof getSavedHashes === 'function') {
          const hashes = await getSavedHashes(taskResult.collectionId);
          taskResult.vectors = hashes.length;
          
          console.log(`任务 "${task.name}": ${hashes.length} 个向量`);
          
          if (task.enabled && hashes.length === 0) {
            taskResult.issues.push('启用的任务没有向量数据');
          }
          
          if (!task.enabled && hashes.length > 0) {
            taskResult.issues.push('禁用的任务仍有向量数据');
          }
        } else {
          taskResult.issues.push('无法访问向量数据API');
        }
      } catch (error) {
        taskResult.issues.push(`检查向量数据失败: ${error.message}`);
      }
      
      results.taskDetails.push(taskResult);
      results.issues.push(...taskResult.issues);
    }
    
    // 检查缓存一致性
    if (typeof cachedVectors !== 'undefined') {
      console.log('\\n=== 缓存一致性检查 ===');
      console.log(`缓存项数量: ${cachedVectors.size}`);
      
      for (const [key, value] of cachedVectors.entries()) {
        console.log(`缓存项 "${key}": ${value.items?.length || 0} 个项目`);
        
        // 检查缓存项是否对应现有任务
        const matchingTask = tasks.find(t => key.includes(t.taskId));
        if (!matchingTask) {
          results.issues.push(`缓存项 "${key}" 没有对应的任务`);
        }
      }
    }
    
    console.log('\\n=== 检查结果 ===');
    console.log(`总任务数: ${results.totalTasks}`);
    console.log(`启用任务数: ${results.enabledTasks}`);
    console.log(`发现问题数: ${results.issues.length}`);
    
    if (results.issues.length > 0) {
      console.log('\\n发现的问题:');
      results.issues.forEach((issue, index) => {
        console.log(`  ${index + 1}. ${issue}`);
      });
    } else {
      console.log('✓ 向量数据完整性良好');
    }
    
    console.log('=== 检查完成 ===');
    
    if (this.api.toastr) {
      const message = results.issues.length > 0 ? 
        `发现 ${results.issues.length} 个完整性问题` : 
        '向量数据完整性良好';
      this.api.toastr.info(message + '，详情见控制台', '完整性检查');
    }
    
    return results;
  }
  
  /**
   * 检查文件访问权限
   */
  async inspectFileAccess() {
    console.log('=== 文件访问权限检查 ===');
    
    const settings = this.api.getSettings();
    const selectedFiles = settings.selected_content?.files?.selected || [];
    
    if (selectedFiles.length === 0) {
      console.log('没有选择文件');
      return;
    }
    
    console.log(`检查 ${selectedFiles.length} 个文件的访问权限...`);
    
    const results = {
      total: selectedFiles.length,
      accessible: 0,
      issues: [],
      fileDetails: []
    };
    
    for (const fileUrl of selectedFiles) {
      const fileResult = {
        url: fileUrl,
        accessible: false,
        size: 0,
        type: 'unknown',
        issues: []
      };
      
      try {
        const response = await fetch(fileUrl, { method: 'HEAD' });
        
        if (response.ok) {
          fileResult.accessible = true;
          fileResult.size = parseInt(response.headers.get('content-length') || '0');
          fileResult.type = response.headers.get('content-type') || 'unknown';
          results.accessible++;
          
          console.log(`✓ ${fileUrl} (${fileResult.size} bytes, ${fileResult.type})`);
        } else {
          fileResult.issues.push(`HTTP ${response.status}: ${response.statusText}`);
          console.log(`✗ ${fileUrl} - ${response.status}`);
        }
      } catch (error) {
        fileResult.issues.push(`访问失败: ${error.message}`);
        console.log(`✗ ${fileUrl} - ${error.message}`);
      }
      
      results.fileDetails.push(fileResult);
      results.issues.push(...fileResult.issues);
    }
    
    console.log('\\n=== 检查结果 ===');
    console.log(`总文件数: ${results.total}`);
    console.log(`可访问: ${results.accessible}`);
    console.log(`有问题: ${results.total - results.accessible}`);
    
    if (results.issues.length > 0) {
      console.log('\\n发现的问题:');
      results.issues.forEach((issue, index) => {
        console.log(`  ${index + 1}. ${issue}`);
      });
    }
    
    console.log('=== 检查完成 ===');
    
    if (this.api.toastr) {
      const message = `${results.accessible}/${results.total} 个文件可访问`;
      this.api.toastr.info(message + '，详情见控制台', '文件访问检查');
    }
    
    return results;
  }
  
  /**
   * 检查世界信息可用性
   */
  async inspectWorldInfoAvailability() {
    console.log('=== 世界信息可用性检查 ===');
    
    const settings = this.api.getSettings();
    const selectedWI = settings.selected_content?.world_info?.selected || {};
    
    if (Object.keys(selectedWI).length === 0) {
      console.log('没有选择世界信息');
      return;
    }
    
    const results = {
      totalWorlds: Object.keys(selectedWI).length,
      totalEntries: Object.values(selectedWI).flat().length,
      available: 0,
      unavailable: 0,
      details: [],
      issues: []
    };
    
    console.log(`检查 ${results.totalWorlds} 个世界的 ${results.totalEntries} 个条目...`);
    
    try {
      const allEntries = await this.api.getSortedEntries();
      const entryMap = new Map(allEntries.map(entry => [entry.uid, entry]));
      
      for (const [worldName, uids] of Object.entries(selectedWI)) {
        const worldResult = {
          world: worldName,
          totalSelected: uids.length,
          available: 0,
          unavailable: 0,
          issues: []
        };
        
        console.log(`\\n检查世界 "${worldName}" (${uids.length} 个条目):`);
        
        for (const uid of uids) {
          const entry = entryMap.get(uid);
          if (entry) {
            worldResult.available++;
            results.available++;
            
            // 检查条目状态
            if (entry.disable) {
              worldResult.issues.push(`条目 ${uid} 已禁用`);
            }
            if (!entry.content) {
              worldResult.issues.push(`条目 ${uid} 没有内容`);
            }
            
            console.log(`  ✓ ${entry.comment || uid} ${entry.disable ? '(禁用)' : ''}`);
          } else {
            worldResult.unavailable++;
            results.unavailable++;
            worldResult.issues.push(`条目 ${uid} 不存在`);
            console.log(`  ✗ ${uid} (不存在)`);
          }
        }
        
        results.details.push(worldResult);
        results.issues.push(...worldResult.issues);
      }
    } catch (error) {
      results.issues.push(`获取世界信息失败: ${error.message}`);
      console.error('获取世界信息失败:', error);
    }
    
    console.log('\\n=== 检查结果 ===');
    console.log(`总条目数: ${results.totalEntries}`);
    console.log(`可用条目: ${results.available}`);
    console.log(`不可用条目: ${results.unavailable}`);
    console.log(`问题数量: ${results.issues.length}`);
    
    if (results.issues.length > 0) {
      console.log('\\n发现的问题:');
      results.issues.forEach((issue, index) => {
        console.log(`  ${index + 1}. ${issue}`);
      });
    }
    
    console.log('=== 检查完成 ===');
    
    if (this.api.toastr) {
      const message = `${results.available}/${results.totalEntries} 个世界信息条目可用`;
      this.api.toastr.info(message + '，详情见控制台', '世界信息检查');
    }
    
    return results;
  }
  
  /**
   * 生成综合检查报告
   */
  async generateComprehensiveReport() {
    console.log('=== 生成综合检查报告 ===');
    
    const report = {
      timestamp: new Date().toISOString(),
      systemStatus: {},
      hiddenMessages: {},
      vectorIntegrity: {},
      fileAccess: {},
      worldInfoAvailability: {},
      summary: {
        totalIssues: 0,
        criticalIssues: 0,
        warnings: 0
      }
    };
    
    try {
      // 系统状态检查
      report.systemStatus = this.inspectSystemStatus();
      
      // 隐藏消息检查
      report.hiddenMessages = this.inspectHiddenMessages();
      
      // 向量完整性检查
      report.vectorIntegrity = await this.inspectVectorDataIntegrity();
      
      // 文件访问检查
      report.fileAccess = await this.inspectFileAccess();
      
      // 世界信息可用性检查
      report.worldInfoAvailability = await this.inspectWorldInfoAvailability();
      
      // 计算问题统计
      report.summary.totalIssues = 
        (report.systemStatus.errors?.length || 0) +
        (report.vectorIntegrity.issues?.length || 0) +
        (report.fileAccess.issues?.length || 0) +
        (report.worldInfoAvailability.issues?.length || 0);
      
      // 生成报告文本
      const reportText = this.formatReportText(report);
      
      // 下载报告
      try {
        const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vectors-inspection-report-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('✓ 报告已下载');
      } catch (error) {
        console.error('下载报告失败:', error);
      }
      
    } catch (error) {
      console.error('生成报告失败:', error);
      report.summary.criticalIssues++;
    }
    
    console.log('=== 报告生成完成 ===');
    
    if (this.api.toastr) {
      const message = `检查完成，发现 ${report.summary.totalIssues} 个问题`;
      this.api.toastr.info(message + '，报告已下载', '综合检查');
    }
    
    return report;
  }
  
  /**
   * 格式化报告文本
   */
  formatReportText(report) {
    const lines = [
      '向量化插件综合检查报告',
      `生成时间: ${new Date(report.timestamp).toLocaleString('zh-CN')}`,
      '',
      '=== 概览 ===',
      `总问题数: ${report.summary.totalIssues}`,
      `严重问题: ${report.summary.criticalIssues}`,
      `警告: ${report.summary.warnings}`,
      '',
      '=== 系统状态 ===',
      `环境: ${report.systemStatus.environment?.platform || 'Unknown'}`,
      `浏览器: ${report.systemStatus.environment?.userAgent?.split(' ')[0] || 'Unknown'}`,
      `API方法数: ${report.systemStatus.api?.apiMethods || 0}`,
      `UI元素数: ${report.systemStatus.ui?.totalElements || 0}`,
      `内存使用: ${report.systemStatus.performance?.memoryUsed || 'Unknown'}`,
      `系统错误: ${report.systemStatus.errors?.length || 0}`,
      '',
      '=== 隐藏消息 ===',
      `隐藏消息数: ${report.hiddenMessages.stats?.total || 0}`,
      `用户消息: ${report.hiddenMessages.stats?.userMessages || 0}`,
      `AI消息: ${report.hiddenMessages.stats?.assistantMessages || 0}`,
      '',
      '=== 向量完整性 ===',
      `总任务数: ${report.vectorIntegrity.totalTasks || 0}`,
      `启用任务数: ${report.vectorIntegrity.enabledTasks || 0}`,
      `完整性问题: ${report.vectorIntegrity.issues?.length || 0}`,
      '',
      '=== 文件访问 ===',
      `总文件数: ${report.fileAccess.total || 0}`,
      `可访问文件: ${report.fileAccess.accessible || 0}`,
      `访问问题: ${report.fileAccess.issues?.length || 0}`,
      '',
      '=== 世界信息 ===',
      `总世界数: ${report.worldInfoAvailability.totalWorlds || 0}`,
      `总条目数: ${report.worldInfoAvailability.totalEntries || 0}`,
      `可用条目: ${report.worldInfoAvailability.available || 0}`,
      `不可用条目: ${report.worldInfoAvailability.unavailable || 0}`,
      ''
    ];
    
    // 添加详细问题列表
    const allIssues = [
      ...(report.systemStatus.errors || []),
      ...(report.vectorIntegrity.issues || []),
      ...(report.fileAccess.issues || []),
      ...(report.worldInfoAvailability.issues || [])
    ];
    
    if (allIssues.length > 0) {
      lines.push('=== 详细问题 ===');
      allIssues.forEach((issue, index) => {
        lines.push(`${index + 1}. ${issue}`);
      });
    }
    
    return lines.join('\n');
  }
}