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

    private var process: Process?
    private var stdinHandle: FileHandle?

    private var tutorScript: URL? {
        // 优先 App 包内(便携版预留),否则用源码树(dist/Agent 学院.app → ../../tutor)
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("tutor/src/tutor.mjs"),
           FileManager.default.fileExists(atPath: bundled.path) {
            return bundled
        }
        let srcTree = Bundle.main.bundleURL
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("tutor/src/tutor.mjs")
        return FileManager.default.fileExists(atPath: srcTree.path) ? srcTree : nil
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
            failureReason = "找不到 tutor 引擎(需要 agent-academy/tutor 源码目录在 App 旁边)"; return
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
