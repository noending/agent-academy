// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AgentAcademy",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(path: "Vendor/swift-markdown-ui"),
    ],
    targets: [
        .executableTarget(
            name: "AgentAcademy",
            dependencies: [
                .product(name: "MarkdownUI", package: "swift-markdown-ui"),
            ],
            path: "Sources/AgentAcademy"
        )
    ]
)
