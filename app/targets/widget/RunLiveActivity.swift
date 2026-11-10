// A dev server, test run or task, on the Lock Screen and in the Dynamic Island.
import ActivityKit
import SwiftUI
import WidgetKit

private func kindLabel(_ kind: String) -> String {
  switch kind {
  case "server": return "Dev server"
  case "tests": return "Tests"
  default: return "Task"
  }
}

private func kindSymbol(_ kind: String) -> String {
  switch kind {
  case "server": return "server.rack"
  case "tests": return "checklist"
  default: return "terminal.fill"
  }
}

// The headline: what's happening, or how it ended.
private func headline(_ attributes: TideRunAttributes, _ state: TideRunAttributes.ContentState) -> String {
  switch (attributes.kind, state.status) {
  case ("server", "running"): return "Running"
  case ("tests", "running"): return "Running tests"
  case (_, "running"): return attributes.command
  case ("tests", "passed"): return "Tests passed"
  case ("tests", "failed"): return "Tests failed"
  case ("server", "failed"): return "Server crashed"
  case (_, "passed"): return "Finished"
  case (_, "failed"): return "Failed"
  default: return "Stopped"
  }
}

// What VoiceOver says for the Dynamic Island's glyphs: what's happening, or
// how it ended.
private func runSpoken(_ attributes: TideRunAttributes, _ state: TideRunAttributes.ContentState) -> String {
  guard state.status == "running" else { return "\(headline(attributes, state)), \(attributes.project)" }
  switch attributes.kind {
  case "server": return "Dev server running, \(attributes.project)"
  case "tests": return "Running tests, \(attributes.project)"
  default: return "Running \(attributes.command), \(attributes.project)"
  }
}

private func runSymbol(_ attributes: TideRunAttributes, _ state: TideRunAttributes.ContentState) -> String {
  let tone = TideTone(status: state.status)
  return tone == .running ? kindSymbol(attributes.kind) : tone.symbol
}

private struct RunActions: View {
  let context: ActivityViewContext<TideRunAttributes>
  var island = false

  var body: some View {
    let tint = island ? TidePalette.Island.brand : TidePalette.brand
    HStack(spacing: 8) {
      if context.state.status == "running" {
        // A link rather than a Live Activity intent: stopping needs the app's
        // process, which the link opens.
        ActivityButton(title: "Stop", symbol: "stop.fill", url: TideLinks.stop(context.attributes.project), tint: island ? TidePalette.Island.danger : TidePalette.danger)
        ActivityButton(title: "Open", symbol: "arrow.up.forward.app", url: projectURL(context.attributes.project), tint: tint)
      } else {
        let again = context.attributes.kind == "tests" ? TideLinks.tests(context.attributes.project) : TideLinks.run(context.attributes.project)
        ActivityButton(title: "Run again", symbol: "arrow.clockwise", url: again, tint: tint, prominent: true)
        ActivityButton(title: "Open", symbol: "arrow.up.forward.app", url: projectURL(context.attributes.project), tint: tint)
      }
      Spacer(minLength: 0)
    }
  }
}

struct RunLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TideRunAttributes.self) { context in
      let tone = TideTone(status: context.state.status)
      ActivityCard(
        symbol: runSymbol(context.attributes, context.state),
        tone: tone,
        eyebrow: "\(kindLabel(context.attributes.kind)) · \(context.attributes.project)",
        title: headline(context.attributes, context.state),
        detail: context.state.detail,
        progress: context.state.progress,
        start: context.state.startedAt,
        end: context.state.endedAt,
        isStale: context.isStale
      ) {
        RunActions(context: context)
      }
      .widgetURL(projectURL(context.attributes.project))
      .tideActivityChrome()
    } dynamicIsland: { context in
      let tone = TideTone(status: context.state.status)
      let color = tone.islandColor
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ActivityIcon(symbol: runSymbol(context.attributes, context.state), tint: color, size: 40)
            .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          ActivityElapsedLabel(start: context.state.startedAt, end: context.state.endedAt, tint: color, font: .subheadline.weight(.semibold).monospacedDigit(), width: 64)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(spacing: 1) {
            Text(headline(context.attributes, context.state))
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(tone.isFinished ? color : TidePalette.Island.foreground)
              .lineLimit(1)
            Text("\(kindLabel(context.attributes.kind)) · \(context.attributes.project)")
              .font(.caption2.weight(.medium))
              .foregroundStyle(TidePalette.Island.muted)
              .lineLimit(1)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 8) {
            Text(context.state.detail)
              .font(.caption)
              .foregroundStyle(TidePalette.Island.muted)
              .lineLimit(1)
            if let progress = context.state.progress {
              ActivityProgressBar(progress: progress, tint: color, track: TidePalette.Island.track)
            }
            RunActions(context: context, island: true)
          }
          .padding(.horizontal, 4)
        }
      } compactLeading: {
        Image(systemName: runSymbol(context.attributes, context.state))
          .font(.footnote.weight(.semibold))
          .foregroundStyle(color)
          .accessibilityLabel(runSpoken(context.attributes, context.state))
      } compactTrailing: {
        if let progress = context.state.progress, !tone.isFinished {
          Text(verbatim: "\(Int(progress * 100))%")
            .font(.footnote.weight(.semibold).monospacedDigit())
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .accessibilityLabel("\(Int(progress * 100)) percent")
        } else if tone.isFinished {
          Image(systemName: tone.symbol)
            .foregroundStyle(color)
            .accessibilityLabel(headline(context.attributes, context.state))
        } else {
          ActivityElapsedLabel(start: context.state.startedAt, end: context.state.endedAt, tint: color, width: 44)
        }
      } minimal: {
        ActivityRing(progress: tone.isFinished ? 1 : context.state.progress, symbol: tone.isFinished ? tone.symbol : kindSymbol(context.attributes.kind), tint: color)
          .accessibilityLabel(runSpoken(context.attributes, context.state))
      }
      .widgetURL(projectURL(context.attributes.project))
      .keylineTint(color)
    }
  }
}
