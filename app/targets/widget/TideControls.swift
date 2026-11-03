// Control Center (and Lock Screen / Action button) controls: run a project, or
// run its tests. Each opens Tide with a tide:// link the app already handles.
// A control can't know whether a dev server is up without the app, so these
// are buttons, not toggles.
import AppIntents
import SwiftUI
import WidgetKit

// A project to pick when setting up a control, from the list the app shares.
@available(iOS 18.0, *)
struct ControlProjectEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Project"
  static let defaultQuery = ControlProjectQuery()
  var id: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(id)") }
}

@available(iOS 18.0, *)
struct ControlProjectQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [ControlProjectEntity] {
    identifiers.map { ControlProjectEntity(id: $0) }
  }

  // Recent projects first, then the rest.
  func suggestedEntities() async throws -> [ControlProjectEntity] {
    let shared = SharedData.read()
    let rest = shared.projects.filter { !shared.recent.contains($0) }
    return (shared.recent + rest).map { ControlProjectEntity(id: $0) }
  }
}

// The control's setting: which project. Unset means the last one opened.
@available(iOS 18.0, *)
struct ControlProjectConfiguration: ControlConfigurationIntent {
  static let title: LocalizedStringResource = "Project"
  static let isDiscoverable = false

  @Parameter(title: "Project", description: "Leave empty for the project you opened last") var project: ControlProjectEntity?
}

@available(iOS 18.0, *)
struct ControlProjectProvider: AppIntentControlValueProvider {
  func previewValue(configuration: ControlProjectConfiguration) -> String {
    configuration.project?.id ?? ""
  }

  func currentValue(configuration: ControlProjectConfiguration) async throws -> String {
    configuration.project?.id ?? SharedData.read().recent.first ?? ""
  }
}

// The link to open: a project with `query`, or just Tide when there's no
// project yet.
@available(iOS 18.0, *)
private func controlURL(_ project: String, _ query: String) -> URL {
  project.isEmpty ? URL(string: "tide://")! : URL(string: projectURL(project).absoluteString + "?" + query)!
}

@available(iOS 18.0, *)
struct RunProjectControlIntent: AppIntent {
  static let title: LocalizedStringResource = "Run Project"
  static let openAppWhenRun = true
  // The app's own Run Project action is the one for Shortcuts.
  static let isDiscoverable = false

  @Parameter(title: "Project") var project: String

  init() { project = "" }
  init(project: String) { self.project = project }

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(controlURL(project, "run=1")))
  }
}

@available(iOS 18.0, *)
struct RunTestsControlIntent: AppIntent {
  static let title: LocalizedStringResource = "Run Tests"
  static let openAppWhenRun = true
  static let isDiscoverable = false

  @Parameter(title: "Project") var project: String

  init() { project = "" }
  init(project: String) { self.project = project }

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(controlURL(project, "tests=1")))
  }
}

@available(iOS 18.0, *)
struct RunProjectControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    AppIntentControlConfiguration(kind: "RunProjectControl", provider: ControlProjectProvider()) { project in
      ControlWidgetButton(action: RunProjectControlIntent(project: project)) {
        Label(project.isEmpty ? "Run project" : project, systemImage: "play.fill")
      }
    }
    .displayName("Run project")
    .description("Opens a project in Tide and runs it.")
  }
}

@available(iOS 18.0, *)
struct RunTestsControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    AppIntentControlConfiguration(kind: "RunTestsControl", provider: ControlProjectProvider()) { project in
      ControlWidgetButton(action: RunTestsControlIntent(project: project)) {
        Label(project.isEmpty ? "Run tests" : project, systemImage: "checkmark.circle")
      }
    }
    .displayName("Run tests")
    .description("Opens a project in Tide and runs its tests.")
  }
}
