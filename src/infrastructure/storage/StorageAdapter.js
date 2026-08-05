// @ts-nocheck
/**
 * Arc Custom Storage Adapter (V2.4 Task-Aware Edition)
 * 最终完全体：修复了 TaskID 注入、删除逻辑和缓存清理
 */

export class StorageAdapter {
    constructor(dependencies = {}) {
        this.getVectorsRequestBody = dependencies.getVectorsRequestBody;
        this.getRequestHeaders = dependencies.getRequestHeaders;
        this.baseUrl = `http://${window.location.hostname}:8999`;
        this.isConnected = false;
        // 获取缓存引用，如果没有传则新建一个 Map 防止报错
        this.cachedVectors = dependencies.cachedVectors || new Map();
        console.log(`[TsukiHana] V2.4 存储适配器已加载 | 目标: ${this.baseUrl}`);
    }

    async init() {
        try {
            const response = await fetch(`${this.baseUrl}/status`);
            if (!response.ok) throw new Error('Server returned error');
            const data = await response.json();
            this.isConnected = true;
            this.embeddingDim = data.dim || 1024; // 保存维度！
            console.log(`%c[TsukiHana] 核心在线 ✅ | 记忆: ${data.count} | 维度: ${data.dim || '自动'}`, 'color: #00ff00; background: #000; padding: 4px;');
            return true;
        } catch (error) {
            console.error('[TsukiHana] ❌ 连接失败:', error);
            if (typeof toastr !== 'undefined') toastr.error('Arc V2 服务离线', 'Memory Offline');
            return false;
        }
    }

    // === 虚拟文件列表 ===
    async listFiles() {
        try {
            const response = await fetch(`${this.baseUrl}/collections`);
            if (!response.ok) return [];
            const data = await response.json();
            return data.collections.map(col => ({
                name: col.name, 
                size: col.count * 1024, 
                date: Date.now()
            }));
        } catch (err) {
            console.error('[TsukiHana] 获取集合列表失败:', err);
            return [];
        }
    }

    // === 获取集合中所有的 ID 列表 (用于实时增量同步) ===
    async getCollectionIds(collectionId) {
        if (!collectionId) return [];
        try {
            const response = await fetch(`${this.baseUrl}/collection_ids`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collection_id: collectionId })
            });
            if (!response.ok) return [];
            const data = await response.json();
            return data.ids || [];
        } catch (err) {
            console.error(`[TsukiHana] 获取集合 ${collectionId} 的 IDs 失败:`, err);
            return [];
        }
    }

    async query(vector, k = 5, explicitCollections = null) {
        try {
            let allowedCollections = [];
            if (explicitCollections && explicitCollections.length > 0) {
                allowedCollections = explicitCollections;
                if (!allowedCollections.includes('global')) allowedCollections.push('global');
            } else {
                // @ts-ignore
                const context = window.SillyTavern.getContext();
                if (context.chatId) {
                    allowedCollections.push(context.chatId);
                    allowedCollections.push(`rt_${context.chatId}`);
                }
                if (context.characterId) allowedCollections.push(context.characterId);
                allowedCollections.push('global');
            }

            const response = await fetch(`${this.baseUrl}/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vector, k, collections: allowedCollections })
            });
            
            if (!response.ok) throw new Error('Query failed');
            const data = await response.json();
            return { items: data.results || [] };
        } catch (err) {
            console.error('[TsukiHana] Query Error:', err);
            return { items: [] };
        }
    }

    // === 核心方法：按 TaskID 物理删除 ===
    async deleteTask(taskId) {
        if (!taskId) return false;
        try {
            console.log(`[Storage] Requesting deletion for task: ${taskId}`);
            const response = await fetch(`${this.baseUrl}/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // 发送 filter 指令给后端 (需要配合后端 V7.1 更新)
                body: JSON.stringify({ filter: { taskId: taskId } })
            });
            
            if (!response.ok) throw new Error('Delete failed');
            const result = await response.json();
            console.log(`[Storage] Deleted ${result.deleted} memories for task ${taskId}`);
            return true;
        } catch (err) { 
            console.error("[Storage] Delete Task Error:", err);
            return false; 
        }
    }

    // 旧的删除方法 (保留兼容)
    async delete(ids) {
        if (!ids || ids.length === 0) return true;
        try {
            const response = await fetch(`${this.baseUrl}/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: ids })
            });
            if (!response.ok) throw new Error('Delete failed');
            return true;
        } catch (err) { return false; }
    }

    // === 清理逻辑升级 ===
    // 优先尝试从 collectionId 中提取 taskId 进行删除
    async purgeVectorIndex(collectionId) {
        // 1. 尝试识别 taskId (从最后一个 _task_ 处分割，避免 chatId 中包含 _task_ 的误判)
        if (collectionId && collectionId.includes('_task_')) {
            const lastIdx = collectionId.lastIndexOf('_task_');
            if (lastIdx > 0) {
                const taskId = collectionId.substring(lastIdx + 1);
                console.log(`[Storage] Purge 升级: 正在调用 deleteTask(${taskId})`);
                return await this.deleteTask(taskId);
            }
        }

        // 2. 回退到集合清空 (后端 V7.1 的 /purge 现已可用)
        if (!collectionId) return false;
        try {
            const response = await fetch(`${this.baseUrl}/purge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collection_id: collectionId })
            });
            if (!response.ok) throw new Error('Purge failed');
            const result = await response.json();
            console.log(`[Storage] Purged collection ${collectionId}: ${result.deleted} items`);
            if (typeof toastr !== 'undefined') toastr.success(`已清空集合 ${collectionId}`);
            return true;
        } catch (err) { 
            console.error("[Storage] Purge Failed:", err);
            return false; 
        }
    }

    // === 核心方法：插入时注入 TaskID ===
    async insertVectorItems(collectionId, items, signal, options) {
        if (!items || items.length === 0) return;
        try {
            const config = this.getVectorsRequestBody ? this.getVectorsRequestBody() : {};
            const texts = items.map(i => i.text);
            
            // 获取 TaskID (关键修复!)
            const taskId = options?.taskId; 

            let vectors = [];
            
            if (config.source === 'vllm' || config.source === 'openai') {
                vectors = await this._fetchOpenAIEmbeddings(texts, config, signal);
            } else if (config.source === 'ollama') {
                vectors = await this._fetchOllamaEmbeddings(texts, config, signal);
            } else {
                throw new Error(`不支持的向量源: ${config.source}`);
            }

            const payloadItems = items.map((item, idx) => ({
                id: item.metadata?.uid || `${Date.now()}_${idx}`,
                text: item.text,
                // === 注入点：确保 metadata 包含 taskId ===
                metadata: {
                    ...(item.metadata || {}),
                    taskId: taskId, // 注入！
                    timestamp: Date.now()
                },
                vector: vectors[idx],
                collection_id: collectionId || 'global'
            }));

            await this.insert(payloadItems);
        } catch (err) {
            console.error('[TsukiHana] 批量向量化失败:', err);
            if (typeof toastr !== 'undefined') toastr.error(`向量化失败: ${err.message}`);
            throw err;
        }
    }

    async queryCollection(collectionId, queryText, limit, threshold) {
        try {
            const config = this.getVectorsRequestBody ? this.getVectorsRequestBody() : {};
            if (!config.source) return { items: [] };
            let vectors = [];
            if (config.source === 'vllm' || config.source === 'openai') {
                 vectors = await this._fetchOpenAIEmbeddings([queryText], config);
            } else if (config.source === 'ollama') {
                 vectors = await this._fetchOllamaEmbeddings([queryText], config);
            }
            if (vectors.length > 0) {
                return this.query(vectors[0], limit, [collectionId]);
            }
            return { items: [] };
        } catch (e) {
            return { items: [] };
        }
    }

    async queryMultipleCollections(collectionIds, queryText, limit, threshold) {
        try {
            const config = this.getVectorsRequestBody ? this.getVectorsRequestBody() : {};
            if (!config.source) return { items: [] };
            
            let vectors = [];
            if (config.source === 'vllm' || config.source === 'openai') {
                 vectors = await this._fetchOpenAIEmbeddings([queryText], config);
            } else if (config.source === 'ollama') {
                 vectors = await this._fetchOllamaEmbeddings([queryText], config);
            }
            
            if (vectors.length > 0) {
                // 直接将 collectionIds 数组传递给底层 query，实现单次并发检索
                return this.query(vectors[0], limit, collectionIds);
            }
            return { items: [] };
        } catch (e) {
            console.error('[TsukiHana] queryMultipleCollections 失败:', e);
            return { items: [] };
        }
    }

    /**
     * BM25 关键词检索（通过后端 FTS5）
     * @param {string} text - 查询文本
     * @param {number} limit - 返回结果数
     * @param {string[]} collections - 限定的 collection 列表
     * @returns {Promise<{items: Array}>}
     */
    async hybridQuery(text, limit = 10, collections = null, options = {}) {
        try {
            const allowedCollections = collections || [];
            const response = await fetch(`${this.baseUrl}/hybrid_query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    k: limit,
                    collections: allowedCollections,
                    k1: options.k1,
                    b: options.b,
                    min_score: options.min_score
                })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            return { items: data.results || [], debug: data.debug || null };
        } catch (e) {
            console.error('[TsukiHana] hybridQuery 失败:', e);
            return { items: [], debug: null };
        }
    }

    async _fetchOpenAIEmbeddings(texts, config, signal) {
        const apiUrl = config.apiUrl || config.vllm_url;
        const endpoint = apiUrl.endsWith('/v1') ? `${apiUrl}/embeddings` : 
                         apiUrl.endsWith('/') ? `${apiUrl}v1/embeddings` : `${apiUrl}/v1/embeddings`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey || 'sk-xxxx'}` },
            body: JSON.stringify({ input: texts, model: config.model }),
            signal
        });
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()).data.map(item => item.embedding);
    }
    
    async _fetchOllamaEmbeddings(texts, config, signal) {
        const apiUrl = config.apiUrl || 'http://localhost:11434';
        const vectors = [];
        for (const text of texts) {
            const response = await fetch(`${apiUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: config.model, prompt: text }),
                signal
            });
            if (!response.ok) throw new Error('Ollama Error');
            vectors.push((await response.json()).embedding);
        }
        return vectors;
    }

    async insert(entry) {
        const entries = Array.isArray(entry) ? entry : [entry];
        const BATCH_SIZE = 10;
        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
            const chunk = entries.slice(i, i + BATCH_SIZE);
            await Promise.all(chunk.map(item => fetch(`${this.baseUrl}/insert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            })));
        }
    }

    async clear() { return true; }
    async count() { try { return (await (await fetch(`${this.baseUrl}/status`)).json()).count; } catch { return 0; } }

    /**
     * 获取后端真实存在的任务列表
     * @returns {Promise<Set<string>>} 后端有数据的 taskId 集合
     */
    async getActiveTasks() {
        try {
            const response = await fetch(`${this.baseUrl}/tasks_stats`);
            if (!response.ok) throw new Error('Failed to fetch tasks_stats');
            const data = await response.json();
            if (!data.tasks || !Array.isArray(data.tasks)) return new Set();
            const taskIds = new Set(data.tasks.map(t => t.taskId));
            console.log(`[Storage] Backend reports ${taskIds.size} active task(s)`);
            return taskIds;
        } catch (err) {
            console.error('[Storage] getActiveTasks failed:', err);
            return null; // null 表示后端离线或出错，调用方应跳过清理
        }
    }

    async getCollectionMemories(collectionId) {
        if (!collectionId) return [];
        try {
            const response = await fetch(`${this.baseUrl}/get_collection_memories`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collection_id: collectionId })
            });
            if (!response.ok) return [];
            const data = await response.json();
            return data.memories || [];
        } catch (err) {
            console.error(`[Storage] getCollectionMemories 失败:`, err);
            return [];
        }
    }

    async updateMetadata(id, metadata) {
        if (!id || !metadata) return false;
        try {
            const response = await fetch(`${this.baseUrl}/update_metadata`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, metadata })
            });
            return response.ok;
        } catch (err) {
            console.error(`[Storage] updateMetadata 失败:`, err);
            return false;
        }
    }
}