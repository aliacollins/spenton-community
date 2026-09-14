import SwiftUI

struct GroupCreateView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let created:(String)->Void
    @State private var name=""
    @State private var kind="event"
    @State private var yourName=""
    @State private var people:[GroupPersonDraft]=[]
    @State private var directory:[PrivatePerson]=[]
    @State private var query=""
    @State private var details=false
    @State private var loaded=false
    @State private var discarded=false
    @State private var submitted=false
    @State private var editorID=UUID()
    @State private var error:String?
    private var ready:Bool{!name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && !yourName.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && !people.isEmpty && !store.busy && !store.hasPendingSave}
    private var fields:[String:String]{["name":name,"kind":kind,"yourName":yourName,"people":DraftFields.encode(people)]}
    private var rows:[PrivatePerson]{
        var result=directory
        for person in people where !result.contains(where:{$0.id==person.id}){result.append(.init(id:person.id,name:person.name,email:person.email))}
        return result.filter{query.isEmpty || ($0.name+$0.email).localizedCaseInsensitiveContains(query.trimmingCharacters(in:.whitespacesAndNewlines))}
    }
    var body:some View{
        NavigationStack{
            ScrollView{
                VStack(alignment:.leading,spacing:24){
                    TextField("Group name",text:$name).font(.title2).padding(20).background(Brand.surface,in:.rect(cornerRadius:24)).accessibilityLabel("Group name")
                    Text("Choose people").font(.headline)
                    Text("You’re included. People can belong to more than one group.").font(.subheadline).foregroundStyle(Brand.secondary)
                    HStack(spacing:10){Image(systemName:"magnifyingglass").foregroundStyle(Brand.secondary);TextField("Find or add a person",text:$query).font(.subheadline)}.padding(16).background(Brand.surface,in:.rect(cornerRadius:16))
                    if !query.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && !rows.contains(where:{$0.name.caseInsensitiveCompare(query.trimmingCharacters(in:.whitespacesAndNewlines)) == .orderedSame}){
                        Button("Add “\(query.trimmingCharacters(in:.whitespacesAndNewlines))”",systemImage:"person.badge.plus"){
                            let value=query.trimmingCharacters(in:.whitespacesAndNewlines)
                            guard value.count<=100,people.count<19 else{error="Choose up to 19 other people with names up to 100 characters.";return}
                            let email=value.contains("@") ? value.lowercased() : ""
                            people.append(GroupPersonDraft(name:email.isEmpty ? value : value.components(separatedBy:"@").first ?? value,email:email));query=""
                        }.font(.subheadline).frame(minHeight:44)
                    }
                    FinanceRows{
                        ForEach(rows){person in
                            let chosen=people.contains{$0.id==person.id}
                            Button{
                                if chosen{people.removeAll{$0.id==person.id}}
                                else if people.count<19{people.append(GroupPersonDraft(id:person.id,name:person.name,email:person.email,personKey:person.id))}
                            }label:{
                                HStack(spacing:12){PersonAvatar(email:person.id,name:person.name,size:34);Text(person.name).foregroundStyle(Brand.ink);Spacer();Image(systemName:chosen ? "checkmark.circle.fill" : "circle").foregroundStyle(chosen ? Brand.sage : Brand.secondary)}.font(.subheadline).padding(20).frame(minHeight:64).contentShape(Rectangle())
                            }.buttonStyle(.plain).accessibilityValue(chosen ? "Selected" : "Not selected")
                            if person.id != rows.last?.id{FinanceDivider()}
                        }
                    }
                    FinancePanel{
                        DisclosureGroup("Details",isExpanded:$details){
                            VStack(alignment:.leading,spacing:16){
                                TextField("Your name in this group",text:$yourName).accessibilityLabel("Your name in this group")
                                Picker("Group type",selection:$kind){Text("Event").tag("event");Text("Trip").tag("trip");Text("Household").tag("household")}
                                if let data=store.overview{Text("Uses \(data.currency) and your \(data.name) budget.").font(.caption).foregroundStyle(Brand.secondary)}
                            }.padding(.top,16)
                        }.font(.subheadline)
                        Text("You appear as \(yourName). Personal budgets stay private.").font(.caption).foregroundStyle(Brand.secondary)
                    }
                    if let error{Notice(message:error)}
                }.padding(24).frame(maxWidth:700).frame(maxWidth:.infinity)
            }.background(Brand.canvas).navigationTitle("Create group").navigationBarTitleDisplayMode(.inline)
                .toolbar{
                    ToolbarItem(placement:.cancellationAction){Button("Cancel"){discarded=true;dismiss()}.disabled(store.busy)}
                    ToolbarItem(placement:.confirmationAction){Button(action:send){Text("Create").foregroundStyle(ready ? Color.white : Brand.secondary)}.buttonStyle(.glassProminent).tint(Brand.action).disabled(!ready)}
                }
                .task{
                    store.beginEditing(editorID)
                    guard !loaded else{return}
                    yourName=store.user?.email.components(separatedBy:"@").first ?? "You"
                    directory=(try? await store.peopleDirectory())?.people ?? [];loaded=true
                }
                .onDisappear{store.endEditing(editorID)}

                .editorSaveState(closeAfterRecovery:false).interactiveDismissDisabled(!name.isEmpty || store.busy)
                .onChange(of:store.savedCount){_,_ in finish()}
        }
    }
    private func send(){
        guard ready,let snapshot=store.snapshot else{return}
        guard !store.sample else{error="Sign in to save a group. This preview uses fictional data.";return}
        let cleanName:(String,Int)->Bool={value,limit in !value.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && value.count<=limit && value.range(of:#"[<>\u0000-\u001f\u007f]"#,options:.regularExpression)==nil}
        guard cleanName(name,80),cleanName(yourName,100),people.allSatisfy({cleanName($0.name,100) && ($0.email.isEmpty || ($0.email.range(of:#"^\S+@[^\s@]+\.[^\s@]+$"#,options:.regularExpression) != nil && $0.email.lowercased() != store.user?.email.lowercased()))}) else{error="Check the group name and each person’s name or email.";return}
        submitted=true
        let members=people.map{person in JSONValue.object(["name":.string(person.name),"email":.string(person.email),"personKey":.string(person.personKey ?? person.id)])}
        Task{
            let saved=await store.sharedChange("/expense-groups",body:["name":.string(name),"kind":.string(kind),"yourName":.string(yourName),"members":.array(members),"budgetId":.string(snapshot.id),"expectedRevision":.number(Int64(snapshot.revision))])
            if saved{finish()}else{error=store.message;if store.pendingShared == nil{submitted=false}}
        }
    }
    private func finish(){guard submitted,store.pendingShared == nil,let group=store.lastGroupResponse?.group else{return};submitted=false;discarded=true;created(group.id);dismiss()}
}

struct GroupJoinView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let group: ExpenseGroupSummary
    let joined: (String) -> Void
    @State private var confirmed = false
    @State private var submitted = false
    var body: some View {
        NavigationStack {
            BrandedForm {
                Section { Text(group.name).font(.title2.weight(.semibold)); Text("\(group.memberCount) people · \(group.currency)").foregroundStyle(Brand.secondary) }
                Section { Text("Members can see the group’s bills, shares and repayment records. Your personal budget and account balances stay private."); Text("Joining does not accept or pay any bill.").foregroundStyle(Brand.secondary) }
                if let data = store.overview {
                    Section { Text("Your budget: " + data.name); if data.currency != group.currency { Notice(message:"Open a " + group.currency + " budget to join this group.") } else { Toggle("I want to join this group", isOn:$confirmed) } }
                }
                Section { Button("Join group", systemImage:"person.3") { send() }.primaryAction().disabled(!confirmed || store.overview?.currency != group.currency) }
            }.navigationTitle("Group invitation").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement:.cancellationAction) { Button("Cancel") { dismiss() } } }
                .onChange(of:store.savedCount) { _, _ in finish() }.editorSaveState(closeAfterRecovery:false)
        }
    }
    private func send() { guard let snapshot=store.snapshot,let memberID=group.invitationId else { return };submitted=true;Task { _ = await store.sharedChange("/group-invitations/join",body:["memberId":.string(memberID),"budgetId":.string(snapshot.id),"expectedRevision":.number(Int64(snapshot.revision)),"confirmJoin":.bool(confirmed)]);finish() } }
    private func finish() { guard submitted,store.pendingShared==nil,let group=store.lastGroupResponse?.group else { return };submitted=false;joined(group.id);dismiss() }
}

struct GroupAddMemberView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let group: ExpenseGroupDetail
    @State private var name=""
    @State private var email=""
    @State private var submitted=false
    @State private var discarded=false
    @State private var editorID=UUID()
    var body: some View {
        NavigationStack {
            BrandedForm {
                Section { TextField("Name",text:$name).textInputAutocapitalization(.words);TextField("Email (optional)",text:$email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled() }
                Section { Text("This person can review existing group bills after joining. Existing shares stay unchanged.").foregroundStyle(Brand.secondary) }
                Section { Button("Add person",systemImage:"person.badge.plus") { submitted=true;Task { _ = await store.sharedChange("/expense-groups/"+group.id,body:["actionType":.string("add-member"),"expectedGroupRevision":.number(Int64(group.revision)),"member":.object(["name":.string(name),"email":.string(email)])]);finish() } }.primaryAction().disabled(name.trimmingCharacters(in:.whitespaces).isEmpty) }
            }.navigationTitle("Add group member").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement:.cancellationAction) { Button("Cancel") { discarded=true;dismiss() } } }
                .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { dismissGroupKeyboard() } } }
                .task { store.beginEditing(editorID) }.onDisappear { store.endEditing(editorID) }

                .onChange(of:store.savedCount) { _, _ in finish() }.editorSaveState(closeAfterRecovery:false)
        }
    }
    private func finish() { guard submitted,store.pendingShared==nil,store.lastGroupResponse?.group?.id==group.id else { return };submitted=false;discarded=true;dismiss() }
}

struct GroupPurchaseView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let group: ExpenseGroupDetail
    @State private var amount=""
    @State private var merchant=""
    @State private var account=""
    @State private var category=""
    @State private var date=Date.now
    @State private var equal=true
    @State private var people:[GroupPersonDraft]=[]
    @State private var initialized=false
    @State private var originalFields:[String:String]?
    @State private var submitted=false
    @State private var discarded=false
    @State private var editorID=UUID()
    private var chosen:[GroupPersonDraft] { people.filter(\.included) }
    private var fields:[String:String] { ["amount":amount,"merchant":merchant,"account":account,"category":category,"date":groupDateKey(date),"equal":String(equal),"people":DraftFields.encode(people)] }
    private var purchase:SharedPurchaseDraft? {
        guard let snapshot=store.snapshot,!merchant.trimmingCharacters(in:.whitespaces).isEmpty else { return nil }
        do { let engine=try store.requireEngine(),next:JSONValue=try engine.run("change",budget:snapshot.budget,command:["kind":"expense","amount":amount,"payee":merchant,"accountId":account,"categoryId":category,"date":groupDateKey(date),"cleared":"false"]);let data:Overview=try engine.run("overview",budget:next);return try SharedPurchaseDraft(original:snapshot.budget,budget:next,overview:data) } catch { return nil }
    }
    private var amounts:[Int64]? { guard let purchase else { return nil };if equal { return chosen.map { _ in purchase.transaction.amount / Int64(chosen.count+1) } };return try? chosen.map { try store.requireEngine().run("parseAmount",command:["amount":$0.amount],as:Int64.self) } }
    private var preview:SharedBudgetPreview? { guard let purchase,let amounts,amounts.allSatisfy({$0>0}),amounts.reduce(0,+)<=purchase.transaction.amount else { return nil };return try? store.requireEngine().run("sharedPreview",budget:purchase.budget,command:["kind":"split","entryId":purchase.transaction.id,"amount":String(amounts.reduce(0,+))]) }
    var body: some View {
        NavigationStack {
            BrandedForm {
                Section("Bill you paid") {
                    TextField("Bill amount",text:$amount).keyboardType(.decimalPad).font(.title2.weight(.semibold))
                    TextField("What was it for?",text:$merchant).textInputAutocapitalization(.sentences)
                    if let data=store.overview {
                        Picker("Paid from",selection:$account) { ForEach(data.accounts.filter{$0.type != "investment"}) { account in Text(account.name).tag(account.id) } }
                        Picker("Your category",selection:$category) { ForEach(data.categories) { category in Text(category.name).tag(category.id) } }
                    }
                    DatePicker("Purchase date",selection:$date,in:...Date.now,displayedComponents:.date)
                }
                Section("People sharing") {
                    Toggle("Split equally, including me",isOn:$equal)
                    ForEach($people) { $person in
                        VStack(alignment:.leading,spacing:10) {
                            Toggle(person.name,isOn:$person.included)
                            if person.included {
                                if equal,let purchase { Text(SharedMoney.format(purchase.transaction.amount/Int64(chosen.count+1),group.currency)).font(.subheadline).foregroundStyle(Brand.secondary) }
                                else if !equal { TextField("Their share",text:$person.amount).keyboardType(.decimalPad).accessibilityLabel("Share for "+person.name) }
                            }
                        }
                    }
                }
                if let preview,let amounts {
                    Section("Your budget after saving") {
                        groupMoney("Your spending",preview.personalSpending,group.currency)
                        groupMoney("Friends owe you",amounts.reduce(0,+),group.currency)
                        groupMoney("Left in this category",preview.categoryLeft,group.currency)
                        groupMoney("Available to plan",preview.ready,group.currency)
                        Text("The full payment is recorded in your account. Each person reviews their share before it enters their budget. Any rounding remainder stays in your share.").font(.caption).foregroundStyle(Brand.secondary)
                    }
                }
                Section { Button("Save purchase and split",systemImage:"person.2") { send() }.primaryAction().disabled(preview==nil || chosen.isEmpty) }
            }.navigationTitle("Add group bill").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement:.cancellationAction) { Button("Cancel") { discarded=true;dismiss() } } }
                .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { dismissGroupKeyboard() } } }
                .task { store.beginEditing(editorID);guard !initialized else { return };account=store.overview?.accounts.first(where:{$0.isCash})?.id ?? "";category=store.overview?.categories.first(where:{$0.icon==(group.kind=="trip" ? "plane" : group.kind=="household" ? "basket" : "coffee")})?.id ?? store.overview?.categories.first?.id ?? "";people=group.members.filter{!$0.isYou && $0.state != "removed"}.map{GroupPersonDraft(id:$0.id,name:$0.name,email:$0.email ?? "")};initialized=true;originalFields=fields }
                .onDisappear { store.endEditing(editorID) }

                .onChange(of:store.savedCount) { _, _ in finish() }.editorSaveState(closeAfterRecovery:false)
        }
    }
    private func send() { guard let snapshot=store.snapshot,let purchase,let amounts else { return };submitted=true;let shares=zip(chosen,amounts).map{JSONValue.object(["memberId":.string($0.id),"name":.string($0.name),"amount":.number($1)])};Task { _ = await store.sharedChange("/shared-expenses",body:["groupId":.string(group.id),"expectedGroupRevision":.number(Int64(group.revision)),"budgetId":.string(snapshot.id),"expectedRevision":.number(Int64(snapshot.revision)),"entryId":.string(purchase.transaction.id),"purchase":purchase.payload,"shares":.array(shares)]);finish() } }
    private func finish() { guard submitted,store.pendingShared==nil,store.lastSharedResponse?.expense.groupId==group.id else { return };submitted=false;discarded=true;dismiss() }
}
