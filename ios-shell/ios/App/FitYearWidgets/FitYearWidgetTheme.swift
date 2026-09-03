import SwiftUI

/**
 The B+ tokens, hand-carried into Swift.

 The web app forbids hardcoded hex and reads everything from
 `src/app/globals.css`. A widget extension cannot read CSS, so these are the
 one place the values are literal - keep this file in sync with `:root` there
 rather than spreading hex through the views.
 */
enum FitYearWidgetTheme {
    /// --primary, the neon.
    static let neon = Color(red: 0.898, green: 1.0, blue: 0.0) // #E5FF00
    /// --background.
    static let background = Color(red: 0.043, green: 0.043, blue: 0.039) // #0B0B0A
    /// --foreground.
    static let foreground = Color(white: 0.96)
    /// --muted-foreground.
    static let muted = Color(white: 0.64)
    /// --tertiary-foreground.
    static let tertiary = Color(white: 0.42)

    /// The mono, uppercase, letter-spaced eyebrow the design system uses for
    /// every label. JetBrains Mono is not in the extension bundle, so this is
    /// the system monospace at the same weight and tracking.
    static func eyebrow(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .tracking(1.4)
            .foregroundStyle(FitYearWidgetTheme.tertiary)
    }
}
