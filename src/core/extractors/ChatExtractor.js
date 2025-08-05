import { IContentExtractor } from './IContentExtractor.js';
import { getMessages, createVectorItem } from '../../utils/chatUtils.js';
import { extractTagContent } from '../../utils/tagExtractor.js';
import { extension_settings } from '../../../../../../extensions.js';

/**
 * @implements {IContentExtractor}
 */
export class ChatExtractor {
    /**
     * Extracts content from chat history based on current settings.
     * @param {object|Array} source - The source configuration object or array of chat items.
     * @param {Array} [source.chat] - The chat history array.
     * @param {object} [config] - Additional configuration.
     * @returns {Promise<object>} A promise that resolves to extraction result with content and metadata.
     */
    async extract(source, config = {}) {
        const settings = extension_settings.vectors_enhanced;
        const items = [];

        // Handle different input formats
        if (Array.isArray(source)) {
            // Pipeline mode: array of chat items
            console.log(`ChatExtractor: Processing ${source.length} chat items from pipeline`);
            console.log('ChatExtractor: Sample items:', source.slice(0, 3).map(item => ({ 
                type: item.type, 
                hasText: !!item.text,
                textLength: item.text?.length,
                textPreview: item.text?.substring(0, 50) + '...'
            })));
            
            const chatSettings = config || settings.selected_content.chat;
            const rules = chatSettings.tag_rules || [];
            
            source.forEach(item => {
                let extractedText;
                const applyTagsToFirstMessage = chatSettings.apply_tags_to_first_message || false;
                
                if ((item.metadata?.index === 0 && !applyTagsToFirstMessage) || item.metadata?.is_user === true) {
                    extractedText = item.text;
                } else {
                    extractedText = extractTagContent(item.text, rules, settings.content_blacklist || []);
                }
                
                items.push({
                    text: extractedText,
                    metadata: item.metadata,
                    type: 'chat'
                });
            });
        } else {
            // Original mode: source object with chat array
            const { chat } = source;
            
            if (settings.selected_content.chat.enabled && chat) {
            const chatSettings = settings.selected_content.chat;
            const rules = chatSettings.tag_rules || [];

            const messageOptions = {
                includeHidden: chatSettings.include_hidden || false,
                types: chatSettings.types || { user: true, assistant: true },
                range: chatSettings.range,
                newRanges: chatSettings.newRanges
            };

            const messages = getMessages(chat, messageOptions);

            messages.forEach(msg => {
                let extractedText;
                const applyTagsToFirstMessage = chatSettings.apply_tags_to_first_message || false;
                
                if ((msg.index === 0 && !applyTagsToFirstMessage) || msg.is_user === true) {
                    extractedText = msg.text;
                } else {
                    extractedText = extractTagContent(msg.text, rules);
                }
                items.push(createVectorItem(msg, extractedText));
            });
            }
        }
        
        // Return in pipeline format
        const joinedContent = items.map(item => item.text).join('\n\n');
        
        console.log(`ChatExtractor: Extracted ${items.length} items, content length: ${joinedContent.length}`);
        console.log('ChatExtractor: Content preview:', joinedContent.substring(0, 200) + '...');
        
        return {
            content: joinedContent,
            metadata: {
                extractorType: 'ChatExtractor',
                messageCount: items.length,
                messages: items.map(item => ({
                    index: item.metadata?.index,
                    is_user: item.metadata?.is_user,
                    type: item.type || 'chat'
                }))
            }
        };
    }
}
