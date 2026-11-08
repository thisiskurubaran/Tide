// The git Live Activity's data: a clone, pull or push in progress.
// Identical copies live in modules/tide-widgets/ios and targets/widget:
// ActivityKit matches them by name and shape, so the two must change together.
import ActivityKit
import Foundation

public struct TideGitAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    // "running", "done" or "failed"
    public var status: String
    // e.g. "Receiving objects"; empty before git reports a phase.
    public var phase: String
    // e.g. "54/120", or the result when it ends.
    public var detail: String
    // 0 to 1 while git reports a percentage.
    public var progress: Double?
    public var startedAt: Date
    public var endedAt: Date?
  }

  public var project: String
  // "clone", "pull" or "push"
  public var operation: String
  // e.g. "github.com/octocat/hello", or empty.
  public var remote: String
}
