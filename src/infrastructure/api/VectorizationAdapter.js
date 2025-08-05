/**
 * @file VectorizationAdapter.js
 * @description 向量化 API 适配器，封装所有向量化源的调用
 * @module infrastructure/api/VectorizationAdapter
 */

import { Logger } from '../../utils/Logger.js';

const logger = new Logger('VectorizationAdapter');

/**
 * 向量化 API 适配器类
 * 统一封装不同向量化源的调用接口
 */
export class VectorizationAdapter {
    constructor(dependencies = {}) {
        // 依赖注入
        this.getRequestHeaders = dependencies.getRequestHeaders;
        this.getVectorsRequestBody = dependencies.getVectorsRequestBody;
        this.throwIfSourceInvalid = dependencies.throwIfSourceInvalid;
        this.settings = dependencies.settings;
        this.textgenerationwebui_settings = dependencies.textgenerationwebui_settings;
        this.textgen_types = dependencies.textgen_types;
        
        logger.log('VectorizationAdapter initialized');
    }

    /**
     * 根据当前设置的源执行向量化
     * @param {Array<{text: string, index: number}>} items 要向量化的文本项
     * @param {AbortSignal} signal 可选的中断信号
     * @returns {Promise<Array>} 向量化结果
     */
    async vectorize(items, signal = null) {
        const source = this.settings.source;
        logger.log(`Vectorizing ${items.length} items using source: ${source}`);

        // Use SillyTavern's existing vectorization system via /api/vector/insert
        // This delegates to the server which handles all vectorization internally
        return await this.vectorizeViaSillyTavernAPI(items, signal);
    }


    /**
     * 使用 SillyTavern 原生架构进行向量化
     * 重要：VectorizationProcessor阶段不实际向量化，只准备数据
     * 真正的向量化由Phase 4的storageAdapter.insertVectorItems()处理
     * @private
     */
    async vectorizeViaSillyTavernAPI(items, signal) {
        logger.log('Using SillyTavern native architecture for vectorization');
        logger.log('Note: This is preparation phase - actual vectorization happens in Phase 4');
        
        // 验证源配置
        this.throwIfSourceInvalid();
        
        logger.log(`Preparing ${items.length} items for vectorization`);
        
        try {
            // 验证向量化源是否可用
            const source = this.settings.source;
            if (!source) {
                throw new Error('No vectorization source configured');
            }
            
            // 验证必要的配置
            if (source === 'vllm') {
                if (!this.settings.vllm_url && !this.textgenerationwebui_settings?.server_urls?.[this.textgen_types?.VLLM]) {
                    throw new Error('vLLM URL not configured');
                }
                if (!this.settings.vllm_model) {
                    throw new Error('vLLM model not specified');
                }
            }
            
            logger.log('Vectorization configuration validated successfully');
            logger.log('Configuration details:', {
                source: source,
                itemCount: items.length
            });
            
            // 准备向量化项目 - 格式化为storageAdapter.insertVectorItems()期望的格式
            const result = {
                success: true,
                items: items.map((item, index) => {
                    // Debug first item
                    if (index === 0) {
                        logger.log('First item metadata before mapping:', {
                            originalMetadata: item.metadata,
                            hasOriginalIndex: item.metadata?.originalIndex !== undefined,
                            originalIndex: item.metadata?.originalIndex
                        });
                    }
                    
                    const mappedItem = {
                        // 保持SillyTavern insertVectorItems需要的格式
                        text: item.text,
                        hash: item.hash || this.generateHash(item.text),
                        index: item.index !== undefined ? item.index : index,
                        metadata: {
                            ...(item.metadata || {}),
                            vectorization_source: source,
                            prepared_at: new Date().toISOString(),
                            // 保持原始类型信息
                            originalType: item.type || 'unknown',
                            originalId: item.id || `item_${index}`
                        }
                    };
                    
                    // Debug first mapped item
                    if (index === 0) {
                        logger.log('First item metadata after mapping:', {
                            mappedMetadata: mappedItem.metadata,
                            hasOriginalIndex: mappedItem.metadata?.originalIndex !== undefined,
                            originalIndex: mappedItem.metadata?.originalIndex
                        });
                    }
                    
                    return mappedItem;
                })
            };
            
            logger.log(`Vectorization preparation completed for ${result.items.length} items`);
            logger.log('Items prepared for Phase 4 vectorization:', result.items.map(item => ({
                textLength: item.text?.length,
                hasText: !!item.text,
                type: item.metadata?.originalType
            })));
            
            return result;
            
        } catch (error) {
            logger.error('Vectorization preparation failed:', error);
            throw error;
        }
    }
    
    /**
     * 生成文本哈希值
     * @private
     */
    generateHash(text) {
        if (!text) return 0;
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }

    /**
     * 获取支持的向量化源列表
     * @returns {Array<string>} 支持的源
     */
    getSupportedSources() {
        return ['transformers', 'ollama', 'vllm', 'webllm', 'openai', 'cohere'];
    }

    /**
     * 检查指定的源是否可用
     * @param {string} source 向量化源
     * @returns {Promise<boolean>} 是否可用
     */
    async checkSourceAvailability(source) {
        try {
            switch (source) {
                case 'transformers':
                    // 检查本地模型是否已加载
                    return !!this.settings.local_model;
                
                case 'ollama':
                    // 检查 Ollama 服务是否运行
                    const ollamaUrl = this.settings.ollama_url || 
                        this.textgenerationwebui_settings?.server_urls?.[this.textgen_types?.OLLAMA] || 
                        'http://localhost:11434';
                    const response = await fetch(`${ollamaUrl}/api/tags`, { method: 'GET' });
                    return response.ok;
                
                case 'vllm':
                    // 检查 vLLM 服务
                    return !!(this.settings.vllm_url && this.settings.vllm_model);
                
                case 'webllm':
                    // 检查 WebLLM 是否已加载
                    return !!(window.webllm && window.webllm.embedder);
                
                case 'openai':
                    // 检查 OpenAI API 密钥
                    return !!this.settings.openai_api_key;
                
                case 'cohere':
                    // 检查 Cohere API 密钥
                    return !!this.settings.cohere_api_key;
                
                default:
                    return false;
            }
        } catch (error) {
            logger.error(`Error checking availability for ${source}:`, error);
            return false;
        }
    }

    /**
     * 获取向量化批次大小建议
     * @param {string} source 向量化源
     * @returns {number} 建议的批次大小
     */
    getBatchSizeRecommendation(source) {
        switch (source) {
            case 'transformers':
                return 50;  // 本地模型可以处理较大批次
            case 'ollama':
                return 20;  // Ollama 根据模型性能调整
            case 'vllm':
                return 30;  // vLLM 可以处理中等批次
            case 'webllm':
                return 1;   // WebLLM 通常需要逐个处理
            case 'openai':
                return 100; // OpenAI API 有较高的批次限制
            case 'cohere':
                return 96;  // Cohere 的官方批次限制
            default:
                return 10;  // 保守的默认值
        }
    }
}