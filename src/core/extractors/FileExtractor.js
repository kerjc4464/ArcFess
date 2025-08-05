import { IContentExtractor } from './IContentExtractor.js';
import { Content } from '../entities/Content.js';
import { getFileAttachment } from '../../../../../../chats.js';

/**
 * @implements {IContentExtractor}
 */
export class FileExtractor {
    /**
     * Extracts content from a list of specified file paths.
     * @param {object|Array} source - The source configuration object or array of file items.
     * @param {string[]} [source.filePaths] - An array of file paths to extract content from.
     * @param {object} [config] - Additional configuration.
     * @returns {Promise<object>} A promise that resolves to extraction result with content and metadata.
     */
    async extract(source, config = {}) {
        // Handle different input formats
        let fileItems = [];
        
        if (Array.isArray(source)) {
            // Pipeline mode: array of file items
            fileItems = source.map(item => ({
                path: item.metadata?.url || item.metadata?.path || item.url || item.text,
                name: item.metadata?.name || item.name || 'unknown',
                text: item.text || null
            }));
        } else if (source && source.filePaths) {
            // Original mode: source object with filePaths
            fileItems = source.filePaths.map(path => ({
                path: path,
                name: path.split('/').pop(),
                text: null // Will be fetched
            }));
        } else {
            throw new Error('Invalid source format: expected array of items or object with filePaths');
        }
        
        console.log(`FileExtractor: Processing ${filePaths.length} files`);
        
        const contentPromises = filePaths.map(async (filePath) => {
            try {
                const text = await getFileAttachment(filePath);
                if (text) {
                    return new Content(
                        filePath, // Use file path as a unique ID
                        'file',
                        text,
                        {
                            fileName: filePath.split('/').pop(),
                            path: filePath,
                        }
                    );
                }
            } catch (error) {
                console.error(`[Vectors Enhanced] Error reading file ${filePath}:`, error);
            }
            return null;
        });

        const contents = await Promise.all(contentPromises);
        const validContents = contents.filter(content => content !== null);
        
        // Return in pipeline format
        const joinedContent = validContents.map(content => content.text).join('\n\n');
        
        console.log(`FileExtractor: Extracted ${validContents.length} files, content length: ${joinedContent.length}`);
        console.log('FileExtractor: Content preview:', joinedContent.substring(0, 200) + '...');
        
        return {
            content: joinedContent,
            metadata: {
                extractorType: 'FileExtractor',
                fileCount: validContents.length,
                files: validContents.map(content => ({
                    id: content.id,
                    fileName: content.metadata.fileName,
                    path: content.metadata.path
                }))
            }
        };
    }
}
