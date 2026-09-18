"""
记忆深度清理工具——对 ArcFess 向量记忆库执行去重和压缩演练。

用途:
    python clean_memory.py

功能:
    1. 交互式备份：引导用户选择备份路径后再执行清理
    2. 文本去重：对 memories 表中 text 字段相同的重复条目，保留 rowid 最小的一条
    3. VACUUM 压缩：回收删除后释放的磁盘空间

去重策略:
    使用 SQL 子查询 GROUP BY text + MIN(rowid) 来标记每组重复文本中
    最早插入（rowid 最小）的那条为"幸存者"，删除其余重复。
    这是保守策略——确保数据不丢失，只删除真正的完全重复。

警告:
    清理操作不可逆。请务必在运行前确认备份成功，
    并在清理后删除并重建 FAISS 索引文件（*.index），
    否则索引将指向已删除的旧 rowid，导致检索错乱。
"""

import sqlite3
import os
import shutil  # 注意：当前代码未直接使用 shutil，保留以备将来功能扩展

# 数据库路径基于本文件所在目录解析，不依赖启动时的 cwd（与 vector_server.py 指向同一文件）
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_BASE_DIR, 'vectors.db')

def copy_with_progress(src, dst):
    """带进度条的大文件分块复制模块
    
    使用 16MB 的块大小进行流式复制，在超大数据库文件场景下
    避免一次性将整个文件全部加载到内存中。
    
    Args:
        src: 源文件完整路径
        dst: 目标文件完整路径
    
    进度显示:
        实时打印百分比进度（同一行覆盖更新），复制完成后输出确认信息。
    """
    total_size = os.path.getsize(src)
    copied_size = 0
    chunk_size = 1024 * 1024 * 16  # 16MB 分块——平衡复制速度与内存占用的折衷值
    
    print(f">>> 目标数据量: {total_size / (1024*1024):.2f} MB")
    
    with open(src, 'rb') as fsrc, open(dst, 'wb') as fdst:
        while True:
            chunk = fsrc.read(chunk_size)
            if not chunk:
                break
            fdst.write(chunk)
            copied_size += len(chunk)
            
            # 实时进度展示（\r 回车不换行实现同行动态刷新）
            progress = (copied_size / total_size) * 100
            print(f"\r>>> 记忆迁移进度: {progress:.1f}% ", end="")
    print("\n>>> 镜像拷贝完成。")

def safe_backup():
    """
    交互式备份引导——在清理前提示用户创建数据库副本。
    
    支持的输入格式:
        - 空输入（直接回车）     → 备份到当前目录的 vectors_backup.db
        - 文件夹路径              → 在指定文件夹下创建 vectors_backup.db
        - 完整文件路径（含文件名） → 直接使用该路径
        - 'skip'                  → 跳过备份（极度危险，需二次确认）
    
    智能路径检测:
        如果输入路径是一个已存在的目录，自动将 vectors_backup.db 附加到路径末尾。
        如果目标路径的父目录不存在，自动创建。
    
    Returns:
        bool: True 表示备份成功或用户确认跳过，False 表示用户取消操作
    """
    if not os.path.exists(DB_PATH):
        print(f"错误：找不到核心数据库文件 {DB_PATH}")
        return False
        
    print("\n" + "="*50)
    print("ArcFess 记忆核心深度清理协议已启动")
    print("="*50)
    print("检测到即将对庞大的记忆海域进行结构性重组。")
    print("请为备份镜像指定一个安全的停泊路径 (例如你的外接硬盘或空间富裕的分区)。")
    print(" - 直接按回车: 默认备份至当前目录的 vectors_backup.db")
    print(" - 输入文件夹路径: 例如 C:\\NEXT Reality\\Arc\\Vector Temp")
    print(" - 输入完整路径: 例如 D:\\ArcBackups\\vectors_backup_2026.db")
    print(" - 输入 skip: 放弃备份，无保护潜入 (极度危险！)")
    
    choice = input("\n请输入你的指令: ").strip()
    
    if choice.lower() == 'skip':
        confirm = input("警告: 结构性重组不可逆！确定要在深渊边缘起舞吗？(y/n): ")
        if confirm.lower() == 'y':
            print(">>> 护盾已卸下，祝你好运。")
            return True
        else:
            return safe_backup()
            
    backup_path = choice if choice else 'vectors_backup.db'
    
    try:
        # 智能路径检测：如果用户输入的是一个已存在的文件夹，自动补全文件名
        if os.path.isdir(backup_path):
            backup_path = os.path.join(backup_path, 'vectors_backup.db')
            
        # 确保目标文件夹的父级结构存在（递归创建目录树）
        target_dir = os.path.dirname(backup_path)
        if target_dir and not os.path.exists(target_dir):
            os.makedirs(target_dir)
            
        print(f"\n>>> 正在将记忆镜像迁移至: {backup_path}")
        copy_with_progress(DB_PATH, backup_path)
        return True
    except Exception as e:
        print(f"\n备份遭遇严重异常: {str(e)}")
        print("手术中止。请确保目标路径有足够的物理空间且未被占用。")
        return False

def clean_redundant_memories():
    """
    执行主清理任务——去重 + VACUUM 压缩。
    
    执行步骤:
        1. 先调用 safe_backup() 引导用户创建备份
        2. 统计清理前记录数
        3. 执行去重 SQL：对 text 相同的记录，保留 rowid 最小的一条
        4. 提交事务
        5. 执行 VACUUM 压缩数据库文件（回收已删除记录占用的磁盘空间）
        6. 输出清理统计报告
    
    去重 SQL 解析:
        DELETE FROM memories 
        WHERE rowid NOT IN (
            SELECT MIN(rowid) FROM memories GROUP BY text
        )
        
        内层子查询对相同 text 分组，取每组中 rowid 最小的那条。
        外层 DELETE 删除所有不在幸存者列表中的行。
        rowid 是 SQLite 内置的行标识符，插入时间越早 rowid 越小。
    
    清理后操作:
        必须删除现有的 FAISS 索引文件（*.index），然后重启 vector_server.py，
        让系统基于去重后的数据库重新构建索引。
    """
    if not safe_backup():
        return
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    print("\n>>> 建立神经连接，开始读取记忆切片...")
    cursor.execute("SELECT COUNT(*) FROM memories")
    total_before = cursor.fetchone()[0]
    print(f">>> 术前统计：共计 {total_before} 条意识碎片。")
    
    print(">>> 正在执行高维去重抹除，此过程可能需要几十秒钟...")
    # 去重核心——保留每组重复文本中 rowid 最小的那条（最早插入的）
    # 对于超大数据库（数万条记录），此 GROUP BY 操作可能耗时数十秒
    delete_query = """
    DELETE FROM memories 
    WHERE rowid NOT IN (
        SELECT MIN(rowid) 
        FROM memories 
        GROUP BY text
    )
    """
    cursor.execute(delete_query)
    deleted_count = cursor.rowcount
    
    conn.commit()
    
    cursor.execute("SELECT COUNT(*) FROM memories")
    total_after = cursor.fetchone()[0]
    
    # VACUUM 将重建数据库文件，回收删除后留下的"空洞"
    # 对于大数据库，VACUUM 需要足够的磁盘空间来创建临时副本
    print(">>> 正在执行 VACUUM 协议，压缩并回收深渊中的物理空间...")
    cursor.execute("VACUUM")
    
    conn.close()
    
    print("\n" + "-" * 50)
    print("手术圆满结束。")
    print(f"成功剥离了 {deleted_count} 条冗余的重叠记忆。")
    print(f"当前记忆海域总容量：{total_after} 条。")
    print("-" * 50)
    print("请务必删除现有的 FAISS 索引文件 (.index)，并重新点火 vector_server.py。")
    print("系统将在启动时，基于这片纯净的深海重新构建高维认知网络。")

if __name__ == "__main__":
    clean_redundant_memories()