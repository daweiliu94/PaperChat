#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
stage=$(mktemp -d -t PaperChatBuild)
trap 'rm -rf "$stage"' EXIT
python3 scripts/signing-info.py > "$stage/signing.json"
python3 scripts/configure-xcode.py "$stage/signing.json"
signingIdentity=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["identity"])' "$stage/signing.json")
signingTeam=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["team"])' "$stage/signing.json")
app="$stage/PaperChat.app"
extension="$app/Contents/PlugIns/PaperChat Extension.appex"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$extension/Contents/MacOS" "$extension/Contents/Resources" "$stage/swiftmodules"
xcrun swiftc -swift-version 5 -target arm64-apple-macosx14.0 -parse-as-library -module-name PaperChat -module-cache-path "$stage/swiftmodules" native/BuildSigning.swift native/BridgeProtocol.swift native/SecuritySupport.swift native/OAuthLoopback.swift native/ChatGPTService.swift native/HistoryStore.swift native/Companion.swift native/AppDelegate.swift -o "$app/Contents/MacOS/PaperChat"
xcrun swiftc -swift-version 5 -target arm64-apple-macosx14.0 -parse-as-library -Xlinker -e -Xlinker _NSExtensionMain -module-name PaperChat_Extension -module-cache-path "$stage/swiftmodules" native/BuildSigning.swift native/BridgeProtocol.swift native/CompanionLauncher.swift native/SafariWebExtensionHandler.swift -o "$extension/Contents/MacOS/PaperChat Extension"
python3 scripts/bundle-info.py "$app" "$signingTeam"
ditto --norsrc --noextattr dist "$extension/Contents/Resources"
cp extension/icons/icon-256.png "$app/Contents/Resources/AppIcon.png"
xattr -cr "$app"
codesign --force --sign "$signingIdentity" --timestamp=none --entitlements 'macos/PaperChat/PaperChat Extension/PaperChat.entitlements' "$extension"
xattr -cr "$app"
codesign --force --sign "$signingIdentity" --timestamp=none --entitlements macos/PaperChat/PaperChat/PaperChat.entitlements "$app"
codesign --verify --deep --strict "$app"
rm -rf ../../outputs/PaperChat.app
install="/Applications/PaperChat.app"
if [[ -e "$install" ]] && [[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$install/Contents/Info.plist" 2>/dev/null || true)" != local.paperchat.PaperChat ]]; then
  echo 'A different app exists at the PaperChat install path. Choose another destination.' >&2; exit 1
fi
rm -rf "$install"
ditto --norsrc --noextattr "$app" "$install"
codesign --verify --deep --strict "$install"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$install"
installedExtension="$install/Contents/PlugIns/PaperChat Extension.appex"
if ! unregisterOutput=$(/usr/bin/pluginkit -r "$installedExtension" 2>&1); then
  if [[ "$unregisterOutput" != "remove: no plugin at $installedExtension" ]]; then
    printf '%s\n' "$unregisterOutput" >&2; exit 1
  fi
fi
/usr/bin/pluginkit -a "$install/Contents/PlugIns/PaperChat Extension.appex"
ditto -c -k --keepParent --norsrc --noextattr "$app" ../../outputs/PaperChat.zip
python3 scripts/package-release.py ../../outputs/PaperChat.zip
echo 'Built and verified /Applications/PaperChat.app; packaged outputs/PaperChat.zip'
