from pathlib import Path
import plistlib
import sys
root = Path(__file__).resolve().parent.parent
app = Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent.parent / 'outputs/PaperChat.app'
common = {'CFBundleDevelopmentRegion': 'en', 'CFBundleShortVersionString': '0.1.4', 'CFBundleVersion': '5', 'LSMinimumSystemVersion': '14.0'}
common.update(CFBundleInfoDictionaryVersion='6.0', CFBundleSupportedPlatforms=['MacOSX'])
common['PaperChatAppGroup'] = sys.argv[2] + '.paperchat.shared'
host = dict(common, CFBundleExecutable='PaperChat', CFBundleName='PaperChat', CFBundleIdentifier='local.paperchat.PaperChat', CFBundlePackageType='APPL', NSPrincipalClass='NSApplication', CFBundleIconFile='AppIcon.png', NSHighResolutionCapable=True, CFBundleURLTypes=[{'CFBundleURLName': 'PaperChat setup', 'CFBundleURLSchemes': ['paperchat']}])
host['LSUIElement'] = True
extension = dict(common, CFBundleExecutable='PaperChat Extension', CFBundleName='PaperChat', CFBundleDisplayName='PaperChat', CFBundleIdentifier='local.paperchat.PaperChat.Extension', CFBundlePackageType='XPC!', NSExtension={'NSExtensionPointIdentifier': 'com.apple.Safari.web-extension', 'NSExtensionPrincipalClass': 'PaperChat_Extension.SafariWebExtensionHandler'})
for path, value in [(app / 'Contents/Info.plist', host), (app / 'Contents/PlugIns/PaperChat Extension.appex/Contents/Info.plist', extension)]:
    with path.open('wb') as file: plistlib.dump(value, file)
