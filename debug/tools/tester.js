/**
 * Tester Tools
 * 测试工具
 * 
 * 负责测试斜杠命令、功能验证等测试相关操作
 */

export class Tester {
  constructor(api) {
    this.api = api;
  }
  
  /**
   * 测试斜杠命令
   */
  async testSlashCommands() {
    console.log('=== 斜杠命令测试 ===');
    
    const commands = [
      {
        name: '/vec-preview',
        description: '预览选择的内容',
        test: () => this.testVecPreview()
      },
      {
        name: '/vec-export',
        description: '导出可向量化内容',
        test: () => this.testVecExport()
      },
      {
        name: '/vec-process',
        description: '处理和向量化内容',
        test: () => this.testVecProcess()
      }
    ];
    
    const results = {
      total: commands.length,
      passed: 0,
      failed: 0,
      details: []
    };
    
    for (const command of commands) {
      console.log(`\\n测试命令: ${command.name}`);
      console.log(`描述: ${command.description}`);
      
      const testResult = {
        name: command.name,
        description: command.description,
        passed: false,
        error: null,
        duration: 0
      };
      
      const startTime = performance.now();
      
      try {
        await command.test();
        testResult.passed = true;
        results.passed++;
        console.log(`✓ ${command.name} 测试通过`);
      } catch (error) {
        testResult.passed = false;
        testResult.error = error.message;
        results.failed++;
        console.log(`✗ ${command.name} 测试失败: ${error.message}`);
      }
      
      testResult.duration = Math.round(performance.now() - startTime);
      results.details.push(testResult);
    }
    
    console.log('\\n=== 测试结果 ===');
    console.log(`总命令数: ${results.total}`);
    console.log(`通过: ${results.passed}`);
    console.log(`失败: ${results.failed}`);
    console.log(`成功率: ${Math.round((results.passed / results.total) * 100)}%`);
    
    console.log('=== 测试完成 ===');
    
    if (this.api.toastr) {
      const message = `${results.passed}/${results.total} 个命令测试通过`;
      this.api.toastr.info(message + '，详情见控制台', '命令测试');
    }
    
    return results;
  }
  
  /**
   * 测试 /vec-preview 命令
   */
  async testVecPreview() {
    console.log('  测试 vec-preview 功能...');
    
    // 检查是否有选择内容
    const settings = this.api.getSettings();
    const hasContent = 
      settings.selected_content.chat.enabled ||
      settings.selected_content.files.enabled ||
      settings.selected_content.world_info.enabled;
    
    if (!hasContent) {
      throw new Error('没有选择任何内容进行预览');
    }
    
    // 模拟预览功能
    const previewData = {
      chat: settings.selected_content.chat.enabled ? '聊天内容已选择' : null,
      files: settings.selected_content.files.enabled ? `${settings.selected_content.files.selected.length} 个文件` : null,
      worldInfo: settings.selected_content.world_info.enabled ? `${Object.values(settings.selected_content.world_info.selected).flat().length} 个世界信息条目` : null
    };
    
    console.log('  预览数据:', previewData);
    
    // 检查是否有可用的预览功能
    if (typeof this.api.generatePreview === 'function') {
      const preview = await this.api.generatePreview();
      console.log('  ✓ 预览生成成功');
      return preview;
    } else {
      console.log('  ⚠ 预览功能不可用，但选择状态正常');
      return previewData;
    }
  }
  
  /**
   * 测试 /vec-export 命令
   */
  async testVecExport() {
    console.log('  测试 vec-export 功能...');
    
    const settings = this.api.getSettings();
    
    // 检查是否有内容可导出
    const hasContent = 
      (settings.selected_content.chat.enabled) ||
      (settings.selected_content.files.enabled && settings.selected_content.files.selected.length > 0) ||
      (settings.selected_content.world_info.enabled && Object.values(settings.selected_content.world_info.selected).flat().length > 0);
    
    if (!hasContent) {
      throw new Error('没有内容可导出');
    }
    
    // 模拟导出过程
    const exportData = {
      timestamp: new Date().toISOString(),
      chatId: this.api.getCurrentChatId(),
      content: {
        chat: settings.selected_content.chat.enabled ? 'chat_content' : null,
        files: settings.selected_content.files.enabled ? settings.selected_content.files.selected : null,
        worldInfo: settings.selected_content.world_info.enabled ? settings.selected_content.world_info.selected : null
      }
    };
    
    // 估算导出内容大小
    let estimatedSize = 0;
    if (settings.selected_content.chat.enabled) {
      estimatedSize += 1000; // 估算聊天内容大小
    }
    if (settings.selected_content.files.enabled) {
      estimatedSize += settings.selected_content.files.selected.length * 500; // 估算文件内容
    }
    if (settings.selected_content.world_info.enabled) {
      estimatedSize += Object.values(settings.selected_content.world_info.selected).flat().length * 200; // 估算世界信息
    }
    
    console.log(`  预计导出大小: ${estimatedSize} 字节`);
    console.log('  ✓ 导出准备完成');
    
    return {
      ...exportData,
      estimatedSize
    };
  }
  
  /**
   * 测试 /vec-process 命令
   */
  async testVecProcess() {
    console.log('  测试 vec-process 功能...');
    
    const chatId = this.api.getCurrentChatId();
    if (!chatId) {
      throw new Error('未选择聊天');
    }
    
    const settings = this.api.getSettings();
    
    // 检查是否启用了主功能
    if (!settings.master_enabled) {
      throw new Error('主功能未启用');
    }
    
    // 检查向量设置
    if (!settings.vector_settings?.source) {
      throw new Error('未配置向量源');
    }
    
    // 检查是否有内容可处理
    const hasContent = 
      settings.selected_content.chat.enabled ||
      settings.selected_content.files.enabled ||
      settings.selected_content.world_info.enabled;
    
    if (!hasContent) {
      throw new Error('没有选择内容进行处理');
    }
    
    // 模拟处理过程的各个阶段
    const processStages = [
      '内容收集',
      '文本预处理', 
      '标签提取',
      '内容分块',
      '向量化',
      '存储到向量数据库'
    ];
    
    console.log('  处理阶段:');
    for (const stage of processStages) {
      console.log(`    - ${stage}`);
    }
    
    // 检查重复检测
    if (typeof this.api.analyzeTaskOverlap === 'function') {
      const overlapAnalysis = this.api.analyzeTaskOverlap(chatId, settings.selected_content);
      console.log('  重复检测结果:', overlapAnalysis);
    }
    
    console.log('  ✓ 处理流程验证完成');
    
    return {
      chatId,
      stages: processStages,
      hasOverlapDetection: typeof this.api.analyzeTaskOverlap === 'function'
    };
  }
  
  /**
   * 测试功能完整性
   */
  async testFunctionalIntegrity() {
    console.log('=== 功能完整性测试 ===');
    
    const tests = [
      {
        name: '设置读取',
        test: () => this.testSettingsAccess()
      },
      {
        name: '聊天ID获取',
        test: () => this.testChatIdAccess()
      },
      {
        name: '任务管理',
        test: () => this.testTaskManagement()
      },
      {
        name: '世界信息访问',
        test: () => this.testWorldInfoAccess()
      },
      {
        name: 'UI元素交互',
        test: () => this.testUIInteraction()
      },
      {
        name: '隐藏消息访问',
        test: () => this.testHiddenMessagesAccess()
      }
    ];
    
    const results = {
      total: tests.length,
      passed: 0,
      failed: 0,
      details: []
    };
    
    for (const test of tests) {
      console.log(`\\n测试: ${test.name}`);
      
      const testResult = {
        name: test.name,
        passed: false,
        error: null,
        duration: 0
      };
      
      const startTime = performance.now();
      
      try {
        await test.test();
        testResult.passed = true;
        results.passed++;
        console.log(`  ✓ ${test.name} 通过`);
      } catch (error) {
        testResult.passed = false;
        testResult.error = error.message;
        results.failed++;
        console.log(`  ✗ ${test.name} 失败: ${error.message}`);
      }
      
      testResult.duration = Math.round(performance.now() - startTime);
      results.details.push(testResult);
    }
    
    console.log('\\n=== 测试汇总 ===');
    console.log(`总测试数: ${results.total}`);
    console.log(`通过: ${results.passed}`);
    console.log(`失败: ${results.failed}`);
    console.log(`通过率: ${Math.round((results.passed / results.total) * 100)}%`);
    
    console.log('=== 测试完成 ===');
    
    if (this.api.toastr) {
      const message = `功能完整性测试: ${results.passed}/${results.total} 通过`;
      this.api.toastr.info(message + '，详情见控制台', '功能测试');
    }
    
    return results;
  }
  
  /**
   * 测试设置访问
   */
  testSettingsAccess() {
    const settings = this.api.getSettings();
    
    if (!settings) {
      throw new Error('无法获取设置');
    }
    
    // 检查必要的设置结构
    const requiredFields = [
      'master_enabled',
      'selected_content',
      'selected_content.chat',
      'selected_content.files', 
      'selected_content.world_info'
    ];
    
    for (const field of requiredFields) {
      const value = field.split('.').reduce((obj, key) => obj?.[key], settings);
      if (value === undefined) {
        throw new Error(`缺少设置字段: ${field}`);
      }
    }
    
    console.log('  ✓ 设置结构完整');
    return settings;
  }
  
  /**
   * 测试聊天ID访问
   */
  testChatIdAccess() {
    const chatId = this.api.getCurrentChatId();
    
    if (!chatId) {
      throw new Error('无法获取当前聊天ID');
    }
    
    if (typeof chatId !== 'string') {
      throw new Error('聊天ID类型错误');
    }
    
    console.log(`  ✓ 聊天ID: ${chatId}`);
    return chatId;
  }
  
  /**
   * 测试任务管理
   */
  testTaskManagement() {
    const chatId = this.api.getCurrentChatId();
    if (!chatId) {
      throw new Error('需要选择聊天');
    }
    
    const tasks = this.api.getChatTasks(chatId);
    
    if (!Array.isArray(tasks)) {
      throw new Error('任务列表不是数组');
    }
    
    // 验证任务结构
    tasks.forEach((task, index) => {
      if (!task.taskId) {
        throw new Error(`任务 ${index} 缺少taskId`);
      }
      if (!task.name) {
        throw new Error(`任务 ${index} 缺少名称`);
      }
      if (typeof task.enabled !== 'boolean') {
        throw new Error(`任务 ${index} enabled字段类型错误`);
      }
    });
    
    console.log(`  ✓ 任务管理正常 (${tasks.length} 个任务)`);
    return tasks;
  }
  
  /**
   * 测试世界信息访问
   */
  async testWorldInfoAccess() {
    const entries = await this.api.getSortedEntries();
    
    if (!Array.isArray(entries)) {
      throw new Error('世界信息条目不是数组');
    }
    
    // 验证条目结构
    if (entries.length > 0) {
      const sampleEntry = entries[0];
      if (!sampleEntry.uid) {
        throw new Error('世界信息条目缺少uid');
      }
      if (!sampleEntry.world) {
        throw new Error('世界信息条目缺少world');
      }
    }
    
    console.log(`  ✓ 世界信息访问正常 (${entries.length} 个条目)`);
    return entries;
  }
  
  /**
   * 测试UI元素交互
   */
  testUIInteraction() {
    const $ = this.api.jQuery;
    
    // 检查主容器
    const container = $('#vectors_enhanced_container');
    if (container.length === 0) {
      throw new Error('找不到主设置容器');
    }
    
    // 检查关键UI元素
    const criticalElements = [
      '#vectors_enhanced_master_enabled',
      '#vectors_enhanced_chat_enabled',
      '#vectors_enhanced_files_enabled',
      '#vectors_enhanced_wi_enabled'
    ];
    
    for (const selector of criticalElements) {
      const element = $(selector);
      if (element.length === 0) {
        throw new Error(`找不到UI元素: ${selector}`);
      }
    }
    
    // 测试jQuery功能
    const totalInputs = $('#vectors_enhanced_container input').length;
    const checkedInputs = $('#vectors_enhanced_container input:checked').length;
    
    console.log(`  ✓ UI交互正常 (${totalInputs} 个输入元素, ${checkedInputs} 个已选中)`);
    return {
      totalInputs,
      checkedInputs
    };
  }
  
  /**
   * 测试隐藏消息访问
   */
  testHiddenMessagesAccess() {
    const hiddenMessages = this.api.getHiddenMessages();
    
    if (!Array.isArray(hiddenMessages)) {
      throw new Error('隐藏消息不是数组');
    }
    
    // 验证隐藏消息结构
    if (hiddenMessages.length > 0) {
      const sampleMessage = hiddenMessages[0];
      if (typeof sampleMessage.index !== 'number') {
        throw new Error('隐藏消息缺少index字段');
      }
      if (typeof sampleMessage.is_user !== 'boolean') {
        throw new Error('隐藏消息缺少is_user字段');
      }
    }
    
    console.log(`  ✓ 隐藏消息访问正常 (${hiddenMessages.length} 条消息)`);
    return hiddenMessages;
  }
  
  /**
   * 性能压力测试
   */
  async testPerformanceStress() {
    console.log('=== 性能压力测试 ===');
    
    const tests = [
      {
        name: '设置访问性能',
        iterations: 1000,
        test: () => this.api.getSettings()
      },
      {
        name: 'UI查询性能',
        iterations: 500,
        test: () => this.api.jQuery('#vectors_enhanced_container').length
      },
      {
        name: '任务列表性能',
        iterations: 100,
        test: () => {
          const chatId = this.api.getCurrentChatId();
          return chatId ? this.api.getChatTasks(chatId) : [];
        }
      }
    ];
    
    const results = {
      tests: [],
      totalDuration: 0
    };
    
    const overallStart = performance.now();
    
    for (const test of tests) {
      console.log(`\\n测试: ${test.name} (${test.iterations} 次迭代)`);
      
      const testResult = {
        name: test.name,
        iterations: test.iterations,
        totalTime: 0,
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        errors: 0
      };
      
      const times = [];
      
      for (let i = 0; i < test.iterations; i++) {
        const start = performance.now();
        
        try {
          await test.test();
          const duration = performance.now() - start;
          times.push(duration);
          
          testResult.minTime = Math.min(testResult.minTime, duration);
          testResult.maxTime = Math.max(testResult.maxTime, duration);
        } catch (error) {
          testResult.errors++;
        }
      }
      
      if (times.length > 0) {
        testResult.totalTime = times.reduce((sum, time) => sum + time, 0);
        testResult.avgTime = testResult.totalTime / times.length;
      }
      
      console.log(`  总时间: ${Math.round(testResult.totalTime)}ms`);
      console.log(`  平均时间: ${testResult.avgTime.toFixed(2)}ms`);
      console.log(`  最小时间: ${testResult.minTime.toFixed(2)}ms`);
      console.log(`  最大时间: ${testResult.maxTime.toFixed(2)}ms`);
      console.log(`  错误数: ${testResult.errors}`);
      
      results.tests.push(testResult);
    }
    
    results.totalDuration = performance.now() - overallStart;
    
    console.log(`\\n=== 压力测试完成 ===`);
    console.log(`总测试时间: ${Math.round(results.totalDuration)}ms`);
    
    if (this.api.toastr) {
      this.api.toastr.info(`性能压力测试完成，耗时 ${Math.round(results.totalDuration)}ms`, '性能测试');
    }
    
    return results;
  }
  
  /**
   * 生成测试报告
   */
  async generateTestReport() {
    console.log('=== 生成测试报告 ===');
    
    const report = {
      timestamp: new Date().toISOString(),
      slashCommands: {},
      functionalIntegrity: {},
      performanceStress: {},
      summary: {}
    };
    
    try {
      // 运行所有测试
      report.slashCommands = await this.testSlashCommands();
      report.functionalIntegrity = await this.testFunctionalIntegrity();
      report.performanceStress = await this.testPerformanceStress();
      
      // 生成摘要
      report.summary = {
        totalTests: 
          report.slashCommands.total + 
          report.functionalIntegrity.total + 
          report.performanceStress.tests.length,
        totalPassed: 
          report.slashCommands.passed + 
          report.functionalIntegrity.passed + 
          report.performanceStress.tests.filter(t => t.errors === 0).length,
        totalFailed: 
          report.slashCommands.failed + 
          report.functionalIntegrity.failed + 
          report.performanceStress.tests.filter(t => t.errors > 0).length,
        overallDuration: report.performanceStress.totalDuration
      };
      
      // 格式化并下载报告
      const reportText = this.formatTestReport(report);
      
      try {
        const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vectors-test-report-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('✓ 测试报告已下载');
      } catch (error) {
        console.error('下载报告失败:', error);
      }
      
    } catch (error) {
      console.error('生成测试报告失败:', error);
    }
    
    console.log('=== 报告生成完成 ===');
    
    if (this.api.toastr) {
      const passRate = Math.round((report.summary.totalPassed / report.summary.totalTests) * 100);
      this.api.toastr.info(`测试报告已生成，通过率 ${passRate}%`, '测试报告');
    }
    
    return report;
  }
  
  /**
   * 格式化测试报告
   */
  formatTestReport(report) {
    const lines = [
      '向量化插件测试报告',
      `生成时间: ${new Date(report.timestamp).toLocaleString('zh-CN')}`,
      '',
      '=== 测试摘要 ===',
      `总测试数: ${report.summary.totalTests}`,
      `通过: ${report.summary.totalPassed}`,
      `失败: ${report.summary.totalFailed}`,
      `通过率: ${Math.round((report.summary.totalPassed / report.summary.totalTests) * 100)}%`,
      `总耗时: ${Math.round(report.summary.overallDuration)}ms`,
      '',
      '=== 斜杠命令测试 ===',
      `命令数: ${report.slashCommands.total}`,
      `通过: ${report.slashCommands.passed}`,
      `失败: ${report.slashCommands.failed}`,
      ''
    ];
    
    // 添加命令详情
    if (report.slashCommands.details) {
      report.slashCommands.details.forEach(cmd => {
        lines.push(`${cmd.name}: ${cmd.passed ? '✓' : '✗'} (${cmd.duration}ms)`);
        if (!cmd.passed && cmd.error) {
          lines.push(`  错误: ${cmd.error}`);
        }
      });
    }
    
    lines.push('');
    lines.push('=== 功能完整性测试 ===');
    lines.push(`功能数: ${report.functionalIntegrity.total}`);
    lines.push(`通过: ${report.functionalIntegrity.passed}`);
    lines.push(`失败: ${report.functionalIntegrity.failed}`);
    lines.push('');
    
    // 添加功能详情
    if (report.functionalIntegrity.details) {
      report.functionalIntegrity.details.forEach(func => {
        lines.push(`${func.name}: ${func.passed ? '✓' : '✗'} (${func.duration}ms)`);
        if (!func.passed && func.error) {
          lines.push(`  错误: ${func.error}`);
        }
      });
    }
    
    lines.push('');
    lines.push('=== 性能压力测试 ===');
    lines.push(`测试项: ${report.performanceStress.tests.length}`);
    lines.push(`总耗时: ${Math.round(report.performanceStress.totalDuration)}ms`);
    lines.push('');
    
    // 添加性能详情
    if (report.performanceStress.tests) {
      report.performanceStress.tests.forEach(test => {
        lines.push(`${test.name}:`);
        lines.push(`  迭代次数: ${test.iterations}`);
        lines.push(`  平均耗时: ${test.avgTime.toFixed(2)}ms`);
        lines.push(`  最小耗时: ${test.minTime.toFixed(2)}ms`);
        lines.push(`  最大耗时: ${test.maxTime.toFixed(2)}ms`);
        lines.push(`  错误数: ${test.errors}`);
        lines.push('');
      });
    }
    
    return lines.join('\n');
  }
}