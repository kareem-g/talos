import SwiftUI

/// A pending interactive question (AskUserQuestion tool call).
struct QuestionCard: View {
    let question: Question
    let onSubmit: (_ selected: [String], _ customText: String?) -> Void

    @State private var selected: Set<String> = []
    @State private var customText = ""

    private var allowsMultiple: Bool {
        question.selectionMode == "multiple"
    }

    private var selectedAllowsCustomText: Bool {
        question.options.contains { selected.contains($0.id) && $0.allowsCustomText }
    }

    private var anyOptionAllowsCustomText: Bool {
        question.options.contains { $0.allowsCustomText }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                Text(question.title.isEmpty ? "Question" : question.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.orange)
            } icon: {
                Image(systemName: "questionmark.bubble.fill")
                    .foregroundStyle(Theme.orange)
            }

            Text(question.question)
                .font(.subheadline)
                .foregroundStyle(Theme.ink)

            VStack(spacing: 6) {
                ForEach(question.options) { option in
                    Button {
                        toggle(option)
                    } label: {
                        HStack {
                            Image(systemName: selected.contains(option.id)
                                ? (allowsMultiple ? "checkmark.square.fill" : "largecircle.fill.circle")
                                : (allowsMultiple ? "square" : "circle"))
                                .foregroundStyle(selected.contains(option.id) ? Theme.accent : Theme.ink3)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(option.label)
                                    .font(.subheadline)
                                    .foregroundStyle(Theme.ink)
                                    .multilineTextAlignment(.leading)
                                if let detail = option.description, !detail.isEmpty {
                                    Text(detail)
                                        .font(.caption2)
                                        .foregroundStyle(Theme.ink2)
                                        .multilineTextAlignment(.leading)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(10)
                        .background(
                            selected.contains(option.id) ? Theme.accentTint : Color.clear,
                            in: RoundedRectangle(cornerRadius: Theme.controlRadius)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }

            if anyOptionAllowsCustomText && selectedAllowsCustomText {
                TextField("Custom answer…", text: $customText, axis: .vertical)
                    .font(.subheadline)
                    .lineLimit(1...4)
                    .padding(10)
                    .background(Theme.field, in: RoundedRectangle(cornerRadius: Theme.controlRadius))
                    .autocorrectionDisabled()
            }

            Button {
                onSubmit(Array(selected), customText.nilIfBlank)
            } label: {
                Text("Submit")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(selected.isEmpty || (anyOptionAllowsCustomText && selectedAllowsCustomText && customText.isBlank))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.cardRadius)
                .strokeBorder(Theme.orange.opacity(0.35), lineWidth: 1)
        )
    }

    private func toggle(_ option: QuestionOption) {
        if allowsMultiple {
            if selected.contains(option.id) {
                selected.remove(option.id)
            } else {
                selected.insert(option.id)
            }
        } else {
            selected = [option.id]
        }
    }
}

private extension String {
    var isBlank: Bool {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
