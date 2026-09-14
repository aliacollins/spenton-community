import SwiftUI

struct PersonCreationView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var email = ""
    @State private var showEmail = false
    @State private var personID = UUID().uuidString.lowercased()
    @State private var editorID = UUID()
    @State private var discarded = false
    @State private var error: String?
    private var ready: Bool { !name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && !store.busy && !store.hasPendingSave }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment:.leading,spacing:24) {
                    Text("Add someone you share expenses with.").font(.subheadline).foregroundStyle(Brand.secondary)
                    TextField("Name",text:$name).font(.title2).textContentType(.name)
                        .padding(20).background(Brand.surface,in:.rect(cornerRadius:24))
                    FinancePanel {
                        DisclosureGroup("Email (optional)",isExpanded:$showEmail) {
                            TextField("Email",text:$email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().padding(.top,12)
                        }.font(.subheadline)
                    }
                    Text("You can add them to a group later.").font(.subheadline).foregroundStyle(Brand.secondary)
                    if let error {Notice(message:error)}
                }.padding(24)
            }.background(Brand.canvas).navigationTitle("Add person").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement:.cancellationAction) {Button("Cancel"){discarded=true;dismiss()}.disabled(store.busy)}
                    ToolbarItem(placement:.confirmationAction) {
                        Button {
                            guard !store.sample else{error="Sign in to save a person. This preview uses fictional data.";return}
                            guard name.count<=100,name.range(of:#"[<>\u0000-\u001f\u007f]"#,options:.regularExpression)==nil else{error="Use a plain name with up to 100 characters.";return}
                            guard email.isEmpty || (email.count<=254 && email.range(of:#"^\S+@[^\s@]+\.[^\s@]+$"#,options:.regularExpression) != nil && email.lowercased() != store.user?.email.lowercased()) else{error="Enter another person’s valid email, or leave it blank.";return}
                            Task {
                                if await store.sharedChange("/people",body:["personKey":.string(personID),"name":.string(name),"email":.string(email)]) {
                                    discarded=true;dismiss()
                                } else {error=store.message}
                            }
                        } label:{Text("Add").foregroundStyle(ready ? Color.white : Brand.secondary)}
                            .buttonStyle(.glassProminent).tint(Brand.action).disabled(!ready)
                    }
                }
                .onAppear{store.beginEditing(editorID)}.onDisappear{store.endEditing(editorID)}
                .editorSaveState().interactiveDismissDisabled(!name.isEmpty || store.busy)

        }
    }
}
