import SwiftUI

enum Theme {
    static let background = Color(uiColor: .systemGroupedBackground)
    static let card = Color(uiColor: .secondarySystemGroupedBackground)

    static func statusColor(_ status: String) -> Color {
        switch status {
        case "starting", "running":
            return .blue
        case "waiting_for_input", "waiting_for_approval":
            return .orange
        case "needs_resume":
            return .yellow
        case "idle":
            return .gray
        case "error":
            return .red
        case "archived", "exited":
            return .secondary
        default:
            return .gray
        }
    }

    static func statusLabel(_ status: String) -> String {
        switch status {
        case "starting": return "Starting"
        case "running": return "Running"
        case "waiting_for_input": return "Needs input"
        case "waiting_for_approval": return "Needs approval"
        case "needs_resume": return "Needs resume"
        case "idle": return "Idle"
        case "error": return "Error"
        case "archived": return "Archived"
        case "exited": return "Exited"
        default: return status.capitalized
        }
    }

    static func riskColor(_ risk: String) -> Color {
        switch risk.lowercased() {
        case "low": return .green
        case "medium": return .orange
        case "high": return .red
        case "critical": return .purple
        default: return .orange
        }
    }
}
