// 导师模式:在侧栏里与《Agent 学院》开发导师对话。
// 通过 Process 启动 tutor 的 --rpc 模式(JSONL 协议),复用学生档案与教学工具。
import SwiftUI
import AppKit
import MarkdownUI

// MARK: - 会话消息模型

struct TutorChatMessage: Identifiable {
    let id = UUID()
    var isUser: Bool
    var text: String
}

struct PageContext: Equatable {
    let file: String
    let title: String
}

/// 教学包元数据(课程菜单 + 预置问题来源)
struct PackMeta {
    let name: String
    let title: String
    let starter: [String]        // pack.json starterQuestions
    let chapterQuestions: [String] // curriculum 各章 questions 拼平
}

// MARK: - 每个课程页面的预置问题(键 = 文件名)

let PRESET_QUESTIONS: [String: [String]] = [
    "index.html": [
        "我是零基础,应该从哪一章开始?",
        "学完整个课程我能做出什么?",
        "为什么把 Ontology 和 Harness 单独拿出来讲?",
    ],
    "llm-basics.html": [
        "温度(temperature)调高调低有什么区别?",
        "token 和字数是什么关系?",
        "为什么模型会一本正经地胡说八道?",
    ],
    "01-agent-basics.html": [
        "Agent 和 Chatbot 的本质区别是什么?",
        "用大白话讲讲 Agent Loop",
        "ReAct 里的「行动」是谁执行的?",
    ],
    "02-first-agent.html": [
        "Function Calling 的完整流程是什么?",
        "流式模式下工具调用分片怎么拼接?",
        "重试为什么要加指数退避?",
    ],
    "03-prompt-engineering.html": [
        "系统提示词的「五区结构」是什么?",
        "few-shot 示例该怎么挑?",
        "为什么提示词一长就失灵?",
    ],
    "04-knowledge-base.html": [
        "RAG 的完整链路有哪几步?",
        "切块大小怎么选?",
        "检索质量差,先排查哪一步?",
    ],
    "05-agent-patterns.html": [
        "上下文压缩丢了关键信息怎么办?",
        "什么时候才真的需要多智能体?",
        "外置记忆和长上下文是什么关系?",
    ],
    "06-ontology.html": [
        "Ontology 到底解决什么问题?",
        "RDF/OWL/SPARQL 要学到什么深度?",
        "LLM 怎么自动抽取本体?",
    ],
    "07-harness.html": [
        "Harness 的八大组件是什么?",
        "为什么说「模型决定上限,Harness 决定下限」?",
        "自建 Harness 和 Pi Agent 怎么选?",
    ],
    "08-ship-it.html": [
        "上线前必须做哪几件事?",
        "LLM-as-Judge 可靠吗?",
        "成本和延迟怎么优化?",
    ],
    "09-capstone.html": [
        "毕业项目的四个里程碑怎么规划?",
        "「整理论文笔记」的选题该怎么做本体设计?",
        "验收标准怎么写才可测?",
    ],
    "10-design-patterns.html": [
        "MCP 和 Function Calling 什么关系?",
        "护栏为什么必须 fail closed?",
        "A2A 和 MCP 分别用在什么场景?",
        "幂等键是什么,为什么重试前要考虑它?",
    ],
    "papers.html": [
        "论文该按什么顺序读?",
        "ReAct 论文的核心贡献是什么?",
        "Gulli 教材和课程怎么配合?",
    ],
    "fde.html": [
        "FDE 是什么职位?和普通工程师的区别?",
        "八项能力栈里我最缺哪一块?",
        "90 天养成计划怎么执行?",
    ],
    "briefs.html": [
        "三份企业简报该按什么顺序做?",
        "验收测试全红起步,第一刀从哪切?",
        "交付五件套文档分别是什么?",
    ],
]

let DEFAULT_QUESTIONS = [
    "我在当前页面卡住了,帮我讲解重点",
    "给我出一道和本页相关的练习题",
    "用大白话总结这一页",
]

// MARK: - 行缓冲(readabilityHandler 在非主线程回调,独立引用类型避免 actor 隔离冲突;回调串行,无数据竞争)

final class LineBuffer {
    var data = Data()
}

// MARK: - RPC 进程管理

@MainActor
final class TutorModel: ObservableObject {
    @Published var messages: [TutorChatMessage] = []
    @Published var thinking = false
    @Published var statusText: String?
    @Published var totalCost = 0.0
    @Published var failureReason: String? // 非 nil = 引擎起不来,展示给用户
    @Published private(set) var currentPage: PageContext?
    @Published private(set) var packName = "agent-dev"
    @Published private(set) var packTitle = "Agent 学院 · 开发导师"
    @Published private(set) var packs: [PackMeta] = []
    @Published private(set) var currentPack: PackMeta?

    private var pageDirty = false // 页面变化后还没上报过

    /// 扫描 tutor/packs/ 下可用教学包
    func reloadPacks() {
        guard let root = tutorRoot else { return }
        loadPacks(root: root)
    }

    private func loadPacks(root: URL) {
        let dir = root.appendingPathComponent("packs")
        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return }
        var list: [PackMeta] = []
        for e in entries.sorted() {
            let pj = dir.appendingPathComponent(e).appendingPathComponent("pack.json")
            guard let data = try? Data(contentsOf: pj),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let name = obj["name"] as? String else { continue }
            let title = (obj["title"] as? String) ?? name
            let starter = (obj["starterQuestions"] as? [String]) ?? []
            var chapterQs: [String] = []
            if let chapters = obj["curriculum"] as? [[String: Any]] {
                for ch in chapters { if let qs = ch["questions"] as? [String] { chapterQs += qs } }
            }
            list.append(PackMeta(name: name, title: title, starter: starter, chapterQuestions: chapterQs))
        }
        packs = list
        currentPack = packs.first(where: { $0.name == packName })
    }

    /// 学生翻到新页面时由 WebView 回调;标题可能晚到,以 file 为主键、title 取最新
    func updatePage(file: String, title: String) {
        let clean = title.trimmingCharacters(in: .whitespaces)
        if currentPage?.file != file || currentPage?.title != clean {
            currentPage = PageContext(file: file, title: clean)
            pageDirty = true
        }
    }

    /// 预置问题分层:生成课用课程自带问题(规划器按章生成)+ 页面问题兜底;agent-dev 用页面映射
    func presets() -> [String] {
        let pageQs = PRESET_QUESTIONS[currentPage?.file ?? ""]
        if let meta = currentPack, !(meta.starter.isEmpty && meta.chapterQuestions.isEmpty) {
            let merged = (meta.starter + meta.chapterQuestions + (pageQs ?? []))
                .filter { !$0.isEmpty }
            return Array(merged.prefix(6))
        }
        return pageQs ?? DEFAULT_QUESTIONS
    }

    private var process: Process?
    private var stdinHandle: FileHandle?

    private var tutorScript: URL? {
        // 1) App 包内(为便携版预留)
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("tutor/src/tutor.mjs"),
           FileManager.default.fileExists(atPath: bundled.path) {
            return bundled
        }
        // 2) 源码树:.app 本身是一层目录,dist/Agent 学院.app 到 agent-academy 需上溯 3 层;
        //    也兼容 App 直接放在 macos-app/ 下(上溯 2 层)
        for up in [3, 2] {
            var url = Bundle.main.bundleURL
            for _ in 0..<up { url = url.deletingLastPathComponent() }
            let candidate = url.appendingPathComponent("tutor/src/tutor.mjs")
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
        }
        return nil
    }

    private var tutorRoot: URL? { tutorScript?.deletingLastPathComponent().deletingLastPathComponent() }

    private func nodePath() -> String? {
        for c in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
            if FileManager.default.fileExists(atPath: c) { return c }
        }
        return nil
    }

    // GUI 进程不读 ~/.zshrc,自己把 Key 从 shell 配置里找出来传给子进程
    private func findAPIKey() -> String? {
        for rc in ["~/.zshenv", "~/.zprofile", "~/.zshrc"] {
            let path = (rc as NSString).expandingTildeInPath
            guard let s = try? String(contentsOfFile: path, encoding: .utf8) else { continue }
            for line in s.split(separator: "\n") {
                let t = line.trimmingCharacters(in: .whitespaces)
                if t.hasPrefix("#") { continue }
                if t.contains("DEEPSEEK_API_KEY"),
                   let r = t.range(of: #"sk-[A-Za-z0-9_-]{8,}"#, options: .regularExpression) {
                    return String(t[r])
                }
            }
        }
        return nil
    }

    func ensureStarted() {
        guard process == nil, failureReason == nil else { return }
        guard let script = tutorScript, let root = tutorRoot else {
            failureReason = "找不到 tutor 引擎(已探测 App 包内 Resources/tutor,以及 \(Bundle.main.bundleURL.deletingLastPathComponent().path) 上溯目录);请保持 App 在 agent-academy/macos-app/dist/ 下运行"; return
        }
        guard let node = nodePath() else { failureReason = "找不到 Node.js,请先安装(https://nodejs.org)"; return }
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent("node_modules").path) else {
            failureReason = "tutor 依赖未安装:请在终端执行 cd \(root.path) && npm install"; return
        }
        let key = findAPIKey()
        guard key != nil else {
            failureReason = "未找到 DEEPSEEK_API_KEY:请在 ~/.zshenv 或 ~/.zshrc 配置后重启 App"; return
        }

        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = [script.path, "--rpc", "--pack", "packs/\(packName)", "--student", "liam"]
        p.currentDirectoryURL = root
        var env = ProcessInfo.processInfo.environment
        env["DEEPSEEK_API_KEY"] = key
        env["TUTOR_DATA_DIR"] = TutorModel.dataDir().path
        p.environment = env

        let out = Pipe(); let err = Pipe(); let inp = Pipe()
        p.standardOutput = out; p.standardError = err; p.standardInput = inp

        let buf = LineBuffer() // 闭包局部捕获,避免触碰 self 的 actor 隔离
        out.fileHandleForReading.readabilityHandler = { [weak self] h in
            let d = h.availableData
            guard !d.isEmpty else { h.readabilityHandler = nil; return }
            buf.data.append(d)
            while let nl = buf.data.firstIndex(of: 0x0A) {
                let line = buf.data.subdata(in: buf.data.startIndex..<nl)
                buf.data.removeSubrange(buf.data.startIndex...nl)
                if let s = String(data: line, encoding: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] {
                    DispatchQueue.main.async { self?.handle(obj) }
                }
            }
        }
        p.terminationHandler = { [weak self] terminated in
            DispatchQueue.main.async {
                // 只清理仍在位的进程(切换课程重启时,旧进程退出不能动新进程)
                if self?.process === terminated {
                    self?.process = nil
                    self?.stdinHandle = nil
                    self?.thinking = false
                }
            }
        }

        do {
            try p.run()
        } catch {
            failureReason = "启动失败: \(error.localizedDescription)"; return
        }
        process = p
        stdinHandle = inp.fileHandleForWriting
        messages = []
        totalCost = 0
    }

    static func dataDir() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("AgentAcademy", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func handle(_ obj: [String: Any]) {
        switch obj["type"] as? String {
        case "hello":
            requestGreeting() // 引擎就绪,导师主动开场(档案 + 当前页面驱动)
        case "delta":
            let t = obj["text"] as? String ?? ""
            if let last = messages.indices.last, !messages[last].isUser {
                messages[last].text += t
            } else {
                messages.append(TutorChatMessage(isUser: false, text: t))
            }
        case "tool_start":
            let name = obj["name"] as? String ?? "工具"
            let labels = ["lookup_course": "查课程", "get_student_profile": "读学生档案",
                          "record_progress": "记掌握", "record_misconception": "记误解",
                          "update_plan": "更新计划", "run_code": "跑代码"]
            statusText = "\(labels[name] ?? name)…"
        case "tool_end":
            statusText = nil
        case "turn_end":
            totalCost += obj["cost"] as? Double ?? 0
        case "ready":
            thinking = false
            statusText = nil
        case "error":
            messages.append(TutorChatMessage(isUser: false, text: "⚠️ \(obj["message"] as? String ?? "未知错误")"))
            thinking = false
        default:
            break
        }
    }

    func send(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, process != nil, !thinking else { return }
        messages.append(TutorChatMessage(isUser: true, text: t))
        messages.append(TutorChatMessage(isUser: false, text: "")) // 占位,接收流式输出
        thinking = true
        if pageDirty, let p = currentPage { // 先上报页面,再发消息,顺序保证
            writeLine(["type": "context", "page": ["file": p.file, "title": p.title]])
            pageDirty = false
        }
        writeLine(["type": "user", "text": t])
    }

    /// 切换教学包:重启引擎进程(对话清空,档案按包隔离)
    func switchPack(_ name: String) {
        guard name != packName else { return }
        if let p = process { p.terminate() }
        process = nil
        stdinHandle = nil
        thinking = false
        messages = []
        totalCost = 0
        statusText = nil
        failureReason = nil
        pageDirty = false
        if let found = packs.first(where: { $0.name == name }) {
            packTitle = found.title
            currentPack = found
        }
        packName = name
        ensureStarted()
    }

    /// 面板打开(引擎已就绪)或重置后,让导师主动打招呼
    func greetIfIdle() {
        guard process != nil, failureReason == nil, messages.isEmpty, !thinking else { return }
        requestGreeting()
    }

    private func requestGreeting() {
        guard process != nil, !thinking, messages.isEmpty else { return }
        thinking = true
        messages.append(TutorChatMessage(isUser: false, text: "")) // 占位,接收流式开场白
        if pageDirty, let p = currentPage {
            writeLine(["type": "context", "page": ["file": p.file, "title": p.title]])
            pageDirty = false
        }
        writeLine(["type": "greet"])
    }

    func resetConversation() {
        guard process != nil else { return }
        messages = []
        thinking = false
        writeLine(["type": "control", "cmd": "reset"])
        requestGreeting() // 重置后重新开场
    }

    private func writeLine(_ obj: [String: Any]) {
        guard let h = stdinHandle, let d = try? JSONSerialization.data(withJSONObject: obj) else { return }
        // 写入失败(如管道已关闭)静默忽略:进程退出由 terminationHandler 统一收尾
        h.write(d + Data([0x0A]))
    }
}

// MARK: - Markdown 主题(MarkdownUI · gitHub 预设打底,贴面板字号)

extension Theme {
    static var tutorPanel: Theme {
        .gitHub
            .paragraph { config in
                config.label
                    .font(.system(size: 13.5))
                    .lineSpacing(5)
            }
            .heading1 { config in
                config.label.font(.system(size: 16, weight: .semibold))
            }
            .heading2 { config in
                config.label.font(.system(size: 15, weight: .semibold))
            }
            .heading3 { config in
                config.label.font(.system(size: 14, weight: .semibold))
            }
            .code {
                FontFamilyVariant(.monospaced)
                FontSize(.em(0.92))
                ForegroundColor(.purple)
                BackgroundColor(.purple.opacity(0.08))
            }
            .codeBlock { config in
                ScrollView(.horizontal, showsIndicators: false) {
                    config.label
                        .font(.system(size: 12, design: .monospaced))
                        .textSelection(.enabled)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(nsColor: .underPageBackgroundColor))
                .cornerRadius(8)
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(nsColor: .separatorColor).opacity(0.5)))
            }
            .table { config in
                config.label
                    .font(.system(size: 12.5))
            }
    }
}

// MARK: - 侧栏 UI

struct TutorPanel: View {
    @ObservedObject var model: TutorModel
    @State private var draft = ""
    @FocusState private var inputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            chatList
            Divider()
            presetBar
            inputBar
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear {
            model.reloadPacks()
            model.ensureStarted()
            model.greetIfIdle() // 引擎已在跑且没有对话时(如关开面板),也补开场
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "graduationcap.fill").foregroundStyle(.purple)
            Menu {
                ForEach(model.packs, id: \.name) { p in
                    Button {
                        model.switchPack(p.name)
                    } label: {
                        if p.name == model.packName {
                            Label(p.title, systemImage: "checkmark")
                        } else {
                            Text(p.title)
                        }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(model.packTitle).font(.headline).lineLimit(1)
                    Image(systemName: "chevron.down").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .help("切换课程(切换会重启导师会话,学习档案按课程隔离)")
            Spacer()
            if model.totalCost > 0 {
                Text(String(format: "$%.4f", model.totalCost))
                    .font(.caption).foregroundStyle(.secondary)
            }
            Button { model.resetConversation() } label: { Image(systemName: "arrow.counterclockwise") }
                .buttonStyle(.borderless).help("重新开始本轮对话(学习档案保留)")
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private var chatList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if let fail = model.failureReason {
                        Label(fail, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange).font(.callout).padding(12)
                    }
                    ForEach(model.messages) { m in
                        bubble(m).id(m.id)
                    }
                    if let status = model.statusText {
                        HStack(spacing: 6) {
                            ProgressView().controlSize(.small)
                            Text(status).font(.caption).foregroundStyle(.secondary)
                        }.padding(.horizontal, 8)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(12)
            }
            .onChange(of: model.messages.count) { _ in
                withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo("bottom") }
            }
            .onChange(of: model.messages.last?.text) { _ in
                proxy.scrollTo("bottom")
            }
        }
    }

    @ViewBuilder
    private func bubble(_ m: TutorChatMessage) -> some View {
        if m.isUser {
            HStack {
                Spacer(minLength: 40)
                content(m)
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.accentColor.opacity(0.16)))
            }
        } else {
            // 助教消息占满全宽(表格/代码块需要宽度),左侧细竖线做身份标识
            HStack(alignment: .top, spacing: 8) {
                RoundedRectangle(cornerRadius: 2).fill(Color.purple.opacity(0.55)).frame(width: 3)
                content(m)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color(nsColor: .separatorColor).opacity(0.5)))
                Spacer(minLength: 0)
            }
        }
    }

    @ViewBuilder
    private func content(_ m: TutorChatMessage) -> some View {
        if m.text.isEmpty {
            ProgressView().controlSize(.small).padding(.vertical, 2)
        } else {
            Markdown(m.text).markdownTheme(.tutorPanel)
        }
    }

    /// 页面徽章 + 预置问题 chips(点一下填入输入框,可改再发)
    private var presetBar: some View {
        VStack(spacing: 6) {
            if let p = model.currentPage {
                HStack(spacing: 4) {
                    Image(systemName: "book.fill").font(.caption2)
                    Text(p.title.isEmpty ? p.file : p.title).lineLimit(1)
                    Spacer()
                }
                .font(.caption2).foregroundStyle(.secondary)
                .padding(.horizontal, 10)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(model.presets(), id: \.self) { q in
                        Button {
                            draft = q
                            inputFocused = true
                        } label: {
                            Text(q).lineLimit(1)
                                .font(.caption)
                                .padding(.horizontal, 9).padding(.vertical, 5)
                                .background(Capsule().fill(Color.accentColor.opacity(0.10)))
                                .overlay(Capsule().strokeBorder(Color.accentColor.opacity(0.35)))
                        }
                        .buttonStyle(.plain)
                        .help(q)
                    }
                }
                .padding(.horizontal, 10)
            }
        }
        .padding(.vertical, 6)
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField(model.thinking ? "导师回复中…" : "问点什么…", text: $draft, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
                .focused($inputFocused)
                .onSubmit(send)
                .disabled(model.failureReason != nil)
            Button(action: send) {
                Image(systemName: "paperplane.fill")
            }
            .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || model.thinking || model.failureReason != nil)
            .keyboardShortcut(.return, modifiers: .command)
        }
        .padding(10)
    }

    private func send() {
        let t = draft
        draft = ""
        model.send(t)
        inputFocused = true
    }
}
