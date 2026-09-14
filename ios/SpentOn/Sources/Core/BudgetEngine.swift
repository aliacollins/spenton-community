import Foundation
import JavaScriptCore

@MainActor final class BudgetEngine {
    private let context: JSContext
    init() throws {
        guard let context = JSContext() else { throw Self.failure("The budget engine could not start.") }
        self.context = context
        let uuid: @convention(block) () -> String = { UUID().uuidString.lowercased() }
        context.setObject(uuid, forKeyedSubscript: "nativeUUID" as NSString)
        context.evaluateScript("globalThis.crypto = {randomUUID: () => nativeUUID()};")
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle.main
        #endif
        guard let url = bundle.url(forResource: "engine", withExtension: "js") else { throw Self.failure("The budget engine is missing. Rebuild the app.") }
        context.evaluateScript(try String(contentsOf: url, encoding: .utf8))
        guard context.exception == nil else { throw Self.failure("The budget engine could not load.") }
    }
    func run<T: Decodable>(_ action: String, budget: JSONValue? = nil, command: [String: String]? = nil, date: String? = nil, as: T.Type = T.self) throws -> T {
        var request: [String: JSONValue] = ["action": .string(action)]
        if let budget { request["budget"] = budget }
        if let command { request["command"] = .object(command.mapValues(JSONValue.string)) }
        if let date { request["date"] = .string(date) }
        let input = String(decoding: try JSONEncoder().encode(JSONValue.object(request)), as: UTF8.self)
        context.exception = nil
        guard let raw = context.objectForKeyedSubscript("SpentOnEngine")?.objectForKeyedSubscript("run")?.call(withArguments: [input])?.toString(), context.exception == nil else {
            throw Self.failure("The budget could not be verified. Your changes have been kept.")
        }
        let result = try JSONDecoder().decode(EngineResult<T>.self, from: Data(raw.utf8))
        if let error = result.error { throw Self.failure(error) }
        guard let value = result.result else { throw Self.failure("The budget could not be verified.") }
        return value
    }
    nonisolated static func failure(_ message: String) -> APIError { APIError(status: 0, code: "INVALID_BUDGET", message: message) }
}
private struct EngineResult<T: Decodable>: Decodable { let result: T?; let error: String? }
