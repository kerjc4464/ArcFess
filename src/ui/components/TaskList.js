import { extension_settings, getContext } from '../../../../../../extensions.js';
import { getCurrentChatId, saveSettingsDebounced, chat_metadata, saveChatDebounced } from '../../../../../../../script.js';
import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from '../../../../../../popup.js';
import { TaskNameGenerator } from '../../utils/taskNaming.js';
import { getSortedEntries } from '../../../../../../world-info.js';
import { getDataBankAttachments, getDataBankAttachmentsForSource } from '../../../../../../chats.js';

// 动态获取设置引用
const getSettings = () => extension_settings.vectors_enhanced;

function getAllAvailableFiles() {
  const fileMap = new Map();
  const context = getContext();
  try {
    getDataBankAttachments().forEach(file => { if (file?.url) fileMap.set(file.url, file); });
    getDataBankAttachmentsForSource('global').forEach(file => { if (file?.url) fileMap.set(file.url, file); });
    getDataBankAttachmentsForSource('character').forEach(file => { if (file?.url) fileMap.set(file.url, file); });
    getDataBankAttachmentsForSource('chat').forEach(file => { if (file?.url) fileMap.set(file.url, file); });
    if (context.chat) {
      context.chat.filter(x => x.extra?.file).forEach(msg => {
        const file = msg.extra.file;
        if (file?.url) fileMap.set(file.url, file);
      });
    }
  } catch (error) {
    console.error('Vectors: Error getting files:', error);
  }
  return fileMap;
}

/**
 * 强制同步到持久化存储
 */
function forceSyncToStorage(chatId, taskId, updates) {
    let synced = false;
    let needsGlobalSave = false;
    let needsChatSave = false;

    // 1. 同步到全局设置
    if (extension_settings.vectors_enhanced?.vector_tasks?.[chatId]) {
        const list = extension_settings.vectors_enhanced.vector_tasks[chatId];
        const target = list.find(t => t.taskId === taskId);
        if (target) {
            Object.assign(target, updates);
            needsGlobalSave = true;
            synced = true;
        }
    }

    // 2. 同步到聊天元数据
    if (chat_metadata?.vector_tasks?.[chatId]) {
        const list = chat_metadata.vector_tasks[chatId];
        const target = list.find(t => t.taskId === taskId);
        if (target) {
            Object.assign(target, updates);
            needsChatSave = true;
            synced = true;
        }
    }

    if (needsGlobalSave) saveSettingsDebounced();
    if (needsChatSave) saveChatDebounced();

    return synced;
}

/**
 * Updates the task list UI
 */
export async function updateTaskList(getChatTasks, renameVectorTask, removeVectorTask) {
  const chatId = getCurrentChatId();
  if (!chatId) return;

  const tasks = getChatTasks(chatId).filter(t => !t.isRealtime);
  const taskList = $('#vectors_enhanced_task_list');
  taskList.empty();

  if (tasks.length === 0) {
    taskList.append('<div class="text-muted">没有向量化任务</div>');
    return;
  }

  // 按时间倒序
  const sortedTasks = [...tasks].sort((a, b) => b.timestamp - a.timestamp);
  const currentSettings = getSettings() || {};

  sortedTasks.forEach((task, index) => {
    const taskDiv = $('<div class="vector-enhanced-task-item"></div>');

    // 1. 名称生成
    let displayName = task.name;
    if (!task.isCustomName && task.actualProcessedItems) {
        const items = [];
        if (task.actualProcessedItems.chat) items.push(...task.actualProcessedItems.chat.map(i => ({type:'chat', metadata:{index:i}})));
        if (task.actualProcessedItems.files) items.push(...task.actualProcessedItems.files.map(u => ({type:'file', metadata:{url:u}})));
        if (task.actualProcessedItems.world_info) items.push(...task.actualProcessedItems.world_info.map(u => ({type:'world_info', metadata:{uid:u}})));
        displayName = TaskNameGenerator.generateSmartName(items, task.settings);
    }
    
    if (task.name && task.name.includes('(总结向量化)')) {
      displayName = `${displayName} <span style="color: #ff6b6b; font-weight: 600;">[总结]</span>`;
    }

    // 2. 策略徽章
    const strategy = task.retrievalSettings || { quota: 0, boost: 1.0 };
    if (strategy.quota > 0 || strategy.boost !== 1.0) {
        const parts = [];
        if (strategy.quota > 0) parts.push(`🛡️${strategy.quota}`);
        if (strategy.boost !== 1.0) parts.push(`🚀${strategy.boost}x`);
        displayName += ` <span class="vector-task-badge config" style="font-size:0.8em; opacity:0.8; margin-left:5px; background:var(--SmartThemeColor); color:#fff; padding:1px 4px; border-radius:3px;">${parts.join(' ')}</span>`;
    }

    // 3. 外挂任务样式
    let taskClass = '';
    if (task.type === 'external') {
      taskClass = 'external-task';
      if (task.source) {
        const [sourceChat] = task.source.split('_');
        const sourceTasks = currentSettings.vector_tasks?.[sourceChat] || [];
        // 源任务必须存在，且必须有实际向量数据 (itemCount > 0)
        const sourceTask = sourceTasks.find(t => t.taskId === task.sourceTaskId);
        const sourceTaskValid = sourceTask && sourceTask.itemCount > 0;
        if (!sourceTasks.length || !sourceTaskValid) {
          displayName = `<span class="orphaned-task">源数据已删除</span>`;
          taskClass += ' orphaned';
        }
      }
    }

    // 4. 复选框
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
      forceSyncToStorage(chatId, task.taskId, { enabled: this.checked });
    });

    const buttonGroup = $('<div class="button-group"></div>');

    // A. 预览按钮
    const previewBtn = $(`<button class="menu_button menu_button_icon" title="预览"><i class="fa-solid fa-eye"></i></button>`);
    previewBtn.on('click', async (e) => { e.preventDefault(); e.stopPropagation(); await previewTaskContent(task); });

    // B. 配置按钮 (修复 Crash 的核心)
    const configureBtn = $(`<button class="menu_button menu_button_icon configure-task" title="配置策略"><i class="fa-solid fa-sliders"></i></button>`);
    
    configureBtn.on('click', async function(e) {
        e.preventDefault(); e.stopPropagation();
        
        // 初始值
        let currentQuota = task.retrievalSettings?.quota || 0;
        let currentBoost = task.retrievalSettings?.boost || 1.0;

        // 【关键修复】实时捕获输入值，不依赖 DOM 元素存在
        const inputHandler = (event) => {
            if (event.target.id === 'vec_cfg_quota') {
                currentQuota = parseInt(event.target.value) || 0;
            }
            if (event.target.id === 'vec_cfg_boost') {
                currentBoost = parseFloat(event.target.value) || 1.0;
            }
        };

        // 绑定监听器
        document.addEventListener('input', inputHandler);

        const html = `
            <div class="vector-config-popup">
                <p style="margin-bottom: 15px; border-bottom: 1px solid var(--SmartThemeBorderColor); padding-bottom: 10px;">
                    为任务 <b>${task.name}</b> 配置优先级
                </p>
                <div class="vector-config-field">
                    <label><i class="fa-solid fa-shield-halved"></i> 保底名额 (Quota)</label>
                    <div class="vector-input-group">
                        <input type="number" id="vec_cfg_quota" class="text_pole" value="${currentQuota}" min="0" max="50" step="1">
                        <span class="unit">条</span>
                    </div>
                </div>
                <div class="vector-config-field" style="margin-top: 10px;">
                    <label><i class="fa-solid fa-rocket"></i> 权重倍率 (Boost)</label>
                    <div class="vector-input-group">
                        <input type="number" id="vec_cfg_boost" class="text_pole" value="${currentBoost}" min="0.1" max="10.0" step="0.1">
                        <span class="unit">x</span>
                    </div>
                </div>
            </div>
        `;

        const result = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', { okButton: '保存策略', cancelButton: '取消' });

        // 移除监听器，防止污染
        document.removeEventListener('input', inputHandler);

        if (result === POPUP_RESULT.AFFIRMATIVE) {
            // 【关键修复】直接使用 inputHandler 捕获到的变量，不再 document.getElementById
            const newSettings = { quota: currentQuota, boost: currentBoost };

            // 1. 更新内存
            task.retrievalSettings = newSettings;
            
            // 2. 写入存储
            const saved = forceSyncToStorage(chatId, task.taskId, { retrievalSettings: newSettings });
            
            if (saved) {
                toastr.success(`策略已保存: 保底${currentQuota}, ${currentBoost}x`);
                await updateTaskList(getChatTasks, renameVectorTask, removeVectorTask);
            } else {
                toastr.error("保存失败：未找到源数据");
            }
        }
    });

    // C. 重命名
    const renameBtn = $(`<button class="menu_button menu_button_icon" title="重命名"><i class="fa-solid fa-edit"></i></button>`);
    renameBtn.on('click', async (e) => { e.preventDefault(); e.stopPropagation(); await renameVectorTask(chatId, task.taskId, task.name); });

    // D. 删除
    const deleteBtn = $(`<button class="menu_button menu_button_icon" title="删除"><i class="fa-solid fa-trash"></i></button>`);
    deleteBtn.on('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      if ((await callGenericPopup('确定删除？', POPUP_TYPE.CONFIRM)) === POPUP_RESULT.AFFIRMATIVE) {
        await removeVectorTask(chatId, task.taskId);
        toastr.success('任务已删除');
      }
    });

    buttonGroup.append(previewBtn, configureBtn, renameBtn, deleteBtn);
    taskDiv.append(checkbox, buttonGroup);
    taskList.append(taskDiv);
  });
}

/**
 * Preview task content - 完整版
 */
async function previewTaskContent(task) {
  if (task.type === 'external') {
    await callGenericPopup(`任务：${task.name}\n源ID：${task.sourceChat || '未知'}`, POPUP_TYPE.TEXT, '', { okButton: '确定' });
    return;
  }
  if (!task.actualProcessedItems) { toastr.warning('无预览内容'); return; }

  const context = getContext();
  const items = [];

  // Chat
  if (task.actualProcessedItems.chat && task.actualProcessedItems.chat.length > 0) {
    const { extractTagContent } = await import('../../utils/tagExtractor.js');
    const rules = task.settings?.chat?.tag_rules || [];
    const bl = task.settings?.content_blacklist || [];
    
    task.actualProcessedItems.chat.forEach(index => {
      if (context.chat[index]) {
        const msg = context.chat[index];
        let processedText;
        const chatSettings = task.settings?.chat || {};
        const applyTagsToFirst = chatSettings.apply_tags_to_first_message || false;

        if ((index === 0 && !applyTagsToFirst) || msg.is_user === true) {
          processedText = msg.text; 
        } else {
          processedText = extractTagContent(msg.text, rules, bl);
        }
        
        if (processedText && processedText.trim() !== '') {
          items.push({ type: 'chat', text: processedText, metadata: { index: index, is_user: msg.is_user, name: msg.name } });
        }
      }
    });
  }

  // Files
  if (task.actualProcessedItems.files && task.actualProcessedItems.files.length > 0) {
    const fileMap = getAllAvailableFiles();
    task.actualProcessedItems.files.forEach(url => {
      const file = fileMap.get(url);
      items.push({ type: 'file', metadata: { name: file?.name || url.split('/').pop(), url, size: file?.size || 0 } });
    });
  }

  // World Info
  if (task.actualProcessedItems.world_info && task.actualProcessedItems.world_info.length > 0) {
    const { world_info } = await import('../../../../../../world-info.js');
    const sortedEntries = await getSortedEntries();
    
    task.actualProcessedItems.world_info.forEach(item => {
      let uid, worldName;
      if (typeof item === 'object' && item.uid) { uid = item.uid; worldName = item.world; }
      else { uid = item; }

      let entry = sortedEntries.find(e => e.uid == uid);
      if (!entry && world_info?.data) {
          for (const [wName, wData] of Object.entries(world_info.data)) {
             const found = Object.values(wData.entries||{}).find(e=>e.uid == uid);
             if(found) { entry={...found, world:wName}; break; }
          }
      }
      items.push({ type: 'world_info', text: entry?.content || '', metadata: { uid: uid, world: entry?.world || worldName || '未知', comment: entry?.comment || '(无注释)' } });
    });
  }

  if (items.length === 0) { toastr.warning('无内容'); return; }

  // Build HTML
  let html = '<div class="vector-preview"><div class="preview-header">任务内容</div><div class="preview-sections">';
  const grouped = items.reduce((acc, item) => {
    if (!acc[item.type]) acc[item.type] = [];
    acc[item.type].push(item);
    return acc;
  }, {});

  html += `<div class="preview-section"><div class="preview-section-title">文件 (${grouped.file?.length||0})</div><div class="preview-section-content">`;
  if(grouped.file) grouped.file.forEach(i => html += `<div class="preview-item"><strong>${i.metadata.name}</strong></div>`);
  else html += '<div class="preview-empty">无</div>';
  html += '</div></div>';

  html += `<div class="preview-section"><div class="preview-section-title">世界书 (${grouped.world_info?.length||0})</div><div class="preview-section-content">`;
  if(grouped.world_info) grouped.world_info.forEach(i => html += `<div class="preview-item">[${i.metadata.world}] ${i.metadata.comment}</div>`);
  else html += '<div class="preview-empty">无</div>';
  html += '</div></div>';

  html += `<div class="preview-section"><div class="preview-section-title">聊天 (${grouped.chat?.length||0})</div><div class="preview-section-content">`;
  if(grouped.chat) {
      const indices = grouped.chat.map(i=>i.metadata.index).sort((a,b)=>a-b);
      html += `<div style="padding:5px;border-bottom:1px solid #ccc;font-size:0.8em">楼层: ${identifyContinuousSegments(indices).join(', ')}</div>`;
      grouped.chat.forEach(i => html += `<div class="preview-chat-message"><div class="preview-chat-header">#${i.metadata.index} ${i.metadata.is_user?'User':'AI'}</div><div class="preview-chat-content">${i.text.slice(0,100)}...</div></div>`);
  } else html += '<div class="preview-empty">无</div>';
  html += '</div></div></div></div>';

  await callGenericPopup(html, POPUP_TYPE.TEXT, '', { okButton: '关闭', wide: true, large: true });
}

function identifyContinuousSegments(indices) {
  if (indices.length === 0) return [];
  const segments = [];
  let start = indices[0];
  let segmentEnd = indices[0];
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === segmentEnd + 1) segmentEnd = indices[i];
    else { segments.push(start===segmentEnd ? `${start}` : `${start}-${segmentEnd}`); start = segmentEnd = indices[i]; }
  }
  segments.push(start===segmentEnd ? `${start}` : `${start}-${segmentEnd}`);
  return segments;
}