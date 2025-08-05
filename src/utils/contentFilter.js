/**
 * @fileoverview Content filtering utilities for the vectors-enhanced extension
 * @module contentFilter
 */

/**
 * Checks if content should be skipped based on blacklist
 * @param {string} text Content to check
 * @param {string[]} blacklist Array of blacklist keywords
 * @returns {boolean} True if content should be skipped
 */
export function shouldSkipContent(text, blacklist) {
    if (!blacklist || blacklist.length === 0) return false;

    const lowerText = text.toLowerCase();
    return blacklist.some(keyword => {
        const lowerKeyword = keyword.trim().toLowerCase();
        return lowerKeyword && lowerText.includes(lowerKeyword);
    });
}

/**
 * Escapes special regex characters in a string
 * @param {string} str String to escape
 * @returns {string} Escaped string
 */
export function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validates if a tag name is suitable for extraction
 * @param {string} tagName Tag name to validate
 * @returns {boolean} True if tag name is valid
 */
export function isValidTagName(tagName) {
    // Exclude common HTML formatting tags that might be empty or problematic
    const excludedTags = [
        'font', 'span', 'div', 'p', 'br', 'hr', 'img', 'a', 'b', 'i', 'u', 's',
        'em', 'strong', 'small', 'big', 'sub', 'sup', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'table', 'tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'ul', 'ol', 'li',
        'form', 'input', 'button', 'select', 'option', 'textarea', 'label',
        'script', 'style', 'meta', 'link', 'title', 'head', 'body', 'html'
    ];

    // Must be alphanumeric with possible underscores/hyphens
    const validPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

    return validPattern.test(tagName) && !excludedTags.includes(tagName.toLowerCase());
}

