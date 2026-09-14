import SwiftUI

/// Native glass supplies the press response; disabled labels keep a readable tone.
private struct PrimaryAction: ViewModifier {
    @Environment(\.isEnabled) private var enabled
    let size: ControlSize
    func body(content: Content) -> some View {
        content.buttonStyle(.glassProminent).tint(Brand.action)
            .foregroundStyle(enabled ? Color.white : Brand.secondary).controlSize(size)
    }
}

extension View {
    func primaryAction(size: ControlSize = .large) -> some View {
        modifier(PrimaryAction(size: size))
    }
}

struct MeaningIcon: View {
    let symbol: String
    var color: Color = Brand.sage
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 42
    var body: some View {
        Image(systemName: symbol).font(.body.weight(.semibold)).symbolRenderingMode(.hierarchical)
            .foregroundStyle(color).frame(width: side, height: side)
            .background(color.opacity(0.10), in: .rect(cornerRadius: 14))
            .accessibilityHidden(true)
    }
}

struct StatusBadge: View {
    let title: String
    let symbol: String
    var color: Color = Brand.sage
    var body: some View {
        Label(title, systemImage: symbol).font(.caption.weight(.medium))
            .fixedSize(horizontal: false, vertical: true).foregroundStyle(color)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(color.opacity(0.09), in: .rect(cornerRadius: 12))
    }
}

struct CategoryReviewCard: View {
    let category: BudgetCategory
    let data: Overview
    var body: some View {
        HStack(spacing: 14) {
            CategoryGlyph(icon: category.icon, color: category.color ?? "sage", size: 52)
            VStack(alignment: .leading, spacing: 6) {
                Text("Review \(category.name)").font(.headline).foregroundStyle(Brand.ink)
                StatusBadge(title: "Overspent", symbol: "exclamationmark.circle", color: Brand.danger)
                Text(data.money(-category.available)).font(.title2.weight(.semibold))
                    .monospacedDigit().foregroundStyle(Brand.danger)
            }
            Spacer(minLength: 0)
            Image(systemName: "arrow.right").font(.subheadline.weight(.semibold)).foregroundStyle(Brand.sage)
                .frame(width: 32, height: 32).background(Brand.sage.opacity(0.10), in: .circle)
                .accessibilityHidden(true)
        }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(Brand.surface, in: .rect(cornerRadius: 24))
            .overlay { RoundedRectangle(cornerRadius: 24).strokeBorder(Brand.sage.opacity(0.20), lineWidth: 1) }
            .contentShape(.rect(cornerRadius: 24))
    }
}

/// Values remain the server's minor-unit amounts; the bar only visualizes their proportions.
struct RepaymentBreakdown: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let share: ExpenseShare
    let currency: String
    private var total: Double { max(1, Double(share.confirmed) + Double(share.pending) + Double(share.remaining) + Double(share.offset ?? 0)) }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            GeometryReader { geometry in
                HStack(spacing: 0) {
                    segment(share.confirmed, width: geometry.size.width, color: Brand.sage)
                    segment(share.pending, width: geometry.size.width, color: Brand.sand)
                    if let offset=share.offset,offset>0 { segment(offset,width:geometry.size.width,color:Brand.blue) }
                    segment(share.remaining, width: geometry.size.width, color: Brand.secondary.opacity(0.18))
                }.clipShape(.capsule)
            }.frame(height: 8).accessibilityHidden(true)
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: share.confirmed)
            VStack(alignment: .leading, spacing: 10) {
                amount("Received", value: share.confirmed, symbol: "checkmark.circle.fill", color: Brand.sage)
                if let offset=share.offset,offset>0 { amount("Offset",value:offset,symbol:"arrow.left.arrow.right",color:Brand.blue) }
                amount("Awaiting confirmation", value: share.pending, symbol: "clock", color: Brand.sand)
                amount("Left to repay", value: share.remaining, symbol: "circle.dashed", color: Brand.secondary)
            }
            if let refunded=share.refunded,refunded>0 { Text(SharedMoney.format(refunded,currency)+" refunded from this share. Money to return is tracked separately.").font(.caption).foregroundStyle(Brand.secondary) }
        }.padding(14).background(Brand.canvas, in: .rect(cornerRadius: 16))
            .accessibilityRepresentation {
                Text("\(SharedMoney.format(share.confirmed, currency)) confirmed · \(SharedMoney.format(share.offset ?? 0, currency)) offset · \(SharedMoney.format(share.pending, currency)) awaiting confirmation. \(SharedMoney.format(share.remaining, currency)) left to repay.")
            }
    }
    private func segment(_ value: Int64, width: CGFloat, color: Color) -> some View {
        color.frame(width: width * CGFloat(min(1, max(0, Double(value) / total))))
    }
    private func amount(_ title: String, value: Int64, symbol: String, color: Color) -> some View {
        let label = Label { Text(title).foregroundStyle(Brand.secondary) } icon: { Image(systemName: symbol).foregroundStyle(color) }
            .font(.caption)
        let number = Text(SharedMoney.format(value, currency)).font(.subheadline.weight(.semibold))
            .monospacedDigit().foregroundStyle(Brand.ink)
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline) {
                label.fixedSize()
                Spacer(minLength: 12)
                number.fixedSize()
            }
            VStack(alignment: .leading, spacing: 5) {
                label.fixedSize(horizontal: false, vertical: true)
                number.fixedSize(horizontal: false, vertical: true)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
