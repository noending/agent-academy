// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AgentAcademy",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "AgentAcademy", path: "Sources/AgentAcademy")
    ]
)
