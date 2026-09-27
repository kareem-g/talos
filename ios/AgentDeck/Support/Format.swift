import Foundation

enum Format {
    private static let relative: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter
    }()

    static func relativeTime(_ date: Date?) -> String {
        guard let date else { return "" }
        return relative.localizedString(for: date, relativeTo: Date())
    }

    static func cost(_ value: Double?) -> String? {
        guard let value, value > 0 else { return nil }
        return String(format: "$%.2f", value)
    }

    static func tokens(_ value: UInt64?) -> String? {
        guard let value, value > 0 else { return nil }
        if value >= 1_000_000 {
            return String(format: "%.1fM", Double(value) / 1_000_000)
        }
        if value >= 1_000 {
            return String(format: "%.1fk", Double(value) / 1_000)
        }
        return "\(value)"
    }

    /// Last path component of a project directory, e.g.
    /// `/home/kareem/project` → `project`.
    static func projectLabel(_ project: String?) -> String? {
        guard let project, !project.isEmpty, project != "/" else { return nil }
        return (project as NSString).lastPathComponent
    }
}
