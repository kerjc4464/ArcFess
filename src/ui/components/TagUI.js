/**
 * @module TagUI
 * @description Manages UI interactions for tags, including suggestions and examples, using jQuery.
 */

import { extension_settings } from '../../../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../../../script.js';
import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from '../../../../../../popup.js';
import { renderTagRulesUI } from './TagRulesEditor.js';

/**
 * Clears the tag suggestion list from the UI.
 */
const clearTagSuggestions = () => {
    $('#vectors_enhanced_tag_suggestions').hide();
    $('#vectors_enhanced_tag_list').empty();
    $('#vectors_tag_scan_stats').text('');
};

/**
 * Adds a scanned tag as a new 'include' rule.
 * @param {string} tag The scanned tag to add as a rule.
 */
function addScannedTagAsRule(tag) {
    const settings = extension_settings.vectors_enhanced;
    if (!settings.selected_content.chat.tag_rules || !Array.isArray(settings.selected_content.chat.tag_rules)) {
        settings.selected_content.chat.tag_rules = [];
    }

    const ruleValue = tag; // The new scanner provides clean tag names directly

    const alreadyExists = settings.selected_content.chat.tag_rules.some(
        rule => rule.type === 'include' && rule.value === ruleValue
    );

    if (alreadyExists) {
        toastr.info(`规则 "包含: ${ruleValue}" 已存在。`);
        return;
    }

    const newRule = {
        type: 'include',
        value: ruleValue,
        enabled: true,
    };
    settings.selected_content.chat.tag_rules.push(newRule);

    Object.assign(extension_settings.vectors_enhanced, settings);
    saveSettingsDebounced();
    renderTagRulesUI();

    toastr.success(`已添加新规则: "包含: ${ruleValue}"`);
}

/**
 * Displays tag suggestions in the UI
 * @param {string[]} suggestions Array of tag suggestions
 * @param {object} scanStats Scanning performance stats
 */
const displayTagSuggestions = (suggestions, scanStats) => {
  const container = $('#vectors_enhanced_tag_suggestions');
  const tagList = $('#vectors_enhanced_tag_list');
  const statsSpan = $('#vectors_tag_scan_stats');

  // Update stats display with just clickable tag count
  const statsText = `${suggestions.length} 个标签，${scanStats.processingTimeMs}ms`;
  statsSpan.text(statsText);

  // Clear previous suggestions
  tagList.empty();

  if (suggestions.length === 0) {
    container.hide();
    return;
  }

  // Create tag suggestion buttons
  suggestions.forEach(tag => {
    // Escape HTML to prevent rendering issues
    const displayText = $('<div>').text(tag).html();
    const tagBtn = $(`<button class="menu_button tag-suggestion-btn" title="点击添加到标签提取框"></button>`);
    tagBtn.text(tag); // Use .text() to prevent HTML parsing

    tagBtn.on('click', () => {
      addScannedTagAsRule(tag);
    });

    tagList.append(tagBtn);
  });

  // Show suggestions container
  container.show();
};

/**
 * 显示标签提取示例
 * @returns {Promise<void>}
 */
async function showTagExamples() {
  try {
    // 读取标签提取示例文件
    const response = await fetch('/scripts/extensions/third-party/vectors-enhanced/标签提取示例.md');
    if (!response.ok) {
      throw new Error('无法加载标签示例文件');
    }

    const rawContent = await response.text();
    const content = rawContent
      // 首先清理整个文件的末尾空白和奇怪字符
      .replace(/\s+$/, '')        // 去除文件末尾所有空白
      .replace(/[^\x00-\x7F\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, ''); // 保留ASCII、中文、标点

    // HTML转义函数
    function escapeHtml(text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // 将Markdown转换为HTML
    // 先用占位符保护代码块
    const codeBlocks = [];
    let htmlContent = content
      // 保护代码块：用占位符替换，避免被后续处理影响
      .replace(/```html\n([\s\S]*?)\n```/g, (match, code) => {
        const cleanCode = code.trim()
          .split('\n')
          .filter(line => line.trim().length > 0)
          .map(line => line.replace(/^\s+/, '').replace(/\s+$/, ''))
          .join('\n');
        const placeholder = `__CODEBLOCK_HTML_${codeBlocks.length}__`;
        codeBlocks.push(`<pre style="background: var(--SmartThemeBlurTintColor); padding: 1.2rem; margin: 1.5rem 0; border-radius: 6px; overflow-x: auto; border: 1px solid var(--SmartThemeQuoteColor); white-space: pre;"><code style="font-family: 'Consolas', 'Monaco', 'Courier New', monospace; font-size: 0.9em; line-height: 1.4;">${escapeHtml(cleanCode)}</code></pre>`);
        return placeholder;
      })
      .replace(/```\n([\s\S]*?)\n```/g, (match, code) => {
        const cleanCode = code.trim()
          .split('\n')
          .filter(line => line.trim().length > 0)
          .map(line => line.replace(/^\s+/, '').replace(/\s+$/, ''))
          .join('\n');
        const placeholder = `__CODEBLOCK_${codeBlocks.length}__`;
        codeBlocks.push(`<pre style="background: var(--SmartThemeBlurTintColor); padding: 1.2rem; margin: 1.5rem 0; border-radius: 6px; overflow-x: auto; border: 1px solid var(--SmartThemeEmColor); white-space: pre;"><code style="font-family: 'Consolas', 'Monaco', 'Courier New', monospace; font-size: 0.9em; line-height: 1.4;">${escapeHtml(cleanCode)}</code></pre>`);
        return placeholder;
      })
      // 处理行内代码 - 匹配反引号之间的任何内容（包括特殊字符）
      .replace(/`([^`]*)`/g, (match, code) => {
        return `<code style="background: var(--SmartThemeBlurTintColor); padding: 0.3rem 0.5rem; border-radius: 4px; font-family: 'Consolas', 'Monaco', 'Courier New', monospace; font-size: 0.9em; border: 1px solid var(--SmartThemeQuoteColor);">${escapeHtml(code)}</code>`;
      })
      // 处理标题
      .replace(/^# (.*)/gm, '<h1 style="color: var(--SmartThemeQuoteColor); margin: 2rem 0 1.5rem 0; font-size: 1.8em; border-bottom: 2px solid var(--SmartThemeQuoteColor); padding-bottom: 0.5rem;"><i class="fa-solid fa-bookmark"></i> $1</h1>')
      .replace(/^## (.*)/gm, '<h2 style="color: var(--SmartThemeQuoteColor); margin: 2rem 0 1rem 0; font-size: 1.4em; border-left: 4px solid var(--SmartThemeQuoteColor); padding-left: 1rem;">$1</h2>')
      .replace(/^### (.*)/gm, '<h3 style="color: var(--SmartThemeEmColor); margin: 1.5rem 0 0.8rem 0; font-size: 1.2em;">$1</h3>')
      // 处理粗体和斜体
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--SmartThemeQuoteColor);">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em style="color: var(--SmartThemeEmColor);">$1</em>')
      // 处理列表
      .replace(/^- (.*)/gm, '<li style="margin: 0.5rem 0; padding-left: 0.5rem;">$1</li>')
      .replace(/^\d+\. (.*)/gm, '<li style="margin: 0.5rem 0; padding-left: 0.5rem;">$1</li>')
      // 处理段落（排除占位符）
      .replace(/\n\n+/g, '</p><p style="margin: 1rem 0; line-height: 1.6;">')
      .replace(/^(?!<[h123]|<pre|<li|__CODEBLOCK)(.+)$/gm, '<p style="margin: 1rem 0; line-height: 1.6;">$1</p>');

    // 后处理：包装列表并温和清理HTML
    htmlContent = htmlContent
      // 包装列表项为ul标签
      .replace(/(<li[^>]*>.*?<\/li>)(\s*<li[^>]*>.*?<\/li>)*/gs, '<ul style="margin: 1rem 0; padding-left: 1.5rem;">$&</ul>')
      // 温和清理，避免破坏内容
      .replace(/<p[^>]*>\s*<\/p>/g, '')           // 删除空段落
      .replace(/>\s*\n\s*</g, '><')               // 只删除标签间的换行，保留空格
      .replace(/\n{3,}/g, '\n\n')                 // 最多保留双换行
      .trim();

    // 最后恢复代码块占位符
    codeBlocks.forEach((codeBlock, index) => {
      htmlContent = htmlContent
        .replace(`__CODEBLOCK_HTML_${index}__`, codeBlock)
        .replace(`__CODEBLOCK_${index}__`, codeBlock);
    });

    const html = `
      <div class="tag-examples-popup" style="
        max-height: 75vh;
        overflow-y: auto;
        text-align: left;
        line-height: 1.7;
        font-size: 1em;
        padding: 1.5rem;
        background: #1a1a1a;
        color: #e0e0e0;
        border-radius: 8px;
      ">
        <div style="
          background: linear-gradient(135deg, var(--SmartThemeQuoteColor), var(--SmartThemeEmColor));
          color: white;
          padding: 1rem 1.5rem;
          margin: -1.5rem -1.5rem 1.5rem -1.5rem;
          border-radius: 8px 8px 0 0;
          text-align: center;
          font-size: 1.2em;
          font-weight: bold;
        ">
          <i class="fa-solid fa-lightbulb"></i> 标签提取功能使用指南
        </div>
        ${htmlContent}
      </div>
    `;

    await callGenericPopup(html, POPUP_TYPE.TEXT, '', {
      okButton: '关闭',
      wide: true,
      large: true,
    });

  } catch (error) {
    console.error('显示标签示例失败:', error);
    toastr.error('无法加载标签示例: ' + error.message);
  }
}

export {
    clearTagSuggestions,
    displayTagSuggestions,
    showTagExamples,
};
