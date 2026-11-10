// Lock Screen (and StandBy / watch-style) accessory widgets: the last project
// with its branch and last run (rectangular), the last run's result
// (circular), and a one-line summary above the clock (inline). Tapping the
// last run opens its project with the output showing; it never runs anything
// (Run Last Again in Shortcuts does that, after asking).
import SwiftUI
import WidgetKit

private struct AccessoryRectangularView: View {
  let entry: SharedEntry

  var body: some View {
    if let project = entry.shared.lastProject {
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 4) {
          Image(systemName: "chevron.left.forwardslash.chevron.right")
            .font(.caption2.weight(.bold))
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
          // Fixed size: the glyph has to share the small circle with its label
          // at every text size.
          Image(systemName: TideTone(status: run.status).symbol)
            .font(.system(size: 20, weight: .semibold))
            .widgetAccentable()
          Text(run.kind == "tests" ? "TESTS" : run.kind == "server" ? "DEV" : "RUN")
            .font(.caption2.weight(.bold))
            .lineLimit(1)
            .minimumScaleFactor(0.5)
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(runTitle(run)) in \(run.project)")
        .accessibilityHint("Opens the project with the output showing")
      } else {
        // Fixed size: the glyph is drawn to fill the small circle.
        Image(systemName: "chevron.left.forwardslash.chevron.right")
          .font(.system(size: 18, weight: .bold))
          .widgetAccentable()
          .accessibilityLabel("Tide")
      }
    }
    // Opens the run's output; tapping a widget shouldn't start anything.
    .widgetURL(entry.shared.lastRun.map { TideLinks.output($0.project) } ?? TideLinks.home)
  }
}

private struct AccessoryInlineView: View {
  let entry: SharedEntry

  var body: some View {
    if let run = entry.shared.lastRun {
      Label("\(run.project) · \(runTitle(run))", systemImage: TideTone(status: run.status).symbol)
        .widgetURL(TideLinks.output(run.project))
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
