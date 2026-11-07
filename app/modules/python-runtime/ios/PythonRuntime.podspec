Pod::Spec.new do |s|
  s.name           = 'PythonRuntime'
  s.version        = '1.0.0'
  s.summary        = 'Embedded Python runtime for Tide'
  s.description    = 'Embedded CPython for running user scripts locally'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '17.0'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Fetched by scripts/fetch-ios-python.js on npm install.
  s.vendored_frameworks = 'Python.xcframework'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  # Not recursive, so the XCframework's headers stay out of the pod sources.
  s.source_files = '*.{h,m,swift}'
  s.public_header_files = 'TidePython.h'
end
