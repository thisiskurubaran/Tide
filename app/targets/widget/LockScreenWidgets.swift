// Lock Screen (and StandBy / watch-style) accessory widgets: the last project
// with its branch and last run (rectangular), the last run's result
// (circular), and a one-line summary above the clock (inline).
import SwiftUI
import WidgetKit

private struct AccessoryRectangularView: View {
  let entry: SharedEntry

  var body: some View {
    if let project = entry.shared.lastProject {
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 4) {
          Image(systemName: "chevron.left.forwardslash.chevron.right")
            .font(.system(size: 11, weight: .bold))
            .widgetAccentable()
          Text(project.name)
            .font(.headline)
            .lineLimit(1)
            .widgetAccentable()
        }
        if let git = gitSummary(project) {
          Label(git, systemImage: "arrow.triangle.branch")
            .font(.caption)
            .lineLimit(1)
        } else if let language = project.language {
          Text(language).font(.caption).lineLimit(1)
        }
        if let run = entry.shared.lastRun, run.project == project.name {
          Label("\(runTitle(run)) · \(tideAgo(run.ended, now: entry.date))", systemImage: TideTone(status: run.status).symbol)
            .font(.caption)
            .lineLimit(1)
        } else if let opened = project.opened {
          Label("Edited \(tideAgo(opened, now: entry.date))", systemImage: "clock")
            .font(.caption)
            .lineLimit(1)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .widgetURL(projectURL(project.name))
    } else {
      VStack(alignment: .leading, spacing: 1) {
        Text("Tide").font(.headline).widgetAccentable()
        Text("No projects yet").font(.caption)
        Text("Tap to start one").font(.caption)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .widgetURL(TideLinks.newProject)
    }
  }
}

private struct AccessoryCircularView: View {
  let entry: SharedEntry

  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      if let run = entry.shared.lastRun {
        VStack(spacing: 0) {
          Image(systemName: TideTone(status: run.status).symbol)
            .font(.system(size: 20, weight: .semibold))
            .widgetAccentable()
          Text(run.kind == "tests" ? "TESTS" : run.kind == "server" ? "DEV" : "RUN")
            .font(.system(size: 8, weight: .bold))
        }
        .accessibilityLabel("\(runTitle(run)) in \(run.project)")
      } else {
        Image(systemName: "chevron.left.forwardslash.chevron.right")
          .font(.system(size: 18, weight: .bold))
          .widgetAccentable()
          .accessibilityLabel("Tide")
      }
    }
    .widgetURL(entry.shared.lastRun.map { TideLinks.rerun($0) } ?? TideLinks.home)
  }
}

private struct AccessoryInlineView: View {
  let entry: SharedEntry

  var body: some View {
    if let run = entry.shared.lastRun {
      Label("\(run.project) · \(runTitle(run))", systemImage: TideTone(status: run.status).symbol)
        .widgetURL(projectURL(run.project))
    } else if let project = entry.shared.lastProject {
      Label(gitSummary(project).map { "\(project.name) · \($0)" } ?? project.name, systemImage: "chevron.left.forwardslash.chevron.right")
        .widgetURL(projectURL(project.name))
    } else {
      Label("Tide", systemImage: "chevron.left.forwardslash.chevron.right")
    }
  }
}

struct LockScreenView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SharedEntry

  var body: some View {
    Group {
      switch family {
      case .accessoryCircular: AccessoryCircularView(entry: entry)
      case .accessoryInline: AccessoryInlineView(entry: entry)
      default: AccessoryRectangularView(entry: entry)
      }
    }
    .containerBackground(for: .widget) { Color.clear }
  }
}

struct LockScreenWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "TideLockScreen", provider: SharedProvider(sample: TideSamples.shared)) { entry in
      LockScreenView(entry: entry)
    }
    .configurationDisplayName("Tide")
    .description("Your last project and how its last run went.")
    .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline])
  }
}
