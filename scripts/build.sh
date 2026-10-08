#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run typecheck
npm run build:web
if [[ ! -f macos/PaperChat/PaperChat.xcodeproj/project.pbxproj ]]; then
  xcrun safari-web-extension-converter dist --project-location macos --app-name PaperChat --bundle-identifier local.paperchat.PaperChat --macos-only --swift --no-open --no-prompt
fi
python3 scripts/configure-xcode.py
mkdir -p ../../outputs
bash scripts/build-native.sh
