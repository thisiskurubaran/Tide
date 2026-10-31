import SwiftUI
import WidgetKit

@main
struct TideWidgetBundle: WidgetBundle {
  var body: some Widget {
    RecentProjectsWidget()
    DeployLiveActivity()
  }
}
