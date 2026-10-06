// 内容工厂:在 App 内运行三条内容管线(M1 论文 / M2 仓库 / M3 课题),
// 不需要命令行。生成物:教学包(packs/)、知识库(kb/)、草稿页(full-*.html)。
// 发布仍走人审:REVIEW.md 清单。
import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: - 共用引擎探测(导师与工厂共用)

func findNodePath() -> String? {
    for c in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
        if FileManager.default.fileExists(atPath: c) { return c }
    }
    return nil
}

func findDeepSeekKey() -> String? {
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

/// tutor 引擎根目录(优先包内,回退源码树)
func tutorEngineRoot() -> URL? {
    if let bundled = Bundle.main.resourceURL?.appendingPathComponent("tutor"),
       FileManager.default.fileExists(atPath: bundled.appendingPathComponent("src/tutor.mjs").path) {
        return bundled
    }
    for up in [3, 2] {
        var url = Bundle.main.bundleURL
        for _ in 0..<up { url = url.deletingLastPathComponent() }
        let candidate = url.appendingPathComponent("tutor")
        if FileManager.default.fileExists(atPath: candidate.appendingPathComponent("src/tutor.mjs").path) {
            return candidate
        }
    }
    return nil
}

// MARK: - 工厂运行模型

@MainActor
final class FactoryModel: ObservableObject {
    enum Kind: String, CaseIterable, Identifiable {
        case paper = "论文 → 翻译+解读"
        case repo = "仓库 → 教学包"
        case topic = "课题 → 整门课"
        var id: String { rawValue }
    }

    @Published var kind: Kind = .paper
    // 论文
    @Published var pdfPath = ""
    @Published var paperSlug = ""
    @Published var paperTitle = ""
    // 仓库
    @Published var repoInput = ""
    @Published var repoSlug = ""
    @Published var repoGoal = ""
    // 课题
    @Published var topicText = ""
    @Published var topicSlug = ""
    @Published var topicChapters = 8
    @Published var topicGoal = ""
    @Published var feedbackText = ""   // 按意见重新生成
    var pendingAutoStart = false       // 深链改进:面板打开即运行
    // 运行状态
    @Published var running = false
    @Published var logLines: [String] = []
    @Published var doneMessage: String?
    @Published var failureReason: String?
    /// 运行结束时生成的草稿页文件名(如 full-xxx.html),供主窗口打开
    var generatedPage: String?

    private var process: Process?

    static func validSlug(_ s: String) -> Bool {
        !s.isEmpty && s.range(of: #"^[a-z0-9][a-z0-9-]*$"#, options: .regularExpression) != nil
    }

    private func buildArgs() -> [String]? {
        switch kind {
        case .paper:
            guard FactoryModel.validSlug(paperSlug), !pdfPath.isEmpty, !paperTitle.isEmpty else { return nil }
            return ["scripts/make-paper-page.mjs", "--pdf", pdfPath, "--slug", paperSlug,
                    "--title-en", paperTitle]
        case .repo:
            guard FactoryModel.validSlug(repoSlug), repoInput.contains("/") else { return nil }
            var a = ["scripts/make-pack-from-repo.mjs", "--repo", repoInput, "--skill", repoSlug]
            if !repoGoal.isEmpty { a += ["--goal", repoGoal] }
            return a
        case .topic:
            guard FactoryModel.validSlug(topicSlug), !topicText.isEmpty else { return nil }
            var a = ["scripts/make-course-from-topic.mjs", "--topic", topicText, "--skill", topicSlug,
                     "--chapters", String(topicChapters)]
            if !topicGoal.isEmpty { a += ["--goal", topicGoal] }
            if !feedbackText.isEmpty { a += ["--feedback", feedbackText] }
            return a
        }
    }

    func start() {
        guard process == nil, !running else { return }
        guard let root = tutorEngineRoot() else {
            failureReason = "找不到 tutor 引擎(源码树需在 App 旁边)"; return
        }
        guard let node = findNodePath() else { failureReason = "找不到 Node.js"; return }
        guard let key = findDeepSeekKey() else { failureReason = "未找到 DEEPSEEK_API_KEY(~/.zshenv/.zprofile/.zshrc)"; return }
        guard FactoryModel.validSlug(currentSlug) else { failureReason = "slug 只能是小写字母/数字/连字符"; return }
        guard let scriptArgs = buildArgs() else { failureReason = "请完整填写当前标签的参数"; return }

        let script = root.appendingPathComponent(scriptArgs[0])
        guard FileManager.default.fileExists(atPath: script.path) else {
            failureReason = "管线脚本不存在: \(scriptArgs[0])"; return
        }

        running = true
        doneMessage = nil
        failureReason = nil
        logLines = ["$ node \(scriptArgs.joined(separator: " "))"]

        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = [root.appendingPathComponent(scriptArgs[0]).path] + Array(scriptArgs.dropFirst())
        p.currentDirectoryURL = root
        var env = ProcessInfo.processInfo.environment
        env["DEEPSEEK_API_KEY"] = key
        p.environment = env

        let out = Pipe(); let err = Pipe()
        p.standardOutput = out; p.standardError = err; p.standardInput = Pipe()

        let buf = LineBuffer()
        out.fileHandleForReading.readabilityHandler = { h in
            let d = h.availableData
            guard !d.isEmpty else { h.readabilityHandler = nil; return }
            buf.data.append(d)
            while let nl = buf.data.firstIndex(of: 0x0A) {
                let line = buf.data.subdata(in: buf.data.startIndex..<nl)
                buf.data.removeSubrange(buf.data.startIndex...nl)
                if let s = String(data: line, encoding: .utf8) {
                    DispatchQueue.main.async { self.logLines.append(s) }
                }
            }
        }
        err.fileHandleForReading.readabilityHandler = { h in
            let d = h.availableData
            guard !d.isEmpty else { h.readabilityHandler = nil; return }
            if let s = String(data: d, encoding: .utf8) {
                DispatchQueue.main.async { self.logLines.append("[stderr] " + s.trimmingCharacters(in: .whitespacesAndNewlines)) }
            }
        }
        p.terminationHandler = { [weak self] terminated in
            DispatchQueue.main.async {
                guard self?.process === terminated else { return }
                self?.process = nil
                self?.running = false
                let ok = terminated.terminationStatus == 0
                if ok {
                    switch self?.kind {
                    case .paper, .topic: self?.generatedPage = "full-\(self?.currentSlug ?? "").html"
                    default: self?.generatedPage = nil
                    }
                    self?.doneMessage = "生成完成。请按 REVIEW.md 人审清单核对后再发布。"
                } else {
                    self?.doneMessage = nil
                    self?.failureReason = "管线退出码 \(terminated.terminationStatus),详见日志"
                }
            }
        }

        do { try p.run() } catch {
            running = false
            failureReason = "启动失败: \(error.localizedDescription)"; return
        }
        process = p
    }

    var currentSlug: String {
        switch kind {
        case .paper: return paperSlug
        case .repo: return repoSlug
        case .topic: return topicSlug
        }
    }

    /// 课程管理页「按意见重新生成」深链:预填课题参数,面板打开即自动运行
    func prepareTopicImprove(skill: String, topic: String, chapters: Int, feedback: String) {
        kind = .topic
        topicText = topic
        topicSlug = skill
        topicChapters = chapters
        feedbackText = feedback
        pendingAutoStart = true
        failureReason = nil
        doneMessage = nil
        logLines = []
    }

    func pickPDF() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.pdf]
        panel.message = "选择论文 PDF(建议 open access)"
        if panel.runModal() == .OK, let url = panel.url {
            pdfPath = url.path
            if paperTitle.isEmpty { paperTitle = url.deletingPathExtension().lastPathComponent }
        }
    }
}

// MARK: - 工厂面板 UI

struct FactorySheet: View {
    @ObservedObject var model: FactoryModel
    @Environment(\.dismiss) private var dismiss
    var onDone: (() -> Void)?            // 关闭/刷新(课程列表)
    var onOpenDraft: ((String) -> Void)? // 在主窗口打开草稿页

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "factory").foregroundStyle(.purple)
                Text("内容工厂").font(.headline)
                Spacer()
                Button { onDone?() } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.borderless).help("关闭")
            }.padding(12)
            Divider()
            Picker("管线", selection: $model.kind) {
                ForEach(FactoryModel.Kind.allCases) { k in Text(k.rawValue).tag(k) }
            }
            .pickerStyle(.segmented).padding(12)
            Divider()
            form.padding(12)
            Divider()
            logArea
            Divider()
            HStack {
                Button(model.running ? "运行中…" : "开始生成", action: start)
                    .buttonStyle(.borderedProminent)
                    .disabled(model.running)
                if model.running { ProgressView().controlSize(.small) }
                Spacer()
                if model.running || model.doneMessage != nil,
                   FactoryModel.validSlug(model.currentSlug) {
                    let page = "full-\(model.currentSlug).html"
                    if model.generatedPage == page {
                        Button("在主窗口打开草稿页") { onOpenDraft?(page); onDone?() }
                            .buttonStyle(.bordered)
                    }
                }
            }
            .padding(12)
        }
        .frame(width: 480, height: 560)
        .onAppear {
            if model.pendingAutoStart {
                model.pendingAutoStart = false
                model.start()
            }
        }
    }

    @ViewBuilder
    private var form: some View {
        VStack(alignment: .leading, spacing: 10) {
            switch model.kind {
            case .paper:
                HStack {
                    Button("选择论文 PDF…") { model.pickPDF() }
                    Text(model.pdfPath.isEmpty ? "未选择" : (model.pdfPath as NSString).lastPathComponent)
                        .lineLimit(1).foregroundStyle(.secondary)
                }
                LabeledTextField("标题(英文)", $model.paperTitle, "ReAct: Synergizing…")
                LabeledTextField("slug(小写-)", $model.paperSlug, "react-draft")
                Text("生成 full-<slug>.html 草稿页 + REVIEW.md 人审清单;不会自动发布。")
                    .font(.caption).foregroundStyle(.secondary)
            case .repo:
                LabeledTextField("仓库(owner/name)", $model.repoInput, "mlabonne/llm-course")
                LabeledTextField("slug(小写-)", $model.repoSlug, "llm-course")
                LabeledTextField("学习目标(可选)", $model.repoGoal, "从训练到部署学透 LLM")
                Text("生成教学包 + 专属知识库 + 课程大纲;完成后课程菜单自动出现。")
                    .font(.caption).foregroundStyle(.secondary)
            case .topic:
                LabeledTextField("课题", $model.topicText, "LLM 从训练到实际部署")
                LabeledTextField("slug(小写-)", $model.topicSlug, "llm-deploy")
                HStack {
                    Text("章数").font(.callout)
                    Stepper("\(model.topicChapters)", value: $model.topicChapters, in: 4...10)
                }
                LabeledTextField("学习目标(可选)", $model.topicGoal, "从基础到落地")
                LabeledTextField("改进意见", $model.feedbackText, "如:第 3 章加一个量化对比示例…")
                Text("⚠️ 章节内容由模型知识生成、无外部引用——REVIEW.md 要求逐条核实后才可发布。")
                    .font(.caption).foregroundStyle(.orange)
            }
            if let f = model.failureReason {
                Label(f, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).font(.callout)
            }
            if let d = model.doneMessage {
                Label(d, systemImage: "checkmark.circle").foregroundStyle(.green).font(.callout)
            }
        }
    }

    private var logArea: some View {
        ScrollViewReader { proxy in
            ScrollView {
                Text(model.logLines.suffix(300).joined(separator: "\n"))
                    .font(.system(size: 11, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .textSelection(.enabled)
            }
            .background(Color(nsColor: .underPageBackgroundColor))
            .frame(height: 150)
            .onChange(of: model.logLines.count) { _ in
                proxy.scrollTo("bottom-anchor", anchor: .bottom)
            }
            .overlay(alignment: .bottom) { Color.clear.frame(height: 0).id("bottom-anchor") }
        }
    }

    private func start() { model.start() }
}

struct LabeledTextField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""

    init(_ label: String, _ text: Binding<String>, _ placeholder: String = "") {
        self.label = label
        self._text = text
        self.placeholder = placeholder
    }

    var body: some View {
        HStack {
            Text(label).font(.callout).frame(width: 96, alignment: .leading)
            TextField(placeholder, text: $text).textFieldStyle(.roundedBorder)
        }
    }
}
