import SwiftUI

struct TransactionForm: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var textSize
    var seed = QuickEntry()
    var initialKind = "expense"
    var destination = ""
    var initialCategory = ""
    @State private var kind = "expense"
    @State private var amount = ""
    @State private var payee = ""
    @State private var accountID = ""
    @State private var categoryID = ""
    @State private var toAccountID = ""
    @State private var note = ""
    @State private var date = Date.now
    @State private var cleared = false
    @State private var detailsExpanded = false
    @State private var receiptID: String?
    @State private var upcoming = false
    @State private var repeatRule = "none"
    @State private var scheduleID = ""
    @State private var scheduleDate = ""
    @State private var categorySplits: [ExpenseCategoryAmount] = []
    @State private var people = ExpensePeopleDraft()
    @State private var additions: [StructureDraft] = []
    @State private var error: String?
    @State private var panel: Panel?
    @State private var original: [String:String]?
    @State private var discarded = false
    @State private var saving = false
    @State private var editorID = UUID()
    @State private var draftID = UUID().uuidString
    @FocusState private var focused: Bool
    private enum Panel: String,Identifiable { case categories,people,account,destination,scan;var id:String{rawValue} }
    private var data: Overview? { try? store.structureOverview(additions) }
    private var workingBudget: JSONValue? { store.snapshot.flatMap { try? store.adding(additions,to:$0.budget) } }
    private var willSchedule: Bool { upcoming || groupDateKey(date) > groupDateKey(Date.now) }
    private var command: [String:String] {
        ["kind":kind,"amount":amount,"payee":payee,"accountId":accountID,"categoryId":categoryID,
         "toAccountId":toAccountID,"note":note,"date":groupDateKey(date),"cleared":String(cleared),
         "receiptId":receiptID ?? "","upcoming":String(upcoming),"repeat":repeatRule,"scheduleId":scheduleID,"scheduleDate":scheduleDate,
         "splits":kind == "expense" && categorySplits.count > 1 ? DraftFields.encode(categorySplits) : "",
         "sharePlan":kind == "expense" && willSchedule && !people.people.isEmpty ? DraftFields.encode(people) : ""]
    }
    private var draftFields: [String:String] {
        command.merging(["people":DraftFields.encode(people),"categorySplits":DraftFields.encode(categorySplits),
                         "additions":DraftFields.encode(additions),"draftID":draftID]) { _,new in new }
    }
    private var dirty: Bool { seed.userEntered || original.map { $0 != draftFields } == true }
    private var value: Int64? { try? store.requireEngine().run("parseAmount",command:["amount":amount]) }
    private var sharedValues: [Int64]? { guard let value else { return nil };return try? people.shares(total:value,engine:store.requireEngine()) }
    private var preview: Overview? { try? store.preview(command,additions:additions) }
    private var ready: Bool {
        guard !saving,!discarded,!store.busy,store.pending == nil,store.pendingShared == nil,
              value.map({$0 > 0}) == true,preview != nil else { return false }
        if kind == "expense" && !people.groupId.isEmpty && people.people.isEmpty { return false }
        if kind == "expense" && !people.people.isEmpty { return sharedValues != nil && repeatRule == "none" }
        return true
    }
    private var title: String {
        if willSchedule { return "Upcoming transaction" }
        return ["expense":"Add transaction","income":"Record income","payment":"Record card payment","transfer":"Record transfer"][kind] ?? "Add transaction"
    }
    private var amountLabel: String {
        if willSchedule { return "Amount" }
        return ["expense":"Amount spent","income":"Income received","payment":"Payment amount","transfer":"Amount to transfer"][kind] ?? "Amount"
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment:.leading,spacing:24) {
                    if let data {
                        if receiptID == nil && scheduleID.isEmpty && (kind == "expense" || kind == "income") {
                            Picker("Transaction type",selection:$kind) { Text("Money spent").tag("expense");Text("Money received").tag("income") }.pickerStyle(.segmented)
                        }
                        amountEntry(data)
                        if kind == "expense" || kind == "income" {
                            TextField("Description (optional)",text:$payee,axis:.vertical).lineLimit(1...3).font(.body).focused($focused).accessibilityLabel("Payee")
                        }
                        FinanceRows {
                            if kind == "expense" {
                                Button { open(.categories) } label: {
                                    selectionLabel(categorySplits.count > 1 ? "Categories" : "Category",categorySummary(data),symbol:categorySplits.count > 1 ? "square.grid.2x2" : categorySymbol(data.categories.first{$0.id==categoryID}?.icon ?? "basket"))
                                }.buttonStyle(.plain).accessibilityIdentifier("transaction-category")
                                FinanceDivider()
                                Button { open(.people) } label: { selectionLabel("People",peopleSummary,symbol:"person.2") }
                                    .buttonStyle(.plain).accessibilityIdentifier("transaction-split")
                                FinanceDivider()
                            }
                            Button { open(.account) } label: {
                                selectionLabel(kind == "income" ? "Into account" : "From account",data.accounts.first{$0.id==accountID}?.name ?? "Choose account",symbol:"wallet.bifold")
                            }.buttonStyle(.plain).accessibilityIdentifier("transaction-account")
                        }
                        if kind == "transfer" || kind == "payment" {
                            FinanceRows {
                                Button { open(.destination) } label: { selectionLabel("To account",data.accounts.first{$0.id==toAccountID}?.name ?? "Choose account",symbol:kind == "payment" ? "creditcard" : "building.columns") }.buttonStyle(.plain)
                            }
                        }
                        FinancePanel {
                            DisclosureGroup(willSchedule ? "Date and repeat" : "Date and details",isExpanded:$detailsExpanded) {
                                VStack(alignment:.leading,spacing:16) {
                                    DatePicker(upcoming ? "Due date" : "Date",selection:$date,displayedComponents:.date).font(.subheadline)
                                    if receiptID == nil && scheduleID.isEmpty {
                                        Picker("Repeat",selection:$repeatRule) {
                                            Text("Does not repeat").tag("none");Text("Weekly").tag("weekly");Text("Monthly").tag("monthly");Text("Yearly").tag("yearly")
                                        }.font(.subheadline)
                                    }
                                    if !willSchedule { Toggle("Cleared by the bank",isOn:$cleared).font(.subheadline) }
                                    TextField("Note (optional)",text:$note,axis:.vertical).lineLimit(1...4).focused($focused)
                                }.padding(.top,16)
                            }.font(.subheadline)
                        }
                        if !people.groupName.isEmpty && kind == "expense" {
                            StatusBadge(title:people.groupName,symbol:"person.3",color:Brand.blue)
                        }
                        impact(data)
                        if kind == "expense" && !people.people.isEmpty && repeatRule != "none" {
                            Label("Use a repeating group bill for shared repeats, or choose Does not repeat here.",systemImage:"exclamationmark.circle").font(.subheadline).foregroundStyle(Brand.danger)
                        }
                        if kind == "expense" && !people.groupId.isEmpty && people.people.isEmpty {
                            Text("Choose someone to share this group expense with, or choose No group.").font(.caption).foregroundStyle(Brand.danger)
                        }
                        if let error { Label(error,systemImage:"exclamationmark.circle").font(.subheadline).foregroundStyle(Brand.danger) }
                    }
                }.padding(24).frame(maxWidth:700).frame(maxWidth:.infinity)
            }.background(Brand.canvas).scrollDismissesKeyboard(.interactively)
                .disabled(store.busy || store.hasPendingSave)
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement:.cancellationAction) {
                        Button("Cancel") { focused=false;if !store.hasPendingSave { discarded=true };dismiss() }.disabled(store.busy).accessibilityIdentifier("transaction-cancel")
                    }
                    ToolbarItem(placement:.confirmationAction) {
                        Button(action:save) {
                            if saving || store.busy { ProgressView().tint(.white) }
                            else { Text("Save").foregroundStyle(ready ? Color.white : Brand.secondary) }
                        }.buttonStyle(.glassProminent).tint(Brand.action).disabled(!ready).accessibilityLabel(willSchedule ? "Save upcoming transaction" : "Save transaction")
                    }
                    ToolbarItemGroup(placement:.keyboard) { Spacer();Button("Done") { focused=false } }
                }
                .sheet(item:$panel) { item in
                    if let data,let base=workingBudget {
                        switch item {
                        case .categories:
                            ExpenseCategoryPicker(base:base,scopeID:draftID,category:categoryID,splits:categorySplits,total:amount) { category,splits,total,created in
                                categoryID=category;categorySplits=splits;amount=total;additions.append(contentsOf:created)
                            }
                        case .people:
                            ExpensePeoplePicker(selection:people,total:amount,currency:data.currency,scopeID:draftID,receiptAvailable:ReceiptVault.read(id:receiptID,user:store.user?.id) != nil) { choice,total in people=choice;amount=total }
                        case .account:
                            AccountPickerSheet(title:kind == "income" ? "Into account" : "From account",data:data,accounts:eligibleAccounts(data),selection:$accountID,creationBase:base,
                                               allowedAccountTypes:kind == "expense" ? ["checking","savings","credit"] : kind == "transfer" ? ["checking","savings","investment"] : ["checking","savings"],onCreate:{additions.append($0)})
                        case .destination:
                            AccountPickerSheet(title:"To account",data:data,accounts:data.accounts.filter{$0.id != accountID && (kind == "payment" ? $0.type == "credit" : $0.type != "credit")},selection:$toAccountID,creationBase:base,allowedAccountTypes:kind == "payment" ? ["credit"] : ["checking","savings","investment"],onCreate:{additions.append($0)})
                        case .scan:
                            ReceiptScanView(openDetails:applyScan,currentDraft:QuickEntry(amount:amount,payee:payee,categoryID:categoryID,accountID:accountID,date:groupDateKey(date)))
                        }
                    }
                }
                .task {
                    store.beginEditing(editorID)
                    guard original == nil else { return }
                    initialize();original=draftFields
                }
                .onDisappear { store.endEditing(editorID) }
                .onChange(of:kind) { _,_ in if let data,!eligibleAccounts(data).contains(where:{$0.id==accountID}) { accountID=eligibleAccounts(data).first?.id ?? "" } }
                .onChange(of:accountID) { _,id in if toAccountID == id { toAccountID="" } }
                .onChange(of:draftFields) { _,_ in error=nil }
                .interactiveDismissDisabled(dirty || store.busy)
                .editorSaveState()

        }
    }
    private var peopleSummary: String {
        if people.people.isEmpty { return "Just me" }
        if people.people.count <= 2 { return (["You"]+people.people.map(\.name)).joined(separator:", ") }
        return "\(people.people.count+1) people"
    }
    private func categorySummary(_ data:Overview)->String {
        if categorySplits.isEmpty { return data.categories.first{$0.id==categoryID}?.name ?? "Choose category" }
        if categorySplits.count <= 2 { return categorySplits.map{part in data.categories.first{$0.id==part.categoryId}?.name ?? "Category"}.joined(separator:", ") }
        return "\(categorySplits.count) categories"
    }
    private func selectionLabel(_ title:String,_ value:String,symbol:String)->some View {
        HStack(spacing:12) {
            Image(systemName:symbol).font(.body).foregroundStyle(Brand.sage).frame(width:28,height:28).background(Brand.sage.opacity(0.10),in:.rect(cornerRadius:9))
            if textSize.isAccessibilitySize {
                VStack(alignment:.leading,spacing:5) { Text(title).foregroundStyle(Brand.secondary);Text(value).foregroundStyle(Brand.ink) }.frame(maxWidth:.infinity,alignment:.leading)
            } else {
                Text(title).foregroundStyle(Brand.secondary);Spacer(minLength:12);Text(value).foregroundStyle(Brand.ink).multilineTextAlignment(.trailing).fixedSize(horizontal:false,vertical:true)
            }
            Image(systemName:"chevron.right").font(.caption2).foregroundStyle(Brand.secondary)
        }.font(.subheadline).padding(20).frame(minHeight:64).contentShape(Rectangle())
    }
    private func amountEntry(_ data:Overview)->some View {
        VStack(alignment:.leading,spacing:12) {
            HStack {
                Label(amountLabel,systemImage:kind == "income" ? "arrow.down.left" : kind == "transfer" ? "arrow.left.arrow.right" : kind == "payment" ? "creditcard" : "arrow.up.right").font(.subheadline).foregroundStyle(Brand.secondary)
                Spacer()
                if kind == "expense" && scheduleID.isEmpty {
                    Button("Scan bill",systemImage:"doc.text.viewfinder") { open(.scan) }.font(.subheadline).buttonStyle(.glass).accessibilityIdentifier("transaction-scan")
                }
            }
            HStack(alignment:.firstTextBaseline,spacing:8) {
                Text(currencyMark(data.currency)).font(.title).foregroundStyle(Brand.secondary)
                TextField("0",text:$amount).appFont(42,weight:.medium).monospacedDigit().keyboardType(.decimalPad).focused($focused).accessibilityLabel("Amount")
            }
        }
    }
    @ViewBuilder private func impact(_ data:Overview)->some View {
        if let preview,let value,value>0 {
            FinancePanel {
                Text("After saving").font(.subheadline.weight(.medium))
                if willSchedule { Text("Balances and spending stay the same until you record payment.").font(.subheadline).foregroundStyle(Brand.secondary) }
                else if kind == "expense",!people.people.isEmpty,let amounts=sharedValues {
                    LabeledContent("Your spending",value:data.money(value-amounts.reduce(0,+))).font(.subheadline)
                    LabeledContent("Friends owe you",value:data.money(amounts.reduce(0,+))).font(.subheadline)
                    if let prepared=try? store.prepareSharedPurchase(command,additions:additions),
                       let shared:SharedBudgetPreview=try? store.requireEngine().run("sharedPreview",budget:prepared.budget,command:["kind":"split","entryId":prepared.transaction.id,"amount":String(amounts.reduce(0,+))]) {
                        LabeledContent("Available to plan",value:data.money(shared.ready)).font(.subheadline)
                    }
                    Text("Only your share counts as spending. Money owed to you is not spendable cash.").font(.caption).foregroundStyle(Brand.secondary)
                } else {
                    if kind == "expense" {
                        let ids=categorySplits.isEmpty ? [categoryID] : categorySplits.map(\.categoryId)
                        ForEach(preview.categories.filter{ids.contains($0.id)}) { category in
                            LabeledContent(category.name+" left",value:preview.money(category.available)).font(.subheadline).foregroundStyle(category.available<0 ? Brand.danger : Brand.ink)
                        }
                    } else { LabeledContent("Available to plan",value:preview.money(preview.ready)).font(.subheadline) }
                    if kind == "transfer" || kind == "payment" { Text("This records money you moved. Spending does not change.").font(.caption).foregroundStyle(Brand.secondary) }
                }
            }
        } else if !amount.isEmpty {
            Text("Review the amount, categories and accounts before saving.").font(.caption).foregroundStyle(Brand.danger)
        }
    }
    private func open(_ next:Panel) { focused=false;panel=next }
    private func eligibleAccounts(_ data:Overview)->[BudgetAccount] {
        data.accounts.filter{kind == "expense" ? $0.type != "investment" : kind == "transfer" ? $0.type != "credit" : $0.isCash}
    }
    private func initialize() {
        kind=initialKind;amount=seed.amount;payee=seed.payee;note=seed.note;categoryID=seed.categoryID.isEmpty ? initialCategory : seed.categoryID
        categorySplits=seed.categorySplits;people=seed.people;receiptID=seed.receiptID;upcoming=seed.upcoming;scheduleID=seed.scheduleID;scheduleDate=seed.scheduleDate
        additions=seed.additions;toAccountID=destination
        if let day=seed.date { date=groupDate(day) }
        if let data {
            let accounts=eligibleAccounts(data)
            accountID=accounts.first{$0.id==seed.accountID}?.id ?? accounts.first?.id ?? ""
            if kind == "expense" && categoryID.isEmpty { categoryID=data.transactions.first(where:{$0.kind=="expense" && $0.categoryId != nil})?.categoryId ?? "" }
        }
    }
    private func applyScan(_ scanned:QuickEntry) {
        amount=scanned.amount;if !scanned.payee.isEmpty { payee=scanned.payee }
        if categoryID.isEmpty { categoryID=scanned.categoryID };if accountID.isEmpty { accountID=scanned.accountID }
        if let day=scanned.date { date=groupDate(day) }
        receiptID=scanned.receiptID;upcoming=scanned.upcoming;repeatRule="none";kind="expense";panel=nil
    }
    private func restoreDraft(_ fields:[String:String]) {
        kind=fields["kind"] ?? kind;amount=fields["amount"] ?? "";payee=fields["payee"] ?? "";note=fields["note"] ?? ""
        categoryID=fields["categoryId"] ?? "";accountID=fields["accountId"] ?? "";toAccountID=fields["toAccountId"] ?? ""
        date=groupDate(fields["date"] ?? groupDateKey(date));cleared=fields["cleared"] == "true";upcoming=fields["upcoming"] == "true"
        receiptID=fields["receiptId"].flatMap{$0.isEmpty ? nil : $0};repeatRule=fields["repeat"] ?? "none";scheduleID=fields["scheduleId"] ?? "";scheduleDate=fields["scheduleDate"] ?? ""
        categorySplits=DraftFields.decode([ExpenseCategoryAmount].self,fields["categorySplits"]) ?? []
        people=DraftFields.decode(ExpensePeopleDraft.self,fields["people"]) ?? ExpensePeopleDraft()
        additions=DraftFields.decode([StructureDraft].self,fields["additions"]) ?? [];draftID=fields["draftID"] ?? draftID
    }
    private func save() {
        guard ready else { return };focused=false;saving=true
        Task {
            var success=false
            if kind == "expense" && !people.people.isEmpty && !willSchedule {
                do {
                    guard !store.sample else { throw BudgetEngine.failure("Sign in to save shared expenses. This preview uses fictional data.") }
                    guard store.atomicPurchasesAvailable,!store.sharingVerificationRequired else { throw BudgetEngine.failure("Verify your email and connect to sharing before saving this split.") }
                    if categorySplits.count>1 && !store.categorySharingAvailable { throw BudgetEngine.failure("Update the SpentOn service before combining categories and people.") }
                    guard let snapshot=store.snapshot,let value else { throw BudgetEngine.failure("Open a budget and enter an amount.") }
                    let prepared=try store.prepareSharedPurchase(command,additions:additions)
                    var body:[String:JSONValue]=["budgetId":.string(snapshot.id),"expectedRevision":.number(Int64(snapshot.revision)),"entryId":.string(prepared.transaction.id),"purchase":prepared.payload,
                                                "shares":.array(try people.request(total:value,engine:store.requireEngine()))]
                    if !people.groupId.isEmpty { body["groupId"] = .string(people.groupId);body["expectedGroupRevision"] = .number(Int64(people.groupRevision ?? 0)) }
                    if people.includeReceipt,let bill=ReceiptVault.read(id:receiptID,user:store.user?.id) { body["receipt"] = bill.json }
                    success=await store.sharedChange("/shared-expenses",body:body)
                    if !success { error=store.message }
                } catch { self.error=error.localizedDescription }
            } else { success=await store.change(command,additions:additions);if !success { error=store.message } }
            saving=false
            if success { discarded=true;dismiss() }
        }
    }
}
