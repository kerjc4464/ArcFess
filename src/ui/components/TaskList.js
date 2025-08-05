import { extension_settings, getContext } from '../../../../../../extensions.js';
import { getCurrentChatId, saveSettingsDebounced } from '../../../../../../../script.js';
import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from '../../../../../../popup.js';
import { TaskNameGenerator } from '../../utils/taskNaming.js';
import { getSortedEntries } from '../../../../../../world-info.js';
import { getDataBankAttachments, getDataBankAttachmentsForSource } from '../../../../../../chats.js';
import { TaskReferenceResolver } from '../../core/external-tasks/TaskReferenceResolver.js';

const settings = extension_settings.vectors_enhanced;

/**
 * Gets all available files from different sources (copied from index.js)
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
 * Updates the task list UI
 */
export async function updateTaskList(getChatTasks, renameVectorTask, removeVectorTask) {
  const chatId = getCurrentChatId();
  if (!chatId) return;

  const tasks = getChatTasks(chatId);
  const taskList = $('#vectors_enhanced_task_list');
  taskList.empty();

  if (tasks.length === 0) {
    taskList.append('<div class="text-muted">没有向量化任务</div>');
    return;
  }

  tasks.forEach((task, index) => {
    const taskDiv = $('<div class="vector-enhanced-task-item"></div>');

    // Generate smart task name if actualProcessedItems is available and no custom name
    let displayName = task.name;
    if (!task.isCustomName && task.actualProcessedItems && (task.actualProcessedItems.chat || task.actualProcessedItems.files || task.actualProcessedItems.world_info)) {
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

      // Add file items
      if (task.actualProcessedItems.files) {
        task.actualProcessedItems.files.forEach(url => {
          items.push({
            type: 'file',
            metadata: { url: url }
          });
        });
      }

      // Add world info items
      if (task.actualProcessedItems.world_info) {
        task.actualProcessedItems.world_info.forEach(uid => {
          items.push({
            type: 'world_info',
            metadata: { uid: uid }
          });
        });
      }

      // Generate smart name
      displayName = TaskNameGenerator.generateSmartName(items, task.settings);
    }
    
    // 检查是否是总结向量化任务，如果是则添加标识
    if (task.name && task.name.includes('(总结向量化)')) {
      displayName = `${displayName} <span style="color: #ff6b6b; font-weight: 600;">[总结]</span>`;
    }

    // 外挂任务标识
    let taskClass = '';
    if (task.type === 'external') {
      taskClass = 'external-task';

      // 检查源是否存在
      if (task.source) {
        const [sourceChat] = task.source.split('_');
        if (!settings.vector_tasks[sourceChat]) {
          displayName = `<span class="orphaned-task">源数据已删除</span>`;
          taskClass += ' orphaned';
        }
      }
    }

    const checkbox = $(`
            <label class="checkbox_label ${taskClass}">
                <input type="checkbox" ${task.enabled ? 'checked' : ''} />
                <div class="task-content">
                    <div class="task-name" title="${task.name}">
                        <strong>${displayName}</strong>
                        <small class="task-info"> - ${new Date(task.timestamp).toLocaleString('zh-CN')}</small>
                    </div>
                    ${task.type === 'external' ? '<span class="external-task-badge" title="外挂任务">🔗</span>' : ''}
                </div>
            </label>
        `);

    checkbox.find('input').on('change', function () {
      task.enabled = this.checked;
      Object.assign(extension_settings.vectors_enhanced, settings);
      saveSettingsDebounced();
    });

    const previewBtn = $(`<button class="menu_button menu_button_icon" title="预览此任务内容">
            <i class="fa-solid fa-eye"></i>
        </button>`);

    previewBtn.on('click', async () => {
      await previewTaskContent(task);
    });

    const renameBtn = $(`<button class="menu_button menu_button_icon" title="重命名此任务">
            <i class="fa-solid fa-edit"></i>
        </button>`);

    renameBtn.on('click', async () => {
      await renameVectorTask(chatId, task.taskId, task.name);
    });

    const deleteBtn = $(`<button class="menu_button menu_button_icon" title="删除此任务">
            <i class="fa-solid fa-trash"></i>
        </button>`);

    deleteBtn.on('click', async () => {
      const confirm = await callGenericPopup('确定要删除这个向量化任务吗？', POPUP_TYPE.CONFIRM);
      if (confirm === POPUP_RESULT.AFFIRMATIVE) {
        await removeVectorTask(chatId, task.taskId);
        await updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);
        toastr.success('任务已删除');
      }
    });

    const buttonGroup = $('<div class="button-group"></div>');
    buttonGroup.append(previewBtn);
    buttonGroup.append(renameBtn);
    buttonGroup.append(deleteBtn);

    taskDiv.append(checkbox);
    taskDiv.append(buttonGroup);
    taskList.append(taskDiv);
  });
}

/**
 * Preview task content
 * @param {Object} task - The task to preview
 */
async function previewTaskContent(task) {
  // 如果是外挂任务，显示源聊天信息而不是预览内容
  if (task.type === 'external') {
    const message = `任务名称：${task.name}\n\n源聊天ID：${task.sourceChat || '未知'}`;
    await callGenericPopup(message, POPUP_TYPE.TEXT, '', { okButton: '确定' });
    return;
  }

  if (!task.actualProcessedItems) {
    toastr.warning('此任务没有可预览的内容');
    return;
  }

  const context = getContext();
  const items = [];

  // Collect chat items
  if (task.actualProcessedItems.chat && task.actualProcessedItems.chat.length > 0) {
    // Import tag extractor for filtering
    const { extractTagContent } = await import('../../utils/tagExtractor.js');
    
    // Get tag rules from task settings (saved when task was created)
    const chatSettings = task.settings?.chat || {};
    const rules = chatSettings.tag_rules || [];
    const applyTagsToFirstMessage = chatSettings.apply_tags_to_first_message || false;
    const contentBlacklist = task.settings?.content_blacklist || [];
    
    const chatIndices = task.actualProcessedItems.chat;
    chatIndices.forEach(index => {
      if (context.chat[index]) {
        const msg = context.chat[index];
        let processedText;
        
        // Apply tag filtering based on the rules saved with the task
        if ((index === 0 && !applyTagsToFirstMessage) || msg.is_user === true) {
          // First message (if not applying tags) or user messages: use full text
          processedText = msg.mes;
        } else {
          // Other messages: apply tag extraction rules
          processedText = extractTagContent(msg.mes, rules, contentBlacklist);
        }
        
        // Only include messages that have content after filtering
        if (processedText && processedText.trim() !== '') {
          items.push({
            type: 'chat',
            text: processedText,
            metadata: {
              index: index,
              is_user: msg.is_user,
              name: msg.name
            }
          });
        }
      }
    });
  }

  // Collect file items
  if (task.actualProcessedItems.files && task.actualProcessedItems.files.length > 0) {
    // Get all available files to match URLs with file objects
    const fileMap = getAllAvailableFiles();

    task.actualProcessedItems.files.forEach(url => {
      const file = fileMap.get(url);
      if (file) {
        items.push({
          type: 'file',
          metadata: {
            name: file.name,
            url: url,
            size: file.size || 0
          }
        });
      } else {
        // Fallback if file not found
        const fileName = url.split('/').pop();
        items.push({
          type: 'file',
          metadata: {
            name: fileName,
            url: url,
            size: 0
          }
        });
      }
    });
  }

  // Collect world info items
  if (task.actualProcessedItems.world_info && task.actualProcessedItems.world_info.length > 0) {
    // Import world info functions
    const { world_info } = await import('../../../../../../world-info.js');
    
    // Try to find entries from all loaded world books
    const entryMap = new Map();
    
    // Check all world info data
    if (world_info && world_info.data) {
      for (const [worldName, worldData] of Object.entries(world_info.data)) {
        if (worldData && worldData.entries) {
          Object.values(worldData.entries).forEach(entry => {
            if (entry.uid !== undefined && entry.uid !== null) {
              entryMap.set(entry.uid, { ...entry, world: worldName });
            }
          });
        }
      }
    }
    
    // Also check from getSortedEntries as fallback
    const sortedEntries = await getSortedEntries();
    sortedEntries.forEach(entry => {
      if (entry.uid !== undefined && entry.uid !== null && !entryMap.has(entry.uid)) {
        entryMap.set(entry.uid, entry);
      }
    });

    task.actualProcessedItems.world_info.forEach(item => {
      // Handle both old format (string uid) and new format (object with uid, world, comment)
      if (typeof item === 'string') {
        // Old format - try to find entry data
        const uid = item;
        const entry = entryMap.get(uid);
        if (entry) {
          items.push({
            type: 'world_info',
            text: entry.content,
            metadata: {
              uid: uid,
              world: entry.world || '未知',
              comment: entry.comment || '(无注释)',
              key: entry.key ? entry.key.join(', ') : ''
            }
          });
        } else {
          // Fallback if entry not found
          items.push({
            type: 'world_info',
            metadata: {
              uid: uid,
              world: '未知',
              comment: `条目 UID: ${uid}`
            }
          });
        }
      } else {
        // New format - use saved data directly
        const entry = entryMap.get(item.uid);
        items.push({
          type: 'world_info',
          text: entry ? entry.content : '',
          metadata: {
            uid: item.uid,
            world: item.world || '未知',
            comment: item.comment || '(无注释)',
            key: entry && entry.key ? entry.key.join(', ') : ''
          }
        });
      }
    });
  }

  if (items.length === 0) {
    toastr.warning('此任务没有可预览的内容');
    return;
  }

  // Build preview HTML matching global preview style
  let html = '<div class="vector-preview">';
  html += `<div class="preview-header">任务内容（${items.length} 项）</div>`;
  html += '<div class="preview-sections">';

  // Group by type
  const grouped = items.reduce((acc, item) => {
    if (!acc[item.type]) acc[item.type] = [];
    acc[item.type].push(item);
    return acc;
  }, {});

  // Always show all three sections for consistent layout
  // Files section
  html += '<div class="preview-section">';
  html += `<div class="preview-section-title">文件（${grouped.file?.length || 0}）</div>`;
  html += '<div class="preview-section-content">';
  if (grouped.file && grouped.file.length > 0) {
    grouped.file.forEach(item => {
      html += `<div class="preview-item">`;
      const sizeKB = item.metadata.size ? (item.metadata.size / 1024).toFixed(1) : '0';
      html += `<strong>${item.metadata.name}</strong> - ${sizeKB} KB`;
      html += `</div>`;
    });
  } else {
    html += '<div class="preview-empty">无文件</div>';
  }
  html += '</div></div>';

  // World Info section
  html += '<div class="preview-section">';
  html += `<div class="preview-section-title">世界信息（${grouped.world_info?.length || 0}）</div>`;
  html += '<div class="preview-section-content">';
  if (grouped.world_info && grouped.world_info.length > 0) {
    // Group by world if we have world info
    // Group by world
    const byWorld = {};
    grouped.world_info.forEach(item => {
      if (!byWorld[item.metadata.world]) byWorld[item.metadata.world] = [];
      byWorld[item.metadata.world].push(item);
    });

    for (const [world, entries] of Object.entries(byWorld)) {
      html += `<div class="preview-world-group">`;
      html += `<div class="preview-world-name">${world}</div>`;
      entries.forEach(entry => {
        html += `<div class="preview-world-entry">${entry.metadata.comment || '(无注释)'}</div>`;
      });
      html += `</div>`;
    }
  } else {
    html += '<div class="preview-empty">无世界信息</div>';
  }
  html += '</div></div>';

  // Chat messages section
  html += '<div class="preview-section">';
  html += `<div class="preview-section-title">聊天记录（${grouped.chat?.length || 0} 条消息）</div>`;
  html += '<div class="preview-section-content">';
  if (grouped.chat && grouped.chat.length > 0) {
    // Add floor info at the beginning of content with negative margins to break out of background
    const chatIndices = grouped.chat.map(item => item.metadata.index).sort((a, b) => a - b);
    const segments = identifyContinuousSegments(chatIndices);
    html += `<div style="margin: -1rem -1rem 1rem -1rem; padding: 0.75rem 1rem; background: transparent; border-bottom: 1px solid var(--SmartThemeBorderColor);"><strong style="color: var(--SmartThemeQuoteColor);">包含楼层：</strong>${segments.join(', ')}</div>`;

    grouped.chat.forEach(item => {
      const msgType = item.metadata.is_user ? '用户' : 'AI';
      html += `<div class="preview-chat-message">`;
      html += `<div class="preview-chat-header">#${item.metadata.index} - ${msgType}（${item.metadata.name}）</div>`;
      // Show processed text (after tag filtering)
      html += `<div class="preview-chat-content">${item.text}</div>`;
      html += `</div>`;
    });
  } else {
    html += '<div class="preview-empty">无聊天记录</div>';
  }
  html += '</div></div>';

  html += '</div></div>';

  await callGenericPopup(html, POPUP_TYPE.TEXT, '', {
    okButton: '关闭',
    wide: true,
    large: true,
  });
}

/**
 * Identify continuous segments in indices (same logic as taskNaming.js)
 */
function identifyContinuousSegments(indices) {
  if (indices.length === 0) return [];

  const segments = [];
  let segmentStart = indices[0];
  let segmentEnd = indices[0];

  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === segmentEnd + 1) {
      // Continue current segment
      segmentEnd = indices[i];
    } else {
      // End current segment and start new one
      segments.push(formatSegment(segmentStart, segmentEnd));
      segmentStart = indices[i];
      segmentEnd = indices[i];
    }
  }

  // Add the last segment
  segments.push(formatSegment(segmentStart, segmentEnd));

  return segments;
}

/**
 * Format segment (single number or range)
 */
function formatSegment(start, end) {
  if (start === end) {
    return `${start}`;
  }
  return `${start}-${end}`;
}
