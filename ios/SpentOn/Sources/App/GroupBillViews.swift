import SwiftUI

struct SharedEntryField:View {
    let title:String
    @Binding var text:String
    var decimal=true
    var focusKey:String?=nil
    var activeField:Binding<String?>?=nil
    @State private var selection:TextSelection?
    @FocusState private var focused:Bool
    var body:some View {
        TextField(title,text:$text,selection:$selection).keyboardType(decimal ? .decimalPad : .default).focused($focused)
            .onChange(of:focused){_,active in if active { if let focusKey,let activeField { activeField.wrappedValue=focusKey };selection=TextSelection(range:text.startIndex..<text.endIndex) }}
            .onChange(of:activeField?.wrappedValue,initial:true){_,value in if let focusKey { focused=value==focusKey }}
    }
}
private enum GroupBillPanel:String,Identifiable { case payers,split,repeatBill;var id:String{rawValue} }
private struct GroupBillPersonDraft:Identifiable,Codable {
    let id:String;let name:String;let isYou:Bool;let joined:Bool
    var included=true;var value="1";var paid="0"
}
struct GroupBillComposeView:View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let group:ExpenseGroupDetail
    var series:GroupBillSeries?=nil
    var recurring=false
    @State private var amount=""
    @State private var merchant=""
    @State private var date=Date.now
    @State private var method=SharedSplitMethod.equal
    @State private var multiple=false
    @State private var people:[GroupBillPersonDraft]=[]
    @State private var account=""
    @State private var category=""
    @State private var repeats=false
    @State private var interval="month"
    @State private var every=1
    @State private var hasEnd=false
    @State private var endDate=Date.now
    @State private var editorID=UUID()
    @State private var initialized=false
    @State private var discarded=false
    @State private var submitted=false
    @State private var error:String?
    @State private var reviewID:String?
    @State private var panel:GroupBillPanel?
    @State private var panelBackup:[String:String]?
    @State private var activeField:String?
    @State private var scrollField:String?
    @State private var groupNeedsReview=false
    private var groupContext:String { group.members.map{$0.id+":"+$0.state}.sorted().joined(separator:"|") }
    private var key:String { series.map{"group-series-"+$0.id} ?? (recurring ? "group-recurring-" : "group-bill-")+group.id }
    private var fields:[String:String] { ["groupContext":groupContext,"groupReviewPending":String(groupNeedsReview),"amount":amount,"merchant":merchant,"date":groupDateKey(date),"method":method.rawValue,"multiple":String(multiple),"people":DraftFields.encode(people),"account":account,"category":category,"repeats":String(repeats),"interval":interval,"every":String(every),"hasEnd":String(hasEnd),"endDate":groupDateKey(endDate)] }
    private func input() throws -> GroupBillDefinition {
        let total:Int64=try store.requireEngine().run("parseAmount",command:["amount":amount])
        let payers:[GroupBillPaymentInput]
        if multiple {
            payers=try people.filter{$0.joined}.compactMap { person in
                let paid:Int64=try store.requireEngine().run("parseAmount",command:["amount":person.paid.isEmpty ? "0" : person.paid])
                return paid>0 ? GroupBillPaymentInput(memberId:person.id,amount:paid) : nil
            }
        } else { payers=[GroupBillPaymentInput(memberId:group.memberId,amount:total)] }
        return GroupBillDefinition(total:total,method:method.rawValue,people:people.filter(\.included).map{GroupBillCostInput(memberId:$0.id,value:$0.value)},payers:payers)
    }
    private var plan:GroupComputedPlan? { guard let input=try? input() else{return nil};return try? store.requireEngine().run("groupBillPlan",command:["plan":DraftFields.encode(input)]) }
    private var mePays:Bool { plan?.payers.contains{$0.memberId==group.memberId}==true }
    private var preview:GroupBillClientPreview? {
        guard !repeats,let snapshot=store.snapshot,let input=try? input() else{return nil}
        return try? store.requireEngine().run("groupBillPreview",budget:snapshot.budget,command:["plan":DraftFields.encode(input),"memberId":group.memberId,"accountId":account,"categoryId":category,"date":groupDateKey(date),"merchant":merchant])
    }
    private var validation:String? {
        guard !amount.isEmpty else{return nil}
        do { let _:GroupComputedPlan=try store.requireEngine().run("groupBillPlan",command:["plan":DraftFields.encode(try input())]);return nil }catch{return error.localizedDescription}
    }
    private var actionTitle:String { repeats ? (series==nil ? "Save recurring bill" : "Save future bills") : multiple ? (mePays ? "Confirm my payment" : "Request confirmations") : "Save purchase and split" }
    var body:some View {
        let forecast=preview
        return NavigationStack {
            BrandedForm {
                if groupNeedsReview { Section { Text("The group changed. Review the people in this split.").font(.subheadline);Button("Review people"){openPanel(.split)} } }
                Section {
                    VStack(alignment:.leading,spacing:12) {
                        SharedEntryField(title:"What was it for?",text:$merchant,decimal:false,focusKey:"merchant",activeField:$activeField).font(.title3.weight(.medium)).frame(minHeight:44).submitLabel(.next).onSubmit{activeField="amount"}
                        HStack(alignment:.firstTextBaseline,spacing:12) {
                            Text(group.currency).font(.subheadline.weight(.medium)).foregroundStyle(Brand.secondary)
                            SharedEntryField(title:"Bill amount",text:$amount,focusKey:"amount",activeField:$activeField).font(.largeTitle.weight(.semibold)).monospacedDigit().frame(minHeight:48)
                        }
                    }.padding(.vertical,4)
                } header:{Text(group.name).textCase(nil)}
                Section {
                    settingRow("Paid by",value:payerNames,symbol:"person.crop.circle",panel:.payers,identifier:"group-edit-payers")
                    settingRow("Split",value:splitSummary,symbol:method.symbol,panel:.split,identifier:"group-edit-split")
                }
                if !repeats && mePays,let data=store.overview {
                    Section("Your budget") {
                        if let preview=forecast { LabeledContent { Text(SharedMoney.format(preview.personalSpending,group.currency)).font(.title3.weight(.semibold)).monospacedDigit() } label:{VStack(alignment:.leading,spacing:4){Text("Your share");if multiple{Text("You paid "+SharedMoney.format(preview.paid,group.currency)).font(.caption).foregroundStyle(Brand.secondary)}}} }
                        Picker("Paid from",selection:$account) { ForEach(data.accounts.filter{$0.type != "investment"}) { Text($0.name).tag($0.id) } }
                        Picker("Your category",selection:$category) { ForEach(data.categories) { Text($0.name).tag($0.id) } }
                        if let preview=forecast {
                            DisclosureGroup("See budget changes") {
                                groupMoney("You paid",preview.paid,group.currency)
                                groupMoney("Left in your category",preview.categoryLeft,group.currency)
                                groupMoney("Available to plan",preview.ready,group.currency)
                            }.font(.subheadline).tint(Brand.sage)
                        }
                    }
                }
                Section {
                    ViewThatFits(in:.horizontal) {
                        HStack(spacing:16){dateControl;Spacer(minLength:8);repeatControl}
                        VStack(alignment:.leading,spacing:16){dateControl;repeatControl}
                    }
                    if repeats { Text("Review each occurrence when paid. The schedule does not change your budget.").font(.caption).foregroundStyle(Brand.secondary) }
                }
                if let message=error ?? validation { Section { Notice(message:message) } }
                        }.navigationTitle(repeats ? "Recurring group bill" : "Add a group bill").navigationBarTitleDisplayMode(.inline)
                .safeAreaInset(edge:.bottom,spacing:0) {
                    Button(action:send) { Label(actionTitle,systemImage:repeats ? "repeat" : "checkmark").frame(maxWidth:.infinity).fixedSize(horizontal:false,vertical:true) }
                        .primaryAction().disabled(plan==nil || merchant.trimmingCharacters(in:.whitespaces).isEmpty || (!repeats && mePays && forecast==nil) || groupNeedsReview)
                        .accessibilityIdentifier("save-group-bill").padding(16).background(Brand.canvas)
                }
                .toolbar { ToolbarItem(placement:.cancellationAction) { Button("Cancel") { discarded=true;dismiss() } };ToolbarItemGroup(placement:.keyboard) { Spacer();Button("Done") { dismissGroupKeyboard() } } }
                .sheet(item:$panel,onDismiss:restorePanel){panel in panelView(panel)}
                .navigationDestination(item:$reviewID) { id in GroupBillReviewContent(id:id) { dismiss() } }
                .task { store.beginEditing(editorID);initialize() }.onDisappear{store.endEditing(editorID)}

                .onChange(of:store.savedCount){_,_ in finish()}.editorSaveState(closeAfterRecovery:false)
        }
    }
    @ViewBuilder private var dateControl:some View {
        if repeats { DatePicker("Next bill date",selection:$date,displayedComponents:.date).labelsHidden().accessibilityLabel("Next bill date") }
        else { DatePicker("Purchase date",selection:$date,in:...Date.now,displayedComponents:.date).labelsHidden().accessibilityLabel("Purchase date") }
    }
    private var repeatControl:some View { Button{openPanel(.repeatBill)}label:{Label(repeatSummary,systemImage:"repeat").font(.subheadline).fixedSize(horizontal:true,vertical:false)}.buttonStyle(.plain).foregroundStyle(Brand.sage).frame(minHeight:44).accessibilityIdentifier("group-edit-repeat") }
    private var payerNames:String {
        guard multiple else{return "You"}
        let ids=(try? input().payers.map(\.memberId)) ?? []
        let names=people.filter{ids.contains($0.id)}.map{$0.isYou ? "You" : $0.name}
        return names.isEmpty ? "Choose payers" : names.count<=2 ? names.joined(separator:" + ") : "\(names.count) people"
    }
    private var splitSummary:String { let chosen=people.filter(\.included);if chosen.count==1{return "All for "+(chosen[0].isYou ? "you" : chosen[0].name)};return method.title+" · \(chosen.count) people" }
    private var repeatSummary:String { !repeats ? "Doesn’t repeat" : every==1 ? ["week":"Weekly","month":"Monthly","year":"Yearly"][interval] ?? "Monthly" : "Every \(every) \(interval)s" }
    private func settingRow(_ title:String,value:String,symbol:String,panel:GroupBillPanel,identifier:String)->some View {
        Button{openPanel(panel)}label:{HStack(spacing:12){Image(systemName:symbol).frame(width:24).foregroundStyle(Brand.sage);VStack(alignment:.leading,spacing:4){Text(title).font(.caption).foregroundStyle(Brand.secondary);Text(value).font(.subheadline.weight(.medium)).foregroundStyle(Brand.ink)};Spacer(minLength:12);Image(systemName:"chevron.right").font(.caption).foregroundStyle(Brand.secondary)}.frame(minHeight:36)}.buttonStyle(ContentRowStyle()).accessibilityIdentifier(identifier)
    }
    private var splitPlan:GroupComputedPlan? {
        guard let total:Int64=try? store.requireEngine().run("parseAmount",command:["amount":amount]) else{return nil}
        let input=GroupBillDefinition(total:total,method:method.rawValue,people:people.filter(\.included).map{GroupBillCostInput(memberId:$0.id,value:$0.value)},payers:[GroupBillPaymentInput(memberId:group.memberId,amount:total)])
        return try? store.requireEngine().run("groupBillPlan",command:["plan":DraftFields.encode(input)])
    }
    private var paymentRows:some View {
        Section {
            ForEach($people) { $person in
                HStack(spacing:12) {
                    PersonAvatar(email:person.id,name:person.name,size:36)
                    VStack(alignment:.leading,spacing:4){Text(person.name+(person.isYou ? " (you)" : ""));if !person.joined { Text("Invite this person to join first.").font(.caption).foregroundStyle(Brand.secondary) }}
                    Spacer(minLength:12)
                    SharedEntryField(title:"Amount paid",text:$person.paid,focusKey:"payer-"+person.id,activeField:$activeField).multilineTextAlignment(.trailing).frame(maxWidth:110).disabled(!person.joined).accessibilityLabel("Paid by "+person.name)
                }.frame(minHeight:48).id(person.id)
            }
        } header:{Text("Who paid?")} footer:{Text("Enter each person’s actual contribution to this bill.")}
    }
    private var costRows:some View {
        Group {
            Section {
                LazyVGrid(columns:[GridItem(.flexible()),GridItem(.flexible())],spacing:8) {
                    ForEach(SharedSplitMethod.allCases,id:\.self){choice in
                        Button{if method != choice{method=choice;setDefaults(choice)}}label:{Label(choice.shortTitle,systemImage:choice.symbol).font(.subheadline.weight(.medium)).frame(maxWidth:.infinity,minHeight:44).foregroundStyle(method==choice ? Color.white : Brand.ink).background(method==choice ? Brand.action : Brand.canvas,in:.rect(cornerRadius:12))}.buttonStyle(ContentRowStyle()).accessibilityAddTraits(method==choice ? [.isSelected]:[])
                    }
                }
            }
            Section {
                ForEach($people) { $person in
                    HStack(spacing:12) {
                        Button{person.included.toggle()}label:{HStack(spacing:12){Image(systemName:person.included ? "checkmark.circle.fill" : "circle").foregroundStyle(person.included ? Brand.action : Brand.secondary);PersonAvatar(email:person.id,name:person.name,size:32);Text(person.name+(person.isYou ? " (you)" : "")).font(.subheadline).foregroundStyle(Brand.ink)}.frame(minHeight:48)}.buttonStyle(ContentRowStyle()).accessibilityLabel("Include "+person.name).accessibilityValue(person.included ? "Selected" : "Not selected").accessibilityIdentifier("split-person-"+person.name)
                        Spacer(minLength:8)
                        if person.included {
                            VStack(alignment:.trailing,spacing:6) {
                                if method != .equal { HStack(spacing:4){SharedEntryField(title:method == .percent ? "Percentage" : method == .shares ? "Share units" : "Amount",text:$person.value,focusKey:"share-"+person.id,activeField:$activeField).multilineTextAlignment(.trailing).frame(width:90).accessibilityLabel((method == .percent ? "Percentage for " : method == .shares ? "Share units for " : "Amount for ")+person.name);if method == .percent{Text("%").foregroundStyle(Brand.secondary)}} }
                                if let value=splitPlan?.people.first(where:{$0.memberId==person.id}) { Text(SharedMoney.format(value.amount,group.currency)).font((method == .equal ? Font.subheadline : Font.caption).weight(.semibold)).monospacedDigit() }
                            }
                        }
                    }.id(person.id)
                }
            } footer:{if method == .shares{Text("Use nights, portions or people as share units. 2 shares cost twice as much as 1.")}}
        }
    }
    private var repeatRows:some View {
        Section {
            if series==nil{Toggle("Repeat this bill",isOn:$repeats)}
            if repeats{
                Stepper("Repeat every \(every)",value:$every,in:1...12)
                Picker("Interval",selection:$interval){Text("Weeks").tag("week");Text("Months").tag("month");Text("Years").tag("year")}
                Toggle("Set an end date",isOn:$hasEnd)
                if hasEnd{DatePicker("End date",selection:$endDate,in:date...,displayedComponents:.date)}
            }
        } footer:{Text("Upcoming occurrences wait for review. No money is recorded automatically.")}
    }
    private func panelStatus(_ panel:GroupBillPanel)->String {
        if panel == .repeatBill{return repeats ? repeatSummary : "One expense"}
        let total:Int64=(try? store.requireEngine().run("parseAmount",command:["amount":amount])) ?? 0
        if panel == .split && method == .equal{return "\(people.filter(\.included).count) people · "+SharedMoney.format(total,group.currency)}
        if panel == .split && method == .shares{return splitPlan==nil ? "Enter a positive number of shares." : "All "+SharedMoney.format(total,group.currency)+" allocated"}
        let values=panel == .payers ? people.filter(\.joined).map(\.paid) : people.filter(\.included).map(\.value)
        let used:Int64=values.reduce(0){sum,value in sum+((try? store.requireEngine().run("parseAmount",command:["amount":value.isEmpty ? "0":value],as:Int64.self)) ?? 0)}
        let target:Int64=panel == .split && method == .percent ? 10000 : total
        let format:(Int64)->String = panel == .split && method == .percent ? {NSDecimalNumber(value:$0).dividing(by:100).stringValue+"%"} : {SharedMoney.format($0,group.currency)}
        return used==target ? "All "+format(target)+" allocated" : used<target ? format(target-used)+" left to allocate" : format(used-target)+" over the total"
    }
    private func canApply(_ panel:GroupBillPanel)->Bool {
        if panel == .repeatBill{return !hasEnd || endDate>=date}
        if panel == .split{return splitPlan != nil || amount.isEmpty && !people.filter(\.included).isEmpty}
        guard let input=try? input() else{return false};return !input.payers.isEmpty && input.payers.reduce(0,{$0+$1.amount})==input.total
    }
    private func panelView(_ panel:GroupBillPanel)->some View {
        NavigationStack {
            ScrollViewReader { proxy in
                BrandedForm { if panel == .payers{paymentRows}else if panel == .split{costRows}else{repeatRows} }
                    .onChange(of:scrollField){_,value in if let value { proxy.scrollTo(String(value.dropFirst(6)),anchor:.center) } }
            }
                .navigationTitle(panel == .payers ? "Who paid?" : panel == .split ? "Split the expense" : "Repeat expense").navigationBarTitleDisplayMode(.inline)
                .toolbar{ToolbarItem(placement:.cancellationAction){Button("Cancel"){restorePanel();self.panel=nil}};ToolbarItemGroup(placement:.keyboard){if nextField(panel) != nil{Button("Next person"){let next=nextField(panel);scrollField=next;activeField=next}};Spacer();Button("Done"){activeField=nil;dismissGroupKeyboard()}}}
                .safeAreaInset(edge:.bottom,spacing:0){VStack(spacing:12){Text(panelStatus(panel)).font(.subheadline.weight(.medium)).monospacedDigit().foregroundStyle(canApply(panel) ? Brand.ink : Brand.danger);Button{applyPanel(panel)}label:{Label(panel == .payers ? "Apply payers" : panel == .split ? "Apply split" : "Apply repeat",systemImage:"checkmark").frame(maxWidth:.infinity)}.primaryAction().disabled(!canApply(panel)).accessibilityIdentifier("apply-bill-panel")}.padding(16).background(Brand.canvas).accessibilityElement(children:.contain).accessibilityIdentifier("bill-panel-footer")}
        }.presentationDetents([.large])
    }
    private func openPanel(_ panel:GroupBillPanel){
        activeField=nil;scrollField=nil;dismissGroupKeyboard();panelBackup=fields
        if panel == .payers && !multiple{people=people.map{person in var p=person;p.paid=p.isYou ? (amount.isEmpty ? "0":amount):"0";return p};multiple=true}
        self.panel=panel
    }
    private func applyPanel(_ panel:GroupBillPanel){
        if panel == .split { groupNeedsReview=false }
        if panel == .payers,let input=try? input(){multiple=input.payers.count != 1 || input.payers.first?.memberId != group.memberId}
        activeField=nil;panelBackup=nil;self.panel=nil
    }
    private func nextField(_ panel:GroupBillPanel)->String? {
        let ids=panel == .payers ? people.filter(\.joined).map{"payer-"+$0.id} : panel == .split ? people.filter(\.included).map{"share-"+$0.id} : []
        guard let activeField,let index=ids.firstIndex(of:activeField),index+1<ids.count else{return nil}
        return ids[index+1]
    }
    private func restorePanel(){
        guard let old=panelBackup else{return};panelBackup=nil
        method=SharedSplitMethod(rawValue:old["method"] ?? "") ?? .equal;multiple=old["multiple"]=="true";people=DraftFields.decode([GroupBillPersonDraft].self,old["people"]) ?? people;repeats=old["repeats"]=="true";interval=old["interval"] ?? "month";every=Int(old["every"] ?? "1") ?? 1;hasEnd=old["hasEnd"]=="true";endDate=groupDate(old["endDate"] ?? groupDateKey(.now))
    }
    private func setDefaults(_ next:SharedSplitMethod){
        if next == .equal { return }
        let total:Int64=next == .percent ? 10000 : (try? store.requireEngine().run("parseAmount",command:["amount":amount],as:Int64.self)) ?? 0
        let definition=GroupBillDefinition(total:total,method:"equal",people:people.filter(\.included).map{GroupBillCostInput(memberId:$0.id,value:"1")},payers:[GroupBillPaymentInput(memberId:group.memberId,amount:total)])
        let even:GroupComputedPlan?=try? store.requireEngine().run("groupBillPlan",command:["plan":DraftFields.encode(definition)])
        people=people.map { person in var p=person;p.value=next == .shares ? "1" : NSDecimalNumber(value:even?.people.first(where:{$0.memberId==p.id})?.amount ?? 0).dividing(by:100).stringValue;return p }
    }
    private func initialize(){
        guard !initialized else{return}
        account=store.overview?.accounts.first(where:{$0.type=="checking"})?.id ?? store.overview?.accounts.first(where:{$0.type != "investment"})?.id ?? ""
        category=store.overview?.categories.first(where:{$0.icon==(group.kind=="trip" ? "plane" : "basket")})?.id ?? store.overview?.categories.first?.id ?? ""
        people=group.members.filter{$0.state != "removed"}.map { m in GroupBillPersonDraft(id:m.id,name:m.name,isYou:m.isYou,joined:m.state=="active",included:series?.definition.people.contains{$0.memberId==m.id} ?? true,value:series?.definition.people.first(where:{$0.memberId==m.id})?.value ?? "1",paid:NSDecimalNumber(value:series?.definition.payers.first(where:{$0.memberId==m.id})?.amount ?? 0).dividing(by:100).stringValue) }
        if let series { amount=NSDecimalNumber(value:series.definition.total).dividing(by:100).stringValue;merchant=series.merchant;date=groupDate(series.nextDate ?? series.schedule.start);method=SharedSplitMethod(rawValue:series.definition.method) ?? .equal;multiple=series.definition.payers.count != 1 || series.definition.payers.first?.memberId != group.memberId;interval=series.schedule.interval;every=series.schedule.every;hasEnd=series.schedule.until != nil;endDate=groupDate(series.schedule.until ?? groupDateKey(.now)) }
        repeats=recurring || series != nil;initialized=true
    }
    private func send(){
        guard let snapshot=store.snapshot else{return}
        do {
            let definition=try input()
            guard Set(definition.people.map(\.memberId)+definition.payers.map(\.memberId)).count>=2 else{throw BudgetEngine.failure("Include another person to share this bill, or save a regular transaction.")}
            var body=definition.body;body.merge(["billVersion":.number(1),"groupId":.string(group.id),"expectedGroupRevision":.number(Int64(group.revision)),"merchant":.string(merchant),"date":.string(groupDateKey(date))]){_,new in new}
            let path:String
            if repeats {
                guard !hasEnd || endDate>=date else{throw BudgetEngine.failure("The end date must follow the next bill date.")}
                var schedule:[String:JSONValue]=["start":.string(groupDateKey(date)),"interval":.string(interval),"every":.number(Int64(every))]
                if hasEnd { schedule["until"] = .string(groupDateKey(endDate)) };body["schedule"] = .object(schedule)
                if let series { path="/group-bill-series/"+series.id;body["actionType"] = .string("edit");body["expectedSeriesRevision"] = .number(Int64(series.revision)) } else { path="/group-bill-series" }
            } else {
                path="/group-bills";body.merge(["expectedRevision":.number(Int64(snapshot.revision)),"accountId":.string(account),"categoryId":.string(category),"confirmPaid":.bool(mePays)]){_,new in new}
            }
            submitted=true;error=nil;Task { _ = await store.sharedChange(path,body:body);finish() }
        }catch{self.error=error.localizedDescription}
    }
    private func finish(){
        guard submitted,store.pendingShared==nil,let response=store.lastGroupResponse else{return}
        if let bill=response.bill { submitted=false;discarded=true;if bill.state=="recorded"{dismiss()}else{reviewID=bill.id} }
        else if response.series != nil { submitted=false;discarded=true;dismiss() }
    }
}

struct GroupBillReviewView:View {
    @Environment(\.dismiss) private var dismiss
    let id:String
    var body:some View { NavigationStack { GroupBillReviewContent(id:id){dismiss()} } }
}
struct GroupBillReviewContent:View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    let id:String;let done:()->Void
    @State private var bill:GroupBillRecord?
    @State private var account=""
    @State private var category=""
    @State private var error:String?
    @State private var loading=false
    @State private var sequence=UUID()
    @State private var editorID=UUID()
    @State private var discarded=false
    @State private var expense:SharedExpense?
    private var canAct:Bool { guard let bill else{return false};return (bill.canConfirm || bill.canAccept) && bill.own?.budgetId==store.snapshot?.id && bill.problem==nil }
    var body:some View {
        ScrollView {
            VStack(alignment:.leading,spacing:24) {
                if let bill { content(bill) } else if error==nil { ProgressView("Loading bill") }
                if let error { Notice(message:error);Button("Try again"){Task{await load()}} }
            }.padding(20)
        }.background(Brand.canvas).navigationTitle("Review group bill").navigationBarTitleDisplayMode(.inline).navigationBarBackButtonHidden(true)
            .toolbar {
                ToolbarItem(placement:.cancellationAction){Button("Close",action:close)}
                ToolbarItem(placement:.topBarTrailing){if let bill,bill.canCancel || bill.canAccept { Menu{Button(bill.canCancel ? "Cancel this bill" : "Decline my share",systemImage:"xmark.circle"){cancel(bill)}}label:{Label("More actions",systemImage:"ellipsis").labelStyle(.iconOnly)} }}
            }
            .safeAreaInset(edge:.bottom,spacing:0) {
                if let bill { Button { canAct ? confirm(bill) : close() } label: { Label(canAct ? (bill.canConfirm ? "Confirm my payment" : "Accept my share") : "Close review",systemImage:canAct ? "checkmark" : "arrow.right").frame(maxWidth:.infinity) }.primaryAction().disabled(loading).accessibilityIdentifier("group-bill-review-primary").padding(16).background(Brand.canvas) }
            }
            .task { store.beginEditing(editorID);await load();while !Task.isCancelled { try? await Task.sleep(for:.seconds(5));if !Task.isCancelled && scenePhase == .active && !store.busy && store.pendingShared==nil { await load() } } }
            .onChange(of:account){_,_ in Task{await load()}}.onChange(of:category){_,_ in Task{await load()}}
            .onChange(of:store.savedCount){_,_ in if store.pendingShared==nil,store.lastGroupResponse?.bill?.id==id { bill=store.lastGroupResponse?.bill } }
            .onDisappear{store.endEditing(editorID)}
            .sheet(item:$expense){GroupBillView(initial:$0)}

            .editorSaveState(closeAfterRecovery:false)
    }
    @ViewBuilder private func content(_ bill:GroupBillRecord)->some View {
        Label(bill.state=="recorded" ? "Bill recorded" : bill.state=="cancelled" ? "Bill cancelled" : "Waiting for payer confirmations",systemImage:bill.state=="recorded" ? "checkmark.circle" : "clock").font(.subheadline.weight(.semibold)).foregroundStyle(Brand.sage)
        VStack(alignment:.leading,spacing:8){Text(SharedMoney.format(bill.total,bill.currency)).font(.largeTitle.weight(.semibold)).monospacedDigit();Text(bill.merchant).font(.headline);Text(readableDate(bill.date)).font(.caption).foregroundStyle(Brand.secondary)}
        if let scheduled=bill.scheduledDate,scheduled != bill.date { Text("Scheduled for "+readableDate(scheduled)+".").font(.caption).foregroundStyle(Brand.secondary) }
        if bill.refunded>0 { Text(SharedMoney.format(bill.refunded,bill.currency)+" refunded.").font(.caption).foregroundStyle(Brand.secondary) }
        VStack(alignment:.leading,spacing:16) {
            Text("Who paid").font(.headline)
            ForEach(bill.payers) { payer in VStack(alignment:.leading,spacing:6){groupMoney(payer.name+(payer.isYou ? " (you)" : ""),payer.amount,bill.currency);Text(payer.approved ? (bill.state=="recorded" ? "Recorded" : "Confirmed") : "Confirmation needed").font(.caption).foregroundStyle(Brand.secondary)} }
        }.padding(18).background(Brand.surface,in:.rect(cornerRadius:20))
        VStack(alignment:.leading,spacing:16){Text("Everyone’s share").font(.headline);ForEach(bill.people){person in groupMoney(person.name+(person.isYou ? " (you)" : ""),person.amount,bill.currency)}}
        if (bill.canConfirm || bill.canAccept),bill.budgetId==store.snapshot?.id,let data=store.overview {
            VStack(spacing:16) {
                if bill.canConfirm { Picker("Paid from",selection:$account){ForEach(data.accounts.filter{$0.type != "investment"}){Text($0.name).tag($0.id)}} }
                Picker("Your category",selection:$category){ForEach(data.categories){Text($0.name).tag($0.id)}}
            }.padding(16).background(Brand.surface,in:.rect(cornerRadius:16))
        }
        if let own=bill.own {
            DisclosureGroup("Your budget changes") {
                VStack(spacing:14){changeRow("Cash in accounts",own.before.cash,own.after.cash,bill.currency);changeRow("Spending this month",own.before.spent,own.after.spent,bill.currency);changeRow("Available to plan",own.before.ready,own.after.ready,bill.currency);changeRow("Friends owe you",own.before.receivable,own.after.receivable,bill.currency);changeRow("You owe",own.before.owed,own.after.owed,bill.currency)}.padding(.top,16)
            }.font(.subheadline).tint(Brand.sage)
        }
        if bill.state=="pending" { Text("Every payer confirms their own payment and share. Budgets change together after all payers confirm.").font(.caption).foregroundStyle(Brand.secondary) }
        if bill.state=="recorded" {
            DisclosureGroup("Payments and corrections") {
                ForEach(bill.payers.filter{$0.canOpen && $0.expenseId != nil}) { payer in Button("Review "+payer.name+"’s payment",systemImage:"doc.text") { Task { do{expense=try await store.sharedExpense(payer.expenseId!)}catch{self.error=error.localizedDescription} } }.buttonStyle(.glass).padding(.top,12) }
            }.font(.subheadline).tint(Brand.sage)
        }
        if let problem=bill.problem { Notice(message:problem) }
        if bill.budgetId != store.snapshot?.id { Text("Open the budget you joined this group with to review your share.").font(.subheadline).foregroundStyle(Brand.secondary) }
    }
    @ViewBuilder private func changeRow(_ label:String,_ before:Int64,_ after:Int64,_ currency:String)->some View {
        if before != after { VStack(alignment:.leading,spacing:6){Text(label).foregroundStyle(Brand.secondary);HStack{Text(SharedMoney.format(before,currency));Image(systemName:"arrow.right");Text(SharedMoney.format(after,currency)).fontWeight(.semibold)}.monospacedDigit()}.font(.subheadline).frame(maxWidth:.infinity,alignment:.leading) }
    }
    private func load() async {
        let token=UUID();sequence=token;loading=true
        do {
            let next=try await store.groupBill(id,account:account.isEmpty ? nil : account,category:category.isEmpty ? nil : category)
            guard sequence==token else{return};bill=next;error=nil
            if account.isEmpty { account=next.own?.accountId ?? "" };if category.isEmpty { category=next.own?.categoryId ?? "" }
        }catch{if sequence==token{self.error=error.localizedDescription}}
        if sequence==token{loading=false}
    }
    private func close(){discarded=true;done()}
    private func confirm(_ bill:GroupBillRecord) {
        guard let own=bill.own else{return}
        Task{_ = await store.sharedChange("/group-bills/"+id+(bill.canConfirm ? "/confirm" : "/accept"),body:["billVersion":.number(1),"expectedBillRevision":.number(Int64(bill.revision)),"expectedRevision":.number(Int64(own.revision)),"accountId":.string(account),"categoryId":.string(category),"confirmPaid":.bool(bill.canConfirm),"confirmShare":.bool(bill.canAccept)])}
    }
    private func cancel(_ bill:GroupBillRecord) { Task{_ = await store.sharedChange("/group-bills/"+id+(bill.canCancel ? "/confirm" : "/accept"),body:["decision":.string(bill.canCancel ? "cancel" : "decline"),"expectedBillRevision":.number(Int64(bill.revision))])} }
}

struct GroupCombinedBillSections:View {
    @Environment(AppStore.self) private var store
    let group:ExpenseGroupDetail
    let openBill:(String)->Void
    let editSeries:(GroupBillSeries?)->Void
    let changeSeries:(GroupBillSeries,String)->Void
    var showBills = true
    private var disabled:Bool { store.busy || store.pendingShared != nil || store.pending != nil }
    var body:some View {
        if showBills,let bills=group.combinedBills,!bills.isEmpty {
            Text("Shared bills").font(.headline)
            ForEach(bills) { bill in
                Button{openBill(bill.id)}label:{
                    HStack(spacing:12) {
                        Image(systemName:bill.state=="recorded" ? "checkmark.circle" : "clock")
                        VStack(alignment:.leading,spacing:6){Text(bill.merchant).font(.subheadline.weight(.semibold));Text(bill.state=="pending" ? "Payers reviewing" : bill.state=="cancelled" ? "Cancelled" : bill.canAccept ? "Your share needs review" : "Recorded").font(.caption).foregroundStyle(Brand.secondary)}
                        Spacer(minLength:12)
                        Text(SharedMoney.format(bill.total,group.currency)).font(.subheadline.weight(.semibold)).monospacedDigit()
                        Image(systemName:"chevron.right").font(.caption)
                    }.padding(16).background(Brand.surface,in:.rect(cornerRadius:18))
                }.buttonStyle(ContentRowStyle()).disabled(disabled)
            }
        }
        HStack {
            Text("Recurring bills").font(.headline);Spacer()
            if group.state=="active" { Button("Add recurring bill",systemImage:"plus"){editSeries(nil)}.labelStyle(.iconOnly).disabled(disabled || group.budgetId != store.snapshot?.id) }
        }
        if (group.series ?? []).isEmpty { Text("Keep repeating group costs ready to review.").font(.caption).foregroundStyle(Brand.secondary) }
        ForEach(group.series ?? []) { series in
            GroupSeriesRow(series:series,currency:group.currency,editable:group.state=="active" && !disabled,edit:{editSeries(series)},change:{changeSeries(series,$0)})
        }
    }
}
private struct GroupSeriesRow:View {
    let series:GroupBillSeries;let currency:String;let editable:Bool;let edit:()->Void;let change:(String)->Void
    @State private var confirmation:String?
    var body:some View {
        VStack(alignment:.leading,spacing:14) {
            HStack(alignment:.top,spacing:12) {
                Image(systemName:"repeat").foregroundStyle(Brand.sage)
                VStack(alignment:.leading,spacing:6){Text(series.merchant).font(.subheadline.weight(.semibold));Text(series.state=="complete" ? "Ended" : series.state=="paused" ? "Paused" : (series.due ? "Due " : "Next ")+readableDate(series.nextDate ?? series.schedule.start)).font(.caption).foregroundStyle(Brand.secondary)}
                Spacer(minLength:12)
                if series.canManage && series.state != "complete" {
                    Menu {
                        Button("Edit future bills",systemImage:"pencil",action:edit)
                        Button(series.state=="paused" ? "Resume" : "Pause",systemImage:series.state=="paused" ? "play" : "pause"){change(series.state=="paused" ? "resume" : "pause")}
                        Button("Skip next bill",systemImage:"forward"){confirmation="skip"}
                        Button("End schedule",systemImage:"stop"){confirmation="end"}
                    }label:{Label("Manage recurring bill",systemImage:"ellipsis").labelStyle(.iconOnly)}.disabled(!editable)
                }
            }
            Text(SharedMoney.format(series.definition.total,currency)).font(.subheadline.weight(.semibold)).monospacedDigit()
            if series.due { Button("Review due bill",systemImage:"doc.text"){change("create-occurrence")}.primaryAction(size:.regular).disabled(!editable) }
        }.padding(18).background(Brand.surface,in:.rect(cornerRadius:18))
            .confirmationDialog(confirmation=="skip" ? "Skip this occurrence?" : "End this schedule?",isPresented:Binding(get:{confirmation != nil},set:{if !$0{confirmation=nil}}),titleVisibility:.visible) {
                Button(confirmation=="skip" ? "Skip next bill" : "End schedule"){if let action=confirmation{change(action)};confirmation=nil}
            }message:{Text(confirmation=="skip" ? "No bill or budget entry will be created." : "Recorded bills and history stay available.")}
    }
}
