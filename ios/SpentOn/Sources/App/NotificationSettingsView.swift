import SwiftUI

struct NotificationSettingsView: View {
    @State private var requestingPermission = false
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var notifications = NotificationManager.shared
    private var time: Binding<Date> {
        Binding(get: { Calendar.current.date(from: DateComponents(hour: notifications.preferences.hour, minute: notifications.preferences.minute)) ?? .now }, set: {
            notifications.preferences.hour = Calendar.current.component(.hour, from: $0)
            notifications.preferences.minute = Calendar.current.component(.minute, from: $0)
            update()
        })
    }
    var body: some View {
        BrandedForm {
            Section {
                Label("Shared expenses and bills", systemImage: "bell.badge").font(.headline)
                Text("Choose which updates reach you. Names, amounts and account details stay out of previews.").font(.subheadline).foregroundStyle(Brand.secondary)
            }
            if notifications.authorization == .denied {
                Section {
                    Text("Notifications are off in iPhone Settings. Your choices below will apply when you allow them.")
                    Button("Open iPhone Settings", systemImage: "arrow.up.forward.app") { if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) } }
                }
            }
            Section {
                Toggle(isOn: Binding(get: { notifications.preferences.sharedUpdates }, set: { enabled in
                    guard !requestingPermission else { return }
                    requestingPermission = true
                    let account = store.user?.id
                    Task {
                        defer { requestingPermission = false }
                        if enabled { guard await notifications.requestPermission() else { return } }
                        guard store.user?.id == account else { return }
                        notifications.preferences.sharedUpdates = enabled; update()
                    }
                })) { Label("Shared-expense updates", systemImage: "person.2") }
                    .disabled(!notifications.sharedAvailable || store.sample || notifications.working || requestingPermission)
                Text(notifications.sharedAvailable ? "New requests, responses and repayment confirmations. Open an alert to review the expense before making changes." : "Shared-expense notifications are not available yet. Check People for updates.")
                    .font(.caption).foregroundStyle(Brand.secondary)
            }
            if let budgetID = store.snapshot?.id {
                Section {
                    Toggle(isOn: Binding(get: { notifications.preferences.billBudgets.contains(budgetID) }, set: { enabled in
                        guard !requestingPermission else { return }
                        requestingPermission = true
                        let account = store.user?.id
                        Task {
                            defer { requestingPermission = false }
                            if enabled { guard await notifications.requestPermission() else { return } }
                            guard store.user?.id == account, store.snapshot?.id == budgetID else { return }
                            if enabled { notifications.preferences.billBudgets.insert(budgetID) } else { notifications.preferences.billBudgets.remove(budgetID) }
                            update()
                        }
                    })) { Label("Bill reminders", systemImage: "calendar.badge.clock") }
                        .disabled(store.sample || notifications.working || requestingPermission)
                    Text("For upcoming bills in \(store.overview?.name ?? "this budget").").font(.caption).foregroundStyle(Brand.secondary)
                    if notifications.preferences.billBudgets.contains(budgetID) {
                        Picker("Remind me", selection: $notifications.preferences.dayBefore) {
                            Text("The day before").tag(true)
                            Text("On the due date").tag(false)
                        }.onChange(of: notifications.preferences.dayBefore) { update() }
                        DatePicker("At", selection: time, displayedComponents: .hourAndMinute)
                    }
                } footer: {
                    Text("One reminder per bill, in your local time. This iPhone schedules the next 30 days when SpentOn syncs. Open the app after changing a bill on another device to update its reminder.")
                }
            }
            Section {
                Text("SpentOn respects Focus and Scheduled Summary. There are no daily check-in reminders, notification badges or promotional alerts.").font(.subheadline).foregroundStyle(Brand.secondary)
            }
            if requestingPermission { ProgressView("Checking notification permission") }
            else if notifications.working { ProgressView("Updating notifications") }
            if let error = notifications.error { Section { Text(error).foregroundStyle(Brand.danger); Button("Try again", systemImage: "arrow.clockwise") { Task { await store.syncNotifications() } } } }
        }
        .navigationTitle("Notifications").navigationBarTitleDisplayMode(.inline)
        .task { await store.syncNotifications() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await store.syncNotifications() } } }
    }
    private func update() { notifications.savePreferences(); Task { await store.syncNotifications() } }
}

struct NotificationDetailView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let route: NudgeRoute
    @State private var expense: SharedExpense?
    @State private var error: String?
    @State private var loading = true
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if loading { ProgressView("Checking the latest details") }
                    else if let expense { SharedExpenseCard(expense: expense, changed: { Task { await load() } }) }
                    else if let error { ContentUnavailableView("Update unavailable", systemImage: "bell.slash", description: Text(error)); Button("Try again") { Task { await load() } } }
                    else if route.kind == "bill" {
                        Text("This bill is ready to review in Activity.").font(.headline)
                        Text("Check that you have paid before recording a payment.").font(.subheadline).foregroundStyle(Brand.secondary)
                        Button("Open Activity", systemImage: "list.bullet.rectangle") { store.notificationActivityRequested = true; dismiss() }.primaryAction(size: .regular)
                    }
                }.padding(20)
            }.background(Brand.canvas).navigationTitle(route.kind == "shared" ? "Shared expense" : "Upcoming bill").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
                .task { await load() }
        }
    }
    private func load() async {
        loading = true; error = nil; expense = nil
        defer { loading = false }
        guard let user = store.user, NotificationManager.accountKey(store.accountScope) == route.account, !store.requiresSignIn else { error = "Sign in to the account that received this notification."; return }
        do {
            if let id = route.expenseID {
                let current = try await store.sharedExpense(id)
                guard store.user?.id == user.id, !store.requiresSignIn else { error = "Sign in again to review this update."; return }
                expense = current
            }
            else if let id = route.budgetID {
                guard store.pending == nil, store.pendingShared == nil, !store.editing, !store.busy else { error = "Finish your current change before opening this bill."; return }
                await store.open(id)
                guard store.snapshot?.id == id else { error = "This budget could not be opened. Try again after syncing."; return }
                guard store.overview?.upcomingBills?.contains(where: { $0.id == route.billID }) == true else { error = "This bill has been paid, removed or changed. Check Activity for the latest details."; return }
            }
        } catch { self.error = error.localizedDescription }
    }
}
