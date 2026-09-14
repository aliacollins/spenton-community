import SwiftUI

struct SharedChangeComposeView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let draft: GroupChangeDraft
    @State private var amount=""
    @State private var merchant=""
    @State private var reason=""
    @State private var category=""
    @State private var date=Date.now
    @State private var shares:[GroupPersonDraft]=[]
    @State private var initialized=false
    @State private var submitted=false
    @State private var discarded=false
    @State private var editorID=UUID()
    @State private var reviewID:String?
    @State private var error:String?
    private var currency:String { draft.group?.currency ?? draft.expense?.currency ?? store.overview?.currency ?? "USD" }
    private var fields:[String:String] { ["amount":amount,"merchant":merchant,"reason":reason,"category":category,"date":groupDateKey(date),"shares":DraftFields.encode(shares)] }
    var body: some View {
        NavigationStack {
            BrandedForm {
                Section {
                    Text(explanation).font(.subheadline).foregroundStyle(Brand.secondary)
                    if let expense=draft.expense { Text(expense.merchant).font(.headline);Text(SharedMoney.format(expense.total,expense.currency)+" · "+readableDate(expense.date)).font(.subheadline).foregroundStyle(Brand.secondary) }
                    if let pair=draft.pair {
                        ForEach(pair.lines.filter{$0.amount>0}) { line in VStack(alignment:.leading,spacing:5) { groupMoney(line.merchant,line.amount,currency);Text(line.direction=="incoming" ? pair.name+" owes you" : "You owe "+pair.name).font(.caption).foregroundStyle(Brand.secondary) } }
                    }
                }
                if ["correct","refund","offset"].contains(draft.kind) {
                    Section("Details") {
                        if draft.kind=="correct" { TextField("Merchant",text:$merchant) }
                        TextField(draft.kind=="correct" ? "Corrected bill total" : draft.kind=="refund" ? "Refund received" : "Amount to offset",text:$amount).keyboardType(.decimalPad)
                        DatePicker(draft.kind=="correct" ? "Purchase date" : draft.kind=="refund" ? "Refund date" : "Offset date",selection:$date,in:...Date.now,displayedComponents:.date)
                        if draft.kind=="correct",let data=store.overview {
                            Picker("Your purchase category",selection:$category) {
                                if draft.expense?.categorySplits != nil { Text("Keep category split").tag("") }
                                ForEach(data.categories) { item in Text(item.name).tag(item.id) }
                            }
                            ForEach($shares) { $share in HStack { Text(share.name);Spacer();TextField("Share",text:$share.amount).keyboardType(.decimalPad).multilineTextAlignment(.trailing).accessibilityLabel("Share for "+share.name) } }
                        }
                    }
                }
                Section("Reason") { TextField("Explain the change",text:$reason,axis:.vertical).lineLimit(2...5).accessibilityIdentifier("group-change-reason") }
                if let error { Section { Notice(message:error) } }
            }.navigationTitle(draft.title).navigationBarTitleDisplayMode(.inline)
                .safeAreaInset(edge:.bottom,spacing:0) {
                    VStack(spacing:10) {
                        Text("Budgets change after everyone approves.").font(.caption).foregroundStyle(Brand.secondary)
                        Button(action:send) { Label("Request review",systemImage:"checklist").frame(maxWidth:.infinity) }
                            .primaryAction().disabled(reason.trimmingCharacters(in:.whitespaces).isEmpty).accessibilityIdentifier("request-shared-review")
                    }.padding(16).background(Brand.canvas)
                }
                .toolbar { ToolbarItem(placement:.cancellationAction) { Button("Cancel") { discarded=true;dismiss() } } }
                .navigationDestination(item:$reviewID) { id in SharedChangeReviewContent(id:id) { dismiss() } }
                .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { dismissGroupKeyboard() } } }
                .task {
                    store.beginEditing(editorID);guard !initialized else { return }
                    if let e=draft.expense { merchant=e.merchant;category=e.categorySplits != nil ? "" : e.categoryId ?? store.overview?.transactions.first(where:{$0.id==e.entryId})?.categoryId ?? store.overview?.categories.first?.id ?? "";if draft.kind=="correct" { amount=NSDecimalNumber(value:e.total).dividing(by:100).stringValue;date=groupDate(e.date) };shares=e.shares.filter{!["cancelled","refunded"].contains($0.state)}.map{GroupPersonDraft(id:$0.id,name:$0.displayName,amount:NSDecimalNumber(value:$0.amount).dividing(by:100).stringValue)} }
                    if let pair=draft.pair { amount=NSDecimalNumber(value:pair.offsettable).dividing(by:100).stringValue;reason="Offset our shared bills." }
                    initialized=true
                }.onDisappear { store.endEditing(editorID) }

                .onChange(of:store.savedCount) { _, _ in finish() }.editorSaveState(closeAfterRecovery:false)
        }
    }
    private var explanation:String {
        switch draft.kind {
        case "offset": "Match the bills you owe each other. No money moves."
        case "correct": "Update the bill, then review the changes."
        case "refund": "Record a merchant refund and review each person’s amount."
        case "reverse_offset": "Restore the amounts this offset cleared."
        default: "Remove an incorrect repayment record. No money is sent."
        }
    }
    private func send() {
        guard let snapshot=store.snapshot else { return }
        do {
            error = nil
            guard reason.count <= 300 else { throw BudgetEngine.failure("Keep the reason within 300 characters.") }
            var body:[String:JSONValue]=["kind":.string(draft.kind),"reason":.string(reason),"expectedRevision":.number(Int64(snapshot.revision)),"confirmReview":.bool(true)]
            if let e=draft.expense { body["expenseId"] = .string(e.id);body["expectedExpenseRevision"] = .number(Int64(e.expenseRevision ?? 0)) }
            if ["correct","refund","offset"].contains(draft.kind) { let value:Int64=try store.requireEngine().run("parseAmount",command:["amount":amount]);guard value > 0 else { throw BudgetEngine.failure("Enter an amount greater than zero.") };if draft.kind=="offset",let pair=draft.pair,value>pair.offsettable { throw BudgetEngine.failure("The offset must fit within both unpaid balances.") };if draft.kind=="refund",let expense=draft.expense,value>expense.total-(expense.refunded ?? 0) { throw BudgetEngine.failure("The refund must fit within the unrefunded bill total.") };body[draft.kind=="correct" ? "total" : "amount"] = .number(value);body["date"] = .string(groupDateKey(date)) }
            if draft.kind=="correct" { guard !merchant.trimmingCharacters(in:.whitespaces).isEmpty else { throw BudgetEngine.failure("Enter the merchant name.") };let values:[Int64]=try shares.map { try store.requireEngine().run("parseAmount",command:["amount":$0.amount]) };let total:Int64=try store.requireEngine().run("parseAmount",command:["amount":amount]);guard values.allSatisfy({$0>0}) && values.reduce(0,+)<=total else { throw BudgetEngine.failure("Each share must be positive and fit within the bill total.") };body["merchant"] = .string(merchant);body["categoryId"] = .string(category);body["shares"] = .array(zip(shares,values).map { .object(["id":.string($0.id),"amount":.number($1)]) }) }
            if let group=draft.group,let pair=draft.pair { body["groupId"] = .string(group.id);body["expectedGroupRevision"] = .number(Int64(group.revision));body["otherMemberId"] = .string(pair.memberId) }
            if let settlement=draft.settlement { body["settlementId"] = .string(settlement.id) }
            if let change=draft.change { body["changeId"] = .string(change.id) }
            submitted=true;Task { _ = await store.sharedChange("/shared-changes",body:body);finish() }
        } catch { self.error=error.localizedDescription }
    }
    private func finish() { guard submitted,store.pendingShared==nil,let change=store.lastGroupResponse?.change else { return };submitted=false;discarded=true;reviewID=change.id }
}

struct SharedChangeReviewView: View {
    @Environment(\.dismiss) private var dismiss
    let id:String
    var body: some View { NavigationStack { SharedChangeReviewContent(id:id) { dismiss() } } }
}
struct SharedChangeReviewContent: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    let id:String
    let done:()->Void
    @State private var change:SharedLifecycleChange?
    @State private var error:String?
    @State private var editorID=UUID()
    @State private var reversing:GroupChangeDraft?
    private var currency:String { change?.currency ?? change?.preview?.currency ?? store.overview?.currency ?? "USD" }
    private func canApprove(_ change:SharedLifecycleChange)->Bool {
        change.state=="pending" && change.canApprove && change.preview?.budgetId==store.snapshot?.id && change.problem==nil
    }
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:24) {
                if let change { reviewBody(change) }
                else if error==nil { ProgressView("Loading review") }
                if let error { Notice(message:error);Button("Try again") { Task { await load() } } }
            }.padding(20).frame(maxWidth:680).frame(maxWidth:.infinity)
        }.background(Brand.canvas).navigationTitle("Review shared change").navigationBarTitleDisplayMode(.inline).navigationBarBackButtonHidden(true)
            .safeAreaInset(edge:.bottom,spacing:0) {
                if let change {
                    Button { if canApprove(change) { decide("approve") } else { done() } } label: {
                        Label(canApprove(change) ? approvalLabel(change) : "Close review",systemImage:canApprove(change) ? "checkmark" : "arrow.right")
                            .frame(maxWidth:.infinity)
                    }.primaryAction().accessibilityIdentifier("shared-review-primary")
                        .padding(16).background(Brand.canvas)
                }
            }
            .toolbar {
                ToolbarItem(placement:.cancellationAction) { Button("Close",action:done) }
                ToolbarItem(placement:.topBarTrailing) {
                    if let change,change.state=="pending" || change.canReverse {
                        Menu {
                            if change.state=="pending" { Button("Decline this request",systemImage:"xmark.circle") { decide("decline") } }
                            if change.canReverse { Button("Request reversal",systemImage:"arrow.uturn.backward") { reversing=GroupChangeDraft(kind:"reverse_offset",change:change) } }
                        } label: { Label("More actions",systemImage:"ellipsis").labelStyle(.iconOnly) }
                    }
                }
            }
            .task { store.beginEditing(editorID);await load();while !Task.isCancelled { try? await Task.sleep(for:.seconds(5));if !Task.isCancelled && scenePhase == .active && !store.busy && store.pendingShared==nil { await load() } } }
            .onDisappear { store.endEditing(editorID) }
            .onChange(of:store.savedCount) { _,_ in if store.pendingShared==nil,store.lastGroupResponse?.change?.id==id { change=store.lastGroupResponse?.change } }
            .sheet(item:$reversing) { SharedChangeComposeView(draft:$0) }
            .editorSaveState(closeAfterRecovery:false)
    }
    @ViewBuilder private func reviewBody(_ change:SharedLifecycleChange)->some View {
        Label(status(change),systemImage:change.state=="applied" ? "checkmark.circle.fill" : "clock")
            .font(.subheadline.weight(.semibold)).foregroundStyle(Brand.sage)
        if let amount=change.amount {
            VStack(alignment:.leading,spacing:8) {
                Text(SharedMoney.format(amount,currency)).font(.largeTitle.weight(.semibold)).monospacedDigit().fixedSize(horizontal:false,vertical:true)
                if let person=change.counterparty { Text("with "+person).font(.subheadline).foregroundStyle(Brand.secondary) }
                else if let merchant=change.merchant { Text(merchant).font(.subheadline).foregroundStyle(Brand.secondary) }
            }
        }
        Text(summary(change)).font(.subheadline).foregroundStyle(Brand.secondary)
        if let lines=change.lines {
            ForEach(Array(lines.enumerated()),id:\.offset) { _,line in
                SharedOffsetMatch(line:line,currency:currency)
            }
        }
        if let before=change.before,let after=change.after {
            VStack(alignment:.leading,spacing:12) {
                groupMoney("Original bill",before.total,currency)
                Text(before.merchant+" · "+readableDate(before.date)).font(.caption).foregroundStyle(Brand.secondary)
                Divider()
                groupMoney("Corrected bill",after.total,currency)
                Text(after.merchant+" · "+readableDate(after.date)).font(.caption).foregroundStyle(Brand.secondary)
            }.padding(18).background(Brand.surface,in:.rect(cornerRadius:18))
        }
        if let refunds=change.refunds {
            VStack(alignment:.leading,spacing:16) {
                Text("Refund shares").font(.headline)
                ForEach(Array(refunds.enumerated()),id:\.offset) { _,part in
                    VStack(alignment:.leading,spacing:5) {
                        groupMoney(part.name,part.amount,currency)
                        Text(part.extra>0 ? SharedMoney.format(part.extra,currency)+" to return" : "Reduces the unpaid share").font(.caption).foregroundStyle(Brand.secondary)
                    }
                }
            }
        }
        if let own=change.preview {
            if ["offset","reverse_offset"].contains(change.kind) {
                DisclosureGroup("See your budget changes") { SharedChangeImpact(own:own,currency:currency).padding(.top,16) }.font(.subheadline).tint(Brand.sage)
            } else { SharedChangeImpact(own:own,currency:currency) }
        }
        DisclosureGroup("Reason for this change") { Text(change.reason).font(.subheadline).frame(maxWidth:.infinity,alignment:.leading).padding(.top,12) }.font(.subheadline).tint(Brand.sage)
        if let problem=change.problem { Notice(message:problem) }
        VStack(spacing:14) {
            ForEach(Array(change.participants.enumerated()),id:\.offset) { _,person in
                HStack {
                    Image(systemName:person.approved ? "checkmark.circle" : "clock")
                    Text(person.isYou ? "You" : person.name)
                    Spacer(minLength:12)
                    Text(change.state=="applied" ? "Reviewed" : person.approved ? "Approved" : "Review needed").foregroundStyle(Brand.secondary)
                }.font(.subheadline)
            }
        }
        if change.state=="pending" && !canApprove(change) && change.problem==nil {
            Text(waiting(change)).font(.caption).foregroundStyle(Brand.secondary)
        }
    }
    private func status(_ change:SharedLifecycleChange)->String {
        if change.state=="applied" { return ["offset":"Offset recorded","correct":"Bill corrected","refund":"Refund recorded","reverse_payment":"Repayment reversed","reverse_offset":"Offset reversed"][change.kind] ?? "Change applied" }
        if change.state=="cancelled" { return "Request cancelled" }
        return canApprove(change) ? "Ready for your review" : "Waiting for review"
    }
    private func approvalLabel(_ change:SharedLifecycleChange)->String {
        ["offset":"Approve offset","correct":"Approve correction","refund":"Approve refund"][change.kind] ?? "Approve reversal"
    }
    private func summary(_ change:SharedLifecycleChange)->String {
        if change.state=="cancelled" { return "This request was cancelled. Budgets were not changed." }
        let applied=change.state=="applied"
        switch change.kind {
        case "offset": return applied ? "The matching amounts were cleared. No bank payment was recorded." : "The matching amounts will be cleared. Bank balances and spending stay the same."
        case "correct": return applied ? "The reviewed correction is recorded." : "Check the updated bill and your budget changes below."
        case "refund": return applied ? "The refund is recorded. Money to return appears as a separate balance." : "Record the merchant refund. Money already repaid will be owed back."
        case "reverse_offset": return applied ? "The original amounts are owed again. No money moved." : "The amounts cleared by this offset will be owed again. No money moves."
        default: return applied ? "The repayment was reversed. Its history is kept." : "Undo the recorded repayment. No money is sent."
        }
    }
    private func waiting(_ change:SharedLifecycleChange)->String {
        if let own=change.preview,own.budgetId != store.snapshot?.id { return "Open "+own.budgetName+" to approve." }
        let people=change.participants.filter{!$0.approved && !$0.isYou}
        return people.count==1 ? "Waiting for "+people[0].name+"’s review." : "Waiting for \(people.count) people to review."
    }
    private func load() async { do { change=try await store.sharedReview(id);error=nil } catch { self.error=error.localizedDescription } }
    private func decide(_ decision:String) {
        guard let change else { return }
        Task { _ = await store.sharedChange("/shared-changes/"+id,body:["decision":.string(decision),"confirmReview":.bool(decision=="approve"),"expectedRevision":.number(Int64(change.preview?.revision ?? 0))]) }
    }
}

private struct SharedOffsetMatch:View {
    let line:SharedOffsetLine
    let currency:String
    @Environment(\.dynamicTypeSize) private var textSize
    var body:some View {
        Group {
            if textSize.isAccessibilitySize {
                VStack(alignment:.leading,spacing:16) { bill("You owe",line.outgoingBill ?? line.second);Image(systemName:"arrow.up.arrow.down").foregroundStyle(Brand.secondary);bill("Owed to you",line.incomingBill ?? line.first) }
            } else {
                HStack(alignment:.center,spacing:12) { bill("You owe",line.outgoingBill ?? line.second);Image(systemName:"arrow.left.arrow.right").font(.caption).foregroundStyle(Brand.secondary);bill("Owed to you",line.incomingBill ?? line.first) }
            }
        }.padding(18).background(Brand.surface,in:.rect(cornerRadius:20))
    }
    private func bill(_ direction:String,_ name:String)->some View {
        VStack(alignment:.leading,spacing:8) { Text(direction).font(.caption).foregroundStyle(Brand.secondary);Text(name).font(.subheadline.weight(.medium));Text(SharedMoney.format(line.amount,currency)).font(.subheadline.weight(.semibold)).monospacedDigit() }.frame(maxWidth:.infinity,alignment:.leading)
    }
}

private struct SharedChangeImpact:View {
    let own:SharedChangePreview
    let currency:String
    var body:some View {
        VStack(alignment:.leading,spacing:16) {
            Text(own.budgetName).font(.subheadline.weight(.medium))
            row("Cash in accounts",own.before.cash,own.after.cash)
            row("Spending this month",own.before.spent,own.after.spent)
            row("Friends owe you",own.before.receivable,own.after.receivable)
            row("You owe",own.before.owed,own.after.owed)
            row("Cash set aside for friends",own.before.reserved,own.after.reserved)
            row("Available to plan",own.before.ready,own.after.ready)
            if let categories=own.categories,!categories.isEmpty {
                Text("Your categories").font(.subheadline.weight(.medium))
                ForEach(categories) { category in row("Left in "+category.name,category.beforeLeft,category.afterLeft) }
            }
        }.padding(18).background(Brand.surface,in:.rect(cornerRadius:18))
    }
    @ViewBuilder private func row(_ label:String,_ before:Int64,_ after:Int64)->some View {
        if before != after { GroupChangeMoneyRow(label:label,before:before,after:after,currency:currency) }
    }
}

private struct GroupChangeMoneyRow:View {
    let label:String;let before:Int64;let after:Int64;let currency:String
    var body:some View {
        ViewThatFits(in:.horizontal) {
            HStack(alignment:.firstTextBaseline) { Text(label).foregroundStyle(Brand.secondary);Spacer(minLength:16);amounts }
            VStack(alignment:.leading,spacing:8) { Text(label).foregroundStyle(Brand.secondary);amounts }
        }.font(.subheadline).accessibilityElement(children:.ignore).accessibilityLabel(label+", before "+SharedMoney.format(before,currency)+", after "+SharedMoney.format(after,currency))
    }
    private var amounts:some View { HStack(spacing:8) { Text(SharedMoney.format(before,currency)).foregroundStyle(Brand.secondary);Image(systemName:"arrow.right").font(.caption);Text(SharedMoney.format(after,currency)).fontWeight(.semibold) }.monospacedDigit() }
}
