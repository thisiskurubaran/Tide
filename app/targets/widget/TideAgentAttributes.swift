// The AI agent Live Activity's data: a turn in progress.
// Identical copies live in modules/tide-widgets/ios and targets/widget:
// ActivityKit matches them by name and shape, so the two must change together.
import ActivityKit
import Foundation

public struct TideAgentAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    // "working", "approval", then "done", "failed" or "stopped"
    public var status: String
    // Tool steps taken in this turn.
    public var steps: Int
    // e.g. "Editing src/App.tsx", or the summary when it ends.
    public var action: String
    // The command waiting for approval.
    public var command: String?
    public var startedAt: Date
    public var endedAt: Date?
  }

  public var project: String
  // What the user asked, shortened.
  public var prompt: String
}
