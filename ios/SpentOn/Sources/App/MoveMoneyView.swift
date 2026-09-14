import SwiftUI

struct MoveMoneyView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let categoryID: String
    var covering = false
    @State private var source = "ready"
    @State private var destination = ""
    @State private var amount = ""
    @State private var picker: String?
    @State private var error: String?
    @State private var editorID = UUID()
    @State private var original: [String: String]?
    @State private var discarded = false
    private var dirty: Bool { original.map { $0 != command } == true || !amount.isEmpty }
    @FocusState private var enteringAmount: Bool
    private var command: [String: String] { ["kind": "allocation", "from": source, "categoryId": destination, "amount": amount] }
    private var preview: Overview? { try? store.preview(command) }
    private var validationProblem: String? { do { _ = try store.preview(command); return nil } catch { return error.localizedDescription } }
    var body: some View {
        let forecast = preview
        NavigationStack {
            ScrollView {
                if let data = store.overview {
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(spacing: 0) {
                            endpoint("From", id: source, side: "source", data: data, forecast: forecast)
                            HStack(spacing: 10) {
                                Rectangle().fill(Brand.secondary.opacity(0.15)).frame(height: 1)
                                Image(systemName: "arrow.down").font(.caption.weight(.semibold)).foregroundStyle(Brand.sage)
                                    .frame(width: 28, height: 28).background(Brand.sage.opacity(0.08), in: .circle)
                                Rectangle().fill(Brand.secondary.opacity(0.15)).frame(height: 1)
                            }.padding(.horizontal, 16).accessibilityHidden(true)
                            endpoint("To", id: destination, side: "destination", data: data, forecast: forecast)
                        }.background(Brand.surface, in: .rect(cornerRadius: 22))
                        Text("Current balance → After moving").font(.caption).foregroundStyle(Brand.secondary)
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Amount to move").font(.subheadline)
                            TextField("0.00", text: $amount).keyboardType(.decimalPad).focused($enteringAmount).font(.title2.weight(.semibold)).monospacedDigit().padding(14).background(Brand.surface, in: .rect(cornerRadius: 18)).accessibilityLabel("Amount to move")
                        }
                        if covering, let target = data.categories.first(where: { $0.id == categoryID }), target.available < 0 {
                            Button("Cover " + data.money(-target.available), systemImage: "arrow.left.arrow.right") { amount = NSDecimalNumber(value: -target.available).dividing(by: 100).stringValue }.buttonStyle(.glass)
                        }
                        Text("This changes your category plan. It does not move money between bank accounts.").font(.caption).foregroundStyle(Brand.secondary)
                        if let error { Notice(message: error) }
                        if !amount.isEmpty && forecast == nil, let problem = validationProblem { Notice(message: problem) }
                    }.padding(20).frame(maxWidth: 600).frame(maxWidth: .infinity)
                }
            }.background(Brand.canvas).scrollDismissesKeyboard(.interactively)
                .safeAreaInset(edge: .bottom) {
                    Button { Task { if await store.change(command) { dismiss() } else { error = store.message } } } label: { Label("Move category money", systemImage: "arrow.left.arrow.right").frame(maxWidth: .infinity) }
                        .primaryAction().disabled(forecast == nil || store.busy || store.hasPendingSave).padding(16).background(Brand.canvas).accessibilityIdentifier("move-save")
                }
                .navigationTitle(covering ? "Cover overspending" : "Move category money").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { discarded = true; dismiss() }.labelStyle(.iconOnly).disabled(store.busy) }
                    ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { enteringAmount = false } }
                }
                .interactiveDismissDisabled(dirty || store.busy)
                .sheet(isPresented: Binding(get: { picker != nil }, set: { if !$0 { picker = nil } })) {
                    if let data = store.overview { MoneyCategoryPicker(data: data, selection: Binding(get: { picker == "source" ? source : destination }, set: { if picker == "source" { source = $0 } else { destination = $0 } }), excluded: picker == "source" ? destination : source) }
                }
                .task {
                    store.beginEditing(editorID)
                    guard original == nil else { return }
                    if covering { destination = categoryID; source = "ready"; if let target = store.overview?.categories.first(where: { $0.id == categoryID }), target.available < 0 { amount = NSDecimalNumber(value: -target.available).dividing(by: 100).stringValue } }
                    else { source = categoryID; destination = "ready" }
                    original = command
                }.onDisappear { store.endEditing(editorID) }
                .editorSaveState()

        }
    }
    private func endpoint(_ title: String, id: String, side: String, data: Overview, forecast: Overview?) -> some View {
        let name = id == "ready" ? "Available to plan" : data.categories.first { $0.id == id }?.name ?? "Choose category"
        let current = id == "ready" ? data.ready : data.categories.first { $0.id == id }?.available ?? 0
        let after = id == "ready" ? forecast?.ready : forecast?.categories.first { $0.id == id }?.available
        return Button { picker = side } label: {
            HStack(spacing: 12) {
                if id == "ready" { MeaningIcon(symbol: "tray.full") }
                else if let category = data.categories.first(where: { $0.id == id }) { MeaningIcon(symbol: categorySymbol(category.icon), color: categoryTint(category.color ?? "sage")) }
                else { MeaningIcon(symbol: "square.grid.2x2") }
                VStack(alignment: .leading, spacing: 5) {
                    Text(title + " · " + name).font(.subheadline.weight(.medium))
                    if let after {
                        ViewThatFits(in: .horizontal) {
                            HStack { Text(data.money(current)); Image(systemName: "arrow.right"); Text(data.money(after)).fontWeight(.semibold) }.fixedSize(horizontal: true, vertical: false)
                            VStack(alignment: .leading, spacing: 6) {
                                Text(data.money(current)).lineLimit(1).minimumScaleFactor(0.7)
                                Label(data.money(after), systemImage: "arrow.down.right").fontWeight(.semibold).lineLimit(1).minimumScaleFactor(0.7)
                            }
                        }.font(.subheadline).monospacedDigit().accessibilityElement(children: .ignore).accessibilityLabel("Current balance " + data.money(current) + ", after moving " + data.money(after))
                    } else { Text(data.money(current)).font(.subheadline).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7) }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.down").font(.caption).foregroundStyle(Brand.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(16).contentShape(.rect)
        }.buttonStyle(ContentRowStyle()).accessibilityIdentifier("move-" + side)
    }
}

private struct MoneyCategoryPicker: View {
    @Environment(\.dismiss) private var dismiss
    let data: Overview
    @Binding var selection: String
    let excluded: String
    @State private var search = ""
    var body: some View {
        NavigationStack {
            BrandedList {
                if excluded != "ready" && (search.isEmpty || "Available to plan".localizedCaseInsensitiveContains(search)) {
                    Button { selection = "ready"; dismiss() } label: { HStack { Text("Available to plan"); Spacer(); Text(data.money(data.ready)) } }.accessibilityIdentifier("move-option-ready")
                }
                ForEach(CategoryDirectory(data.categories).matching(search).filter { $0.id != excluded }) { category in
                    Button { selection = category.id; dismiss() } label: {
                        HStack { VStack(alignment: .leading, spacing: 4) { Text(category.name).font(.subheadline); Text(CategoryDirectory(data.categories).context(for: category)).font(.caption).foregroundStyle(Brand.secondary) }; Spacer(); Text(data.money(category.available)).font(.subheadline).monospacedDigit() }
                    }.accessibilityIdentifier("move-option-" + category.id)
                }
            }.searchable(text: $search, prompt: "Find a category or group").navigationTitle("Choose category").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}
