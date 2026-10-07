// Agent 学院 · macOS 外壳
// WKWebView + 自定义 academy:// scheme,从 App 包内加载站点文件。
// 相对链接、localStorage(学习进度)、papers PDF 按原样工作;外链交给系统浏览器。
// v1.1:上次阅读位置恢复 · 字号缩放(⌘+/⌘-/⌘0) · 页内查找(⌘F) · 窗口位置记忆
import SwiftUI
import WebKit
import AppKit

private let scheme = "academy"
private let homePath = "/index.html"

// MARK: - 站点文件服务(academy://site/<path> → App 包内 Resources/site/)

final class SiteSchemeHandler: NSObject, WKURLSchemeHandler {
    /// 按序探测的站点根:源码树优先(运行时生成的草稿页立即可见),包内 site 兜底
    private let roots: [URL]

    init(roots: [URL]) {
        self.roots = roots
    }

    private func fileURL(for url: URL) -> URL? {
        guard url.host == "site" || url.host?.isEmpty == true else { return nil }
        var comps = url.pathComponents.filter { $0 != "/" }
        if comps.isEmpty { comps = ["index.html"] }
        guard !comps.contains("..") else { return nil }
        let rel = comps.joined(separator: "/")
        for root in roots {
            let f = root.appendingPathComponent(rel)
            if FileManager.default.fileExists(atPath: f.path) { return f }
        }
        return nil
    }

    private func mime(for file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html", "htm": return "text/html"
        case "css": return "text/css"
        case "js", "mjs": return "application/javascript"
        case "json": return "application/json"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "svg": return "image/svg+xml"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf", "otf": return "font/ttf"
        case "pdf": return "application/pdf"
        case "md": return "text/markdown"
        default: return "application/octet-stream"
        }
    }

    private func respond404(_ task: WKURLSchemeTask) {
        let body = Data("404 Not Found".utf8)
        let resp = HTTPURLResponse(url: task.request.url!, statusCode: 404, httpVersion: "HTTP/1.1",
                                   headerFields: ["Access-Control-Allow-Origin": "*",
                                                  "Content-Type": "text/plain; charset=utf-8"])!
        task.didReceive(resp)
        task.didReceive(body)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let file = fileURL(for: url) else {
            respond404(task); return
        }
        guard FileManager.default.fileExists(atPath: file.path) else {
            respond404(task); return
        }
        do {
            let data = try Data(contentsOf: file)
            let type = mime(for: file)
            let isText = type.hasPrefix("text") || type.hasPrefix("font") ||
                type.contains("javascript") || type.contains("json") || type.contains("svg")
            // HTTPURLResponse + CORS 头:自定义 scheme 的 fetch(XHR)需要 CORS 头,否则页面内 fetch 清单会被拦
            let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Access-Control-Allow-Origin": "*",
                                                      "Content-Type": isText ? type + "; charset=utf-8" : type,
                                                      "Content-Length": String(data.count)])!
            task.didReceive(resp)
            task.didReceive(data)
            task.didFinish()
        } catch {
            respond404(task)
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

// MARK: - WebView 协调器

final class WebViewCoordinator: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    /// 站点根(按序):源码树优先,包内兜底——与 scheme handler 同一探测顺序
    private let siteRoots: [URL]
    private let defaults = UserDefaults.standard
    private var frameAutosaveDone = false
    /// 学生正在读的页面变化时回调(file, 已截短的页面标题)——导师面板用它做页面相关预置问题
    var onPageChange: ((String, String) -> Void)?
    /// 站点页面发出的内部命令深链(host, 参数, 原始 URL)——switch-pack / delete-course / improve-course
    var onCommand: ((String, String, URL?) -> Void)?

    override init() {
        var roots: [URL] = []
        for up in [3, 2] { // dist/Agent 学院.app → agent-academy 上溯 3 层;App 放 macos-app/ 下为 2 层
            var url = Bundle.main.bundleURL
            for _ in 0..<up { url = url.deletingLastPathComponent() }
            if FileManager.default.fileExists(atPath: url.appendingPathComponent("index.html").path) {
                roots.append(url)
            }
        }
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("site") {
            roots.append(bundled)
        }
        // 末位兜底:tutor 引擎根(人审清单 packs/<skill>/REVIEW.md 相对 tutor 根)
        if let tutor = tutorEngineRoot() {
            roots.append(tutor)
        }
        siteRoots = roots
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default() // 持久化:学习进度(localStorage)跨启动保留
        cfg.setURLSchemeHandler(SiteSchemeHandler(roots: siteRoots), forURLScheme: scheme)
        webView = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self // 页面 confirm()/alert() 需要原生委托,否则静默返回 false
        webView.allowsBackForwardNavigationGestures = true
        let savedZoom = defaults.double(forKey: "pageZoom")
        webView.pageZoom = savedZoom > 0 ? CGFloat(savedZoom) : 1.0
        webView.addObserver(self, forKeyPath: #keyPath(WKWebView.title), options: [.new], context: nil)
        webView.addObserver(self, forKeyPath: "URL", options: [.new], context: nil)
        webView.load(URLRequest(url: restoreURL()))
    }

    /// 相对路径 → 实际文件 URL(按站点根顺序探测);不存在返回 nil
    private func siteFileURL(_ rel: String) -> URL? {
        let rel = rel.hasPrefix("/") ? String(rel.dropFirst()) : rel
        for root in siteRoots {
            let f = root.appendingPathComponent(rel)
            if FileManager.default.fileExists(atPath: f.path) { return f }
        }
        return nil
    }

    // 上次读到的页面;站点更新后文件不存在则回学习路径
    private func restoreURL() -> URL {
        if let last = defaults.string(forKey: "lastPage"), !last.isEmpty,
           siteFileURL(last) != nil,
           let url = URL(string: "\(scheme)://site/\(last)") {
            return url
        }
        return URL(string: "\(scheme)://site\(homePath)")!
    }

    func zoom(by factor: CGFloat) {
        webView.pageZoom = min(3.0, max(0.5, webView.pageZoom * factor))
        defaults.set(Double(webView.pageZoom), forKey: "pageZoom")
    }

    func zoomReset() {
        webView.pageZoom = 1.0
        defaults.set(1.0, forKey: "pageZoom")
    }

    // 页内查找:WebKit 的 window.find,重复调用继续找下一处
    func find(_ text: String, backwards: Bool) async -> Bool {
        guard !text.isEmpty, let lit = try? String(data: JSONEncoder().encode(text), encoding: .utf8) else {
            return false
        }
        let js = "window.find(\(lit), false, \(backwards), true, false, false, false)"
        let result = try? await webView.evaluateJavaScript(js)
        return (result as? Bool) ?? false
    }

    func goBack() { webView.goBack() }
    func goForward() { webView.goForward() }

    func goHome() {
        webView.load(URLRequest(url: URL(string: "\(scheme)://site\(homePath)")!))
    }

    /// 在主窗口打开本地生成的草稿页(内容工厂产物)
    func openLocalPage(_ file: String) {
        guard !file.isEmpty else { return }
        webView.load(URLRequest(url: URL(string: "\(scheme)://site/\(file)")!))
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.navigationType == .linkActivated,
           let s = navigationAction.request.url?.scheme, s == "http" || s == "https" {
            NSWorkspace.shared.open(navigationAction.request.url!)
            decisionHandler(.cancel)
            return
        }
        // 站点页面的内部命令深链: academy://switch-pack/<skill> / academy://delete-course/<skill> /
        // academy://improve-course/<skill>?feedback=…&topic=…&chapters=…
        // (不限 navigationType:location.href 程序化跳转也可能是 .other;scheme+host 判定足够)
        if let url = navigationAction.request.url, url.scheme == scheme,
           let host = url.host, host != "site" {
            let arg = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            decisionHandler(.cancel)
            DispatchQueue.main.async { self.onCommand?(host, arg, url) }
            return
        }
        decisionHandler(.allow)
    }

override func observeValue(forKeyPath keyPath: String?, of object: Any?,
                               change: [NSKeyValueChangeKey: Any]?, context: UnsafeMutableRawPointer?) {
        DispatchQueue.main.async { [self] in
            if keyPath == "title", let title = webView.title, !title.isEmpty {
                if !frameAutosaveDone {
                    frameAutosaveDone = true
                    webView.window?.setFrameAutosaveName("AcademyMainWindow")
                }
                webView.window?.title = title
            }
            if keyPath == "URL", let url = webView.url, url.host == "site" {
                defaults.set(url.path, forKey: "lastPage") // 下次启动回到这里
            }
            emitPage() // URL 或标题任一变化都上报一次(标题可能晚于 URL 到达)
        }
    }

    private func emitPage() {
        guard let url = webView.url, url.host == "site" else { return }
        guard let file = url.path.components(separatedBy: "/").last, !file.isEmpty else { return }
        let title = (webView.title ?? "").components(separatedBy: " | ").first ?? ""
        onPageChange?(file, title)
    }
}

// MARK: - WKUIDelegate:让页面里的 confirm()/alert() 弹原生对话框
// (不实现则 confirm() 静默返回 false——草稿页「审核通过/删除」按钮会完全失效)

extension WebViewCoordinator: WKUIDelegate {
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.alertStyle = .warning
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "好")
        alert.runModal()
        completionHandler()
    }
}

// MARK: - SwiftUI 外壳

struct SiteView: NSViewRepresentable {
    let coordinator: WebViewCoordinator
    func makeNSView(context: Context) -> WKWebView { coordinator.webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

@main
struct AgentAcademyApp: App {
    @State private var coordinator = WebViewCoordinator()
    @State private var showFind = false
    @State private var findText = ""
    @State private var findMissed = false
    @State private var showTutor = false
    @State private var showFactory = false
    @StateObject private var tutor = TutorModel()
    @StateObject private var factory = FactoryModel()
    @FocusState private var findFieldFocused: Bool

    var body: some Scene {
        WindowGroup("Agent 学院") {
            HStack(spacing: 0) {
                SiteView(coordinator: coordinator)
                if showTutor {
                    Divider()
                    TutorPanel(model: tutor)
                        .frame(width: 390)
                }
            }
            .frame(minWidth: 1000, minHeight: 660)
            .sheet(isPresented: $showFactory) {
                FactorySheet(model: factory,
                    onDone: { showFactory = false; tutor.reloadPacks() },
                    onOpenDraft: { file in
                        showFactory = false
                        coordinator.openLocalPage(file)
                    })
                // 尺寸由 FactorySheet 内部 frame(560×680)决定,此处不再叠加
            }
            .onAppear {
                // 站点翻页 → 导师面板:上报当前页面,预置问题与教学上下文随之切换
                coordinator.onPageChange = { [weak tutor] file, title in
                    tutor?.updatePage(file: file, title: title)
                }
                // 课程管理页/草稿页深链: 切换课程 / 删除课程 / 按意见重新生成
                coordinator.onCommand = { [weak tutor] cmd, arg, url in
                    guard let tutor else { return }
                    switch cmd {
                    case "switch-pack":
                        showTutor = true
                        tutor.switchPack(arg)
                    case "delete-course":
                        let alert = NSAlert()
                        alert.messageText = "删除课程「\(arg)」?"
                        alert.informativeText = "将同时删除教学包、知识库与草稿页,不可恢复。"
                        alert.addButton(withTitle: "删除")
                        alert.addButton(withTitle: "取消")
                        alert.alertStyle = .warning
                        if alert.runModal() == .alertFirstButtonReturn {
                            if let root = tutor.engineRootURL() {
                                let p = Process()
                                p.executableURL = URL(fileURLWithPath: findNodePath() ?? "/usr/bin/env")
                                p.arguments = [root.appendingPathComponent("scripts/remove-course.mjs").path,
                                               "--skill", arg]
                                p.currentDirectoryURL = root
                                try? p.run()
                            }
                            tutor.reloadPacks()
                            coordinator.webView.reload()
                        }
                    case "factory":
                        showTutor = false
                        if let k = FactoryModel.kindFromLink(arg) { factory.kind = k }
                        showFactory = true
                    case "improve-course":
                        // 草稿页「按意见重新生成」:打开内容工厂(课题标签)预填并自动运行
                        let comps = url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
                        let q = Dictionary(uniqueKeysWithValues: (comps?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
                        showTutor = false
                        factory.prepareTopicImprove(skill: arg,
                                                    topic: q["topic"] ?? arg,
                                                    chapters: Int(q["chapters"] ?? "8") ?? 8,
                                                    feedback: q["feedback"] ?? "")
                        showFactory = true
                    default:
                        break
                    }
                }
            }
                .overlay(alignment: .topTrailing) { findBar }
                .toolbar {
                    ToolbarItemGroup(placement: .navigation) {
                        Button { coordinator.goBack() } label: { Image(systemName: "chevron.left") }
                            .keyboardShortcut("[", modifiers: .command)
                            .help("后退 (⌘[)")
                        Button { coordinator.goForward() } label: { Image(systemName: "chevron.right") }
                            .keyboardShortcut("]", modifiers: .command)
                            .help("前进 (⌘])")
                        Button { coordinator.goHome() } label: { Image(systemName: "house") }
                            .keyboardShortcut("h", modifiers: [.command, .shift])
                            .help("回到学习路径 (⇧⌘H)")
                        Divider()
                        Button { coordinator.zoom(by: 1 / 1.15) } label: { Image(systemName: "minus.magnifyingglass") }
                            .keyboardShortcut("-", modifiers: .command)
                            .help("缩小 (⌘-)")
                        Button { coordinator.zoomReset() } label: { Image(systemName: "1.magnifyingglass") }
                            .keyboardShortcut("0", modifiers: .command)
                            .help("原始字号 (⌘0)")
                        Button { coordinator.zoom(by: 1.15) } label: { Image(systemName: "plus.magnifyingglass") }
                            .keyboardShortcut("=", modifiers: .command)
                            .help("放大 (⌘+)")
                        Divider()
                        Button { toggleFind() } label: { Image(systemName: "magnifyingglass") }
                            .keyboardShortcut("f", modifiers: .command)
                            .help("页内查找 (⌘F)")
                        Divider()
                        Button { showFactory = true } label: { Image(systemName: "shippingbox.fill") }
                            .help("内容工厂:论文 / 仓库 / 课题 → 课程")
                        Divider()
                        Button { toggleTutor() } label: { Image(systemName: "graduationcap.fill") }
                            .keyboardShortcut("t", modifiers: [.command, .shift])
                            .help("导师模式 (⇧⌘T)")
                    }
                }
        }
        .windowResizability(.contentMinSize)
    }

    private func toggleFind() {
        showFind.toggle()
        if showFind { findFieldFocused = true }
    }

    private func toggleTutor() {
        showTutor.toggle()
    }

    @ViewBuilder
    private var findBar: some View {
        if showFind {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("在页面中查找(回车找下一个)", text: $findText)
                    .textFieldStyle(.plain)
                    .frame(width: 220)
                    .focused($findFieldFocused)
                    .onSubmit { runFind(backwards: false) }
                    .onExitCommand { showFind = false }
                    .onAppear { findFieldFocused = true }
                if findMissed {
                    Text("未找到").font(.caption).foregroundStyle(.secondary)
                }
                Divider().frame(height: 16)
                Button { runFind(backwards: true) } label: { Image(systemName: "chevron.up") }
                    .buttonStyle(.borderless)
                    .help("上一个")
                Button { runFind(backwards: false) } label: { Image(systemName: "chevron.down") }
                    .buttonStyle(.borderless)
                    .help("下一个 (回车)")
            }
            .padding(10)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
            .padding(14)
            .shadow(color: .black.opacity(0.18), radius: 5, y: 2)
        }
    }

    private func runFind(backwards: Bool) {
        Task { @MainActor in
            let found = await coordinator.find(findText, backwards: backwards)
            findMissed = !found
        }
    }
}
