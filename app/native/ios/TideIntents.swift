// Siri and Shortcuts actions: run a project, deploy it, send a
// request from a .http file, or open a project. Each opens Tide with a
// tide:// link the app already handles; plugins/withAppIntents.js adds this
// file to the app target, where iOS looks for App Intents.
import AppIntents
import UIKit

private let appGroup = "group.com.thisiskurubaran.tide"

private struct TideShared: Codable {
  var projects: [String]
  var recent: [String]

  static func read() -> TideShared? {
    guard let json = UserDefaults(suiteName: appGroup)?.string(forKey: "tide.shared"), let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(TideShared.self, from: data)
  }
}

struct ProjectEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Project"
  static let defaultQuery = ProjectQuery()
  var id: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(id)") }
}

struct ProjectQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [ProjectEntity] {
    identifiers.map { ProjectEntity(id: $0) }
  }

  // Recent projects first, then the rest.
  func suggestedEntities() async throws -> [ProjectEntity] {
    let shared = TideShared.read()
    let recent = shared?.recent ?? []
    let rest = (shared?.projects ?? []).filter { !recent.contains($0) }
    return (recent + rest).map { ProjectEntity(id: $0) }
  }
}

private func path(_ s: String) -> String {
  s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? s
}

private func query(_ s: String) -> String {
  s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+?"))) ?? s
}

@MainActor
private func openTide(_ link: String) async throws {
  if let url = URL(string: link) { _ = await UIApplication.shared.open(url) }
}

struct OpenProjectIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Project"
  static let description = IntentDescription("Opens a project in Tide.")
  static let openAppWhenRun = true

  @Parameter(title: "Project") var project: ProjectEntity

  @MainActor
  func perform() async throws -> some IntentResult {
    try await openTide("tide://project/\(path(project.id))")
    return .result()
  }
}

struct RunProjectIntent: AppIntent {
  static let title: LocalizedStringResource = "Run Project"
  static let description = IntentDescription("Opens a project in Tide and runs it with its run configuration.")
  static let openAppWhenRun = true

  @Parameter(title: "Project") var project: ProjectEntity

  @MainActor
  func perform() async throws -> some IntentResult {
    try await openTide("tide://project/\(path(project.id))?run=1")
    return .result()
  }
}

struct DeployProjectIntent: AppIntent {
  static let title: LocalizedStringResource = "Deploy Project"
  static let description = IntentDescription("Deploys a project with its saved Deploy settings.")
  static let openAppWhenRun = true

  @Parameter(title: "Project") var project: ProjectEntity

  @MainActor
  func perform() async throws -> some IntentResult {
    try await openTide("tide://deploy?project=\(query(project.id))&go=1")
    return .result()
  }
}

struct SendRequestIntent: AppIntent {
  static let title: LocalizedStringResource = "Send HTTP Request"
  static let description = IntentDescription("Opens a .http file in a project and sends one of its requests.")
  static let openAppWhenRun = true

  @Parameter(title: "Project") var project: ProjectEntity
  @Parameter(title: "File", description: "The .http file, from the project's root", default: "requests.http") var file: String
  @Parameter(title: "Request", description: "The request's name after ###; empty sends the first one") var request: String?

  @MainActor
  func perform() async throws -> some IntentResult {
    let send = request?.isEmpty == false ? request! : "1"
    try await openTide("tide://project/\(path(project.id))?file=\(query(file))&send=\(query(send))")
    return .result()
  }
}

struct TideShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: RunProjectIntent(),
      phrases: ["Run a project in \(.applicationName)", "Run my code in \(.applicationName)"],
      shortTitle: "Run Project",
      systemImageName: "play.fill"
    )
    AppShortcut(
      intent: DeployProjectIntent(),
      phrases: ["Deploy a project with \(.applicationName)", "Deploy my site with \(.applicationName)"],
      shortTitle: "Deploy Project",
      systemImageName: "icloud.and.arrow.up"
    )
    AppShortcut(
      intent: SendRequestIntent(),
      phrases: ["Send a request with \(.applicationName)"],
      shortTitle: "Send Request",
      systemImageName: "paperplane"
    )
    AppShortcut(
      intent: OpenProjectIntent(),
      phrases: ["Open a project in \(.applicationName)"],
      shortTitle: "Open Project",
      systemImageName: "folder"
    )
  }
}
