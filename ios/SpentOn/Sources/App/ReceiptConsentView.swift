import SwiftUI

struct ReceiptConsentView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let scan: () -> Void
    let decline: () -> Void
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 14) {
            Label("Scan your bill", systemImage: "doc.text.viewfinder").font(.title2.weight(.semibold)).foregroundStyle(Brand.sage)
            Text("Send your bill images through SpentOn and OpenRouter to Google’s paid AI service. Google reads the images to find the merchant, date and final total. Pasted bill text follows the same route.").font(.subheadline).foregroundStyle(Brand.secondary).fixedSize(horizontal: false, vertical: true)
            Text(store.isCloudConnection ? "Neither SpentOn nor our AI providers use your data to train AI. SpentOn covers the processing cost." : "Your server operator configures and funds processing. Check their provider and privacy settings before sending a bill.").font(.subheadline.weight(.medium)).fixedSize(horizontal: false, vertical: true)
            Button(action: scan) { Label("Scan", systemImage: "doc.text.viewfinder").frame(maxWidth: .infinity) }.primaryAction().keyboardShortcut(.defaultAction)
            Button(action: decline) { Text("Don’t scan").frame(maxWidth: .infinity).frame(minHeight: 44) }.buttonStyle(.plain).foregroundStyle(Brand.secondary)
        }.padding(24) }.scrollBounceBehavior(.basedOnSize).background(Brand.canvas).presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.height(440), .large]).presentationDragIndicator(.visible).interactiveDismissDisabled()
    }
}
