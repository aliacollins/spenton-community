import Foundation

final class APIClient: Sendable {
    let origin: URL
    private let session: URLSession
    private let cookies: HTTPCookieStorage?
    init(origin: URL = URL(string: "https://spenton.dev")!, configuration: URLSessionConfiguration = .ephemeral) {
        self.origin = origin
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 30
        // Ephemeral cookies stay within this client. Passwords and sessions are
        // never written into preferences, logs, backups or an embedded browser.
        cookies = configuration.httpCookieStorage
        session = URLSession(configuration: configuration, delegate: RejectRedirects(), delegateQueue: nil)
    }
    func sessionData() throws -> Data {
        let records = (cookies?.cookies(for: origin.appendingPathComponent("api")) ?? []).filter { $0.name.contains("spenton.session_token") }.map(CookieRecord.init)
        return try JSONEncoder().encode(SessionRecord(origin: origin.absoluteString, cookies: records))
    }
    func restoreSession(_ data: Data) throws {
        let records: [CookieRecord]
        if let session = try? JSONDecoder().decode(SessionRecord.self, from: data) {
            guard session.origin == origin.absoluteString else {
                throw APIError(status: 0, code: "SESSION_SERVER", message: "This sign-in belongs to another server. Sign in here again.")
            }
            records = session.cookies
        } else {
            // Production clients before custom-server support used Cloud only.
            guard origin == ServerConnection.cloud else {
                throw APIError(status: 0, code: "SESSION_SERVER", message: "Sign in to this server again.")
            }
            records = try JSONDecoder().decode([CookieRecord].self, from: data)
        }
        for record in records {
            guard record.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == origin.host, record.path == "/api", record.name.contains("spenton.session_token"), record.expires == nil || record.expires! > Date.now else { continue }
            if let cookie = record.cookie { cookies?.setCookie(cookie) }
        }
    }
    func clearSession() { for cookie in cookies?.cookies ?? [] { cookies?.deleteCookie(cookie) } }
    func request<T: Decodable & Sendable>(_ path: String, method: String = "GET", body: JSONValue? = nil, as: T.Type = T.self) async throws -> T {
        let data = try await data(path, method: method, body: body)
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError(status: 502, code: "INVALID_RESPONSE", message: "The service returned an unexpected response. Try again.") }
    }
    @discardableResult func data(_ path: String, method: String = "GET", body: JSONValue? = nil) async throws -> Data {
        guard path.hasPrefix("/"), let url = URL(string: "/api" + path, relativeTo: origin)?.absoluteURL,
              url.scheme == origin.scheme, url.host == origin.host, url.port == origin.port else {
            throw APIError(status: 0, code: "INVALID_URL", message: "The service address is invalid.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body { request.httpBody = try JSONEncoder().encode(body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw APIError(status: 0, code: "CONNECTION_FAILED", message: "Check your connection and try again.") }
        guard (200..<300).contains(response.statusCode) else {
            let payload = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
            throw APIError(status: response.statusCode, code: payload?.error.code ?? "REQUEST_FAILED", message: payload?.error.message ?? "The request could not be completed. Try again.")
        }
        return data
    }
}
private struct SessionRecord: Codable {
    let origin: String
    let cookies: [CookieRecord]
}
private struct CookieRecord: Codable {
    let name: String; let value: String; let domain: String; let path: String; let secure: Bool; let expires: Date?
    init(_ cookie: HTTPCookie) { name = cookie.name; value = cookie.value; domain = cookie.domain; path = cookie.path; secure = cookie.isSecure; expires = cookie.expiresDate }
    var cookie: HTTPCookie? {
        // HTTPCookie treats any nonempty Secure value, including "FALSE", as
        // true. Omit the attribute for a local non-HTTPS development cookie.
        var fields: [HTTPCookiePropertyKey: Any] = [.name: name, .value: value, .domain: domain, .path: path]
        if secure { fields[.secure] = "TRUE" }
        if let expires { fields[.expires] = expires }
        return HTTPCookie(properties: fields)
    }
}
private struct ErrorEnvelope: Decodable { struct Detail: Decodable { let code: String; let message: String }; let error: Detail }
private final class RejectRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
