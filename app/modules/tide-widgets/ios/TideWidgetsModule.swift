import ActivityKit
import CoreSpotlight
import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers
import WidgetKit

// The app group the widget extension reads; also in app.json and
// targets/widget/expo-target.config.js.
let tideAppGroup = "group.com.thisiskurubaran.tide"
let tideSharedKey = "tide.shared"

// How long an activity may go without an update before the Lock Screen shows
// it as out of date (the app was suspended or killed mid-run).
private let tideStaleAfter: TimeInterval = 30 * 60
// How long a finished activity stays on the Lock Screen.
private let tideDoneLingers: TimeInterval = 5 * 60
private let tideFailedLingers: TimeInterval = 15 * 60

private func tideStaleDate() -> Date { Date().addingTimeInterval(tideStaleAfter) }

private func tideDismissal(failed: Bool) -> ActivityUIDismissalPolicy {
  .after(Date().addingTimeInterval(failed ? tideFailedLingers : tideDoneLingers))
}

// The activities this process started. Anything else on the Lock Screen is
// from a launch that was killed, and endStaleActivities ends it.
final class TideActivityRegistry: @unchecked Sendable {
  static let shared = TideActivityRegistry()
  private let lock = NSLock()
  private var ids = Set<String>()
  private var observer: NSObjectProtocol?

  func add(_ id: String) {
    lock.lock()
    ids.insert(id)
    lock.unlock()
  }

  func startedHere(_ id: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return ids.contains(id)
  }

  // When the app is quit while running (not when it's killed in the
  // background, which the stale date and the next launch cover), end every
  // activity so none is left counting up. iOS gives willTerminate a few
  // seconds; this waits at most two.
  func endAllOnTermination() {
    lock.lock()
    defer { lock.unlock() }
    guard observer == nil else { return }
    observer = NotificationCenter.default.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: nil) { _ in
      let done = DispatchSemaphore(value: 0)
      Task.detached {
        await tideEndActivities(keep: { _ in false })
        done.signal()
      }
      _ = done.wait(timeout: .now() + 2)
    }
  }
}

private func tideEnd<A: ActivityAttributes>(_ type: A.Type, keep: (String) -> Bool, finish: (A.ContentState) -> A.ContentState) async {
  for activity in Activity<A>.activities where !keep(activity.id) {
    await activity.end(ActivityContent(state: finish(activity.content.state), staleDate: nil), dismissalPolicy: .immediate)
  }
}

// Ends every activity `keep` doesn't name, marked as stopped.
func tideEndActivities(keep: (String) -> Bool) async {
  let now = Date()
  await tideEnd(TideRunAttributes.self, keep: keep) { s in
    var s = s
    if s.status == "running" { s.status = "stopped"; s.detail = "Stopped" }
    if s.endedAt == nil { s.endedAt = now }
    return s
  }
  await tideEnd(TideDeployAttributes.self, keep: keep) { s in
    var s = s
    if s.state == "deploying" { s.state = "failed"; s.message = "Interrupted" }
    return s
  }
  await tideEnd(TideGitAttributes.self, keep: keep) { s in
    var s = s
    if s.status == "running" { s.status = "failed"; s.detail = "Interrupted" }
    if s.endedAt == nil { s.endedAt = now }
    return s
  }
  await tideEnd(TideAgentAttributes.self, keep: keep) { s in
    var s = s
    if s.status == "working" || s.status == "approval" { s.status = "stopped"; s.action = "Stopped"; s.command = nil }
    if s.endedAt == nil { s.endedAt = now }
    return s
  }
  await tideEnd(TideInstallAttributes.self, keep: keep) { s in
    var s = s
    if s.status == "running" { s.status = "failed"; s.detail = "Interrupted" }
    if s.endedAt == nil { s.endedAt = now }
    return s
  }
}

public class TideWidgetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TideWidgets")

    OnCreate {
      TideActivityRegistry.shared.endAllOnTermination()
    }

    // JSON the widgets, controls and Shortcuts actions read:
    // {projects, recent, cards, files, lastRun} (see src/features/widgets/sync.ts).
    Function("setSharedData") { (json: String) in
      UserDefaults(suiteName: tideAppGroup)?.set(json, forKey: tideSharedKey)
      WidgetCenter.shared.reloadAllTimelines()
    }

    Function("activitiesEnabled") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    AsyncFunction("endStaleActivities") { () async in
      await tideEndActivities(keep: { TideActivityRegistry.shared.startedHere($0) })
    }

    // MARK: Deploy

    // Returns the activity's id, or nil when Live Activities are off.
    AsyncFunction("startDeployActivity") { (project: String, provider: String, message: String) throws -> String? in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
      let content = ActivityContent(state: TideDeployAttributes.ContentState(state: "deploying", message: message, url: nil), staleDate: tideStaleDate())
      let activity = try Activity.request(attributes: TideDeployAttributes(project: project, provider: provider), content: content)
      TideActivityRegistry.shared.add(activity.id)
      return activity.id
    }

    // "deploying" updates it; "done" or "failed" ends it, leaving the result
    // on the Lock Screen for a few minutes.
    AsyncFunction("updateDeployActivity") { (id: String, state: String, message: String, url: String?) async in
      guard let activity = Activity<TideDeployAttributes>.activities.first(where: { $0.id == id }) else { return }
      let next = TideDeployAttributes.ContentState(state: state, message: message, url: url)
      if state == "deploying" {
        await activity.update(ActivityContent(state: next, staleDate: tideStaleDate()))
      } else {
        await activity.end(ActivityContent(state: next, staleDate: nil), dismissalPolicy: tideDismissal(failed: state == "failed"))
      }
    }

    // MARK: Run

    // A dev server, test run or task. Returns the activity's id, or nil when
    // Live Activities are off.
    AsyncFunction("startRunActivity") { (project: String, command: String, kind: String, detail: String) throws -> String? in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
      let state = TideRunAttributes.ContentState(status: "running", startedAt: Date(), endedAt: nil, detail: detail, progress: nil)
      let activity = try Activity.request(
        attributes: TideRunAttributes(project: project, command: command, kind: kind),
        content: ActivityContent(state: state, staleDate: tideStaleDate())
      )
      TideActivityRegistry.shared.add(activity.id)
      return activity.id
    }

    // Keeps the start time; progress is nil for runs that don't report any.
    AsyncFunction("updateRunActivity") { (id: String, status: String, detail: String, progress: Double?) async in
      guard let activity = Activity<TideRunAttributes>.activities.first(where: { $0.id == id }) else { return }
      var state = activity.content.state
      state.status = status
      state.detail = detail
      state.progress = progress
      await activity.update(ActivityContent(state: state, staleDate: tideStaleDate()))
    }

    // Stops the timer and leaves the result on the Lock Screen for a few minutes.
    AsyncFunction("endRunActivity") { (id: String, status: String, detail: String) async in
      guard let activity = Activity<TideRunAttributes>.activities.first(where: { $0.id == id }) else { return }
      var state = activity.content.state
      state.status = status
      state.detail = detail
      state.endedAt = Date()
      if status == "passed" && state.progress != nil { state.progress = 1 }
      await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: tideDismissal(failed: status == "failed"))
    }

    // MARK: Git

    AsyncFunction("startGitActivity") { (project: String, operation: String, remote: String, detail: String) throws -> String? in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
      let state = TideGitAttributes.ContentState(status: "running", phase: "", detail: detail, progress: nil, startedAt: Date(), endedAt: nil)
      let activity = try Activity.request(
        attributes: TideGitAttributes(project: project, operation: operation, remote: remote),
        content: ActivityContent(state: state, staleDate: tideStaleDate())
      )
      TideActivityRegistry.shared.add(activity.id)
      return activity.id
    }

    AsyncFunction("updateGitActivity") { (id: String, phase: String, detail: String, progress: Double?) async in
      guard let activity = Activity<TideGitAttributes>.activities.first(where: { $0.id == id }) else { return }
      var state = activity.content.state
      state.phase = phase
      state.detail = detail
      state.progress = progress
      await activity.update(ActivityContent(state: state, staleDate: tideStaleDate()))
    }

    AsyncFunction("endGitActivity") { (id: String, status: String, detail: String) async in
      guard let activity = Activity<TideGitAttributes>.activities.first(where: { $0.id == id }) else { return }
      var state = activity.content.state
      state.status = status
      state.detail = detail
      state.endedAt = Date()
      if status == "done" { state.progress = 1 }
      await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: tideDismissal(failed: status == "failed"))
    }

    // MARK: Agent

    AsyncFunction("startAgentActivity") { (project: String, prompt: String) throws -> String? in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
      let state = TideAgentAttributes.ContentState(status: "working", steps: 0, action: "Thinking…", command: nil, startedAt: Date(), endedAt: nil)
      let activity = try Activity.request(
        attributes: TideAgentAttributes(project: project, prompt: prompt),
        content: ActivityContent(state: state, staleDate: tideStaleDate())
      )
      TideActivityRegistry.shared.add(activity.id)
      return activity.id
    }

    // An approval request alerts (the user is the one holding the agent up);
    // other updates are silent.
    AsyncFunction("updateAgentActivity") { (id: String, status: String, steps: Int, action: String, command: String?) async in
      guard let activity = Activity<TideAgentAttributes>.activities.first(where: { $0.id == id }) else { return }
      var state = activity.content.state
      let wasWaiting = state.status == "approval"
      state.status = status
      state.steps = steps
      state.action = action
      state.command = command
      // Waiting for the user isn't stale: the agent can wait as long as it takes.
      let content = ActivityContent(state: state, staleDate: status == "approval" ? nil : tideStaleDate())
      if status == "approval" && !wasWaiting {
        let alert = AlertConfiguration(title: "Approve command?", body: "\(activity.attributes.project): \(command ?? action)", sound: .default)
        await activity.update(content, alertConfiguration: alert)
      } else {
        await activity.update(content)
      }
    }

    AsyncFunction("endAgentActivity") { (id: String, status: String, steps: Int, action: String) async in
      guard let activity = Activity<TideAgentAttributes>.activities.first(where: { $0.id == id }) else { return }
      var state = activity.content.state
      state.status = status
      state.steps = steps
      state.action = action
      state.command = nil
      state.endedAt = Date()
      await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: tideDismissal(failed: status == "failed"))
    }

    // MARK: Install

    AsyncFunction("startInstallActivity") { (project: String, tool: String, packages: String) throws -> String? in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
      let state = TideInstallAttributes.ContentState(status: "running", detail: "Starting \(tool)…", startedAt: Date(), endedAt: nil)
      let activity = try Activity.request(
        attributes: TideInstallAttributes(project: project, tool: tool, packages: packages),
        content: ActivityContent(state: state, staleDate: tideStaleDate())
      )
      TideActivityRegistry.shared.add(activity.id)
      return activity.id
    }

    AsyncFunction("updateInstallActivity") { (id: String, detail: String) async in
      guard let activity = Activity<TideInstallAttributes>.activities.first(where: { $0.id == id }) else { return }
      var state = activity.content.state
      state.detail = detail
      await activity.update(ActivityContent(state: state, staleDate: tideStaleDate()))
    }

    AsyncFunction("endInstallActivity") { (id: String, status: String, detail: String) async in
      guard let activity = Activity<TideInstallAttributes>.activities.first(where: { $0.id == id }) else { return }
      var state = activity.content.state
      state.status = status
      state.detail = detail
      state.endedAt = Date()
      await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: tideDismissal(failed: status == "failed"))
    }

    // MARK: Spotlight

    // Replaces the indexed projects with these: [{name, language?, openedAt?}].
    AsyncFunction("indexProjects") { (json: String) in
      guard CSSearchableIndex.isIndexingAvailable(), let data = json.data(using: .utf8),
        let projects = try? JSONDecoder().decode([TideSpotlightProject].self, from: data)
      else { return }
      let items = projects.map { $0.searchableItem() }
      let index = CSSearchableIndex.default()
      index.deleteSearchableItems(withDomainIdentifiers: [tideSpotlightDomain]) { _ in
        if !items.isEmpty { index.indexSearchableItems(items) { _ in } }
      }
    }

    AsyncFunction("removeIndexedProjects") { (names: [String]) in
      guard CSSearchableIndex.isIndexingAvailable() else { return }
      CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: names.map { tideSpotlightPrefix + $0 }) { _ in }
    }

    // The link from a Spotlight result that launched the app, once. Also
    // tells the subscriber JS is listening, so later results open directly.
    Function("takePendingLink") { () -> String? in
      TideSpotlightLinks.shared.takePending()
    }
  }
}
