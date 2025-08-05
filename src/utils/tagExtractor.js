import { escapeRegex, shouldSkipContent } from './contentFilter.js';

/**
 * Extracts and filters content from text based on a set of rules.
 * @param {string} text The input text to process.
 * @param {Array<object>} rules An array of rules for inclusion and exclusion.
 * @param {Array<string>} blacklist An array of blacklist keywords to filter out content.
 * @returns {string} The processed content.
 */
export function extractTagContent(text, rules, blacklist = []) {
    if (!rules || rules.length === 0) {
        return text;
    }

    const blockExcludeRules = rules.filter(rule => rule.type === 'exclude' && rule.enabled);
    const includeRules = rules.filter(rule => (rule.type === 'include' || rule.type === 'regex_include') && rule.enabled);
    const cleanupRules = rules.filter(rule => rule.type === 'regex_exclude' && rule.enabled);

    let workingText = text;

    // Phase 1: Global Block-Level Exclusion
    for (const rule of blockExcludeRules) {
        try {
            const tagRegex = new RegExp(`<${escapeRegex(rule.value)}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escapeRegex(rule.value)}>`, 'gi');
            workingText = workingText.replace(tagRegex, '');
        } catch (error) {
            console.error(`Error applying block exclusion rule:`, { rule, error });
        }
    }

    // Phase 2: Content Extraction
    let extractedContents = [];
    if (includeRules.length > 0) {
        for (const rule of includeRules) {
            let results = [];
            try {
                if (rule.type === 'include') {
                    results.push(...extractSimpleTag(workingText, rule.value));
                    results.push(...extractCurlyBraceTag(workingText, rule.value));
                } else if (rule.type === 'regex_include') {
                    const regex = new RegExp(rule.value, 'gi');
                    const matches = [...workingText.matchAll(regex)];
                    matches.forEach(match => {
                        if (match[1]) results.push(match[1]);
                    });
                }
            } catch (error) {
                console.error(`Error applying inclusion rule:`, { rule, error });
            }
            results.forEach(content => extractedContents.push(content.trim()));
        }
    } else {
        extractedContents.push(workingText);
    }

    // Phase 3: Inner Content Cleanup & Blacklist Filtering
    let finalContents = [];
    for (let contentBlock of extractedContents) {
        // Apply regex_exclude rules for cleanup
        for (const rule of cleanupRules) {
            try {
                const regex = new RegExp(rule.value, 'gi');
                contentBlock = contentBlock.replace(regex, '');
            } catch (error) {
                console.error(`Error applying cleanup rule:`, { rule, error });
            }
        }

        // Apply blacklist
        if (!shouldSkipContent(contentBlock, blacklist)) {
            finalContents.push(contentBlock);
        }
    }

    // Join and final cleanup
    const joinedContent = finalContents.join('\n\n');
    return joinedContent
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .replace(/^\s+|\s+$/g, '')
        .trim();
}

/**
 * Extracts content using complex tag configuration
 * @param {string} text Text to search in
 * @param {string} tag Complex tag configuration like "<details><summary>摘要</summary>,</details>"
 * @returns {string[]} Array of extracted content
 */
export function extractComplexTag(text, tag) {
  const parts = tag.split(',');
  if (parts.length !== 2) {
    throw new Error(`复杂标签配置格式错误，应该包含一个逗号: ${tag}`);
  }

  const startPattern = parts[0].trim(); // "<details><summary>摘要</summary>"
  const endPattern = parts[1].trim(); // "</details>"

  // 提取结束标签名
  const endTagMatch = endPattern.match(/<\/(\w+)>/);
  if (!endTagMatch) {
    throw new Error(`无法解析结束标签: ${endPattern}`);
  }
  const endTagName = endTagMatch[1]; // "details"

  // 构建匹配正则，提取中间内容
  const regex = new RegExp(`${escapeRegex(startPattern)}([\\s\\S]*?)<\\/${endTagName}>`, 'gi');

  const extractedContent = [];
  const matches = [...text.matchAll(regex)];

  matches.forEach(match => {
    if (match[1]) {
      // 提取中间的所有内容，包括HTML标签
      extractedContent.push(match[1].trim());
    }
  });

  return extractedContent;
}

/**
 * Extracts content using HTML format tag
 * @param {string} text Text to search in
 * @param {string} tag HTML format tag like "<content></content>"
 * @returns {string[]} Array of extracted content
 */
export function extractHtmlFormatTag(text, tag) {
  // 提取标签名，处理可能的属性
  const tagMatch = tag.match(/<(\w+)(?:\s[^>]*)?>/);
  if (!tagMatch) {
    throw new Error(`无法解析HTML格式标签: ${tag}`);
  }
  const tagName = tagMatch[1];

  const extractedContent = [];
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const matches = [...text.matchAll(regex)];

  matches.forEach(match => {
    if (match[1]) {
      extractedContent.push(match[1].trim());
    }
  });

  // 检查是否有未闭合的标签
  const openTags = (text.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>`, 'gi')) || []).length;
  const closeTags = (text.match(new RegExp(`<\\/${tagName}>`, 'gi')) || []).length;

  if (openTags > closeTags) {
    console.warn(`警告: 发现 ${openTags - closeTags} 个未闭合的 <${tagName}> 标签`);
  }

  return extractedContent;
}

/**
 * Extracts content using simple tag name
 * @param {string} text Text to search in
 * @param {string} tag Simple tag name like "content" or "thinking"
 * @returns {string[]} Array of extracted content
 */
export function extractSimpleTag(text, tag) {
  const extractedContent = [];
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const matches = [...text.matchAll(regex)];

  matches.forEach(match => {
    if (match[1]) {
      extractedContent.push(match[1].trim());
    }
  });

  // 检查是否有未闭合的标签
  const openTags = (text.match(new RegExp(`<${tag}>`, 'gi')) || []).length;
  const closeTags = (text.match(new RegExp(`<\\/${tag}>`, 'gi')) || []).length;

  if (openTags > closeTags) {
    console.warn(`警告: 发现 ${openTags - closeTags} 个未闭合的 <${tag}> 标签`);
  }

  return extractedContent;
}

/**
 * Extracts content using curly brace pipe format
 * @param {string} text Text to search in
 * @param {string} tag Tag name like "outputstory" for format {outputstory|content}
 * @returns {string[]} Array of extracted content
 */
export function extractCurlyBraceTag(text, tag) {
  const extractedContent = [];
  const escapedTag = escapeRegex(tag);

  // Find all starting positions of the target tag
  const startPattern = new RegExp(`\\{${escapedTag}\\|`, 'gi');
  let match;

  while ((match = startPattern.exec(text)) !== null) {
    const startPos = match.index;
    const contentStart = startPos + match[0].length;

    // Find the matching closing brace, accounting for nested braces
    let braceCount = 1;
    let pos = contentStart;

    while (pos < text.length && braceCount > 0) {
      if (text[pos] === '{') {
        braceCount++;
      } else if (text[pos] === '}') {
        braceCount--;
      }
      pos++;
    }

    if (braceCount === 0) {
      // Found the matching closing brace
      const content = text.substring(contentStart, pos - 1);
      if (content.trim()) {
        extractedContent.push(content.trim());
      }
    }

    // Continue searching from after this match
    startPattern.lastIndex = startPos + 1;
  }

  return extractedContent;
}

/**
 * @deprecated
 * Removes curly brace tags from text with proper nesting support
 * @param {string} text Text to process
 * @param {string} tagName Tag name to remove
 * @returns {string} Text with specified tags removed
 */
export function removeCurlyBraceTags(text, tagName) {
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startPattern = new RegExp(`\\{${escapedTag}\\|`, 'gi');
    let result = text;
    let match;

    while ((match = startPattern.exec(result)) !== null) {
        const startPos = match.index;
        const contentStart = startPos + match[0].length;

        // Find the matching closing brace, accounting for nested braces
        let braceCount = 1;
        let pos = contentStart;

        while (pos < result.length && braceCount > 0) {
            if (result[pos] === '{') {
                braceCount++;
            } else if (result[pos] === '}') {
                braceCount--;
            }
            pos++;
        }

        if (braceCount === 0) {
            // Found the matching closing brace, remove the entire tag
            result = result.substring(0, startPos) + result.substring(pos);
            // Reset the regex to start from the beginning
            startPattern.lastIndex = 0;
        } else {
            // No matching closing brace found, stop searching
            break;
        }
    }

    return result;
}
