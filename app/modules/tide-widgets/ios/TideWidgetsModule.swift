import ActivityKit
import ExpoModulesCore
import WidgetKit

// The app group the widget extension reads; also in app.json and
// targets/widget/expo-target.config.js.
let tideAppGroup = "group.com.thisiskurubaran.tide"
let tideSharedKey = "tide.shared"

public class TideWidgetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TideWidgets")

    // JSON the widget and the Shortcuts actions read: {projects, recent}.
    Function("setSharedData") { (json: String) in
      UserDefaults(suiteName: tideAppGroup)?.set(json, forKey: tideSharedKey)
      WidgetCenter.shared.reloadAllTimelines()
    }

    Function("activitiesEnabled") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    // Returns the activity's id, or nil when Live Activities are off.
    AsyncFunction("startDeployActivity") { (project: String, provider: String, message: String) throws -> String? in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
      let content = ActivityContent(state: TideDeployAttributes.ContentState(state: "deploying", message: message, url: nil), staleDate: nil)
      let activity = try Activity.request(attributes: TideDeployAttributes(project: project, provider: provider), content: content)
      return activity.id
    }

    // "deploying" updates it; "done" or "failed" ends it, leaving the result
    // on the Lock Screen for a few minutes.
    AsyncFunction("updateDeployActivity") { (id: String, state: String, message: String, url: String?) async in
      guard let activity = Activity<TideDeployAttributes>.activities.first(where: { $0.id == id }) else { return }
      let content = ActivityContent(state: TideDeployAttributes.ContentState(state: state, message: message, url: url), staleDate: nil)
      if state == "deploying" {
        await activity.update(content)
      } else {
        await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(5 * 60)))
      }
    }

    // A dev server, test run or task. Returns the activity's id, or nil when
    // Live Activities are off.
    AsyncFunction("startRunActivity") { (project: String, command: String, kind: String, detail: String) throws -> String? in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
      let state = TideRunAttributes.ContentState(status: "running", startedAt: Date(), endedAt: nil, detail: detail, progress: nil)
      let activity = try Activity.request(
        attributes: TideRunAttributes(project: project, command: command, kind: kind),
        content: ActivityContent(state: state, staleDate: nil)
      )
      return activity.id
    }

    // Keeps the start time; progress is nil for runs that don't report any.
    AsyncFunction("updateRunActivity") { (id: String, status: String, detail: String, progress: Double?) async in
      guard let activity = Activity<TideRunAttributes>.activities.first(where: { $0.id == id }) else { return }
      var state = activity.content.state
      state.status = status
      state.detail = detail
      state.progress = progress
      await activity.update(ActivityContent(state: state, staleDate: nil))
    }

    // Stops the timer and leaves the result on the Lock Screen for a few minutes.
    AsyncFunction("endRunActivity") { (id: String, status: String, detail: String) async in
      guard let activity = Activity<TideRunAttributes>.activities.first(where: { $0.id == id }) else { return }
      var state = activity.content.state
      state.status = status
      state.detail = detail
      state.endedAt = Date()
      if status == "passed" && state.progress != nil { state.progress = 1 }
      await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(5 * 60)))
    }
  }
}
