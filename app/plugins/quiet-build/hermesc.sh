#!/bin/sh
# Runs hermesc without its "the variable X was not declared" warning.
#
# hermesc compiles the JS bundle and flags every global it can't see declared:
# fetch, setTimeout, URL, Promise and the rest of the runtime that React Native
# installs at startup. That's dozens of warnings on every Release build, none of
# them actionable. Every other hermesc warning and error still shows.
#
# The Bundle React Native code and images phase points HERMES_CLI_PATH here and
# passes the real binary in TIDE_HERMESC (see plugins/withQuietBuild.js).
if [ -z "$TIDE_HERMESC" ] || [ ! -x "$TIDE_HERMESC" ]; then
  echo "error: hermesc not found at '$TIDE_HERMESC'. Run pod install, or set HERMES_CLI_PATH." >&2
  exit 2
fi
exec "$TIDE_HERMESC" -Wno-undefined-variable "$@"
