import SwiftUI

struct PlanForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var textSize
    var initialCategory = ""
    @State private var fields: [String: String] = [:]
    @State private var additions: [StructureDraft] = []
    @State private var query = ""
    @State private var error: String?
    @State private var creating = false
    @State private var reviewing = false
    @State private var initialized = false
    @State private var discarded = false
    @State private var editorID = UUID()
    @FocusState private var focused: String?
    private var dirty: Bool { fields.values.contains { !$0.isEmpty } || !additions.isEmpty }
    private var data: Overview? { try? store.structureOverview(additions) }
    private var plan: BatchPlanDraft? { try? store.previewPlan(fields, additions: additions) }
    private var ready: Bool { !(plan?.amounts.isEmpty ?? true) && !store.busy && !store.hasPendingSave }
    private var workingBudget: JSONValue? { store.snapshot.flatMap { try? store.adding(additions, to: $0.budget) } }
    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: AppLayout.section) {
                        if let data {
                            HStack(spacing: 10) {
                                Image(systemName: "magnifyingglass").foregroundStyle(Brand.secondary)
                                TextField("Find a category", text: $query).font(.subheadline)
                            }.padding(16).background(Brand.surface, in: .rect(cornerRadius: 16))
                            let matches = CategoryDirectory(data.categories).matching(query)
                            ForEach(Array(Set(matches.map(\.group))).sorted(), id: \.self) { group in
                                Text(group).font(.subheadline.weight(.medium))
                                FinanceRows {
                                    let categories = matches.filter { $0.group == group }
                                    ForEach(categories) { category in
                                        row(category, data: data).id(category.id)
                                        if category.id != categories.last?.id { FinanceDivider() }
                                    }
                                }
                            }
                            if matches.isEmpty { ContentUnavailableView.search(text: query) }
                            Button("Add a category", systemImage: "plus") { focused = nil; creating = true }.font(.subheadline).frame(minHeight: 44)
                            if data.ready <= 0 {
                                Button("Review balances and categories", systemImage: "exclamationmark.circle") { focused = nil; reviewing = true }
                                    .font(.subheadline).frame(minHeight: 44)
                            }
                            Text("Enter the amounts to add. Save applies the whole plan. Account balances stay the same.")
                                .font(.caption).foregroundStyle(Brand.secondary)
                        }
                        if let error { Label(error, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(Brand.danger) }
                    }.padding(AppLayout.page).frame(maxWidth: 700).frame(maxWidth: .infinity)
                }
                .safeAreaInset(edge: .top, spacing: 0) { summary }
                .scrollDismissesKeyboard(.interactively)
                .task {
                    guard !initialized else { return }
                    initialized = true
                    if !initialCategory.isEmpty { proxy.scrollTo(initialCategory, anchor: .center) }
                }
            }
            .background(Brand.canvas).navigationTitle("Plan your money").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { focused = nil; discarded = true; dismiss() }.disabled(store.busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        focused = nil
                        Task { if await store.savePlan(fields, additions: additions) { discarded = true; dismiss() } }
                    } label: {
                        if store.busy { ProgressView().tint(.white) }
                        else { Text("Save").foregroundStyle(ready ? Color.white : Brand.secondary) }
                    }.buttonStyle(.glassProminent).tint(Brand.action).disabled(!ready).accessibilityIdentifier("save-plan")
                }
                ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { focused = nil } }
            }
            .sheet(isPresented: $creating) {
                if let base = workingBudget { BatchCategoryCreation(base: base, context: .plan, onUse: { additions.append(contentsOf: $0) }) }
            }
            .sheet(isPresented: $reviewing) { BudgetReviewView() }
            .interactiveDismissDisabled(dirty || store.busy)
            .editorSaveState()
            .onAppear { store.beginEditing(editorID) }
            .onDisappear { store.endEditing(editorID) }
            .onChange(of: fields) { _, _ in error = nil }

        }
    }
    private var summary: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let data {
                HStack {
                    Text("Available to plan").font(.subheadline).foregroundStyle(Brand.secondary)
                    Spacer()
                    Text(data.money(data.ready)).font(.subheadline.weight(.medium)).monospacedDigit()
                }
                HStack(alignment: .firstTextBaseline) {
                    Text("After this plan").font(.subheadline).foregroundStyle(Brand.secondary)
                    Spacer()
                    if let plan {
                        Text(data.money(plan.overview.ready)).font(.title2.weight(.semibold)).monospacedDigit()
                            .foregroundStyle(plan.overview.ready < 0 ? Brand.danger : Brand.ink)
                    } else {
                        Text("Review amounts").font(.headline).foregroundStyle(Brand.danger)
                    }
                }
                if plan == nil {
                    Text(validationMessage).font(.caption).foregroundStyle(Brand.danger).accessibilityIdentifier("plan-error")
                }
            }
        }.padding(.horizontal, AppLayout.page).padding(.vertical, 16)
            .frame(maxWidth: 700).frame(maxWidth: .infinity).background(Brand.canvas)
    }
    private var validationMessage: String {
        do { _ = try store.previewPlan(fields, additions: additions); return "" }
        catch { return error.localizedDescription }
    }
    private func row(_ category: BudgetCategory, data: Overview) -> some View {
        let after = plan?.overview.categories.first { $0.id == category.id }?.available
        let layout = textSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12)) : AnyLayout(HStackLayout(spacing: 12))
        return layout {
            HStack(spacing: 12) {
                CategoryGlyph(icon: category.icon, color: category.color ?? "sage", size: 28)
                VStack(alignment: .leading, spacing: 5) {
                    Text(category.name).font(.subheadline.weight(.medium))
                    Text(after != nil && after != category.available ? "Left \(data.money(category.available)) → \(data.money(after!))" : "Left \(data.money(category.available))")
                        .font(.caption).foregroundStyle(Brand.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            VStack(alignment: .leading, spacing: 5) {
                Text("Add").font(.caption2).foregroundStyle(Brand.secondary)
                HStack(spacing: 6) {
                    Text(currencyMark(data.currency)).foregroundStyle(Brand.secondary)
                    TextField("0", text: Binding(get: { fields[category.id] ?? "" }, set: { fields[category.id] = $0 }))
                        .keyboardType(.decimalPad).multilineTextAlignment(.trailing).focused($focused, equals: category.id)
                        .accessibilityLabel("Set aside for \(category.name)")
                }.font(.body).padding(10).background(Brand.canvas, in: .rect(cornerRadius: 12))
            }.frame(width: textSize.isAccessibilitySize ? 170 : 110)
        }.padding(AppLayout.inset).frame(minHeight: 80)
    }
}
