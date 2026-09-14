import SwiftUI

struct BatchCategoryCreation: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let base: JSONValue
    var context = CreationContext.budget
    var onUse: (([StructureDraft]) -> Void)?
    @State private var choices: [PipSetupCategory] = []
    @State private var query = ""
    @State private var error: String?
    @State private var initialized = false
    @State private var discarded = false
    @State private var editorID = UUID()
    private var data: Overview? { try? store.requireEngine().run("overview", budget: base) }
    private var selected: [PipSetupCategory] { choices.filter(\.selected) }
    private var search: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var drafts: [StructureDraft] {
        selected.map { .init(command: ["id":$0.id, "kind":"category", "name":$0.name, "group":$0.group, "icon":$0.icon, "color":$0.color]) }
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Choose the categories you use. Add several at once.").font(.subheadline).foregroundStyle(Brand.secondary)
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(Brand.secondary)
                        TextField("Find or create a category", text: $query).font(.subheadline)
                    }.padding(16).background(Brand.surface, in: .rect(cornerRadius: 16))
                    if !search.isEmpty && !choices.contains(where: { $0.name.caseInsensitiveCompare(search) == .orderedSame }) &&
                        !(data?.categories.contains(where: { $0.name.caseInsensitiveCompare(search) == .orderedSame }) ?? false) {
                        Button("Create “\(search)”", systemImage: "plus") {
                            guard search.count <= 80 else { error = "Use a category name with up to 80 characters."; return }
                            choices.insert(.init(name: search, group: "Everyday", icon: "basket", color: "sage", selected: true), at: 0)
                            query = ""
                        }.font(.subheadline).frame(minHeight: 44)
                    }
                    ForEach(Array(Set(choices.map(\.group))).sorted(), id: \.self) { group in
                        let items = choices.filter { $0.group == group && (search.isEmpty || $0.name.localizedCaseInsensitiveContains(search)) }
                        if !items.isEmpty {
                            Text(group).font(.subheadline.weight(.medium))
                            FinanceRows {
                                ForEach(items) { item in
                                    Button {
                                        if let index = choices.firstIndex(where: { $0.id == item.id }) { choices[index].selected.toggle() }
                                    } label: {
                                        HStack(spacing: 12) {
                                            CategoryGlyph(icon: item.icon, color: item.color, size: 28)
                                            Text(item.name).font(.subheadline).foregroundStyle(Brand.ink)
                                            Spacer(minLength: 12)
                                            Image(systemName: item.selected ? "checkmark.circle.fill" : "circle").foregroundStyle(item.selected ? Brand.sage : Brand.secondary)
                                        }.padding(20).frame(minHeight: 64).contentShape(Rectangle())
                                    }.buttonStyle(.plain).accessibilityValue(item.selected ? "Selected" : "Not selected")
                                    if item.id != items.last?.id { FinanceDivider() }
                                }
                            }
                        }
                    }
                    if let error { Text(error).font(.subheadline).foregroundStyle(Brand.danger) }
                    if onUse != nil { Text(context.explanation).font(.caption).foregroundStyle(Brand.secondary) }
                }.padding(24).frame(maxWidth: 700).frame(maxWidth: .infinity)
            }.background(Brand.canvas).navigationTitle("Add categories").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { discarded = true; dismiss() }.disabled(store.busy) }
                    ToolbarItem(placement: .confirmationAction) {
                        Button {
                            do { _ = try store.adding(drafts, to: base) }
                            catch { self.error = error.localizedDescription; return }
                            if let onUse { onUse(drafts); discarded = true; dismiss() }
                            else { Task { if await store.createRecords(drafts) { discarded = true; dismiss() } } }
                        } label: {
                            Text(selected.isEmpty ? "Add" : "Add \(selected.count)").foregroundStyle(selected.isEmpty || store.busy ? Brand.secondary : Color.white)
                        }.buttonStyle(.glassProminent).tint(Brand.action)
                            .disabled(selected.isEmpty || store.busy || store.hasPendingSave)
                    }
                }
                .task {
                    store.beginEditing(editorID)
                    guard !initialized else { return }
                    do {
                        let catalog: [PipStarter] = try store.requireEngine().run("categoryCatalog")
                        choices = catalog.filter { suggestion in
                            !(data?.categories.contains { $0.name.caseInsensitiveCompare(suggestion.name) == .orderedSame } ?? false)
                        }.map { .init(name: $0.name, group: $0.group, icon: $0.icon, color: $0.color, selected: false) }
                    } catch { self.error = error.localizedDescription }
                    initialized = true
                }
                .onDisappear { store.endEditing(editorID) }
                .interactiveDismissDisabled(!selected.isEmpty || store.busy)
                .editorSaveState()

        }
    }
}
