// A dev server, test run or task, on the Lock Screen and in the Dynamic Island.
import ActivityKit
import SwiftUI
import WidgetKit

private let teal = Color(red: 45 / 255, green: 212 / 255, blue: 191 / 255) // #2dd4bf
private let sky = Color(red: 14 / 255, green: 165 / 255, blue: 233 / 255) // #0ea5e9

// The Tide mark, as on the Recent Projects widget.
private struct TideLogo: View {
  var body: some View {
    Image(systemName: "chevron.left.forwardslash.chevron.right").foregroundStyle(Color.accentColor)
  }
}

private func statusColor(_ status: String) -> Color {
  switch status {
  case "passed": return .green
  case "failed": return .red
  case "stopped": return .secondary
  default: return teal
  }
}

private func kindLabel(_ kind: String) -> String {
  switch kind {
  case "server": return "Dev server"
  case "tests": return "Tests"
  default: return "Task"
  }
}

private func runTitle(_ context: ActivityViewContext<TideRunAttributes>) -> String {
  "\(kindLabel(context.attributes.kind)) · \(context.attributes.project)"
}

private func stopURL(_ project: String) -> URL {
  URL(string: projectURL(project).absoluteString + "?stop=1")!
}

// Counts up while the run is going, and stops where it ended.
private struct RunTimer: View {
  let state: TideRunAttributes.ContentState

  var body: some View {
    if let end = state.endedAt {
      Text(timerInterval: state.startedAt...max(end, state.startedAt), pauseTime: end, countsDown: false)
    } else {
      Text(timerInterval: state.startedAt...Date.distantFuture, countsDown: false)
    }
  }
}

private struct StatusDot: View {
  let status: String

  var body: some View {
    Circle().fill(statusColor(status)).frame(width: 8, height: 8)
  }
}

private struct RunProgressBar: View {
  let progress: Double

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(Color.secondary.opacity(0.25))
        Capsule()
          .fill(LinearGradient(colors: [sky, teal], startPoint: .leading, endPoint: .trailing))
          .frame(width: geo.size.width * min(max(progress, 0), 1))
      }
    }
    .frame(height: 4)
  }
}

private struct RunButton: View {
  let title: String
  let symbol: String
  let url: URL

  var body: some View {
    Link(destination: url) {
      Label(title, systemImage: symbol)
        .font(.caption.weight(.semibold))
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Capsule().fill(Color.secondary.opacity(0.2)))
    }
  }
}

private struct RunButtons: View {
  let context: ActivityViewContext<TideRunAttributes>

  var body: some View {
    HStack(spacing: 8) {
      RunButton(title: "Open", symbol: "arrow.up.forward.app", url: projectURL(context.attributes.project))
      // A link rather than a Live Activity intent: stopping needs the app's
      // process, which the link opens.
      if context.state.status == "running" {
        RunButton(title: "Stop", symbol: "stop.fill", url: stopURL(context.attributes.project))
      }
    }
  }
}

struct RunLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TideRunAttributes.self) { context in
      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 12) {
          TideLogo().font(.title2)
          VStack(alignment: .leading, spacing: 2) {
            Text(runTitle(context)).font(.headline).lineLimit(1)
            Text(context.state.detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
          }
          Spacer(minLength: 0)
          RunTimer(state: context.state)
            .font(.subheadline.monospacedDigit())
            .foregroundStyle(teal)
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: 72, alignment: .trailing)
        }
        if let progress = context.state.progress {
          RunProgressBar(progress: progress)
        }
        RunButtons(context: context)
      }
      .padding()
      .widgetURL(projectURL(context.attributes.project))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          TideLogo()
        }
        DynamicIslandExpandedRegion(.trailing) {
          HStack(spacing: 6) {
            StatusDot(status: context.state.status)
            RunTimer(state: context.state)
              .font(.caption.monospacedDigit())
              .foregroundStyle(teal)
              .frame(maxWidth: 56, alignment: .trailing)
          }
        }
        DynamicIslandExpandedRegion(.center) {
          Text(runTitle(context)).font(.subheadline).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 6) {
            Text(context.state.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            if let progress = context.state.progress {
              RunProgressBar(progress: progress)
            }
            RunButtons(context: context)
          }
        }
      } compactLeading: {
        TideLogo()
      } compactTrailing: {
        RunTimer(state: context.state)
          .font(.caption2.monospacedDigit())
          .foregroundStyle(teal)
          .frame(maxWidth: 44)
      } minimal: {
        TideLogo()
      }
      .widgetURL(projectURL(context.attributes.project))
    }
  }
}
