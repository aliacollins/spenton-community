import Foundation

enum ServerConnection {
    static let cloud = URL(string: "https://spenton.dev")!
    static func origin(_ input: String) throws -> URL {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: text), parts.scheme?.lowercased() == "https",
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil,
              parts.path.isEmpty || parts.path == "/",
              parts.query == nil, parts.fragment == nil,
              parts.port == nil || (1...65535).contains(parts.port!) else {
            throw APIError(status: 0, code: "SERVER_ADDRESS", message: "Enter an HTTPS server address without a path, password or query.")
        }
        parts.scheme = "https"; parts.host = host.lowercased(); parts.path = ""
        if parts.port == 443 { parts.port = nil }
        guard let url = parts.url else { throw APIError(status: 0, code: "SERVER_ADDRESS", message: "Enter a valid HTTPS server address.") }
        return url
    }
}
