// swift-tools-version:5.6
// 本地 vendored 版:依赖改为路径引用,snapshot-testing 测试目标已裁掉(离线构建)

import PackageDescription

let package = Package(
  name: "swift-markdown-ui",
  platforms: [
    .macOS(.v12),
    .iOS(.v15),
  ],
  products: [
    .library(
      name: "MarkdownUI",
      targets: ["MarkdownUI"]
    )
  ],
  dependencies: [
    .package(path: "../NetworkImage"),
    .package(path: "../swift-cmark"),
  ],
  targets: [
    .target(
      name: "MarkdownUI",
      dependencies: [
        .product(name: "cmark-gfm", package: "swift-cmark"),
        .product(name: "cmark-gfm-extensions", package: "swift-cmark"),
        .product(name: "NetworkImage", package: "NetworkImage"),
      ]
    ),
  ]
)
