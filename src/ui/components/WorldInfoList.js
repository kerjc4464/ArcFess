import { extension_settings, getContext } from '../../../../../../extensions.js';
import { saveSettingsDebounced, chat_metadata, characters, this_chid } from '../../../../../../../script.js';
import { getSortedEntries, selected_world_info, METADATA_KEY, world_info } from '../../../../../../world-info.js';
import { getCharaFilename } from '../../../../../../utils.js';

/**
 * Categorize world info entries by their source
 * @param {Array} entries - World info entries
 * @returns {Object} Categorized entries by source
 */
async function categorizeWorldInfoBySource(entries) {
  const context = getContext();
  const chatWorld = chat_metadata[METADATA_KEY];
  const character = context.characters[context.characterId];
  const characterPrimaryWorld = character?.data?.extensions?.world;
  
  // Get character's extra books
  const fileName = getCharaFilename(this_chid);
  const extraCharLore = world_info.charLore?.find((e) => e.name === fileName);
  const characterExtraBooks = extraCharLore?.extraBooks || [];
  
  // Group entries by world name first to avoid duplicates
  const worldMap = new Map();
  entries.forEach(entry => {
    if (!entry.world || entry.disable || !entry.content) return;
    
    if (!worldMap.has(entry.world)) {
      worldMap.set(entry.world, []);
    }
    worldMap.get(entry.world).push(entry);
  });
  
  // Categorize each world (not each entry) to avoid duplicates
  const categorized = {
    chat: [],
    character: [],
    global: []
  };
  
  worldMap.forEach((worldEntries, worldName) => {
    // Priority order: chat > character > global
    // Each world appears only in ONE category
    if (chatWorld && worldName === chatWorld) {
      categorized.chat.push(...worldEntries.map(e => ({ ...e, source: 'chat' })));
    }
    else if (characterPrimaryWorld && worldName === characterPrimaryWorld) {
      categorized.character.push(...worldEntries.map(e => ({ ...e, source: 'character' })));
    }
    else if (characterExtraBooks.includes(worldName)) {
      categorized.character.push(...worldEntries.map(e => ({ ...e, source: 'character' })));
    }
    else if (selected_world_info.includes(worldName)) {
      categorized.global.push(...worldEntries.map(e => ({ ...e, source: 'global' })));
    }
    else {
      // Default to global if no match
      categorized.global.push(...worldEntries.map(e => ({ ...e, source: 'global' })));
    }
  });
  
  // Flatten back to array with source attached
  return [...categorized.chat, ...categorized.character, ...categorized.global];
}

export async function updateWorldInfoList() {
  const settings = extension_settings.vectors_enhanced;
  const entries = await getSortedEntries();
  const wiList = $('#vectors_enhanced_wi_list');
  wiList.empty();

  if (!entries || entries.length === 0) {
    wiList.append('<div class="text-muted">没有可用的世界信息条目</div>');
    return;
  }

  // Categorize entries by source - this already filters and groups them
  const categorizedEntries = await categorizeWorldInfoBySource(entries);
  
  // Group entries by source and then by world
  const grouped = {
    global: {},
    character: {},
    chat: {}
  };
  
  // The entries are already categorized and don't have duplicates
  categorizedEntries.forEach(entry => {
    const source = entry.source || 'global';
    if (!grouped[source][entry.world]) grouped[source][entry.world] = [];
    grouped[source][entry.world].push(entry);
  });

  // Check if any source has entries
  const hasAnyEntries = Object.values(grouped).some(sourceWorlds => Object.keys(sourceWorlds).length > 0);
  if (!hasAnyEntries) {
    wiList.append('<div class="text-muted">未找到有效的世界信息条目</div>');
    return;
  }

  // Clean up invalid world info selections (entries that no longer exist or worlds not in current context)
  const allValidUids = new Set();
  const currentValidWorlds = new Set();
  
  // Collect all valid worlds and UIDs from all sources
  Object.values(grouped).forEach(sourceWorlds => {
    Object.entries(sourceWorlds).forEach(([world, worldEntries]) => {
      currentValidWorlds.add(world);
      worldEntries.forEach(entry => allValidUids.add(entry.uid));
    });
  });

  let hasChanges = false;
  const originalSelected = JSON.parse(JSON.stringify(settings.selected_content.world_info.selected));

  // Clean each world's selection
  for (const [world, selectedUids] of Object.entries(settings.selected_content.world_info.selected)) {
    // Remove worlds that don't exist in current context
    if (!currentValidWorlds.has(world)) {
      console.debug(`Vectors: Removing world "${world}" - not available in current context`);
      delete settings.selected_content.world_info.selected[world];
      hasChanges = true;
      continue;
    }

    const validUids = selectedUids.filter(uid => allValidUids.has(uid));
    if (validUids.length !== selectedUids.length) {
      hasChanges = true;
      if (validUids.length === 0) {
        delete settings.selected_content.world_info.selected[world];
      } else {
        settings.selected_content.world_info.selected[world] = validUids;
      }
    }
  }

  if (hasChanges) {
    const currentSelected = JSON.parse(JSON.stringify(settings.selected_content.world_info.selected));
    const originalCount = Object.values(originalSelected).flat().length;
    const currentCount = Object.values(currentSelected).flat().length;
    const removedCount = originalCount - currentCount;

    console.debug(`Vectors: Cleaned up ${removedCount} invalid world info selections:`, {
      original: originalSelected,
      cleaned: currentSelected,
      originalCount,
      currentCount
    });

    // Save the cleaned settings
    Object.assign(extension_settings.vectors_enhanced, settings);
    saveSettingsDebounced();
    
    // 通知UI更新 - 触发世界信息列表重新渲染
    if (removedCount > 0) {
      console.debug('Vectors: Triggering UI update after world info cleanup');
      // 延迟一下确保设置已保存
      setTimeout(() => {
        updateWorldInfoList();
      }, 100);
    }
  }

  // Display by source category
  const sourceLabels = {
    global: '🌍 全局世界书',
    character: '👤 角色世界书',
    chat: '💬 聊天世界书'
  };
  
  for (const [source, sourceWorlds] of Object.entries(grouped)) {
    if (Object.keys(sourceWorlds).length === 0) continue;
    
    // Source category header
    const sourceHeader = $(`
      <div class="wi-source-header" style="margin-top: 10px; margin-bottom: 5px; font-weight: bold; color: var(--SmartThemeQuoteColor);">
        ${sourceLabels[source]}
      </div>
    `);
    wiList.append(sourceHeader);
    
    for (const [world, worldEntries] of Object.entries(sourceWorlds)) {
      const worldDiv = $('<div class="wi-world-group" style="margin-left: 10px;"></div>');

      // 世界名称和全选复选框
      const selectedEntries = settings.selected_content.world_info.selected[world] || [];
      const allChecked = worldEntries.length > 0 && worldEntries.every(e => selectedEntries.includes(e.uid));

      const worldHeader = $(`
              <div class="wi-world-header flex-container alignItemsCenter">
                  <label class="checkbox_label flex1">
                      <input type="checkbox" class="world-select-all" data-world="${world}" ${
        allChecked ? 'checked' : ''
      } />
                      <span class="wi-world-name">${world}</span>
                  </label>
              </div>
          `);

    // 全选复选框事件
    worldHeader.find('.world-select-all').on('change', function () {
      const isChecked = $(this).prop('checked');

      if (isChecked) {
        settings.selected_content.world_info.selected[world] = worldEntries.map(e => e.uid);
      } else {
        delete settings.selected_content.world_info.selected[world];
      }

      // 更新所有子条目
      worldDiv.find('.wi-entry input').prop('checked', isChecked);

      Object.assign(extension_settings.vectors_enhanced, settings);
      saveSettingsDebounced();
    });

    worldDiv.append(worldHeader);

    // 条目列表
    worldEntries.forEach(entry => {
      const isChecked = selectedEntries.includes(entry.uid);

      const checkbox = $(`
                <label class="checkbox_label wi-entry flex-container alignItemsCenter">
                    <input type="checkbox" value="${entry.uid}" data-world="${world}" ${isChecked ? 'checked' : ''} />
                    <span class="flex1">${entry.comment || '(无注释)'}</span>
                </label>
            `);

      checkbox.find('input').on('change', function () {
        if (!settings.selected_content.world_info.selected[world]) {
          settings.selected_content.world_info.selected[world] = [];
        }

        if ($(this).prop('checked')) {
          if (!settings.selected_content.world_info.selected[world].includes(entry.uid)) {
            settings.selected_content.world_info.selected[world].push(entry.uid);
          }
        } else {
          settings.selected_content.world_info.selected[world] = settings.selected_content.world_info.selected[
            world
          ].filter(id => id !== entry.uid);
        }

        // 更新全选复选框状态
        const allChecked = worldEntries.every(e =>
          settings.selected_content.world_info.selected[world]?.includes(e.uid),
        );
        worldHeader.find('.world-select-all').prop('checked', allChecked);

        // Clean up empty world arrays
        if (settings.selected_content.world_info.selected[world].length === 0) {
          delete settings.selected_content.world_info.selected[world];
        }

        Object.assign(extension_settings.vectors_enhanced, settings);
        saveSettingsDebounced();
      });

      worldDiv.append(checkbox);
    });

      wiList.append(worldDiv);
    }
  }
}
