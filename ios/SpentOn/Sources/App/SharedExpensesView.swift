import SwiftUI
import CryptoKit

private enum PeopleFilter: String, CaseIterable {
    case all = "Everyone", incoming = "Owes you", outgoing = "You owe", settled = "Settled"
}

private extension PersonBalance {
    var settled: Bool { owedToYou + youOwe + requestedToYou + requestedFromYou == 0 }
    var status: String {
        if settled { return "Settled" }
        if pendingToYou + pendingFromYou > 0 { return "Awaiting confirmation" }
        if requestedToYou + requestedFromYou > 0 { return "Awaiting acceptance" }
        return "Outstanding"
    }
    var statusSymbol: String { settled ? "checkmark" : status == "Outstanding" ? "arrow.up.right" : "clock" }
}

struct SharedExpensesView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    var embedded = false
    @State private var inbox: SharedInbox?
    @State private var contacts: [PrivatePerson] = []
    @State private var contactVersion = 0
    @State private var groups: [ExpenseGroupSummary] = []
    @State private var search = ""
    @State private var person: PersonBalance?
    @State private var groupID: String?
    @State private var pendingGroupID: String?
    @State private var joining: ExpenseGroupSummary?
    @State private var creatingPerson = false
    @State private var creatingGroup = false
    @State private var error: String?
    private var balances: [PersonBalance] { inbox?.balances ?? [] }
    private var directory: [PersonBalance] {
        var result: [String:PersonBalance] = [:]
        for balance in balances where result[balance.key] == nil { result[balance.key] = balance }
        for contact in contacts {
            let old = result[contact.id]
            result[contact.id] = PersonBalance(email: contact.email.isEmpty ? old?.email ?? "" : contact.email,
                                               currency: old?.currency ?? store.overview?.currency ?? "USD",
                                               owedToYou: old?.owedToYou ?? 0,youOwe: old?.youOwe ?? 0,
                                               pendingToYou: old?.pendingToYou ?? 0,pendingFromYou: old?.pendingFromYou ?? 0,
                                               requestedToYou: old?.requestedToYou ?? 0,requestedFromYou: old?.requestedFromYou ?? 0,
                                               name: contact.name,personKey: contact.id)
        }
        return result.values.filter { search.isEmpty || ($0.displayName+$0.email).localizedCaseInsensitiveContains(search) }
            .sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }
    }
    var body: some View {
        NavigationStack {
            AppPage(title:"People",subtitle:"Expenses you share",addLabel:"Add person",add:contactVersion == 1 ? {creatingPerson=true} : nil,
                    close:embedded ? nil : {dismiss()}) {
                if inbox != nil {
                    HStack(alignment:.top,spacing:20) { total(true);total(false) }.padding(.bottom,24)
                    HStack(spacing:10) { Image(systemName:"magnifyingglass").foregroundStyle(Brand.secondary);TextField("Find a person",text:$search).font(.subheadline) }
                        .padding(16).background(Brand.surface,in:.rect(cornerRadius:16)).padding(.bottom,20)
                    FinanceRows {
                        ForEach(directory) { entry in
                            Button { person=entry } label: {
                                AppRow(title:entry.displayName,subtitle:personSubtitle(entry),value:personValue(entry),initials:String(entry.displayName.prefix(1)).uppercased())
                            }.buttonStyle(.plain).accessibilityIdentifier("people-person-"+entry.key)
                            if entry.id != directory.last?.id { FinanceDivider() }
                        }
                    }
                    if directory.isEmpty { Text(search.isEmpty ? "Add someone you share expenses with." : "No matching people.").font(.subheadline).foregroundStyle(Brand.secondary).padding(.vertical,20) }
                    if inbox?.verificationRequired == true {
                        Text("Verify your email in account settings before sharing expenses.").font(.subheadline).foregroundStyle(Brand.secondary).padding(.top,20)
                    }
                } else if error == nil { ProgressView("Loading people").padding(.vertical,24) }
                if store.groupsAvailable {
                    AppSection(title:"Groups",actionTitle:"Create group",action:{creatingGroup=true})
                    Text("Optional, for expenses you keep together.").font(.caption).foregroundStyle(Brand.secondary).padding(.bottom,12)
                    FinanceRows {
                        ForEach(groups) { group in
                            Button { if group.membership == "invited" {joining=group} else {groupID=group.id} } label: {
                                AppRow(title:group.name,subtitle:"\(group.memberCount) people · \(group.currency)"+(group.membership == "invited" ? " · Invitation" : group.state == "archived" ? " · Archived" : ""),symbol:"person.3",color:Brand.blue)
                            }.buttonStyle(.plain)
                            if group.id != groups.last?.id { FinanceDivider() }
                        }
                    }
                    if groups.isEmpty { Text("Create a group for a trip, household or event.").font(.subheadline).foregroundStyle(Brand.secondary) }
                }
                if let error { Notice(message:error).padding(.top,20);Button("Try again"){Task{await load()}}.frame(minHeight:44) }
            }
            .navigationDestination(item:$person){SharedPersonView(person:$0).toolbar(.visible,for:.navigationBar)}
            .navigationDestination(item:$groupID){ExpenseGroupDetailView(id:$0).toolbar(.visible,for:.navigationBar)}
            .sheet(isPresented:$creatingPerson,onDismiss:{Task{await load()}}){PersonCreationView()}
            .sheet(isPresented:$creatingGroup,onDismiss:finishedGroupDialog){GroupCreateView{pendingGroupID=$0}}
            .sheet(item:$joining,onDismiss:finishedGroupDialog){GroupJoinView(group:$0){pendingGroupID=$0}}
            .task {
                await load()
                while !Task.isCancelled {
                    try? await Task.sleep(for:.seconds(5))
                    if !Task.isCancelled && scenePhase == .active && !store.editing && !store.busy && person == nil && groupID == nil && !creatingPerson && !creatingGroup && joining == nil { await load() }
                }
            }
            .onChange(of:store.savedCount){_,_ in Task{await load()}}
        }
    }
    private func total(_ incoming:Bool)->some View {
        let currencies=Set(balances.filter{incoming ? $0.owedToYou>0 : $0.youOwe>0}.map(\.currency)).sorted()
        return VStack(alignment:.leading,spacing:6) {
            Text(incoming ? "Friends owe you" : "You owe friends").appFont(12).foregroundStyle(Brand.secondary)
            if currencies.isEmpty { Text(SharedMoney.format(0,store.overview?.currency ?? "USD")).appFont(21,weight:.medium) }
            ForEach(currencies,id:\.self){currency in
                let value=balances.filter{$0.currency==currency}.reduce(Int64(0)){$0+(incoming ? $1.owedToYou : $1.youOwe)}
                Text(SharedMoney.format(value,currency)+(currencies.count>1 ? " "+currency : "")).appFont(21,weight:.medium).monospacedDigit()
            }
        }.frame(maxWidth:.infinity,alignment:.leading)
    }
    private func personSubtitle(_ person:PersonBalance)->String {
        let rows=balances.filter{$0.key==person.key}
        if rows.contains(where:{$0.pendingToYou+$0.pendingFromYou>0}) { return "Repayment to confirm" }
        if rows.contains(where:{$0.requestedToYou+$0.requestedFromYou>0}) { return "Awaiting acceptance" }
        if rows.isEmpty { return "View shared expenses" }
        return rows.allSatisfy(\.settled) ? "No amount outstanding" : rows.contains(where:{$0.youOwe>0}) ? "You owe" : "Owes you"
    }
    private func personValue(_ person:PersonBalance)->String {
        let rows=balances.filter{$0.key==person.key}
        if Set(rows.map(\.currency)).count>1 { return "\(Set(rows.map(\.currency)).count) currencies" }
        guard let row=rows.first else{return ""}
        if row.owedToYou>0 && row.youOwe>0 {return "Owes you "+SharedMoney.format(row.owedToYou,row.currency)+"\nYou owe "+SharedMoney.format(row.youOwe,row.currency)}
        return row.owedToYou+row.youOwe>0 ? SharedMoney.format(max(row.owedToYou,row.youOwe),row.currency) : ""
    }
    private func finishedGroupDialog(){if let id=pendingGroupID{pendingGroupID=nil;groupID=id};Task{await load()}}
    private func load()async {
        do {
            let next=try await store.sharedInbox()
            let people=try await store.peopleDirectory()
            let groupList=store.groupsAvailable ? try await store.expenseGroups().groups : []
            guard !store.editing else{return}
            inbox=next;contacts=people.people;contactVersion=people.version;groups=groupList;error=nil
        }catch{self.error=error.localizedDescription}
    }
}

struct PersonAvatar: View {
    let email: String
    var name: String? = nil
    var status: String? = nil
    var settled = false
    var size: CGFloat = 42
    private var color: Color { [Color(red: 0.86, green: 0.92, blue: 0.60), Color(red: 0.97, green: 0.89, blue: 0.82), Color(red: 0.88, green: 0.90, blue: 0.85)][email.unicodeScalars.reduce(0) { $0 + Int($1.value) } % 3] }
    var body: some View {
        Text(String((name?.isEmpty == false ? name! : email).prefix(1)).uppercased()).font(.title2.weight(.semibold))
            .foregroundStyle(Color(red: 0.13, green: 0.24, blue: 0.20)).frame(width: size, height: size).background(color, in: .circle)
            .overlay(alignment: .bottomTrailing) {
                if let status { Image(systemName: status).font(.caption2.weight(.bold)).foregroundStyle(.white).frame(width: 24, height: 24).background(settled ? Brand.action : Color(red: 0.60, green: 0.32, blue: 0.20), in: .circle).overlay { Circle().strokeBorder(Brand.surface, lineWidth: 2) }.offset(x: 3, y: 3) }
            }.accessibilityHidden(true)
    }
}

private struct PersonAmounts: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let balance: PersonBalance
    var body: some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16)) : AnyLayout(HStackLayout(alignment: .top, spacing: 24))
        layout {
            if balance.owedToYou > 0 { amount("Owes you", balance.owedToYou) }
            if balance.youOwe > 0 { amount("You owe", balance.youOwe) }
            if balance.owedToYou == 0 && balance.requestedToYou > 0 { amount("Requested by you", balance.requestedToYou) }
            if balance.requestedFromYou > 0 { amount("Requested from you", balance.requestedFromYou) }
            if balance.settled { amount("No outstanding balance", 0) }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func amount(_ label: String, _ value: Int64) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(Brand.secondary)
            Text(SharedMoney.format(value, balance.currency) + " " + balance.currency).font(.subheadline.weight(.semibold)).monospacedDigit().foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
        }.accessibilityElement(children: .ignore).accessibilityLabel(label + " " + SharedMoney.format(value, balance.currency) + " " + balance.currency)
    }
}

private enum SharedHistoryItem: Identifiable {
    case expense(SharedExpense), bill(GroupBillRecord)
    var id:String { switch self { case .expense(let e): "expense:"+e.id;case .bill(let b): "bill:"+b.id } }
    var date:String { switch self { case .expense(let e): e.date;case .bill(let b): b.date } }
}

struct SharedPersonView: View {
    @Environment(AppStore.self) private var store
    @Environment(NavigationContext.self) private var navigation
    let person: PersonBalance
    @State private var inbox: SharedInbox?
    @State private var error: String?
    @State private var create = false
    @State private var loading = false
    @State private var filter = "all"
    @State private var selected: String?
    @State private var groupReview: GroupReviewSelection?
    @State private var combined: [String:GroupBillRecord] = [:]
    private var balances: [PersonBalance] { inbox?.balances?.filter{$0.key==person.key} ?? [person] }
    private var expenses: [SharedExpense] {
        var seen=Set<String>()
        return (inbox?.expenses ?? []).filter { entry in
            let key=entry.combinedBillId ?? entry.id
            if let id=entry.combinedBillId,combined[id] != nil{return false}
            return seen.insert(key).inserted && (filter == "all" || (filter == "direct" ? entry.groupId == nil : entry.groupId == filter))
        }
    }
    private var groupHistory:[GroupBillRecord] {
        combined.values.filter{filter == "all" || filter == $0.groupId}.sorted{$0.date == $1.date ? $0.id < $1.id : $0.date > $1.date}
    }
    private var history:[SharedHistoryItem] {
        (expenses.map{SharedHistoryItem.expense($0)}+groupHistory.map{SharedHistoryItem.bill($0)}).sorted{$0.date == $1.date ? $0.id < $1.id : $0.date > $1.date}
    }
    private var groupNames:[String:String] {
        var names:[String:String]=[:]
        for entry in inbox?.expenses ?? [] {if let id=entry.groupId {names[id]=entry.groupName ?? "Group"}}
        for bill in combined.values {names[bill.groupId]=bill.groupName ?? "Group"}
        return names
    }
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:24) {
                HStack(spacing:16) {
                    PersonAvatar(email:person.key,name:person.displayName,size:56)
                    VStack(alignment:.leading,spacing:5) {
                        Text(person.displayName).font(.title.weight(.semibold))
                        Text("Shared expenses").font(.subheadline).foregroundStyle(Brand.secondary)
                    }
                }
                if balances.contains(where:{$0.owedToYou+$0.youOwe+$0.requestedToYou+$0.requestedFromYou>0}) {
                    FinancePanel {
                        ForEach(balances) { balance in
                            VStack(alignment:.leading,spacing:10) {
                                if balances.count>1 { Text(balance.currency).font(.caption.weight(.medium)).foregroundStyle(Brand.secondary) }
                                if balance.owedToYou>0 { LabeledContent("\(person.displayName) owes you",value:SharedMoney.format(balance.owedToYou,balance.currency)) }
                                if balance.youOwe>0 { LabeledContent("You owe \(person.displayName)",value:SharedMoney.format(balance.youOwe,balance.currency)) }
                                if balance.requestedToYou+balance.requestedFromYou>0 { Text(SharedMoney.format(balance.requestedToYou+balance.requestedFromYou,balance.currency)+" awaiting acceptance").font(.caption).foregroundStyle(Brand.secondary) }
                                if balance.pendingToYou+balance.pendingFromYou>0 { Text(SharedMoney.format(balance.pendingToYou+balance.pendingFromYou,balance.currency)+" repayment to confirm").font(.caption).foregroundStyle(Brand.secondary) }
                            }.font(.subheadline)
                        }
                    }
                }
                HStack {
                    Text("Shared expenses").font(.headline);Spacer()
                    Menu {
                        Button("All expenses"){filter="all"};Button("Direct"){filter="direct"}
                        ForEach(groupNames.keys.sorted(),id:\.self){id in Button(groupNames[id] ?? "Group"){filter=id}}
                    } label:{Label(filter == "all" ? "All" : filter == "direct" ? "Direct" : groupNames[filter] ?? "Group",systemImage:"line.3.horizontal.decrease").font(.subheadline).frame(minHeight:44)}
                }
                FinanceRows {
                    ForEach(history){item in
                        historyRow(item)
                        if item.id != history.last?.id {FinanceDivider()}
                    }
                }
                if inbox != nil && expenses.isEmpty && groupHistory.isEmpty { ContentUnavailableView("No expenses here yet",systemImage:"receipt",description:Text("Add an expense and this person will already be selected.")) }
                if inbox?.hasMore == true {Button("Load earlier expenses",systemImage:"clock.arrow.circlepath"){Task{await load(more:true)}}.disabled(loading).frame(minHeight:44)}
                if loading {ProgressView("Loading expenses")}
                if let error {Notice(message:error);Button("Try again"){Task{await load()}}}
            }.padding(24).frame(maxWidth:700).frame(maxWidth:.infinity)
        }.background(Brand.canvas).navigationTitle(person.displayName).navigationBarTitleDisplayMode(.inline)
            .toolbar {ToolbarItem(placement:.topBarTrailing){Button("Add shared expense",systemImage:"plus"){create=true}.labelStyle(.iconOnly)}}
            .sheet(isPresented:$create,onDismiss:{Task{await load()}}){
                TransactionForm(seed:QuickEntry(people:ExpensePeopleDraft(people:[ExpensePersonDraft(id:person.key,name:person.displayName,email:person.email)])))
            }
            .sheet(item:$groupReview,onDismiss:{Task{await load()}}){GroupBillReviewView(id:$0.id)}
            .navigationDestination(item:$selected){id in
                if let expense=inbox?.expenses.first(where:{$0.id==id}) {
                    SharedExpenseDetailView(expense:expense)
                }
            }
            .task {await load()}
            .refreshable {await load()}
            .onChange(of:store.savedCount){_,_ in Task{await load()}}
            .onAppear {navigation.people = ExpensePeopleDraft(people:[ExpensePersonDraft(id:person.key,name:person.displayName,email:person.email)]);navigation.requiredBudgetID=""}
            .onDisappear {
                if navigation.people.groupId.isEmpty && navigation.people.people.count == 1 && navigation.people.people.first?.id == person.key {navigation.people = ExpensePeopleDraft()}
            }
    }
    @ViewBuilder private func historyRow(_ item:SharedHistoryItem)->some View {
        switch item {
        case .expense(let expense):
            Button {selected=expense.id} label:{CompactSharedExpenseRow(expense:expense,combined:expense.combinedBillId.flatMap{combined[$0]})}.buttonStyle(.plain)
        case .bill(let bill):
            Button{groupReview=GroupReviewSelection(id:bill.id)}label:{
                VStack(alignment:.leading,spacing:0){
                    AppRow(title:bill.merchant,subtitle:readableDate(bill.date)+" · "+(bill.state == "pending" ? "Payers reviewing" : bill.state == "cancelled" ? "Cancelled" : "Recorded"),value:SharedMoney.format(bill.total,bill.currency),symbol:"receipt",color:Brand.blue)
                    HStack {
                        StatusBadge(title:bill.groupName ?? "Group",symbol:"person.3",color:Brand.blue)
                        if let own=bill.people.first(where:{$0.isYou}){Text("Your share "+SharedMoney.format(own.amount,bill.currency)).font(.caption).foregroundStyle(Brand.secondary)}
                    }.padding(.horizontal,20).padding(.bottom,16)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain)
        }
    }
    private func load(more:Bool=false)async {
        guard !loading else{return};loading=true;defer{loading=false}
        do {
            var next=try await store.sharedInbox(person:person.key,offset:more ? inbox?.nextOffset ?? 0 : 0)
            if more,let old=inbox {
                let ids=Set(old.expenses.map(\.id));next.expenses=old.expenses+next.expenses.filter{!ids.contains($0.id)}
                let bills=Set((old.groupBills ?? []).map(\.id));next.groupBills=(old.groupBills ?? [])+(next.groupBills ?? []).filter{!bills.contains($0.id)}
            }
            inbox=next;error=nil
            let allowed=Set(next.expenses.compactMap(\.combinedBillId)+(next.groupBills ?? []).map(\.id))
            combined=combined.filter{allowed.contains($0.key)}
            for bill in next.groupBills ?? []{combined[bill.id]=bill}
            let ids=Array(Set(next.expenses.compactMap(\.combinedBillId))).filter{combined[$0]==nil}
            await withTaskGroup(of:(String,GroupBillRecord?).self){tasks in
                var iterator=ids.makeIterator()
                for _ in 0..<min(4,ids.count){if let id=iterator.next(){tasks.addTask{(id,try? await store.groupBill(id))}}}
                while let (id,value)=await tasks.next(){if let value{combined[id]=value};if let next=iterator.next(){tasks.addTask{(next,try? await store.groupBill(next))}}}
            }
        }catch{self.error=error.localizedDescription}
    }
}

struct CompactSharedExpenseRow:View {
    @Environment(\.dynamicTypeSize) private var textSize
    let expense:SharedExpense
    var combined:GroupBillRecord?
    private var amount:Int64? {if let combined{return combined.total};return expense.combinedBillId == nil ? expense.total : nil}
    private var own:Int64? {
        if let combined{return combined.people.first{$0.isYou}?.amount}
        guard expense.combinedBillId == nil,expense.kind != "refund" else{return nil}
        let shares=expense.shares.filter{$0.state != "cancelled"}
        return expense.owned ? max(0,expense.total-(expense.refunded ?? 0)-shares.reduce(0){$0+$1.amount}) : shares.reduce(0){$0+$1.amount}
    }
    private var settled:Bool {expense.combinedBillId == nil && expense.shares.allSatisfy{$0.state == "cancelled" || ($0.remaining == 0 && $0.pending == 0)}}
    var body:some View {
        HStack(alignment:.top,spacing:12){
            Image(systemName:expense.kind == "refund" ? "arrow.uturn.backward" : "receipt").font(.body).foregroundStyle(expense.groupId == nil ? Brand.sage : Brand.blue)
                .frame(width:38,height:40).background((expense.groupId == nil ? Brand.sage : Brand.blue).opacity(0.10),in:.rect(cornerRadius:12)).accessibilityHidden(true)
            VStack(alignment:.leading,spacing:6){
                Text(combined?.merchant ?? expense.merchant).font(.subheadline.weight(.medium)).foregroundStyle(Brand.ink)
                Text(readableDate(combined?.date ?? expense.date)).font(.caption).foregroundStyle(Brand.secondary)
                if let own{Text("Your share "+SharedMoney.format(own,expense.currency)).font(.caption).foregroundStyle(Brand.secondary)}
                if textSize.isAccessibilitySize,let amount{Text(SharedMoney.format(amount,expense.currency)).font(.subheadline.weight(.medium)).monospacedDigit()}
                HStack(spacing:8){
                    StatusBadge(title:expense.groupName ?? "Direct",symbol:expense.groupId == nil ? "person.2" : "person.3",color:expense.groupId == nil ? Brand.sage : Brand.blue)
                    if settled{Text("Settled").font(.caption2).foregroundStyle(Brand.secondary)}
                }
                if expense.combinedBillId != nil && combined == nil{Text("Review the shared bill").font(.caption).foregroundStyle(Brand.secondary)}
            }.frame(maxWidth:.infinity,alignment:.leading)
            if !textSize.isAccessibilitySize,let amount{
                VStack(alignment:.trailing,spacing:4){Text(expense.kind == "refund" ? "Refund" : "Total").font(.caption2).foregroundStyle(Brand.secondary);Text(SharedMoney.format(amount,expense.currency)).font(.subheadline.weight(.medium)).monospacedDigit().foregroundStyle(Brand.ink)}
            }
            Image(systemName:"chevron.right").font(.caption2).foregroundStyle(Brand.secondary).padding(.top,12)
        }.padding(20).contentShape(Rectangle())
    }
}

struct SharedExpenseCard: View {
    @Environment(AppStore.self) private var store
    let expense: SharedExpense
    var personEmail: String? = nil
    var changed: () -> Void
    @State private var payment: SharedPaymentContext?
    @State private var invite: ExpenseShare?
    @State private var showBill = false
    @State private var accepting: ExpenseShare?
    @State private var cancelling: ExpenseShare?
    @State private var lifecycle: GroupChangeDraft?
    @State private var reviewing: GroupReviewSelection?
    private var shares: [ExpenseShare] { expense.shares.filter { personEmail == nil || !expense.owned || ($0.personKey ?? $0.email) == personEmail } }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) { Text(expense.merchant.isEmpty ? "Shared purchase" : expense.merchant).font(.headline); Text((expense.kind == "refund" ? (expense.owned ? "Refund owed to you" : "Refund to return") : (expense.owned ? "You paid" : "Paid by " + expense.payer)) + " · " + readableDate(expense.date)).font(.caption).foregroundStyle(Brand.secondary) }
                Spacer(); Text(SharedMoney.format(expense.total, expense.currency)).font(.subheadline.weight(.semibold)).monospacedDigit()
            }
            if expense.hasReceipt == true { Button("View bill", systemImage: "doc.text") { showBill = true }.font(.subheadline) }
            ForEach(shares) { share in
                if share.reviewPending == true {
                    Text("A change to this share is awaiting review.").font(.subheadline).foregroundStyle(Brand.secondary)
                    if let id=share.pendingChangeId { Button("Review change",systemImage:"checklist") { reviewing=GroupReviewSelection(id:id) }.buttonStyle(.glass) }
                }
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 12) { PersonAvatar(email: share.personKey ?? share.email, name: expense.owned ? share.displayName : "You"); Text(expense.owned ? share.displayName : "Your share").font(.subheadline.weight(.semibold)); Spacer(minLength: 0); Text(SharedMoney.format(share.amount, expense.currency)).font(.subheadline.weight(.medium)).monospacedDigit() }
                    StatusBadge(title: status(share), symbol: statusSymbol(share),
                                color: share.state == "declined" ? Brand.danger : share.state == "invited" || share.state == "cancelled" ? Brand.secondary : Brand.sage)
                    if share.state == "invited" {
                        if expense.owned { ViewThatFits(in: .horizontal) {
                            HStack { invitationActions(share) }
                            VStack(alignment: .leading, spacing: 12) { invitationActions(share) }
                        } }
                        else {
                            ViewThatFits(in: .horizontal) {
                                HStack { responseActions(share) }
                                VStack(alignment: .leading, spacing: 12) { responseActions(share) }
                            }
                            Text(expense.unified ? "Choose a category and review the budget change before accepting." : "Acceptance records what you owe. It does not add spending.").font(.caption).foregroundStyle(Brand.secondary)
                        }
                    }
                    if expense.owned && expense.unified && share.state == "declined" && share.settlements.isEmpty { Button("Keep this share as my spending", systemImage: "cart") { cancelling = share }.font(.subheadline) }
                    if ["invited", "accepted", "declined"].contains(share.state) && (share.state == "accepted" || !share.settlements.isEmpty) {
                        RepaymentBreakdown(share: share, currency: expense.currency)
                        if !expense.owned && share.state == "accepted" && share.remaining > 0 {
                            Button { payment = SharedPaymentContext(expense: expense, share: share) } label: {
                                Label("Record a repayment", systemImage: "arrow.up.right.circle")
                                    .font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 44)
                            }.primaryAction(size: .regular)
                        }
                        ForEach(share.settlements) { settlement in
                            VStack(alignment: .leading, spacing: 12) {
                                HStack(alignment: .top, spacing: 12) {
                                    MeaningIcon(symbol: settlement.state == "confirmed" ? "checkmark.circle.fill" : settlement.state == "disputed" ? "questionmark.circle" : "clock",
                                                color: settlement.state == "disputed" ? Brand.danger : Brand.sage)
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(SharedMoney.format(settlement.amount, expense.currency)).font(.headline).monospacedDigit()
                                        Text(readableDate(settlement.date)).font(.caption).foregroundStyle(Brand.secondary)
                                    }
                                }
                                Text(settlement.state == "reversed" ? "Reversed" : settlement.state == "confirmed" ? "Received" : settlement.state == "disputed" ? "Not received. Check with each other." : "Awaiting receipt confirmation")
                                    .font(.subheadline.weight(.medium)).foregroundStyle(Brand.secondary)
                                if settlement.recordedByPayer == true {
                                    Text(expense.owned ? "Recorded by you" : "Recorded by payer").font(.caption).foregroundStyle(Brand.secondary)
                                    if !expense.owned && share.state == "accepted" && settlement.state == "confirmed" && settlement.recordedInYourBudget == false {
                                        Button("Add payment to my budget", systemImage: "wallet.bifold") { payment = SharedPaymentContext(expense: expense, share: share, settlement: settlement, importReceived: true) }.font(.subheadline)
                                        Text("Only add it if you paid and have not already recorded the payment.").font(.caption).foregroundStyle(Brand.secondary)
                                    }
                                }
                                if expense.owned && ["pending", "disputed"].contains(settlement.state) {
                                    Button { payment = SharedPaymentContext(expense: expense, share: share, settlement: settlement) } label: {
                                        Label("Confirm money received", systemImage: "checkmark.circle")
                                            .font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 44)
                                    }.primaryAction(size: .regular)
                                    if settlement.state == "pending" {
                                        Button { Task { _ = await store.sharedChange("/share-settlements/" + settlement.id, body: ["action": .string("dispute")]); changed() } } label: {
                                            Label("Payment not received", systemImage: "questionmark.circle")
                                                .font(.subheadline).frame(maxWidth: .infinity, minHeight: 44)
                                        }.buttonStyle(.bordered).tint(Brand.sage)
                                    }
                                }
                                if store.groupsAvailable && settlement.state != "reversed" && (expense.owned ? settlement.state == "confirmed" : settlement.recordedByPayer != true || settlement.recordedInYourBudget == true) {
                                    Button("Reverse repayment record", systemImage: "arrow.uturn.backward") { lifecycle = GroupChangeDraft(kind: "reverse_payment", expense: expense, settlement: settlement) }.font(.subheadline)
                                }
                            }.padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Brand.canvas, in: .rect(cornerRadius: 16))
                        }
                    }
                    if expense.owned && ["invited", "accepted", "declined"].contains(share.state) && share.remaining > 0 {
                        if share.pending > 0 {
                            recordReceived(share).buttonStyle(.bordered).tint(Brand.sage).controlSize(.large)
                        } else { recordReceived(share).primaryAction() }
                    }
                }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Brand.canvas, in: .rect(cornerRadius: 20)).disabled(share.reviewPending == true)
            }
            if store.groupsAvailable && expense.owned && expense.unified && expense.kind != "refund" {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 16) { changeActions }
                    VStack(alignment: .leading, spacing: 12) { changeActions }
                }.disabled(expense.budgetId != store.snapshot?.id || expense.shares.contains { $0.reviewPending == true })
            }
        }.padding(20).background(Brand.surface, in: .rect(cornerRadius: 24))
            .disabled(store.busy || store.hasPendingSave || store.sample)
            .sheet(item: $invite) { ShareInvitationView(expense: expense, share: $0) }
            .sheet(isPresented: $showBill) { SharedBillView(expense: expense) }
            .sheet(item: $accepting, onDismiss: changed) { SharedAcceptanceForm(expense: expense, share: $0) }
            .confirmationDialog("Cancel this request?", isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } }), titleVisibility: .visible) {
                if let share = cancelling { Button("Cancel request", role: .destructive) { respond(share, action: "cancel"); cancelling = nil } }
            } message: { Text("This share will become your spending in the original purchase category.") }
            .sheet(item: $payment, onDismiss: changed) { SharedPaymentForm(context: $0) }
            .sheet(item: $lifecycle, onDismiss: changed) { SharedChangeComposeView(draft: $0) }
            .sheet(item: $reviewing, onDismiss: changed) { SharedChangeReviewView(id: $0.id) }
    }
    @ViewBuilder private var changeActions: some View {
        Button("Correct bill", systemImage: "pencil") { lifecycle = GroupChangeDraft(kind: "correct", expense: expense) }.font(.subheadline).disabled((expense.refunded ?? 0) > 0)
        Button("Record shared refund", systemImage: "arrow.uturn.backward") { lifecycle = GroupChangeDraft(kind: "refund", expense: expense) }.font(.subheadline).disabled((expense.refunded ?? 0) >= expense.total)
    }
    private func respond(_ share: ExpenseShare, action: String) {
        var body: [String: JSONValue] = ["action": .string(action)]
        if action == "cancel" && expense.unified {
            guard let snapshot = store.snapshot, snapshot.id == expense.budgetId else { store.message = "Open the budget that paid for this purchase before cancelling its share."; return }
            body["expectedRevision"] = .number(Int64(snapshot.revision))
        }
        if action == "accept", let snapshot = store.snapshot { body["budgetId"] = .string(snapshot.id); body["expectedRevision"] = .number(Int64(snapshot.revision)) }
        Task { _ = await store.sharedChange("/expense-shares/" + share.id + "/respond", body: body); changed() }
    }
    private func status(_ share: ExpenseShare) -> String { if share.state == "refunded" { return "Refunded" }; if share.confirmed + (share.offset ?? 0) >= share.amount { return "Settled" }; return ["invited": "Awaiting acceptance", "accepted": share.pending > 0 ? "Awaiting confirmation" : "Outstanding", "declined": "Declined", "cancelled": "Cancelled"][share.state] ?? share.state }
    private func statusSymbol(_ share: ExpenseShare) -> String {
        if share.confirmed + (share.offset ?? 0) >= share.amount { return "checkmark.circle.fill" }
        return ["invited": "clock", "accepted": share.pending > 0 ? "clock" : "arrow.up.right.circle", "declined": "xmark.circle", "cancelled": "minus.circle"][share.state] ?? "info.circle"
    }
    private func recordReceived(_ share: ExpenseShare) -> some View {
        Button { payment = SharedPaymentContext(expense: expense, share: share, receiveOffline: true) } label: {
            Label(share.pending > 0 ? "Record another payment received" : "Record money received", systemImage: "arrow.down.left.circle")
                .font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 44)
        }
    }
    @ViewBuilder private func invitationActions(_ share: ExpenseShare) -> some View {
        if expense.groupId == nil { Button("Invite", systemImage: "message") { invite = share }.buttonStyle(.glass) }
        else { Text("Invite people from the group’s People section.").font(.caption).foregroundStyle(Brand.secondary) }
        if share.settlements.isEmpty && (share.refunded ?? 0) == 0 {
            Button("Cancel request", systemImage: "xmark.circle", role: .destructive) {
                if expense.unified { cancelling = share } else { respond(share, action: "cancel") }
            }.font(.subheadline).frame(minHeight: 44)
        }
    }
    @ViewBuilder private func responseActions(_ share: ExpenseShare) -> some View {
        Button("Accept share", systemImage: "checkmark") {
            if expense.unified { accepting = share } else { respond(share, action: "accept") }
        }.buttonStyle(.glass)
        Button("Decline", systemImage: "xmark", role: .destructive) { respond(share, action: "decline") }.frame(minHeight: 44)
    }
}

struct SharedPurchaseForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var initial: Transaction?
    var initialEmails: [String] = []
    var initialPerson: PersonBalance? = nil
    var purchaseDraft: SharedPurchaseDraft? = nil
    var onSaved: (() -> Void)? = nil
    @State private var selected: Transaction?
    @State private var people: [PersonDraft] = []
    @State private var groupChoices: [ExpenseGroupSummary] = []
    @State private var selectedGroupID = ""
    @State private var selectedGroup: ExpenseGroupDetail?
    @State private var manualPeople: [PersonDraft] = []
    @State private var splitMethod = SharedSplitMethod.equal
    @State private var ownWeight = "1"
    private var equal: Bool { splitMethod == .equal }
    @State private var email = ""
    @State private var recent: [PersonBalance] = []
    @State private var completed: SharedExpense?
    @State private var invitation: ExpenseShare?
    @State private var bill: ReceiptAttachment?
    @State private var includeBill = true
    @State private var contacts = false
    @State private var error: String?
    @State private var search = ""
    @State private var editorID = UUID()
    @State private var initialized = false
    @State private var discarded = false
    @FocusState private var enteringEmail: Bool
    private struct PersonDraft: Identifiable, Codable { var id = UUID().uuidString.lowercased(); var name: String; var email: String; var phone = ""; var amount = ""; var displayName: String { name.isEmpty ? email : name } }
    private var data: Overview? { purchaseDraft?.overview ?? store.overview }
    private var dirty: Bool { !selectedGroupID.isEmpty || !people.isEmpty || !email.isEmpty || !equal || !includeBill || (selected?.id != initial?.id && selected != nil) }
    private var shares: [Int64]? {
        guard let selected else { return nil }
        if equal { return people.map { _ in selected.amount / Int64(people.count + 1) } }
        if splitMethod == .amount { return try? people.map { try store.requireEngine().run("parseAmount", command: ["amount": $0.amount], as: Int64.self) } }
        let input=GroupBillDefinition(total:selected.amount,method:splitMethod.rawValue,people:[GroupBillCostInput(memberId:"self",value:ownWeight)]+people.map{GroupBillCostInput(memberId:$0.id,value:$0.amount)},payers:[GroupBillPaymentInput(memberId:"self",amount:selected.amount)])
        guard let plan:GroupComputedPlan=try? store.requireEngine().run("groupBillPlan",command:["plan":DraftFields.encode(input)]) else { return nil }
        return people.map { person in plan.people.first{$0.memberId==person.id}!.amount }
    }
    private var splitPreview: SharedBudgetPreview? {
        guard let selected, let shares, let budget = purchaseDraft?.budget ?? store.snapshot?.budget else { return nil }
        return try? store.requireEngine().run("sharedPreview", budget: budget, command: ["kind": "split", "entryId": selected.id, "amount": String(shares.reduce(0, +))])
    }
    private var canSend: Bool { (selectedGroupID.isEmpty || selectedGroup != nil) && !people.isEmpty && email.isEmpty && shares?.allSatisfy { $0 > 0 } == true && (shares?.reduce(0, +) ?? Int64.max) <= (selected?.amount ?? 0) && !store.busy && !store.hasPendingSave && !store.sample && store.sharingAvailable != false }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let completed {
                        Label { Text("Split saved") } icon: { SaveConfirmationMark() }
                            .font(.title2.weight(.semibold)).foregroundStyle(Brand.sage)
                        Text(completed.groupId == nil ? "Their shares are recorded. Send an invitation so each person can review and accept." : "Group members can review this bill in Groups. Invite anyone who has not joined from the group’s People section.").font(.subheadline).foregroundStyle(Brand.secondary)
                        ForEach(completed.groupId == nil ? completed.shares : []) { share in
                            HStack { VStack(alignment: .leading) { Text(share.displayName).font(.headline); Text(SharedMoney.format(share.amount, completed.currency)).font(.subheadline).foregroundStyle(Brand.secondary) }; Spacer(); Button("Invite", systemImage: "message") { invitation = share }.buttonStyle(.glass) }.padding(.vertical, 8)
                        }
                    } else if let selected, let data = data {
                        HStack(alignment: .firstTextBaseline) { Text(selected.payee).font(.headline); Spacer(); Text(data.money(selected.amount)).font(.title2.weight(.semibold)).foregroundStyle(Brand.sage).monospacedDigit() }
                        Text("You paid · " + readableDate(selected.date)).font(.caption).foregroundStyle(Brand.secondary)
                        if let bill {
                            Toggle(isOn: $includeBill) { Label("Include scanned bill", systemImage: "doc.text") }.font(.subheadline)
                            Text("The bill and its details will be visible to these people when they open their invitation.").font(.caption).foregroundStyle(Brand.secondary)
                            DisclosureGroup("Preview bill") { ReceiptPages(bill: bill) }
                        }
                        if !groupChoices.isEmpty {
                            Picker("Share in a group", selection: Binding(get: { selectedGroupID }, set: { value in if selectedGroupID.isEmpty { manualPeople = people }; selectedGroupID = value; Task { await chooseGroup(value, replace: true) } })) {
                                Text("Individual people").tag("")
                                ForEach(groupChoices) { group in Text(group.name).tag(group.id) }
                            }
                        }
                        if selectedGroupID.isEmpty { peoplePicker }
                        else { Text("Review the group members and their shares below.").font(.subheadline).foregroundStyle(Brand.secondary) }
                        if !people.isEmpty {
                            Picker("How to split", selection:Binding(get:{splitMethod},set:{chooseSplitMethod($0)})) { ForEach(SharedSplitMethod.allCases,id:\.self) { Text($0.title).tag($0) } }
                            if splitMethod == .percent || splitMethod == .shares { HStack { Text(splitMethod == .percent ? "Your percentage" : "Your share units");Spacer();SharedEntryField(title:"Your share weight",text:$ownWeight).multilineTextAlignment(.trailing).frame(width:90) } }
                            VStack(spacing: 0) {
                                splitRow("You", amount: data.money(selected.amount - (shares?.reduce(0, +) ?? 0)))
                                ForEach(Array(people.enumerated()), id: \.element.id) { index, person in
                                    Divider()
                                    HStack(spacing: 10) {
                                        VStack(alignment: .leading, spacing: 4) { Text(person.displayName).font(.subheadline.weight(.medium)); Text(person.email.isEmpty ? "Invite by message" : person.email).font(.caption).foregroundStyle(Brand.secondary) }
                                        Spacer(minLength: 6)
                                        if equal { Text(data.money(shares?[index] ?? 0)).font(.subheadline.weight(.semibold)).monospacedDigit() }
                                        else { SharedEntryField(title:splitMethod == .percent ? "Percentage" : splitMethod == .shares ? "Units" : "Share",text:$people[index].amount).multilineTextAlignment(.trailing).frame(width: 90).accessibilityLabel("Share for " + person.displayName) }
                                        Button("Remove " + person.displayName, systemImage: "minus.circle") { people.removeAll { $0.id == person.id } }.labelStyle(.iconOnly).frame(width: 44, height: 44)
                                    }.padding(.vertical, 10)
                                }
                            }.padding(.horizontal, 16).background(Brand.surface, in: .rect(cornerRadius: 22))
                            Text(equal || splitMethod == .amount ? "Your share includes any rounding remainder." : splitMethod == .percent ? "Percentages must add up to 100%. Rounding keeps the bill total exact." : "2 share units cost twice as much as 1.").font(.caption).foregroundStyle(Brand.secondary)
                        }
                        if !people.isEmpty, let preview = splitPreview {
                            VStack(alignment: .leading, spacing: 12) {
                                LabeledContent("Your spending", value: data.money(preview.personalSpending))
                                LabeledContent("Friends owe you", value: data.money(selected.amount - preview.personalSpending))
                                LabeledContent("Left in this category", value: data.money(preview.categoryLeft))
                                LabeledContent("Available to plan", value: data.money(preview.ready))
                                if preview.categoryLeft < 0 { Text("This category will be overspent by " + data.money(-preview.categoryLeft) + ".").foregroundStyle(Brand.danger) }
                                if data.accounts.first(where: { $0.id == selected.accountId })?.type == "credit" { Text("You remain responsible for the full card purchase. Repayments first cover card debt still needing cash.").font(.caption).foregroundStyle(Brand.secondary) }
                            }.font(.subheadline).padding(18).background(Brand.surface, in: .rect(cornerRadius: 22))
                        }
                        Text(store.sample ? "Fictional preview. No request will be sent." : "Save everyone’s share, then invite them by message. They can join SpentOn and accept later. Only your share will count as spending. Money owed to you stays unavailable until received.").font(.caption).foregroundStyle(Brand.secondary)
                    } else {
                        Text("What did you pay for?").font(.subheadline.weight(.semibold))
                        TextField("Find a purchase", text: $search).padding(14).glassEffect(.regular, in: .capsule)
                        if let data = data {
                            ForEach(data.transactions.filter { $0.canSplit && (search.isEmpty || $0.payee.localizedCaseInsensitiveContains(search)) }) { transaction in
                                Button { selected = transaction } label: { TransactionRow(transaction: transaction, data: data) }.buttonStyle(ContentRowStyle())
                            }
                        }
                        Text("Purchases from this month. You can also split directly from Activity.").font(.caption).foregroundStyle(Brand.secondary)
                    }
                    if store.sharingAvailable == false { Notice(message: "Sharing is not available on this version of SpentOn yet. Your purchase stays in your budget.") }
                    if let error { Notice(message: error) }
                }.id(selected?.id).transition(reduceMotion ? .opacity : .move(edge: .trailing).combined(with: .opacity))
                    .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: selected?.id)
                    .padding(20).frame(maxWidth: 600).frame(maxWidth: .infinity)
            }.scrollDismissesKeyboard(.interactively).background(Brand.canvas)
                .safeAreaInset(edge: .bottom) {
                    if completed != nil { Button { dismiss() } label: { Label("Done", systemImage: "checkmark").frame(maxWidth: .infinity) }.primaryAction().padding(16) } else if selected != nil { Button { send() } label: { Label(purchaseDraft == nil ? "Save split" : "Save purchase and split", systemImage: "person.2").frame(maxWidth: .infinity) }.primaryAction().disabled(!canSend).padding(16).background(Brand.canvas).accessibilityIdentifier("send-shares") }
                }
                .navigationTitle("Split a purchase").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(completed == nil ? "Cancel" : "Done", systemImage: completed == nil ? "xmark" : "checkmark") { discarded = true; dismiss() }.labelStyle(.iconOnly).disabled(store.busy) } }
                .interactiveDismissDisabled(completed == nil && (dirty || store.busy))
                .background {
                    ContactEmailPicker(isPresented: contacts,
                        selected: { values in contacts = false; store.beginEditing(editorID); addContacts(values) },
                        cancelled: { contacts = false; store.beginEditing(editorID) },
                        editorClosed: { store.endEditing(editorID) })
                        .frame(width: 1, height: 1).opacity(0.01).allowsHitTesting(false)
                }
                .sheet(item: $invitation) { share in if let completed { ShareInvitationView(expense: completed, share: share, phone: people.first { $0.id == share.personKey || (!$0.email.isEmpty && $0.email == share.email) }?.phone ?? "") } }
                .task { store.beginEditing(editorID); if !initialized { initialized = true; selected = initial; add(initialEmails); if let initialPerson { addPerson(initialPerson) }; loadBill() }; recent = (try? await store.sharedInbox())?.balances ?? []; if store.groupsAvailable { groupChoices = ((try? await store.expenseGroups())?.groups ?? []).filter { $0.membership == "active" && $0.state == "active" && $0.currency == store.overview?.currency } } }
                .onChange(of: selected?.id) { loadBill() }
                .onDisappear { if !contacts { store.endEditing(editorID) } }
                .editorSaveState(closeAfterRecovery: false)
                .onChange(of: store.pendingShared == nil) { _, resolved in
                    if resolved, completed == nil, let saved = store.lastSharedResponse?.expense, saved.entryId == selected?.id {
                        completed = saved; onSaved?()
                    }
                }

        }
    }
    private func chooseSplitMethod(_ method:SharedSplitMethod) {
        splitMethod=method
        if method == .equal { return }
        if method == .shares { ownWeight="1";people=people.map { person in var p=person;p.amount="1";return p };return }
        let total:Int64=method == .percent ? 10000 : selected?.amount ?? 0
        let input=GroupBillDefinition(total:total,method:"equal",people:[GroupBillCostInput(memberId:"self",value:"1")]+people.map{GroupBillCostInput(memberId:$0.id,value:"1")},payers:[GroupBillPaymentInput(memberId:"self",amount:total)])
        if let plan:GroupComputedPlan=try? store.requireEngine().run("groupBillPlan",command:["plan":DraftFields.encode(input)]) {
            ownWeight=NSDecimalNumber(value:plan.people.first{$0.memberId=="self"}!.amount).dividing(by:100).stringValue
            people=people.map { person in var p=person;p.amount=NSDecimalNumber(value:plan.people.first{$0.memberId==p.id}!.amount).dividing(by:100).stringValue;return p }
        }
    }
    private var peoplePicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text("Who’s sharing?").font(.headline); Spacer(); Button("Contacts", systemImage: "person.crop.circle.badge.plus") { enteringEmail = false; contacts = true }.font(.subheadline).disabled(people.count >= 20) }
            HStack(spacing: 8) {
                TextField("Name or email", text: $email).textInputAutocapitalization(.words).autocorrectionDisabled().focused($enteringEmail).submitLabel(.done).onSubmit { addTyped() }.accessibilityLabel("Person name or email")
                Button("Add person", systemImage: "plus.circle.fill") { addTyped() }.labelStyle(.iconOnly).font(.title2).frame(width: 44, height: 44).disabled(email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || people.count >= 20)
            }.padding(.leading, 14).padding(.trailing, 4).background(Brand.surface, in: .rect(cornerRadius: 16))
            let matches = recent.filter { person in !people.contains { $0.id == person.key || (!$0.email.isEmpty && $0.email == person.email) } && (email.isEmpty || person.displayName.localizedCaseInsensitiveContains(email) || person.email.localizedCaseInsensitiveContains(email)) }
            if !matches.isEmpty {
                ScrollView(.horizontal) { HStack(spacing: 8) { ForEach(matches.prefix(8)) { person in Button { addPerson(person); email = ""; enteringEmail = false } label: { Label(person.displayName, systemImage: "plus").font(.subheadline).padding(.horizontal, 12).frame(minHeight: 44) }.buttonStyle(.glass) } } }.scrollIndicators(.hidden)
            }
            Text("No SpentOn account needed. Choose a contact or enter their name.").font(.caption).foregroundStyle(Brand.secondary)
            if people.count >= 20 { Text("You can share with up to 20 people.").font(.caption).foregroundStyle(Brand.secondary) }
        }
    }
    private func splitRow(_ name: String, amount: String) -> some View { HStack { Text(name).font(.subheadline.weight(.medium)); Spacer(); Text(amount).font(.subheadline.weight(.semibold)).monospacedDigit() }.padding(.vertical, 18) }
    private func loadBill() { bill = ReceiptVault.read(id: selected?.receiptId, user: store.user?.id) }
    private func addPerson(_ person: PersonBalance) {
        guard people.count < 20, !people.contains(where: { $0.id == person.key }) else { return }
        people.append(PersonDraft(id: person.key, name: person.name ?? "", email: person.email))
    }
    private func addContacts(_ contacts: [SelectedContact]) {
        for contact in contacts {
            guard people.count < 20 else { error = "Choose up to 20 people for one purchase."; return }
            let address = contact.email.lowercased()
            if (!address.isEmpty && people.contains { $0.email == address }) || (!contact.phone.isEmpty && people.contains { $0.phone == contact.phone }) { continue }
            if address == store.user?.email.lowercased() { continue }
            let bytes = Array(SHA256.hash(data: Data(((store.user?.id ?? "") + ":" + contact.identifier).utf8)).prefix(16))
            let key = UUID(uuid: (bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15])).uuidString.lowercased()
            if people.contains(where: { $0.id == key }) { continue }
            people.append(PersonDraft(id: key, name: contact.name.isEmpty ? "Contact" : contact.name, email: address, phone: contact.phone))
        }
    }
    private func addTyped() {
        let value = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.contains("@") { if add(value.components(separatedBy: CharacterSet(charactersIn: ",;\n"))) { email = ""; enteringEmail = false } }
        else if !value.isEmpty && value.count <= 100 && people.count < 20 { people.append(PersonDraft(name: value, email: "")); email = ""; enteringEmail = false; error = nil }
        else { error = "Enter a name of up to 100 characters." }
    }
    @discardableResult private func add(_ emails: [String]) -> Bool {
        let values = Array(Set(emails.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })).sorted()
        guard values.allSatisfy({ $0.range(of: #"^\S+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil && $0 != store.user?.email.lowercased() && $0.count <= 254 }) else { error = "Enter a valid email, or add the person by name."; return false }
        let added = values.filter { value in !people.contains { $0.email == value } }
        guard people.count + added.count <= 20 else { error = "Choose up to 20 people for one purchase."; return false }
        people += added.map { PersonDraft(name: "", email: $0) }; error = nil; return true
    }
    private func chooseGroup(_ id: String, replace: Bool) async {
        selectedGroup = nil
        guard !id.isEmpty else { if replace { people = manualPeople }; return }
        do {
            let group = try await store.expenseGroup(id)
            guard selectedGroupID == id else { return }
            guard group.budgetId == store.snapshot?.id else { error = "Open the budget you joined this group with, or choose individual people."; return }
            selectedGroup = group
            if replace { people = group.members.filter { !$0.isYou && $0.state != "removed" }.map { PersonDraft(id: $0.id, name: $0.name, email: $0.email ?? "") } }
            error = nil
        } catch { self.error = error.localizedDescription }
    }
    private func send() {
        guard canSend, let selected, let snapshot = store.snapshot, let shares else { return }
        let values = zip(people, shares).map { JSONValue.object(["email": .string($0.email), "name": .string($0.name), (selectedGroup == nil ? "personKey" : "memberId"): .string($0.id), "amount": .number($1)]) }
        var body: [String: JSONValue] = ["budgetId": .string(snapshot.id), "expectedRevision": .number(Int64(snapshot.revision)), "entryId": .string(selected.id), "shares": .array(values)]
        if let group = selectedGroup { body["groupId"] = .string(group.id); body["expectedGroupRevision"] = .number(Int64(group.revision)) }
        if let purchaseDraft { body["purchase"] = purchaseDraft.payload }
        if includeBill, let bill { body["receipt"] = bill.json }
        Task { if await store.sharedChange("/shared-expenses", body: body) { completed = store.lastSharedResponse?.expense; onSaved?() } else { error = store.message } }
    }
}
struct SharedPaymentContext: Identifiable {
    let id = UUID(); let expense: SharedExpense; let share: ExpenseShare; var settlement: ShareSettlement?
    var receiveOffline = false
    var importReceived = false
    var receiving: Bool { receiveOffline || (settlement != nil && !importReceived) }
    var budgetID: String? { receiving ? expense.budgetId : share.budgetId }
}
struct SharedPaymentForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let context: SharedPaymentContext
    @State private var amount = ""
    @State private var accountID = ""
    @State private var categoryID = ""
    @State private var date = Date.now
    @State private var confirmed = false
    @State private var editorID = UUID()
    @State private var accountPicker = false
    @State private var categoryPicker = false
    @State private var error: String?
    @State private var discarded = false
    @State private var original: [String: String]?
    @FocusState private var enteringAmount: Bool
    private var fields: [String: String] { ["amount": amount, "account": accountID, "category": categoryID, "date": String(date.timeIntervalSince1970)] }
    private var dirty: Bool { confirmed || (original.map { $0 != fields } ?? false) }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if context.budgetID != store.snapshot?.id {
                        Text("Open the budget associated with this share to record its repayment.").font(.subheadline)
                        Button("Open associated budget", systemImage: "wallet.bifold") { if let id = context.budgetID { Task { await store.open(id) } } }.buttonStyle(.glass)
                    } else if let data = store.overview {
                        Text(context.receiving ? context.share.displayName : context.expense.payer).font(.headline)
                        Text("Remaining share: " + data.money(context.share.remaining)).font(.subheadline).foregroundStyle(Brand.secondary)
                        Text(context.expense.merchant).font(.subheadline.weight(.semibold))
                        if let settlement = context.settlement { Text(data.money(settlement.amount)).font(.title2.weight(.semibold)).foregroundStyle(Brand.sage) }
                        else { TextField(context.receiving ? "Amount received" : "Repayment amount", text: $amount).keyboardType(.decimalPad).focused($enteringAmount).font(.title2.weight(.semibold)).padding(14).background(Brand.surface, in: .rect(cornerRadius: 16)) }
                        Button { enteringAmount = false; accountPicker = true } label: { Label(data.accounts.first { $0.id == accountID }?.name ?? (context.receiving ? "Choose receiving account" : "Choose the account you paid from"), systemImage: "wallet.bifold").frame(minHeight: 44) }
                        if !context.receiving && !context.expense.unified { Button { enteringAmount = false; categoryPicker = true } label: { Label(data.categories.first { $0.id == categoryID }?.name ?? "Choose category for your share", systemImage: "square.grid.2x2").frame(minHeight: 44) } }
                        DatePicker(context.receiving ? "Date received" : "Date paid", selection: $date, in: ...Date.now, displayedComponents: .date).font(.subheadline)
                        Toggle(isOn: $confirmed) {
                            Label(context.receiving ? "I received this money and haven’t recorded it" : "I paid and haven’t recorded this payment",
                                  systemImage: context.receiving ? "arrow.down.left.circle" : "arrow.up.right.circle")
                        }.tint(Brand.sage)
                        Text(context.expense.kind == "refund" ? (context.receiving ? "Returns the refunded money to your account and original category. No income or spending is recorded again." : "Records the refund paid back to this person. Your personal spending stays unchanged.") : context.expense.unified ? (context.receiving ? "Adds money to your receiving account and reduces what this person owes. Spending stays unchanged. Any card debt still needing cash is covered first." : "Records money leaving your account and reduces what you owe. Your category was charged when you accepted; spending stays unchanged.") : context.receiving ? "Adds the reimbursement to your cash account and reduces your original purchase cost. It does not pay off a credit card." : "Adds your share as a purchase in this account and asks the other person to confirm receipt. Check that you haven’t already recorded this repayment.").font(.subheadline).foregroundStyle(Brand.secondary)
                        if context.receiving && !context.expense.unified { Text("Returns to " + (data.transactions.first { $0.id == context.expense.entryId }?.categoryName ?? "the original purchase category") + ".").font(.subheadline) }
                        if context.receiveOffline { Text("Recorded by you. Their acceptance is not required.").font(.caption).foregroundStyle(Brand.secondary) }
                        if context.importReceived { Text("The payer has already recorded receipt. This adds only your payment; it will not credit their account again.").font(.caption).foregroundStyle(Brand.secondary) }
                        Text("Record money sent using another service. SpentOn does not send money.").font(.caption).foregroundStyle(Brand.secondary)
                    }
                    if let error { Notice(message: error) }
                }.padding(20).frame(maxWidth: 600).frame(maxWidth: .infinity)
            }.background(Brand.canvas).scrollDismissesKeyboard(.interactively).navigationTitle(context.importReceived ? "Add payment to budget" : context.receiveOffline ? "Record money received" : context.receiving ? "Confirm repayment" : "Record repayment").navigationBarTitleDisplayMode(.inline)
                .safeAreaInset(edge: .bottom) { if context.budgetID == store.snapshot?.id { saveButton.padding(16).frame(maxWidth: .infinity).background(Brand.canvas) } }
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { discarded = true; dismiss() }.disabled(store.busy) } }
                .interactiveDismissDisabled(dirty || store.busy)
                .sheet(isPresented: $accountPicker) { if let data = store.overview { AccountPickerSheet(title: context.receiving ? "Received into" : "Paid from", data: data, accounts: data.accounts.filter(\.isCash), selection: $accountID) } }
                .sheet(isPresented: $categoryPicker) { if let data = store.overview { CategoryPickerSheet(data: data, selection: $categoryID) } }
                .task { store.beginEditing(editorID); guard original == nil else { return }; amount = NSDecimalNumber(value: context.share.remaining).dividing(by: 100).stringValue; if let settlement = context.settlement { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); date = f.date(from: settlement.date) ?? .now }; original = fields }
                .onDisappear { store.endEditing(editorID) }
                .editorSaveState()
                .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { enteringAmount = false } } }

        }
    }
    private var saveButton: some View {
        Button(context.importReceived ? "Add payment to my budget" : context.receiveOffline ? "Record money received" : context.receiving ? "Confirm receipt and add transaction" : "Record repayment and notify payer",
               systemImage: context.receiving ? "arrow.down.left.circle" : "arrow.up.right.circle") { save() }
            .accessibilityIdentifier("record-shared-payment").primaryAction()
            .disabled(!confirmed || accountID.isEmpty || (!context.receiving && !context.expense.unified && categoryID.isEmpty) || store.busy || store.hasPendingSave)
    }
    private func save() {
        enteringAmount = false
        guard confirmed, !store.busy, let snapshot = store.snapshot, snapshot.id == context.budgetID else { return }
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        var body: [String: JSONValue] = ["expectedRevision": .number(Int64(snapshot.revision)), "accountId": .string(accountID), "date": .string(f.string(from: date))]
        let path: String
        if let settlement = context.settlement, context.importReceived {
            body["confirmPaid"] = .bool(true); body["categoryId"] = .string(categoryID); path = "/share-settlements/" + settlement.id + "/record"
        } else if let settlement = context.settlement { body["action"] = .string("confirm"); body["confirmReceived"] = .bool(true); path = "/share-settlements/" + settlement.id }
        else {
            guard let minor: Int64 = try? store.requireEngine().run("parseAmount", command: ["amount": amount]), minor > 0, minor <= context.share.remaining else { error = "Enter an amount within your unpaid share."; return }
            body["amount"] = .number(minor)
            if context.receiveOffline { body["confirmReceived"] = .bool(true); path = "/expense-shares/" + context.share.id + "/receive" }
            else { body["categoryId"] = .string(categoryID); body["confirmPaid"] = .bool(true); path = "/expense-shares/" + context.share.id + "/repay" }
        }
        Task { if await store.sharedChange(path, body: body) { dismiss() } else { error = store.message } }
    }
}
