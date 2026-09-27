import SwiftUI

/// Design tokens mirrored from the desktop dashboard
/// (`dashboard/src/index.css` — "warm studio" dark + "warm paper" light).
/// Keep values in sync when the web palette changes; every view renders
/// through these tokens so a change here restyles the whole app.
enum Theme {
    // MARK: Palette

    private static func pair(dark: String, light: String) -> Color {
        Color(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(hex: hex)
        })
    }

    /// Surfaces
    static let canvas = pair(dark: "#131315", light: "#F8F8FA")
    static let sidebar = pair(dark: "#17171B", light: "#EEEEF1")
    static let inset = pair(dark: "#19191C", light: "#F1F1F4")
    static let field = pair(dark: "#202024", light: "#ECECF0")
    static let surface = pair(dark: "#26262B", light: "#FFFFFF")
    static let hover2 = pair(dark: "#222226", light: "#F1F1F4")

    /// Text
    static let ink = pair(dark: "#F2F2F3", light: "#1A1A1E")
    static let ink2 = pair(dark: "#B0B0B6", light: "#55555E")
    static let ink3 = pair(dark: "#7E7E86", light: "#8A8A93")

    /// Hairlines
    static let line = pair(dark: "#34343A", light: "#E2E2E7")
    static let lineStrong = pair(dark: "#42424A", light: "#CFCFD6")

    /// Accent — the desktop default blue preset.
    static let accent = pair(dark: "#5B8DEF", light: "#3F6FB5")
    static let accentHover = pair(dark: "#6F9BF2", light: "#4A76D1")
    /// Text on accent fills (dark navy in dark mode, white on light).
    static let accentInk = pair(dark: "#0D1322", light: "#FFFFFF")
    static let accentTint = accent.opacity(0.12)

    /// Status
    static let green = pair(dark: "#57AB5A", light: "#2F7D3F")
    static let red = pair(dark: "#F85149", light: "#C0352B")
    static let orange = pair(dark: "#DB6D28", light: "#B3591B")

    /// Terminal — the desktop `--term-bg` / `--term-fg`.
    static let termBg = pair(dark: "#161618", light: "#FFFFFF")
    static let termFg = pair(dark: "#E6E6E9", light: "#1A1A1E")

    /// Fully transparent — used for "unselected" strokes.
    static let clear = Color.clear

    // MARK: Structure

    /// Desktop `rounded-card` (16px).
    static let cardRadius: CGFloat = 16
    static let controlRadius: CGFloat = 10

    /// The page background behind everything (`--canvas`).
    static let background = canvas
    /// Card / bubble / row fill (`--surface`).
    static let card = surface

    /// Eyebrow label style used across the desktop right rail:
    /// mono, small-caps, wide tracking, ink-3.
    static func eyebrow(_ size: CGFloat = 10) -> Font {
        .system(size: size, weight: .medium, design: .monospaced)
    }

    // MARK: Semantic helpers

    static func statusColor(_ status: String) -> Color {
        switch status {
        case "starting", "running":
            return green
        case "waiting_for_input", "waiting_for_approval":
            return orange
        case "needs_resume":
            return orange
        case "idle":
            return ink3
        case "error":
            return red
        case "archived", "exited":
            return ink3
        default:
            return ink3
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
        case "low": return green
        case "medium": return orange
        case "high": return red
        case "critical": return red
        default: return orange
        }
    }
}

extension UIColor {
    /// `#RRGGBB` / `#RRGGBBAA` initializer for the token table above.
    convenience init(hex: String) {
        var value: UInt64 = 0
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        Scanner(digits).scanHexInt64(&value)
        let r, g, b, a: CGFloat
        if digits.count == 8 {
            r = CGFloat((value >> 24) & 0xFF) / 255
            g = CGFloat((value >> 16) & 0xFF) / 255
            b = CGFloat((value >> 8) & 0xFF) / 255
            a = CGFloat(value & 0xFF) / 255
        } else {
            r = CGFloat((value >> 16) & 0xFF) / 255
            g = CGFloat((value >> 8) & 0xFF) / 255
            b = CGFloat(value & 0xFF) / 255
            a = 1
        }
        self.init(red: r, green: g, blue: b, alpha: a)
    }
}
