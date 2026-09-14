import AuthenticationServices
import CryptoKit
import SwiftUI

struct SignInProvider: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let available: Bool
}

@MainActor final class NativeSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var anchor: UIWindow?

    func authenticate(provider: String, api: APIClient) async throws -> CloudUser {
        let verifier = try randomToken(), state = try randomToken()
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        struct Start: Decodable, Sendable { let url: URL }
        let start: Start = try await api.request("/auth/native", method: "POST", body: .object(["provider": .string(provider), "challenge": .string(challenge), "state": .string(state)]))
        guard start.url.scheme == api.origin.scheme, start.url.host == api.origin.host, start.url.port == api.origin.port, start.url.path == "/api/auth/native/start" else { throw BudgetEngine.failure("Sign-in could not start. Try again.") }
        anchor = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.filter { $0.activationState == .foregroundActive }.flatMap(\.windows).first { $0.isKeyWindow }
        guard anchor != nil else { throw BudgetEngine.failure("Return to SpentOn to sign in.") }
        defer { session = nil; anchor = nil }
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let browser = ASWebAuthenticationSession(url: start.url, callbackURLScheme: "spenton") { url, error in
                if let error { continuation.resume(throwing: error) }
                else if let url { continuation.resume(returning: url) }
                else { continuation.resume(throwing: BudgetEngine.failure("Sign-in did not finish. Try again.")) }
            }
            browser.presentationContextProvider = self
            browser.prefersEphemeralWebBrowserSession = true
            session = browser
            if !browser.start() { continuation.resume(throwing: BudgetEngine.failure("Sign-in could not open. Try again.")) }
        }
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard callback.scheme == "spenton", callback.host == "auth", items.filter({ $0.name == "state" }).count == 1, items.first(where: { $0.name == "state" })?.value == state else { throw BudgetEngine.failure("This sign-in could not be verified. Start again.") }
        guard let code = items.first(where: { $0.name == "code" })?.value, !items.contains(where: { $0.name == "error" }) else { throw BudgetEngine.failure("Sign-in did not finish. Try again or use your email.") }
        struct Login: Decodable, Sendable { let user: CloudUser }
        let result: Login = try await api.request("/auth/native/exchange", method: "POST", body: .object(["code": .string(code), "verifier": .string(verifier)]))
        return result.user
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor! }
    private func randomToken() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw BudgetEngine.failure("Secure sign-in could not start. Try again.") }
        return Data(bytes).base64URL
    }
}
private extension Data {
    var base64URL: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
}
