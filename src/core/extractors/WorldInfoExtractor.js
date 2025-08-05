import { IContentExtractor } from './IContentExtractor.js';
import { getSortedEntries } from '../../../../../../world-info.js';
import { extension_settings } from '../../../../../../extensions.js';

/**
 * @implements {IContentExtractor}
 */
export class WorldInfoExtractor {
    /**
     * Extracts content from world info entries based on current settings.
     * @param {object|Array} source - The source configuration object or array of world info items.
     * @param {Object<string, string[]>} [source.selectedWorlds] - The selected world info entries grouped by world name.
     * @param {object} [config] - Additional configuration.
     * @returns {Promise<object>} A promise that resolves to extraction result with content and metadata.
     */
    async extract(source, config = {}) {
        const settings = extension_settings.vectors_enhanced;
        const items = [];

        // Handle different input formats
        let selectedWorlds = {};
        
        if (Array.isArray(source)) {
            // Pipeline mode: array of world info items
            console.log(`WorldInfoExtractor: Processing ${source.length} world info items from pipeline`);
            // Group items by world
            for (const item of source) {
                const worldName = item.metadata?.world || 'default';
                if (!selectedWorlds[worldName]) {
                    selectedWorlds[worldName] = [];
                }
                selectedWorlds[worldName].push(item.metadata?.uid || item.id);
            }
        } else {
            // Original mode: source object with selectedWorlds
            if (!settings.selected_content.world_info.enabled) {
                return { content: '', metadata: { extractorType: 'WorldInfoExtractor', entryCount: 0 } };
            }
            selectedWorlds = source?.selectedWorlds || settings.selected_content.world_info.selected || {};
        }
        
        // Get all world info entries
        const entries = await getSortedEntries();
        
        if (!entries || !Array.isArray(entries)) {
            console.warn('Vectors: No world info entries found or invalid format');
            return items;
        }

        // Debug information
        const totalSelected = Object.values(selectedWorlds).flat().length;
        console.debug('Vectors: Selected world info:', selectedWorlds);
        console.debug(`Vectors: Total selected world info entries: ${totalSelected}`);

        let processedCount = 0;

        // Process each entry
        for (const entry of entries) {
            // Skip invalid entries
            if (!entry.world || !entry.content || entry.disable) {
                continue;
            }

            // Check if this entry is selected
            const selectedEntries = selectedWorlds[entry.world] || [];
            if (!selectedEntries.includes(entry.uid)) {
                continue;
            }

            // Create vector item matching the expected format
            items.push({
                type: 'world_info',
                text: entry.content,
                metadata: {
                    world: entry.world,
                    uid: entry.uid,
                    key: entry.key ? entry.key.join(', ') : '',
                    comment: entry.comment || '',
                },
                selected: true,
            });

            processedCount++;
            console.debug(`Vectors: Successfully processed world info entry: ${entry.comment || entry.uid} from world ${entry.world}`);
        }

        console.debug(`Vectors: Actually processed ${processedCount} world info entries out of ${totalSelected} selected`);
        
        // Return in pipeline format
        const joinedContent = items.map(item => item.text).join('\n\n');
        
        console.log(`WorldInfoExtractor: Extracted ${items.length} items, content length: ${joinedContent.length}`);
        console.log('WorldInfoExtractor: Content preview:', joinedContent.substring(0, 200) + '...');
        
        return {
            content: joinedContent,
            metadata: {
                extractorType: 'WorldInfoExtractor',
                entryCount: items.length,
                processedCount: processedCount,
                selectedWorlds: selectedWorlds,
                entries: items.map(item => ({
                    uid: item.metadata?.uid,
                    world: item.metadata?.world,
                    comment: item.metadata?.comment
                }))
            }
        };
    }
}