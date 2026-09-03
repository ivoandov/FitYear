#!/usr/bin/env ruby
# frozen_string_literal: true

# Adds the FitYearWidgets widget-extension target to ios/App/App.xcodeproj.
#
# `cap add ios` generates a single-target project and no Capacitor plugin can
# add a second one, so the extension that renders the lock-screen rest timer has
# to be written into the project file directly. The result IS committed - this
# script is not part of the build - but it stays here, and stays idempotent, so
# the target can be rebuilt if the iOS project is ever regenerated from scratch.
# Run it twice and the second run reports "already present" and changes nothing.
#
#   ios-shell/run-ruby.sh add-live-activity-target.rb
#
# (That wrapper is what puts fastlane's bundled `xcodeproj` gem on the load
# path; there is no system-wide copy of it on this machine.)

require "xcodeproj"

ROOT          = File.expand_path(__dir__)
PROJECT_PATH  = File.join(ROOT, "ios/App/App.xcodeproj")
APP_TARGET    = "App"
WIDGET_TARGET = "FitYearWidgets"
WIDGET_DIR    = File.join(ROOT, "ios/App", WIDGET_TARGET)
APP_BUNDLE_ID = "ai.flyhi.fityear"
# Live Activities need 16.1; ActivityContent(state:staleDate:) needs 16.2, and
# the stale date is what swaps the countdown for "Done" with no push.
WIDGET_MIN_IOS = "16.2"
# Shared with the app target: the app requests the activity, the widget renders
# it, and both need the same ActivityAttributes type.
SHARED_SOURCES = ["ios/App/App/LiveActivity/RestActivityAttributes.swift"].freeze
# App-target-only sources that live beside it.
APP_ONLY_SOURCES = [
  "ios/App/App/LiveActivity/RestLiveActivityPlugin.swift",
  "ios/App/App/MainViewController.swift"
].freeze

project = Xcodeproj::Project.open(PROJECT_PATH)
app_target = project.targets.find { |t| t.name == APP_TARGET }
abort "No target named #{APP_TARGET} in #{PROJECT_PATH}" if app_target.nil?

changed = false

# --- 1. App-target sources -------------------------------------------------
# The plugin, the bridge subclass and the shared attributes all compile into the
# app. `cap add ios` only ever knew about AppDelegate and SceneDelegate.
app_group = project.main_group["App"]
live_group = app_group["LiveActivity"] || app_group.new_group("LiveActivity", "LiveActivity")

(SHARED_SOURCES + APP_ONLY_SOURCES).each do |rel|
  name = File.basename(rel)
  already = app_target.source_build_phase.files_references.any? { |r| r&.path&.end_with?(name) }
  next if already

  parent = rel.include?("/LiveActivity/") ? live_group : app_group
  ref = parent.files.find { |f| f.path == name } || parent.new_reference(name)
  app_target.add_file_references([ref])
  puts "  + #{APP_TARGET}: #{name}"
  changed = true
end

# --- 2. The widget extension target ----------------------------------------
widget_target = project.targets.find { |t| t.name == WIDGET_TARGET }

if widget_target.nil?
  widget_target = project.new_target(
    :app_extension, WIDGET_TARGET, :ios, WIDGET_MIN_IOS, project.products_group, :swift
  )
  puts "  + target #{WIDGET_TARGET}"
  changed = true

  widget_group = project.main_group.new_group(WIDGET_TARGET, WIDGET_TARGET)

  # Widget-only sources, then the shared attributes file by its path RELATIVE to
  # the widget group, so the same file on disk backs both targets.
  Dir[File.join(WIDGET_DIR, "*.swift")].sort.each do |abs|
    ref = widget_group.new_reference(File.basename(abs))
    widget_target.add_file_references([ref])
  end
  widget_group.new_reference("Info.plist")

  shared_ref = live_group.files.find { |f| f.path == "RestActivityAttributes.swift" }
  widget_target.add_file_references([shared_ref]) if shared_ref

  # An app extension is EMBEDDED in the app; without this the target builds and
  # is then simply not in the .app, so the activity request finds no widget and
  # nothing ever appears on the lock screen.
  app_target.add_dependency(widget_target)
  embed = app_target.build_phases.find do |phase|
    phase.respond_to?(:name) && phase.name == "Embed Foundation Extensions"
  end
  if embed.nil?
    embed = app_target.new_copy_files_build_phase("Embed Foundation Extensions")
    embed.symbol_dst_subfolder_spec = :plug_ins
  end
  unless embed.files_references.include?(widget_target.product_reference)
    build_file = embed.add_file_reference(widget_target.product_reference)
    build_file.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }
  end

  widget_target.build_configurations.each do |config|
    config.build_settings.merge!(
      "PRODUCT_BUNDLE_IDENTIFIER" => "#{APP_BUNDLE_ID}.#{WIDGET_TARGET}",
      "PRODUCT_NAME" => "$(TARGET_NAME)",
      "INFOPLIST_FILE" => "#{WIDGET_TARGET}/Info.plist",
      "INFOPLIST_KEY_CFBundleDisplayName" => "FitYear Rest Timer",
      "INFOPLIST_KEY_NSHumanReadableCopyright" => "",
      "IPHONEOS_DEPLOYMENT_TARGET" => WIDGET_MIN_IOS,
      "TARGETED_DEVICE_FAMILY" => "1,2",
      "SWIFT_VERSION" => "5.0",
      "CODE_SIGN_STYLE" => "Automatic",
      "SKIP_INSTALL" => "YES",
      "MARKETING_VERSION" => "1.0",
      "CURRENT_PROJECT_VERSION" => "1",
      "LD_RUNPATH_SEARCH_PATHS" => [
        "$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"
      ],
      # SwiftUI previews and the widget's own asset lookups want these; without
      # an asset catalog they must be blank rather than pointing at nothing.
      "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME" => "",
      "ASSETCATALOG_COMPILER_WIDGET_BACKGROUND_COLOR_NAME" => ""
    )
  end
else
  puts "  = target #{WIDGET_TARGET} already present"
end

if changed
  project.save
  puts "Saved #{PROJECT_PATH}"
else
  puts "Nothing to do - the project already has the Live Activity target."
end
