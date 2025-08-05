/**
 * Parses a tag configuration string that may include exclusions.
 * The format is "include,tags - exclude,tags".
 * @param {string} tagConfig - The tag configuration string.
 * @returns {{mainTag: string, excludeTags: string[]}} An object with the main tag string and an array of exclusion tags.
 */
export function parseTagWithExclusions(tagConfig) {
  if (!tagConfig || typeof tagConfig !== 'string') {
    return { mainTag: '', excludeTags: [] };
  }

  const parts = tagConfig.split(' - ');
  const mainTag = (parts[0] || '').trim();
  const excludePart = (parts[1] || '').trim();

  const excludeTags = excludePart ? excludePart.split(',').map(t => t.trim()).filter(Boolean) : [];

  return { mainTag, excludeTags };
}

/**
 * Removes content within specified excluded tags from a given text.
 * This function is designed to handle simple, non-nested tags.
 * @param {string} content - The original content.
 * @param {string[]} excludeTags - An array of tags to remove.
 * @returns {string} The content with excluded tags removed.
 */
export function removeExcludedTags(content, excludeTags) {
  if (!content || !excludeTags || excludeTags.length === 0) {
    return content;
  }

  let processedContent = content;
  for (const tag of excludeTags) {
    // Regex to find <tag>...</tag> and remove it.
    // It's a simple regex and might not handle all edge cases like nested or self-closing tags perfectly.
    const regex = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'g');
    processedContent = processedContent.replace(regex, '');
  }

  return processedContent;
}
