# ArcFess

<div align="center">

![SillyTavern Plugin](https://img.shields.io/badge/Frontend-SillyTavern_Plugin-blue?style=for-the-badge)
![Python Backend](https://img.shields.io/badge/Backend-Python_Flask-green?style=for-the-badge)
![License](https://img.shields.io/badge/License-AGPL_v3-blue.svg?style=for-the-badge)

**为“深层情感陪伴”与“超长上下文”设计的个人记忆引擎方案**

<font color="#808080">我最伟大的作品。</font>

</div>

---

## 📝 项目定位 (About This Project)

本项目起源于 [RaphllA/vectors-enhanced](https://github.com/RaphllA/vectors-enhanced) 的前端架构。经过一段时间的个人使用和迭代，目前已经发展成一个包含 Python 后端服务器的独立记忆检索系统。

需要坦诚的是，以目前的眼光来看，传统的向量化技术在易用性和极致准确度上，可能已经不再具有绝对的领先优势。但本项目的初衷，始终是服务于**极长周期的角色扮演（RP）**与**深层的情感连接记忆**。如果您也有类似处理极其庞大、跨度极长的上下文需求，希望它能为您提供一些参考。

## ⚙️ 架构简述 (Architecture)

区别于繁杂的理论框架，本系统的结构非常直接，分为前端 UI 交互与独立后端两部分：

1. **Frontend (SillyTavern Plugin)**：负责在 UI 层面的参数控制、事件触发与最终记忆的拼装注入。
2. **Backend (ArcFess Server)**：独立的高性能 Python FastAPI 服务器 (`vector_server.py`)，专门承载沉重的数据库读写与检索压力。底层采用 **SQLite 结构化存储 + FAISS 高效检索** 双轨架构。内置高性能的后端数据库管理，**理论上可以支持百万条高维向量的数据库检索**。
   * 注意：所有的记忆数据将存储在后端的 `ArcFess` 文件夹内的 `vectors.db` 中。

---

## 💡 核心功能特性 (Key Features)

### 1. 理性思考前置分支：Egos (Thought 引擎)
除了常规的检索外，Egos会在最终生成回复前，尝试进行一些简单的逻辑推理（如当前时间、地点、语境氛围），并以此为依据去精准调取过去的记忆。

### 2. 多轨融合检索 (Multi-Track Retrieval)
系统目前采用多轨通道进行检索互补：
*   **Track 1: Egos 理性检索** - 由前置思考引擎提取的关键节点，决定了记忆的上下文准度。
*   **Track 2: FAISS 语义检索** - 常规的向量语义匹配，用于大范围的语意召回。
*   **Track 3: BM25 词法检索** - 作为辅助通道，用于偶尔捕捉特定的专有名词。

### 3. 可视化诊断生态
后端附带了 `ArcView` HTML 可视化探针，方便在浏览器中直观地查看和调试底层数据库的连通状态。

### 4. 上下文压缩提纯 (LLM Contextual Compression)
在检索结果注入提示词之前，由 LLM 对每条记忆片段进行逐条评估：与当前对话无关的碎片直接【丢弃】剔除，相关的碎片则提取并总结其核心内容（保留原始时间等元数据），显著降低 Token 消耗并提升注入内容的逻辑连贯性。
*   默认关闭，需在设置面板中启用并配置 OpenAI 兼容的 LLM API（URL / API Key / 模型），支持通过 ArcFess 后端代理转发以解决 CORS 问题。
*   支持并发批次处理、失败自动保留原文降级、以及推理模型的思考标签兼容。

---

## 📦 部署指南 (Deployment)

由于本项目包含前端插件与独立后端，请按照以下两步顺序进行部署：

### 第一步：安装前端插件 (SillyTavern Plugin)
1. 在 SillyTavern 的“扩展组件”（Extensions）菜单顶部，点击“安装扩展”图标。
2. 将本仓库的链接 `https://github.com/kerjc4464/ArcFess` 粘贴到弹出的输入框中，点击确认安装。（此时前端连同后端代码会被一并下载到您的 SillyTavern 插件目录中）。

### 第二步：启动独立后端 (ArcFess Server)
1. 打开您的本地文件夹，导航至：`SillyTavern/public/scripts/extensions/third-party/ArcFess/ArcFess-Backend`。
2. 双击运行 `Setup_and_Run.bat`，脚本会自动安装 Python 依赖并启动 Flask + Waitress 服务。
3. 等待终端显示 `Listening on port: 8999` 或类似的服务启动成功提示。

### 第三步：连接与配置
1. 刷新 SillyTavern 页面。
2. 打开 ArcFess 插件设置面板，确保后端的 API 连接地址为 `http://127.0.0.1:8999`，确认连接成功即可开始体验。

### 数据库路径与备份说明
1. 后端数据库路径（`vector_server.py` / `clean_memory.py` / `kk.py` / `check_db.py`）已统一为**基于脚本所在目录的绝对路径**，不再依赖启动时的当前目录 —— 双击 `.bat`、IDE 或任意目录启动都指向同一个 `vectors.db`，不会误建空库。
2. 旧版服务副本已归档至 `ArcFess-Backend/_archive_legacy_vector_server/`，仅作留存，请勿直接运行（会占用同一个 8999 端口）。
3. 备份建议：先停止后端（确认 `vectors.db-wal` 为 0 字节、数据已落盘），再直接复制 `vectors.db` 即为一致快照；`clean_memory.py` 也会在清理前引导备份。

---

## ⚖️ 协议与鸣谢 (License & Credits)

**[致谢与贡献者]** 
*   **RaphllA**: 感谢原作者开源的 `vectors-enhanced` 提供了最初的前端基建与灵感。
*   **Gemini / Deepseek**: 感谢作为核心 AI 协作者参与了本项目的无数次代码迭代与架构推演。

**[开源协议]**
本项目采用 **GNU Affero General Public License v3.0 (AGPL-3.0)** 许可协议，详见 [`LICENSE`](LICENSE) 文件。

*   **Copyright (C) 2025-2026 RaphllA & kerjc4464 (Jc_ker)** — 基于 [RaphllA/vectors-enhanced](https://github.com/RaphllA/vectors-enhanced) (原 Apache-2.0) 二次开发。
*   允许自由使用、修改、分发及商业使用，但**必须开源**：若修改后通过网络提供服务（如部署后端 `vector_server.py`），须按 AGPL-3.0 第13条向用户提供完整对应源码。
*   衍生作品须同样以 AGPL-3.0 分发，并保留版权与署名。
*   历史版本（commit `670ad5f` 之前）在 CC BY-NC 4.0 下发布的内容仍受原协议约束，不可追溯变更。

> **注意**：AGPL-3.0 允许商业使用，但禁止闭源网络服务；CC BY-NC 4.0 的“非商业性”限制已被移除。如需非 AGPL 的商业闭源授权，请联系作者另行协商。
