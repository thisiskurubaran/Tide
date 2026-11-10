// npm or pip installing, updating or removing packages, on the Lock Screen and
// in the Dynamic Island.
import ActivityKit
import SwiftUI
import WidgetKit

private func installTitle(_ attributes: TideInstallAttributes, _ state: TideInstallAttributes.ContentState) -> String {
  switch state.status {
  case "done": return "Packages updated"
  case "failed": return "\(attributes.tool) failed"
  default: return attributes.packages
  }
}

// What VoiceOver says for the Dynamic Island's glyphs.
private func installSpoken(_ attributes: TideInstallAttributes, _ state: TideInstallAttributes.ContentState) -> String {
  state.status == "running" ? "\(attributes.tool) running, \(attributes.packages)" : installTitle(attributes, state)
}

private func installSymbol(_ state: TideInstallAttributes.ContentState) -> String {
  state.status == "running" ? "shippingbox.fill" : TideTone(status: state.status).symbol
}

struct InstallLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TideInstallAttributes.self) { context in
      ActivityCard(
        symbol: installSymbol(context.state),
        tone: TideTone(status: context.state.status),
        eyebrow: "\(context.attributes.tool) · \(context.attributes.project)",
        title: installTitle(context.attributes, context.state),
        detail: context.state.detail,
        start: context.state.startedAt,
        end: context.state.endedAt,
        isStale: context.isStale
      ) {
        EmptyView()
      }
      .widgetURL(projectURL(context.attributes.project))
      .tideActivityChrome()
    } dynamicIsland: { context in
      let tone = TideTone(status: context.state.status)
      let color = tone.islandColor
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ActivityIcon(symbol: installSymbol(context.state), tint: color, size: 40).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          ActivityElapsedLabel(start: context.state.startedAt, end: context.state.endedAt, tint: color, font: .subheadline.weight(.semibold).monospacedDigit(), width: 64)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(spacing: 1) {
            Text(installTitle(context.attributes, context.state))
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(tone.isFinished ? color : TidePalette.Island.foreground)
              .lineLimit(1)
            Text("\(context.attributes.tool) · \(context.attributes.project)")
              .font(.caption2.weight(.medium))
              .foregroundStyle(TidePalette.Island.muted)
              .lineLimit(1)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.state.detail)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(TidePalette.Island.muted)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
        }
      } compactLeading: {
        Image(systemName: installSymbol(context.state))
          .foregroundStyle(color)
          .accessibilityLabel(installSpoken(context.attributes, context.state))
      } compactTrailing: {
        if tone.isFinished {
          Image(systemName: tone.symbol)
            .foregroundStyle(color)
            .accessibilityLabel(installTitle(context.attributes, context.state))
        } else {
          ActivityElapsedLabel(start: context.state.startedAt, end: context.state.endedAt, tint: color, width: 44)
        }
      } minimal: {
        Image(systemName: installSymbol(context.state))
          .foregroundStyle(color)
          .accessibilityLabel(installSpoken(context.attributes, context.state))
      }
      .widgetURL(projectURL(context.attributes.project))
      .keylineTint(color)
    }
  }
}
