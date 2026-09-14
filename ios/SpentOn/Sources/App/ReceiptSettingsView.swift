import SwiftUI

struct ReceiptSettingsView: View {
    @Environment(AppStore.self) private var store
    @State private var choice: ReceiptAIChoice = .notAsked
    var body: some View {
        BrandedForm {
            Section {
                Toggle(isOn: Binding(get: { choice == .allowed }, set: { choice = $0 ? .allowed : .declined; store.setReceiptAIChoice(choice) })) {
                    Label("Bill scanning", systemImage: "doc.text.viewfinder")
                }.tint(Brand.sage)
            } footer: {
                Text(store.isCloudConnection ? "Scanning sends bill images or pasted text through SpentOn and OpenRouter to Google’s paid AI service. Neither SpentOn nor our AI providers use your data to train AI. SpentOn covers the processing cost. Images are processed without being saved by the scanning service. Extracted details are kept for 24 hours to recover interrupted scans." : "Scanning sends bill images or pasted text through your server’s configured processing service. Your server operator funds processing and controls provider settings. Ask the operator about those settings before enabling scanning.")
            }
            Section {
                Text("Google reads the bill image directly. If scanning is off or Google is unavailable, you can enter the purchase manually. Review and correct the details before saving.")
                Text("This choice is remembered for your account on this iPhone. Change it here at any time.").foregroundStyle(Brand.secondary)
            }
        }.scrollContentBackground(.hidden).background(Brand.canvas).navigationTitle("Bill scanning").navigationBarTitleDisplayMode(.inline)
            .onAppear { choice = store.receiptAIChoice }
    }
}
