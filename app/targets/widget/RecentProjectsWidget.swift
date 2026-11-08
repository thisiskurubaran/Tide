// Recent projects on the Home Screen (and in StandBy, which shows the small
// size). Each project shows its language, git branch and changes and when it
// was last opened; the large size adds recent files; the small one puts the
// last project up front with a Run button. Tapping a row opens it in Tide.
// The app writes the data to the shared app group (TideSharedData.swift).
import SwiftUI
import WidgetKit

// A muted line with a small leading symbol: "⎇ main · 3 changes".
struct TideMetaLine: View {
  let symbol: String
  let text: String
  var color: Color = TidePalette.muted

  var body: some View {
    HStack(spacing: 3) {
      Image(systemName: symbol).font(.system(size: 9, weight: .semibold))
      Text(text).lineLimit(1)
    }
    .font(.system(size: 11, weight: .medium))
    .foregroundStyle(color)
  }
}

struct ProjectRow: View {
  let project: SharedProject
  let now: Date
  var compact = false

  var body: some View {
    HStack(spacing: 10) {
      LanguageBadge(project: project, size: compact ? 24 : 28)
      VStack(alignment: .leading, spacing: 1) {
        Text(project.name)
          .font(.system(size: compact ? 13 : 14, weight: .semibold))
          .foregroundStyle(TidePalette.foreground)
          .lineLimit(1)
        if let git = gitSummary(project) {
          TideMetaLine(symbol: "arrow.triangle.branch", text: git)
        } else if let language = project.language {
          Text(language).font(.system(size: 11, weight: .medium)).foregroundStyle(TidePalette.muted).lineLimit(1)
        }
      }
      Spacer(minLength: 4)
      if let opened = project.opened {
        Text(tideAgo(opened, now: now))
          .font(.system(size: 11, weight: .medium).monospacedDigit())
          .foregroundStyle(TidePalette.muted)
      }
      if let changes = project.changes, changes > 0 {
        Circle().fill(TidePalette.warning).frame(width: 6, height: 6).widgetAccentable()
          .accessibilityLabel("\(changes) uncommitted changes")
      }
    }
    .contentShape(Rectangle())
  }
}

struct FileRow: View {
  let file: SharedFile
  let now: Date

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "doc.text")
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(TidePalette.brand)
        .frame(width: 16)
        .widgetAccentable()
      Text(file.name)
        .font(.system(size: 12, weight: .semibold, design: .monospaced))
        .foregroundStyle(TidePalette.foreground)
        .lineLimit(1)
      Text(file.project)
        .font(.system(size: 11))
        .foregroundStyle(TidePalette.muted)
        .lineLimit(1)
      Spacer(minLength: 4)
      Text(tideAgo(file.date, now: now))
        .font(.system(size: 10, weight: .medium).monospacedDigit())
        .foregroundStyle(TidePalette.muted)
    }
    .contentShape(Rectangle())
  }
}

struct TideHairline: View {
  var body: some View {
    Rectangle().fill(TidePalette.border).frame(height: 0.5)
  }
}

struct WidgetHeader: View {
  let title: String
  var trailing: URL? = nil
  var trailingSymbol = "plus"

  var body: some View {
    HStack(spacing: 7) {
      TideMark(size: 18)
      Text(title)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(TidePalette.foreground)
      Spacer(minLength: 0)
      if let trailing {
        TideAction(url: trailing) {
          Image(systemName: trailingSymbol)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(TidePalette.brand)
            .frame(width: 24, height: 24)
            .background(Circle().fill(TidePalette.brand.opacity(0.14)))
            .widgetAccentable()
        }
        .accessibilityLabel(trailingSymbol == "plus" ? "New project" : title)
      }
    }
  }
}

// No projects yet: the mark, a line of explanation and a way to start one.
struct ProjectsEmptyView: View {
  @Environment(\.widgetFamily) private var family

  var body: some View {
    VStack(spacing: family == .systemSmall ? 6 : 8) {
      Spacer(minLength: 0)
      TideMark(size: family == .systemSmall ? 34 : 40)
      Text("No projects yet")
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(TidePalette.foreground)
      Text(family == .systemSmall ? "Tap to start one" : "Start a project or clone a repository, and it shows up here.")
        .font(.system(size: 11))
        .foregroundStyle(TidePalette.muted)
        .multilineTextAlignment(.center)
        .lineLimit(2)
      if family != .systemSmall {
        TideAction(url: TideLinks.newProject) {
          TidePill(title: "New project", symbol: "plus").frame(maxWidth: 160)
        }
        .padding(.top, 2)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity)
  }
}

struct RecentProjectsSmall: View {
  let project: SharedProject
  let now: Date

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top) {
        LanguageBadge(project: project, size: 32)
        Spacer(minLength: 0)
        TideMark(size: 18)
      }
      Spacer(minLength: 6)
      Text("Last opened").tideEyebrow()
      Text(project.name)
        .font(.system(size: 17, weight: .bold))
        .foregroundStyle(TidePalette.foreground)
        .lineLimit(2)
        .minimumScaleFactor(0.75)
        .padding(.top, 1)
      if let git = gitSummary(project, short: true) {
        TideMetaLine(symbol: "arrow.triangle.branch", text: git).padding(.top, 2)
      } else if let opened = project.opened {
        TideMetaLine(symbol: "clock", text: "Edited \(tideAgo(opened, now: now))").padding(.top, 2)
      }
      Spacer(minLength: 6)
      if tideSmallButtonsWork {
        TideAction(url: TideLinks.run(project.name), hideInSmallOnOld: true) {
          TidePill(title: "Run", symbol: "play.fill")
        }
      } else if let opened = project.opened, gitSummary(project, short: true) != nil {
        TideMetaLine(symbol: "clock", text: "Edited \(tideAgo(opened, now: now))")
      }
    }
  }
}

struct RecentProjectsView: View {
  @Environment(\.widgetFamily) var family
  let entry: SharedEntry

  var body: some View {
    let cards = entry.shared.projectCards
    Group {
      if cards.isEmpty {
        ProjectsEmptyView()
      } else if family == .systemSmall {
        RecentProjectsSmall(project: cards[0], now: entry.date)
      } else {
        list(cards)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(widgetLink(cards))
    .tideWidgetBackground()
  }

  private func widgetLink(_ cards: [SharedProject]) -> URL {
    guard let first = cards.first else { return TideLinks.newProject }
    return family == .systemSmall ? projectURL(first.name) : TideLinks.home
  }

  @ViewBuilder
  private func list(_ cards: [SharedProject]) -> some View {
    let large = family == .systemLarge || family == .systemExtraLarge
    let rows = Array(cards.prefix(large ? 4 : 3))
    let files = Array(entry.shared.recentFiles.prefix(4))
    VStack(alignment: .leading, spacing: large ? 8 : 6) {
      WidgetHeader(title: "Recent projects", trailing: TideLinks.newProject)
      ForEach(rows, id: \.name) { project in
        Link(destination: projectURL(project.name)) {
          ProjectRow(project: project, now: entry.date, compact: !large)
        }
      }
      if large && !files.isEmpty {
        TideHairline().padding(.vertical, 2)
        Text("Recent files").tideEyebrow()
        ForEach(files, id: \.self) { file in
          Link(destination: TideLinks.file(file)) {
            FileRow(file: file, now: entry.date)
          }
        }
      }
      Spacer(minLength: 0)
    }
  }
}

struct RecentProjectsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "RecentProjects", provider: SharedProvider(sample: TideSamples.shared)) { entry in
      RecentProjectsView(entry: entry)
    }
    .configurationDisplayName("Recent projects")
    .description("Jump back into your projects, with their branch, changes and recent files.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
