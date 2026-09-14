import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import VisionKit

struct ReceiptScanView: View {
    @Environment(AppStore.self) private var store
    @Environment(NavigationContext.self) private var navigation
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let openDetails: (QuickEntry) -> Void
    var currentDraft: QuickEntry?
    @State private var text = ""
    @State private var attachment: ReceiptAttachment?
    @State private var photo: PhotosPickerItem?
    @State private var camera = false
    @State private var file = false
    @State private var busy = false
    @State private var available = false
    @State private var imageAvailable = false
    @State private var checkingAvailability = true
    @State private var consentPrompt = false
    @State private var scanSettings = false
    @State private var scanChoice: ReceiptAIChoice = .notAsked
    @State private var aiOriginal: [String] = []
    @State private var active = true
    @State private var error: String?
    @State private var scanID: String?
    @State private var result: ScannedReceipt?
    @State private var merchant = ""
    @State private var amount = ""
    @State private var currency = ""
    @State private var date = ""
    @State private var dueDate = ""
    @State private var paid: Bool?
    @State private var duplicateReviewed = false
    @State private var dateEditing: String?
    @State private var dateDraft = Date.now
    @State private var started = Date.now
    @State private var preparationMs: Double = 0
    @State private var editorID = UUID()

    private var hasSource: Bool { !text.isEmpty || attachment != nil }
    private var dirty: Bool { hasSource || result != nil }
    private var minor: Int64? {
        guard amount.range(of: #"^(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?$"#, options: .regularExpression) != nil,
              let value = Decimal(string: amount), value > 0, value <= 10_000_000_000 else { return nil }
        return NSDecimalNumber(decimal: value * 100).int64Value
    }
    private var duplicate: Bool { guard let budget = store.snapshot?.budget, let minor else { return false }; return ReceiptText.possibleDuplicate(in: budget, amount: minor, date: date, merchant: merchant) }
    private var ready: Bool { minor != nil && currency == store.overview?.currency && ReceiptText.validDate(date) && (paid == true || (paid == false && ReceiptText.validDate(dueDate))) && (!duplicate || duplicateReviewed) }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Label(result == nil ? "From bill to budget" : "Check your bill", systemImage: "doc.text.viewfinder").font(.title3.weight(.semibold)).foregroundStyle(Brand.sage)
                    Group {
                        if scanChoice == .declined && !store.sample {
                            ContentUnavailableView("Bill scanning is off", systemImage: "doc.text.viewfinder", description: Text("Enable it in settings, or enter your purchase manually."))
                            Button("Bill scanning settings", systemImage: "slider.horizontal.3") { scanSettings = true }.buttonStyle(.glass)
                        } else if result == nil { sourceAndConsent } else { review }
                    }
                        .id(result == nil).transition(.opacity).animation(reduceMotion ? nil : .smooth(duration: 0.25), value: result == nil)
                    if let error { Text(error).font(.subheadline).foregroundStyle(Brand.danger).accessibilityIdentifier("scan-error") }
                    if busy { HStack { ProgressView(); Text(scanID == nil ? "Preparing bill image…" : "Reading your bill with Google…").font(.subheadline) } }
                    if let attachment {
                        DisclosureGroup(attachment.pages.count == 1 ? "Bill image" : "Bill images (\(attachment.pages.count) pages)") {
                            ForEach(Array(attachment.pages.enumerated()), id: \.offset) { index, page in
                                if let data = Data(base64Encoded: page), let image = UIImage(data: data) {
                                    Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 360)
                                        .accessibilityLabel("Bill page \(index + 1)")
                                }
                            }
                        }
                    }
                    if !text.isEmpty {
                        DisclosureGroup("Text from your bill") {
                            Text("Keep one bill’s merchant, date, currency, final total and nearby labels. Remove details you don’t want to send.").font(.caption).foregroundStyle(Brand.secondary)
                            TextEditor(text: $text).font(.subheadline).frame(minHeight: 160).padding(8).scrollContentBackground(.hidden).background(Brand.surface, in: .rect(cornerRadius: 16)).accessibilityLabel("Receipt text")
                            if text.utf8.count > ReceiptText.maximumBytes { Text("Shorten this excerpt before using AI. Keep the total and its nearby labels.").font(.caption).foregroundStyle(Brand.danger) }
                        }
                    }
                    if scanID != nil && error != nil {
                        Button("Check previous scan", systemImage: "clock.arrow.circlepath") { recover() }.font(.subheadline).disabled(busy)
                        if store.receiptAIChoice == .allowed { Button("Try AI again", systemImage: "arrow.clockwise") { runScan() }.font(.subheadline).disabled(busy || !available) }
                        Text("Checking does not start another scan. Trying AI again uses another scan from your allowance.").font(.caption).foregroundStyle(Brand.secondary)
                    }
                    if hasSource && scanID == nil && !busy && !store.sample {
                        Button("Try scanning again", systemImage: "arrow.clockwise") {
                            Task { await checkAvailability(); if active { runScan() } }
                        }.buttonStyle(.glass).disabled(checkingAvailability)
                    }
                    if result == nil && !busy && scanChoice != .declined {
                        Button("Enter details manually", systemImage: "pencil") {
                            apply(ScannedReceipt(merchant: currentDraft?.payee, date: currentDraft?.date ?? dateFormatter.string(from: .now), currency: store.overview?.currency, total: currentDraft?.amount, payment: "unknown", uncertain: []))
                        }.buttonStyle(.glass)
                    }
                    if !text.isEmpty { ShareLink("Export bill text", item: text).font(.subheadline) }
                }.padding(20).frame(maxWidth: 600).frame(maxWidth: .infinity)
            }.scrollDismissesKeyboard(.interactively).background(Brand.canvas).disabled(busy && result == nil)
                .navigationTitle("Scan a bill").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly).disabled(busy) } }
                .interactiveDismissDisabled(dirty || busy)
                .sheet(isPresented: $consentPrompt) {
                    ReceiptConsentView(scan: { store.setReceiptAIChoice(.allowed); scanChoice = .allowed; consentPrompt = false; if hasSource && !checkingAvailability { runScan() } }, decline: { store.setReceiptAIChoice(.declined); scanChoice = .declined; consentPrompt = false; dismiss() })
                }
                .sheet(isPresented: $scanSettings, onDismiss: { scanChoice = store.receiptAIChoice }) { NavigationStack { ReceiptSettingsView().toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { scanSettings = false } } } } }
                .fileImporter(isPresented: $file, allowedContentTypes: [.image, .pdf, .plainText]) { outcome in
                    do {
                        let url = try outcome.get(), access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
                        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                        guard size <= 20_000_000 else { throw BudgetEngine.failure("Choose a file under 20 MB, or photograph the total section.") }
                        let data = try Data(contentsOf: url)
                        if url.pathExtension.lowercased() == "txt", let value = String(data: data, encoding: .utf8) { useText(value) }
                        else { read(data, pdf: url.pathExtension.lowercased() == "pdf") }
                    } catch { self.error = error.localizedDescription }
                }
                .sheet(isPresented: Binding(get: { dateEditing != nil }, set: { if !$0 { dateEditing = nil } })) {
                    NavigationStack {
                        Group {
                            if dateEditing == "dueDate" { DatePicker("Due date", selection: $dateDraft, displayedComponents: .date) }
                            else { DatePicker("Purchase date", selection: $dateDraft, in: ...Date.now, displayedComponents: .date) }
                        }.datePickerStyle(.graphical).padding(20).background(Brand.canvas)
                            .navigationTitle(dateEditing == "dueDate" ? "Due date" : "Purchase date").navigationBarTitleDisplayMode(.inline)
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dateEditing = nil } }
                                ToolbarItem(placement: .confirmationAction) { Button("Done") {
                                    let value = dateFormatter.string(from: dateDraft)
                                    if dateEditing == "dueDate" { dueDate = value } else { date = value }; dateEditing = nil
                                } }
                            }
                    }.presentationDetents([.medium, .large])
                }
                .sheet(isPresented: $camera) { ReceiptCamera { data in camera = false; if let data { read(data, pdf: true) } } }
                .onChange(of: photo) { _, value in Task { do { if let data = try await value?.loadTransferable(type: Data.self) { read(data, pdf: false) } } catch { self.error = "The photo could not be opened. Choose another photo or file." } } }
                .onChange(of: amount) { duplicateReviewed = false }
                .onChange(of: date) { duplicateReviewed = false }
                .onChange(of: merchant) { duplicateReviewed = false }
                .task {
                    active = true; store.beginEditing(editorID); scanChoice = store.receiptAIChoice
                    if !store.sample {
                        if scanChoice == .notAsked { consentPrompt = true }
                        await checkAvailability()
                        if active && store.receiptAIChoice == .allowed && hasSource && scanID == nil && result == nil { runScan() }
                    } else { checkingAvailability = false }
                }
                .onDisappear { active = false; store.endEditing(editorID) }
        }
    }
    private var sourceAndConsent: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Choose a clear photo or PDF with the merchant, date and final total visible. Google reads the bill image directly.").font(.subheadline).foregroundStyle(Brand.secondary)
            ViewThatFits(in: .horizontal) {
                HStack { sourceButtons }
                VStack(alignment: .leading) { sourceButtons }
            }
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--receipt-fixture") {
                Button("Read fictional receipt photo") {
                    let lines = "Fictional Cafe\n" + dateFormatter.string(from: .now) + "\nUSD\nSubtotal 20.00\nTax 1.60\nTOTAL 21.60\nCash 30.00\nChange 8.40"
                    let renderer = UIGraphicsImageRenderer(size: CGSize(width: 700, height: 750))
                    let data = renderer.pngData { context in
                        UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 700, height: 750))
                        (lines as NSString).draw(in: CGRect(x: 35, y: 35, width: 630, height: 650), withAttributes: [.font: UIFont.systemFont(ofSize: 34), .foregroundColor: UIColor.black])
                    }
                    read(data, pdf: false)
                }
            }
            #endif
            Button("Paste bill text", systemImage: "doc.on.clipboard") { if let value = UIPasteboard.general.string { useText(value) } }.font(.subheadline).frame(minHeight: 44)
            if store.sample {
                Button("Try a fictional receipt") { text = "Sunday Bookshop\n2026-09-06\nUSD\nSubtotal 20.83\nTax 1.67\nTOTAL 22.50\nCash 30.00\nChange 7.50"; apply(ScannedReceipt(merchant: "Sunday Bookshop", date: "2026-09-06", currency: "USD", total: "22.50", totalLabel: "TOTAL", payment: "unknown", uncertain: [])) }.buttonStyle(.glass)
                Text("This preview uses fictional details and makes no AI request.").font(.caption).foregroundStyle(Brand.secondary)
            } else if checkingAvailability {
                Text("Checking scanning availability…").font(.caption).foregroundStyle(Brand.secondary)
            } else if !imageAvailable && error == nil {
                Text("Google image scanning is currently unavailable. You can enter the details manually.").font(.subheadline).foregroundStyle(Brand.danger)
                    .accessibilityIdentifier("scan-unavailable")
            }
            Text("The final total appears in an editable review. Scans use your saved preference in Account → Bill scanning.").font(.caption).foregroundStyle(Brand.secondary)
        }
    }
    @ViewBuilder private var sourceButtons: some View {
        if VNDocumentCameraViewController.isSupported { Button("Camera", systemImage: "camera") { camera = true }.buttonStyle(.glass) }
        PhotosPicker(selection: $photo, matching: .images) { Label("Photo", systemImage: "photo") }.buttonStyle(.glass)
        Button("File", systemImage: "doc") { file = true }.buttonStyle(.glass)
    }
    private var review: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Check the total after tax and discounts, then choose whether you’ve paid.").font(.subheadline).foregroundStyle(Brand.secondary)
            field("Final total", key: "total", value: $amount, keyboard: .decimalPad)
            if let label = result?.totalLabel { Text("Found beside “\(label)”").font(.caption).foregroundStyle(Brand.secondary) }
            field("Merchant", key: "merchant", value: $merchant)
            field("Currency", key: "currency", value: $currency, keyboard: .asciiCapable)
            if currency != store.overview?.currency { Text("This budget uses \(store.overview?.currency ?? "its own currency"). For a foreign bill, enter the converted total charged to your account and change the currency explicitly.").font(.caption).foregroundStyle(Brand.danger) }
            dateField("Purchase date", key: "date", value: date)
            HStack(spacing: 12) {
                Button { paid = true } label: { Label("I’ve paid", systemImage: paid == true ? "checkmark.circle.fill" : "circle") }.buttonStyle(.glass)
                Button { paid = false } label: { Label("Not paid yet", systemImage: paid == false ? "checkmark.circle.fill" : "circle") }.buttonStyle(.glass)
            }.tint(Brand.sage)
            if paid == false {
                dateField("Due date", key: "dueDate", value: dueDate)
                Text("This becomes an upcoming bill. It won’t change balances or spending until you record payment.").font(.caption).foregroundStyle(Brand.secondary)
            }
            if duplicate {
                Label("A purchase with this amount and date, or a nearby purchase at this merchant, is already recorded.", systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(Brand.danger)
                Toggle(isOn: $duplicateReviewed) { Label("I checked: this is a different purchase", systemImage: "doc.on.doc") }.font(.subheadline).tint(Brand.sage)
            }
            if let currentDraft, !currentDraft.amount.isEmpty || !currentDraft.payee.isEmpty {
                Text("Use these reviewed details to update the amount, merchant and date. Your category, account and note stay in the purchase draft.").font(.caption).foregroundStyle(Brand.secondary)
                if !currentDraft.amount.isEmpty { Text("Current amount: " + currentDraft.amount + " → " + amount).font(.caption).monospacedDigit() }
                if !currentDraft.payee.isEmpty && !merchant.isEmpty && currentDraft.payee != merchant { Text("Current merchant: " + currentDraft.payee + " → " + merchant).font(.caption) }
            }
            Button(currentDraft != nil ? "Use scanned details" : paid == false ? "Choose category for this bill" : "Choose category and account",
                   systemImage: currentDraft != nil ? "checkmark" : "square.grid.2x2") {
                guard let data = store.overview else { return }
                var seed = QuickEntry.parse(amount + " " + merchant, data: data, categoryID: navigation.categoryID, accountID: navigation.accountID)
                seed.amount = amount; seed.payee = merchant; seed.date = paid == false ? dueDate : date
                seed.receiptID = hasSource ? (scanID ?? UUID().uuidString.lowercased()) : nil
                if let user = store.user?.id, let id = seed.receiptID {
                    do { try ReceiptVault.save(ReceiptAttachment(text: text, pages: attachment?.pages ?? []), id: id, user: user) }
                    catch { self.error = "The bill could not be kept on this iPhone. Keep this screen open and try again."; return }
                }
                seed.upcoming = paid == false; seed.userEntered = true
                openDetails(seed)
            }.primaryAction().disabled(!ready)
        }
    }
    private var dateFormatter: DateFormatter { let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f }
    private func dateField(_ title: String, key: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack { Text(title); if result?.uncertain.contains(key) == true { Label("Check this", systemImage: "exclamationmark.circle").foregroundStyle(Brand.danger) } }.font(.caption)
            Button { dateDraft = dateFormatter.date(from: value) ?? .now; dateEditing = key } label: {
                HStack { Text(ReceiptText.validDate(value) ? readableDate(value) : "Choose date"); Spacer(); Image(systemName: "calendar").foregroundStyle(Brand.sage) }.font(.body).padding(14).background(Brand.surface, in: .rect(cornerRadius: 16))
            }.buttonStyle(ContentRowStyle()).accessibilityLabel(title + ", " + (value.isEmpty ? "Choose date" : readableDate(value)))
        }
    }
    private func field(_ title: String, key: String, value: Binding<String>, keyboard: UIKeyboardType = .default) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack { Text(title); if result?.uncertain.contains(key) == true { Label("Check this", systemImage: "exclamationmark.circle").foregroundStyle(Brand.danger) } }.font(.caption)
            TextField(title, text: value).font(key == "total" ? .title2.weight(.semibold) : .body).keyboardType(keyboard).autocorrectionDisabled().textInputAutocapitalization(key == "currency" ? .characters : .words).padding(14).background(Brand.surface, in: .rect(cornerRadius: 16)).accessibilityLabel(title)
        }
    }
    private func read(_ data: Data, pdf: Bool) {
        guard !busy else { return }
        resetSource(); busy = true
        let began = Date.now
        Task {
            do {
                let bill = try await ReceiptReader.read(data, pdf: pdf)
                guard active else { return }
                attachment = bill; busy = false; preparationMs = Date.now.timeIntervalSince(began) * 1000
                if !checkingAvailability { runScan() }
            } catch { if active { busy = false; self.error = error.localizedDescription } }
        }
    }
    private func useText(_ value: String) {
        resetSource()
        text = ReceiptText.excerpt(value)
        if !checkingAvailability { runScan() }
    }
    private func resetSource() {
        text = ""; attachment = nil; scanID = nil; result = nil; error = nil; preparationMs = 0
        merchant = ""; amount = ""; currency = ""; date = ""; dueDate = ""; paid = nil; duplicateReviewed = false
    }
    private func checkAvailability() async {
        checkingAvailability = true
        let capabilities = try? await store.scanCapabilities()
        guard active else { return }
        available = capabilities?.available == true
        imageAvailable = capabilities?.canReadImages == true
        checkingAvailability = false
    }
    private func apply(_ facts: ScannedReceipt) {
        if let value = facts.merchant, !value.isEmpty { merchant = value }
        if let value = facts.total, !value.isEmpty { amount = value }
        if let value = facts.currency, !value.isEmpty { currency = value }
        if let value = facts.date, !value.isEmpty { date = value }
        if let value = facts.dueDate, !value.isEmpty { dueDate = value }
        result = facts; error = nil
    }
    private func receive(_ scan: ReceiptScan) {
        guard active else { return }
        if var facts = scan.result {
            // Never replace something the user edited while AI was running.
            let current = [merchant, amount, currency, date, dueDate]
            if aiOriginal.count == 5 {
                if current[0] != aiOriginal[0] { facts.merchant = nil }
                if current[1] != aiOriginal[1] { facts.total = nil }
                if current[2] != aiOriginal[2] { facts.currency = nil }
                if current[3] != aiOriginal[3] { facts.date = nil }
                if current[4] != aiOriginal[4] { facts.dueDate = nil }
            }
            apply(facts); Task { await store.scanBecameVisible(scan.id, elapsed: Int64(min(600_000, preparationMs + Date.now.timeIntervalSince(started) * 1000))) } }
        else { error = scan.state == "pending" ? "This scan is still processing. Check it again shortly." : "Google couldn’t return complete details. Your bill is still here. Enter the details manually, check the previous scan, or try again." }
    }
    private func runScan() {
        guard active, !busy, hasSource, !store.sample else { return }
        guard store.receiptAIChoice == .allowed else { if store.receiptAIChoice == .notAsked { consentPrompt = true }; return }
        guard available && (attachment == nil || imageAvailable) else { error = "Google scanning is unavailable. Your bill has not been sent. Try again or enter the details manually."; return }
        guard text.utf8.count <= ReceiptText.maximumBytes else { error = "Shorten the bill text before trying again."; return }
        aiOriginal = [merchant, amount, currency, date, dueDate]
        let previous = scanID, id = UUID().uuidString.lowercased(); scanID = id; busy = true; error = nil; started = .now
        let requestText = text, pages = attachment?.pages ?? []
        Task { defer { busy = false }; do { receive(try await store.scanReceipt(id: id, text: requestText, pages: pages, retryOf: previous)) } catch { if active { if let apiError = error as? APIError, [400, 401, 402, 403, 404, 409, 413, 429, 503].contains(apiError.status) { scanID = previous }; self.error = error.localizedDescription } } }
    }
    private func recover() {
        guard let scanID else { return }; aiOriginal = [merchant, amount, currency, date, dueDate]; busy = true
        Task { defer { busy = false }; do { receive(try await store.existingScan(scanID)) } catch { self.error = error.localizedDescription } }
    }
}
