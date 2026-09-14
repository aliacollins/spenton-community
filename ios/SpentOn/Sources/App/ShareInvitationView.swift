import SwiftUI
import MessageUI

struct ShareInvitationView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let expense: SharedExpense
    let share: ExpenseShare
    var phone = ""
    @State private var invitation: ShareInvitation?
    @State private var bill: ReceiptAttachment?
    @State private var includeBill = true
    @State private var messageOpen = false
    @State private var messageSent = false
    private var message: String {
        "Hey! I’ve added your " + SharedMoney.format(share.amount, expense.currency) + " share for " + expense.merchant + " on SpentOn. The bill total is " + SharedMoney.format(expense.total, expense.currency) + (share.confirmed > 0 ? ". I’ve recorded " + SharedMoney.format(share.confirmed, expense.currency) + " received, leaving " + SharedMoney.format(share.amount - share.confirmed, expense.currency) + " outstanding" : "") + ". Review your share and join here: " + (invitation?.url ?? "")
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Invite " + share.displayName).font(.title3.weight(.semibold))
                    Text(SharedMoney.format(share.amount, expense.currency)).font(.largeTitle.weight(.semibold)).foregroundStyle(Brand.sage)
                    Text(expense.merchant + " · Bill total " + SharedMoney.format(expense.total, expense.currency)).font(.subheadline).foregroundStyle(Brand.secondary)
                    if invitation != nil {
                        Text(message).font(.body).padding(18).background(Brand.surface, in: .rect(cornerRadius: 20))
                        if let bill, !bill.pages.isEmpty {
                            Toggle(isOn: $includeBill) { Label("Attach bill to text message", systemImage: "paperclip") }
                            DisclosureGroup("Preview bill") { ReceiptPages(bill: bill) }
                        }
                        if MFMessageComposeViewController.canSendText() {
                            Button("Open Messages", systemImage: "message") { messageOpen = true }.primaryAction()
                        }
                        ShareLink(item: message) { Label("Share invitation", systemImage: "square.and.arrow.up") }.buttonStyle(.glass)
                        Text("The invitation works on the web and expires in 7 days. They choose whether to accept. Opening Messages does not send it.").font(.caption).foregroundStyle(Brand.secondary)
                        if messageSent { Label("Message sent", systemImage: "checkmark.circle").foregroundStyle(Brand.sage) }
                    } else if store.busy { ProgressView("Preparing invitation…") }
                    else if let error = store.message {
                        Notice(message: error)
                        if store.pendingShared != nil { Button("Retry invitation", systemImage: "arrow.clockwise") { Task { await store.retryShared(); receive() } } }
                    }
                }.padding(20)
            }.background(Brand.canvas).navigationTitle("Send invitation").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .sheet(isPresented: $messageOpen) { SplitMessageComposer(recipients: phone.isEmpty ? [] : [phone], text: message, pages: includeBill ? (bill?.pages ?? []) : []) { sent in messageSent = sent; messageOpen = false } }
                .task {
                    guard invitation == nil else { return }
                    if await store.sharedChange("/expense-shares/" + share.id + "/invite", body: [:]) { receive() }
                    if expense.hasReceipt == true { bill = try? await store.sharedReceipt(expense.id) }
                }
        }
    }
    private func receive() { if let value = store.lastSharedResponse?.invitation, value.shareId == share.id { invitation = value } }
}

private struct SplitMessageComposer: UIViewControllerRepresentable {
    let recipients: [String]; let text: String; let pages: [String]; let complete: (Bool) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(complete: complete) }
    func makeUIViewController(context: Context) -> MFMessageComposeViewController {
        let controller = MFMessageComposeViewController()
        controller.messageComposeDelegate = context.coordinator; controller.recipients = recipients; controller.body = text
        if MFMessageComposeViewController.canSendAttachments() {
            for (index, page) in pages.enumerated() { if let data = Data(base64Encoded: page) { controller.addAttachmentData(data, typeIdentifier: "public.jpeg", filename: "Bill-page-\(index + 1).jpg") } }
        }
        return controller
    }
    func updateUIViewController(_ controller: MFMessageComposeViewController, context: Context) {}
    final class Coordinator: NSObject, MFMessageComposeViewControllerDelegate {
        let complete: (Bool) -> Void
        init(complete: @escaping (Bool) -> Void) { self.complete = complete }
        func messageComposeViewController(_ controller: MFMessageComposeViewController, didFinishWith result: MessageComposeResult) { complete(result == .sent) }
    }
}

struct ReceiptPages: View {
    let bill: ReceiptAttachment
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(bill.pages.enumerated()), id: \.offset) { index, page in
                if let data = Data(base64Encoded: page), let image = UIImage(data: data) { Image(uiImage: image).resizable().scaledToFit().accessibilityLabel("Bill page \(index + 1)") }
            }
            Text(bill.text).font(.subheadline).textSelection(.enabled)
        }
    }
}

struct SharedBillView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let expense: SharedExpense
    @State private var bill: ReceiptAttachment?
    @State private var error: String?
    var body: some View {
        NavigationStack {
            ScrollView { VStack(alignment: .leading, spacing: 16) {
                Text(expense.merchant).font(.headline)
                Text("Bill total " + SharedMoney.format(expense.total, expense.currency)).font(.title3)
                if let bill { ReceiptPages(bill: bill) } else if let error { Notice(message: error) } else { ProgressView("Opening bill…") }
            }.padding(20) }.background(Brand.canvas).navigationTitle("Shared bill").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .task { do { bill = try await store.sharedReceipt(expense.id) } catch { self.error = error.localizedDescription } }
        }
    }
}
