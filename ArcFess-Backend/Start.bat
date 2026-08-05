@rem ============================================================
@rem ArcFess Vector Server 启动脚本
@rem 用途: 一键启动 ArcFess 向量记忆后端服务 (vector_server.py)
@rem 使用: 双击运行此 .bat 文件，或在终端中直接执行
@rem 依赖: Python 3.x + 已安装的依赖包 (flask, numpy 等)
@rem 端口: 默认监听 58888（在 vector_server.py 中配置）
@rem ============================================================
@echo off
title ArcFess Vector Server
cd /d "%~dp0"
python vector_server.py
pause