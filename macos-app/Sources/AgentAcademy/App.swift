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
    private let siteRoot: URL

    init(siteRoot: URL) {
        self.siteRoot = siteRoot
    }

    private func fileURL(for url: URL) -> URL? {
        guard url.host == "site" || url.host?.isEmpty == true else { return nil }
        var comps = url.pathComponents.filter { $0 != "/" }
        if comps.isEmpty { comps = ["index.html"] }
        guard !comps.contains("..") else { return nil }
        return siteRoot.appendingPathComponent(comps.joined(separator: "/"))
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
        let resp = URLResponse(url: task.request.url!, mimeType: "text/plain",
                               expectedContentLength: body.count, textEncodingName: "utf-8")
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
            let resp = URLResponse(url: url, mimeType: type, expectedContentLength: data.count,
                                   textEncodingName: isText ? "utf-8" : nil)
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
    private let siteRoot: URL
    private let defaults = UserDefaults.standard
    private var frameAutosaveDone = false

    override init() {
        siteRoot = Bundle.main.resourceURL!.appendingPathComponent("site")
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default() // 持久化:学习进度(localStorage)跨启动保留
        cfg.setURLSchemeHandler(SiteSchemeHandler(siteRoot: siteRoot), forURLScheme: scheme)
        webView = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        let savedZoom = defaults.double(forKey: "pageZoom")
        webView.pageZoom = savedZoom > 0 ? CGFloat(savedZoom) : 1.0
        webView.addObserver(self, forKeyPath: #keyPath(WKWebView.title), options: [.new], context: nil)
        webView.addObserver(self, forKeyPath: "URL", options: [.new], context: nil)
        webView.load(URLRequest(url: restoreURL()))
    }

    // 上次读到的页面;站点更新后文件不存在则回学习路径
    private func restoreURL() -> URL {
        if let last = defaults.string(forKey: "lastPage"), !last.isEmpty {
            let file = siteRoot.appendingPathComponent(last)
            if FileManager.default.fileExists(atPath: file.path),
               let url = URL(string: "\(scheme)://site\(last.hasPrefix("/") ? "" : "/")\(last)") {
                return url
            }
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

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.navigationType == .linkActivated,
           let s = navigationAction.request.url?.scheme, s == "http" || s == "https" {
            NSWorkspace.shared.open(navigationAction.request.url!)
            decisionHandler(.cancel)
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
        }
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
    @StateObject private var tutor = TutorModel()
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
