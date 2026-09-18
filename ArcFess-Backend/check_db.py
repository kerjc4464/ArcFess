"""
璁板繂鏁版嵁搴撴鏌ュ伐鍏封€斺€斿揩閫熼€忚 ArcFess 鍚戦噺璁板繂搴撶殑鍐呭鍒嗗竷銆?
鐢ㄩ€?
    python kk.py

鍔熻兘:
    1. 鎸?collection_id 缁熻璁板繂鍒嗙粍鏁伴噺锛堝彲瑙嗗寲"鎴垮"鍒嗗竷锛?    2. 闅忔満鎶藉彇 3 鏉¤蹇嗚繘琛屽唴瀹归瑙?
鏁版嵁搴撹繛鎺?
    浣跨敤 SQLite URI 鏍煎紡鎵撳紑鍙杩炴帴锛坒ile:vectors.db?mode=ro锛夛紝
    纭繚妫€鏌ヨ繃绋嬩笉浼氫慨鏀规暟鎹簱鍐呭銆?
娉ㄦ剰:
    ORDER BY RANDOM() 鍦ㄥぇ鏁版嵁閲忎笅鏈夋€ц兘褰卞搷锛堥渶瑕佸叏琛ㄦ壂鎻忓苟鍒嗛厤闅忔満鍊硷級锛?    浣嗘鑴氭湰浠呮煡璇?3 鏉★紝褰卞搷鍙拷鐣ャ€?"""

import sqlite3
import os
from pathlib import Path

# 目标数据库路径——基于本文件所在目录解析，确保与 vector_server.py 中的 DB_PATH 指向同一文件
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(_BASE_DIR, 'vectors.db')

def inspect():
    """
    鎵ц鏁版嵁搴撻€忚妫€鏌モ€斺€斿睍绀鸿蹇嗙殑缁熻鍒嗗竷鍜岄殢鏈烘牱鏈€?    
    鏃犲弬鏁帮紝鏃犺繑鍥炲€笺€傛墍鏈夌粨鏋滅洿鎺ユ墦鍗板埌鏍囧噯杈撳嚭銆?    
    鎵ц姝ラ:
        1. 妫€鏌ユ暟鎹簱鏂囦欢鏄惁瀛樺湪
        2. 浠ュ彧璇绘ā寮忚繛鎺ユ暟鎹簱锛堥槻姝㈣淇敼锛?        3. 鎸?collection_id 鍒嗙粍缁熻璁板繂鏁伴噺
        4. 闅忔満鎶藉彇 3 鏉¤蹇嗗睍绀哄唴瀹归瑙?        5. 鍏抽棴杩炴帴
    """
    if not os.path.exists(DB_FILE):
        print(f"鉂?鎵句笉鍒版暟鎹簱鏂囦欢: {DB_FILE}")
        return

    # 浣跨敤 URI 鏍煎紡鎵撳紑鍙杩炴帴:
    #   file:{DB_FILE}?mode=ro  鈫?SQLite 3.7+ 鏀寔鐨?URI 璇硶
    #   uri=True               鈫?鍚敤 URI 瑙ｆ瀽
    #   鍙妯″紡闃叉璇慨鏀癸紝閫傚悎绾鏌ュ満鏅?    conn = sqlite3.connect(f'{Path(DB_FILE).as_uri()}?mode=ro', uri=True)
    c = conn.cursor()

    print("========================================")
    print("       馃暤锔忊€嶁檪锔?Arc 璁板繂搴撻€忚鎶ュ憡        ")
    print("========================================")

    # === 绗竴姝ワ細鎸?collection_id 鍒嗙粍缁熻璁板繂鏁伴噺 ===
    # collection_id 涓?NULL 鐨勬潯鐩樉绀轰负 "NULL (V1鏃ф暟鎹?"锛岃〃绀烘棫鐗堟彃浠朵骇鐢熺殑鏁版嵁
    print("\n[1] 馃搳 鎴垮缁熻 (Collection Distribution):")
    try:
        c.execute("SELECT collection_id, COUNT(*) FROM memories GROUP BY collection_id")
        rows = c.fetchall()
        if not rows:
            print("   (绌虹┖濡備篃)")
        else:
            print(f"   {'褰掑睘鍦?(Collection ID)':<30} | {'鏁伴噺'}")
            print("   " + "-"*40)
            for r in rows:
                # collection_id 涓?None 鈫?鏃х増鏈暟鎹紙娌℃湁闆嗗悎姒傚康锛?                col_name = r[0] if r[0] else "NULL (V1鏃ф暟鎹?"
                print(f"   {col_name:<30} | {r[1]}")
    except Exception as e:
        print(f"   璇诲彇澶辫触: {e}")

    # === 绗簩姝ワ細闅忔満鎶藉彇 3 鏉¤蹇嗛瑙?===
    # ORDER BY RANDOM() 闇€瑕佸叏琛ㄦ壂鎻忓垎閰嶉殢鏈哄€硷紝澶ф暟鎹噺涓嬭緝鎱?    # 浠?LIMIT 3 鏉★紝鎬ц兘褰卞搷鍙帶
    print("\n[2] 馃憗锔?闅忔満鎶芥煡 (Random Samples):")
    try:
        c.execute("SELECT id, collection_id, text FROM memories ORDER BY RANDOM() LIMIT 3")
        samples = c.fetchall()
        for s in samples:
            col = s[1] if s[1] else "NULL"
            # 鎴柇鍒板墠30涓瓧绗︼紝鏇挎崲鎹㈣绗︿互閬垮厤鐮村潖杈撳嚭鏍煎紡
            text_preview = s[2][:30].replace('\n', ' ') + "..."
            print(f"   馃彿锔?[{col}] {text_preview}")
    except:
        pass

    print("\n========================================")
    conn.close()

# 鐩存帴杩愯 (python kk.py) 鏃舵墽琛岄€忚妫€鏌?# 浣滀负妯″潡瀵煎叆 (import kk) 鏃朵笉鍋氫换浣曟搷浣溾€斺€斿厑璁稿叾浠栬剼鏈鐢?inspect()
if __name__ == "__main__":
    inspect()
