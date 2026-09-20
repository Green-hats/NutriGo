"""Generate the bilingual architecture SVGs using only Python's standard library.

Run from any directory: python3 docs/diagrams/generate_architecture.py
Coordinates are shared by both locales; edit COPY to change labels.
"""
from html import escape
from pathlib import Path

COPY = {
    'zh': {
        'title': 'NutriGo 系统架构',
        'subtitle': '从手机交互到 AI 与数据服务',
        'status': '生产已部署 · 6ddfe4d3',
        'app': '手机应用', 'app_body': 'Tauri 2 · React 19 · MUI',
        'app_note': '页面随安装包分发', 'android': 'Android · 1.0.0 正式版', 'ios': 'iOS · 工程与编译检查',
        'compat_note': '旧版：基础功能 / CLIP 可用，聊天停用',
        'cloud': '云端服务', 'cloud_note': 'Docker Compose · 私有网络',
        'external': '外部服务', 'external_note': 'AI 密钥仅保存在服务端',
        'gateway': 'Caddy · HTTPS 网关', 'gateway_note': '统一入口 · 路由转发 · SSE 流式响应',
        'chat_protocol': 'POST 聊天 · SSE',
        'go': 'Go 数据服务', 'go_body': ['Gin · GORM', '账号 / 档案 / 饮食 / 图片'],
        'agent': 'Python Agent', 'agent_body': ['FastAPI · Agent Loop', 'AI 对话 / 照片草稿 / 5 个工具'],
        'internal': ['内部鉴权', '用户数据'],
        'persist': '读写与持久化', 'retrieve': '会话持久化 / 本地检索',
        'business': '用户数据与照片', 'business_body': ['SQLite · data.db + uploads', '日记 / 提交回执 / 图片删除任务'],
        'ai_data': '会话与知识库', 'ai_data_body': ['agent.db · nutrition.db', 'ChromaDB + BGE · 本地模型'],
        'chat': '聊天模型', 'chat_body': ['LiteLLM 适配', '对话与工具上下文'],
        'vision': 'DeepSeek 视觉', 'vision_body': ['deepseek-flash', '照片 → 食物 / 克重 / 营养'],
        'optional': '可选运维接入', 'optional_body': ['异地存储 · 待配置', '通知入口 · 待配置'],
        'optional_note': '虚线表示尚未启用的接入',
        'ops': '数据保护与运维', 'ops_body': '图片引用保护 / 删除重试 · 每日备份 · 每小时检测',
        'ops_note': '用户库与照片纳入备份；模型和向量库另行恢复',
        'legend': ['手机与入口', '业务数据', 'AI 编排', '外部服务'],
        'footer': '实现与限制详见架构文档',
        'desc': 'Android 1.0.0 通过 HTTPS 和 JWT 访问 Caddy，再进入 Go 数据服务或 Python Agent；生产已部署提交 6ddfe4d3。聊天只接受 POST JSON 和 SSE。旧客户端仍可使用基础数据与 CLIP 接口，但旧 GET 聊天已停用。Agent 访问本地会话、营养库和 RAG，并调用外部聊天模型与 DeepSeek 视觉 API。异地备份和通知入口尚未配置。',
    },
    'en': {
        'title': 'NutriGo architecture', 'subtitle': 'From the mobile experience to AI and data services',
        'status': 'Production · 6ddfe4d3',
        'app': 'Mobile app', 'app_body': 'Tauri 2 · React 19 · MUI',
        'app_note': 'UI bundled with the app', 'android': 'Android · 1.0.0 stable', 'ios': 'iOS · native checks',
        'compat_note': 'Older builds: core + CLIP work; chat disabled',
        'cloud': 'Cloud services', 'cloud_note': 'Docker Compose · private network',
        'external': 'External services', 'external_note': 'AI keys stay on the server',
        'gateway': 'Caddy · HTTPS gateway', 'gateway_note': 'One API origin · routing · SSE streaming',
        'chat_protocol': 'POST chat · SSE',
        'go': 'Go data service', 'go_body': ['Gin · GORM', 'Accounts / profile / diary / photos'],
        'agent': 'Python Agent', 'agent_body': ['FastAPI · Agent Loop', 'Chat / meal drafts / 5 tools'],
        'internal': ['Auth +', 'user data'],
        'persist': 'Read / write', 'retrieve': 'Persistence / retrieval',
        'business': 'User data & photos', 'business_body': ['SQLite · data.db + uploads', 'Diary / receipts / deletion tasks'],
        'ai_data': 'Sessions & knowledge', 'ai_data_body': ['agent.db · nutrition.db', 'ChromaDB + BGE · local models'],
        'chat': 'Chat model', 'chat_body': ['Via LiteLLM', 'Chat + tool context'],
        'vision': 'DeepSeek vision', 'vision_body': ['deepseek-flash', 'Food / weight / nutrition'],
        'optional': 'Optional operations', 'optional_body': ['Offsite storage · not set up', 'Notifications · not set up'],
        'optional_note': 'Dashed link: not enabled yet',
        'ops': 'Data protection & operations', 'ops_body': 'Photo guards & deletion retries · daily backups · hourly checks',
        'ops_note': 'Backups: user DBs + photos. Restore models and vectors separately.',
        'legend': ['App & gateway', 'Business data', 'AI orchestration', 'External services'],
        'footer': 'See architecture docs for implementation details',
        'desc': 'Android 1.0.0 calls Caddy over HTTPS with JWT; production runs commit 6ddfe4d3. Chat accepts POST JSON and streams SSE. Older clients retain core data and CLIP endpoints, while legacy GET chat is disabled. The Agent accesses local session, nutrition and RAG data and calls external chat and DeepSeek vision APIs. Offsite storage and notifications are not configured.',
    },
}

INK = '#233D34'
MUTED = '#536B62'
GREEN = '#245A48'
BLUE = '#3E6489'
TEAL = '#287B73'
AMBER = '#956127'

ICONS = {
    'phone': '<rect x="5" y="1" width="22" height="30" rx="5"/><path d="M12 5h8M14 27h4"/>',
    'gateway': '<path d="M16 2 28 7v8c0 7-5 11-12 15C9 26 4 22 4 15V7Z"/><path d="m10 15 4 4 8-9"/>',
    'server': '<rect x="2" y="3" width="28" height="11" rx="3"/><rect x="2" y="18" width="28" height="11" rx="3"/><path d="M8 8h1m6 0h9M8 23h1m6 0h9"/>',
    'agent': '<rect x="5" y="7" width="22" height="22" rx="6"/><path d="M16 2v5M11 15v3m10-3v3m-9 6h8M1 14v7m30-7v7"/>',
    'database': '<ellipse cx="16" cy="6" rx="12" ry="5"/><path d="M4 6v20c0 7 24 7 24 0V6M4 16c0 7 24 7 24 0"/>',
    'spark': '<path d="m16 2 4 10 10 4-10 4-4 10-4-10L2 16l10-4Z"/>',
    'backup': '<path d="M6 13a11 11 0 1 1 0 11M2 7v8h8M16 9v9l6 3"/>',
}


def build(locale):
    c = COPY[locale]
    out = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1160" viewBox="0 0 1440 1160" role="img" aria-labelledby="title desc" xml:lang="{locale}">
<title id="title">{escape(c['title'])}</title><desc id="desc">{escape(c['desc'])}</desc>
<!-- Generated by generate_architecture.py. Edit that source, then regenerate both locales. -->
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 9 5 1 9" fill="none" stroke="#71867C" stroke-width="1.5" stroke-linejoin="round"/></marker>
  <marker id="optional-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1 9 5 1 9" fill="none" stroke="#A3937C" stroke-width="1.5" stroke-linejoin="round"/></marker>
</defs>
<style>text {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }} .edge {{ fill:none; stroke:#71867C; stroke-width:2.2; stroke-linejoin:round; stroke-linecap:round; marker-end:url(#arrow); }} .optional-edge {{ fill:none; stroke:#A3937C; stroke-width:2; stroke-dasharray:7 6; stroke-linejoin:round; marker-end:url(#optional-arrow); }}</style>
<rect width="1440" height="1160" rx="28" fill="#FAFCF9"/>
''']

    def rect(x, y, w, h, fill, stroke='none', radius=18, dashed=False):
        dash = ' stroke-dasharray="7 5"' if dashed else ''
        out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"{dash}/>')

    def text(x, y, value, size=20, color=INK, weight=400, anchor='start'):
        out.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" text-anchor="{anchor}">{escape(value)}</text>')

    def icon(kind, x, y, color, scale=1):
        out.append(f'<g transform="translate({x} {y}) scale({scale})" fill="none" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{ICONS[kind]}</g>')

    def pill(x, y, w, value, fill, color):
        rect(x, y, w, 34, fill, radius=17)
        text(x+w/2, y+23, value, 16, color, 550, 'middle')

    def edge(path, optional=False):
        out.append(f'<path class="{"optional-edge" if optional else "edge"}" d="{path}"/>')

    def label(x, y, value, w):
        rect(x-w/2, y-20, w, 29, '#FAFCF9', radius=7)
        text(x, y, value, 17, MUTED, 500, 'middle')

    def service(node, x, y, title, lines, kind, color, fill, port):
        out.append(f'<g data-node="{node}">')
        rect(x, y, 408, 162, fill, '#D7E3DE')
        rect(x+20, y+20, 48, 48, '#FFFFFF', radius=13)
        icon(kind, x+28, y+28, color)
        text(x+82, y+51, title, 25, color, 650)
        text(x+24, y+99, lines[0], 19, MUTED)
        text(x+24, y+132, lines[1], 20, INK)
        text(x+384, y+99, port, 17, MUTED, 500, 'end')
        out.append('</g>')

    def storage(node, x, title, lines, color):
        out.append(f'<g data-node="{node}">')
        rect(x, 766, 408, 146, '#FFFFFF', '#D7E3DE')
        icon('database', x+23, 787, color, .85)
        text(x+64, 812, title, 23, color, 650)
        text(x+24, 850, lines[0], 19, MUTED)
        text(x+24, 882, lines[1], 19, MUTED)
        out.append('</g>')

    def provider(node, y, title, lines):
        out.append(f'<g data-node="{node}">')
        rect(1080, y, 280, 144, '#FFFFFF', '#E9DCC9')
        text(1104, y+38, title, 23, AMBER, 650)
        text(1104, y+76, lines[0], 19, MUTED)
        text(1104, y+110, lines[1], 18, MUTED)
        out.append('</g>')

    # Header and the bundled mobile client.
    rect(48, 41, 8, 44, GREEN, radius=4)
    text(74, 74, c['title'], 34, INK, 700)
    text(74, 106, c['subtitle'], 19, MUTED)
    pill(1068, 51, 324, c['status'], '#EAF2E8', GREEN)
    out.append('<g data-node="app">')
    rect(48, 142, 1344, 112, '#EAF3EC', '#C9DCD0')
    rect(76, 165, 64, 64, GREEN, radius=18)
    icon('phone', 91, 177, '#FFFFFF', 1.08)
    text(162, 184, c['app'], 25, GREEN, 650)
    text(162, 222, c['app_body'], 22, INK)
    text(588, 191, c['app_note'], 20, MUTED)
    text(588, 226, c['compat_note'], 17, MUTED, 500)
    pill(1068, 158, 300, c['android'], '#D9EBDD', GREEN)
    pill(1068, 204, 300, c['ios'], '#FFFFFF', MUTED)
    out.append('</g>')

    # Separate the private server boundary from external integrations.
    rect(48, 310, 976, 754, '#F1F6F1', '#D4E2D7', 22)
    rect(1052, 310, 340, 754, '#FFF9F0', '#EADFCE', 22)
    text(80, 347, '01', 18, GREEN, 700)
    text(118, 347, c['cloud'], 22, GREEN, 650)
    text(992, 347, c['cloud_note'], 17, MUTED, 500, 'end')
    text(1080, 347, '02', 18, AMBER, 700)
    text(1118, 347, c['external'], 22, AMBER, 650)
    text(1080, 380, c['external_note'], 18, MUTED)

    edge('M536 254 V388')
    label(536, 287, 'HTTPS · JWT · REST / SSE', 268)
    out.append('<g data-node="gateway">')
    rect(80, 388, 912, 94, GREEN, GREEN)
    icon('gateway', 104, 417, '#FFFFFF')
    text(156, 427, c['gateway'], 25, '#FFFFFF', 650)
    text(156, 460, c['gateway_note'], 19, '#DFEDE5')
    pill(674, 419, 160, c['chat_protocol'], '#3C6D5C', '#FFFFFF')
    pill(854, 419, 112, '80 / 443', '#3C6D5C', '#FFFFFF')
    out.append('</g>')

    edge('M424 482 V512 H284 V548')
    edge('M648 482 V512 H788 V548')
    label(284, 528, '/api/*', 102)
    label(788, 528, '/agent-api/*', 158)
    service('go', 80, 548, c['go'], c['go_body'], 'server', BLUE, '#EDF4FA', ':3333')
    service('agent', 584, 548, c['agent'], c['agent_body'], 'agent', TEAL, '#E8F4F0', ':8000')
    text(536, 616, c['internal'][0], 15, MUTED, 500, 'middle')
    text(536, 638, c['internal'][1], 15, MUTED, 500, 'middle')
    edge('M584 656 H488')

    edge('M284 710 V766')
    edge('M788 710 V766')
    label(284, 744, c['persist'], 150)
    label(788, 744, c['retrieve'], 232)
    storage('business-data', 80, c['business'], c['business_body'], BLUE)
    storage('agent-data', 584, c['ai_data'], c['ai_data_body'], TEAL)

    # Provider calls travel through the gutter, away from service/data labels.
    edge('M992 587 H1038 V486 H1080')
    edge('M992 666 H1080')
    provider('chat-provider', 414, c['chat'], c['chat_body'])
    provider('vision-provider', 594, c['vision'], c['vision_body'])

    # The operations strip deliberately does not draw backup arrows from RAG/model data.
    out.append('<g data-node="operations">')
    rect(80, 944, 912, 92, '#FFFFFF', '#D7E3DE')
    icon('backup', 102, 971, GREEN, .95)
    text(152, 972, c['ops'], 21, GREEN, 650)
    text(152, 999, c['ops_body'], 18, MUTED)
    text(152, 1022, c['ops_note'], 16, MUTED)
    out.append('</g>')
    out.append('<g data-node="optional">')
    rect(1080, 826, 280, 210, '#FFFCF6', '#CBB99E', dashed=True)
    text(1104, 862, c['optional'], 21, AMBER, 650)
    text(1104, 906, c['optional_body'][0], 18, MUTED)
    text(1104, 943, c['optional_body'][1], 18, MUTED)
    text(1104, 1008, c['optional_note'], 16, MUTED)
    out.append('</g>')
    edge('M992 987 H1040 V977 H1080', optional=True)

    for x, color, name in zip((64, 286, 512, 746), (GREEN, BLUE, TEAL, AMBER), c['legend']):
        rect(x, 1102, 12, 12, color, radius=4)
        text(x+23, 1115, name, 17, MUTED)
    text(1392, 1115, c['footer'], 15, MUTED, 400, 'end')
    out.append('</svg>\n')
    return '\n'.join(out)


if __name__ == '__main__':
    directory = Path(__file__).resolve().parent
    for language in COPY:
        target = directory / f'architecture-{language}.svg'
        target.write_text(build(language), encoding='utf-8')
        print(target.name)
