import Foundation
import JavaScriptCore

/// Runs the bundled, pure Web reducer. No WebView, remote scripts or network bridge.
@MainActor
final class ReaderEdgeRuntime {
    enum RuntimeError: LocalizedError {
        case unavailable
        var errorDescription: String? { "节拍规则暂时无法加载，请重新打开阅读器。" }
    }

    private let context: JSContext
    private let bridge: JSValue
    private let decoder = JSONDecoder()

    init(bundle: Bundle = .main) throws {
        guard let url = bundle.url(forResource: "ReaderEdgeRuntime", withExtension: "js"),
              let context = JSContext() else { throw RuntimeError.unavailable }
        let source = try String(contentsOf: url, encoding: .utf8)
        context.evaluateScript(source, withSourceURL: url)
        guard context.exception == nil,
              let bridge = context.objectForKeyedSubscript("ReaderEdgeBridge"),
              !bridge.isUndefined, !bridge.isNull else { throw RuntimeError.unavailable }
        self.context = context
        self.bridge = bridge
    }

    func catalog() throws -> ReaderEdgeCatalog {
        try call("catalog", arguments: [])
    }

    func loadData(_ raw: String?) throws -> ReaderEdgeLoadedData {
        try call("loadData", arguments: [raw ?? ""])
    }

    func normalize(_ settings: ReaderEdgeSettings) throws -> ReaderEdgeSettings {
        let raw = try JSONEncoder().encode(settings)
        return try call("normalizeSettings", arguments: [String(decoding: raw, as: UTF8.self)])
    }

    func dispatch(_ action: [String: Any]) throws -> ReaderEdgeSession? {
        let raw = try JSONSerialization.data(withJSONObject: action)
        return try call("dispatch", arguments: [String(decoding: raw, as: UTF8.self)])
    }

    private func call<Value: Decodable>(_ method: String, arguments: [Any]) throws -> Value {
        context.exception = nil
        let result = bridge.invokeMethod(method, withArguments: arguments)
        guard context.exception == nil, let result, result.isString,
              let raw = result.toString()?.data(using: .utf8) else { throw RuntimeError.unavailable }
        return try decoder.decode(Value.self, from: raw)
    }
}
