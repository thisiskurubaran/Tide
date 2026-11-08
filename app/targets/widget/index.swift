import SwiftUI
import WidgetKit

// Keep this at 10 entries or fewer (the `if` counts as one): WidgetBundleBuilder
// takes at most 10 per block.
@main
struct TideWidgetBundle: WidgetBundle {
  var body: some Widget {
    // Home Screen, StandBy and Lock Screen widgets
    RecentProjectsWidget()
    QuickActionsWidget()
    LastRunWidget()
    LockScreenWidget()
    // Live Activities
    RunLiveActivity()
    DeployLiveActivity()
    GitLiveActivity()
    AgentLiveActivity()
    InstallLiveActivity()
    // Control Center
    if #available(iOS 18.0, *) {
      RunProjectControl()
      RunTestsControl()
    }
  }
}
