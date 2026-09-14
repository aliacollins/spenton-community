import SwiftUI

struct WorkspaceView: View {
    @Environment(AppStore.self) private var store
    @State private var setup = false
    @State private var pip = false
    var body: some View {
        NavigationStack {
            BrandedList {
                if store.budgets.isEmpty {
                    Section {
                        PipCharacter(moment: .welcome).frame(height: 150).frame(maxWidth: .infinity)
                        Text("Make a plan with Pip.").font(.title2.bold())
                        Text("Try the envelope idea with pretend money, then choose how to plan your own. You can skip the lesson.").foregroundStyle(Brand.secondary)
                        Button("Start with Pip", systemImage: "figure.wave") { pip = true }
                            .primaryAction().accessibilityIdentifier("start-pip-setup")
                        Button("Set up my budget", systemImage: "wallet.bifold") { setup = true }.accessibilityHint("Opens quick setup without the lesson")
                    }
                } else {
                    Section("Your budgets") {
                        ForEach(store.budgets) { budget in
                            Button { Task { await store.open(budget.id) } } label: {
                                HStack { Label(budget.name, systemImage: "wallet.bifold"); Spacer(); Image(systemName: "chevron.right").font(.caption) }.padding(.vertical, 12)
                            }.disabled(store.busy)
                        }
                    }
                    Button("Create a budget", systemImage: "plus") { setup = true }
                }
                if let message = store.message { Notice(message: message) }
            }.navigationTitle("Welcome back").scrollContentBackground(.hidden).background(Brand.canvas)
                .sheet(isPresented: $setup) { SetupView() }
                .sheet(isPresented: $pip) { PipOnboardingView() }
                .toolbar { Button("Sign out") { Task { await store.signOut() } }.disabled(store.busy || store.pending != nil) }
        }
    }
}

struct SetupView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var step = 0
    @State private var name = "My budget"
    @State private var currency = Locale.current.currency?.identifier == "INR" ? "INR" : "USD"
    @State private var account = "Everyday account"
    @State private var amount = ""
    @State private var additions: [StructureDraft] = []
    @State private var creating: RecordKind?
    @State private var error: String?
    @State private var discarded = false
    @State private var finished = false
    @State private var startedCreation = false
    @State private var editorID = UUID()
    private var dirty: Bool { !amount.isEmpty || !additions.isEmpty || name != "My budget" || account != "Everyday account" || currency != (Locale.current.currency?.identifier == "INR" ? "INR" : "USD") }
    @FocusState private var inputFocused: Bool
    var body: some View {
        NavigationStack {
            Group {
                if finished, let data = store.overview {
                    BudgetCompletionView(data: data, event: store.lastSave)
                } else {
                BrandedForm {
                Section {
                    Text("Step \(step + 1) of 3").font(.subheadline).foregroundStyle(Brand.secondary)
                    Text(["Make it yours.", "Start with the money you have.", "Ready when you are."][step]).font(.title2.bold())
                }
                if step == 0 {
                    Section("Your budget") {
                        TextField("Budget name", text: $name)
                        Picker("Currency", selection: $currency) { ForEach(["USD", "INR", "EUR", "GBP", "CAD", "AUD"], id: \.self) { Text($0) } }
                    }
                } else if step == 1 {
                    Section {
                        TextField("Account name", text: $account)
                        TextField("Current balance", text: $amount).keyboardType(.decimalPad).accessibilityLabel("Current account balance").focused($inputFocused)
                    } header: { Text("Your first cash account") } footer: { Text("Use the balance shown by your bank today. Leave future income out. This account is tracked manually.") }
                } else {
                    Section("Review before saving") {
                        LabeledContent("Budget", value: name)
                        LabeledContent("Currency", value: currency)
                        LabeledContent("Account", value: account)
                        LabeledContent("Current balance", value: amount.isEmpty ? "0" : amount)
                    }
                    Section("Starter categories") {
                        if let preview { ForEach(preview.categories) { Label($0.name, systemImage: categorySymbol($0.icon)) } }
                        Button("Add category", systemImage: "plus") { creating = .category }
                    }
                    Section("Other accounts") {
                        if let preview { ForEach(Array(preview.accounts.dropFirst())) { Text($0.name) } }
                        Button("Add account", systemImage: "plus") { creating = .account }
                    }
                    Section { Text("Saving creates this budget in your SpentOn account. Any cash set aside for a new card is included. You can plan your categories next.").font(.subheadline) }
                }
                if let error { Text(error).foregroundStyle(Brand.danger) }
                if let message = store.message { Notice(message: message) }
                }
                }
            }.scrollContentBackground(.hidden).background(Brand.canvas).navigationTitle(finished ? "Budget created" : "Your first budget").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(finished ? "Done" : "Cancel") { discarded = true; dismiss() }.disabled(store.busy) }

                }
                .safeAreaInset(edge: .bottom) {
                    HStack(spacing: 16) {
                        if !finished && step > 0 { Button("Back") { inputFocused = false; step -= 1 }.frame(minHeight: 44).disabled(store.busy) }
                        Button(finished ? "Open my budget" : step == 2 ? "Save my budget" : "Continue setup",
                               systemImage: finished ? "wallet.bifold" : step == 2 ? "checkmark" : "arrow.right", action: advance)
                            .primaryAction()
                            .disabled(store.busy || name.trimmingCharacters(in: .whitespaces).isEmpty || account.trimmingCharacters(in: .whitespaces).isEmpty)
                    }.padding(16).frame(maxWidth: .infinity).background(Brand.canvas)
                }
                .editorSaveState(closeAfterRecovery: false)
                .scrollDismissesKeyboard(.interactively)
                .interactiveDismissDisabled(store.busy || (!finished && dirty))
                .sheet(item: $creating) { kind in if let base { RecordCreationSheet(kind: kind, base: base, context: .setup, onUse: { additions.append($0) }) } }

                .onAppear { store.beginEditing(editorID); store.presentingOnboarding = true }
                .onDisappear { store.presentingOnboarding = false; store.endEditing(editorID) }
                .onChange(of: store.savedCount) {
                    if startedCreation, store.lastSave?.kind == .budgetCreated, store.pending == nil { finished = true }
                }
        }
    }
    private var base: JSONValue? { guard let budget: JSONValue = try? store.requireEngine().run("create", command: command) else { return nil }; return try? store.adding(additions, to: budget) }
    private var preview: Overview? { base.flatMap { try? store.requireEngine().run("overview", budget: $0) } }
    var command: [String: String] { ["name": name, "currency": currency, "accountName": account, "amount": amount] }
    private func advance() {
        error = nil; inputFocused = false
        if finished { dismiss(); return }
        if step < 2 {
            if step == 1 {
                do { let _: JSONValue = try store.requireEngine().run("create", command: command) }
                catch { self.error = error.localizedDescription; return }
            }
            step += 1
        } else {
            guard store.pending == nil, store.pendingShared == nil, !store.busy else { return }
            startedCreation = true
            Task {
                if await store.createBudget(command, additions: additions) { finished = true }
                else if store.pending == nil { startedCreation = false }
            }
        }
    }
}

struct SettingsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var pip = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("spenton-haptics-enabled") private var hapticsEnabled = true
    @AppStorage("spenton-sounds-enabled") private var soundsEnabled = true
    @AppStorage("pip-motion-paused") private var pipMotionPaused = false
    @State private var feedbackPreview: SaveFeedback?
    var body: some View {
        NavigationStack {
            BrandedForm {
                Section("Your account") {
                    Label(store.user?.email ?? "", systemImage: "person.crop.circle")
                    Label(store.syncStatus, systemImage: store.sample ? "sparkles" : "icloud").foregroundStyle(Brand.secondary)
                    if !store.sample { Button("Request email verification", systemImage: "envelope.badge") { Task { if await store.accountEmail(store.user?.email ?? "", verification: true) { store.message = "If verification is needed, an email will arrive with a link. Open it to confirm your address." } } }.disabled(store.busy) }
                }
                if !store.sample {
                    Section("Connection") {
                        Label(store.isCloudConnection ? "SpentOn Cloud" : "Self-hosted SpentOn", systemImage: "server.rack")
                        Text(store.serverURL.absoluteString).font(.subheadline).foregroundStyle(Brand.secondary).textSelection(.enabled)
                        Button("Sign out to change server") { Task { await store.signOut(); if store.user == nil { dismiss() } } }.disabled(store.busy)
                    }
                }
                Section {
                    NavigationLink { NotificationSettingsView() } label: { Label("Notifications", systemImage: "bell") }
                    NavigationLink { ReceiptSettingsView() } label: { Label("Bill scanning", systemImage: "doc.text.viewfinder") }
                    Button("Export budget", systemImage: "square.and.arrow.up") { dismiss(); store.exportPresented = true }
                    if !store.sample {
                        Button("Switch budget", systemImage: "wallet.bifold") { store.pauseSync(); store.snapshot = nil; store.overview = nil; dismiss(); Task { do { try await store.loadWorkspace() } catch { store.handle(error) } } }.disabled(store.hasPendingSave || store.busy)
                    }
                }
                Section {
                    Link(destination: store.serverURL.appendingPathComponent("app")) { Label("Open SpentOn on the web", systemImage: "globe") }
                    Link(destination: store.serverURL.appendingPathComponent("privacy")) { Label("Privacy", systemImage: "hand.raised") }
                    Text("Manage savings goals, linked refunds, imports and account deletion in the web app during this early iPhone build.").font(.subheadline).foregroundStyle(Brand.secondary)
                }
                Section("Help") {
                    NavigationLink("Software notices") { SoftwareNoticesView() }
                    Button("Learn with Pip", systemImage: "figure.wave") { pip = true }.accessibilityIdentifier("replay-pip")
                    DisclosureGroup {
                        Text("Check Left in Categories before a purchase. Open a category to add a purchase or move category money with both resulting balances shown.")
                        Text("In Activity, tap a transaction’s status to mark it cleared after your bank completes it. Use Uncleared to see what still needs checking.")
                        Text("In People, split a purchase with one or more people. Accepting a share does not move money. Record a repayment after paying outside SpentOn; the recipient then confirms receipt.")
                    } label: { Label("Everyday budgeting", systemImage: "book") }.font(.subheadline)
                }
                Section {
                    Toggle(isOn: $soundsEnabled) { Label("App sounds", systemImage: "speaker.wave.2") }.accessibilityIdentifier("app-sounds")
                    Toggle(isOn: $hapticsEnabled) { Label("App haptics", systemImage: "hand.tap") }.accessibilityIdentifier("app-haptics")
                    Toggle(isOn: Binding(get: { !pipMotionPaused }, set: { pipMotionPaused = !$0 })) { Label("Pip movement", systemImage: "figure.wave") }.disabled(reduceMotion).accessibilityIdentifier("pip-movement-setting")
                } header: { Text("Interaction") } footer: {
                    Text(reduceMotion ? "Reduce Motion is on, so Pip and celebration effects stay still. App sounds follow Silent Mode. Pip’s voice is controlled separately." : "App sounds and haptics mark completed actions. Sounds follow Silent Mode. Pip’s voice is controlled separately.")
                }
                Button("Preview completion feedback", systemImage: "sparkles") { feedbackPreview = SaveFeedback(id: UUID().uuidString, kind: .budgetCreated) }
                Section { Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { Task { await store.signOut(); if store.user == nil { dismiss() } } }.disabled(store.busy) }
                if let message = store.message { Notice(message: message) }
            }.scrollContentBackground(.hidden).background(Brand.canvas).navigationTitle("Your account").navigationBarTitleDisplayMode(.inline)
                .sheet(isPresented: $pip) { PipOnboardingView(replay: true) }
                .sheet(item: $feedbackPreview) { CompletionPreview(event: $0) }
                .onChange(of: soundsEnabled) { _, enabled in if !enabled { CompletionPlayer.shared.stopSound() } }
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
