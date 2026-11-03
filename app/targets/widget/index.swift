import SwiftUI
import WidgetKit

@main
struct TideWidgetBundle: WidgetBundle {
  var body: some Widget {
    RecentProjectsWidget()
    DeployLiveActivity()
    RunLiveActivity()
    if #available(iOS 18.0, *) {
      RunProjectControl()
      RunTestsControl()
    }
  }
}
