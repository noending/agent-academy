# Agent 学院 · macOS App

把静态教学站打包成原生 macOS 应用:SwiftUI + WKWebView,站点文件打进 App 包,通过自定义 `academy://` 协议本地伺服,不依赖网络和本地服务器。

## 使用

```bash
./build.sh          # 产物: dist/Agent 学院.app(双击运行)
open "dist/Agent 学院.app"
```

改了网站内容后重跑 `./build.sh` 即可(图标已缓存,增量构建秒级)。

## 功能(v1.1)

| 功能 | 入口 |
|---|---|
| 上次阅读位置恢复 | 启动自动回到退出的页面(存 UserDefaults) |
| 窗口位置/大小记忆 | 自动 |
| 学习进度(localStorage) | 站内自动,跨启动持久 |
| 论文 PDF 阅读 | papers.html 内链接,WebKit 原生渲染 |
| 外链外开 | http(s) 链接转交系统浏览器 |
| 后退 / 前进 | ⌘[ / ⌘],触控板手势 |
| 回到学习路径 | ⇧⌘H 或工具栏 🏠 |
| 字号缩放(0.5x–3x,记忆) | ⌘+ / ⌘- / ⌘0 |
| 页内查找 | ⌘F,回车下一个 |
| **导师模式** | ⇧⌘T 或工具栏 🎓,侧栏对话,复用 tutor 学生档案 |
| **页面上下文 + 预置问题** | 翻到哪章,导师就带哪章的上下文;面板底部按当前页面给出预置问题(点按填入),每条学生消息自动携带 `[正在学习: …]` 页面前缀 |

**导师模式的运行条件**(App 会自动检测,缺什么面板里会提示):
1. `tutor/` 源码目录在 App 包旁边(即保持仓库布局 `agent-academy/macos-app/dist/*.app`);
2. Node.js(`/opt/homebrew/bin/node` 等);
3. `tutor/node_modules` 已安装(`cd tutor && npm install`);
4. `~/.zshenv` / `~/.zprofile` / `~/.zshrc` 中配置了 `DEEPSEEK_API_KEY`。

学生数据存在 `~/Library/Application Support/AgentAcademy/students/`,与 CLI 的 `tutor/students/` 相互独立(复制文件即可互通)。

## 结构

```
macos-app/
├── Package.swift                  # Swift 5.9 / macOS 13+
├── Sources/AgentAcademy/App.swift # 全部逻辑(~230 行):scheme 服务 + 协调器 + UI
├── scripts/make-icon.swift        # 图标生成(矢量学士帽 + 紫渐变,1024px;icon-preview.png 为预览)
├── AppIcon.icns                   # 生成产物(缓存)
└── build.sh                       # 同步站点 → swift build → 组装 .app → ad-hoc 签名
```

## 设计要点

- **scheme handler 而非 file://**:给页面一个稳定 origin,MIME 类型显式映射,带路径穿越防护;
- **教学法不进 App**:App 只负责外壳,知识库与教学逻辑在静态站与 `../tutor/`(导师智能体,CLI)中;
- ad-hoc 签名仅限本机运行;要分发给他人需开发者证书重签。
