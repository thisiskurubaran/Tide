// A deploy in progress, on the Lock Screen and in the Dynamic Island.
import ActivityKit
import SwiftUI
import WidgetKit

private func symbol(_ state: String) -> String {
  switch state {
  case "done": return "checkmark.circle.fill"
  case "failed": return "xmark.octagon.fill"
  default: return "icloud.and.arrow.up"
  }
}

private func color(_ state: String) -> Color {
  switch state {
  case "done": return .green
  case "failed": return .red
  default: return .accentColor
  }
}

private func title(_ state: String) -> String {
  switch state {
  case "done": return "Deployed"
  case "failed": return "Deploy failed"
  default: return "Deploying"
  }
}

struct DeployLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TideDeployAttributes.self) { context in
      HStack(spacing: 12) {
        Image(systemName: symbol(context.state.state)).font(.title2).foregroundStyle(color(context.state.state))
        VStack(alignment: .leading, spacing: 2) {
          Text("\(title(context.state.state)) \(context.attributes.project)").font(.headline).lineLimit(1)
          Text(context.state.url ?? context.state.message).font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }
        Spacer(minLength: 0)
        Text(context.attributes.provider).font(.caption2).foregroundStyle(.secondary)
      }
      .padding()
      .widgetURL(URL(string: "tide://deploy?project=\(context.attributes.project.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+?#"))) ?? "")"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: symbol(context.state.state)).foregroundStyle(color(context.state.state))
        }
        DynamicIslandExpandedRegion(.center) {
          Text("\(title(context.state.state)) \(context.attributes.project)").font(.subheadline).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.state.url ?? context.state.message).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
      } compactLeading: {
        Image(systemName: symbol(context.state.state)).foregroundStyle(color(context.state.state))
      } compactTrailing: {
        Text(context.state.state == "deploying" ? "…" : context.state.state == "done" ? "✓" : "!")
      } minimal: {
        Image(systemName: symbol(context.state.state)).foregroundStyle(color(context.state.state))
      }
    }
  }
}
