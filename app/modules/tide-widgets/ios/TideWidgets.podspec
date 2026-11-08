Pod::Spec.new do |s|
  s.name           = 'TideWidgets'
  s.version        = '1.0.0'
  s.summary        = 'Home Screen widgets and Live Activities for Tide'
  s.description    = 'Shares widget data with the widget extension, runs the Live Activities and indexes projects in Spotlight'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '17.0'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit', 'ActivityKit', 'CoreSpotlight', 'UniformTypeIdentifiers'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '*.swift'
end
