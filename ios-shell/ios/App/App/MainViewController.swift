import Capacitor
import UIKit

/**
 The bridge view controller, subclassed for one reason: registering a plugin
 that does not come from npm.

 Capacitor 8 auto-registers plugins by reading `packageClassList` out of the
 generated `capacitor.config.json`, and `cap sync` rewrites that file from the
 installed node modules - so an app-local plugin listed there would be erased by
 the next sync. `registerPluginInstance` is the sanctioned path for exactly this
 case, and unlike `registerPluginType` it is not disabled while auto-registration
 is on.

 `capacitorDidLoad` runs after the bridge exists and before the web view loads,
 so the plugin is present the first time the site's JS asks for it.
 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(RestLiveActivityPlugin())
    }
}
