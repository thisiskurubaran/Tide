// The last dev server, test run or task: passed or failed, the exit code, how
// long it took and in which project, with Run again.
import SwiftUI
import WidgetKit

func runTitle(_ run: SharedRun) -> String {
  switch (run.kind, run.status) {
  case ("tests", "passed"): return "Tests passed"
  case ("tests", "failed"): return "Tests failed"
  case ("tests", _): return "Tests stopped"
  case ("server", "failed"): return "Server crashed"
  case ("server", _): return "Server stopped"
  case (_, "passed"): return "Finished"
  case (_, "failed"): return "Failed"
  default: return "Stopped"
  }
}

// "exit 1 · 12.4s"
func runMeta(_ run: SharedRun) -> String {
  var parts: [String] = []
  if let code = run.exitCode { parts.append("exit \(code)") }
  parts.append(tideDuration(run.duration))
  return parts.joined(separator: " · ")
}

private struct StatusGlyph: View {
  let tone: TideTone
  var size: CGFloat = 30

  var body: some View {
    // Fixed size: the glyph is drawn to fit its circle, sized by the caller.
    Image(systemName: tone.symbol)
      .font(.system(size: size * 0.55, weight: .semibold))
      .foregroundStyle(tone.color)
      .frame(width: size, height: size)
      .background(Circle().fill(tone.color.opacity(0.15)))
      .widgetAccentable()
  }
}

private struct NoRunView: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        StatusGlyph(tone: .stopped)
        Spacer(minLength: 0)
        TideMark(size: 18)
      }
      Spacer(minLength: 4)
      Text("No runs yet")
        .font(.subheadline.weight(.bold))
        .foregroundStyle(TidePalette.foreground)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      Text("Run a project or its tests in Tide, and the result shows up here.")
        .font(.caption2)
        .foregroundStyle(TidePalette.muted)
        .lineLimit(3)
      Spacer(minLength: 0)
    }
  }
}

private struct LastRunSmall: View {
  let run: SharedRun
  let now: Date

  var body: some View {
    let tone = TideTone(status: run.status)
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top) {
        StatusGlyph(tone: tone)
        Spacer(minLength: 0)
        Text(tideAgo(run.ended, now: now))
          .font(.caption2.weight(.medium).monospacedDigit())
          .foregroundStyle(TidePalette.muted)
          .lineLimit(1)
      }
      Spacer(minLength: 4)
      Text(runTitle(run))
        .font(.callout.weight(.bold))
        .foregroundStyle(tone.color)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .widgetAccentable()
      Text(run.project)
        .font(.footnote.weight(.semibold))
        .foregroundStyle(TidePalette.foreground)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      Text(run.detail)
        .font(.caption2)
        .foregroundStyle(TidePalette.muted)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      Spacer(minLength: 4)
      if tideSmallButtonsWork {
        TideAction(url: TideLinks.rerun(run), hideInSmallOnOld: true) {
          TidePill(title: "Run again", symbol: "arrow.clockwise")
        }
      } else {
        Text(runMeta(run))
          .font(.system(.caption2, design: .monospaced, weight: .medium))
          .foregroundStyle(TidePalette.muted)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
    }
  }
}

private struct LastRunMedium: View {
  let run: SharedRun
  let now: Date

  var body: some View {
    let tone = TideTone(status: run.status)
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 6) {
        StatusGlyph(tone: tone, size: 40)
        Spacer(minLength: 0)
        Text(runTitle(run))
          .font(.headline.weight(.bold))
          .foregroundStyle(tone.color)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
          .widgetAccentable()
        Text(tideAgo(run.ended, now: now))
          .font(.caption2.weight(.medium))
          .foregroundStyle(TidePalette.muted)
          .lineLimit(1)
      }
      .frame(width: 112, alignment: .leading)

      VStack(alignment: .leading, spacing: 5) {
        HStack(spacing: 6) {
          Text(run.project)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(TidePalette.foreground)
            .lineLimit(1)
          Spacer(minLength: 0)
          TideMark(size: 16)
        }
        Text(run.detail)
          .font(.caption)
          .foregroundStyle(TidePalette.foreground.opacity(0.85))
          .lineLimit(2)
        HStack(spacing: 6) {
          Text("$ \(run.command)")
            .lineLimit(1)
            .truncationMode(.middle)
          Spacer(minLength: 0)
          Text(runMeta(run))
        }
        .font(.system(.caption2, design: .monospaced, weight: .medium))
        .foregroundStyle(TidePalette.muted)
        Spacer(minLength: 0)
        HStack(spacing: 8) {
          Link(destination: TideLinks.rerun(run)) {
            TidePill(title: "Run again", symbol: "arrow.clockwise")
          }
          Link(destination: projectURL(run.project)) {
            TidePill(title: "Open", symbol: "arrow.up.forward", prominent: false)
          }
        }
      }
    }
  }
}

struct LastRunView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SharedEntry

  var body: some View {
    Group {
      if let run = entry.shared.lastRun {
        if family == .systemSmall {
          LastRunSmall(run: run, now: entry.date)
        } else {
          LastRunMedium(run: run, now: entry.date)
        }
      } else {
        NoRunView()
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    // Tapping outside the buttons shows the run's output; only Run again runs.
    .widgetURL(entry.shared.lastRun.map { TideLinks.output($0.project) } ?? TideLinks.home)
    .tideWidgetBackground()
  }
}

struct LastRunWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "LastRun", provider: SharedProvider(sample: TideSamples.shared)) { entry in
      LastRunView(entry: entry)
    }
    .configurationDisplayName("Last run")
    .description("How your last run or test run went, with Run again.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
