import SwiftUI
import AVFoundation
import UIKit

struct PipOnboardingView: View {
    @Environment(AppStore.self) private var store
    var replay = false
    var creatingAccount = false
    @State private var draft: PipSetupDraft?
    @State private var error: String?
    var body: some View {
        Group {
            if let draft = Binding($draft) { PipSetupJourney(draft: draft, replay: replay, creatingAccount: creatingAccount) }
            else if let error { ContentUnavailableView("Pip could not open", systemImage: "exclamationmark.circle", description: Text(error)) }
            else { ProgressView("Opening Pip") }
        }
        .task {
            guard draft == nil else { return }
            do {
                guard replay || store.user != nil else { throw BudgetEngine.failure("Sign in to set up your own budget.") }
                let starters: [PipStarter] = try store.requireEngine().run("onboardingCatalog")
                if draft == nil {
                    draft = PipSetupDraft(userID: store.user?.id ?? "public-pip-lesson", currency: store.overview?.currency ?? Locale.current.currency?.identifier ?? "USD", starters: starters)
                }
            } catch { self.error = error.localizedDescription }
        }
    }
}

private struct PipSetupJourney: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @Binding var draft: PipSetupDraft
    let replay: Bool
    let creatingAccount: Bool
    @State private var narrator = PipNarrator()
    @State private var readAloud = false
    @State private var backwards = false
    @State private var error: String?
    @State private var discarded = false
    @State private var finished = false
    @State private var addingCategory = false
    @State private var addedCategoryID: String?
    @State private var editorID = UUID()
    @FocusState private var focus: Field?
    @AccessibilityFocusState private var headingFocused: Bool
    @AccessibilityFocusState private var categoryFocused: String?
    private var publicLesson: Bool { replay && store.user == nil }
    private enum Field: Hashable { case name, account, balance, category(String) }
    private var frozen: Bool { store.pending != nil || store.busy }
    private var preview: Overview? {
        guard let budget = workingBudget else { return nil }
        return try? store.requireEngine().run("overview", budget: budget)
    }
    private var workingBudget: JSONValue? {
        try? store.requireEngine().run("createOnboarding", command: draft.command(placeholders: true))
    }
    private var categoryCreationBudget: JSONValue? {
        var structure = draft
        for index in structure.categories.indices {
            structure.categories[index].selected = true
            structure.categories[index].amount = ""
        }
        return try? store.requireEngine().run("createOnboarding", command: structure.command(placeholders: true))
    }
    private var moneyLeft: Int64? {
        do {
            let engine = try store.requireEngine()
            let opening: Int64 = try engine.run("parseAmount", command: ["amount": draft.balance])
            var total: Int64 = 0
            for category in draft.selected {
                let amount: Int64 = try engine.run("parseAmount", command: ["amount": category.amount])
                guard amount >= 0 else { return nil }
                let added = total.addingReportingOverflow(amount)
                guard !added.overflow else { return nil }
                total = added.partialValue
            }
            return opening - total
        } catch { return nil }
    }
    private var instruction: String {
        switch draft.step {
        case .welcome: "Try envelope budgeting with pretend money. Then make a plan that fits your life."
        case .currency: replay ? "Choose a currency for this example." : "Choose the currency you use. The example and your budget will use it."
        case .everyday: "This is pretend money. Set aside \(draft.money(70_000)) for everyday needs. Planning keeps the money in your account."
        case .surprises: "Now set aside the remaining \(draft.money(30_000)) for unexpected expenses."
        case .digital: "In SpentOn, envelopes are categories. Set aside is what you planned. Spent is what you used. Left is what remains."
        case .purchase: "Imagine buying \(draft.money(10_000)) of groceries. Choose Everyday needs to record the example purchase."
        case .afterPurchase: "The purchase reduced both your cash and the amount left for everyday needs. Planning alone did not move money."
        case .name: "Give your budget a name you will recognise."
        case .account: "An account tracks where money is held. Start with one bank account or cash wallet. You can add others later."
        case .balance: "Use the balance you have today. Leave future income out. Zero is okay."
        case .categories: "Keep the categories that fit your life. You can add or change them later."
        case .plan: "Set aside money for spending, bills and savings until Available to plan reaches zero. This does not spend or move your money."
        case .review: "Check the account balance and each category amount. Saving creates this budget in your SpentOn account."
        }
    }
    var body: some View {
        NavigationStack {
            Group { if finished { completion } else { scrollingContent } }
            .background(Brand.canvas)
            .navigationTitle(replay ? "Learn with Pip" : "Your first budget")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark", action: closeSetup)
                        .labelStyle(.iconOnly).disabled(store.busy).accessibilityIdentifier("pip-close")
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if focus != nil { Button("Hide keyboard", systemImage: "keyboard.chevron.compact.down") { focus = nil }.labelStyle(.iconOnly) }
                    Button(readAloud ? "Turn Pip’s voice off" : "Turn Pip’s voice on", systemImage: readAloud ? "speaker.wave.2" : "speaker.slash") {
                        readAloud.toggle()
                        if readAloud { playVoice() } else { narrator.stop() }
                    }.labelStyle(.iconOnly).accessibilityIdentifier("pip-sound")
                        .accessibilityValue(narrator.speaking ? "Speaking" : readAloud ? "On" : "Off")
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) { recovery }
            .safeAreaInset(edge: .bottom, spacing: 0) { actions }
            .interactiveDismissDisabled(!replay && !finished)
            .sheet(isPresented: $addingCategory) {
                if let budget = categoryCreationBudget {
                    RecordCreationSheet(kind: .category, base: budget, context: .setup, onUse: { addition in
                        let c = addition.command
                        draft.categories.append(PipSetupCategory(id: addition.id, name: c["name"] ?? "", group: c["group"] ?? "Everyday",
                            icon: c["icon"] ?? "basket", color: c["color"] ?? "sage", parentId: c["parentId"].flatMap { $0.isEmpty ? nil : $0 }, selected: true))
                        if let parent = c["parentId"], let index = draft.categories.firstIndex(where: { $0.id == parent }) { draft.categories[index].selected = true }
                        addedCategoryID = addition.id
                        draft.reviewed = false
                    })
                }
            }
            .task {
                store.beginEditing(editorID)
                if !replay { store.presentingOnboarding = true }
            }
            .task(id: draft.step) {
                narrator.stop()
                if readAloud && scenePhase == .active { playVoice() }
                if UIAccessibility.isVoiceOverRunning { headingFocused = true; return }
                do { try await Task.sleep(for: .milliseconds(220)); guard !Task.isCancelled else { return } } catch { return }
                switch draft.step {
                case .name: focus = .name
                case .account: focus = .account
                case .balance: focus = .balance
                default: break
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { narrator.stop() }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIAccessibility.voiceOverStatusDidChangeNotification)) { _ in
                if UIAccessibility.isVoiceOverRunning { narrator.stop() }
            }
            .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { notification in
                if notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt == AVAudioSession.InterruptionType.began.rawValue { narrator.stop() }
            }
            .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification)) { notification in
                if notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { narrator.stop() }
            }
            .onChange(of: store.lastNotSavedOperationID) { _, id in
                if id == draft.mutationID { draft.mutationID = UUID().uuidString.lowercased() }
            }
            .onDisappear { narrator.stop(); if !replay { store.dropPendingPayload(); store.presentingOnboarding = false }; store.endEditing(editorID) }
            .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: draft.step)
        }
        .overlay {
            if scenePhase != .active {
                Brand.canvas.ignoresSafeArea().overlay {
                    VStack(spacing: 12) {
                        Image("Pip").resizable().scaledToFit().frame(width: 100, height: 100)
                        Text("SpentOn").font(.title2.weight(.semibold))
                    }
                }
            }
        }
    }
    private var scrollingContent: some View {
        ScrollViewReader { scroll in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    heading.id("pip-top")
                    VStack(alignment: .leading, spacing: 20) { content }
                        .disabled(frozen).id(draft.step.isLesson ? "lesson" : String(draft.step.rawValue))
                        .transition(pageTransition)
                    if let error { Notice(message: error).accessibilityIdentifier("pip-error") }
                }.padding(24).frame(maxWidth: 620).frame(maxWidth: .infinity)
            }.scrollDismissesKeyboard(.interactively)
                .onChange(of: draft.step) { scroll.scrollTo("pip-top", anchor: .top) }
                .onChange(of: addingCategory) { _, showing in
                    guard !showing, let id = addedCategoryID else { return }
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.25)) { scroll.scrollTo(id, anchor: .center) }
                    if UIAccessibility.isVoiceOverRunning { categoryFocused = id }
                    addedCategoryID = nil
                }
        }
    }
    private var pageTransition: AnyTransition {
        reduceMotion ? .opacity : .asymmetric(insertion: .move(edge: backwards ? .leading : .trailing).combined(with: .opacity), removal: .opacity)
    }
    @ViewBuilder private var recovery: some View {
        if store.hasPendingSave {
            VStack(spacing: 0) {
                SaveStatusBanner(onReview: { narrator.stop(); dismiss() })
                Button("Close") { store.dropPendingPayload(); narrator.stop(); dismiss() }.frame(minHeight: 44).disabled(store.busy)
            }.background(Brand.surface)
        }
    }
    @ViewBuilder private var heading: some View {
        if draft.step.isLesson && !typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center, spacing: 16) {
                    PipCharacter(moment: characterMoment, event: draft.step.rawValue, word: narrator.word, speaking: narrator.speaking).frame(width: 80, height: 80)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("PRETEND MONEY").font(.caption.weight(.semibold)).foregroundStyle(Brand.secondary)
                        Text(draft.step.heading).font(.system(.title2, design: .rounded, weight: .semibold))
                            .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
                            .accessibilityFocused($headingFocused).accessibilityIdentifier("pip-heading")
                    }
                }
                Text(instruction).font(.callout).foregroundStyle(Brand.secondary).fixedSize(horizontal: false, vertical: true)
            }
        } else { VStack(alignment: draft.step == .welcome ? .center : .leading, spacing: 16) {
            if draft.step == .welcome {
                PipCharacter(moment: .welcome, event: draft.step.rawValue, word: narrator.word, speaking: narrator.speaking)
                    .frame(width: typeSize.isAccessibilitySize ? 130 : 220, height: typeSize.isAccessibilitySize ? 130 : 220)
                    .frame(maxWidth: .infinity)
            } else {
                HStack(alignment: .center, spacing: 14) {
                    PipCharacter(moment: characterMoment, event: draft.step.rawValue, word: narrator.word, speaking: narrator.speaking)
                        .frame(width: typeSize.isAccessibilitySize ? 66 : 96, height: typeSize.isAccessibilitySize ? 66 : 96)
                    Text(draft.step.isLesson ? "PRETEND MONEY" : "YOUR BUDGET")
                    .font(.caption.weight(.semibold)).foregroundStyle(Brand.secondary)
                }
            }
            Text(draft.step.heading).font(.system(.largeTitle, design: .rounded, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(draft.step == .welcome ? .center : .leading)
                .accessibilityAddTraits(.isHeader).accessibilityFocused($headingFocused).accessibilityIdentifier("pip-heading")
            Text(instruction).font(.body).foregroundStyle(Brand.secondary).fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(draft.step == .welcome ? .center : .leading)
            if draft.step.rawValue >= PipSetupDraft.Step.name.rawValue {
                ProgressView(value: Double(draft.step.rawValue - PipSetupDraft.Step.name.rawValue + 1), total: 6)
                    .tint(Brand.sage).accessibilityLabel("Budget setup").accessibilityValue("Step \(draft.step.rawValue - PipSetupDraft.Step.name.rawValue + 1) of 6")
            }
        } }
    }
    private var characterMoment: PipMoment {
        switch draft.step {
        case .welcome, .currency, .everyday: .welcome
        case .surprises, .digital, .afterPurchase: .celebrate
        case .review: .ready
        default: .thinking
        }
    }
    private var completion: some View {
        Group {
            if let data = store.overview {
                BudgetCompletionView(data: data, event: store.lastSave, planned: true, titleID: "pip-finished",
                                     word: narrator.word, speaking: narrator.speaking, sound: !readAloud)
            }
        }
    }
    @ViewBuilder private var content: some View {
        switch draft.step {
        case .welcome:
            Label("Pip’s voice is optional. You can follow every step without sound.", systemImage: "speaker.wave.2")
                .font(.subheadline).foregroundStyle(Brand.secondary).frame(maxWidth: .infinity)
        case .currency:
            VStack(spacing: 0) {
                ForEach(PipSetupDraft.currencies, id: \.self) { currency in
                    Button { draft.currency = currency } label: {
                        HStack { VStack(alignment: .leading) { Text(currency).font(.headline); Text(Locale.current.localizedString(forCurrencyCode: currency) ?? currency).font(.subheadline).foregroundStyle(Brand.secondary) }; Spacer(); if draft.currency == currency { Image(systemName: "checkmark.circle.fill").foregroundStyle(Brand.sage) } }.padding(.vertical, 14).contentShape(Rectangle())
                    }.buttonStyle(ContentRowStyle()).accessibilityAddTraits(draft.currency == currency ? .isSelected : []).accessibilityIdentifier("pip-currency-" + currency)
                    if currency != PipSetupDraft.currencies.last { Divider() }
                }
            }
        case .everyday, .surprises, .digital, .purchase, .afterPurchase:
            PipMoneyLesson(step: draft.step, money: draft.money, advance: go)
        case .name:
            input("Budget name", text: $draft.name, placeholder: "My everyday budget", field: .name)
        case .account:
            input("Account name", text: $draft.accountName, placeholder: "Everyday account", field: .account)
            Picker("Account type", selection: $draft.accountType) {
                Text("Current account or cash").tag("checking")
                Text("Savings account").tag("savings")
            }.pickerStyle(.inline).accessibilityIdentifier("pip-account-type")
            Text("This account is tracked manually. SpentOn does not connect to your bank.").font(.footnote).foregroundStyle(Brand.secondary)
        case .balance:
            input("Current balance", text: $draft.balance, placeholder: "0.00", field: .balance, numeric: true)
            Text(draft.currency + " · Balance today").font(.subheadline).foregroundStyle(Brand.secondary)
        case .categories:
            ForEach(draft.categories.map(\.group).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }, id: \.self) { group in
                VStack(alignment: .leading, spacing: 0) {
                    Text(group).font(.headline).padding(.bottom, 8)
                    ForEach(draft.categories.filter { $0.group == group }) { category in
                        Button { draft.selectCategory(category.id) } label: {
                            HStack(spacing: 12) { CategoryGlyph(icon: category.icon, color: category.color, size: 32); Text(category.name).font(.body); Spacer(); Image(systemName: category.selected ? "checkmark.circle.fill" : "circle").foregroundStyle(category.selected ? Brand.sage : Brand.secondary) }
                                .padding(.vertical, 10).contentShape(Rectangle())
                        }.buttonStyle(ContentRowStyle()).id(category.id)
                            .accessibilityFocused($categoryFocused, equals: category.id)
                            .accessibilityLabel(category.name).accessibilityValue(category.selected ? "Selected" : "Not selected").accessibilityIdentifier("pip-category-" + category.name)
                    }
                }
            }
            Button("Add category", systemImage: "plus") { focus = nil; addingCategory = true }.disabled(categoryCreationBudget == nil)
            Text("\(draft.selected.count) selected").font(.subheadline).foregroundStyle(Brand.secondary)
        case .plan:
            planSummary
            ForEach(draft.categories.indices.filter { draft.categories[$0].selected }, id: \.self) { index in
                VStack(alignment: .leading, spacing: 8) {
                    Label(draft.categories[index].name, systemImage: categorySymbol(draft.categories[index].icon)).font(.headline)
                    HStack(alignment: .center, spacing: 12) {
                        Text(draft.currency).font(.subheadline).foregroundStyle(Brand.secondary)
                        TextField("0.00", text: $draft.categories[index].amount).keyboardType(.decimalPad).font(.title3).monospacedDigit().focused($focus, equals: .category(draft.categories[index].id))
                            .accessibilityLabel("Set aside for " + draft.categories[index].name).accessibilityIdentifier("pip-plan-" + draft.categories[index].name)
                        if let left = moneyLeft, left > 0 {
                            Button { fillRemaining(index) } label: { Image(systemName: "arrow.down.to.line").frame(width: 44, height: 44) }
                                .accessibilityLabel("Set aside remaining money for " + draft.categories[index].name).accessibilityIdentifier("pip-fill-" + draft.categories[index].name)
                        }
                    }.padding(14).background(Brand.surface, in: .rect(cornerRadius: 16))
                }
            }
        case .review:
            if let preview {
                VStack(alignment: .leading, spacing: 16) {
                    LabeledContent("Budget", value: draft.name)
                    LabeledContent("Currency", value: draft.currency)
                    LabeledContent(draft.accountName, value: preview.money(preview.cash))
                    Divider()
                    ForEach(preview.categories) { category in LabeledContent(category.name, value: preview.money(category.available)) }
                    Divider()
                    LabeledContent("Available to plan", value: preview.money(preview.ready)).font(.headline)
                }.padding(18).background(Brand.surface, in: .rect(cornerRadius: 22))
                Toggle("I have reviewed these amounts", isOn: $draft.reviewed).accessibilityIdentifier("pip-reviewed")
            }
        }
    }
    private var planSummary: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Available to plan").font(.subheadline).foregroundStyle(Brand.secondary)
            Text(moneyLeft.map(draft.money) ?? "Check amounts").font(.title.weight(.semibold)).monospacedDigit().contentTransition(.numericText())
                .foregroundStyle((moneyLeft ?? 0) < 0 ? Brand.danger : Brand.ink).accessibilityIdentifier("pip-left")
            if let left = moneyLeft, left < 0 { Text("Reduce category amounts by \(draft.money(-left)) to stay within your cash.").font(.subheadline).foregroundStyle(Brand.danger) }
            if moneyLeft == nil { Text("Enter amounts of zero or more, with up to two decimal places.").font(.subheadline).foregroundStyle(Brand.danger) }
        }
    }
    private func input(_ name: String, text: Binding<String>, placeholder: String, field: Field, numeric: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(name).font(.headline)
            TextField(placeholder, text: text).font(.title3).padding(16).background(Brand.surface, in: .rect(cornerRadius: 18))
                .keyboardType(numeric ? .decimalPad : .default).textInputAutocapitalization(numeric ? .never : .sentences)
                .focused($focus, equals: field).submitLabel(.next).onSubmit(advance).accessibilityLabel(name).accessibilityIdentifier("pip-" + name)
            if !numeric && text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > 80 {
                Text("Use a shorter name, up to 80 characters.").font(.footnote).foregroundStyle(Brand.danger)
            }
            if numeric && !text.wrappedValue.isEmpty {
                let parsed = try? store.requireEngine().run("parseAmount", command: ["amount": text.wrappedValue], as: Int64.self)
                if parsed == nil || (parsed ?? -1) < 0 {
                    Text("Enter zero or more, with up to two decimal places.").font(.footnote).foregroundStyle(Brand.danger)
                }
            }
        }
    }
    private var actions: some View {
        VStack(spacing: 12) {
            if let voiceError = narrator.error {
                Label(voiceError, systemImage: "speaker.slash").font(.caption).foregroundStyle(Brand.secondary)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            if typeSize.isAccessibilitySize || (draft.step != .everyday && draft.step != .surprises && draft.step != .purchase) {
                Button(action: advance) {
                    HStack(spacing: 10) {
                        if store.busy { ProgressView().tint(Brand.secondary) }
                        else { Image(systemName: finished ? "wallet.bifold" : store.pending != nil ? "arrow.clockwise" : draft.step == .review ? "checkmark" : "arrow.right").accessibilityHidden(true) }
                        Text(primaryLabel).font(.headline).fixedSize(horizontal: false, vertical: true)
                    }
                        .frame(maxWidth: .infinity).padding(.vertical, 4)
                }.buttonStyle(.glassProminent).tint(Brand.action)
                    .foregroundStyle(canAdvance && !store.busy && !store.conflict ? Color.white : Brand.secondary).controlSize(.large)
                    .disabled(!canAdvance || store.busy || store.conflict).accessibilityIdentifier(finished ? "pip-open-budget" : "pip-continue")
            }
            if !finished { HStack {
                if draft.step != .welcome { Button("Back") { back() }.frame(minHeight: 44).disabled(frozen).accessibilityIdentifier("pip-back") }
                Spacer(minLength: 8)
                if publicLesson && draft.step != .afterPurchase {
                    Button(creatingAccount ? "Create account" : "Sign in") { narrator.stop(); dismiss() }.frame(minHeight: 44).accessibilityIdentifier("pip-return-to-sign-in")
                } else if draft.step == .welcome && !replay {
                    Button("Set up on my own") {
                        draft.skippedLesson = true
                        go(.currency)
                    }.frame(minHeight: 44).accessibilityIdentifier("pip-skip")
                } else if draft.step == .digital && !replay {
                    Button("Try an example purchase") { go(.purchase) }.frame(minHeight: 44)
                } else if draft.step.isLesson && !replay {
                    Button("Skip example") { draft.skippedLesson = true; go(.name) }.frame(minHeight: 44)
                }
            }.font(.subheadline) }
        }.padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 8).background(Brand.canvas)
    }
    private var primaryLabel: String {
        if finished { return "Open my budget" }
        if store.busy { return "Saving…" }
        if store.pending != nil { return "Retry budget save" }
        switch draft.step {
        case .welcome: return "Start with Pip"
        case .currency: return "Use " + draft.currency
        case .everyday: return "Set aside " + draft.money(70_000)
        case .surprises: return "Set aside " + draft.money(30_000)
        case .purchase: return "Record example purchase"
        case .digital: return replay ? "Try an example purchase" : "Plan your money"
        case .afterPurchase: return publicLesson ? (creatingAccount ? "Continue to create account" : "Continue to sign in") : replay ? "Done" : "Set up my budget"
        case .balance: return "Choose categories"
        case .categories: return "Plan your money"
        case .plan: return "Review my budget"
        case .review: return "Save my budget"
        default: return "Continue"
        }
    }
    private var canAdvance: Bool {
        if finished { return true }
        if store.pending != nil { return !store.conflict }
        switch draft.step {
        case .name: return validName(draft.name)
        case .account: return validName(draft.accountName)
        case .balance: return !draft.balance.isEmpty && moneyLeft != nil && ((try? store.requireEngine().run("parseAmount", command: ["amount": draft.balance], as: Int64.self)) ?? -1) >= 0
        case .categories: return !draft.selected.isEmpty
        case .plan: return moneyLeft == 0 && preview != nil
        case .review: return draft.reviewed && preview != nil
        default: return true
        }
    }
    private func validName(_ name: String) -> Bool { (1...80).contains(name.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count) }
    private func go(_ step: PipSetupDraft.Step) {
        guard !frozen else { return }
        focus = nil; narrator.stop(); backwards = step.rawValue < draft.step.rawValue; error = nil; draft.reviewed = false; draft.step = step
    }
    private func back() {
        if draft.step == .name { go(draft.skippedLesson ? .currency : .digital) }
        else if let step = PipSetupDraft.Step(rawValue: draft.step.rawValue - 1) { go(step) }
    }
    private func advance() {
        guard canAdvance, !store.busy else { return }
        focus = nil
        if finished { narrator.stop(); dismiss(); return }
        if store.pending != nil || draft.step == .review {
            Task {
                if await store.finishOnboarding(draft) {
                    narrator.stop()
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) { finished = true }
                    if readAloud { playVoice() }
                } else { error = store.message ?? "Check save status before entering this budget again." }
            }
            return
        }
        switch draft.step {
        case .welcome: draft.skippedLesson = false; go(.currency)
        case .currency: go(draft.skippedLesson && !replay ? .name : .everyday)
        case .digital: go(replay ? .purchase : .name)
        case .afterPurchase: if replay { narrator.stop(); dismiss() } else { go(.name) }
        default: if let next = PipSetupDraft.Step(rawValue: draft.step.rawValue + 1) { go(next) }
        }
    }
    private func closeSetup() {
        guard !store.busy else { return }
        if !replay { store.dropPendingPayload(); discarded = true }
        narrator.stop(); dismiss()
    }
    private func playVoice() {
        narrator.play(finished ? PipVoiceCatalog.completion : PipVoiceCatalog.clip(for: draft.step, currency: draft.currency, replay: replay))
    }
    private func fillRemaining(_ index: Int) {
        guard let left = moneyLeft, left > 0 else { return }
        do {
            let old: Int64 = try store.requireEngine().run("parseAmount", command: ["amount": draft.categories[index].amount])
            draft.categories[index].amount = NSDecimalNumber(value: old + left).dividing(by: 100).stringValue
            draft.reviewed = false
        } catch { self.error = error.localizedDescription }
    }

}
