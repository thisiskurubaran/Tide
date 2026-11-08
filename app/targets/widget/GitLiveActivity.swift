// A git clone, pull or push, on the Lock Screen and in the Dynamic Island.
import ActivityKit
import SwiftUI
import WidgetKit

private func gitVerb(_ operation: String, _ status: String) -> String {
  switch (operation, status) {
  case ("clone", "running"): return "Cloning"
  case ("pull", "running"): return "Pulling"
  case ("push", "running"): return "Pushing"
  case ("clone", "done"): return "Cloned"
  case ("pull", "done"): return "Pulled"
  case ("push", "done"): return "Pushed"
  case ("clone", _): return "Clone failed"
  case ("pull", _): return "Pull failed"
  case ("push", _): return "Push failed"
  default: return status == "running" ? "Syncing" : status == "done" ? "Done" : "Failed"
  }
}

private func gitSymbol(_ operation: String, _ status: String) -> String {
  if status != "running" { return TideTone(status: status).symbol }
  switch operation {
  case "push": return "arrow.up.circle.fill"
  case "pull": return "arrow.down.circle.fill"
  default: return "square.and.arrow.down.fill"
  }
}

// "Receiving objects · 54/120", or the detail alone.
private func gitDetail(_ state: TideGitAttributes.ContentState) -> String {
  guard state.status == "running", !state.phase.isEmpty else { return state.detail }
  return state.detail.isEmpty ? state.phase : "\(state.phase) · \(state.detail)"
}

private func gitEyebrow(_ attributes: TideGitAttributes) -> String {
  attributes.remote.isEmpty ? "git · \(attributes.project)" : attributes.remote
}

struct GitLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TideGitAttributes.self) { context in
      let tone = TideTone(status: context.state.status)
      ActivityCard(
        symbol: gitSymbol(context.attributes.operation, context.state.status),
        tone: tone,
        eyebrow: gitEyebrow(context.attributes),
        title: "\(gitVerb(context.attributes.operation, context.state.status)) \(context.attributes.project)",
        detail: gitDetail(context.state),
        progress: context.state.progress,
        start: context.state.startedAt,
        end: context.state.endedAt,
        isStale: context.isStale
      ) {
        if tone.isFinished {
          HStack(spacing: 8) {
            ActivityButton(title: "Open project", symbol: "arrow.up.forward.app", url: projectURL(context.attributes.project), prominent: tone == .success)
            Spacer(minLength: 0)
          }
        }
      }
      .widgetURL(projectURL(context.attributes.project))
      .tideActivityChrome()
    } dynamicIsland: { context in
      let tone = TideTone(status: context.state.status)
      let color = tone.islandColor
      let symbol = gitSymbol(context.attributes.operation, context.state.status)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ActivityIcon(symbol: symbol, tint: color, size: 40).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          ActivityElapsedLabel(start: context.state.startedAt, end: context.state.endedAt, tint: color, font: .system(size: 15, weight: .semibold).monospacedDigit(), width: 64)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(spacing: 1) {
            Text("\(gitVerb(context.attributes.operation, context.state.status)) \(context.attributes.project)")
              .font(.system(size: 15, weight: .semibold))
              .foregroundStyle(tone.isFinished ? color : TidePalette.Island.foreground)
              .lineLimit(1)
            Text(gitEyebrow(context.attributes))
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(TidePalette.Island.muted)
              .lineLimit(1)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 8) {
            Text(gitDetail(context.state))
              .font(.system(size: 12))
              .foregroundStyle(TidePalette.Island.muted)
              .lineLimit(1)
            if let progress = context.state.progress {
              ActivityProgressBar(progress: progress, tint: color, track: TidePalette.Island.track)
            }
          }
          .padding(.horizontal, 4)
        }
      } compactLeading: {
        Image(systemName: symbol).foregroundStyle(color)
      } compactTrailing: {
        if let progress = context.state.progress, !tone.isFinished {
          Text(verbatim: "\(Int(progress * 100))%")
            .font(.system(size: 13, weight: .semibold).monospacedDigit())
            .foregroundStyle(color)
        } else if tone.isFinished {
          Image(systemName: tone.symbol).foregroundStyle(color)
        } else {
          ActivityElapsedLabel(start: context.state.startedAt, end: context.state.endedAt, tint: color, width: 44)
        }
      } minimal: {
        ActivityRing(progress: tone.isFinished ? 1 : context.state.progress, symbol: symbol, tint: color)
      }
      .widgetURL(projectURL(context.attributes.project))
      .keylineTint(color)
    }
  }
}
