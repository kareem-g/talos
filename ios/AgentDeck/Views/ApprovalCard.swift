import SwiftUI

/// A pending permission approval. Options are sent back verbatim as the
/// `decision` — the backend accepts exact option strings.
struct ApprovalCard: View {
    let approval: PendingApproval
    let onDecision: (String) -> Void

    private var primaryOption: String? {
        approval.options.first {
            let lowered = $0.lowercased()
            return lowered.contains("allow") || lowered.contains("yes")
                && !lowered.contains("don't") && !lowered.contains("do not")
                && !lowered.contains("always")
        } ?? approval.options.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                Text("Approval needed · \(approval.riskLevel)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.riskColor(approval.riskLevel))
            } icon: {
                Image(systemName: "hand.raised.fill")
                    .foregroundStyle(Theme.riskColor(approval.riskLevel))
            }

            Text(approval.prompt)
                .font(.subheadline)
                .foregroundStyle(Theme.ink)
                .lineLimit(6)

            if approval.options.isEmpty {
                Button("Allow") { onDecision("allow") }
                    .buttonStyle(.borderedProminent)
                Button("Deny") { onDecision("deny") }
                    .buttonStyle(.bordered)
            } else {
                VStack(spacing: 8) {
                    ForEach(approval.options, id: \.self) { option in
                        if option == primaryOption {
                            optionButton(option, prominent: true)
                        } else {
                            optionButton(option, prominent: false)
                        }
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.cardRadius)
                .strokeBorder(Theme.riskColor(approval.riskLevel).opacity(0.35), lineWidth: 1)
        )
    }
    @ViewBuilder
    private func optionButton(_ option: String, prominent: Bool) -> some View {
        if prominent {
            Button {
                onDecision(option)
            } label: {
                Text(option.cleanOptionLabel)
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        } else {
            Button {
                onDecision(option)
            } label: {
                Text(option.cleanOptionLabel)
                    .font(.subheadline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }
}

private extension String {
    /// Option strings sometimes arrive as `"1. Yes"` — strip the leading
    /// enumerator for display.
    var cleanOptionLabel: String {
        guard count > 3, let first = first, first.isNumber else { return self }
        var remainder = dropFirst()
        while let next = remainder.first, next.isNumber {
            remainder = remainder.dropFirst()
        }
        if let next = remainder.first, next == "." || next == ")" {
            remainder = remainder.dropFirst()
        }
        let cleaned = remainder.trimmingCharacters(in: .whitespaces)
        return cleaned.isEmpty ? self : cleaned
    }
}
