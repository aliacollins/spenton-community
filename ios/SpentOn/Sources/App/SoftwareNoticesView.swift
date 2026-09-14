import SwiftUI
import UIKit

struct SoftwareNoticesView: View {
    private var text: String {
        [("LICENSE", ""), ("LICENSE_SCOPE", "md"), ("third-party-notices", "txt")].compactMap { name, ext in
            Bundle.main.url(forResource: name, withExtension: ext.isEmpty ? nil : ext)
                .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
        }.joined(separator: "\n\n")
    }
    var body: some View {
        NoticeText(text: text).background(Brand.canvas)
            .navigationTitle("Software notices").navigationBarTitleDisplayMode(.inline)
    }
}
private struct NoticeText: UIViewRepresentable {
    let text: String
    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false; view.isSelectable = true
        view.font = .preferredFont(forTextStyle: .footnote)
        view.adjustsFontForContentSizeCategory = true
        view.backgroundColor = .clear
        view.textContainerInset = UIEdgeInsets(top: 20, left: 16, bottom: 20, right: 16)
        return view
    }
    func updateUIView(_ view: UITextView, context: Context) { if view.text != text { view.text = text } }
}
