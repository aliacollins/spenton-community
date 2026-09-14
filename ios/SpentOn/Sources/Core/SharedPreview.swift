import Foundation

enum SharedPreview {
    static func inbox(person: String = "") -> SharedInbox {
        let balances = [
            PersonBalance(email: "maya@example.test", currency: "USD", owedToYou: 4800, youOwe: 0, pendingToYou: 1800, pendingFromYou: 0, requestedToYou: 0, requestedFromYou: 0),
            PersonBalance(email: "alex@example.test", currency: "USD", owedToYou: 3200, youOwe: 0, pendingToYou: 0, pendingFromYou: 0, requestedToYou: 0, requestedFromYou: 0),
            PersonBalance(email: "sam@example.test", currency: "USD", owedToYou: 0, youOwe: 2400, pendingToYou: 0, pendingFromYou: 0, requestedToYou: 0, requestedFromYou: 0),
            PersonBalance(email: "", currency: "USD", owedToYou: 0, youOwe: 0, pendingToYou: 0, pendingFromYou: 0, requestedToYou: 0, requestedFromYou: 0, name: "Jordan", personKey: "guest-jordan")
        ]
        let dinner = SharedExpense(id: "sample-dinner", owned: true, merchant: "Dinner together", total: 12800, currency: "USD", date: "2026-09-09", payer: "you@example.test", entryId: nil, budgetId: "fictional-preview", shares: [
            ExpenseShare(id: "sample-maya", email: "maya@example.test", amount: 4800, state: "accepted", budgetId: nil, confirmed: 0, pending: 1800, settlements: [ShareSettlement(id: "sample-repayment", amount: 1800, state: "pending", date: "2026-09-10")]),
            ExpenseShare(id: "sample-alex", email: "alex@example.test", amount: 3200, state: "accepted", budgetId: nil, confirmed: 0, pending: 0, settlements: [])
        ])
        let taxi = SharedExpense(id: "sample-taxi", owned: false, merchant: "Ride home", total: 4800, currency: "USD", date: "2026-09-09", payer: "sam@example.test", entryId: nil, budgetId: nil, shares: [ExpenseShare(id: "sample-sam", email: "you@example.test", amount: 2400, state: "accepted", budgetId: "fictional-preview", confirmed: 0, pending: 0, settlements: [])])
        let coffee = SharedExpense(id: "sample-coffee", owned: true, merchant: "Coffee with Jordan", total: 1200, currency: "USD", date: "2026-09-08", payer: "you@example.test", entryId: nil, budgetId: "fictional-preview", shares: [
            ExpenseShare(id: "sample-jordan", email: "", amount: 600, state: "invited", budgetId: nil, confirmed: 600, pending: 0, settlements: [ShareSettlement(id: "sample-jordan-received", amount: 600, state: "confirmed", date: "2026-09-08", recordedByPayer: true)], name: "Jordan", personKey: "guest-jordan")
        ])
        return SharedInbox(verificationRequired: false, expenses: [dinner, taxi, coffee].filter { person.isEmpty || ($0.owned ? $0.shares.contains { ($0.personKey ?? $0.email) == person } : $0.payer == person) }, balances: balances, hasMore: false)
    }
}
