/**
 * @fileoverview Rerank 模块统一导出入口（barrel export）。
 *
 * 模块结构:
 *   - RerankService  — 重排序服务主类，封装 API 调用和结果处理逻辑
 *   - RerankConfig    — 重排序配置类，管理 API 端点、模型名、批次大小等参数
 *   - RerankTypes     — TypeScript 风格的 JSDoc 类型定义（@typedef）
 *
 * 使用方式:
 *   import { RerankService, RerankConfig } from './rerank/index.js';
 *   const service = new RerankService(config);
 *   const results = await service.rerank(query, documents);
 *
 * Rerank 的作用:
 *   在向量检索粗筛后对候选结果进行精细排序，使用专用的重排序模型
 *   （如 Cohere Rerank、BGE-Reranker 等）替代简单的余弦相似度排序，
 *   大幅提升检索精度。`TopK` 参数控制最终返回的条数。
 *
 * @module services/rerank
 */
export { RerankService } from './RerankService.js';
export { RerankConfig } from './RerankConfig.js';
export * from './RerankTypes.js';