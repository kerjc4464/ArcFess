"""
记忆数据库检查工具——快速透视 ArcFess 向量记忆库的内容分布。

用途:
    python kk.py

功能:
    1. 按 collection_id 统计记忆分组数量（可视化"房客"分布）
    2. 随机抽取 3 条记忆进行内容预览

数据库连接:
    使用 SQLite URI 格式打开只读连接（file://绝对路径/vectors.db?mode=ro），
    确保检查过程不会修改数据库内容。

注意:
    ORDER BY RANDOM() 在大数据量下有性能影响（需要全表扫描并分配随机值），
    但此脚本仅查询 3 条，影响可忽略。
"""

import sqlite3
import os
from pathlib import Path

# 目标数据库路径——基于本文件所在目录解析，确保与 vector_server.py 中的 DB_PATH 指向同一文件
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(_BASE_DIR, 'vectors.db')

def inspect():
    """
    执行数据库透视检查——展示记忆的统计分布和随机样本。
    
    无参数，无返回值。所有结果直接打印到标准输出。
    
    执行步骤:
        1. 检查数据库文件是否存在
        2. 以只读模式连接数据库（防止误修改）
        3. 按 collection_id 分组统计记忆数量
        4. 随机抽取 3 条记忆展示内容预览
        5. 关闭连接
    """
    if not os.path.exists(DB_FILE):
        print(f"❌ 找不到数据库文件: {DB_FILE}")
        return

    # 使用 URI 格式打开只读连接:
    #   file:{DB_FILE}?mode=ro  → SQLite 3.7+ 支持的 URI 语法
    #   uri=True               → 启用 URI 解析
    #   只读模式防止误修改，适合纯检查场景
    # 绝对路径转 file:// URI（as_uri 处理盘符/空格编码，Windows/macOS 通用），再加只读参数
    conn = sqlite3.connect(f'{Path(DB_FILE).as_uri()}?mode=ro', uri=True)
    c = conn.cursor()

    print("========================================")
    print("       🕵️‍♂️ Arc 记忆库透视报告        ")
    print("========================================")

    # === 第一步：按 collection_id 分组统计记忆数量 ===
    # collection_id 为 NULL 的条目显示为 "NULL (V1旧数据)"，表示旧版插件产生的数据
    print("\n[1] 📊 房客统计 (Collection Distribution):")
    try:
        c.execute("SELECT collection_id, COUNT(*) FROM memories GROUP BY collection_id")
        rows = c.fetchall()
        if not rows:
            print("   (空空如也)")
        else:
            print(f"   {'归属地 (Collection ID)':<30} | {'数量'}")
            print("   " + "-"*40)
            for r in rows:
                # collection_id 为 None → 旧版本数据（没有集合概念）
                col_name = r[0] if r[0] else "NULL (V1旧数据)"
                print(f"   {col_name:<30} | {r[1]}")
    except Exception as e:
        print(f"   读取失败: {e}")

    # === 第二步：随机抽取 3 条记忆预览 ===
    # ORDER BY RANDOM() 需要全表扫描分配随机值，大数据量下较慢
    # 仅 LIMIT 3 条，性能影响可控
    print("\n[2] 👁️ 随机抽查 (Random Samples):")
    try:
        c.execute("SELECT id, collection_id, text FROM memories ORDER BY RANDOM() LIMIT 3")
        samples = c.fetchall()
        for s in samples:
            col = s[1] if s[1] else "NULL"
            # 截断到前30个字符，替换换行符以避免破坏输出格式
            text_preview = s[2][:30].replace('\n', ' ') + "..."
            print(f"   🏷️ [{col}] {text_preview}")
    except:
        pass

    print("\n========================================")
    conn.close()

# 直接运行 (python kk.py) 时执行透视检查
# 作为模块导入 (import kk) 时不做任何操作——允许其他脚本复用 inspect()
if __name__ == "__main__":
    inspect()