#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
scratch=$(mktemp -d -t PaperChatTests)
trap 'rm -rf "$scratch"' EXIT
xcrun swiftc -swift-version 5 -parse-as-library -module-cache-path "$scratch/modules" native/BuildSigning.swift native/BridgeProtocol.swift native/CompanionLauncher.swift native/SecuritySupport.swift native/OAuthLoopback.swift native/ChatGPTService.swift native/HistoryStore.swift tests/NativeTests.swift -o "$scratch/NativeTests"
codesign --force --sign - --identifier local.paperchat.Tests "$scratch/NativeTests"
"$scratch/NativeTests" "$scratch/history-fixtures"
