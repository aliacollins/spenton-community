import SwiftUI

struct BudgetReviewView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var moving: BudgetCategory?

    var body: some View {
        NavigationStack {
            BrandedList {
                if let data = store.overview {
                    Section {
                        MoneyStat(title: "Available to plan", value: data.money(data.ready), symbol: "tray.full")
                            .foregroundStyle(data.ready < 0 ? Brand.danger : Brand.ink)
                        Text(data.ready < 0 ? "Review recorded balances, spending and money already set aside." : "Review your categories or move money when your priorities change.")
                            .font(.subheadline).foregroundStyle(Brand.secondary)
                    }
                    Section("Cash accounts") {
                        if data.cash < 0 {
                            Label("Recorded cash is below zero by " + data.money(-data.cash) + ". Check the account balances and transactions.", systemImage: "exclamationmark.circle")
                                .font(.subheadline).foregroundStyle(Brand.danger)
                        }
                        ForEach(data.accounts.filter(\.isCash)) { account in
                            NavigationLink { AccountDetail(accountID: account.id) } label: {
                                HStack {
                                    Label(account.name, systemImage: accountSymbol(account.type))
                                    Spacer(minLength: 8)
                                    Text(data.money(account.balance)).monospacedDigit().foregroundStyle(account.balance < 0 ? Brand.danger : Brand.ink)
                                }.font(.subheadline).padding(.vertical, 8)
                            }
                        }
                    }
                    let overspent = data.categories.filter { $0.available < 0 }.sorted { $0.available < $1.available }
                    if !overspent.isEmpty {
                        Section("Overspent categories") {
                            ForEach(overspent) { category in
                                NavigationLink { CategoryDetail(categoryID: category.id) } label: {
                                    CategoryRow(category: category, data: data)
                                }
                            }
                        }
                    }
                    let available = data.categories.filter { $0.available > 0 }
                    if !available.isEmpty {
                        Section {
                            ForEach(available) { category in
                                Button { moving = category } label: {
                                    HStack {
                                        CategoryGlyph(icon: category.icon, color: category.color ?? "sage", size: 28)
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(category.name).font(.subheadline.weight(.semibold))
                                            Text(data.money(category.available) + " left").font(.caption).foregroundStyle(Brand.secondary)
                                        }
                                        Spacer()
                                        Label("Move money", systemImage: "arrow.left.arrow.right").font(.subheadline)
                                    }.frame(minHeight: 44)
                                }.buttonStyle(.bordered).tint(Brand.sage)
                            }
                        } header: { Text("Money you can move") } footer: {
                            Text("Moving category money changes the plan. It does not change bank balances.")
                        }
                    }
                }
            }.navigationTitle("Review your budget").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .sheet(item: $moving) { MoveMoneyView(categoryID: $0.id) }
        }
    }
}
