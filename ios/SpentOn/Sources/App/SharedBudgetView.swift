import SwiftUI

struct SharedBudgetSummary: View {
    let data: Overview
    var body: some View {
        if let shared = data.shared, shared.receivable > 0 || shared.owed > 0 {
            VStack(alignment: .leading, spacing: 14) {
                Label("Shared amounts in this budget", systemImage: "person.2").font(.headline)
                LabeledContent("Friends owe you", value: data.money(shared.receivable))
                LabeledContent("You owe", value: data.money(shared.owed))
                LabeledContent("Cash set aside for friends", value: data.money(shared.reserved))
                if shared.unfunded > 0 {
                    Text(data.money(shared.unfunded) + " still needs funding. Move money into the affected categories.").foregroundStyle(Brand.danger)
                }
                Text("Money owed to you is included in net worth, but cannot be spent until received. Payments you record reduce what you owe immediately.").font(.caption).foregroundStyle(Brand.secondary)
            }.font(.subheadline).padding(18).background(Brand.surface, in: .rect(cornerRadius: 22))
        }
    }
}

struct SharedAcceptanceForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let expense: SharedExpense
    let share: ExpenseShare
    @State private var categoryID = ""
    @State private var choosingCategory = false
    @State private var editorID = UUID()
    @State private var error: String?
    @State private var discarded = false
    private var matchingGroup: Bool { expense.groupId == nil || expense.groupBudgetId == store.snapshot?.id }
    private var preview: SharedBudgetPreview? {
        guard matchingGroup, let budget = store.snapshot?.budget, !categoryID.isEmpty else { return nil }
        return try? store.requireEngine().run("sharedPreview", budget: budget, command: [
            "kind": "accept", "categoryId": categoryID, "amount": String(share.amount), "date": expense.date
        ])
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(expense.merchant).font(.title3.weight(.semibold))
                    Text(SharedMoney.format(share.amount, expense.currency)).font(.largeTitle.weight(.semibold)).monospacedDigit()
                    if let data = store.overview, data.currency == expense.currency, matchingGroup {
                        Button { choosingCategory = true } label: {
                            Label(data.categories.first { $0.id == categoryID }?.name ?? "Choose category for your share", systemImage: "square.grid.2x2").frame(minHeight: 44)
                        }
                        Text("Your share will count as spending on " + readableDate(expense.date) + ". Available cash will be set aside for repayment. Paying later will not count as spending again.").font(.subheadline).foregroundStyle(Brand.secondary)
                        if let preview {
                            VStack(alignment: .leading, spacing: 14) {
                                LabeledContent("Cash set aside for repayment", value: data.money(preview.reserved))
                                LabeledContent("Left in this category", value: data.money(preview.categoryLeft))
                                LabeledContent("Available to plan", value: data.money(preview.ready))
                                if preview.unfunded > 0 {
                                    Text(data.money(preview.unfunded) + " still needs funding. Move money into this category after accepting.").foregroundStyle(Brand.danger)
                                }
                            }.font(.subheadline).padding(18).background(Brand.surface, in: .rect(cornerRadius: 22))
                        }
                        if share.confirmed > 0 {
                            Text("The payer already recorded " + data.money(share.confirmed) + " received. After accepting, add that payment to your budget only if you paid and have not recorded it.").font(.caption).foregroundStyle(Brand.secondary)
                        }
                    } else {
                        Text(matchingGroup ? "Open a budget in " + expense.currency + " to accept this share." : "Join this group and open the budget you chose for it before accepting.")
                    }
                    if let error { Notice(message: error) }
                }.padding(20).frame(maxWidth: 600).frame(maxWidth: .infinity)
            }.background(Brand.canvas)
                .navigationTitle("Accept your share").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { discarded = true; dismiss() }.disabled(store.busy) } }
                .safeAreaInset(edge: .bottom) {
                    Button("Accept share and update budget", systemImage: "checkmark") { accept() }
                        .primaryAction()
                        .disabled(preview == nil || store.overview?.currency != expense.currency || store.busy || store.pendingShared != nil)
                        .padding(16).frame(maxWidth: .infinity).background(Brand.canvas)
                }
                .sheet(isPresented: $choosingCategory) { if let data = store.overview { CategoryPickerSheet(data: data, selection: $categoryID) } }
                .interactiveDismissDisabled(!categoryID.isEmpty || store.busy || store.pendingShared != nil)
                .task { store.beginEditing(editorID) }
                .onDisappear { store.endEditing(editorID) }
                .editorSaveState()

        }
    }
    private func accept() {
        guard let snapshot = store.snapshot, preview != nil else { return }
        Task {
            if await store.sharedChange("/expense-shares/" + share.id + "/respond", body: [
                "action": .string("accept"), "budgetId": .string(snapshot.id),
                "expectedRevision": .number(Int64(snapshot.revision)), "categoryId": .string(categoryID)
            ]) { dismiss() } else { error = store.message }
        }
    }
}
