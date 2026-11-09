import ExpoModulesCore

public class PythonRuntimeModule: Module {
  // Serial, so calls into Python never block the JS thread or overlap each other.
  private let queue = DispatchQueue(label: "dev.tide.python")

  public func definition() -> ModuleDefinition {
    Name("PythonRuntime")

    Events("onOutput", "onExit")

    // Capture self weakly in the outer closure too: a [weak self] list on the inner
    // closure alone makes the outer one hold self strongly.
    OnCreate { [weak self] in
      TidePython.setOutputHandler { runId, kind, text in
        self?.sendEvent("onOutput", ["id": runId, "kind": kind, "data": text])
      }
    }

    AsyncFunction("version") { () throws -> String in
      try TidePython.pythonVersion()
    }.runOnQueue(queue)

    AsyncFunction("snippet") { (code: String) throws -> String in
      try TidePython.runSnippet(code)
    }.runOnQueue(queue)

    AsyncFunction("run") { [weak self] (id: String, entry: String, cwd: String, args: [String], extraPaths: [String], purgeRoot: String) in
      TidePython.run(withId: id, entry: entry, cwd: cwd, args: args, extraPaths: extraPaths, purgeRoot: purgeRoot) { code, killed in
        self?.sendEvent("onExit", ["id": id, "code": code, "killed": killed])
      }
    }.runOnQueue(queue)

    AsyncFunction("write") { (id: String, data: String) in
      TidePython.feed(id, data: data)
    }.runOnQueue(queue)

    AsyncFunction("eof") { (id: String) in
      TidePython.endInput(id)
    }.runOnQueue(queue)

    AsyncFunction("kill") { (id: String) in
      TidePython.kill(id)
    }.runOnQueue(queue)
  }
}
