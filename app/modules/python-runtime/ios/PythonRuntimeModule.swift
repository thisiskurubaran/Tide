import ExpoModulesCore

public class PythonRuntimeModule: Module {
  // One serial queue so a slow script can't be overlapped by another call.
  private let queue = DispatchQueue(label: "dev.tide.python")

  public func definition() -> ModuleDefinition {
    Name("PythonRuntime")

    AsyncFunction("version") { () throws -> String in
      try TidePython.version()
    }.runOnQueue(queue)

    AsyncFunction("run") { (code: String) throws -> String in
      try TidePython.runCode(code)
    }.runOnQueue(queue)
  }
}
