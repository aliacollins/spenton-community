import SwiftUI

struct UpcomingBillPayment: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let bill: UpcomingBill
    @State private var recording = false
    private var current: UpcomingBill? { store.overview?.upcomingBills?.first { $0.id == bill.id } }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment:.leading,spacing:24) {
                    if let item=current,let data=store.overview {
                        AppHero(label:item.kind == "income" ? "Expected income" : "Upcoming transaction",value:data.money(item.amount))
                        FinancePanel {
                            LabeledContent("Date",value:readableDate(item.date))
                            LabeledContent("Account",value:item.accountName)
                            if let frequency=item.frequency,frequency != "once" { LabeledContent("Repeat",value:frequency.capitalized) }
                            if let plan=item.sharePlan { LabeledContent("People",value:(["You"]+plan.people.map(\.name)).joined(separator:", ")) }
                        }.font(.subheadline)
                        FinanceAction(title:item.kind == "income" ? "Record money received" : item.kind == "transfer" ? "Record transfer" : "Record payment",symbol:item.kind == "income" ? "arrow.down.left" : "checkmark",prominent:true) { recording=true }
                            .disabled(store.busy || store.hasPendingSave)
                        Text(item.kind == "income" ? "Only record this after the money arrives. Expected income is not available to plan." : "This has not changed your balances. Record it after the payment or transfer has happened.")
                            .font(.subheadline).foregroundStyle(Brand.secondary)
                    } else {
                        ContentUnavailableView("No longer scheduled",systemImage:"calendar",description:Text("This occurrence may already have been recorded. Check Activity."))
                    }
                }.padding(24).frame(maxWidth:700).frame(maxWidth:.infinity)
            }.background(Brand.canvas).navigationTitle(current?.payee ?? bill.payee).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement:.cancellationAction) { Button("Close") { dismiss() } } }
                .sheet(isPresented:$recording,onDismiss:{ if current?.date != bill.date { dismiss() } }) {
                    if let item=current {
                        TransactionForm(seed:seed(item),initialKind:item.kind ?? "expense",destination:item.template?.toAccountId ?? "")
                    }
                }
        }
    }
    private func seed(_ item:UpcomingBill)->QuickEntry {
        var value=QuickEntry(amount:NSDecimalNumber(value:item.amount).dividing(by:100).stringValue,payee:item.payee,
                             categoryID:item.template?.categoryId ?? "",accountID:item.template?.accountId ?? "",date:groupDateKey(Date.now),receiptID:item.template?.receiptId)
        value.scheduleID=item.id;value.scheduleDate=item.date
        value.categorySplits=item.template?.splits?.map { .init(categoryId:$0.categoryId,amount:NSDecimalNumber(value:$0.amount).dividing(by:100).stringValue) } ?? []
        value.people=item.sharePlan ?? ExpensePeopleDraft();value.note=item.template?.note ?? ""
        return value
    }
}
