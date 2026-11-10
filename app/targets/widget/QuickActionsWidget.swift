// Quick actions: new project, open the last project, run it, and search.
// Medium on iOS 17 and later (each tile is a Link); small too on iOS 18, whose
// tiles are buttons running OpenTideLinkIntent.
import SwiftUI
import WidgetKit

private struct QuickTile: View {
  @Environment(\.widgetFamily) private var family
  let title: String
  let symbol: String
  let tint: Color
  var enabled = true
  var a11yLabel: String? = nil
  var a11yHint: String? = nil

  var body: some View {
    let small = family == .systemSmall
    VStack(spacing: small ? 4 : 6) {
      // Fixed size: the glyph is drawn to fit its fixed circle.
      Image(systemName: symbol)
        .font(.system(size: small ? 15 : 17, weight: .semibold))
        .foregroundStyle(enabled ? tint : TidePalette.muted)
        .frame(width: small ? 30 : 36, height: small ? 30 : 36)
        .background(Circle().fill((enabled ? tint : TidePalette.muted).opacity(0.15)))
        .widgetAccentable()
      Text(title)
        .font(.caption2.weight(.semibold))
        .foregroundStyle(enabled ? TidePalette.foreground : TidePalette.muted)
        .multilineTextAlignment(.center)
        .lineLimit(2)
        .minimumScaleFactor(0.7)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(
      RoundedRectangle(cornerRadius: small ? 14 : 16, style: .continuous)
        .fill(TidePalette.foreground.opacity(0.05))
    )
    .overlay(
      RoundedRectangle(cornerRadius: small ? 14 : 16, style: .continuous)
        .strokeBorder(TidePalette.border, lineWidth: 0.5)
    )
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityLabel(a11yLabel ?? title)
    .accessibilityHint(a11yHint ?? "")
  }
}

struct QuickActionItem {
  let title: String
  let symbol: String
  let tint: Color
  let url: URL
  let enabled: Bool
  var a11yLabel: String? = nil
  var a11yHint: String? = nil

  static func all(last: SharedProject?) -> [QuickActionItem] {
    var openURL = TideLinks.home
    var runURL = TideLinks.home
    if let last {
      openURL = projectURL(last.name)
      runURL = TideLinks.run(last.name)
    }
    let newItem = QuickActionItem(title: "New", symbol: "plus", tint: TidePalette.brand, url: TideLinks.newProject, enabled: true)
    let openItem = QuickActionItem(title: last == nil ? "Open Tide" : "Open", symbol: "folder.fill", tint: TidePalette.info, url: openURL, enabled: true)
    // With no project there's nothing to run: the tile says so in words and
    // with a different symbol, not only by turning grey, and still opens Tide.
    let runItem = last == nil
      ? QuickActionItem(
        title: "No project yet", symbol: "play.slash.fill", tint: TidePalette.success, url: runURL, enabled: false,
        a11yLabel: "Run, no project yet", a11yHint: "Opens Tide. Start a project there to run it from here."
      )
      : QuickActionItem(title: "Run", symbol: "play.fill", tint: TidePalette.success, url: runURL, enabled: true)
    let searchItem = QuickActionItem(title: "Search", symbol: "magnifyingglass", tint: TidePalette.warning, url: TideLinks.search, enabled: true)
    return [newItem, openItem, runItem, searchItem]
  }
}

struct QuickActionsView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SharedEntry

  var body: some View {
    let last = entry.shared.lastProject
    let tiles: [QuickActionItem] = QuickActionItem.all(last: last)
    VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 10) {
      if family != .systemSmall {
        HStack(spacing: 7) {
          TideMark(size: 18)
          Text("Tide").font(.footnote.weight(.semibold)).foregroundStyle(TidePalette.foreground).lineLimit(1)
          Spacer(minLength: 4)
          if let last {
            TideMetaLine(symbol: "clock.arrow.circlepath", text: last.name)
          }
        }
      }
      if family == .systemSmall {
        Grid(horizontalSpacing: 6, verticalSpacing: 6) {
          GridRow {
            tile(tiles[0])
            tile(tiles[1])
          }
          GridRow {
            tile(tiles[2])
            tile(tiles[3])
          }
        }
      } else {
        HStack(spacing: 8) {
          ForEach(0..<tiles.count, id: \.self) { i in tile(tiles[i]) }
        }
      }
    }
    .widgetURL(last.map { projectURL($0.name) } ?? TideLinks.home)
    .tideWidgetBackground()
  }

  private func tile(_ t: QuickActionItem) -> some View {
    TideAction(url: t.url) {
      QuickTile(title: t.title, symbol: t.symbol, tint: t.tint, enabled: t.enabled, a11yLabel: t.a11yLabel, a11yHint: t.a11yHint)
    }
  }
}

private var quickActionFamilies: [WidgetFamily] {
  if #available(iOS 18.0, *) { return [.systemSmall, .systemMedium] }
  return [.systemMedium]
}

struct QuickActionsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "QuickActions", provider: SharedProvider(sample: TideSamples.shared)) { entry in
      QuickActionsView(entry: entry)
    }
    .configurationDisplayName("Quick actions")
    .description("Start a project, open or run the last one, or search.")
    .supportedFamilies(quickActionFamilies)
  }
}
