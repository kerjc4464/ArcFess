/**
 * Vectors Enhanced Debug Module - Main Debugger
 * 向量化插件调试主模块
 * 
 * 负责调试系统的初始化、管理和协调
 */

import { DebugUIManager } from './ui-manager.js';
import { StateAnalyzer } from './analyzers/state-analyzer.js';
import { SyncAnalyzer } from './analyzers/sync-analyzer.js';
import { DataAnalyzer } from './analyzers/data-analyzer.js';
import { DataCleaner } from './tools/cleaner.js';
import { Inspector } from './tools/inspector.js';
import { Tester } from './tools/tester.js';

/**
 * 主调试器类
 * 统一管理所有调试功能模块
 */
export class VectorsDebugger {
  constructor(api) {
    this.api = api;
    this.isEnabled = false;
    
    // 初始化各个调试模块
    this.uiManager = new DebugUIManager(api);
    this.stateAnalyzer = new StateAnalyzer(api);
    this.syncAnalyzer = new SyncAnalyzer(api);
    this.dataAnalyzer = new DataAnalyzer(api);
    this.cleaner = new DataCleaner(api);
    this.inspector = new Inspector(api);
    this.tester = new Tester(api);
    
    console.log('[VectorsDebug] Debugger initialized');
  }
  
  /**
   * 初始化调试器
   */
  async initialize() {
    try {
      // 检查是否应该启用调试模式
      if (this.shouldEnableDebug()) {
        await this.enableDebugMode();
      }
      
      console.log('[VectorsDebug] Debugger ready');
    } catch (error) {
      console.error('[VectorsDebug] Failed to initialize debugger:', error);
    }
  }
  
  /**
   * 检查是否应该启用调试模式
   */
  shouldEnableDebug() {
    return (
      window.location.hostname === 'localhost' ||
      window.location.search.includes('debug=true') ||
      localStorage.getItem('vectors_debug_enabled') === 'true' ||
      sessionStorage.getItem('vectors_debug_session') === 'true'
    );
  }
  
  /**
   * 启用调试模式
   */
  async enableDebugMode() {
    if (this.isEnabled) return;
    
    try {
      console.log('[VectorsDebug] Enabling debug mode...');
      
      // 注册调试命令
      this.registerCommands();
      
      // 初始化UI管理器
      await this.uiManager.initialize();
      
      // 设置全局调试访问
      window.VectorsDebugger = this;
      
      this.isEnabled = true;
      
      // 显示调试启用通知
      if (this.api.toastr) {
        this.api.toastr.success('向量化调试模式已启用', '调试模式');
      }
      
      console.log('[VectorsDebug] Debug mode enabled successfully');
    } catch (error) {
      console.error('[VectorsDebug] Failed to enable debug mode:', error);
    }
  }
  
  /**
   * 禁用调试模式
   */
  async disableDebugMode() {
    if (!this.isEnabled) return;
    
    try {
      console.log('[VectorsDebug] Disabling debug mode...');
      
      // 移除UI
      await this.uiManager.cleanup();
      
      // 移除全局访问
      delete window.VectorsDebugger;
      
      this.isEnabled = false;
      
      if (this.api.toastr) {
        this.api.toastr.info('向量化调试模式已禁用', '调试模式');
      }
      
      console.log('[VectorsDebug] Debug mode disabled');
    } catch (error) {
      console.error('[VectorsDebug] Failed to disable debug mode:', error);
    }
  }
  
  /**
   * 注册调试命令
   */
  registerCommands() {
    // 状态分析命令
    this.registerDebugFunction('analyze-vector-status', '分析向量状态', '检查向量任务和数据状态', 
      () => this.stateAnalyzer.analyzeVectorStatus());
    
    this.registerDebugFunction('analyze-content-selection', '分析内容选择', '显示当前内容选择状态',
      () => this.stateAnalyzer.analyzeContentSelection());
    
    // 同步分析命令  
    this.registerDebugFunction('analyze-ui-sync', '分析UI同步', '检查UI与设置同步状态',
      () => this.syncAnalyzer.analyzeUiSync());
    
    this.registerDebugFunction('analyze-world-info-deep', '深度世界信息分析', '深度分析世界信息状态',
      () => this.syncAnalyzer.analyzeWorldInfoDeep());
    
    // 数据分析命令
    this.registerDebugFunction('analyze-file-overlap', '分析文件重复', '检测文件重复情况',
      () => this.dataAnalyzer.analyzeFileOverlap());
    
    // 清理工具命令
    this.registerDebugFunction('clear-world-info-selections', '清空世界信息选择', '重置所有世界信息选择',
      () => this.cleaner.clearWorldInfoSelection());
    
    this.registerDebugFunction('run-core-cleanup', '运行核心清理', '执行主模块的清理功能',
      () => this.cleaner.runCoreCleanup());
    
    // 检查工具命令
    this.registerDebugFunction('inspect-hidden-messages', '检查隐藏消息', '分析隐藏消息结构',
      () => this.inspector.inspectHiddenMessages());
    
    // 测试工具命令
    this.registerDebugFunction('test-slash-commands', '测试斜杠命令', '测试斜杠命令执行',
      () => this.tester.testSlashCommands());
    
    console.log('[VectorsDebug] Debug commands registered');
  }
  
  /**
   * 注册单个调试函数
   */
  registerDebugFunction(id, name, description, callback) {
    try {
      // 使用主模块的registerDebugFunction，如果可用
      if (typeof registerDebugFunction === 'function') {
        registerDebugFunction(id, name, description, callback);
      } else {
        // 如果不可用，记录到控制台
        console.log(`[VectorsDebug] Would register: ${id} - ${name}`);
      }
    } catch (error) {
      console.warn(`[VectorsDebug] Failed to register ${id}:`, error);
    }
  }
  
  /**
   * 获取调试状态
   */
  getDebugStatus() {
    return {
      enabled: this.isEnabled,
      modules: {
        uiManager: !!this.uiManager,
        stateAnalyzer: !!this.stateAnalyzer,
        syncAnalyzer: !!this.syncAnalyzer,
        dataAnalyzer: !!this.dataAnalyzer,
        cleaner: !!this.cleaner,
        inspector: !!this.inspector,
        tester: !!this.tester,
      },
      api: Object.keys(this.api),
    };
  }
  
  /**
   * 切换调试模式
   */
  async toggleDebugMode() {
    if (this.isEnabled) {
      await this.disableDebugMode();
    } else {
      await this.enableDebugMode();
    }
  }
}

/**
 * 检测是否应该自动加载调试模块
 */
export function shouldLoadDebugModule() {
  return (
    window.location.hostname === 'localhost' ||
    window.location.search.includes('debug=true') ||
    localStorage.getItem('vectors_debug_enabled') === 'true'
  );
}

/**
 * 创建并初始化调试器实例
 */
export async function createDebugger(api) {
  const debuggerInstance = new VectorsDebugger(api);
  await debuggerInstance.initialize();
  return debuggerInstance;
}