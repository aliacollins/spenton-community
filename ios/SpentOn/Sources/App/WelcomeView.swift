import SwiftUI
import AuthenticationServices

struct WelcomeView: View {
    @Environment(AppStore.self) private var store
    var restoring = false
    @State private var email = ""
    @State private var password = ""
    @State private var creating = false
    @State private var verification = false
    @State private var forgot = false
    @State private var providers: [SignInProvider] = []
    @State private var providerError = false
    @State private var emailSent = false
    @State private var learning = false
    @State private var serverSelection = false
    @State private var learningReturnFocus: Field?
    @FocusState private var focused: Field?
    private enum Field { case email, password }
    private var canSubmit: Bool { !email.isEmpty && !password.isEmpty && !(creating && !verification && password.count < 12) && !store.busy }
    private var submitLabel: String {
        if store.busy { return creating && !verification ? "Creating account…" : "Signing in…" }
        return creating && !verification ? "Create account" : "Sign in"
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack(spacing: 9) { Image("BrandMark").resizable().scaledToFit().frame(width: 27, height: 27).accessibilityHidden(true); Text("SpentOn").font(.title3.weight(.semibold)); Spacer(); Image("Pip").resizable().scaledToFit().frame(width: 78, height: 78).accessibilityHidden(true) }
                    HStack(alignment: .center) {
                        VStack(alignment: .leading, spacing: 4) {
                            Label(store.isCloudConnection ? "SpentOn Cloud" : "Your SpentOn server", systemImage: store.isCloudConnection ? "cloud" : "server.rack").font(.subheadline.weight(.semibold))
                            if !store.isCloudConnection { Text(store.serverURL.host ?? "").font(.caption).foregroundStyle(Brand.secondary) }
                        }
                        Spacer()
                        if !restoring { Button(store.isCloudConnection ? "Self-hosted" : "Change server") { password = ""; serverSelection = true }.font(.subheadline).frame(minHeight: 44).disabled(store.busy).accessibilityIdentifier("choose-server") }
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text(verification ? "Check your email." : restoring ? "Welcome back." : creating ? "Create your account." : "Plan your money.").font(.system(.title, design: .rounded, weight: .semibold))
                        Text(verification ? "Open the verification link sent to \(email), then return here to sign in." : restoring ? "Sign in to the same account to check your saved records." : creating ? "Create an account to save your budget and keep it in sync." : "Sign in to see your budgets across your devices.").font(.subheadline).foregroundStyle(Brand.secondary)
                    }
                    if !restoring && !verification {
                        Button("Try budgeting with Pip", systemImage: "figure.wave") {
                            learningReturnFocus = focused; focused = nil; learning = true
                        }.font(.subheadline.weight(.medium)).frame(minHeight: 44)
                            .disabled(store.busy)
                            .accessibilityIdentifier("try-pip-before-sign-in")
                            .accessibilityHint("Explore the pretend-money lesson without an account.")
                    }
                    if !verification && !providers.isEmpty {
                        VStack(spacing: 10) {
                            ForEach(providers.sorted { ($0.id == "apple" ? 0 : $0.id == "google" ? 1 : 2) < ($1.id == "apple" ? 0 : $1.id == "google" ? 1 : 2) }) { provider in
                                ProviderSignInButton(provider: provider) { focused = nil; Task { await store.signIn(provider: provider.id) } }.disabled(store.busy)
                            }
                            HStack { Rectangle().frame(height: 0.5); Text("or use email").font(.caption).fixedSize(); Rectangle().frame(height: 0.5) }.foregroundStyle(Brand.secondary).padding(.top, 8)
                        }
                    }
                    if verification {
                        Label(emailSent ? "A new link has been requested." : "Your password stays on this screen only.", systemImage: "envelope").font(.subheadline).foregroundStyle(Brand.sage)
                        Button("Send another verification email", systemImage: "envelope.badge") { Task { emailSent = await store.accountEmail(email, verification: true) } }.font(.subheadline).frame(minHeight: 44).disabled(store.busy || emailSent)
                    }
                    VStack(spacing: 0) {
                        TextField("Email address", text: $email).textContentType(creating ? .emailAddress : .username).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().focused($focused, equals: .email).submitLabel(.next).onSubmit { focused = .password }.padding(16).accessibilityLabel("Email address")
                        Divider().padding(.horizontal, 16)
                        SecureField("Password", text: $password).textContentType(.password).textInputAutocapitalization(.never).autocorrectionDisabled().focused($focused, equals: .password).submitLabel(.go).onSubmit(submit).padding(16).accessibilityLabel("Password")
                    }.background(Brand.surface, in: .rect(cornerRadius: 18)).disabled(store.busy)
                    if creating && !verification { Text("Use at least 12 characters.").font(.caption).foregroundStyle(Brand.secondary).accessibilityIdentifier("password-guidance") }
                    if let message = store.message { Text(message).font(.subheadline).foregroundStyle(Brand.danger).accessibilityAddTraits(.updatesFrequently) }
                    Button(action: submit) {
                        HStack { Spacer(); if store.busy { ProgressView().tint(Brand.secondary) }; Text(submitLabel).font(.body.weight(.semibold)); Spacer() }.padding(.vertical, 7)
                    }.buttonStyle(.glassProminent).tint(Brand.action).foregroundStyle(canSubmit ? Color.white : Brand.secondary)
                        .controlSize(.large).disabled(!canSubmit).accessibilityLabel(creating && !verification ? "Create account" : "Sign in")
                        .accessibilityValue(store.busy ? submitLabel : "")
                    if !creating || verification {
                        Button("Forgot your password?", systemImage: "key") { focused = nil; forgot = true }.font(.subheadline).frame(maxWidth: .infinity, minHeight: 44).disabled(store.busy)
                        if store.message?.contains("Verify your email") == true {
                            Button("Send verification email", systemImage: "envelope.badge") { Task { emailSent = await store.accountEmail(email, verification: true); if emailSent { verification = true } } }.font(.subheadline).disabled(store.busy)
                        }
                    }
                    if !restoring {
                        Button(creating || verification ? "Already have an account? Sign in" : "New to SpentOn? Create an account") { creating.toggle(); verification = false; password = ""; store.message = nil }.font(.subheadline.weight(.medium)).frame(maxWidth: .infinity, minHeight: 44).disabled(store.busy).accessibilityIdentifier("auth-switch-mode")
                        if creating && !verification { Text(.init("By creating an account, you agree to the [Terms](\(store.serverURL.appendingPathComponent("terms").absoluteString)) and [Privacy Notice](\(store.serverURL.appendingPathComponent("privacy").absoluteString)).")).font(.caption).foregroundStyle(Brand.secondary) }
                    }
                    if restoring {
                        Button("Sign out on this device") { Task { await store.signOut() } }.frame(minHeight: 44).disabled(store.busy)
                    }
                    if providerError {
                        Button("Retry other sign-in options") { Task { await loadProviders() } }.font(.caption).frame(minHeight: 44).disabled(store.busy)
                    }
                }.padding(.horizontal, 24).padding(.vertical, 16).frame(maxWidth: 460).frame(maxWidth: .infinity)
            }.scrollDismissesKeyboard(.interactively).background(Brand.canvas)
                .toolbar { if focused != nil { ToolbarItem(placement: .topBarTrailing) { Button("Hide keyboard", systemImage: "keyboard.chevron.compact.down") { focused = nil }.labelStyle(.iconOnly) } } }
                .task { await loadProviders() }
                .sheet(isPresented: $forgot) { PasswordHelp(email: email) }
                .sheet(isPresented: $serverSelection, onDismiss: {
                    email = ""; password = ""; creating = false; verification = false
                    Task { await store.restoreSignIn(); if store.user == nil { await loadProviders() } }
                }) { ServerConnectionView() }
                .sheet(isPresented: $learning, onDismiss: {
                    if store.user == nil { focused = learningReturnFocus }
                    learningReturnFocus = nil
                }) { PipOnboardingView(replay: true, creatingAccount: creating) }
        }
    }
    private func loadProviders() async {
        do { providers = try await store.providers(); providerError = false } catch is CancellationError { } catch { providerError = true }
    }
    private func submit() {
        guard canSubmit else { return }
        focused = nil
        let entered = password
        Task {
            if creating && !verification { verification = await store.register(email: email, password: entered) }
            else { await store.signIn(email: email, password: entered) }
            if store.user != nil && !store.requiresSignIn { password = "" }
        }
    }
}

private struct ProviderSignInButton: View {
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var height = 50
    @ScaledMetric(relativeTo: .body) private var logoSize = 20
    let provider: SignInProvider
    let action: () -> Void
    var body: some View {
        if provider.id == "apple" {
            AppleSignInControl(style: colorScheme == .dark ? .white : .black, action: action)
                .id(colorScheme).frame(maxWidth: .infinity).frame(height: height)
        } else {
            Button(action: action) {
                HStack(spacing: 10) {
                    Image(provider.id == "google" ? "Google" : "Microsoft").resizable().scaledToFit().frame(width: logoSize, height: logoSize).accessibilityHidden(true)
                    Text("Continue with \(provider.name)").font(.body.weight(.medium)).multilineTextAlignment(.center)
                }.padding(.horizontal, 14).padding(.vertical, 10).frame(maxWidth: .infinity, minHeight: height)
                    .foregroundStyle(Brand.ink).background(Brand.surface, in: .rect(cornerRadius: 14))
            }.buttonStyle(ContentRowStyle())
        }
    }
}

// Use Apple's localized control artwork with the existing secure browser handoff.
// This does not invoke native Apple ID authorization or replace server verification.
private struct AppleSignInControl: UIViewRepresentable {
    @Environment(\.isEnabled) private var isEnabled
    let style: ASAuthorizationAppleIDButton.Style
    let action: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(action: action) }
    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .continue, style: style)
        button.cornerRadius = 14
        button.addTarget(context.coordinator, action: #selector(Coordinator.activate), for: .touchUpInside)
        return button
    }
    func updateUIView(_ button: ASAuthorizationAppleIDButton, context: Context) {
        button.isEnabled = isEnabled
        context.coordinator.action = action
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ASAuthorizationAppleIDButton, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? uiView.intrinsicContentSize.width, height: proposal.height ?? 50)
    }
    final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func activate() { action() }
    }
}

private struct PasswordHelp: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var email: String
    @State private var sent = false
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 22) {
                Image(systemName: sent ? "envelope.badge" : "key").font(.largeTitle).foregroundStyle(Brand.sage)
                Text(sent ? "Check your inbox." : "Reset your password.").font(.title2.weight(.semibold))
                Text(sent ? "If this account can receive a reset link, an email will arrive shortly. Open the link to choose a new password, then return to SpentOn." : "We will email you a link to choose a new password.").font(.subheadline).foregroundStyle(Brand.secondary)
                if !sent {
                    TextField("Email address", text: $email).keyboardType(.emailAddress).textContentType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().padding(16).background(Brand.surface, in: .rect(cornerRadius: 16))
                    if let message = store.message { Text(message).font(.subheadline).foregroundStyle(Brand.danger) }
                    Button("Send reset link", systemImage: "envelope") { Task { sent = await store.accountEmail(email, verification: false) } }.primaryAction().disabled(store.busy || email.isEmpty)
                } else { Button("Return to sign in", systemImage: "arrow.left") { dismiss() }.primaryAction() }
                Spacer()
            }.padding(24).frame(maxWidth: .infinity, alignment: .leading).background(Brand.canvas)
                .navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(store.busy) } }
        }.presentationDetents([.large])
    }
}
