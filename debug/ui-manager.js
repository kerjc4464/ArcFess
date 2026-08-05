/**
 * Debug UI Manager
 * 调试界面管理器
 * 
 * 负责调试界面的渲染、事件处理和状态管理
 */

export class DebugUIManager {
  constructor(api) {
    this.api = api;
    this.$ = api.jQuery;
    this.isInitialized = false;
    this.debugPanel = null;
    this.eventHandlers = new Map();
    
    console.log('[VectorsDebug] UI Manager initialized');
  }
  
  /**
   * 初始化UI管理器
   */
  async initialize() {
    if (this.isInitialized) return;
    
    try {
      await this.loadDebugUI();
      this.attachEventHandlers();
      this.isInitialized = true;
      
      console.log('[VectorsDebug] UI Manager ready');
    } catch (error) {
      console.error('[VectorsDebug] Failed to initialize UI Manager:', error);
    }
  }
  
  /**
   * 加载调试UI
   */
  async loadDebugUI() {
    try {
      // 从模板文件加载HTML，如果存在的话
      let debugHTML;
      try {
        const response = await fetch('/scripts/extensions/third-party/ArcFess/debug/templates/debug-ui.html');
        if (response.ok) {
          debugHTML = await response.text();
        }
      } catch (e) {
        // 如果加载失败，使用内置HTML
        console.log('[VectorsDebug] Using built-in debug UI template');
      }
      
      // 如果没有外部模板，使用内置模板
      if (!debugHTML) {
        debugHTML = this.getBuiltInTemplate();
      }
      
      // 将调试面板插入到设置界面
      this.insertDebugPanel(debugHTML);
      
    } catch (error) {
      console.error('[VectorsDebug] Failed to load debug UI:', error);
    }
  }
  
  /**
   * 获取内置模板
   */
  getBuiltInTemplate() {
    return `
      <div id="vectors-debug-panel" class="vectors-enhanced-section">
        <h3 style="color: var(--SmartThemeQuoteColor);">🔧 调试工具面板</h3>
        
        <!-- 状态分析工具 -->
        <details class="debug-section" data-section="state">
          <summary><strong>📊 状态分析</strong></summary>
          <div class="flex-container m-t-0-5">
            <button id="debug_analyze_vector_status" class="menu_button menu_button_icon" title="分析向量状态">
              <i class="fa-solid fa-chart-line"></i>
              <span>向量状态</span>
            </button>
            <button id="debug_analyze_content_selection" class="menu_button menu_button_icon" title="分析内容选择状态">
              <i class="fa-solid fa-list-check"></i>
              <span>内容选择</span>
            </button>
          </div>
        </details>
        
        <!-- 同步检查工具 -->
        <details class="debug-section" data-section="sync">
          <summary><strong>🔄 同步检查</strong></summary>
          <div class="flex-container m-t-0-5">
            <button id="debug_analyze_ui_sync" class="menu_button menu_button_icon" title="检查UI与设置同步">
              <i class="fa-solid fa-sync"></i>
              <span>UI同步</span>
            </button>
            <button id="debug_analyze_world_info_deep" class="menu_button menu_button_icon" title="深度分析世界信息">
              <i class="fa-solid fa-magnifying-glass"></i>
              <span>世界信息深度</span>
            </button>
          </div>
        </details>
        
        <!-- 数据分析工具 -->
        <details class="debug-section" data-section="data">
          <summary><strong>📋 数据分析</strong></summary>
          <div class="flex-container m-t-0-5">
            <button id="debug_analyze_file_overlap" class="menu_button menu_button_icon" title="分析文件重复">
              <i class="fa-solid fa-files"></i>
              <span>文件重复</span>
            </button>
          </div>
        </details>
        
        <!-- 清理工具 -->
        <details class="debug-section" data-section="cleanup">
          <summary><strong>🧹 清理工具</strong></summary>
          <div class="flex-container m-t-0-5">
            <button id="debug_clear_world_info" class="menu_button menu_button_icon" title="清空世界信息选择">
              <i class="fa-solid fa-trash"></i>
              <span>清空世界信息</span>
            </button>
            <button id="debug_run_core_cleanup" class="menu_button menu_button_icon" title="运行核心清理">
              <i class="fa-solid fa-broom"></i>
              <span>核心清理</span>
            </button>
          </div>
        </details>
        
        <!-- 检查工具 -->
        <details class="debug-section" data-section="inspect">
          <summary><strong>🔍 检查工具</strong></summary>
          <div class="flex-container m-t-0-5">
            <button id="debug_inspect_hidden_messages" class="menu_button menu_button_icon" title="检查隐藏消息">
              <i class="fa-solid fa-eye-slash"></i>
              <span>隐藏消息</span>
            </button>
          </div>
        </details>
        
        <!-- 测试工具 -->
        <details class="debug-section" data-section="test">
          <summary><strong>🧪 测试工具</strong></summary>
          <div class="flex-container m-t-0-5">
            <button id="debug_test_slash_commands" class="menu_button menu_button_icon" title="测试斜杠命令">
              <i class="fa-solid fa-terminal"></i>
              <span>斜杠命令</span>
            </button>
          </div>
        </details>
        
        <!-- 调试控制 -->
        <div class="flex-container m-t-1" style="border-top: 1px dashed var(--SmartThemeQuoteColor); padding-top: 0.5rem;">
          <button id="debug_toggle_mode" class="menu_button menu_button_icon" title="切换调试模式">
            <i class="fa-solid fa-power-off"></i>
            <span>切换调试模式</span>
          </button>
          <button id="debug_show_status" class="menu_button menu_button_icon" title="显示调试状态">
            <i class="fa-solid fa-info-circle"></i>
            <span>调试状态</span>
          </button>
        </div>
      </div>
    `;
  }
  
  /**
   * 插入调试面板到设置界面
   */
  insertDebugPanel(htmlContent) {
    // 找到主设置容器
    const settingsContainer = this.$('#vectors_enhanced_container .inline-drawer-content');
    if (settingsContainer.length === 0) {
      console.warn('[VectorsDebug] Settings container not found');
      return;
    }
    
    // 移除已存在的调试面板
    this.$('#vectors-debug-panel').remove();
    
    // 在设置面板末尾插入调试面板
    settingsContainer.append(htmlContent);
    
    // 保存面板引用
    this.debugPanel = this.$('#vectors-debug-panel');
    
    console.log('[VectorsDebug] Debug panel inserted');
  }
  
  /**
   * 绑定事件处理器
   */
  attachEventHandlers() {
    if (!this.debugPanel) return;
    
    // 状态分析按钮
    this.bindButton('debug_analyze_vector_status', () => {
      window.VectorsDebugger?.stateAnalyzer?.analyzeVectorStatus();
    });
    
    this.bindButton('debug_analyze_content_selection', () => {
      window.VectorsDebugger?.stateAnalyzer?.analyzeContentSelection();
    });
    
    this.bindButton('debug_analyze_hidden_messages', () => {
      window.VectorsDebugger?.stateAnalyzer?.analyzeHiddenMessagesStatus();
    });
    
    this.bindButton('debug_check_system_integrity', () => {
      window.VectorsDebugger?.stateAnalyzer?.checkSystemIntegrity();
    });
    
    // 同步检查按钮
    this.bindButton('debug_analyze_ui_sync', () => {
      window.VectorsDebugger?.syncAnalyzer?.analyzeUiSync();
    });
    
    this.bindButton('debug_analyze_world_info_deep', () => {
      window.VectorsDebugger?.syncAnalyzer?.analyzeWorldInfoDeep();
    });
    
    this.bindButton('debug_find_sync_discrepancies', () => {
      window.VectorsDebugger?.syncAnalyzer?.findSyncDiscrepancies();
    });
    
    this.bindButton('debug_generate_sync_report', () => {
      window.VectorsDebugger?.syncAnalyzer?.generateSyncReport();
    });
    
    // 数据分析按钮
    this.bindButton('debug_analyze_file_overlap', () => {
      window.VectorsDebugger?.dataAnalyzer?.analyzeFileOverlap();
    });
    
    this.bindButton('debug_analyze_task_overlap', () => {
      window.VectorsDebugger?.dataAnalyzer?.analyzeTaskOverlap();
    });
    
    this.bindButton('debug_validate_data_integrity', () => {
      window.VectorsDebugger?.dataAnalyzer?.validateDataIntegrity();
    });
    
    this.bindButton('debug_generate_statistics', () => {
      window.VectorsDebugger?.dataAnalyzer?.generateStatistics();
    });
    
    // 清理工具按钮
    this.bindButton('debug_clear_world_info', () => {
      window.VectorsDebugger?.cleaner?.clearWorldInfoSelection();
    });
    
    this.bindButton('debug_clear_file_selections', () => {
      window.VectorsDebugger?.cleaner?.clearFileSelections();
    });
    
    this.bindButton('debug_reset_chat_settings', () => {
      window.VectorsDebugger?.cleaner?.resetChatSettings();
    });
    
    this.bindButton('debug_run_core_cleanup', () => {
      window.VectorsDebugger?.cleaner?.runCoreCleanup();
    });
    
    this.bindButton('debug_bulk_cleanup', () => {
      window.VectorsDebugger?.cleaner?.bulkCleanup();
    });
    
    this.bindButton('debug_cleanup_cache', () => {
      window.VectorsDebugger?.cleaner?.cleanupCache();
    });
    
    this.bindButton('debug_purge_vector_data', () => {
      window.VectorsDebugger?.cleaner?.purgeVectorData();
    });
    
    // 检查工具按钮
    this.bindButton('debug_inspect_hidden_messages', () => {
      window.VectorsDebugger?.inspector?.inspectHiddenMessages();
    });
    
    this.bindButton('debug_inspect_system_status', () => {
      window.VectorsDebugger?.inspector?.inspectSystemStatus();
    });
    
    this.bindButton('debug_inspect_vector_integrity', () => {
      window.VectorsDebugger?.inspector?.inspectVectorDataIntegrity();
    });
    
    this.bindButton('debug_inspect_file_access', () => {
      window.VectorsDebugger?.inspector?.inspectFileAccess();
    });
    
    this.bindButton('debug_inspect_world_info_availability', () => {
      window.VectorsDebugger?.inspector?.inspectWorldInfoAvailability();
    });
    
    this.bindButton('debug_generate_comprehensive_report', () => {
      window.VectorsDebugger?.inspector?.generateComprehensiveReport();
    });
    
    // 测试工具按钮
    this.bindButton('debug_test_slash_commands', () => {
      window.VectorsDebugger?.tester?.testSlashCommands();
    });
    
    this.bindButton('debug_test_functional_integrity', () => {
      window.VectorsDebugger?.tester?.testFunctionalIntegrity();
    });
    
    this.bindButton('debug_test_performance_stress', () => {
      window.VectorsDebugger?.tester?.testPerformanceStress();
    });
    
    this.bindButton('debug_generate_test_report', () => {
      window.VectorsDebugger?.tester?.generateTestReport();
    });
    
    // 高级工具按钮
    this.bindButton('debug_analyze_performance_metrics', () => {
      window.VectorsDebugger?.stateAnalyzer?.analyzePerformanceMetrics();
    });
    
    this.bindButton('debug_analyze_usage_patterns', () => {
      window.VectorsDebugger?.dataAnalyzer?.analyzeUsagePatterns();
    });
    
    this.bindButton('debug_analyze_data_flow', () => {
      window.VectorsDebugger?.dataAnalyzer?.analyzeDataFlow();
    });
    
    this.bindButton('debug_create_settings_backup', () => {
      window.VectorsDebugger?.cleaner?.createSettingsBackup();
    });
    
    // 调试控制按钮
    this.bindButton('debug_toggle_mode', () => {
      window.VectorsDebugger?.toggleDebugMode();
    });
    
    this.bindButton('debug_show_status', () => {
      const status = window.VectorsDebugger?.getDebugStatus();
      console.log('[VectorsDebug] Status:', status);
      if (this.api.toastr) {
        this.api.toastr.info('调试状态已输出到控制台', '调试状态');
      }
    });
    
    this.bindButton('debug_refresh_ui', () => {
      this.refreshDebugUI();
    });
    
    // 调试信息面板按钮
    this.bindButton('debug_clear_info', () => {
      this.$('#debug-info-content').text('调试信息将显示在这里...');
    });
    
    this.bindButton('debug_copy_info', () => {
      const content = this.$('#debug-info-content').text();
      navigator.clipboard.writeText(content).then(() => {
        if (this.api.toastr) {
          this.api.toastr.success('调试信息已复制到剪贴板', '复制成功');
        }
      }).catch(err => {
        console.error('复制失败:', err);
        if (this.api.toastr) {
          this.api.toastr.error('复制失败', '错误');
        }
      });
    });
    
    console.log('[VectorsDebug] Event handlers attached');
  }
  
  /**
   * 刷新调试界面
   */
  refreshDebugUI() {
    try {
      // 移除当前面板
      this.$('#vectors-debug-panel').remove();
      
      // 重新加载调试UI
      this.loadDebugUI();
      
      if (this.api.toastr) {
        this.api.toastr.success('调试界面已刷新', '刷新完成');
      }
    } catch (error) {
      console.error('[VectorsDebug] Failed to refresh UI:', error);
      if (this.api.toastr) {
        this.api.toastr.error(`刷新失败: ${error.message}`, '刷新错误');
      }
    }
  }
  
  /**
   * 绑定单个按钮事件
   */
  bindButton(buttonId, handler) {
    const button = this.$(`#${buttonId}`);
    if (button.length === 0) {
      console.warn(`[VectorsDebug] Button not found: ${buttonId}`);
      return;
    }
    
    // 移除已存在的事件处理器
    button.off('click.debug');
    
    // 绑定新的事件处理器
    button.on('click.debug', (e) => {
      e.preventDefault();
      try {
        handler();
      } catch (error) {
        console.error(`[VectorsDebug] Error in ${buttonId}:`, error);
        if (this.api.toastr) {
          this.api.toastr.error(`调试操作失败: ${error.message}`, '调试错误');
        }
      }
    });
    
    // 记录事件处理器
    this.eventHandlers.set(buttonId, handler);
  }
  
  /**
   * 显示调试面板
   */
  showDebugPanel() {
    if (this.debugPanel) {
      this.debugPanel.show();
    }
  }
  
  /**
   * 隐藏调试面板
   */
  hideDebugPanel() {
    if (this.debugPanel) {
      this.debugPanel.hide();
    }
  }
  
  /**
   * 更新按钮状态
   */
  updateButtonStates(enabled = true) {
    if (!this.debugPanel) return;
    
    const buttons = this.debugPanel.find('button');
    buttons.prop('disabled', !enabled);
    
    if (enabled) {
      buttons.removeClass('disabled');
    } else {
      buttons.addClass('disabled');
    }
  }
  
  /**
   * 清理UI管理器
   */
  async cleanup() {
    try {
      // 移除事件处理器
      this.eventHandlers.forEach((handler, buttonId) => {
        this.$(`#${buttonId}`).off('click.debug');
      });
      this.eventHandlers.clear();
      
      // 移除调试面板
      if (this.debugPanel) {
        this.debugPanel.remove();
        this.debugPanel = null;
      }
      
      this.isInitialized = false;
      
      console.log('[VectorsDebug] UI Manager cleaned up');
    } catch (error) {
      console.error('[VectorsDebug] Failed to cleanup UI Manager:', error);
    }
  }
}