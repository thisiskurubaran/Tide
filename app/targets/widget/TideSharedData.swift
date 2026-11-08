// What the app shares with the widgets through the app group
// (src/features/widgets/sync.ts writes it), the tide:// links the widgets
// open (src/features/launch/links.ts reads them), and short relative times.
import Foundation
import WidgetKit

private let appGroup = "group.com.thisiskurubaran.tide"

// One project as a widget row shows it. Everything but the name is optional:
// unknown means the app hasn't worked it out (yet).
struct SharedProject: Codable, Hashable {
  var name: String
  var language: String?
  var badge: String?
  var color: String?
  var branch: String?
  var changes: Int?
  // ms since the epoch
  var openedAt: Double?

  var opened: Date? { openedAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
}

struct SharedFile: Codable, Hashable {
  var project: String
  var path: String
  var at: Double

  var name: String { path.split(separator: "/").last.map(String.init) ?? path }
  var folder: String {
    let parts = path.split(separator: "/")
    return parts.count > 1 ? parts.dropLast().joined(separator: "/") : ""
  }
  var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

// The last dev server, test run or task to finish.
struct SharedRun: Codable, Hashable {
  var project: String
  var command: String
  // "server", "tests" or "task"
  var kind: String
  // "passed", "failed" or "stopped"
  var status: String
  var detail: String
  var exitCode: Int?
  var startedAt: Double
  var endedAt: Double

  var ended: Date { Date(timeIntervalSince1970: endedAt / 1000) }
  var duration: TimeInterval { max(0, (endedAt - startedAt) / 1000) }
}

struct SharedData: Codable {
  // Read by the controls and the Shortcuts actions too.
  var projects: [String]
  var recent: [String]
  // Added later; absent in data from older app builds.
  var cards: [SharedProject]?
  var files: [SharedFile]?
  var lastRun: SharedRun?

  static let empty = SharedData(projects: [], recent: [], cards: [], files: [], lastRun: nil)

  static func read() -> SharedData {
    guard let json = UserDefaults(suiteName: appGroup)?.string(forKey: "tide.shared"),
      let data = json.data(using: .utf8),
      let shared = try? JSONDecoder().decode(SharedData.self, from: data)
    else { return .empty }
    return shared
  }

  // The rows to show: the app's cards, or bare names from older data.
  var projectCards: [SharedProject] {
    if let cards, !cards.isEmpty { return cards }
    return (recent.isEmpty ? projects : recent).map { SharedProject(name: $0) }
  }

  var lastProject: SharedProject? { projectCards.first }

  var recentFiles: [SharedFile] { files ?? [] }
}

// MARK: - Links

private let pathAllowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
private let queryAllowed = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+?#"))

func tideQueryValue(_ s: String) -> String {
  s.addingPercentEncoding(withAllowedCharacters: queryAllowed) ?? s
}

// tide://project/<name>
func projectURL(_ name: String) -> URL {
  let encoded = name.addingPercentEncoding(withAllowedCharacters: pathAllowed) ?? name
  return URL(string: "tide://project/\(encoded)") ?? URL(string: "tide://")!
}

// tide://project/<name>?<query>, e.g. "run=1"
func projectURL(_ name: String, query: String) -> URL {
  URL(string: projectURL(name).absoluteString + "?" + query) ?? projectURL(name)
}

enum TideLinks {
  static let home = URL(string: "tide://")!
  static let newProject = URL(string: "tide://?new=1")!
  static let search = URL(string: "tide://?search=1")!

  static func run(_ project: String) -> URL { projectURL(project, query: "run=1") }
  static func tests(_ project: String) -> URL { projectURL(project, query: "tests=1") }
  static func stop(_ project: String) -> URL { projectURL(project, query: "stop=1") }
  static func file(_ file: SharedFile) -> URL { projectURL(file.project, query: "file=\(tideQueryValue(file.path))") }
  static func agent(_ project: String) -> URL { URL(string: "tide://agent?project=\(tideQueryValue(project))") ?? home }
  static func deploy(_ project: String) -> URL { URL(string: "tide://deploy?project=\(tideQueryValue(project))") ?? home }

  // Runs it again the way it ran: tests open the Tests sheet, the rest run.
  static func rerun(_ run: SharedRun) -> URL { run.kind == "tests" ? tests(run.project) : self.run(run.project) }
}

// MARK: - Time

// "now", "5m ago", "3h ago", "2d ago", then "Mar 4".
func tideAgo(_ date: Date, now: Date = Date()) -> String {
  let seconds = max(0, now.timeIntervalSince(date))
  let minutes = Int(seconds / 60)
  if minutes < 1 { return "now" }
  if minutes < 60 { return "\(minutes)m ago" }
  let hours = minutes / 60
  if hours < 24 { return "\(hours)h ago" }
  let days = hours / 24
  if days < 7 { return "\(days)d ago" }
  let formatter = DateFormatter()
  formatter.setLocalizedDateFormatFromTemplate("MMMd")
  return formatter.string(from: date)
}

// "850ms", "12.4s", "3m 05s", "1h 02m"
func tideDuration(_ seconds: TimeInterval) -> String {
  if seconds < 1 { return "\(Int(seconds * 1000))ms" }
  if seconds < 60 { return String(format: "%.1fs", seconds) }
  let total = Int(seconds)
  if total < 3600 { return String(format: "%dm %02ds", total / 60, total % 60) }
  return String(format: "%dh %02dm", total / 3600, (total % 3600) / 60)
}

// "main · 3 changes", "main", "3 changes" or nil.
func gitSummary(_ project: SharedProject, short: Bool = false) -> String? {
  var parts: [String] = []
  if let branch = project.branch, !branch.isEmpty { parts.append(branch) }
  if let changes = project.changes, changes > 0 {
    parts.append(short ? "\(changes)Δ" : "\(changes) change\(changes == 1 ? "" : "s")")
  }
  return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

// The timeline every data widget uses: the app reloads it when its data
// changes; between those, a refresh every half hour keeps "2h ago" honest.
struct SharedEntry: TimelineEntry {
  let date: Date
  let shared: SharedData
}

struct SharedProvider: TimelineProvider {
  let sample: SharedData

  func placeholder(in context: Context) -> SharedEntry {
    SharedEntry(date: Date(), shared: sample)
  }

  func getSnapshot(in context: Context, completion: @escaping (SharedEntry) -> Void) {
    let shared = SharedData.read()
    // The gallery shows the sample until there's something real to show.
    let useSample = context.isPreview && shared.projectCards.isEmpty
    completion(SharedEntry(date: Date(), shared: useSample ? sample : shared))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SharedEntry>) -> Void) {
    let now = Date()
    let entry = SharedEntry(date: now, shared: SharedData.read())
    completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(30 * 60))))
  }
}

// Sample data for the widget gallery and previews.
enum TideSamples {
  static let shared: SharedData = {
    let now = Date().timeIntervalSince1970 * 1000
    return SharedData(
      projects: ["portfolio", "weather-cli", "habit-tracker", "api-server"],
      recent: ["portfolio", "weather-cli", "habit-tracker", "api-server"],
      cards: [
        SharedProject(name: "portfolio", language: "TS", badge: "TS", color: "#6f9dff", branch: "main", changes: 3, openedAt: now - 12 * 60_000),
        SharedProject(name: "weather-cli", language: "Python", badge: "Py", color: "#3fc095", branch: "feature/radar", changes: 0, openedAt: now - 2 * 3_600_000),
        SharedProject(name: "habit-tracker", language: "JS", badge: "JS", color: "#e8d44d", branch: "main", changes: 1, openedAt: now - 26 * 3_600_000),
        SharedProject(name: "api-server", language: "Go", badge: "Go", color: "#00add8", branch: "dev", changes: 7, openedAt: now - 4 * 86_400_000),
      ],
      files: [
        SharedFile(project: "portfolio", path: "src/components/Hero.tsx", at: now - 12 * 60_000),
        SharedFile(project: "portfolio", path: "src/styles/theme.css", at: now - 40 * 60_000),
        SharedFile(project: "weather-cli", path: "radar.py", at: now - 2 * 3_600_000),
        SharedFile(project: "habit-tracker", path: "README.md", at: now - 26 * 3_600_000),
      ],
      lastRun: SharedRun(project: "portfolio", command: "npm test", kind: "tests", status: "passed", detail: "All 52 passed", exitCode: 0, startedAt: now - 14 * 60_000 - 12_400, endedAt: now - 14 * 60_000)
    )
  }()
}
