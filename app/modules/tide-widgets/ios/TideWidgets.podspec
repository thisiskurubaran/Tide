Pod::Spec.new do |s|
  s.name           = 'TideWidgets'
  s.version        = '1.0.0'
  s.summary        = 'Home Screen widgets and Live Activities for Tide'
  s.description    = 'Shares recent projects with the widget extension and runs the deploy and run Live Activities'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '17.0'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit', 'ActivityKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '*.swift'
end
