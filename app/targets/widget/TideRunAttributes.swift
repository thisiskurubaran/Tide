// The run Live Activity's data: a dev server, a test run or a task.
// The app has an identical copy
// (modules/tide-widgets/ios/TideRunAttributes.swift): ActivityKit matches them
// by name and shape, so the two must change together.
import ActivityKit
import Foundation

public struct TideRunAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    // "running", "passed", "failed" or "stopped"
    public var status: String
    // When the run started, for the live timer; set when it ends, to stop it.
    public var startedAt: Date
    public var endedAt: Date?
    // e.g. "localhost:5173 · 0 errors" or "38 of 52 · 0 failed"
    public var detail: String
    // 0 to 1, for test runs that report how far along they are.
    public var progress: Double?
  }

  public var project: String
  public var command: String
  // "server", "tests" or "task"
  public var kind: String
}
