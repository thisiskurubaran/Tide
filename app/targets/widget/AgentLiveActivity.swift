// The AI agent working on a project: its step count and current action, and
// a prominent "waiting for your approval" with a link to answer it.
import ActivityKit
import SwiftUI
import WidgetKit

private func agentTitle(_ state: TideAgentAttributes.ContentState) -> String {
  switch state.status {
  case "approval": return "Needs your approval"
  case "done": return "Agent finished"
  case "failed": return "Agent stopped with an error"
  case "stopped": return "Agent stopped"
  default: return "Agent working"
  }
}

private func agentSymbol(_ state: TideAgentAttributes.ContentState) -> String {
  switch state.status {
  case "working": return "sparkles"
  default: return TideTone(status: state.status).symbol
  }
}

private func stepsLabel(_ steps: Int) -> String {
  "\(steps) step\(steps == 1 ? "" : "s")"
}

// The command waiting for approval, in a code chip.
private struct CommandChip: View {
  let command: String
  var island = false

  var body: some View {
    HStack(spacing: 6) {
      Text("$")
        .foregroundStyle(island ? TidePalette.Island.warning : TidePalette.warning)
      Text(command)
        .foregroundStyle(island ? TidePalette.Island.foreground : TidePalette.foreground)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .font(.system(size: 12, weight: .medium, design: .monospaced))
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill((island ? TidePalette.Island.warning : TidePalette.warning).opacity(0.12))
    )
  }
}

private struct AgentActions: View {
  let context: ActivityViewContext<TideAgentAttributes>
  var island = false

  var body: some View {
    let url = TideLinks.agent(context.attributes.project)
    HStack(spacing: 8) {
      switch context.state.status {
      case "approval":
        ActivityButton(title: "Review command", symbol: "hand.raised.fill", url: url, tint: island ? TidePalette.Island.warning : TidePalette.warning, prominent: true)
      case "done":
        ActivityButton(title: "Review changes", symbol: "doc.text.magnifyingglass", url: url, tint: island ? TidePalette.Island.brand : TidePalette.brand, prominent: true)
      case "working":
        ActivityButton(title: "Open", symbol: "arrow.up.forward.app", url: url, tint: island ? TidePalette.Island.brand : TidePalette.brand)
      default:
        ActivityButton(title: "Open", symbol: "arrow.up.forward.app", url: url, tint: island ? TidePalette.Island.muted : TidePalette.muted)
      }
      Spacer(minLength: 0)
    }
  }
}

struct AgentLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TideAgentAttributes.self) { context in
      let tone = TideTone(status: context.state.status)
      ActivityCard(
        symbol: agentSymbol(context.state),
        tone: tone,
        eyebrow: "Agent · \(context.attributes.project) · \(stepsLabel(context.state.steps))",
        title: agentTitle(context.state),
        detail: context.state.status == "approval" ? context.attributes.prompt : context.state.action,
        start: context.state.startedAt,
        end: context.state.endedAt,
        isStale: context.isStale && context.state.status != "approval"
      ) {
        VStack(alignment: .leading, spacing: 8) {
          if context.state.status == "approval", let command = context.state.command {
            CommandChip(command: command)
          }
          AgentActions(context: context)
        }
      }
      .widgetURL(TideLinks.agent(context.attributes.project))
      .tideActivityChrome()
    } dynamicIsland: { context in
      let tone = TideTone(status: context.state.status)
      let color = tone.islandColor
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ActivityIcon(symbol: agentSymbol(context.state), tint: color, size: 40).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          VStack(alignment: .trailing, spacing: 2) {
            ActivityElapsedLabel(start: context.state.startedAt, end: context.state.endedAt, tint: color, font: .system(size: 15, weight: .semibold).monospacedDigit(), width: 64)
            Text(stepsLabel(context.state.steps))
              .font(.system(size: 10, weight: .medium))
              .foregroundStyle(TidePalette.Island.muted)
          }
          .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(spacing: 1) {
            Text(agentTitle(context.state))
              .font(.system(size: 15, weight: .semibold))
              .foregroundStyle(tone == .running ? TidePalette.Island.foreground : color)
              .lineLimit(1)
            Text(context.attributes.project)
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(TidePalette.Island.muted)
              .lineLimit(1)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 8) {
            if context.state.status == "approval", let command = context.state.command {
              CommandChip(command: command, island: true)
            } else {
              Text(context.state.action)
                .font(.system(size: 12))
                .foregroundStyle(TidePalette.Island.muted)
                .lineLimit(2)
            }
            AgentActions(context: context, island: true)
          }
          .padding(.horizontal, 4)
        }
      } compactLeading: {
        Image(systemName: agentSymbol(context.state)).foregroundStyle(color)
      } compactTrailing: {
        if context.state.status == "approval" {
          Text("Approve?")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(color)
        } else if tone.isFinished {
          Image(systemName: tone.symbol).foregroundStyle(color)
        } else {
          Text("\(context.state.steps)")
            .font(.system(size: 13, weight: .semibold).monospacedDigit())
            .foregroundStyle(color)
        }
      } minimal: {
        Image(systemName: agentSymbol(context.state)).foregroundStyle(color)
      }
      .widgetURL(TideLinks.agent(context.attributes.project))
      .keylineTint(color)
    }
  }
}
