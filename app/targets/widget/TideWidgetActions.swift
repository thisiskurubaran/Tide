// Tappable parts of the widgets. Medium and large widgets use Link, which
// opens a tide:// link on iOS 17 and later. A small widget has one tap area
// (its widgetURL) on iOS 17; on iOS 18 its buttons run OpenTideLinkIntent,
// which opens the link with OpenURLIntent.
import AppIntents
import SwiftUI
import WidgetKit

@available(iOS 18.0, *)
struct OpenTideLinkIntent: AppIntent {
  static let title: LocalizedStringResource = "Open in Tide"
  static let openAppWhenRun = true
  // Only for the widgets' buttons; the app's own actions are the ones for Shortcuts.
  static let isDiscoverable = false

  @Parameter(title: "Link") var link: String

  init() { link = "tide://" }
  init(url: URL) { link = url.absoluteString }

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: link) ?? TideLinks.home))
  }
}

// A part of a widget that opens `url`. In a small widget on iOS 17 it isn't
// tappable on its own (the whole widget opens its widgetURL); `hideInSmallOnOld`
// leaves it out there, for buttons that would otherwise do the wrong thing.
struct TideAction<Content: View>: View {
  @Environment(\.widgetFamily) private var family
  let url: URL
  var hideInSmallOnOld = false
  @ViewBuilder let content: () -> Content

  var body: some View {
    if family == .systemSmall {
      if #available(iOS 18.0, *) {
        Button(intent: OpenTideLinkIntent(url: url)) { content() }
          .buttonStyle(.plain)
      } else {
        if !hideInSmallOnOld { content() }
      }
    } else {
      Link(destination: url) { content() }
    }
  }
}

// Whether a small widget's buttons can be tapped one by one.
var tideSmallButtonsWork: Bool {
  if #available(iOS 18.0, *) { return true }
  return false
}
