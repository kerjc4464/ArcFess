"""
CORS 免疫反代网关——为浏览器前端提供无障碍的跨域 API 代理。

问题背景:
    运行在浏览器中的 HTML/JS 前端（如 ArcFess_FlowLab.html）受到
    同源策略的限制，无法直接向运行在 127.0.0.1 的本地 API 服务发起跨域请求。
    (file:// 协议页面向 http://localhost 发请求会被 CORS 阻止)

解决方案:
    此 Flask 代理在响应中强行注入 CORS 头（Access-Control-Allow-Origin: *），
    使任意来源（包括 file:// 协议打开的 HTML）都能无障碍调用代理。

端口说明:
    - 代理监听端口: 9000（前端请求此端口，路径为 /v1beta/openai/chat/completions）
    - 上游服务端口: 7861（实际 API 目标地址，在此示例中是 ArcFess 向量后端）

配置注意:
    如果 Jc-Server 需要挂系统代理才能访问外部 API，请确保系统代理已开启，
    或者在 requests.post() 中添加 proxies 参数。

使用方式:
    python cors_breaker.py
"""

from flask import Flask, request, Response
import requests
import os
import uuid

app = Flask(__name__)

# --- OpenCode Go/Zen 会话头集中注入 (与其他后端保持一致) ---
# 仅当转发目标命中 opencode.ai/zen/go/v1 时加 x-opencode-session + x-opencode-client: ArcFess,其他原样。
# session 优先用前端透传: JSON body.session_id > 请求头 x-opencode-session;缺失时用本文件旁持久化兜底。
_OPENCODE_SESSION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.opencode_session_id')
_opencode_session_cache = None

def _get_or_create_opencode_session_id():
    global _opencode_session_cache
    if _opencode_session_cache:
        return _opencode_session_cache
    try:
        if os.path.isfile(_OPENCODE_SESSION_FILE):
            with open(_OPENCODE_SESSION_FILE, 'r', encoding='utf-8') as f:
                sid = (f.read() or '').strip()
                if sid:
                    _opencode_session_cache = sid
                    return sid
    except Exception:
        pass
    sid = f"arcfess-{uuid.uuid4().hex[:12]}"
    try:
        with open(_OPENCODE_SESSION_FILE, 'w', encoding='utf-8') as f:
            f.write(sid)
    except Exception:
        pass
    _opencode_session_cache = sid
    return sid

_OPENCODE_GO_PREFIX = 'opencode.ai/zen/go/v1'

def _apply_opencode_headers(upstream_headers, target_url, session_id=None):
    try:
        if target_url and _OPENCODE_GO_PREFIX in str(target_url):
            sid = (str(session_id).strip() if session_id else '') or _get_or_create_opencode_session_id()
            upstream_headers['x-opencode-session'] = str(sid)
            upstream_headers['x-opencode-client'] = 'ArcFess'
    except Exception:
        pass
    return upstream_headers

def add_cors_headers(response):
    """
    为每一个响应注入 CORS 通行证——在响应头中加入跨域许可声明。
    
    使用 Flask 的 after_request 钩子自动应用到所有响应，
    确保 OPTIONS 预检请求和正常的 POST 请求都能获得 CORS 头。
    
    注入的响应头:
        Access-Control-Allow-Origin: '*'            → 允许任意来源访问
        Access-Control-Allow-Methods: 'GET, POST, ...' → 允许全部常用 HTTP 方法
        Access-Control-Allow-Headers: '*'            → 允许任意自定义请求头
    """
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, PUT, DELETE'
    response.headers['Access-Control-Allow-Headers'] = '*'
    return response

# 注册全局 CORS 钩子——每个响应都会经过此函数处理
app.after_request(add_cors_headers)

@app.route('/v1beta/openai/chat/completions', methods=['POST', 'OPTIONS'])
def proxy_gemini():
    """
    代理端点——接收前端请求，转发到上游 API，将响应原封不动返回给前端。
    
    路由: POST /v1beta/openai/chat/completions
    处理流程:
        1. OPTIONS 预检请求 → 直接返回 200（CORS 头已由 after_request 注入）
        2. POST 正式请求 → 转发到上游服务 → 清洗响应头 → 返回给前端
    
    请求头清洗:
        移除 Host 头以避免与上游服务的主机名冲突。
        
    响应头清洗:
        移除 content-encoding、transfer-encoding 等传输层标记，
        防止 Flask 和 requests 之间的传输层冲突导致数据截断或乱码。
    """
    # 浏览器的 CORS 预检请求（Preflight）——不转发，直接放行
    if request.method == 'OPTIONS':
        return Response(status=200)

    # === 上游服务地址 ===
    # 默认指向本地 ArcFess 向量服务器（端口 7861）
    # 如需修改：替换为你的实际 API 地址
    target_url = "http://127.0.0.1:7861/v1"

    # 清洗请求头，移除可能造成转发的 Host 头
    # 如果保留原始 Host，上游服务可能因主机名不匹配而拒绝请求
    headers = {key: value for key, value in request.headers if key.lower() != 'host'}

    # OpenCode Go/Zen 集中加头:本网关默认目标为本地 127.0.0.1:7861,条件恒为假(注明跳过);
    # 若未来目标改为 opencode.ai 则自动生效。session 优先取透传的 body.session_id / 原请求头。
    try:
        _body_sid = None
        try:
            _body_json = request.get_json(silent=True) or {}
            _body_sid = _body_json.get('session_id')
        except Exception:
            _body_sid = None
        _hdr_sid = request.headers.get('x-opencode-session') or request.headers.get('X-Opencode-Session')
        _apply_opencode_headers(headers, target_url, _body_sid or _hdr_sid)
    except Exception:
        pass

    try:
        # 发出代理请求（同步，30 秒超时）
        # 如果你的 Jc-Server 需要挂系统级代理才能访问谷歌，请确保系统代理已开启，
        # 或者在代码里显式指定 proxies 参数
        resp = requests.post(
            target_url,
            headers=headers,
            data=request.get_data(),
            timeout=30
        )

        # 清洗返回头——剔除可能导致传输截断的底层标记:
        #   content-encoding   → 压缩编码，Flask 会自动处理，透传可能导致双重压缩
        #   content-length      → body 长度，Flask 会重新计算，透传可能导致截断
        #   transfer-encoding   → 分块传输标记，Flask 自行管理
        #   connection          → Keep-Alive 状态，不适合代理转发
        excluded_headers = ['content-encoding', 'content-length', 'transfer-encoding', 'connection']
        proxy_headers = [
            (name, value) for (name, value) in resp.raw.headers.items()
            if name.lower() not in excluded_headers
        ]

        # 将上游的响应原封不动返回给前端（状态码、响应体、清洗后的头）
        return Response(resp.content, resp.status_code, proxy_headers)

    except Exception as e:
        # 网络中断或上游服务不可达时返回 502 Bad Gateway
        print(f"反代转发时发生物理断线: {str(e)}")
        return Response(f'{{"error": "{str(e)}"}}', status=502, mimetype='application/json')

if __name__ == '__main__':
    print(">>> ArcFess 跨域免疫反代网关已启动 <<<")
    print(">>> 监听端口: 9000 <<<")
    # 0.0.0.0 允许局域网内的所有设备访问此代理
    # 如需限制仅本地访问，改为 host='127.0.0.1'
    app.run(host='0.0.0.0', port=9000)