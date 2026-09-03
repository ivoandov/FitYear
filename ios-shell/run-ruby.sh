#!/usr/bin/env bash
# Runs a Ruby script against fastlane's bundled gems.
#
# The `xcodeproj` gem is how the widget-extension target gets written into
# App.xcodeproj, and the only copy of it on this machine is inside the Homebrew
# fastlane install - the system Ruby cannot see it. These are the same paths
# /opt/homebrew/bin/fastlane exports for itself.
set -euo pipefail
FASTLANE_CELLAR=$(dirname "$(dirname "$(readlink -f /opt/homebrew/bin/fastlane 2>/dev/null || echo /opt/homebrew/bin/fastlane)")")
FASTLANE_LIBEXEC=$(ls -d /opt/homebrew/Cellar/fastlane/*/libexec | tail -1)
export PATH="/opt/homebrew/opt/ruby/bin:$PATH"
export GEM_HOME="${FASTLANE_GEM_HOME:-${HOME}/.local/share/fastlane/4.0.0}"
export GEM_PATH="${GEM_HOME}:${FASTLANE_LIBEXEC}"
cd "$(dirname "$0")"
exec ruby "$@"
