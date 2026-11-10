#!/bin/sh
# Takes the 2.1.0 review screenshots on the booted iOS Simulator, at the default
# text size and at the largest accessibility size. Needs a Release build installed
# (see the README's "Running the Maestro flows") and Maestro.
#   npm run screenshots              # into app/screenshots-2.1.0/
#   npm run screenshots -- ~/Desktop/tide-shots
APP=$(cd "$(dirname "$0")/.." && pwd)
OUT="${1:-$APP/screenshots-2.1.0}"
mkdir -p "$OUT"
cd "$OUT" || exit 1

# Put the simulator back to the default text size however the script ends.
trap 'xcrun simctl ui booted content_size large' EXIT

for size in default ax-xxxl; do
  if [ "$size" = default ]; then
    xcrun simctl ui booted content_size large
  else
    xcrun simctl ui booted content_size accessibility-extra-extra-extra-large
  fi
  # Keep going if a step fails: the shots taken before it are still saved.
  maestro test -e SIZE="$size" "$APP/.maestro/screenshots/ios-2.1.0.yaml" || echo "ios-2.1.0.yaml stopped early at $size; see Maestro's output above"
  maestro test -e SIZE="$size" "$APP/.maestro/screenshots/remote-token-2.1.0.yaml" || echo "remote-token-2.1.0.yaml stopped early at $size"
done

echo "Screenshots in $OUT"
