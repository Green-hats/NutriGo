# 架构图资源

总览图采用固定布局的 SVG，保证 GitHub 和文档查看器中的分层、间距、字体及连线一致。矢量图可放大，背景为暖白色，在浅色和深色文档主题中均保留同一套对比度。

| 资源 | 用途 |
|---|---|
| [architecture-zh.svg](architecture-zh.svg) | 中文 README、系统架构、手机端及部署文档共用的总览图 |
| [architecture-en.svg](architecture-en.svg) | 英文 README 总览图 |
| [generate_architecture.py](generate_architecture.py) | 两种语言共用的布局、配色、图标与文案源文件 |

图中主链路按手机 → 网关 → 服务 → 存储排列。Go 使用蓝色，Agent 使用青绿色，外部模型使用暖棕色；内部调用箭头连接 Agent 与 Go。异地存储和通知入口用虚线表示可选且尚未启用，不能把它们标成已有容灾能力。

顶部状态标明当前生产运行提交；手机区域同时标出 Android 正式版及旧客户端兼容边界，网关区域明确聊天使用 POST + SSE。这里的旧版说明只概括“基础功能 / CLIP 可用、聊天停用”，完整矩阵以[手机端文档](../MOBILE.md#版本兼容性)为准。

“数据保护与运维”是能力说明，不表示所有模型和向量库都纳入用户数据备份。具体备份范围见[数据管理](../DATA_MANAGEMENT.md)。组件和持久卷的详细依赖保留为[架构文档](../ARCHITECTURE.md)中的可展开 Mermaid 图，其余时序和流程图采用相同主题。

## 修改与生成

从仓库根目录执行，只依赖 Python 3 标准库：

```bash
python3 docs/diagrams/generate_architecture.py
```

修改源文件的 `COPY` 更新中英文文案，修改 `build` 更新共用布局；生成后同时提交两份 SVG。不要只手工修改生成文件。图内不使用外部字体、图片、脚本或远程资源。

交付前检查两种语言的文字边界、箭头方向及 README 宽度下的可读性；确保可选能力仍与已上线服务明确区分。缩略图可以点击打开完整矢量版本。
