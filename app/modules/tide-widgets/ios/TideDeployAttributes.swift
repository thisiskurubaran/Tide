// The deploy Live Activity's data. The widget extension has an identical copy
// (targets/widget/TideDeployAttributes.swift): ActivityKit matches them by name
// and shape, so the two must change together.
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
