// A deploy in progress, on the Lock Screen and in the Dynamic Island.
import ActivityKit
import SwiftUI
import WidgetKit

private func deployTone(_ state: String) -> TideTone {
  switch state {
  case "done": return .success
  case "failed": return .failure
  default: return .running
  }
}

private func deploySymbol(_ state: String) -> String {
  state == "deploying" ? "icloud.and.arrow.up.fill" : deployTone(state).symbol
}

private func deployTitle(_ state: String) -> String {
  switch state {
  case "done": return "Deployed"
  case "failed": return "Deploy failed"
  default: return "Deploying"
  }
}

// The site's address without the scheme, for the detail line.
private func shortURL(_ url: String?) -> String? {
  guard let url, !url.isEmpty else { return nil }
  return url.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "")
}

private struct DeployActions: View {
  let context: ActivityViewContext<TideDeployAttributes>
  var island = false

  var body: some View {
    let tint = island ? TidePalette.Island.brand : TidePalette.brand
    HStack(spacing: 8) {
      if context.state.state == "done", let link = context.state.url, let url = URL(string: link) {
        ActivityButton(title: "Visit site", symbol: "safari", url: url, tint: tint, prominent: true)
      }
      ActivityButton(title: context.state.state == "failed" ? "See why" : "Open", symbol: "arrow.up.forward.app", url: TideLinks.deploy(context.attributes.project), tint: tint)
      Spacer(minLength: 0)
    }
  }
}

struct DeployLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TideDeployAttributes.self) { context in
      let state = context.state.state
      // Deploys don't report when they started, so there's no timer.
      ActivityCard(
        symbol: deploySymbol(state),
        tone: deployTone(state),
        eyebrow: "\(context.attributes.provider) · \(context.attributes.project)",
        title: deployTitle(state),
        detail: state == "done" ? (shortURL(context.state.url) ?? context.state.message) : context.state.message,
        start: nil,
        end: nil,
        isStale: context.isStale
      ) {
        if state != "deploying" { DeployActions(context: context) }
      }
      .widgetURL(TideLinks.deploy(context.attributes.project))
      .tideActivityChrome()
    } dynamicIsland: { context in
      let state = context.state.state
      let tone = deployTone(state)
      let color = tone.islandColor
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ActivityIcon(symbol: deploySymbol(state), tint: color, size: 40).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.attributes.provider)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(TidePalette.Island.muted)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(spacing: 1) {
            Text(deployTitle(state))
              .font(.system(size: 15, weight: .semibold))
              .foregroundStyle(tone.isFinished ? color : TidePalette.Island.foreground)
            Text(context.attributes.project)
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(TidePalette.Island.muted)
              .lineLimit(1)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 8) {
            Text(state == "done" ? (shortURL(context.state.url) ?? context.state.message) : context.state.message)
              .font(.system(size: 12))
              .foregroundStyle(TidePalette.Island.muted)
              .lineLimit(1)
            if state != "deploying" { DeployActions(context: context, island: true) }
          }
          .padding(.horizontal, 4)
        }
      } compactLeading: {
        Image(systemName: deploySymbol(state)).foregroundStyle(color)
      } compactTrailing: {
        if state == "deploying" {
          Image(systemName: "ellipsis").foregroundStyle(color)
        } else {
          Image(systemName: tone.symbol).foregroundStyle(color)
        }
      } minimal: {
        Image(systemName: deploySymbol(state)).foregroundStyle(color)
      }
      .widgetURL(TideLinks.deploy(context.attributes.project))
      .keylineTint(color)
    }
  }
}
