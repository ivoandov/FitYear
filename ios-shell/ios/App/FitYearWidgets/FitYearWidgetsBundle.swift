import SwiftUI
import WidgetKit

/**
 The extension's entry point.

 It holds only the rest Live Activity - FitYear ships no home-screen widgets, so
 there is deliberately nothing in the widget gallery. The target's deployment
 target is 16.2, so no availability branch is needed here.
 */
@main
struct FitYearWidgetsBundle: WidgetBundle {
    var body: some Widget {
        RestActivityWidget()
    }
}
