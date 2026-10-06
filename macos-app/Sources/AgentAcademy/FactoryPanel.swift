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
        case paper = "论文"
        case repo = "仓库"
        case topic = "课题"
        var id: String { rawValue }

        var icon: String {
            switch self {
            case .paper: return "doc.richtext"
            case .repo: return "shippingbox"
            case .topic: return "lightbulb"
            }
        }
        var subtitle: String {
            switch self {
            case .paper: return "PDF → 翻译 + 解读"
            case .repo: return "GitHub 仓库 → 教学包"
            case .topic: return "一句话 → 整门课"
            }
        }
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
    @Published var elapsedSeconds = 0
    /// 运行结束时生成的草稿页文件名(如 full-xxx.html),供主窗口打开
    var generatedPage: String?
    /// 成功完成后回调(App 用于刷新课程菜单)
    var onPacksChanged: (() -> Void)?
    var wasCancelled = false

    private var process: Process?
    private var timer: Timer?
    private var startDate = Date()

    static func validSlug(_ s: String) -> Bool {
        !s.isEmpty && s.range(of: #"^[a-z0-9][a-z0-9-]*$"#, options: .regularExpression) != nil
    }

    var currentSlug: String {
        switch kind {
        case .paper: return paperSlug
        case .repo: return repoSlug
        case .topic: return topicSlug
        }
    }

    private var resolvedSlugValue = ""

    /// 同名课程(教学包或草稿页)是否已存在
    func slugExists(_ s: String) -> Bool {
        guard let root = tutorEngineRoot() else { return false }
        let site = root.deletingLastPathComponent()
        return FileManager.default.fileExists(atPath: root.appendingPathComponent("packs/\(s)").path)
            || FileManager.default.fileExists(atPath: site.appendingPathComponent("full-\(s).html").path)
    }

    /// 第一个可用的 slug(现有名 → -2 → -3 …)
    func nextAvailableSlug() -> String {
        var s = currentSlug
        var n = 2
        while slugExists(s) { s = "\(currentSlug)-\(n)"; n += 1 }
        return s
    }

    /// 决定本次运行的最终 slug:填了改进意见 → 原地重生成;否则冲突时自动加后缀
    private func resolveSlug() {
        if kind == .topic && !feedbackText.isEmpty {
            resolvedSlugValue = currentSlug
            return
        }
        resolvedSlugValue = nextAvailableSlug()
    }

    /// 表单完整性:实时校验(按钮可用性与内联提示共用)
    func formState() -> (ok: Bool, hint: String?) {
        switch kind {
        case .paper:
            if pdfPath.isEmpty { return (false, "先选择论文 PDF") }
            if paperTitle.isEmpty { return (false, "填写论文英文标题") }
            if !FactoryModel.validSlug(paperSlug) { return (false, "slug 只能是小写字母/数字/连字符") }
            return (true, nil)
        case .repo:
            if !repoInput.contains("/") { return (false, "仓库格式:owner/name") }
            if !FactoryModel.validSlug(repoSlug) { return (false, "slug 只能是小写字母/数字/连字符") }
            return (true, nil)
        case .topic:
            if topicText.isEmpty { return (false, "先填写课题") }
            if !FactoryModel.validSlug(topicSlug) { return (false, "slug 只能是小写字母/数字/连字符") }
            return (true, nil)
        }
        // slug 冲突提示(不阻断:自动加后缀或原地重生成)
        if FactoryModel.validSlug(currentSlug) && slugExists(currentSlug) {
            if kind == .topic && !feedbackText.isEmpty {
                return (true, "同名课程已存在:将按改进意见原地重新生成")
            }
            return (true, "同名课程已存在:开始后将自动改用新 slug(\(nextAvailableSlug()))")
        }
        return (true, nil)
    }

    /// 人审清单路径(完成态按钮用)
    var reviewPath: String? {
        switch kind {
        case .paper: return "drafts/\(paperSlug)/REVIEW.md"
        case .repo, .topic: return "packs/\(currentSlug)/REVIEW.md"
        }
    }

    private func buildArgs() -> [String]? {
        resolveSlug()
        switch kind {
        case .paper:
            guard formState().ok else { return nil }
            return ["scripts/make-paper-page.mjs", "--pdf", pdfPath, "--slug", resolvedSlugValue,
                    "--title-en", paperTitle]
        case .repo:
            guard formState().ok else { return nil }
            var a = ["scripts/make-pack-from-repo.mjs", "--repo", repoInput, "--skill", resolvedSlugValue]
            if !repoGoal.isEmpty { a += ["--goal", repoGoal] }
            return a
        case .topic:
            guard formState().ok else { return nil }
            var a = ["scripts/make-course-from-topic.mjs", "--topic", topicText, "--skill", resolvedSlugValue,
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
        guard let scriptArgs = buildArgs() else { return }

        running = true
        wasCancelled = false
        doneMessage = nil
        failureReason = nil
        generatedPage = nil
        logLines = ["$ node \(scriptArgs.joined(separator: " "))"]
        startDate = Date()
        elapsedSeconds = 0
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.running else { return }
                self.elapsedSeconds = Int(Date().timeIntervalSince(self.startDate))
            }
        }

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
                self?.timer?.invalidate()
                self?.running = false
                let ok = terminated.terminationStatus == 0 && !(self?.wasCancelled ?? false)
                if self?.wasCancelled == true {
                    self?.doneMessage = "已取消。部分产物可能不完整,建议删除后重新生成。"
                } else if ok {
                    switch self?.kind {
                    case .paper, .topic: self?.generatedPage = "full-\(self?.resolvedSlugValue ?? "").html"
                    default: self?.generatedPage = nil
                    }
                    self?.doneMessage = "生成完成,耗时 \(self?.elapsedSeconds ?? 0) 秒。请按 REVIEW.md 人审清单核对后再发布。"
                    if self?.kind == .repo || self?.kind == .topic { self?.onPacksChanged?() }
                } else {
                    self?.doneMessage = nil
                    self?.failureReason = "管线退出码 \(terminated.terminationStatus),详见日志"
                }
            }
        }

        do { try p.run() } catch {
            running = false
            timer?.invalidate()
            failureReason = "启动失败: \(error.localizedDescription)"; return
        }
        process = p
    }

    /// 取消运行中的管线
    func cancel() {
        guard running, let p = process else { return }
        wasCancelled = true
        p.terminate()
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
    var onOpenDraft: ((String) -> Void)? // 在主窗口打开草稿页/人审清单

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "factory").foregroundStyle(.purple)
                Text("内容工厂").font(.headline)
                Spacer()
                Button { onDone?() } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.borderless).help("关闭")
            }.padding(12)
            preflightBar.padding(.horizontal, 12).padding(.bottom, 10)
            modeCards.padding(.horizontal, 12)
            Divider().padding(.vertical, 10)
            ScrollView {
                form.padding(.horizontal, 12)
            }
            Divider()
            logArea
            Divider()
            actionBar.padding(12)
        }
        .frame(width: 560, height: 680)
        .onAppear {
            if model.pendingAutoStart {
                model.pendingAutoStart = false
                model.start()
            }
        }
    }

    // 前置条件自检条
    private var preflightBar: some View {
        HStack(spacing: 14) {
            preflightItem("引擎", tutorEngineRoot() != nil)
            preflightItem("Node", findNodePath() != nil)
            preflightItem("API Key", findDeepSeekKey() != nil)
            Spacer()
            Text("产物均为草稿 · 发布走人审").font(.caption2).foregroundStyle(.tertiary)
        }
    }

    private func preflightItem(_ name: String, _ ok: Bool) -> some View {
        HStack(spacing: 3) {
            Image(systemName: ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(ok ? Color.green : Color.red)
            Text(name).font(.caption)
        }
    }

    // 模式选择:三张大卡片
    private var modeCards: some View {
        HStack(spacing: 8) {
            ForEach(FactoryModel.Kind.allCases) { k in
                let selected = model.kind == k
                Button {
                    guard !model.running else { return }
                    model.kind = k
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: k.icon).font(.title3)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(k.rawValue).font(.system(size: 13.5, weight: .semibold))
                            Text(k.subtitle).font(.system(size: 11)).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 10).fill(
                        selected ? Color.accentColor.opacity(0.12) : Color(nsColor: .controlBackgroundColor)))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(
                        selected ? Color.accentColor : Color(nsColor: .separatorColor), lineWidth: selected ? 1.5 : 1))
                }
                .buttonStyle(.plain)
                .disabled(model.running)
            }
        }
    }

    @ViewBuilder
    private var form: some View {
        let state = model.formState()
        VStack(alignment: .leading, spacing: 12) {
            switch model.kind {
            case .paper:
                fieldLabel("论文 PDF")
                HStack {
                    Button("选择 PDF…") { model.pickPDF() }
                        .disabled(model.running)
                    Text(model.pdfPath.isEmpty ? "未选择" : (model.pdfPath as NSString).lastPathComponent)
                        .lineLimit(1).foregroundStyle(.secondary)
                }
                fieldLabel("论文标题(英文)")
                LabeledTextField("ReAct: Synergizing…", $model.paperTitle)
                    .disabled(model.running)
                slugField($model.paperSlug)
                    .disabled(model.running)
            case .repo:
                fieldLabel("GitHub 仓库")
                LabeledTextField("owner/name", $model.repoInput, "mlabonne/llm-course")
                    .disabled(model.running)
                fieldLabel("课程 slug")
                slugField($model.repoSlug)
                    .disabled(model.running)
                fieldLabel("学习目标(可选)")
                LabeledTextField("从训练到部署学透 LLM", $model.repoGoal)
                    .disabled(model.running)
            case .topic:
                fieldLabel("课题")
                LabeledTextField("LLM 从训练到实际部署", $model.topicText)
                    .disabled(model.running)
                fieldLabel("课程 slug")
                slugField($model.topicSlug)
                    .disabled(model.running)
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        fieldLabel("章数")
                        Stepper("\(model.topicChapters) 章", value: $model.topicChapters, in: 4...10)
                            .disabled(model.running)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        fieldLabel("学习目标(可选)")
                        LabeledTextField("从基础到落地", $model.topicGoal)
                            .disabled(model.running)
                    }
                }
                if !model.feedbackText.isEmpty || model.pendingAutoStart {
                    VStack(alignment: .leading, spacing: 4) {
                        fieldLabel("改进意见(本次将落实)")
                        Text(model.feedbackText.isEmpty ? "(运行中)" : model.feedbackText)
                            .font(.caption).foregroundStyle(.orange).lineLimit(2)
                    }
                }
                Text("⚠️ 课题类内容由模型知识生成、无外部引用——REVIEW.md 要求逐条核实后才可发布。")
                    .font(.caption).foregroundStyle(.orange)
            }
            if let hint = state.hint, !model.running {
                Text("· \(hint)").font(.caption).foregroundStyle(.secondary)
            }
            if let f = model.failureReason {
                Label(f, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).font(.callout)
            }
        }
    }

    private func fieldLabel(_ s: String) -> some View {
        Text(s).font(.caption).foregroundStyle(.secondary)
    }

    /// slug 输入框 + 实时校验标记
    private func slugField(_ text: Binding<String>) -> some View {
        let ok = FactoryModel.validSlug(text.wrappedValue)
        return HStack {
            TextField("小写字母/数字/连字符,如 llm-course", text: text)
                .textFieldStyle(.roundedBorder)
            Image(systemName: text.wrappedValue.isEmpty ? "circle.dashed" : (ok ? "checkmark.circle.fill" : "xmark.circle.fill"))
                .foregroundStyle(text.wrappedValue.isEmpty ? Color.secondary : (ok ? Color.green : Color.red))
        }
    }

    private var logArea: some View {
        ScrollViewReader { proxy in
            ScrollView {
                Text(model.logLines.suffix(400).joined(separator: "\n"))
                    .font(.system(size: 11, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .textSelection(.enabled)
            }
            .background(Color(nsColor: .underPageBackgroundColor))
            .frame(height: model.running ? 210 : 150)
            .animation(.easeOut(duration: 0.2), value: model.running)
            .onChange(of: model.logLines.count) { _ in
                proxy.scrollTo("bottom-anchor", anchor: .bottom)
            }
            .overlay(alignment: .bottom) { Color.clear.frame(height: 0).id("bottom-anchor") }
        }
    }

    private var actionBar: some View {
        VStack(spacing: 10) {
            if model.running {
                HStack {
                    ProgressView().controlSize(.small)
                    Text("生成中 · 已用时 \(model.elapsedSeconds)s")
                        .font(.callout).foregroundStyle(.secondary)
                    Spacer()
                    Button("取消", action: { model.cancel() })
                        .buttonStyle(.bordered)
                }
            } else if model.doneMessage != nil {
                HStack {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    Text(model.doneMessage ?? "").font(.callout).lineLimit(2)
                    Spacer()
                }
                HStack {
                    Spacer()
                    if let page = model.generatedPage {
                        Button("📖 打开草稿页") { onOpenDraft?(page) }
                            .buttonStyle(.borderedProminent)
                    }
                    if let review = model.reviewPath {
                        Button("📋 人审清单") { onOpenDraft?(review) }
                            .buttonStyle(.bordered)
                    }
                    Button("完成") { onDone?() }
                        .buttonStyle(.bordered)
                }
            } else {
                HStack {
                    Spacer()
                    Button("开始生成") { model.start() }
                        .buttonStyle(.borderedProminent)
                        .disabled(!model.formState().ok)
                }
            }
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
        TextField(placeholder, text: $text)
            .textFieldStyle(.roundedBorder)
            .font(.system(size: 13.5))
    }
}
