import { extension_settings } from '../../../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../../../script.js';

/**
 * Renders the tag rules UI in the settings panel.
 */
export function renderTagRulesUI() {
    const settings = extension_settings.vectors_enhanced;
    const editor = $('#vectors_enhanced_rules_editor');
    editor.empty();

    // Ensure tag_rules exists and is an array
    if (!settings.selected_content.chat.tag_rules || !Array.isArray(settings.selected_content.chat.tag_rules)) {
        settings.selected_content.chat.tag_rules = [];
    }
    const rules = settings.selected_content.chat.tag_rules;

    if (rules.length === 0) {
        editor.append('<div class="text-muted" style="margin: 0.5rem 0;">没有定义任何提取规则。</div>');
    }

    rules.forEach((rule, index) => {
        const ruleHtml = `
            <div class="vector-enhanced-rule-item flex-container alignItemsCenter" data-index="${index}" style="margin-bottom: 0.5rem; gap: 0.5rem;">
                <select class="rule-type text_pole widthUnset" style="flex: 2;">
                    <option value="include" ${rule.type === 'include' ? 'selected' : ''}>包含</option>
                    <option value="regex_include" ${rule.type === 'regex_include' ? 'selected' : ''}>正则包含</option>
                    <option value="exclude" ${rule.type === 'exclude' ? 'selected' : ''}>排除</option>
                    <option value="regex_exclude" ${rule.type === 'regex_exclude' ? 'selected' : ''}>正则排除</option>
                </select>
                <input type="text" class="rule-value text_pole" style="flex: 5;" placeholder="标签名或/表达式/" value="${rule.value || ''}">
                <label class="checkbox_label" style="flex: 1; white-space: nowrap;">
                    <input type="checkbox" class="rule-enabled" ${rule.enabled ? 'checked' : ''}>
                    <span>启用</span>
                </label>
                <button class="menu_button menu_button_icon rule-delete" title="删除规则">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
        editor.append(ruleHtml);
    });

    // Unbind previous events to prevent duplicates, then bind new ones.
    editor.off('change', '.rule-type, .rule-value, .rule-enabled').on('change', '.rule-type, .rule-value, .rule-enabled', function() {
        const ruleDiv = $(this).closest('.vector-enhanced-rule-item');
        const index = ruleDiv.data('index');

        if (index === undefined || !settings.selected_content.chat.tag_rules[index]) return;

        const rule = settings.selected_content.chat.tag_rules[index];

        if ($(this).hasClass('rule-type')) {
            rule.type = $(this).val();
        }
        if ($(this).hasClass('rule-value')) {
            rule.value = $(this).val();
        }
        if ($(this).hasClass('rule-enabled')) {
            rule.enabled = $(this).is(':checked');
        }

        Object.assign(extension_settings.vectors_enhanced, { selected_content: settings.selected_content });
        saveSettingsDebounced();
    });

    editor.off('click', '.rule-delete').on('click', '.rule-delete', function() {
        const ruleDiv = $(this).closest('.vector-enhanced-rule-item');
        const index = ruleDiv.data('index');

        if (index !== undefined) {
            settings.selected_content.chat.tag_rules.splice(index, 1);
            Object.assign(extension_settings.vectors_enhanced, { selected_content: settings.selected_content });
            saveSettingsDebounced();
            renderTagRulesUI(); // Re-render the UI
        }
    });
}
