# Called from the Podfile's post_install (added by plugins/withQuietBuild.js).
#
# Pods are compiled from node_modules, so their warnings can't be fixed in this
# repo: a patch would be lost on the next install. This turns them off for pod
# targets only. Tide's own pods (app/modules/*) and the app and widget targets
# keep every warning.

TIDE_LOCAL_PODS = Dir.glob(File.expand_path('../../modules/*/ios/*.podspec', __dir__))
                     .map { |spec| File.basename(spec, '.podspec') }

def tide_quiet_build(installer)
  pods = installer.pods_project

  pods.targets.each do |target|
    next if TIDE_LOCAL_PODS.include?(target.name)

    target.build_configurations.each do |config|
      settings = config.build_settings
      settings['GCC_WARN_INHIBIT_ALL_WARNINGS'] = 'YES' # C, C++ and Objective-C
      settings['SWIFT_SUPPRESS_WARNINGS'] = 'YES'
      # "'Foo.o' has no symbols": libtool warns about files that compile to nothing.
      flags = Array(settings['OTHER_LIBTOOLFLAGS'] || '$(inherited)').join(' ')
      settings['OTHER_LIBTOOLFLAGS'] = "#{flags} -no_warning_for_no_symbols" unless flags.include?('-no_warning_for_no_symbols')
    end
  end

  # Script phases with no outputs run on every build, and Xcode warns about each
  # one unless the phase says that's intended ("Based on dependency analysis" off).
  # That covers nodejs-mobile's [CP-User] phases and Expo Dev Launcher's phase.
  projects = [pods] + installer.aggregate_targets.map(&:user_project).compact.uniq
  projects.each do |project|
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
    project.save if changed && project != pods # CocoaPods writes the Pods project itself
  end

  # Xcode's "Update to recommended settings" prompt for Pods.xcodeproj. It comes
  # back on every pod install because CocoaPods writes an old LastUpgradeCheck.
  version = `xcodebuild -version 2>/dev/null`[/Xcode (\d+)\.(\d+)/] && "#{$1}#{$2}0"
  if version
    pods.root_object.attributes['LastUpgradeCheck'] = version
    pods.root_object.attributes['LastSwiftUpdateCheck'] = version
  end
end
