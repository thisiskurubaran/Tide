// Recent projects on the Home Screen; tapping one opens it in Tide. The app
// writes the list (and whether Tide Pro is on) to the shared app group.
import SwiftUI
import WidgetKit

private let appGroup = "group.com.thisiskurubaran.tide"

struct SharedData: Codable {
  var pro: Bool
  var projects: [String]
  var recent: [String]

  static func read() -> SharedData {
    guard let json = UserDefaults(suiteName: appGroup)?.string(forKey: "tide.shared"),
      let data = json.data(using: .utf8),
      let shared = try? JSONDecoder().decode(SharedData.self, from: data)
    else { return SharedData(pro: false, projects: [], recent: []) }
    return shared
  }
}

func projectURL(_ name: String) -> URL {
  let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? name
  return URL(string: "tide://project/\(encoded)")!
}

struct ProjectsEntry: TimelineEntry {
  let date: Date
  let shared: SharedData
}

struct ProjectsProvider: TimelineProvider {
  func placeholder(in context: Context) -> ProjectsEntry {
    ProjectsEntry(date: Date(), shared: SharedData(pro: true, projects: [], recent: ["portfolio", "weather-cli", "habit-tracker"]))
  }

  func getSnapshot(in context: Context, completion: @escaping (ProjectsEntry) -> Void) {
    completion(context.isPreview ? placeholder(in: context) : ProjectsEntry(date: Date(), shared: SharedData.read()))
  }

  // The app reloads the timeline when the list changes, so one entry is enough.
  func getTimeline(in context: Context, completion: @escaping (Timeline<ProjectsEntry>) -> Void) {
    completion(Timeline(entries: [ProjectsEntry(date: Date(), shared: SharedData.read())], policy: .never))
  }
}

struct RecentProjectsView: View {
  @Environment(\.widgetFamily) var family
  let entry: ProjectsEntry

  var body: some View {
    let names = Array((entry.shared.recent.isEmpty ? entry.shared.projects : entry.shared.recent).prefix(family == .systemSmall ? 3 : 4))
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        Image(systemName: "chevron.left.forwardslash.chevron.right").foregroundStyle(Color.accentColor)
        Text("Tide").font(.headline)
      }
      if !entry.shared.pro {
        Spacer(minLength: 0)
        Text("Widgets come with Tide Pro.").font(.caption).foregroundStyle(.secondary)
        Spacer(minLength: 0)
      } else if names.isEmpty {
        Spacer(minLength: 0)
        Text("Your projects show up here.").font(.caption).foregroundStyle(.secondary)
        Spacer(minLength: 0)
      } else {
        ForEach(names, id: \.self) { name in
          // Small widgets open one link for the whole widget; bigger ones per row.
          if family == .systemSmall {
            row(name)
          } else {
            Link(destination: projectURL(name)) { row(name) }
          }
        }
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(entry.shared.pro ? names.first.map(projectURL) : URL(string: "tide://pro"))
    .tideWidgetBackground()
  }

  private func row(_ name: String) -> some View {
    HStack(spacing: 6) {
      Image(systemName: "folder").font(.caption).foregroundStyle(.secondary)
      Text(name).font(.subheadline).lineLimit(1)
    }
  }
}

extension View {
  // iOS 17 asks widgets for a container background; earlier ones paint their own.
  @ViewBuilder
  func tideWidgetBackground() -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      containerBackground(for: .widget) { Color("TideBackground") }
    } else {
      padding().background(Color("TideBackground"))
    }
  }
}

struct RecentProjectsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "RecentProjects", provider: ProjectsProvider()) { entry in
      RecentProjectsView(entry: entry)
    }
    .configurationDisplayName("Recent projects")
    .description("Jump back into the projects you worked on last.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
