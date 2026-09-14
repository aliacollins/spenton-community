import SwiftUI

/// A visible choice on Home. The system permission alert follows only a tap.
struct NotificationInvitation: View {
    @Environment(AppStore.self) private var store
    @State private var notifications = NotificationManager.shared
    @State private var requesting = false
    @State private var error: String?

    private var eligible: Bool {
        guard store.user != nil else { return false }
        return !store.sample && !store.requiresSignIn && store.snapshot != nil
            && !store.hasPendingSave
            && notifications.canOfferInvitation(userID: store.accountScope)
    }
    var body: some View {
        if requesting || (eligible && !notifications.working) {
            VStack(alignment: .leading, spacing: 14) {
                Label("Turn on notifications", systemImage: "bell.badge").font(.headline)
                if notifications.sharedAvailable {
                    Text("Get shared-expense updates and reminders for upcoming bills in \(store.overview?.name ?? "this budget").").font(.subheadline)
                } else {
                    Text("Get reminders for upcoming bills in \(store.overview?.name ?? "this budget").").font(.subheadline)
                }
                Text("Bill reminders arrive at 9:00 AM the day before. Previews hide names and amounts. You can change these choices in Account → Notifications.")
                    .font(.caption).foregroundStyle(Brand.secondary)
                if let error { Text(error).font(.subheadline).foregroundStyle(Brand.danger) }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 16) { enable; later }
                    VStack(alignment: .leading, spacing: 8) { enable; later }
                }
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                .background(Brand.surface, in: .rect(cornerRadius: 22))
        }
    }
    private var enable: some View {
        Button(action: enableNotifications) {
            HStack {
                if requesting { ProgressView().tint(.white) }
                Text(requesting ? "Enabling…" : "Enable notifications")
            }
        }.primaryAction()
            .disabled(requesting || store.busy || notifications.working)
            .accessibilityIdentifier("enable-notifications")
    }
    private var later: some View {
        Button("Not now") {
            if store.user != nil { notifications.answerInvitation(userID: store.accountScope) }
        }.frame(minHeight: 44).disabled(requesting)
            .accessibilityIdentifier("notifications-not-now")
    }
    private func enableNotifications() {
        guard eligible, !requesting, !store.busy, let user = store.user, let snapshot = store.snapshot else { return }
        let includeShared = notifications.sharedAvailable
        requesting = true; error = nil
        Task {
            defer { requesting = false }
            let allowed = await notifications.requestPermission()
            guard store.user?.id == user.id, store.snapshot?.id == snapshot.id, !store.requiresSignIn,
                  notifications.account == NotificationManager.accountKey(store.accountScope) else { return }
            guard allowed else {
                if notifications.authorization == .denied {
                    notifications.answerInvitation(userID: store.accountScope)
                    store.message = "Notifications are off. You can enable them in Account → Notifications."
                } else {
                    error = notifications.error ?? "Permission could not be checked. Try again."
                }
                return
            }
            notifications.preferences = notifications.preferences.enablingInvitation(budgetID: snapshot.id, includeShared: includeShared)
            notifications.savePreferences()
            notifications.answerInvitation(userID: store.accountScope)
            await store.syncNotifications()
            guard store.user?.id == user.id, store.snapshot?.id == snapshot.id else { return }
            store.message = notifications.error ?? "Your notification choices were saved."
        }
    }
}
