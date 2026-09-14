import SwiftUI

struct ServerConnectionView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var error: String?
    @FocusState private var focused: Bool
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Label("Your server. Your budgets.", systemImage: "server.rack").font(.title2.weight(.semibold))
                    Text("Connect the SpentOn app to an installation you operate or trust. Sign in with your account on that server after the connection is checked.").foregroundStyle(Brand.secondary)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Server address").font(.subheadline.weight(.semibold))
                        TextField("https://budget.example.com", text: $address)
                            .keyboardType(.URL).textContentType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .focused($focused).submitLabel(.go).onSubmit(connect)
                            .onChange(of: address) { error = nil }
                            .padding(16).background(Brand.surface, in: .rect(cornerRadius: 16))
                            .accessibilityLabel("Server address").accessibilityIdentifier("server-address")
                    }
                    Text("The address must use valid HTTPS. Your account and budgets stay on the selected server. Switching connections does not move data.").font(.subheadline).foregroundStyle(Brand.secondary)
                    if let error { Label(error, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(Brand.danger).accessibilityIdentifier("server-error") }
                    Button(action: connect) {
                        HStack { if store.busy { ProgressView() }; Text(store.busy ? "Checking server…" : "Connect to server").frame(maxWidth: .infinity) }
                    }.primaryAction().disabled(address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.busy).accessibilityIdentifier("connect-server")
                    Button("Use SpentOn Cloud") { connectTo(ServerConnection.cloud.absoluteString) }.frame(minHeight: 44).disabled(store.busy)
                }.padding(24).frame(maxWidth: 500).frame(maxWidth: .infinity)
            }.background(Brand.canvas).scrollDismissesKeyboard(.interactively)
                .navigationTitle("Self-hosted").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(store.busy) } }
                .interactiveDismissDisabled(store.busy)
        }
    }
    private func connect() { connectTo(address) }
    private func connectTo(_ value: String) {
        guard !store.busy else { return }
        focused = false; error = nil
        Task {
            do { try await store.selectServer(value); dismiss() }
            catch { self.error = error.localizedDescription }
        }
    }
}
