import SwiftUI

/// Feedback for content rows. Navigation, menus and switches retain system behavior.
struct ContentRowStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(.rect)
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .fill(configuration.isPressed && enabled ? Brand.sage.opacity(0.10) : .clear)
                    .allowsHitTesting(false)
            }
            .opacity(enabled ? 1 : 0.5)
    }
}

struct AppToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Toggle(isOn: configuration.$isOn) { configuration.label.fixedSize(horizontal: false, vertical: true) }
            .toggleStyle(.switch).tint(Brand.sage).frame(minHeight: 44)
    }
}

/// An unfinished request is checked against the server; form payloads stay in memory.
struct SaveStatusBanner: View {
    @Environment(AppStore.self) private var store
    var onReview: (() -> Void)? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(store.saveStatusNeedsReview ? "Review an earlier save" : store.conflict && store.saveOperations.isEmpty ? "Review changed records" : "Save not confirmed", systemImage: "exclamationmark.icloud").font(.headline)
            Text(store.message ?? "Check whether the server recorded this change before entering it again.").font(.subheadline)
            if store.busy { ProgressView("Checking save…") }
            else if store.saveStatusNeedsReview {
                Text("Open your budget and People to review the saved records.").font(.caption).foregroundStyle(Brand.secondary)
                Button("I have reviewed the saved records") { store.acknowledgeSaveReview() }.buttonStyle(.bordered)
            } else if store.conflict && store.saveOperations.isEmpty {
                Button("Review latest records") {
                    if let onReview { onReview() } else { store.dropPendingPayload() }
                }.buttonStyle(.borderedProminent).controlSize(.large).accessibilityIdentifier("review-latest-records")
            } else {
                Button("Check save status", systemImage: "arrow.clockwise") { Task { await store.checkSaveStatus() } }
                    .buttonStyle(.borderedProminent).controlSize(.large).frame(minHeight: 44).tint(Brand.action).foregroundStyle(.white).accessibilityIdentifier("check-save-status")
            }
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Brand.surface)
    }
}

struct EditorSaveState: ViewModifier {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var closeAfterRecovery = true
    func body(content: Content) -> some View {
        content
            .disabled(store.busy || store.hasPendingSave)
            .interactiveDismissDisabled(store.busy)
            .safeAreaInset(edge: .top, spacing: 0) {
                if store.hasPendingSave {
                    VStack(spacing: 0) {
                        SaveStatusBanner(onReview: { dismiss() })
                        if !store.busy {
                            Button("Close") { store.dropPendingPayload(); dismiss() }.frame(minHeight: 44).padding(.bottom, 12)
                        }
                    }.background(Brand.surface)
                }
            }
            .onChange(of: store.savedCount) { old, new in
                if new > old && closeAfterRecovery { dismiss() }
            }
            .onDisappear { store.dropPendingPayload() }
    }
}

extension View {
    func sourceNavigation<ID: Hashable>(_ id: ID, in namespace: Namespace.ID) -> some View {
        modifier(OriginNavigation(id: id, namespace: namespace))
    }
    func editorSaveState(closeAfterRecovery: Bool = true) -> some View {
        modifier(EditorSaveState(closeAfterRecovery: closeAfterRecovery))
    }

}

private struct OriginNavigation<ID: Hashable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let id: ID
    let namespace: Namespace.ID
    func body(content: Content) -> some View {
        if reduceMotion { content }
        else { content.navigationTransition(.zoom(sourceID: id, in: namespace)) }
    }
}
