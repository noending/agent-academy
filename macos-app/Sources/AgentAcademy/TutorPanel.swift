// 导师模式:在侧栏里与《Agent 学院》开发导师对话。
// 通过 Process 启动 tutor 的 --rpc 模式(JSONL 协议),复用学生档案与教学工具。
import SwiftUI
import AppKit

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
]

let DEFAULT_QUESTIONS = [
    "我在当前页面卡住了,帮我讲解重点",
    "给我出一道和本页相关的练习题",
    "用大白话总结这一页",
]

// MARK: - 行缓冲(readabilityHandler 在非主线程回调,独立引用类型避免 actor 隔离冲突;回调串行,无数据竞争)

private final class LineBuffer {
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

    private var pageDirty = false // 页面变化后还没上报过

    /// 学生翻到新页面时由 WebView 回调;标题可能晚到,以 file 为主键、title 取最新
    func updatePage(file: String, title: String) {
        let clean = title.trimmingCharacters(in: .whitespaces)
        if currentPage?.file != file || currentPage?.title != clean {
            currentPage = PageContext(file: file, title: clean)
            pageDirty = true
        }
    }

    func presets() -> [String] {
        PRESET_QUESTIONS[currentPage?.file ?? ""] ?? DEFAULT_QUESTIONS
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
        p.arguments = [script.path, "--rpc", "--student", "liam"]
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
        p.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                self?.process = nil
                self?.stdinHandle = nil
                self?.thinking = false
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

    func resetConversation() {
        guard process != nil else { return }
        messages = []
        thinking = false
        writeLine(["type": "control", "cmd": "reset"])
    }

    private func writeLine(_ obj: [String: Any]) {
        guard let h = stdinHandle, let d = try? JSONSerialization.data(withJSONObject: obj) else { return }
        // 写入失败(如管道已关闭)静默忽略:进程退出由 terminationHandler 统一收尾
        h.write(d + Data([0x0A]))
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
        .onAppear { model.ensureStarted() }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "graduationcap.fill").foregroundStyle(.purple)
            Text("开发导师").font(.headline)
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
        HStack {
            if m.isUser { Spacer(minLength: 40) }
            content(m)
                .padding(10)
                .background(m.isUser ? AnyShapeStyle(Color.accentColor.opacity(0.16))
                                     : AnyShapeStyle(Color(nsColor: .controlBackgroundColor)))
                .cornerRadius(12)
            if !m.isUser { Spacer(minLength: 40) }
        }
    }

    @ViewBuilder
    private func content(_ m: TutorChatMessage) -> some View {
        let rendered = try? AttributedString(
            markdown: m.text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
        if m.text.isEmpty {
            ProgressView().controlSize(.small)
        } else if let r = rendered {
            Text(r).textSelection(.enabled)
        } else {
            Text(m.text).textSelection(.enabled)
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
