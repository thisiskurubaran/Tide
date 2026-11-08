// The deploy Live Activity's data.
// Identical copies live in modules/tide-widgets/ios and targets/widget:
// ActivityKit matches them by name and shape, so the two must change together.
import ActivityKit
import Foundation

public struct TideDeployAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    // "deploying", "done" or "failed"
    public var state: String
    public var message: String
    public var url: String?
  }

  public var project: String
  public var provider: String
}
