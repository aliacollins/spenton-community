import SwiftUI

enum AppLayout {
    static let page: CGFloat = 24
    static let inset: CGFloat = 20
    static let row: CGFloat = 64
    static let section: CGFloat = 24
    static let radius: CGFloat = 24
}

func currencyMark(_ currency: String) -> String {
    ["INR":"₹", "USD":"$", "EUR":"€", "GBP":"£", "CAD":"CA$", "AUD":"A$"][currency] ?? currency
}

struct FinancePanel<Content: View>: View {
    var spacing: CGFloat = 14
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: spacing) { content }
            .padding(AppLayout.inset).frame(maxWidth: .infinity, alignment: .leading)
            .background(Brand.surface, in: .rect(cornerRadius: AppLayout.radius))
    }
}

struct FinanceRows<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Brand.surface, in: .rect(cornerRadius: AppLayout.radius))
            .clipShape(.rect(cornerRadius: AppLayout.radius))
    }
}

struct FinanceDivider: View {
    var body: some View {
        Rectangle().fill(Brand.secondary.opacity(0.16)).frame(height: 0.5)
            .padding(.leading, 60).padding(.trailing, 20).accessibilityHidden(true)
    }
}

struct FinanceAction: View {
    let title: String
    var symbol = "arrow.right"
    var prominent = false
    let action: () -> Void
    var body: some View {
        Group {
            if prominent {
                Button(action: action) { label.foregroundStyle(.white) }.buttonStyle(.glassProminent).tint(Brand.action)
            } else {
                Button(action: action) { label.foregroundStyle(Brand.ink) }.buttonStyle(.glass)
            }
        }.controlSize(.large)
    }
    private var label: some View {
        HStack { Text(title).font(.body.weight(.medium)); Spacer(minLength: 12); Image(systemName: symbol) }
            .frame(maxWidth: .infinity, minHeight: 28)
    }
}

struct AppFont: ViewModifier {
    @ScaledMetric private var size: CGFloat
    let weight: Font.Weight
    init(_ size: CGFloat, weight: Font.Weight = .regular) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: size >= 28 ? .largeTitle : .body)
        self.weight = weight
    }
    func body(content: Content) -> some View { content.font(.system(size: size, weight: weight)) }
}
extension View {
    func appFont(_ size: CGFloat, weight: Font.Weight = .regular) -> some View { modifier(AppFont(size, weight: weight)) }
}

struct AppPage<Content: View>: View {
    @Environment(AppStore.self) private var store
    @Environment(NavigationContext.self) private var navigation
    let title: String
    var subtitle = ""
    var addLabel = "Add"
    var add: (() -> Void)?
    var close: (() -> Void)? = nil
    @ViewBuilder let content: Content
    @State private var settings = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(title).appFont(32, weight: .semibold).tracking(-0.9)
                    Spacer(minLength: 12)
                    if let add {
                        Button(action: add) { Image(systemName: "plus").font(.system(size: 17)).frame(width: 20, height: 20) }
                            .buttonStyle(.glass).buttonBorderShape(.circle).controlSize(.large).accessibilityLabel(addLabel)
                            .disabled(store.busy || store.hasPendingSave)
                    }
                }.frame(minHeight: 46).padding(.bottom, 8)
                if !subtitle.isEmpty { Text(subtitle).appFont(14).foregroundStyle(Brand.secondary).padding(.bottom, 24) }
                content
            }.padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 24)
                .frame(maxWidth: 720).frame(maxWidth: .infinity)
        }
        .safeAreaBar(edge: .top, spacing: 0) {
            HStack {
                if let close {
                    Button("Close",action:close).buttonStyle(.glass).controlSize(.large)
                } else { Menu {
                    ForEach(store.budgets) { budget in
                        Button(budget.name) {
                            navigation.categoryID = ""; navigation.accountID = ""
                            Task { await store.open(budget.id) }
                        }
                    }
                    if store.budgets.isEmpty { Text(store.overview?.name ?? "Budget") }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "square.stack.3d.up").font(.system(size: 17))
                        Text(store.overview?.name ?? "Budget").appFont(14, weight: .medium).lineLimit(1)
                        Image(systemName: "chevron.down").font(.system(size: 10, weight: .medium))
                    }.frame(minHeight: 20).foregroundStyle(Brand.ink)
                }.buttonStyle(.glass).controlSize(.large).accessibilityLabel("Choose budget")
                    .disabled(store.busy || store.hasPendingSave)
                }
                Spacer(minLength: 12)
                Button { settings = true } label: {
                    Image(systemName: "person.crop.circle").font(.system(size: 21)).frame(width: 20, height: 20).foregroundStyle(Brand.ink)
                }.buttonStyle(.glass).buttonBorderShape(.circle).controlSize(.large).accessibilityLabel("Your account")
            }.padding(.horizontal, 24).padding(.vertical, 12).frame(maxWidth: 720).frame(maxWidth: .infinity)
        }
        .scrollEdgeEffectStyle(.soft, for: .top).background(Brand.canvas)
        .navigationTitle(title).toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $settings) { SettingsView() }
    }
}

struct AppSection: View {
    let title: String
    var actionTitle = ""
    var action: (() -> Void)?
    var body: some View {
        HStack {
            Text(title).appFont(14, weight: .semibold)
            Spacer()
            if let action { Button(actionTitle, action: action).appFont(13, weight: .medium).frame(minHeight: 44) }
        }.padding(.top, 24).padding(.bottom, 8)
    }
}

struct AppRow: View {
    @Environment(\.dynamicTypeSize) private var textSize
    let title: String
    var subtitle = ""
    var value = ""
    var symbol = "wallet.bifold"
    var color: Color = Brand.sage
    var negative = false
    var initials = ""
    var body: some View {
        HStack(spacing: 12) {
            Group {
                if initials.isEmpty { Image(systemName: symbol).font(.system(size: 18)) }
                else { Text(initials).font(.system(size: 14, weight: .semibold)) }
            }.foregroundStyle(color).frame(width: 38, height: 40)
                .background(color.opacity(0.10), in: .rect(cornerRadius: initials.isEmpty ? 12 : 22)).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).appFont(15, weight: .medium).foregroundStyle(Brand.ink)
                if !subtitle.isEmpty { Text(subtitle).appFont(12).foregroundStyle(Brand.secondary) }
                if textSize.isAccessibilitySize && !value.isEmpty {
                    Text(value).appFont(14, weight: .medium).monospacedDigit().foregroundStyle(negative ? Brand.danger : Brand.ink)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            if !textSize.isAccessibilitySize && !value.isEmpty {
                Text(value).appFont(14, weight: .medium).monospacedDigit().foregroundStyle(negative ? Brand.danger : Brand.ink).fixedSize()
            }
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .medium)).foregroundStyle(Brand.secondary).accessibilityHidden(true)
        }.padding(.horizontal, 16).padding(.vertical, 14).frame(minHeight: 70).contentShape(Rectangle())
    }
}

struct AppHero: View {
    let label: String
    let value: String
    var warning = false
    var note = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(label).appFont(14).foregroundStyle(Brand.secondary)
            Text(value).appFont(42, weight: .semibold).tracking(-1.5).monospacedDigit()
                .foregroundStyle(warning ? Brand.danger : Brand.ink).lineLimit(1).minimumScaleFactor(0.7).contentTransition(.numericText())
            if !note.isEmpty { Text(note).appFont(14).foregroundStyle(Brand.secondary).fixedSize(horizontal: false, vertical: true) }
        }.padding(.top, 8).padding(.bottom, 4).frame(maxWidth: .infinity, alignment: .leading)
    }
}
