import ActivityKit
import SwiftUI
import WidgetKit

/**
 The lock-screen rest timer, and the Dynamic Island version of it.

 Nothing here polls or updates. `Text(timerInterval:)` is rendered by the system
 once a second from an absolute end date, so the countdown keeps running with
 FitYear suspended, force-quit, or the phone locked - which is precisely what
 the web app cannot do. A suspended page cannot re-render, which is why the web
 version's shade notification can only ever state a fixed finish time.

 Past the end date the activity is stale and the countdown is replaced rather
 than left counting up. The system re-renders at the stale date on its own.
 */
@available(iOS 16.2, *)
struct RestActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestActivityAttributes.self) { context in
            LockScreenView(state: context.state, isStale: context.isStale)
                .activityBackgroundTint(FitYearWidgetTheme.background)
                .activitySystemActionForegroundColor(FitYearWidgetTheme.neon)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "timer")
                        .foregroundStyle(FitYearWidgetTheme.neon)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    CountdownText(state: context.state, isStale: context.isStale, size: 20)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.exerciseName)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(FitYearWidgetTheme.muted)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let next = context.state.nextExerciseName, !next.isEmpty {
                        FitYearWidgetTheme.eyebrow("Next  \(next)")
                            .lineLimit(1)
                    }
                }
            } compactLeading: {
                Image(systemName: "timer")
                    .foregroundStyle(FitYearWidgetTheme.neon)
            } compactTrailing: {
                CountdownText(state: context.state, isStale: context.isStale, size: 14)
            } minimal: {
                Image(systemName: "timer")
                    .foregroundStyle(FitYearWidgetTheme.neon)
            }
            // Tapping the card opens the tracker, not a cold home screen.
            .widgetURL(URL(string: "https://fityear.flyhi.ai/track"))
            .keylineTint(FitYearWidgetTheme.neon)
        }
    }
}

/**
 The countdown itself, or what replaces it once the rest is over.

 `Text(timerInterval:countsDown:)` needs a range whose upper bound is in the
 future; once it is not, the view is swapped for the finished state instead.
 */
@available(iOS 16.2, *)
private struct CountdownText: View {
    let state: RestActivityAttributes.ContentState
    let isStale: Bool
    let size: CGFloat

    /// The island's equivalent of `LockScreenView.countdownWidth`, in multiples
    /// of the font size because it renders much smaller.
    private var widthMultiple: CGFloat {
        state.endTime.timeIntervalSinceNow >= 3600 ? 5.2 : 3.6
    }

    var body: some View {
        if isStale || state.endTime <= Date() {
            Text("Done")
                .font(.system(size: size, weight: .semibold, design: .monospaced))
                .foregroundStyle(FitYearWidgetTheme.neon)
        } else {
            Text(timerInterval: Date()...state.endTime, countsDown: true)
                .font(.system(size: size, weight: .semibold, design: .monospaced))
                .monospacedDigit()
                .multilineTextAlignment(.leading)
                .foregroundStyle(FitYearWidgetTheme.neon)
                .frame(width: size * widthMultiple, alignment: .leading)
                // See the note on LockScreenView.countdownWidth.
        }
    }
}

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let state: RestActivityAttributes.ContentState
    let isStale: Bool

    private var isOver: Bool { isStale || state.endTime <= Date() }

    /// Wide enough for the longest value the format can produce, so the digits
    /// never have to be squeezed. An hour-plus rest is reachable through
    /// "+1 min" and renders H:MM:SS rather than MM:SS.
    ///
    /// A word on what this width is NOT for. On a locked SIMULATOR this
    /// countdown reads "1:--" above a minute and switches to real seconds
    /// ("0:52") inside the last one. That looks like a too-narrow frame and is
    /// not: it survives every width tried, and survives removing the frame
    /// altogether. `Text(date, style: .timer)` renders "1 minute" in the same
    /// spot, which is the tell - both APIs are being re-rendered by the system
    /// only at minute boundaries, because a locked simulator screen never
    /// leaves its idle state. UNPROVEN either way until it runs on a real
    /// phone; see the Live Activity gotcha in MIGRATION_PLAN.md.
    private var countdownWidth: CGFloat {
        state.endTime.timeIntervalSinceNow >= 3600 ? 214 : 148
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                FitYearWidgetTheme.eyebrow(isOver ? "Rest complete" : "Resting")
                Text(state.exerciseName)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(FitYearWidgetTheme.foreground)
                    .lineLimit(1)
                if let next = state.nextExerciseName, !next.isEmpty {
                    Text("Next  \(next)")
                        .font(.system(size: 13))
                        .foregroundStyle(FitYearWidgetTheme.muted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            if isOver {
                Text("Done")
                    .font(.system(size: 30, weight: .bold, design: .monospaced))
                    .foregroundStyle(FitYearWidgetTheme.neon)
            } else {
                // The width here is load-bearing, and both ways of getting it
                // wrong were seen on a simulator lock screen. A timer text
                // reserves room for the WIDEST value its interval can reach, so
                // a frame narrower than that silently renders em-dashes for the
                // digits that do not fit ("9:--" on a ten-minute rest, while a
                // ninety-second one looked perfect at 108pt). And `fixedSize()`
                // is NOT the fix: letting a timer size itself blanks the whole
                // card, every label included. So the frame is fixed, and sized
                // from the interval - which is safe because the interval only
                // ever shrinks, so a width computed one render ago is never too
                // narrow for the value on screen now.
                Text(timerInterval: Date()...state.endTime, countsDown: true)
                    .font(.system(size: 34, weight: .bold, design: .monospaced))
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .foregroundStyle(FitYearWidgetTheme.neon)
                    .frame(width: countdownWidth, alignment: .trailing)
            }
        }
        // 14, not 18: the countdown's width floor is not negotiable, so the
        // exercise name's room comes from here.
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
    }
}
