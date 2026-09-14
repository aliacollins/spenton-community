import SwiftUI

struct GroupReviewSelection: Identifiable { let id: String }
struct GroupScheduleEditor:Identifiable { let id=UUID();let group:ExpenseGroupDetail;var series:GroupBillSeries?=nil }
struct GroupChangeDraft: Identifiable {
    let id = UUID()
    let kind: String
    var expense: SharedExpense? = nil
    var settlement: ShareSettlement? = nil
    var group: ExpenseGroupDetail? = nil
    var pair: ExpenseGroupPair? = nil
    var change: SharedLifecycleChange? = nil
    var key: String { kind + ":" + (settlement?.id ?? expense?.id ?? pair?.id ?? change?.id ?? group?.id ?? id.uuidString) }
    var title: String { ["correct": "Correct shared bill", "refund": "Record shared refund", "offset": "Review direct offset", "reverse_payment": "Reverse repayment", "reverse_offset": "Reverse offset"][kind] ?? "Shared change" }
}
struct GroupPersonDraft: Identifiable, Codable {
    var id = UUID().uuidString.lowercased()
    var name = ""
    var email = ""
    var amount = ""
    var included = true
    var personKey: String? = nil
}
@MainActor func dismissGroupKeyboard() { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
func groupDateKey(_ date: Date) -> String {
    let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f.string(from: date)
}
func groupDate(_ value: String) -> Date {
    let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f.date(from: value) ?? .now
}

struct ExpenseGroupsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var list: ExpenseGroupsList?
    @State private var error: String?
    @State private var create = false
    @State private var joining: ExpenseGroupSummary?
    @State private var selected: String?
    @State private var pendingSelection: String?
    @State private var review: GroupReviewSelection?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    Text("Households, trips and events").font(.subheadline).foregroundStyle(Brand.secondary)
                    Spacer()
                    Button("New group", systemImage: "plus") { create = true }.buttonStyle(.glass).disabled(store.pendingShared != nil || store.busy)
                }
                if let list {
                    if list.groups.isEmpty { ContentUnavailableView("Your first shared plan", systemImage: "person.3", description: Text("Create a group, add the people sharing costs, and record each bill once.")) }
                    VStack(spacing: 12) {
                        ForEach(list.groups) { group in
                            Button { if group.membership == "invited" { joining = group } else { selected = group.id } } label: {
                                HStack(spacing: 14) {
                                    MeaningIcon(symbol: group.kind == "trip" ? "airplane" : group.kind == "household" ? "house" : "calendar")
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(group.name).font(.headline).foregroundStyle(Brand.ink)
                                        Text("\(group.memberCount) people · \(group.currency)" + (group.membership == "invited" ? " · Invitation" : group.state == "archived" ? " · Archived" : "")).font(.caption).foregroundStyle(Brand.secondary)
                                    }
                                    Spacer(minLength: 0); Image(systemName: "chevron.right").font(.caption).foregroundStyle(Brand.secondary)
                                }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(Brand.surface, in: .rect(cornerRadius: 20))
                            }.buttonStyle(ContentRowStyle()).accessibilityIdentifier("group-" + group.id)
                        }
                    }
                    if !list.changes.isEmpty {
                        Text("Shared changes").font(.headline)
                        ForEach(list.changes) { change in GroupReviewRow(change: change) { review = GroupReviewSelection(id: change.id) } }
                    }
                } else if error == nil { ProgressView("Loading groups") }
                if let error { Notice(message: error); Button("Try again") { Task { await load() } } }
            }.padding(20).frame(maxWidth: 680).frame(maxWidth: .infinity)
        }.background(Brand.canvas).refreshable { await load() }
            .navigationDestination(item: $selected) { ExpenseGroupDetailView(id: $0) }
            .sheet(isPresented: $create, onDismiss: finishPresentation) { GroupCreateView { id in pendingSelection = id } }
            .sheet(item: $joining, onDismiss: finishPresentation) { GroupJoinView(group: $0) { id in pendingSelection = id } }
            .sheet(item: $review, onDismiss: { Task { await load() } }) { SharedChangeReviewView(id: $0.id) }
            .task { await load(); while !Task.isCancelled { try? await Task.sleep(for: .seconds(5)); if !Task.isCancelled && scenePhase == .active && !store.editing && !store.busy && !create && joining == nil && review == nil && selected == nil { await load() } } }
    }
    private func finishPresentation() { if let id=pendingSelection { pendingSelection=nil;selected=id };Task { await load() } }
    private func load() async { do { list = try await store.expenseGroups(); error = nil } catch { self.error = error.localizedDescription } }
}

struct GroupReviewRow: View {
    let change: SharedLifecycleChange
    let open: () -> Void
    var body: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                MeaningIcon(symbol: change.state == "applied" ? "checkmark.circle" : "clock")
                VStack(alignment: .leading, spacing: 4) {
                    Text(change.title).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                    Text((change.merchant ?? "Shared expense") + " · " + (change.state == "pending" ? "Review needed" : change.state == "applied" ? "Applied" : "Cancelled")).font(.caption).foregroundStyle(Brand.secondary)
                }
                Spacer(minLength: 0); Image(systemName: "chevron.right").font(.caption).foregroundStyle(Brand.secondary)
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Brand.surface, in: .rect(cornerRadius: 16))
        }.buttonStyle(ContentRowStyle())
    }
}

struct ExpenseGroupDetailView: View {
    @Environment(AppStore.self) private var store
    @Environment(NavigationContext.self) private var navigation
    @Environment(\.scenePhase) private var scenePhase
    let id: String
    @State private var detail: ExpenseGroupDetail?
    @State private var error: String?
    @State private var purchase: ExpenseGroupDetail?
    @State private var simpleExpense = false
    @State private var jointReview:GroupReviewSelection?
    @State private var scheduleEditor:GroupScheduleEditor?
    @State private var addMember = false
    @State private var action: GroupChangeDraft?
    @State private var review: GroupReviewSelection?
    @State private var bill: SharedExpense?
    @State private var publicBill: ExpenseGroupBill?
    @State private var invitation: ExpenseGroupInvitation?
    @State private var archive = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let detail {
                    Text(detail.name).appFont(32,weight:.semibold)
                    Text(detail.members.filter { $0.state != "removed" }.map { $0.isYou ? "You" : $0.name }.joined(separator:", ")).font(.subheadline).foregroundStyle(Brand.secondary)
                    groupMoney("Group spending",detail.total,detail.currency)
                    if detail.budgetId != store.snapshot?.id, let budgetID = detail.budgetId {
                        Text("Open the budget you joined with to add bills and approve changes.").font(.subheadline).foregroundStyle(Brand.secondary)
                        Button("Open group budget", systemImage: "wallet.bifold") { Task { do { try await store.loadBudget(budgetID) } catch { self.error = error.localizedDescription } } }.buttonStyle(.glass).disabled(store.pendingShared != nil || store.pending != nil || store.busy)
                    }
                    Text("Expenses").font(.headline)
                    FinanceRows {
                        ForEach(detail.combinedBills ?? []) { item in
                            Button { jointReview=GroupReviewSelection(id:item.id) } label: {
                                AppRow(title:item.merchant,subtitle:readableDate(item.date)+" · "+(item.state=="pending" ? "Payers reviewing" : item.state=="cancelled" ? "Cancelled" : "Recorded"),value:SharedMoney.format(item.total,detail.currency),symbol:"receipt",color:Brand.blue)
                            }.buttonStyle(.plain)
                            FinanceDivider()
                        }
                        ForEach(individualBills(detail)) { item in
                            individualBillRow(item,detail)
                            if item.id != individualBills(detail).last?.id { FinanceDivider() }
                        }
                    }
                    DisclosureGroup("People in this group") {
                        VStack(spacing: 16) {
                            ForEach(detail.members) { person in
                                HStack(spacing: 12) {
                                    if person.isYou {
                                        PersonAvatar(email:person.id,name:person.name)
                                        Text(person.name+" (you)").font(.subheadline)
                                    } else {
                                        NavigationLink {
                                            SharedPersonView(person:PersonBalance(email:person.email ?? "",currency:detail.currency,owedToYou:0,youOwe:0,pendingToYou:0,pendingFromYou:0,requestedToYou:0,requestedFromYou:0,name:person.name,personKey:person.personKey ?? person.id))
                                        } label: {
                                            HStack(spacing:12){
                                                PersonAvatar(email:person.id,name:person.name)
                                                VStack(alignment:.leading,spacing:4){Text(person.name).font(.subheadline.weight(.medium));Text("View all shared expenses").font(.caption).foregroundStyle(Brand.secondary)}
                                            }
                                        }.buttonStyle(.plain)
                                    }
                                    Spacer(minLength: 0)
                                    if person.state == "invited" { Button("Invite", systemImage: "square.and.arrow.up") { invite(person.id) }.font(.subheadline).disabled(store.busy || store.pendingShared != nil) }
                                }
                            }
                            if detail.canManage && detail.state == "active" { Button("Add person", systemImage: "person.badge.plus") { addMember = true }.buttonStyle(.glass) }
                        }.padding(.top, 16)
                    }.font(.subheadline).tint(Brand.sage)
                    DisclosureGroup("Balances and repayments") {
                        VStack(alignment:.leading,spacing:20) {
                    Text("Shares and payments").font(.headline)
                    ForEach(detail.balances) { balance in
                        VStack(alignment: .leading, spacing: 12) {
                            Text(balance.name).font(.headline)
                            groupMoney("Paid for the group", balance.paid, detail.currency)
                            groupMoney("Personal share", balance.share, detail.currency)
                            groupMoney(balance.owed >= balance.owing ? "Net owed to them" : "Net they owe", abs(balance.owed - balance.owing), detail.currency)
                        }.padding(18).background(Brand.surface, in: .rect(cornerRadius: 18))
                    }
                    Text("Shares include recorded requests. Each person reviews their own budget before accepting. Net amounts do not redirect payments.").font(.caption).foregroundStyle(Brand.secondary)
                    Text("You and each person").font(.headline)
                    ForEach(detail.settlements.filter { $0.owesYou > 0 || $0.youOwe > 0 }) { pair in
                        VStack(alignment: .leading, spacing: 14) {
                            Text(pair.name).font(.headline)
                            groupMoney("They owe you", pair.owesYou, detail.currency)
                            groupMoney("You owe them", pair.youOwe, detail.currency)
                            Text(pair.net == 0 ? "Your balances match." : pair.net > 0 ? "After offsets, they would pay you " + SharedMoney.format(pair.net, detail.currency) + "." : "After offsets, you would pay " + SharedMoney.format(-pair.net, detail.currency) + ".").font(.subheadline).foregroundStyle(Brand.secondary)
                            if pair.canOffset { Button("Review " + SharedMoney.format(pair.offsettable, detail.currency) + " offset", systemImage: "arrow.left.arrow.right") { action = GroupChangeDraft(kind: "offset", group: detail, pair: pair) }.buttonStyle(.glass).disabled(!canEdit(detail)) }
                            DisclosureGroup("See the original bills") {
                                ForEach(pair.lines.filter { $0.amount > 0 }) { line in
                                    Button { openBill(line.expenseId) } label: {
                                        HStack { VStack(alignment: .leading, spacing: 4) { Text(line.merchant); Text(line.direction == "incoming" ? "They owe you" : "You owe them").font(.caption).foregroundStyle(Brand.secondary) }; Spacer(); Text(SharedMoney.format(line.amount, detail.currency)).monospacedDigit() }.font(.subheadline).padding(.vertical, 12)
                                    }.buttonStyle(ContentRowStyle())
                                }
                            }.font(.subheadline).tint(Brand.sage)
                        }.padding(18).background(Brand.surface, in: .rect(cornerRadius: 18))
                    }
                        }
                    }.font(.subheadline)
                    if detail.billVersion==1 {
                        DisclosureGroup("Repeating bills") {
                            GroupCombinedBillSections(group:detail,openBill:{jointReview=GroupReviewSelection(id:$0)},editSeries:{scheduleEditor=GroupScheduleEditor(group:detail,series:$0)},changeSeries:{series,action in changeSeries(series,action)},showBills:false)
                        }.font(.subheadline)
                    }
                    if !detail.changes.isEmpty { Text("Shared changes").font(.headline); ForEach(detail.changes) { change in GroupReviewRow(change: change) { review = GroupReviewSelection(id: change.id) } } }
                    if detail.canManage && detail.state == "active" { Button("Archive settled group", systemImage: "archivebox") { archive = true }.font(.subheadline).disabled(!canEdit(detail) || detail.balances.contains { $0.owed > 0 || $0.owing > 0 || $0.pending > 0 } || detail.changes.contains { $0.state == "pending" } || (detail.combinedBills ?? []).contains { $0.state == "pending" }) }
                } else if error == nil { ProgressView("Loading group") }
                if let error { Notice(message: error); Button("Try again") { Task { await load() } } }
            }.padding(20).frame(maxWidth: 680).frame(maxWidth: .infinity)
        }.background(Brand.canvas).navigationTitle(detail?.name ?? "Group").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement:.topBarTrailing) {
                    if let detail {
                        Menu {
                            Button("Add expense",systemImage:"plus") { simpleExpense=true }
                            Button("Jointly paid bill",systemImage:"person.2") { purchase=detail }
                            Button("Repeating bill",systemImage:"repeat") { scheduleEditor=GroupScheduleEditor(group:detail) }
                        } label: { Image(systemName:"plus") }.disabled(!canEdit(detail)).accessibilityLabel("Add group expense").accessibilityIdentifier("group-add-bill")
                    }
                }
            }
            .refreshable { await load() }
            .task { await load(); while !Task.isCancelled { try? await Task.sleep(for: .seconds(5)); if !Task.isCancelled && scenePhase == .active && !store.editing && !store.busy && purchase == nil && !addMember && action == nil && review == nil && bill == nil && jointReview == nil && scheduleEditor == nil { await load() } } }
            .sheet(isPresented:$simpleExpense,onDismiss:{Task{await load()}}) { if let detail { TransactionForm(seed:QuickEntry(people:peopleDraft(detail))) } }
            .onAppear { if let detail { setContext(detail) } }
            .onDisappear { if navigation.people.groupId==id { navigation.people=ExpensePeopleDraft();navigation.requiredBudgetID="" } }
            .sheet(item: $purchase, onDismiss: { Task { await load() } }) { group in if group.billVersion==1 { GroupBillComposeView(group:group) } else { GroupPurchaseView(group:group) } }
            .sheet(item:$jointReview,onDismiss:{Task{await load()}}){GroupBillReviewView(id:$0.id)}
            .sheet(item:$scheduleEditor,onDismiss:{Task{await load()}}){GroupBillComposeView(group:$0.group,series:$0.series,recurring:true)}
            .sheet(isPresented: $addMember, onDismiss: { Task { await load() } }) { if let detail { GroupAddMemberView(group: detail) } }
            .sheet(item: $action, onDismiss: { Task { await load() } }) { SharedChangeComposeView(draft: $0) }
            .sheet(item: $review, onDismiss: { Task { await load() } }) { SharedChangeReviewView(id: $0.id) }
            .sheet(item: $bill, onDismiss: { Task { await load() } }) { GroupBillView(initial: $0) }
            .sheet(item:$publicBill) { entry in if let detail { PublicGroupBillView(bill:entry,group:detail) } }
            .sheet(isPresented: Binding(get: { invitation != nil }, set: { if !$0 { invitation = nil } })) { if let invitation { GroupInvitationSheet(invitation: invitation) } }
            .confirmationDialog("Archive this settled group?", isPresented: $archive, titleVisibility: .visible) {
                Button("Archive group") { guard let detail else { return }; Task { if await store.sharedChange("/expense-groups/" + id, body: ["actionType": .string("archive"), "expectedGroupRevision": .number(Int64(detail.revision))]) { await load() } else { error = store.message } } }
            } message: { Text("Its bills and history will remain available.") }
    }
    private func changeSeries(_ series:GroupBillSeries,_ action:String) {
        Task { if await store.sharedChange("/group-bill-series/"+series.id,body:["expectedSeriesRevision":.number(Int64(series.revision)),"actionType":.string(action)]) { if let bill=store.lastGroupResponse?.bill { jointReview=GroupReviewSelection(id:bill.id) };await load() } else { error=store.message } }
    }
    private func individualBills(_ group:ExpenseGroupDetail)->[ExpenseGroupBill] {
        let components=Set((group.combinedBills ?? []).flatMap{$0.payers.compactMap(\.expenseId)})
        return group.bills.filter{!components.contains($0.id)}
    }
    private func individualBillRow(_ expense:ExpenseGroupBill,_ group:ExpenseGroupDetail)->some View {
        let payer=group.members.first{$0.id==expense.payerId}?.name ?? "Former member"
        let description=(expense.kind=="refund" ? "Refund to return" : "Paid by "+payer)+" · "+readableDate(expense.date)
        return Button {
            if !expense.archived && (expense.payerId==group.memberId || expense.shares.contains{$0.memberId==group.memberId}){openBill(expense.id)}
            else{publicBill=expense}
        } label:{
            AppRow(title:expense.merchant,subtitle:description,value:SharedMoney.format(expense.total-expense.refunded,group.currency),symbol:"receipt",color:Brand.blue)
        }.buttonStyle(.plain)
    }
    private func canEdit(_ group: ExpenseGroupDetail) -> Bool { group.state == "active" && group.budgetId == store.snapshot?.id && !store.busy && !store.hasPendingSave }
    private func peopleDraft(_ group:ExpenseGroupDetail)->ExpensePeopleDraft {
        ExpensePeopleDraft(people:group.members.filter{!$0.isYou && $0.state != "removed"}.map{ExpensePersonDraft(id:$0.personKey ?? $0.id,name:$0.name,email:$0.email ?? "",memberId:$0.id)},groupId:group.id,groupName:group.name,groupRevision:group.revision)
    }
    private func setContext(_ group:ExpenseGroupDetail){navigation.people=peopleDraft(group);navigation.requiredBudgetID=group.budgetId ?? ""}
    private func load() async { do { let group = try await store.expenseGroup(id);detail=group;setContext(group);error = nil; await store.refresh() } catch { self.error = error.localizedDescription } }
    private func openBill(_ id: String) { Task { do { bill = try await store.sharedExpense(id) } catch { self.error = error.localizedDescription } } }
    private func invite(_ id: String) { Task { if await store.sharedChange("/expense-group-members/" + id + "/invite", body: [:]) { invitation = store.lastGroupResponse?.invitation } else { error = store.message } } }
}

struct PublicGroupBillView:View {
    @Environment(\.dismiss) private var dismiss
    let bill:ExpenseGroupBill
    let group:ExpenseGroupDetail
    var body:some View {
        NavigationStack {
            ScrollView {
                VStack(alignment:.leading,spacing:24){
                    AppHero(label:bill.merchant,value:SharedMoney.format(bill.total-bill.refunded,group.currency))
                    FinancePanel{
                        LabeledContent("Date",value:readableDate(bill.date))
                        LabeledContent("Paid by",value:group.members.first{$0.id==bill.payerId}?.name ?? "Former member")
                        if bill.refunded>0{LabeledContent("Refunded",value:SharedMoney.format(bill.refunded,group.currency))}
                    }.font(.subheadline)
                    Text("Shared amounts").font(.headline)
                    FinancePanel{
                        ForEach(bill.shares){share in
                            LabeledContent(group.members.first{$0.id==share.memberId}?.name ?? "Former member",value:SharedMoney.format(share.amount-share.refunded,group.currency)).font(.subheadline)
                        }
                    }
                    if bill.archived{Text("Retained group history.").font(.caption).foregroundStyle(Brand.secondary)}
                }.padding(24)
            }.background(Brand.canvas).navigationTitle("Group bill").navigationBarTitleDisplayMode(.inline)
                .toolbar{ToolbarItem(placement:.confirmationAction){Button("Done"){dismiss()}}}
        }
    }
}

func groupMoney(_ label: String, _ amount: Int64, _ currency: String) -> some View {
    ViewThatFits(in: .horizontal) {
        HStack(alignment: .firstTextBaseline) { Text(label).foregroundStyle(Brand.secondary); Spacer(minLength: 16); Text(SharedMoney.format(amount, currency)).fontWeight(.semibold).monospacedDigit() }
        VStack(alignment: .leading, spacing: 5) { Text(label).foregroundStyle(Brand.secondary); Text(SharedMoney.format(amount, currency)).fontWeight(.semibold).monospacedDigit() }
    }.font(.subheadline)
}

struct GroupInvitationSheet: View {
    @Environment(\.dismiss) private var dismiss
    let invitation: ExpenseGroupInvitation
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("Invite " + invitation.name).font(.title2.weight(.semibold))
                Text("Join me in " + invitation.groupName + " on SpentOn to review our shared bills and repayments.").font(.body)
                if let url = URL(string: invitation.url) { ShareLink(item: url, message: Text("Join me in " + invitation.groupName + " on SpentOn.")) { Label("Share invitation", systemImage: "square.and.arrow.up") }.buttonStyle(.glassProminent) }
                Text("Send this private link to the intended person. It expires in seven days.").font(.caption).foregroundStyle(Brand.secondary)
                Spacer()
            }.padding(24).background(Brand.canvas).navigationTitle("Invitation").navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct GroupBillView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let initial: SharedExpense
    @State private var value: SharedExpense?
    @State private var error: String?
    var body: some View {
        NavigationStack {
            ScrollView { VStack(spacing: 20) { SharedExpenseCard(expense: value ?? initial, changed: { Task { await load() } }); if let error { Notice(message: error) } }.padding(20) }
                .background(Brand.canvas).navigationTitle("Shared bill").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }.task { await load() }
        }
    }
    private func load() async { do { value = try await store.sharedExpense(initial.id) } catch { self.error = error.localizedDescription } }
}
