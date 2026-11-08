// Projects in Spotlight: what's indexed for each project, and opening Tide at
// a project when a result is tapped. TideWidgetsModule indexes; the app
// delegate subscriber below (registered in expo-module.config.json) receives
// the tap.
import CoreSpotlight
import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

let tideSpotlightDomain = "com.thisiskurubaran.tide.projects"
// Item ids are this prefix and the project's name.
let tideSpotlightPrefix = "project:"

struct TideSpotlightProject: Decodable {
  let name: String
  let language: String?
  // ms since the epoch
  let openedAt: Double?

  func searchableItem() -> CSSearchableItem {
    let attributes = CSSearchableItemAttributeSet(contentType: UTType.folder)
    attributes.title = name
    attributes.displayName = name
    attributes.contentDescription = [language, "Tide project"].compactMap { $0 }.joined(separator: " · ")
    var keywords = ["Tide", "project", "code"]
    if let language { keywords.append(language) }
    attributes.keywords = keywords
    if let openedAt { attributes.lastUsedDate = Date(timeIntervalSince1970: openedAt / 1000) }
    return CSSearchableItem(uniqueIdentifier: tideSpotlightPrefix + name, domainIdentifier: tideSpotlightDomain, attributeSet: attributes)
  }
}

// tide://project/<name>, as src/features/launch/links.ts builds it.
func tideProjectLink(_ name: String) -> URL? {
  let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? name
  return URL(string: "tide://project/\(encoded)")
}

// A result tapped before JS is listening (it launched the app) waits here
// until JS asks for it; once JS has asked, results open as links straight away.
final class TideSpotlightLinks: @unchecked Sendable {
  static let shared = TideSpotlightLinks()
  private let lock = NSLock()
  private var pending: URL?
  private var jsReady = false

  func open(_ url: URL) {
    lock.lock()
    let ready = jsReady
    if !ready { pending = url }
    lock.unlock()
    guard ready else { return }
    DispatchQueue.main.async {
      UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }
  }

  func takePending() -> String? {
    lock.lock()
    defer { lock.unlock() }
    jsReady = true
    let url = pending
    pending = nil
    return url?.absoluteString
  }
}

// Spotlight hands a tapped result to the app as a CSSearchableItemActionType
// user activity. ExpoAppDelegate (and ExpoAppSceneDelegate, for cold starts
// and the scene life cycle) passes it to every subscriber; React Native's own
// linking only handles web links, so this turns it into a tide:// link.
public class TideSpotlightAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([any UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    guard userActivity.activityType == CSSearchableItemActionType,
      let id = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
      id.hasPrefix(tideSpotlightPrefix),
      let url = tideProjectLink(String(id.dropFirst(tideSpotlightPrefix.count)))
    else { return false }
    TideSpotlightLinks.shared.open(url)
    return true
  }
}
