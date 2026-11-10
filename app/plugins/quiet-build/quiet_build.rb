# Podfile hooks added by plugins/withQuietBuild.js.
#
# Pods are compiled from node_modules, so their warnings can't be fixed in this
# repo: a patch would be lost on the next install. These hooks turn them off for
# pod targets only. Tide's own pods (app/modules/*) and the app and widget
# targets keep every warning.

TIDE_LOCAL_PODS = Dir.glob(File.expand_path('../../modules/*/ios/*.podspec', __dir__))
                     .map { |spec| File.basename(spec, '.podspec') }

# The installed Xcode as a LastUpgradeCheck value ("Xcode 26.1" -> "2610").
def tide_xcode_version
  return @tide_xcode_version if defined?(@tide_xcode_version)

  @tide_xcode_version = `xcodebuild -version 2>/dev/null`[/Xcode (\d+)\.(\d+)/] && "#{$1}#{$2}0"
end

# Script phases with no outputs run on every build, and Xcode warns about each
# one unless the phase says that's intended ("Based on dependency analysis" off).
def tide_mark_always_out_of_date(project)
  changed = false
  project.targets.each do |target|
    target.shell_script_build_phases.each do |phase|
      next unless phase.respond_to?(:always_out_of_date=)
      next unless Array(phase.output_paths).empty? && Array(phase.output_file_list_paths).empty?
      next if phase.always_out_of_date == '1'

      phase.always_out_of_date = '1'
      changed = true
    end
  end
  changed
end

# Stops Xcode's "Update to recommended settings" prompt from coming back. Taking
# it turns on user script sandboxing, which CocoaPods' script phases don't support.
def tide_mark_upgrade_checked(project)
  version = tide_xcode_version
  return false unless version

  attributes = project.root_object.attributes
  return false if attributes['LastUpgradeCheck'] == version && attributes['LastSwiftUpdateCheck'] == version

  attributes['LastUpgradeCheck'] = version
  attributes['LastSwiftUpdateCheck'] = version
  true
end

# post_install: the Pods project.
def tide_quiet_build(installer)
  pods = installer.pods_project
  aggregate_labels = installer.aggregate_targets.map(&:label)

  pods.targets.each do |target|
    next if TIDE_LOCAL_PODS.include?(target.name)

    target.build_configurations.each do |config|
      settings = config.build_settings
      settings['GCC_WARN_INHIBIT_ALL_WARNINGS'] = 'YES' # C, C++ and Objective-C
      settings['SWIFT_SUPPRESS_WARNINGS'] = 'YES'
      # "'Foo.o' has no symbols": libtool warns about files that compile to nothing.
      flags = Array(settings['OTHER_LIBTOOLFLAGS'] || '$(inherited)').join(' ')
      settings['OTHER_LIBTOOLFLAGS'] = "#{flags} -no_warning_for_no_symbols" unless flags.include?('-no_warning_for_no_symbols')
      # Pods-Tide is a static library; embedding the Swift libraries is the app's job
      # ("Not running swift-stdlib-tool: ... is not a wrapper type").
      settings['ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES'] = 'NO' if aggregate_labels.include?(target.name)
    end
  end

  tide_mark_always_out_of_date(pods)
  tide_mark_upgrade_checked(pods)
  # CocoaPods writes the Pods project itself after post_install.
end

# post_integrate: the app project. CocoaPods adds the [CP-User] script phases
# (nodejs-mobile's) to the app target while integrating, after post_install.
def tide_quiet_user_project(installer)
  installer.aggregate_targets.map(&:user_project).compact.uniq.each do |project|
    changed = tide_mark_always_out_of_date(project)
    changed |= tide_mark_upgrade_checked(project)

    # Undo "Update to recommended settings" if it was taken: with sandboxing on,
    # [CP] Copy Pods Resources fails to write Pods/resources-to-copy-*.txt.
    (project.build_configurations + project.targets.flat_map(&:build_configurations)).each do |config|
      next if config.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] == 'NO'

      config.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'
      changed = true
    end

    project.save if changed
  end
end
