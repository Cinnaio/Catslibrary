// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "ZhiZhouCore",
    platforms: [
        .macOS(.v13),
        .iOS(.v17),
    ],
    products: [
        .library(name: "ZhiZhouCore", targets: ["ZhiZhouCore"]),
    ],
    targets: [
        .target(name: "ZhiZhouCore"),
        .testTarget(name: "ZhiZhouCoreTests", dependencies: ["ZhiZhouCore"]),
    ]
)
