// Tide's look for the widgets and Live Activities: the brand palette (from the
// colorsets expo-target.config.js generates, light and dark), the app icon's
// mark, and the shared widget background.
import SwiftUI
import WidgetKit

extension Color {
  // 0xRRGGBB
  init(tideHex hex: UInt32, opacity: Double = 1) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xff) / 255,
      green: Double((hex >> 8) & 0xff) / 255,
      blue: Double(hex & 0xff) / 255,
      opacity: opacity
    )
  }

  // "#6f9dff" or "6f9dff"; nil for anything else.
  init?(tideHexString string: String?) {
    guard var s = string?.trimmingCharacters(in: .whitespaces) else { return nil }
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let value = UInt32(s, radix: 16) else { return nil }
    self.init(tideHex: value)
  }
}

enum TidePalette {
  // Adaptive (light / dark), from the asset catalog.
  static let brand = Color("TideBrand")
  static let background = Color("TideBackground")
  static let card = Color("TideCard")
  static let border = Color("TideBorder")
  static let foreground = Color("TideForeground")
  static let muted = Color("TideMuted")
  static let success = Color("TideSuccess")
  static let warning = Color("TideWarning")
  static let danger = Color("TideDanger")

  // The app icon's gradient.
  static let iconTop = Color(tideHex: 0x3b5bdb)
  static let iconBottom = Color(tideHex: 0x0e1a4d)

  // The Dynamic Island is always black, so it takes the dark palette.
  enum Island {
    static let brand = Color(tideHex: 0x2dd4bf)
    static let foreground = Color(tideHex: 0xeaf3f2)
    static let muted = Color(tideHex: 0x93aaa9)
    static let success = Color(tideHex: 0x4ade80)
    static let warning = Color(tideHex: 0xfbbf24)
    static let danger = Color(tideHex: 0xfb7185)
    static let track = Color(tideHex: 0x1d3039)
  }
}

// The app icon in miniature: the blue tile with a white prompt chevron and a
// wave under it. In tinted and clear Home Screens it takes the accent.
struct TideMark: View {
  @Environment(\.widgetRenderingMode) private var renderingMode
  var size: CGFloat = 22

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
        .fill(
          renderingMode == .fullColor
            ? AnyShapeStyle(LinearGradient(colors: [TidePalette.iconTop, TidePalette.iconBottom], startPoint: .topLeading, endPoint: .bottomTrailing))
            : AnyShapeStyle(Color.white.opacity(0.25))
        )
        .widgetAccentable()
      VStack(spacing: size * 0.02) {
        Image(systemName: "chevron.right")
          .font(.system(size: size * 0.42, weight: .heavy))
        Image(systemName: "water.waves")
          .font(.system(size: size * 0.26, weight: .bold))
          .opacity(0.85)
      }
      .foregroundStyle(.white)
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

// A project's language as a small colored tile ("TS", "Py"), or a folder when
// the app hasn't worked out the language yet.
struct LanguageBadge: View {
  @Environment(\.widgetRenderingMode) private var renderingMode
  let project: SharedProject
  var size: CGFloat = 26

  var body: some View {
    let tint = Color(tideHexString: project.color) ?? TidePalette.brand
    ZStack {
      RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
        .fill(tint.opacity(renderingMode == .fullColor ? 0.16 : 0.22))
      RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
        .strokeBorder(tint.opacity(0.35), lineWidth: 0.5)
      if let badge = project.badge, !badge.isEmpty {
        Text(badge)
          .font(.system(size: badge.count > 2 ? size * 0.34 : size * 0.42, weight: .bold, design: .monospaced))
          .foregroundStyle(tint)
          .minimumScaleFactor(0.6)
          .lineLimit(1)
          .padding(.horizontal, 2)
      } else {
        Image(systemName: "folder.fill")
          .font(.system(size: size * 0.42, weight: .semibold))
          .foregroundStyle(tint)
      }
    }
    .frame(width: size, height: size)
    .widgetAccentable()
    .accessibilityLabel(project.language ?? "Project")
  }
}

// The small colored dot for a language, for tight rows.
struct LanguageDot: View {
  let project: SharedProject
  var size: CGFloat = 8

  var body: some View {
    Circle()
      .fill(Color(tideHexString: project.color) ?? TidePalette.brand)
      .frame(width: size, height: size)
      .widgetAccentable()
  }
}

// The widgets' background: Tide's background with a faint teal glow from the
// top corner. The system drops it in tinted and clear modes and StandBy's
// dimmed state.
struct TideWidgetBackdrop: View {
  var body: some View {
    ZStack {
      LinearGradient(colors: [TidePalette.card, TidePalette.background], startPoint: .top, endPoint: .bottom)
      RadialGradient(colors: [TidePalette.brand.opacity(0.18), .clear], center: .topTrailing, startRadius: 0, endRadius: 220)
    }
  }
}

extension View {
  func tideWidgetBackground() -> some View {
    containerBackground(for: .widget) { TideWidgetBackdrop() }
  }

  // A small all-caps section label.
  func tideEyebrow() -> some View {
    font(.system(size: 10, weight: .semibold)).textCase(.uppercase).tracking(0.6).foregroundStyle(TidePalette.muted)
  }
}

// A pill-shaped action in a widget ("Run", "Open").
struct TidePill: View {
  @Environment(\.widgetRenderingMode) private var renderingMode
  let title: String
  let symbol: String
  var prominent = true

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: symbol).font(.system(size: 10, weight: .bold))
      Text(title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .frame(maxWidth: .infinity)
    .foregroundStyle(prominent && renderingMode == .fullColor ? Color.white : TidePalette.foreground)
    .background(
      Capsule().fill(prominent ? AnyShapeStyle(TidePalette.brand) : AnyShapeStyle(TidePalette.foreground.opacity(0.08)))
    )
    .widgetAccentable(prominent)
  }
}

// How a run, task or activity is doing, and its color and symbol.
enum TideTone {
  case running, success, failure, stopped, attention

  init(status: String) {
    switch status {
    case "passed", "done": self = .success
    case "failed": self = .failure
    case "stopped": self = .stopped
    case "approval": self = .attention
    default: self = .running
    }
  }

  var color: Color {
    switch self {
    case .running: return TidePalette.brand
    case .success: return TidePalette.success
    case .failure: return TidePalette.danger
    case .stopped: return TidePalette.muted
    case .attention: return TidePalette.warning
    }
  }

  // For the Dynamic Island's black background.
  var islandColor: Color {
    switch self {
    case .running: return TidePalette.Island.brand
    case .success: return TidePalette.Island.success
    case .failure: return TidePalette.Island.danger
    case .stopped: return TidePalette.Island.muted
    case .attention: return TidePalette.Island.warning
    }
  }

  var symbol: String {
    switch self {
    case .running: return "bolt.fill"
    case .success: return "checkmark.circle.fill"
    case .failure: return "xmark.octagon.fill"
    case .stopped: return "stop.circle.fill"
    case .attention: return "hand.raised.fill"
    }
  }

  var isFinished: Bool { self == .success || self == .failure || self == .stopped }
}
