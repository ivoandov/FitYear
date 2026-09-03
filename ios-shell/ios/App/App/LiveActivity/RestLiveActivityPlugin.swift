import ActivityKit
import Capacitor
import Foundation

/**
 The app half of the lock-screen rest timer.

 Written here rather than installed: `@capgo/capacitor-live-activities` (the
 plugin the build spec named) does not actually start a Live Activity. Its
 `startActivity` stores the layout in an in-memory Swift dictionary and returns
 a UUID for something that was never requested - there is no `Activity.request`
 call, and no `ActivityAttributes` type, anywhere in the package. It builds and
 resolves, so a caller sees success and nothing appears. This file is the ~100
 lines that plugin would have had to contain.

 There is only ever ONE rest, so this exposes no activity id: `start` and `end`
 operate on "the current rest activity", found through `Activity.activities`.
 That lookup is what makes it correct across an app relaunch - a Live Activity
 outlives the process that requested it, so a cached id in memory would be lost
 exactly when we most need to clear a stale countdown.
 */
@objc(RestLiveActivityPlugin)
public class RestLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RestLiveActivityPlugin"
    public let jsName = "RestLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise)
    ]

    /// True only when the OS supports Live Activities AND the user has left
    /// them enabled for FitYear. The web layer treats false as "do nothing",
    /// never as an error - the countdown on screen is unaffected either way.
    @objc func isSupported(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["supported": false, "reason": "iOS 16.2 or later is required"])
            return
        }
        let enabled = ActivityAuthorizationInfo().areActivitiesEnabled
        call.resolve([
            "supported": enabled,
            "reason": enabled ? "" : "Live Activities are turned off in Settings"
        ])
    }

    /**
     Start the countdown, or move an existing one.

     Re-arming a rest (pause then resume, +30s, "rest again") comes through here
     with a new end time. Updating the running activity rather than ending and
     re-requesting keeps the lock-screen card in place instead of making it
     disappear and slide back in.
     */
    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["started": false])
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve(["started": false])
            return
        }
        guard let endTimeMs = call.getDouble("endTime") else {
            call.reject("endTime is required")
            return
        }

        let endTime = Date(timeIntervalSince1970: endTimeMs / 1000)
        let state = RestActivityAttributes.ContentState(
            endTime: endTime,
            exerciseName: call.getString("exerciseName") ?? "Rest",
            nextExerciseName: call.getString("nextExerciseName")
        )
        // Past the end time the card is STALE, not wrong: the widget swaps the
        // countdown for "REST COMPLETE" rather than counting up into negatives.
        // The system re-renders at exactly this instant with no push and no
        // running app, which is the whole reason a website cannot do this.
        let content = ActivityContent(state: state, staleDate: endTime)

        Task {
            if let existing = Self.currentActivity() {
                await existing.update(content)
                call.resolve(["started": true])
                return
            }
            do {
                _ = try Activity.request(
                    attributes: RestActivityAttributes(),
                    content: content,
                    pushType: nil
                )
                call.resolve(["started": true])
            } catch {
                // Hitting the per-app activity limit, or the user revoking
                // permission between the check above and here. The rest itself
                // is unaffected, so this is not an error the web layer needs.
                CAPLog.print("⚡️  RestLiveActivity: \(error.localizedDescription)")
                call.resolve(["started": false])
            }
        }
    }

    /// Clear the card. Ends EVERY rest activity, not just one we have a handle
    /// on, so an orphan left by a previous launch cannot outlive its rest.
    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        Task {
            for activity in Activity<RestActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    @available(iOS 16.2, *)
    private static func currentActivity() -> Activity<RestActivityAttributes>? {
        return Activity<RestActivityAttributes>.activities.first
    }
}
