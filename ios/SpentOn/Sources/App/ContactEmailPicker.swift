import SwiftUI
import ContactsUI

struct SelectedContact {
    let identifier: String
    let name: String
    let email: String
    let phone: String
}
// Only selected contacts are returned. Phone numbers remain on this iPhone and
// are passed to the system message composer, never the SpentOn server.
struct ContactEmailPicker: UIViewControllerRepresentable {
    let isPresented: Bool
    let selected: ([SelectedContact]) -> Void
    let cancelled: () -> Void
    var editorClosed: () -> Void = {}
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIViewController(context: Context) -> Presenter {
        let controller = Presenter()
        controller.ready = { [weak controller, weak coordinator = context.coordinator] in
            if let controller { coordinator?.present(from: controller) }
        }
        return controller
    }
    func updateUIViewController(_ controller: Presenter, context: Context) {
        context.coordinator.parent = self
        guard isPresented else { return }
        let coordinator = context.coordinator
        DispatchQueue.main.async { coordinator.present(from: controller) }
    }
    static func dismantleUIViewController(_ controller: Presenter, coordinator: Coordinator) {
        // Dismiss only the native picker, never the surrounding SwiftUI editor.
        coordinator.tearDown()
    }
    final class Presenter: UIViewController {
        var ready: (() -> Void)?
        override func viewDidLoad() { super.viewDidLoad(); view.backgroundColor = .clear }
        override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); ready?() }
    }
    @MainActor final class Coordinator: NSObject, @preconcurrency CNContactPickerDelegate, UIAdaptivePresentationControllerDelegate {
        var parent: ContactEmailPicker
        weak var picker: CNContactPickerViewController?
        private var handled = false
        private var detached = false
        init(parent: ContactEmailPicker) { self.parent = parent }
        func present(from host: UIViewController) {
            guard parent.isPresented, picker == nil, let window = host.view.window,
                  var presenter = window.rootViewController else { return }
            while let presented = presenter.presentedViewController { presenter = presented }
            guard !presenter.isBeingDismissed else { return }
            let picker = CNContactPickerViewController()
            picker.delegate = self
            picker.predicateForSelectionOfContact = NSPredicate(value: true)
            handled = false; self.picker = picker
            presenter.present(picker, animated: true)
            picker.presentationController?.delegate = self
        }
        private func finish(_ contacts: [CNContact]?) {
            guard !handled else { return }
            handled = true
            let values = contacts?.map { contact in
                let email = contact.emailAddresses.count == 1 ? String(contact.emailAddresses[0].value) : ""
                return SelectedContact(identifier: contact.identifier, name: CNContactFormatter.string(from: contact, style: .fullName) ?? contact.organizationName, email: email, phone: contact.phoneNumbers.first?.value.stringValue ?? "")
            }
            let deliver = { [weak self] in
                guard let self, !self.detached else { return }
                if let values { self.parent.selected(values) } else { self.parent.cancelled() }
            }
            // This targets only the UIKit picker. Updating presentation state never
            // dismisses a SwiftUI sheet or its parent split editor.
            if let picker, picker.presentingViewController != nil, !picker.isBeingDismissed {
                picker.dismiss(animated: true, completion: deliver)
            } else { deliver() }
        }
        func tearDown() {
            handled = true; detached = true
            picker?.delegate = nil
            picker?.presentationController?.delegate = nil
            picker?.dismiss(animated: false)
            Task { @MainActor in self.parent.editorClosed() }
        }
        func contactPickerDidCancel(_ picker: CNContactPickerViewController) { finish(nil) }
        func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { finish(nil) }
        func contactPicker(_ picker: CNContactPickerViewController, didSelect contacts: [CNContact]) {
            finish(contacts)
        }
    }
}
