// Shared pieces of Tide's Live Activities: the status icon, elapsed timer,
// progress bar and ring, action buttons, and the Lock Screen card layout every
// activity uses. Colors come in two sets: adaptive ones for the Lock Screen,
// and the dark palette for the always-black Dynamic Island.
import ActivityKit
import SwiftUI
import WidgetKit

// Counts up while it runs and stops where it ended.
struct ActivityElapsed: View {
  let start: Date
  let end: Date?

  var body: some View {
    if let end {
      Text(timerInterval: start...max(end, start), pauseTime: max(end, start), countsDown: false)
    } else {
      Text(timerInterval: start...Date.distantFuture, countsDown: false)
    }
  }
}

// The elapsed timer sized for a corner: monospaced digits, right-aligned, and
// kept narrow (a timer Text otherwise takes all the width it's offered).
struct ActivityElapsedLabel: View {
  let start: Date
  let end: Date?
  var tint: Color
  var font: Font = .system(size: 13, weight: .semibold).monospacedDigit()
  var width: CGFloat = 56

  var body: some View {
    ActivityElapsed(start: start, end: end)
      .font(font)
      .foregroundStyle(tint)
      .multilineTextAlignment(.trailing)
      .frame(maxWidth: width, alignment: .trailing)
  }
}

// The status icon in a tinted rounded square.
struct ActivityIcon: View {
  let symbol: String
  let tint: Color
  var size: CGFloat = 36

  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: size * 0.46, weight: .semibold))
      .foregroundStyle(tint)
      .frame(width: size, height: size)
      .background(RoundedRectangle(cornerRadius: size * 0.3, style: .continuous).fill(tint.opacity(0.16)))
  }
}

struct ActivityProgressBar: View {
  let progress: Double
  let tint: Color
  var track: Color = TidePalette.foreground.opacity(0.12)
  var height: CGFloat = 5

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(track)
        Capsule()
          .fill(LinearGradient(colors: [tint.opacity(0.75), tint], startPoint: .leading, endPoint: .trailing))
          .frame(width: max(height, geo.size.width * min(max(progress, 0), 1)))
      }
    }
    .frame(height: height)
    .accessibilityLabel("\(Int((min(max(progress, 0), 1)) * 100)) percent")
  }
}

// A progress ring for the Dynamic Island's compact and minimal views, with
// the status symbol in the middle; a full ring when there's no progress.
struct ActivityRing: View {
  let progress: Double?
  let symbol: String
  let tint: Color
  var size: CGFloat = 20

  var body: some View {
    ZStack {
      Circle().stroke(TidePalette.Island.track, lineWidth: 2.5)
      Circle()
        .trim(from: 0, to: min(max(progress ?? 1, 0), 1))
        .stroke(tint, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
        .rotationEffect(.degrees(-90))
      Image(systemName: symbol)
        .font(.system(size: size * 0.42, weight: .bold))
        .foregroundStyle(tint)
    }
    .frame(width: size, height: size)
  }
}

// A capsule button that opens a tide:// link.
struct ActivityButton: View {
  let title: String
  let symbol: String
  let url: URL
  var tint: Color = TidePalette.brand
  var prominent = false

  var body: some View {
    Link(destination: url) {
      HStack(spacing: 4) {
        Image(systemName: symbol).font(.system(size: 10, weight: .bold))
        Text(title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
      .foregroundStyle(prominent ? Color.black : tint)
      .background(Capsule().fill(prominent ? tint : tint.opacity(0.18)))
    }
  }
}

// What every activity shows on the Lock Screen: icon, a small label (what and
// where), a title, a detail line, the elapsed time, optional progress, and
// buttons. A stale activity (the app stopped updating it) says so.
struct ActivityCard<Footer: View>: View {
  let symbol: String
  let tone: TideTone
  let eyebrow: String
  let title: String
  var detail: String? = nil
  var progress: Double? = nil
  // Nil hides the timer (deploys don't report when they started).
  let start: Date?
  let end: Date?
  var isStale = false
  @ViewBuilder let footer: () -> Footer

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .top, spacing: 12) {
        ActivityIcon(symbol: symbol, tint: tone.color)
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            TideMark(size: 14)
            Text(eyebrow)
              .font(.system(size: 11, weight: .semibold))
              .foregroundStyle(TidePalette.muted)
              .lineLimit(1)
            Spacer(minLength: 4)
            if let start {
              ActivityElapsedLabel(start: start, end: end, tint: tone.isFinished ? TidePalette.muted : tone.color)
            }
          }
          Text(title)
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(tone.isFinished ? tone.color : TidePalette.foreground)
            .lineLimit(1)
          if let detail, !detail.isEmpty {
            Text(detail)
              .font(.system(size: 12))
              .foregroundStyle(TidePalette.muted)
              .lineLimit(2)
          }
        }
      }
      if let progress, !tone.isFinished || tone == .success {
        ActivityProgressBar(progress: progress, tint: tone.color)
      }
      if isStale && !tone.isFinished {
        TideMetaLine(symbol: "exclamationmark.triangle.fill", text: "Not updated for a while. Open Tide to check.", color: TidePalette.warning)
      }
      footer()
    }
    .padding(16)
  }
}

extension View {
  // The Lock Screen background and button color all Tide activities share.
  func tideActivityChrome() -> some View {
    activityBackgroundTint(TidePalette.background.opacity(0.94))
      .activitySystemActionForegroundColor(TidePalette.brand)
  }
}
