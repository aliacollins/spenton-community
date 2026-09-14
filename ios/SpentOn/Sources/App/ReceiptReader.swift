import SwiftUI
import VisionKit
import PDFKit
import ImageIO

enum ReceiptReader {
    static func read(_ data: Data, pdf: Bool) async throws -> ReceiptAttachment {
        try await Task.detached(priority: .userInitiated) {
            guard data.count <= 20_000_000 else { throw BudgetEngine.failure("Choose a file under 20 MB, or photograph the total section.") }
            var images: [CGImage] = []
            if pdf {
                guard let document = PDFDocument(data: data), !document.isLocked, document.pageCount > 0, document.pageCount <= 12 else { throw BudgetEngine.failure("Choose an unlocked PDF with up to 12 pages, or photograph the relevant page.") }
                for index in 0..<document.pageCount {
                    guard let page = document.page(at: index) else { throw BudgetEngine.failure("A bill page could not be opened. Choose another PDF or photo.") }
                    let bounds = page.bounds(for: .mediaBox)
                    guard bounds.width > 0, bounds.height > 0 else { throw BudgetEngine.failure("A bill page has no readable image. Choose another PDF or photo.") }
                    let scale = min(1800 / bounds.width, 1800 / bounds.height)
                    guard let image = page.thumbnail(of: CGSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox).cgImage else { throw BudgetEngine.failure("A bill page could not be opened. Choose another PDF or photo.") }
                    images.append(image)
                }
            } else {
                guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 1800] as CFDictionary) else { throw BudgetEngine.failure("Choose a readable photo or PDF.") }
                images = [image]
            }
            // Flatten and resize the image without extracting text. Google
            // receives these pixels even when on-device OCR would find nothing.
            let pages = images.compactMap { image -> String? in
                let picture = UIImage(cgImage: image)
                for quality in [0.7, 0.5, 0.3, 0.15] {
                    if let data = picture.jpegData(compressionQuality: quality), data.count <= 160_000 { return data.base64EncodedString() }
                }
                return nil
            }
            guard !pages.isEmpty, pages.count == images.count else { throw BudgetEngine.failure("This bill is too detailed to send clearly. Photograph the merchant, date and total section.") }
            return ReceiptAttachment(text: "", pages: pages)
        }.value
    }
}

struct ReceiptCamera: UIViewControllerRepresentable {
    let complete: (Data?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(complete: complete) }
    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController(); controller.delegate = context.coordinator; return controller
    }
    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}
    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let complete: (Data?) -> Void
        init(complete: @escaping (Data?) -> Void) { self.complete = complete }
        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { complete(nil) }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { complete(nil) }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            guard scan.pageCount <= 12 else { complete(Data()); return }
            let document = PDFDocument()
            for index in 0..<scan.pageCount { if let page = PDFPage(image: scan.imageOfPage(at: index)) { document.insert(page, at: document.pageCount) } }
            complete(document.dataRepresentation())
        }
    }
}
