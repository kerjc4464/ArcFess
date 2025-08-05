/**
 * @interface
 * Represents the interface for a content extractor.
 * Extractors are responsible for gathering content from various sources
 * like chats, files, or world information.
 */
export class IContentExtractor {
    /**
     * Extracts content from a given source configuration.
     * This method must be implemented by concrete extractor classes.
     * @param {object} source - The configuration or identifier for the content source.
     * @returns {Promise<Array<import('../entities/Content.js').Content>>} A promise that resolves to an array of Content objects.
     */
    async extract(source) {
        throw new Error('IContentExtractor.extract() must be implemented by subclasses');
    }
}
