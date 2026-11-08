// The package install Live Activity's data: npm or pip at work.
// Identical copies live in modules/tide-widgets/ios and targets/widget:
// ActivityKit matches them by name and shape, so the two must change together.
import ActivityKit
import Foundation

public struct TideInstallAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    // "running", "done" or "failed"
    public var status: String
    // The installer's latest line, or the result when it ends.
    public var detail: String
    public var startedAt: Date
    public var endedAt: Date?
  }

  public var project: String
  // "npm" or "pip"
  public var tool: String
  // e.g. "Installing react", "All dependencies"
  public var packages: String
}
