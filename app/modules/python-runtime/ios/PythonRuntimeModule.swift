import ExpoModulesCore

public class PythonRuntimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PythonRuntime")

    AsyncFunction("version") { () throws -> String in
      throw Exception(name: "NotImplemented", description: "Python is not embedded on iOS yet")
    }

    AsyncFunction("run") { (_: String) throws -> String in
      throw Exception(name: "NotImplemented", description: "Python is not embedded on iOS yet")
    }
  }
}
