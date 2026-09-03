import ActivityKit
import Foundation

/**
 The contract between the app and the widget extension.

 This file is a member of BOTH targets - the app requests the activity, the
 widget renders it - and ActivityKit itself is what carries the state across.
 That is why there is no App Group here and no shared file: everything the lock
 screen needs travels in `ContentState`.

 `endTime` is an absolute instant on purpose. The web rest timer has always
 counted to an absolute end time (`lib/rest-timer-state.ts`), which is exactly
 what SwiftUI's `Text(timerInterval:)` wants: the system renders the countdown
 itself, once per second, with the app suspended and no pushes. A relative
 "seconds remaining" would need an update every second and would be wrong the
 moment the app was frozen.
 */
@available(iOS 16.2, *)
struct RestActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// When the rest is over. The widget counts down to this.
        var endTime: Date
        /// The exercise just finished, e.g. "Barbell Bench Press".
        var exerciseName: String
        /// What is up next, when the tracker knows. Nil on the last exercise.
        var nextExerciseName: String?
    }

    // Deliberately no static attributes. Nothing about a rest is fixed for its
    // whole life: extending one (+30s, "rest again") moves the end time, and
    // the tracker can learn what is next after the rest has already started.
    // Keeping every field in `ContentState` is what lets an extension be an
    // UPDATE rather than an end-and-restart, which would flicker on the lock
    // screen.
}
