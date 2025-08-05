import { extension_settings, getContext } from '../../../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../../../script.js';
import { getDataBankAttachments, getDataBankAttachmentsForSource, getFileAttachment } from '../../../../../../chats.js';

/**
 * Updates the file list UI
 */
export async function updateFileList() {
  const settings = extension_settings.vectors_enhanced;
  console.debug('Vectors: Updating file list...');
  const fileList = $('#vectors_enhanced_files_list');
  console.debug('Vectors: File list element found:', fileList.length > 0);
  fileList.empty();

  const context = getContext();
  console.debug('Vectors: Context:', context);

  let allFiles = [];

  try {
    const dataBankFiles = getDataBankAttachments();
    const globalFiles = getDataBankAttachmentsForSource('global');
    const characterFiles = getDataBankAttachmentsForSource('character');
    const chatFiles = getDataBankAttachmentsForSource('chat');
    const extraFiles = context.chat?.filter(x => x.extra?.file).map(x => x.extra.file) || [];

    console.debug('Vectors: File sources:', {
      dataBank: dataBankFiles.length,
      global: globalFiles.length,
      character: characterFiles.length,
      chat: chatFiles.length,
      extra: extraFiles.length
    });

    // 去重复：使用URL作为唯一键
    const fileMap = new Map();
    [...dataBankFiles, ...globalFiles, ...characterFiles, ...chatFiles, ...extraFiles].forEach(file => {
      if (file && file.url) {
        fileMap.set(file.url, file);
      }
    });

    allFiles = Array.from(fileMap.values());

    console.debug('Vectors: Total files after deduplication:', allFiles.length);

    // Clean up invalid file selections (files that no longer exist)
    const allFileUrls = new Set(allFiles.map(f => f.url));
    const originalSelected = [...settings.selected_content.files.selected];
    settings.selected_content.files.selected = settings.selected_content.files.selected.filter(url =>
      allFileUrls.has(url)
    );

    const removedCount = originalSelected.length - settings.selected_content.files.selected.length;
    if (removedCount > 0) {
      console.debug(`Vectors: Cleaned up ${removedCount} invalid file selections:`, {
        original: originalSelected,
        cleaned: settings.selected_content.files.selected,
        removed: originalSelected.filter(url => !allFileUrls.has(url))
      });

      // Save the cleaned settings
      Object.assign(extension_settings.vectors_enhanced, settings);
      saveSettingsDebounced();
    }
  } catch (error) {
    console.error('Vectors: Error getting files:', error);
    fileList.append('<div class="text-muted">获取文件列表时出错</div>');
    return;
  }

  if (allFiles.length === 0) {
    fileList.append('<div class="text-muted">没有可用文件</div>');
    return;
  }

  // Group files by source - use the deduplicated files
  const dataBankUrls = new Set(getDataBankAttachments().map(f => f.url));
  const chatFileUrls = new Set((context.chat?.filter(x => x.extra?.file).map(x => x.extra.file) || []).map(f => f.url));

  const dataBankFiles = allFiles.filter(file => dataBankUrls.has(file.url));
  const chatFiles = allFiles.filter(file => chatFileUrls.has(file.url) && !dataBankUrls.has(file.url));

  if (dataBankFiles.length > 0) {
    // Check if all databank files are selected
    const allDataBankSelected = dataBankFiles.every(file => 
      settings.selected_content.files.selected.includes(file.url)
    );
    
    const groupHeader = $(`
      <div class="file-group-header flex-container alignItemsCenter">
        <label class="checkbox_label flex-container alignItemsCenter" style="margin: 0;">
          <input type="checkbox" class="file-group-select-all" data-group="databank" ${allDataBankSelected ? 'checked' : ''} />
          <span>数据库文件</span>
        </label>
      </div>
    `);
    
    // Handle select all for databank files
    groupHeader.find('.file-group-select-all').on('change', function() {
      const isChecked = this.checked;
      dataBankFiles.forEach(file => {
        if (isChecked) {
          if (!settings.selected_content.files.selected.includes(file.url)) {
            settings.selected_content.files.selected.push(file.url);
          }
        } else {
          settings.selected_content.files.selected = settings.selected_content.files.selected.filter(
            url => url !== file.url
          );
        }
      });
      
      // Update individual checkboxes
      fileList.find(`input[type="checkbox"][data-group="databank"]:not(.file-group-select-all)`).prop('checked', isChecked);
      
      Object.assign(extension_settings.vectors_enhanced, settings);
      saveSettingsDebounced();
    });
    
    fileList.append(groupHeader);
    
    dataBankFiles.forEach(file => {
      const isChecked = settings.selected_content.files.selected.includes(file.url);
      const checkbox = $(`
                <label class="checkbox_label flex-container alignItemsCenter" title="${file.name}">
                    <input type="checkbox" value="${file.url}" data-group="databank" ${isChecked ? 'checked' : ''} />
                    <span class="flex1 text-overflow-ellipsis">${file.name} (${(file.size / 1024).toFixed(1)} KB)</span>
                </label>
            `);

      checkbox.find('input').on('change', function () {
        if (this.checked) {
          if (!settings.selected_content.files.selected.includes(file.url)) {
            settings.selected_content.files.selected.push(file.url);
          }
        } else {
          settings.selected_content.files.selected = settings.selected_content.files.selected.filter(
            url => url !== file.url,
          );
        }
        
        // Update select all checkbox
        const allChecked = dataBankFiles.every(f => 
          settings.selected_content.files.selected.includes(f.url)
        );
        fileList.find('.file-group-select-all[data-group="databank"]').prop('checked', allChecked);
        
        Object.assign(extension_settings.vectors_enhanced, settings);
        saveSettingsDebounced();
      });

      fileList.append(checkbox);
    });
  }

  if (chatFiles.length > 0) {
    if (dataBankFiles.length > 0) fileList.append('<hr class="m-t-0-5 m-b-0-5">');
    
    // Check if all chat files are selected
    const allChatSelected = chatFiles.every(file => 
      settings.selected_content.files.selected.includes(file.url)
    );
    
    const groupHeader = $(`
      <div class="file-group-header flex-container alignItemsCenter">
        <label class="checkbox_label flex-container alignItemsCenter" style="margin: 0;">
          <input type="checkbox" class="file-group-select-all" data-group="chat" ${allChatSelected ? 'checked' : ''} />
          <span>聊天附件</span>
        </label>
      </div>
    `);
    
    // Handle select all for chat files
    groupHeader.find('.file-group-select-all').on('change', function() {
      const isChecked = this.checked;
      chatFiles.forEach(file => {
        if (isChecked) {
          if (!settings.selected_content.files.selected.includes(file.url)) {
            settings.selected_content.files.selected.push(file.url);
          }
        } else {
          settings.selected_content.files.selected = settings.selected_content.files.selected.filter(
            url => url !== file.url
          );
        }
      });
      
      // Update individual checkboxes
      fileList.find(`input[type="checkbox"][data-group="chat"]:not(.file-group-select-all)`).prop('checked', isChecked);
      
      Object.assign(extension_settings.vectors_enhanced, settings);
      saveSettingsDebounced();
    });
    
    fileList.append(groupHeader);
    
    chatFiles.forEach(file => {
      const isChecked = settings.selected_content.files.selected.includes(file.url);
      const checkbox = $(`
                <label class="checkbox_label flex-container alignItemsCenter" title="${file.name}">
                    <input type="checkbox" value="${file.url}" data-group="chat" ${isChecked ? 'checked' : ''} />
                    <span class="flex1 text-overflow-ellipsis">${file.name} (${(file.size / 1024).toFixed(1)} KB)</span>
                </label>
            `);

      checkbox.find('input').on('change', function () {
        if (this.checked) {
          if (!settings.selected_content.files.selected.includes(file.url)) {
            settings.selected_content.files.selected.push(file.url);
          }
        } else {
          settings.selected_content.files.selected = settings.selected_content.files.selected.filter(
            url => url !== file.url,
          );
        }
        
        // Update select all checkbox
        const allChecked = chatFiles.every(f => 
          settings.selected_content.files.selected.includes(f.url)
        );
        fileList.find('.file-group-select-all[data-group="chat"]').prop('checked', allChecked);
        
        Object.assign(extension_settings.vectors_enhanced, settings);
        saveSettingsDebounced();
      });

      fileList.append(checkbox);
    });
  }
}
