fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios certs

```sh
[bundle exec] fastlane ios certs
```

Create (or reuse) the Apple Distribution certificate and the App Store provisioning profile

### ios archive

```sh
[bundle exec] fastlane ios archive
```

Archive a signed App Store build (no upload). Needs no App Store record.

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Upload the archived build to TestFlight. REQUIRES the App Store Connect app record to exist.

### ios widget_certs

```sh
[bundle exec] fastlane ios widget_certs
```

Register the widget extension's App ID and its App Store profile

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
