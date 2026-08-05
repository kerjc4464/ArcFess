import flask
from flask import request, jsonify, Response
import sqlite3
import numpy as np
import json
import os
import time
import sys
import threading
import logging
import signal
import requests
import urllib.parse
import socket
import ipaddress
from datetime import datetime

# === 尝试加载依赖 ===
try:
    from waitress import serve
except ImportError:
    print("Error: 未安装 waitress。请运行: pip install waitress")
    sys.exit(1)

try:
    import faiss
except ImportError:
    print("Error: 未安装 faiss。请运行: pip install faiss-cpu")
    sys.exit(1)

# === Windows 控制台编码与缓冲修复 ===
if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')

# === 日志配置 ===
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(message)s',
    datefmt='%H:%M:%S',
    handlers=[logging.StreamHandler(sys.stdout)],
    force=True
)
logger = logging.getLogger("ArcFess")

app = flask.Flask(__name__)

# ================= 配置区 =================
DB_PATH = 'vectors.db'
PORT = 8999
# =========================================

# === ArcFess 长连接池引擎 ===
local_data = threading.local()
faiss_index = None 
embedding_dim = 0
faiss_lock = threading.Lock()
HAS_JSON1 = False  # SQLite 是否支持 JSON1 扩展（用于 taskId 索引查询）

def get_db_connection():
    """获取或初始化当前线程的永久数据库连接"""
    if not hasattr(local_data, "conn"):
        conn = sqlite3.connect(DB_PATH, timeout=15.0, check_same_thread=False)
        c = conn.cursor()
        c.execute("PRAGMA journal_mode=WAL;")
        c.execute("PRAGMA synchronous=NORMAL;")
        c.execute("PRAGMA cache_size=-8192;") # 每线程 8MB 缓存
        c.execute("PRAGMA temp_store=FILE;")
        c.execute("PRAGMA mmap_size=33554432;") # 32MB 内存映射
        local_data.conn = conn
    return local_data.conn

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

def normalize_vector(v):
    norm = np.linalg.norm(v)
    if norm == 0: return v
    return v / norm

# v7.1: 白名单主机名/IP，允许 thought_proxy 转发到这些受信任的本地服务
ALLOWED_PRIVATE_HOSTS = {'127.0.0.1', 'localhost', '::1'}

def _is_private_url(url):
    """检查 URL 是否直接指向私有/保留 IP 地址，防止 SSRF（域名不再做 DNS 解析拦截，避免 OpenClash 等环境误杀）"""
    try:
        parsed = urllib.parse.urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            return True

        # 白名单检查：显式信任的本地地址放行
        if hostname in ALLOWED_PRIVATE_HOSTS:
            return False

        # 只对直接传入的 IP 地址做私网检查（域名一律放行）
        try:
            ip = ipaddress.ip_address(hostname)
            return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved
        except ValueError:
            return False  # 不是 IP，是域名，直接放行

    except Exception:
        return False

def init_db():
    global HAS_JSON1
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('PRAGMA journal_mode=WAL;')
    c.execute('''CREATE TABLE IF NOT EXISTS memories
                 (rowid INTEGER PRIMARY KEY AUTOINCREMENT,
                  id TEXT UNIQUE, 
                  text TEXT, 
                  metadata TEXT, 
                  vector BLOB, 
                  timestamp REAL, 
                  collection_id TEXT)''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_collection ON memories(collection_id)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_ext_id ON memories(id)')
    
    # 尝试创建 JSON1 表达式索引（用于 taskId 快速查询）
    try:
        c.execute("CREATE INDEX IF NOT EXISTS idx_task_id ON memories(json_extract(metadata, '$.taskId'))")
        HAS_JSON1 = True
        logger.info(">>> [DB] JSON1 extension available, task_id index created")
    except Exception as e:
        HAS_JSON1 = False
        logger.warning(f">>> [DB] JSON1 extension not available, falling back to full scan: {e}")
    
    conn.commit()
    conn.close()

def _ensure_indexes():
    """确保 JSON1 索引已创建（兼容旧数据库升级）"""
    global HAS_JSON1
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("CREATE INDEX IF NOT EXISTS idx_task_id ON memories(json_extract(metadata, '$.taskId'))")
        HAS_JSON1 = True
        logger.info(">>> [DB] JSON1 extension available, task_id index ensured")
        conn.commit()
        conn.close()
    except Exception as e:
        HAS_JSON1 = False
        logger.warning(f">>> [DB] JSON1 extension not available: {e}")

def load_index():
    global faiss_index, embedding_dim
    logger.info(">>> [System] 正在初始化 ArcFess 向量引擎 (Faiss FP32)...")
    
    if not os.path.exists(DB_PATH): 
        init_db()
    else:
        # 确保索引已创建（兼容旧数据库）
        _ensure_indexes()
    
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT vector FROM memories LIMIT 1")
    row = c.fetchone()
    
    if row:
        vec_sample = np.frombuffer(row[0], dtype=np.float32)
        embedding_dim = vec_sample.shape[0]
        logger.info(f">>> [Init] 维度锁定: {embedding_dim}")
    else:
        logger.info(">>> [Init] 库是空的，等待记忆灌入...")
        embedding_dim = 0
        return

    quantizer = faiss.IndexFlatL2(embedding_dim) 
    faiss_index = faiss.IndexIDMap(quantizer)

    logger.info(">>> [Loader] 开始从硬盘分块装载数据以节省内存...")
    c.execute("SELECT rowid, vector FROM memories")

    count = 0
    batch_size = 2000  # 每次仅读取2000条，保护Jc-Server的内存底线

    while True:
        rows = c.fetchmany(batch_size)
        if not rows:
            break

        ids_list = []
        vecs_list = []

        for r in rows:
            ids_list.append(r[0])
            vecs_list.append(np.frombuffer(r[1], dtype=np.float32))

        if ids_list:
            vecs_np = np.vstack(vecs_list)
            ids_np = np.array(ids_list, dtype=np.int64)
            faiss_index.add_with_ids(vecs_np, ids_np)
            count += len(ids_list)

        # 阅后即焚：立刻销毁当前批次的临时变量，切断内存占用的锁链
        del rows, ids_list, vecs_list, vecs_np, ids_np

    import gc
    gc.collect()  # 召唤垃圾回收机制，彻底清扫战场

    logger.info(f">>> [System] 引擎就绪。当前记忆总数: {count} 条")

# ================= 核心接口区 =================

@app.route('/insert', methods=['POST', 'OPTIONS'])
def insert():
    if request.method == 'OPTIONS': return jsonify({}), 200
    global faiss_index, embedding_dim
    t_start = time.time()
    
    try:
        data = request.json
        uid = data.get('id')
        text = data.get('text')
        meta = data.get('metadata') 
        vec_list = data.get('vector')
        col_id = data.get('collection_id', 'global') 

        if not vec_list or not uid: return jsonify({"error": "Missing data"}), 400

        input_dim = len(vec_list)
        
        with faiss_lock:
            if embedding_dim == 0:
                embedding_dim = input_dim
                quantizer = faiss.IndexFlatL2(embedding_dim) 
                faiss_index = faiss.IndexIDMap(quantizer)
            elif input_dim != embedding_dim:
                logger.error(f"Dimension Mismatch: Expected {embedding_dim}, Got {input_dim}")
                return jsonify({"error": "Dimension mismatch"}), 400

        vec_np = np.array(vec_list, dtype=np.float32)
        vec_np = normalize_vector(vec_np)
        vec_blob = vec_np.tobytes()

        conn = get_db_connection()
        c = conn.cursor()
        meta_str = json.dumps(meta, ensure_ascii=False) if isinstance(meta, dict) else "{}"
        
        c.execute("SELECT rowid FROM memories WHERE id = ?", (uid,))
        exist_row = c.fetchone()
        
        action_type = "NEW"
        if exist_row:
            rowid = exist_row[0]
            c.execute("UPDATE memories SET text=?, metadata=?, vector=?, timestamp=?, collection_id=? WHERE rowid=?",
                      (text, meta_str, vec_blob, time.time(), col_id, rowid))
            action_type = "UPD"
        else:
            c.execute("INSERT INTO memories (id, text, metadata, vector, timestamp, collection_id) VALUES (?, ?, ?, ?, ?, ?)",
                      (uid, text, meta_str, vec_blob, time.time(), col_id))
            rowid = c.lastrowid

        conn.commit()

        with faiss_lock:
            if exist_row:
                faiss_index.remove_ids(np.array([rowid], dtype=np.int64))
            faiss_index.add_with_ids(vec_np.reshape(1, -1), np.array([rowid], dtype=np.int64))

        logger.info(f"[{action_type}] ID:{uid} | Time:{time.time()-t_start:.3f}s")
        return jsonify({"status": "ok", "id": uid})
    except Exception as e:
        logger.error(f"Insert Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/query', methods=['POST', 'OPTIONS'])
def query():
    if request.method == 'OPTIONS': return jsonify({}), 200
    global faiss_index
    t_start = time.time()
    
    try:
        data = request.json
        query_vec_list = data.get('vector')
        top_k = data.get('k', 5)
        allowed_cols = data.get('collections', []) 

        if faiss_index is None or faiss_index.ntotal == 0: 
            return jsonify({"results": []})

        query_vec = np.array(query_vec_list, dtype=np.float32)
        query_vec = normalize_vector(query_vec)
        
        search_k = top_k * 10 if allowed_cols else top_k
        if search_k > faiss_index.ntotal: search_k = faiss_index.ntotal
        
        t_faiss_start = time.time()
        scores, ids = faiss_index.search(query_vec.reshape(1, -1), search_k)
        t_faiss_end = time.time()
        
        found_ids = ids[0]
        found_scores = scores[0]
        
        results = []
        if len(found_ids) > 0:
            valid_mask = found_ids != -1
            valid_ids = found_ids[valid_mask]
            valid_scores = found_scores[valid_mask]
            
            if len(valid_ids) > 0:
                conn = get_db_connection()
                c = conn.cursor()
                placeholders = ','.join('?' * len(valid_ids))
                c.execute(f"SELECT rowid, id, text, metadata, timestamp, collection_id FROM memories WHERE rowid IN ({placeholders})", valid_ids.tolist())
                rows = c.fetchall()
                
                row_map = {r[0]: r for r in rows}
                
                for i, rid in enumerate(valid_ids):
                    if rid in row_map:
                        r = row_map[rid]
                        col_id = r[5]
                        if allowed_cols and col_id not in allowed_cols: continue 
                        
                        results.append({
                            "id": r[1],      
                            "text": r[2],
                            "metadata": json.loads(r[3]) if r[3] else {},
                            "score": float(valid_scores[i]), 
                            "timestamp": r[4],
                            "collection_id": col_id
                        })
                        if len(results) >= top_k: break

        total_time = time.time() - t_start
        logger.info(f"Query Complete | Results:{len(results)} | Faiss:{t_faiss_end-t_faiss_start:.4f}s | Total:{total_time:.4f}s")
        return jsonify({"results": results})
    except Exception as e:
        logger.error(f"Query Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/delete', methods=['POST', 'OPTIONS'])
def delete():
    if request.method == 'OPTIONS': return jsonify({}), 200
    global faiss_index
    try:
        data = request.json
        ids_to_delete = data.get('ids', []) 
        filter_criteria = data.get('filter', {}) 
        
        rowids_to_remove = []
        conn = get_db_connection()
        c = conn.cursor()

        if ids_to_delete:
            placeholders = ','.join('?' * len(ids_to_delete))
            c.execute(f"SELECT rowid FROM memories WHERE id IN ({placeholders})", ids_to_delete)
            rows = c.fetchall()
            rowids_to_remove.extend([r[0] for r in rows])

        if filter_criteria and 'taskId' in filter_criteria:
            target_task_id = filter_criteria['taskId']
            if HAS_JSON1:
                # 使用 JSON1 索引快速定位（避免全表扫描）
                c.execute("SELECT rowid FROM memories WHERE json_extract(metadata, '$.taskId') = ?", (target_task_id,))
                rows = c.fetchall()
                rowids_to_remove.extend([r[0] for r in rows])
            else:
                # 回退到旧逻辑（全表扫描）
                c.execute("SELECT rowid, metadata FROM memories")
                all_rows = c.fetchall()
                for r in all_rows:
                    try:
                        meta_str = r[1]
                        if meta_str and f'"{target_task_id}"' in meta_str: 
                             meta = json.loads(meta_str)
                             if meta.get('taskId') == target_task_id:
                                 rowids_to_remove.append(r[0])
                    except: continue
        
        rowids_to_remove = list(set(rowids_to_remove))

        if rowids_to_remove:
            with faiss_lock: 
                faiss_index.remove_ids(np.array(rowids_to_remove, dtype=np.int64))
            
            batch_size = 900
            for i in range(0, len(rowids_to_remove), batch_size):
                batch = rowids_to_remove[i:i+batch_size]
                placeholders = ','.join('?' * len(batch))
                c.execute(f"DELETE FROM memories WHERE rowid IN ({placeholders})", batch)
            
            conn.commit()
            logger.info(f"Deleted {len(rowids_to_remove)} memories")
        return jsonify({"status": "ok", "deleted": len(rowids_to_remove)})
    except Exception as e:
        logger.error(f"Delete Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/purge', methods=['POST', 'OPTIONS'])
def purge():
    if request.method == 'OPTIONS': return jsonify({}), 200
    global faiss_index
    data = request.json
    col_id = data.get('collection_id')
    if not col_id: return jsonify({"error": "Missing collection_id"}), 400
    
    try:
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT rowid FROM memories WHERE collection_id = ?", (col_id,))
        rows = c.fetchall()
        rowids_to_remove = [r[0] for r in rows]
        
        if rowids_to_remove:
            with faiss_lock:
                faiss_index.remove_ids(np.array(rowids_to_remove, dtype=np.int64))
            
            batch_size = 900
            for i in range(0, len(rowids_to_remove), batch_size):
                batch = rowids_to_remove[i:i+batch_size]
                placeholders = ','.join('?' * len(batch))
                c.execute(f"DELETE FROM memories WHERE rowid IN ({placeholders})", batch)
            
            conn.commit()
            logger.info(f"Purged collection: {col_id} ({len(rowids_to_remove)} items)")
        
        return jsonify({"status": "ok", "deleted": len(rowids_to_remove)})
    except Exception as e:
        logger.error(f"Purge Error: {e}")
        return jsonify({"error": str(e)}), 500

# v7.1: 全局 Session 用于 thought_proxy，提升连接复用和 SSL 稳定性
_thought_session = requests.Session()

@app.route('/thought_proxy', methods=['POST', 'OPTIONS'])
def thought_proxy():
    """
    前置思考引擎代理端点（同步直返版）
    接收前端请求，转发到外部LLM API，解决CORS问题
    直接在请求线程中等待上游结果并返回JSON（不再使用 generator 流式心跳）
    """
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    
    t_start = time.time()
    
    try:
        data = request.json
        target_url = data.get('url')
        api_key = data.get('api_key')
        model = data.get('model', 'Qwen/Qwen2.5-7B-Instruct')
        messages = data.get('messages', [])
        temperature = data.get('temperature', 0.3)
        max_tokens = data.get('max_tokens', 4096)
        timeout = data.get('timeout', 90)
        
        if not target_url or not api_key:
            return jsonify({"error": "Missing url or api_key"}), 400

        if _is_private_url(target_url):
            logger.warning(f">>> [ThoughtProxy] Blocked request to private/loopback address: {target_url}")
            return jsonify({"error": "Target URL points to a private or internal address"}), 403

        auth_type = data.get('auth_type', 'bearer')

        payload = {
            'model': model,
            'messages': messages,
            'temperature': temperature,
            'max_tokens': max_tokens
        }
        verify_ssl = data.get('verify_ssl', False)
        payload_size = len(json.dumps(payload).encode('utf-8'))
        logger.info(f">>> [ThoughtProxy] Forwarding to {target_url} | Auth:{auth_type} | Payload: {payload_size} bytes | Messages: {len(messages)}")

        if auth_type == 'api_key':
            upstream_headers = {
                'Content-Type': 'application/json',
                'api-key': api_key
            }
        else:
            upstream_headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}'
            }

        try:
            resp = _thought_session.post(
                target_url,
                headers=upstream_headers,
                json=payload,
                timeout=timeout,
                verify=verify_ssl
            )
            duration = time.time() - t_start
            logger.info(f">>> [ThoughtProxy] Success | Status:{resp.status_code} | Time:{duration:.3f}s")
            try:
                parsed = resp.json()
            except ValueError:
                logger.warning(f">>> [ThoughtProxy] Non-JSON response | Status:{resp.status_code}")
                return jsonify({"error": "Non-JSON response from upstream", "error_type": "non_json", "status_code": resp.status_code}), resp.status_code
            return jsonify(parsed), resp.status_code
        except requests.Timeout:
            logger.error(">>> [ThoughtProxy] Timeout")
            return jsonify({"error": "Request timeout", "error_type": "timeout"}), 504
        except requests.exceptions.SSLError as e:
            logger.error(f">>> [ThoughtProxy] SSL Error: {e}")
            return jsonify({"error": f"SSL verification failed: {str(e)}", "error_type": "ssl"}), 502
        except requests.exceptions.ConnectionError as e:
            logger.error(f">>> [ThoughtProxy] Connection Error: {e}")
            return jsonify({"error": f"Connection failed: {str(e)}", "error_type": "connection"}), 502
        except requests.RequestException as e:
            logger.error(f">>> [ThoughtProxy] Request Error: {e}")
            return jsonify({"error": f"Request failed: {str(e)}", "error_type": "request"}), 502
    
    except Exception as e:
        logger.error(f">>> [ThoughtProxy] Setup Error: {e}")
        return jsonify({"error": str(e), "error_type": "unknown"}), 500

# v7.4: Rerank 代理端点，解决前端直连 Rerank API 的 CORS 问题
_rerank_session = requests.Session()

@app.route('/rerank_proxy', methods=['POST', 'OPTIONS'])
def rerank_proxy():
    """
    Rerank API 代理端点
    接收前端请求，转发到外部 Rerank API，解决 CORS 问题
    """
    if request.method == 'OPTIONS':
        return jsonify({}), 200

    t_start = time.time()

    try:
        data = request.json
        target_url = data.get('url')
        api_key = data.get('api_key')

        if not target_url or not api_key:
            return jsonify({"error": "Missing url or api_key"}), 400

        if _is_private_url(target_url):
            logger.warning(f">>> [RerankProxy] Blocked request to private/loopback address: {target_url}")
            return jsonify({"error": "Target URL points to a private or internal address"}), 403

        payload = {k: v for k, v in data.items() if k not in ('url', 'api_key', 'use_proxy')}
        verify_ssl = data.get('verify_ssl', False)
        payload_size = len(json.dumps(payload).encode('utf-8'))
        logger.info(f">>> [RerankProxy] Forwarding to {target_url} | Payload: {payload_size} bytes")

        try:
            resp = _rerank_session.post(
                target_url,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {api_key}'
                },
                json=payload,
                timeout=60,
                verify=verify_ssl
            )
            duration = time.time() - t_start
            logger.info(f">>> [RerankProxy] Status:{resp.status_code} | Time:{duration:.3f}s")
            try:
                parsed = resp.json()
            except ValueError:
                logger.warning(f">>> [RerankProxy] Non-JSON response | Status:{resp.status_code}")
                return jsonify({"error": "Non-JSON response from upstream", "error_type": "non_json", "status_code": resp.status_code}), resp.status_code
            return jsonify(parsed), resp.status_code
        except requests.Timeout:
            logger.error(">>> [RerankProxy] Timeout")
            return jsonify({"error": "Request timeout", "error_type": "timeout"}), 504
        except requests.exceptions.SSLError as e:
            logger.error(f">>> [RerankProxy] SSL Error: {e}")
            return jsonify({"error": f"SSL verification failed: {str(e)}", "error_type": "ssl"}), 502
        except requests.exceptions.ConnectionError as e:
            logger.error(f">>> [RerankProxy] Connection Error: {e}")
            return jsonify({"error": f"Connection failed: {str(e)}", "error_type": "connection"}), 502
        except requests.RequestException as e:
            logger.error(f">>> [RerankProxy] Request Error: {e}")
            return jsonify({"error": f"Request failed: {str(e)}", "error_type": "request"}), 502

    except Exception as e:
        logger.error(f">>> [RerankProxy] Setup Error: {e}")
        return jsonify({"error": str(e), "error_type": "unknown"}), 500

@app.route('/optimize', methods=['POST', 'OPTIONS'])
def optimize():
    if request.method == 'OPTIONS': return jsonify({}), 200
    t_start = time.time()
    try:
        conn = get_db_connection()
        c = conn.cursor()
        logger.info("⚙️ [System] 正在执行全库重组 (VACUUM)，等待锁释放...")
        c.execute("VACUUM") 
        duration = time.time() - t_start
        logger.info(f"Optimize Complete | Duration: {duration:.2f}s")
        return jsonify({"status": "ok", "duration": duration})
    except Exception as e:
        logger.error(f"Optimize Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/tasks_stats', methods=['GET'])
def tasks_stats():
    try:
        conn = get_db_connection()
        c = conn.cursor()

        # 轻量获取总记录数
        c.execute("SELECT COUNT(*) FROM memories")
        total_vectors = c.fetchone()[0]

        stats = {}
        vec_size = embedding_dim * 4 if embedding_dim > 0 else 2048

        if HAS_JSON1:
            # JSON1 可用：纯 SQL 聚合，不拉取原始 BLOB/vector
            c.execute("""
                SELECT
                    COALESCE(json_extract(metadata, '$.taskId'), 'unknown_task') as task_id,
                    COALESCE(json_extract(metadata, '$.type'), 'other') as task_type,
                    COUNT(*) as cnt,
                    MIN(timestamp) as first_seen,
                    MAX(timestamp) as last_seen,
                    SUM(length(metadata) + ? + 500) as est_size
                FROM memories
                GROUP BY task_id, task_type
            """, (vec_size,))

            for row in c.fetchall():
                task_id, task_type, cnt, first_seen, last_seen, est_size = row
                if task_id not in stats:
                    stats[task_id] = {
                        "taskId": task_id,
                        "count": 0,
                        "sizeBytes": 0,
                        "firstSeen": first_seen,
                        "lastSeen": last_seen,
                        "types": set()
                    }
                s = stats[task_id]
                s["count"] += cnt
                s["sizeBytes"] += est_size
                s["types"].add(task_type)
                if first_seen < s["firstSeen"]: s["firstSeen"] = first_seen
                if last_seen > s["lastSeen"]: s["lastSeen"] = last_seen
        else:
            # JSON1 不可用：降级为只读 metadata，绝不读取 vector BLOB
            c.execute("SELECT metadata, timestamp FROM memories")
            for r in c.fetchall():
                meta_str = r[0]
                ts = r[1]
                try:
                    meta = json.loads(meta_str) if meta_str else {}
                    task_id = meta.get('taskId', 'unknown_task')
                    if task_id not in stats:
                        stats[task_id] = {"taskId": task_id, "count": 0, "sizeBytes": 0, "firstSeen": ts, "lastSeen": ts, "types": set()}
                    s = stats[task_id]
                    s["count"] += 1
                    s["sizeBytes"] += (vec_size + len(meta_str) + 500)
                    s["types"].add(meta.get('type', 'other'))
                    if ts < s["firstSeen"]: s["firstSeen"] = ts
                    if ts > s["lastSeen"]: s["lastSeen"] = ts
                except: continue

        final_list = []
        for tid, s in stats.items():
            s["types"] = list(s["types"])
            final_list.append(s)
        final_list.sort(key=lambda x: x["lastSeen"], reverse=True)
        return jsonify({"tasks": final_list, "total_vectors": total_vectors})
    except Exception as e:
        logger.error(f"Stats Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/status', methods=['GET'])
def status():
    count = faiss_index.ntotal if faiss_index else 0
    return jsonify({"status": "ready", "count": count, "dim": embedding_dim})

@app.route('/collections', methods=['GET'])
def list_collections():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT DISTINCT collection_id, count(*) FROM memories GROUP BY collection_id")
    rows = c.fetchall()
    cols = [{"name": r[0], "count": r[1]} for r in rows]
    return jsonify({"collections": cols})

# ================= 优雅关闭协议 =================
def graceful_shutdown(signum=None, frame=None):
    """拦截退出信号，执行安全落盘协议"""
    print("\n")
    logger.info(">>> [Shutdown] 接收到中断信号，正在执行优雅关闭协议...")
    
    try:
        # 单独开一个不受线程池影响的直连，强制将 WAL 缓存文件合并入主数据库并截断
        logger.info(">>> [Shutdown] 正在执行 WAL 检查点合并并释放内存映射...")
        cleanup_conn = sqlite3.connect(DB_PATH, timeout=10.0)
        cleanup_conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        cleanup_conn.close()
        logger.info(">>> [Shutdown] 数据落盘完成，.wal 文件已安全截断。")
    except Exception as e:
        logger.error(f">>> [Shutdown] 落盘清理时发生异常: {e}")
    finally:
        logger.info(">>> [Shutdown] ArcFess 核心已安全离线。See you later, bro.")
        os._exit(0) # 强制干净退出，防止被死锁阻塞

if __name__ == '__main__':
    # 注册退出信号拦截 (支持 Ctrl+C 以及系统的 SIGTERM)
    signal.signal(signal.SIGINT, graceful_shutdown)
    signal.signal(signal.SIGTERM, graceful_shutdown)

    load_index()
    print("="*50)
    print(" ArcFess V7 Lacrimosa - Core Engine")
    print(f" Listening on port: {PORT}")
    print(" Status: Thread-Local Active (4 Threads)")
    print(" Module: Graceful Shutdown Protocol Online")
    print("="*50)
    sys.stdout.flush() 
    
    # 将 serve 放在 try...except 中兜底
    try:
        serve(app, host='0.0.0.0', port=PORT, threads=4, ident='ArcFess Vector Server')
    except KeyboardInterrupt:
        graceful_shutdown()