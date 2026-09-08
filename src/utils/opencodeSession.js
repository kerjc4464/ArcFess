/**
 * OpenCode Go/Zen session helper (ArcFess).
 *
 * 背景: 2026-09-06 起 https://opencode.ai/zen/go/v1/* 强制要求每个 LLM 请求带
 * `x-opencode-session` (稳定会话 ID),缺失直接 HTTP 400 MissingSessionID。
 * 参考 ArcViGil scheduler.py 的 _get_or_create_backend_session_id / _llm_headers 思路,
 * 但判定更严格:仅完整命中 opencode.ai/zen/go/v1 前缀才加头,其他厂商和其他路径原样不动。
 */

const STORAGE_KEY = 'arcfess_opencode_session_id';
const CLIENT_NAME = 'ArcFess';

let _memFallback = null;

function _randomHex12() {
    try {
        const a = new Uint8Array(6);
        (window.crypto || {}).getRandomValues?.(a);
        if (a && (a[0] !== undefined)) {
            return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch { /* fall through */ }
    return Math.random().toString(16).slice(2, 8) + Math.random().toString(16).slice(2, 8).slice(0, 6);
}

function _sanitizeHint(hint) {
    if (hint === undefined || hint === null) return '';
    return String(hint).trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

/**
 * 仅 OpenCode Go 专线端点需要加头,其他一律跳过。
 * 严格限定 https://opencode.ai/zen/go/v1/* :siliconflow/groq/官方端点、
 * 乃至 opencode 自家的 zen/v1 等其他路径都不会触发,绝不影响现有渠道。
 */
const OPENCODE_GO_PREFIX = 'opencode.ai/zen/go/v1';
export function isOpencodeUrl(url) {
    return typeof url === 'string' && url.includes(OPENCODE_GO_PREFIX);
}

/**
 * 持久化兜底 ID: arcfess-{hex12},存 localStorage 复用。
 * 无 localStorage (隐私模式/Node) 时退化为进程内内存单例。
 */
export function getOrCreateOpencodeFallbackId() {
    try {
        const ls = window?.localStorage;
        if (ls) {
            let sid = ls.getItem(STORAGE_KEY);
            if (sid && typeof sid === 'string' && sid.trim()) return sid.trim();
            sid = `arcfess-${_randomHex12()}`;
            try { ls.setItem(STORAGE_KEY, sid); } catch { /* ignore quota */ }
            return sid;
        }
    } catch { /* fall through to memory */ }
    if (!_memFallback) _memFallback = `arcfess-${_randomHex12()}`;
    return _memFallback;
}

/**
 * session 值规则:
 * - 有稳定业务 ID (taskId/记忆单元/测试标签) -> `arcfess-{sanitizedId}`,重试复用保证缓存亲和;
 * - 无 ID 场景 -> 持久化兜底 ID (localStorage),同机复用。
 * 非 opencode 目标返回 undefined,调用方应直接跳过(不污染 payload/headers)。
 */
export function resolveOpencodeSessionId(apiUrl, stableHint) {
    if (!isOpencodeUrl(apiUrl)) return undefined;
    const h = _sanitizeHint(stableHint);
    if (h) return `arcfess-${h}`;
    return getOrCreateOpencodeFallbackId();
}

/** 直连分支用:在原 headers 上仅当命中 Go 专线前缀时追加两个头,不动其他逻辑。 */
export function withOpencodeHeaders(baseHeaders, apiUrl, sessionId) {
    const headers = { ...(baseHeaders || {}) };
    if (!isOpencodeUrl(apiUrl)) return headers;
    const sid = sessionId || getOrCreateOpencodeFallbackId();
    headers['x-opencode-session'] = String(sid);
    headers['x-opencode-client'] = CLIENT_NAME;
    return headers;
}

/** 代理分支用:给 thought_proxy/rerank_proxy 的 JSON body 透传 session_id,仅 Go 专线目标。 */
export function withOpencodeProxyPayload(proxyPayload, apiUrl, sessionId) {
    if (!isOpencodeUrl(apiUrl)) return proxyPayload;
    const sid = sessionId || getOrCreateOpencodeFallbackId();
    proxyPayload.session_id = String(sid);
    return proxyPayload;
}

export const OPENCODE_CLIENT_NAME = CLIENT_NAME;
