import os
import sys

# 限制多线程并发，防止 PyTorch/HanLP 在 CPU 上推理时吃满所有 CPU 核心导致系统卡死及远程桌面 (RDP) 连接中断
os.environ["OMP_NUM_THREADS"] = "2"
os.environ["MKL_NUM_THREADS"] = "2"
os.environ["OPENBLAS_NUM_THREADS"] = "2"
os.environ["VECLIB_MAXIMUM_THREADS"] = "2"
os.environ["NUMEXPR_NUM_THREADS"] = "2"

try:
    import torch
    torch.set_num_threads(2)
except ImportError:
    pass

import flask
from flask import request, jsonify, Response
import sqlite3
import numpy as np
import json
import time
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

# === HanLP 中文分词器（懒加载，首次使用时初始化，强制CPU避免唤醒5090等N卡）===
_hanlp_tokenizer = None

def get_tokenizer():
    global _hanlp_tokenizer
    if _hanlp_tokenizer is None:
        try:
            import hanlp
            # devices=-1 强制走CPU，不触发 CUDA/NVML，5090 sm_120也不受影响
            _hanlp_tokenizer = hanlp.load(hanlp.pretrained.tok.FINE_ELECTRA_SMALL_ZH, devices=-1)
            logger.info(">>> [HanLP] 中文分词器加载完成 (CPU模式)")
        except Exception as e:
            logger.warning(f">>> [HanLP] 加载失败，BM25 检索将不可用: {e}")
    return _hanlp_tokenizer

def tokenize_for_fts(text):
    if not text:
        return ''
    try:
        tokenizer = get_tokenizer()
        if tokenizer is None:
            raise RuntimeError("tokenizer is None")
        import re
        tokens = tokenizer(text)
        clean_tokens = []
        for t in tokens:
            t = t.strip()
            # 过滤掉纯标点、纯空格、无意义字符 (如果 token 不包含任何字母、数字或汉字，则丢弃)
            if t and not re.match(r'^[^\w\u4e00-\u9fa5]+$', t):
                clean_tokens.append(t)
        return ' '.join(clean_tokens) if clean_tokens else text
    except Exception as e:
        # encode_plus 等兼容性问题或模型损坏时，回退到正则简易分词，保证BM25不中断且不抛Insert Error
        logger.warning(f">>> [HanLP] 分词失败，回退到简易分词: {e}")
        import re
        fallback = re.findall(r'[\w\u4e00-\u9fa5]+', text)
        return ' '.join(fallback) if fallback else text

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

def reset_db_connection():
    """关闭当前线程的损坏连接，下次调用 get_db_connection() 会创建新连接"""
    if hasattr(local_data, "conn"):
        try:
            local_data.conn.close()
        except Exception:
            pass
        del local_data.conn
        logger.warning(">>> [DB] Thread-local connection reset due to corruption")

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
    
    # FTS5 全文检索表（BM25 关键词检索用）
    try:
        c.execute('''CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts 
                     USING fts5(text, content='memories', content_rowid='rowid',
                                tokenize='unicode61')''')
        # 移除触发器：改为在端点中手动同步 FTS5，避免大批量操作时触发器引发数据库损坏
        c.execute("DROP TRIGGER IF EXISTS memories_fts_ad")
        c.execute("DROP TRIGGER IF EXISTS memories_fts_au")
        logger.info(">>> [DB] FTS5 table ensured (triggers removed, using manual sync)")
    except Exception as e:
        logger.warning(f">>> [DB] FTS5 setup failed: {e}")
    
    conn.commit()
    conn.close()

def _ensure_indexes():
    """确保索引和 FTS5 表已创建（兼容旧数据库升级）"""
    global HAS_JSON1
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        # JSON1 索引
        try:
            c.execute("CREATE INDEX IF NOT EXISTS idx_task_id ON memories(json_extract(metadata, '$.taskId'))")
            HAS_JSON1 = True
            logger.info(">>> [DB] JSON1 extension available, task_id index ensured")
        except Exception as e:
            HAS_JSON1 = False
            logger.warning(f">>> [DB] JSON1 extension not available: {e}")
        
        # FTS5 全文检索表
        try:
            # 检查表结构是否为外部内容表，如果是，说明是旧版/易损坏版，直接删除重建为标准表
            c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='memories_fts'")
            row = c.fetchone()
            if row and "content=" in row[0]:
                logger.info(">>> [DB] 检测到旧版 external content FTS5 表，正在删除重建为标准 FTS5 表...")
                c.execute("DROP TABLE memories_fts")
            
            c.execute('''CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts 
                         USING fts5(text, tokenize='unicode61')''')
            logger.info(">>> [DB] FTS5 table ensured")
        except Exception as e:
            logger.warning(f">>> [DB] FTS5 setup failed: {e}")
        
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f">>> [DB] _ensure_indexes failed: {e}")

def rebuild_fts_background(total_count):
    """在后台线程中异步补建 FTS5 全文检索索引，支持断点续做，避免重复构建"""
    def _run():
        t_start = time.time()
        try:
            # 1. 立即读取所有 memories 中存在但 memories_fts 中缺少的行，实现完美的增量断点续做
            fts_conn = sqlite3.connect(DB_PATH, timeout=30.0)
            read_c = fts_conn.cursor()
            read_c.execute("""
                SELECT m.rowid, m.text 
                FROM memories m 
                LEFT JOIN memories_fts f ON m.rowid = f.rowid 
                WHERE f.rowid IS NULL
            """)
            all_rows = read_c.fetchall()
            fts_conn.close()
            
            total_missing = len(all_rows)
            if total_missing == 0:
                logger.info(">>> [FTS5 后台重建] 全文索引已与主表完美对齐，无须补建。")
                return
            
            already_indexed = total_count - total_missing
            logger.info(f">>> [FTS5] 开始在后台线程补建全文索引 (当前缺漏: {total_missing} 条，已存在: {already_indexed} 条，历史总数: {total_count} 条)...")
            
            # 2. 分批处理分词与安全写入
            batch = []
            processed = 0
            for row in all_rows:
                batch.append((row[0], tokenize_for_fts(row[1]) if row[1] else ''))
                processed += 1
                if len(batch) >= 500:
                    # 写入数据库，自带排队重试机制
                    success = False
                    for attempt in range(10):
                        try:
                            conn = sqlite3.connect(DB_PATH, timeout=30.0)
                            c = conn.cursor()
                            c.execute("BEGIN IMMEDIATE")
                            c.executemany("INSERT INTO memories_fts(rowid, text) VALUES (?, ?)", batch)
                            conn.commit()
                            conn.close()
                            success = True
                            break
                        except sqlite3.OperationalError as e:
                            if "locked" in str(e).lower() and attempt < 9:
                                logger.warning(f">>> [FTS5 后台重建] 写入批次时遭遇锁，排队等待中 (尝试 {attempt+1}/10)...")
                                time.sleep(1.5)
                                continue
                            raise
                    if success:
                        batch = []
                        current_total = already_indexed + processed
                        logger.info(f">>> [FTS5 后台重建] 进度: {current_total}/{total_count} ({current_total/total_count*100:.1f}%) | 已耗时: {time.time()-t_start:.1f}s")
                
                # 让出 CPU 时间片，防止 CPU 连续高负荷运行
                time.sleep(0.01)
                
            if batch:
                for attempt in range(10):
                    try:
                        conn = sqlite3.connect(DB_PATH, timeout=30.0)
                        c = conn.cursor()
                        c.execute("BEGIN IMMEDIATE")
                        c.executemany("INSERT INTO memories_fts(rowid, text) VALUES (?, ?)", batch)
                        conn.commit()
                        conn.close()
                        break
                    except sqlite3.OperationalError as e:
                        if "locked" in str(e).lower() and attempt < 9:
                            time.sleep(1.5)
                            continue
                        raise
            
            logger.info(f">>> [FTS5 后台重建] 数据写入完成! 本次补建共耗时: {time.time()-t_start:.1f}s")
            
            # 3. 运行 FTS5 优化，合并 B 树并缩减数据库大小
            logger.info(">>> [FTS5 后台重建] 正在对全文检索索引执行优化合并 (optimize)...")
            t_opt_start = time.time()
            for attempt in range(10):
                try:
                    conn = sqlite3.connect(DB_PATH, timeout=30.0)
                    c = conn.cursor()
                    c.execute("BEGIN IMMEDIATE")
                    c.execute("INSERT INTO memories_fts(memories_fts) VALUES('optimize')")
                    conn.commit()
                    conn.close()
                    logger.info(f">>> [FTS5 后台重建] 索引优化合并完成，耗时: {time.time()-t_opt_start:.2f}s")
                    break
                except sqlite3.OperationalError as e:
                    if "locked" in str(e).lower() and attempt < 9:
                        time.sleep(1.5)
                        continue
                    logger.warning(f">>> [FTS5 后台重建] 索引优化合并失败 (写入遭遇锁): {e}")
            
        except Exception as e:
            logger.error(f">>> [FTS5 后台重建] 失败: {e}")
            
    threading.Thread(target=_run, daemon=True).start()

def load_index():
    global faiss_index, embedding_dim
    logger.info(">>> [System] 正在初始化 ArcFess 向量引擎 (Faiss FP32)...")
    
    if not os.path.exists(DB_PATH): 
        init_db()
    else:
        # 确保索引已创建（兼容旧数据库）
        _ensure_indexes()
    
    # 启动时执行 WAL 检查点，确保干净的 WAL 状态，防止残留损坏的 WAL 文件
    try:
        startup_conn = sqlite3.connect(DB_PATH, timeout=10.0)
        startup_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        startup_conn.close()
        logger.info(">>> [DB] Startup WAL checkpoint completed")
    except Exception as e:
        logger.warning(f">>> [DB] Startup WAL checkpoint failed: {e}")
    
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
    
    # 提前在主线程加载分词器，避免在后台子线程中进行复杂的 PyTorch/CUDA 初始化导致死锁或警告卡顿
    get_tokenizer()
    
    # 检查 FTS5 索引是否需要补建（旧数据库首次启动时，异步执行避免阻塞主线程）
    try:
        fts_conn = sqlite3.connect(DB_PATH, timeout=15.0)
        fts_c = fts_conn.cursor()
        fts_c.execute("SELECT COUNT(*) FROM memories_fts")
        fts_count = fts_c.fetchone()[0]
        
        def timeout_input(prompt, timeout=30.0):
            import sys, time
            sys.stdout.write(prompt)
            sys.stdout.flush()
            try:
                import msvcrt
                start_time = time.time()
                result = ""
                while True:
                    if msvcrt.kbhit():
                        char = msvcrt.getwche()
                        if char in ('\r', '\n'):
                            print('')
                            return result
                        elif char == '\b':
                            result = result[:-1]
                        else:
                            result += char
                    if time.time() - start_time > timeout:
                        print(f"\n[等待超时({int(timeout)}秒)，自动选择 N]")
                        return "n"
                    time.sleep(0.05)
            except Exception:
                return input(prompt)

        if fts_count != count and count > 0:
            fts_conn.close()
            print(f"\n>>> [FTS5] 注意: 您的数据库中有 {count} 条记录，但全文索引(FTS/RTS)只有 {fts_count} 条记录。")
            print(">>> 可能是由于手动导入数据，或上次生成索引时被中断。")
            print(">>> 补全全文索引可能会占用大量CPU并花费较长时间（尤其是在低配服务器上）。")
            print(">>> 如果您不想现在占用性能，可以选择跳过（不影响核心对话功能）。")
            choice = timeout_input(">>> 是否要现在启动后台进程来自动补全缺失的全文索引？(y/N, 30秒无操作默认跳过): ", 30.0)
            if choice and choice.strip().lower() == 'y':
                rebuild_fts_background(count)
            else:
                logger.info(">>> [FTS5] 用户跳过了全文索引的后台补建。")
        else:
            logger.info(f">>> [FTS5] 全文索引(RTS)已有 {fts_count} 条记录，无须补建")
            try:
                fts_c.execute("SELECT SUM(LENGTH(vector)) FROM memories")
                vec_size = fts_c.fetchone()[0] or 0
                fts_c.execute("SELECT SUM(LENGTH(text)) FROM memories")
                txt_size = (fts_c.fetchone()[0] or 0) * 3
                fts_c.execute("SELECT SUM(LENGTH(block)) FROM memories_fts_data")
                fts_size = fts_c.fetchone()[0] or 0
                
                print("\n" + "="*45)
                print(f" 当前数据库存储概况 (总条目: {count}):")
                print(f"  - 向量数据占用 : {vec_size / 1024 / 1024:.2f} MB")
                print(f"  - 文本内容占用 : 约 {txt_size / 1024 / 1024:.2f} MB (UTF-8预估)")
                print(f"  - RTS(FTS)表占用 : {fts_size / 1024 / 1024:.2f} MB")
                print("="*45)
                
                del_choice = timeout_input("\n>>> [高级操作] RTS表目前正常。是否要强制删除并清空 RTS 表以便重新建立/测试？\n>>> (如果你修改了分词逻辑或希望彻底清理，可以选择清空)\n>>> (y/N, 30秒无操作默认不删除): ", 30.0)
                if del_choice and del_choice.strip().lower() == 'y':
                    logger.warning(">>> [FTS5] 用户选择强制删除全文索引，正在清空 memories_fts...")
                    fts_c.execute("DELETE FROM memories_fts")
                    fts_conn.commit()
                    logger.info(">>> [FTS5] RTS表已清空！将在后台继续运行，下次启动时可选择补建。")
                else:
                    logger.info(">>> [System] 服务继续启动...")
            except Exception as size_err:
                logger.warning(f">>> 统计或清理失败: {size_err}")
            finally:
                fts_conn.close()
    except Exception as e:
        logger.warning(f">>> [FTS5] 全文索引状态检查失败: {e}")

# ================= 核心接口区 =================

@app.route('/insert', methods=['POST', 'OPTIONS'])
def insert():
    if request.method == 'OPTIONS': return jsonify({}), 200
    global faiss_index, embedding_dim
    t_start = time.time()
    
    conn = None
    for _retry in range(2):
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

            fts_text = tokenize_for_fts(text) if text else ''

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

            # FTS5 同步（手动）
            try:
                if exist_row:
                    c.execute("DELETE FROM memories_fts WHERE rowid=?", (rowid,))
                c.execute("INSERT INTO memories_fts(rowid, text) VALUES (?, ?)", (rowid, fts_text))
            except Exception as fts_err:
                logger.warning(f"FTS5 sync failed for {uid}: {fts_err}")

            conn.commit()

            with faiss_lock:
                if exist_row:
                    faiss_index.remove_ids(np.array([rowid], dtype=np.int64))
                faiss_index.add_with_ids(vec_np.reshape(1, -1), np.array([rowid], dtype=np.int64))

            logger.info(f"[{action_type}] ID:{uid} | Time:{time.time()-t_start:.3f}s")
            return jsonify({"status": "ok", "id": uid})
        except Exception as e:
            err_str = str(e).lower()
            if conn:
                try: conn.rollback()
                except Exception: pass
            if 'malformed' in err_str and _retry == 0:
                logger.warning(f"Insert Error (malformed), resetting connection and retrying: {e}")
                reset_db_connection()
                continue
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
        filters = data.get('filters')

        if not query_vec_list:
            return jsonify({"results": []})

        query_vec = np.array(query_vec_list, dtype=np.float32)
        query_vec = normalize_vector(query_vec)

        if filters:
            conn = get_db_connection()
            c = conn.cursor()
            
            if allowed_cols:
                placeholders = ','.join('?' * len(allowed_cols))
                c.execute(f"SELECT id, text, metadata, timestamp, collection_id, vector FROM memories WHERE collection_id IN ({placeholders})", allowed_cols)
            else:
                c.execute("SELECT id, text, metadata, timestamp, collection_id, vector FROM memories")
            
            rows = c.fetchall()
            
            matched_rows = []
            for r in rows:
                meta = json.loads(r[2]) if r[2] else {}
                match = True
                for fk, fv in filters.items():
                    val = meta.get(fk)
                    if isinstance(fv, list):
                        if val not in fv:
                            match = False
                            break
                    else:
                        if val != fv:
                            match = False
                            break
                if match:
                    matched_rows.append(r)
            
            results = []
            if matched_rows:
                vectors = []
                for r in matched_rows:
                    vec_blob = r[5]
                    vec = np.frombuffer(vec_blob, dtype=np.float32) if vec_blob else np.zeros_like(query_vec)
                    vectors.append(vec)
                
                vectors = np.array(vectors)
                norms = np.linalg.norm(vectors, axis=1, keepdims=True)
                norms[norms == 0] = 1.0
                normalized_vectors = vectors / norms
                
                similarities = np.dot(normalized_vectors, query_vec)
                
                for idx, r in enumerate(matched_rows):
                    results.append({
                        "id": r[0],
                        "text": r[1],
                        "metadata": json.loads(r[2]) if r[2] else {},
                        "score": float(similarities[idx]),
                        "timestamp": r[3],
                        "collection_id": r[4]
                    })
                
                results.sort(key=lambda x: x["score"], reverse=True)
                results = results[:top_k]
                
            total_time = time.time() - t_start
            logger.info(f"Scoped Query Complete | Results:{len(results)} | Filters:{filters} | Total:{total_time:.4f}s")
            return jsonify({"results": results})

        if faiss_index is None or faiss_index.ntotal == 0: 
            return jsonify({"results": []})
        
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
    conn = None
    for _retry in range(2):
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
                    c.execute("SELECT rowid FROM memories WHERE json_extract(metadata, '$.taskId') = ?", (target_task_id,))
                    rows = c.fetchall()
                    rowids_to_remove.extend([r[0] for r in rows])
                else:
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
                batch_size = 900
                # 步骤1：先从 FTS5 索引中删除（在主表删除之前）
                for i in range(0, len(rowids_to_remove), batch_size):
                    batch = rowids_to_remove[i:i+batch_size]
                    placeholders = ','.join('?' * len(batch))
                    c.execute(f"DELETE FROM memories_fts WHERE rowid IN ({placeholders})", batch)
                
                # 步骤2：从主表删除
                for i in range(0, len(rowids_to_remove), batch_size):
                    batch = rowids_to_remove[i:i+batch_size]
                    placeholders = ','.join('?' * len(batch))
                    c.execute(f"DELETE FROM memories WHERE rowid IN ({placeholders})", batch)
                
                # 步骤3：先提交数据库事务，确保数据一致性
                conn.commit()
                
                # 步骤4：最后更新 FAISS 内存索引（DB 成功后才更新）
                with faiss_lock: 
                    faiss_index.remove_ids(np.array(rowids_to_remove, dtype=np.int64))
                
                logger.info(f"Deleted {len(rowids_to_remove)} memories")
            return jsonify({"status": "ok", "deleted": len(rowids_to_remove)})
        except Exception as e:
            err_str = str(e).lower()
            if conn:
                try: conn.rollback()
                except Exception: pass
            if 'malformed' in err_str and _retry == 0:
                logger.warning(f"Delete Error (malformed), resetting connection and retrying: {e}")
                reset_db_connection()
                continue
            logger.error(f"Delete Error: {e}")
            return jsonify({"error": str(e)}), 500

@app.route('/purge', methods=['POST', 'OPTIONS'])
def purge():
    if request.method == 'OPTIONS': return jsonify({}), 200
    global faiss_index
    data = request.json
    col_id = data.get('collection_id')
    if not col_id: return jsonify({"error": "Missing collection_id"}), 400
    
    conn = None
    for _retry in range(2):
        try:
            conn = get_db_connection()
            c = conn.cursor()
            c.execute("SELECT rowid FROM memories WHERE collection_id = ?", (col_id,))
            rows = c.fetchall()
            rowids_to_remove = [r[0] for r in rows]
            
            if rowids_to_remove:
                batch_size = 900
                # 步骤1：先从 FTS5 索引中删除
                for i in range(0, len(rowids_to_remove), batch_size):
                    batch = rowids_to_remove[i:i+batch_size]
                    placeholders = ','.join('?' * len(batch))
                    c.execute(f"DELETE FROM memories_fts WHERE rowid IN ({placeholders})", batch)
                
                # 步骤2：从主表删除
                for i in range(0, len(rowids_to_remove), batch_size):
                    batch = rowids_to_remove[i:i+batch_size]
                    placeholders = ','.join('?' * len(batch))
                    c.execute(f"DELETE FROM memories WHERE rowid IN ({placeholders})", batch)
                
                # 步骤3：先提交数据库事务
                conn.commit()
                
                # 步骤4：最后更新 FAISS 内存索引
                with faiss_lock:
                    faiss_index.remove_ids(np.array(rowids_to_remove, dtype=np.int64))
                
                logger.info(f"Purged collection: {col_id} ({len(rowids_to_remove)} items)")
            
            return jsonify({"status": "ok", "deleted": len(rowids_to_remove)})
        except Exception as e:
            err_str = str(e).lower()
            if conn:
                try: conn.rollback()
                except Exception: pass
            if 'malformed' in err_str and _retry == 0:
                logger.warning(f"Purge Error (malformed), resetting connection and retrying: {e}")
                reset_db_connection()
                continue
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
        top_p = data.get('top_p')
        top_k = data.get('top_k')
        frequency_penalty = data.get('frequency_penalty')
        presence_penalty = data.get('presence_penalty')
        reasoning_effort = data.get('reasoning_effort')

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
        
        if top_p is not None: payload['top_p'] = top_p
        if top_k is not None: payload['top_k'] = top_k
        if frequency_penalty is not None: payload['frequency_penalty'] = frequency_penalty
        if presence_penalty is not None: payload['presence_penalty'] = presence_penalty
        if reasoning_effort: payload['reasoning_effort'] = reasoning_effort
        
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

@app.route('/hybrid_query', methods=['POST', 'OPTIONS'])
def hybrid_query():
    """BM25 关键词检索端点（FTS5 + HanLP 分词）"""
    if request.method == 'OPTIONS': return jsonify({}), 200
    t_start = time.time()
    
    try:
        data = request.json
        query_text = data.get('text', '')
        top_k = data.get('k', 10)
        allowed_cols = data.get('collections', [])
        meta_filters = data.get('filters', {})
        k1 = data.get('k1', 1.2)
        b = data.get('b', 0.75)
        min_score = data.get('min_score', 0.01)
        
        if not query_text.strip():
            return jsonify({"results": [], "debug": {"query_tokens": "", "fts_matches": 0, "elapsed_ms": 0}})
        
        # HanLP 分词
        query_tokens = tokenize_for_fts(query_text)
        if not query_tokens.strip():
            return jsonify({"results": [], "debug": {"query_tokens": query_tokens, "fts_matches": 0, "elapsed_ms": 0}})
        
        conn = get_db_connection()
        c = conn.cursor()
        
        # FTS5 搜索（若存在 filters 预过滤，扩大检索范围以保证召回率）
        search_limit = top_k * 30 if meta_filters else (top_k * 3 if allowed_cols else top_k)
        
        # 构建安全的 OR 查询，用双引号包裹每个词
        fts_query = ' OR '.join(f'"{t}"' for t in query_tokens.split())
        
        try:
            c.execute("SELECT rowid, bm25(memories_fts) as rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?",
                      (fts_query, search_limit))
            fts_rows = c.fetchall()
        except Exception as fts_err:
            logger.warning(f"FTS5 query failed: {fts_err}")
            return jsonify({"results": [], "debug": {"query_tokens": query_tokens, "fts_matches": 0, "elapsed_ms": round((time.time()-t_start)*1000, 1)}})
        
        if not fts_rows:
            return jsonify({"results": [], "debug": {"query_tokens": query_tokens, "fts_matches": 0, "elapsed_ms": round((time.time()-t_start)*1000, 1)}})
        
        # 从 rowid 取完整记录
        rowid_score_map = {r[0]: r[1] for r in fts_rows}
        rowids = list(rowid_score_map.keys())
        placeholders = ','.join('?' * len(rowids))
        c.execute(f"SELECT rowid, id, text, metadata, timestamp, collection_id FROM memories WHERE rowid IN ({placeholders})", rowids)
        rows = c.fetchall()
        
        results = []
        for r in rows:
            rid = r[0]
            col_id = r[5]
            if allowed_cols and col_id not in allowed_cols:
                continue
            
            # Apply metadata filter
            if meta_filters:
                item_meta = json.loads(r[3]) if r[3] else {}
                match = True
                for fk, fv in meta_filters.items():
                    val = item_meta.get(fk)
                    if isinstance(fv, list):
                        if val not in fv:
                            match = False
                            break
                    else:
                        if val != fv:
                            match = False
                            break
                if not match:
                    continue

            # FTS5 bm25() 返回负数，越小越好。转换为 0-1 正分数
            raw_rank = rowid_score_map.get(rid, 0)
            score = 1.0 / (1.0 + abs(raw_rank))
            if score < min_score:
                continue
            results.append({
                "id": r[1],
                "text": r[2],
                "metadata": json.loads(r[3]) if r[3] else {},
                "score": score,
                "timestamp": r[4],
                "collection_id": col_id
            })
        
        results.sort(key=lambda x: x["score"], reverse=True)
        results = results[:top_k]
        
        total_time = time.time() - t_start
        logger.info(f"HybridQuery(BM25) | k1={k1} b={b} | Filters:{meta_filters} | Results:{len(results)} | Time:{total_time:.4f}s")
        return jsonify({
            "results": results,
            "debug": {
                "query_tokens": query_tokens,
                "fts_matches": len(fts_rows),
                "elapsed_ms": round(total_time * 1000, 1)
            }
        })
    except Exception as e:
        logger.error(f"HybridQuery Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/optimize', methods=['POST', 'OPTIONS'])
def optimize():
    if request.method == 'OPTIONS': return jsonify({}), 200
    t_start = time.time()
    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        logger.info("[System] 正在执行全库重组 (VACUUM)，等待锁释放...")
        c.execute("VACUUM") 
        duration = time.time() - t_start
        logger.info(f"Optimize Complete | Duration: {duration:.2f}s")
        return jsonify({"status": "ok", "duration": duration})
    except Exception as e:
        if conn:
            try: conn.rollback()
            except Exception: pass
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
    db_ok = True
    try:
        conn = get_db_connection()
        conn.execute("SELECT 1 FROM memories LIMIT 1")
    except Exception:
        db_ok = False
    return jsonify({"status": "ready" if db_ok else "corrupted", "count": count, "dim": embedding_dim, "db_healthy": db_ok})

@app.route('/collections', methods=['GET'])
def list_collections():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT DISTINCT collection_id, count(*) FROM memories GROUP BY collection_id")
    rows = c.fetchall()
    cols = [{"name": r[0], "count": r[1]} for r in rows]
    return jsonify({"collections": cols})

@app.route('/collection_ids', methods=['POST', 'OPTIONS'])
def get_collection_ids():
    if request.method == 'OPTIONS':
        return '', 204
    data = request.json
    collection_id = data.get("collection_id")
    if not collection_id:
        return jsonify({"error": "collection_id required"}), 400
    
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT id FROM memories WHERE collection_id = ?", (collection_id,))
    rows = c.fetchall()
    
    return jsonify({"ids": [r[0] for r in rows]})

@app.route('/get_collection_memories', methods=['POST', 'OPTIONS'])
def get_collection_memories():
    if request.method == 'OPTIONS': return jsonify({}), 200
    try:
        data = request.json
        col_id = data.get('collection_id')
        if not col_id: return jsonify({"error": "Missing collection_id"}), 400
        
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT id, text, metadata, timestamp, collection_id, vector FROM memories WHERE collection_id = ?", (col_id,))
        rows = c.fetchall()
        
        results = []
        for r in rows:
            vec_blob = r[5]
            vec_list = list(np.frombuffer(vec_blob, dtype=np.float32)) if vec_blob else []
            results.append({
                "id": r[0],
                "text": r[1],
                "metadata": json.loads(r[2]) if r[2] else {},
                "timestamp": r[3],
                "collection_id": r[4],
                "vector": vec_list
            })
        return jsonify({"memories": results})
    except Exception as e:
        logger.error(f"GetCollectionMemories Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/update_metadata', methods=['POST', 'OPTIONS'])
def update_metadata():
    if request.method == 'OPTIONS': return jsonify({}), 200
    try:
        data = request.json
        uid = data.get('id')
        meta = data.get('metadata')
        if not uid or meta is None: return jsonify({"error": "Missing id or metadata"}), 400
        
        conn = get_db_connection()
        c = conn.cursor()
        
        c.execute("SELECT metadata FROM memories WHERE id = ?", (uid,))
        exist = c.fetchone()
        if not exist: return jsonify({"error": "Memory not found"}), 404
        
        old_meta = json.loads(exist[0]) if exist[0] else {}
        if isinstance(meta, dict) and isinstance(old_meta, dict):
            old_meta.update(meta)
        else:
            old_meta = meta
            
        meta_str = json.dumps(old_meta, ensure_ascii=False)
        c.execute("UPDATE memories SET metadata = ? WHERE id = ?", (meta_str, uid))
        conn.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        logger.error(f"UpdateMetadata Error: {e}")
        return jsonify({"error": str(e)}), 500

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