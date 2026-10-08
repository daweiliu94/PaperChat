from pathlib import Path
import hashlib, json, plistlib, subprocess, shutil, sys

root = Path(__file__).resolve().parent.parent
signing = json.loads(Path(sys.argv[1]).read_text()) if len(sys.argv) > 1 else json.loads(subprocess.check_output(['python3', str(root / 'scripts/signing-info.py')]))
group = signing['team'] + '.paperchat.shared'
(root / 'native/BuildSigning.swift').write_text('// Generated public certificate pin; regenerate with configure-xcode.py.\nfunc paperChatPeerRequirement(_ identifier: String) -> String {\n    "identifier \\"\\(identifier)\\" and anchor apple generic and certificate leaf = H\\"' + signing['identity'] + '\\""\n}\n')
project = root / 'macos/PaperChat'
pbx = project / 'PaperChat.xcodeproj/project.pbxproj'
data = json.loads(subprocess.check_output(['plutil', '-convert', 'json', '-o', '-', str(pbx)]))
objects = data['objects']
targets = {obj['name']: obj for obj in objects.values() if obj.get('isa') == 'PBXNativeTarget'}
app = targets['PaperChat']; extension = targets['PaperChat Extension']

def identity(text):
    return hashlib.sha256(text.encode()).hexdigest()[:24].upper()

for name in ['SecuritySupport', 'OAuthLoopback', 'ChatGPTService', 'HistoryStore', 'Companion', 'BridgeProtocol', 'BuildSigning', 'CompanionLauncher']:
    filename = name + '.swift'
    ref = identity(filename)
    objects[ref] = {'isa': 'PBXFileReference', 'lastKnownFileType': 'sourcecode.swift', 'name': filename, 'path': '../../native/' + filename, 'sourceTree': 'SOURCE_ROOT'}
    for target in ([extension] if name == 'CompanionLauncher' else [app, extension] if name in ['BridgeProtocol', 'BuildSigning'] else [app]):
        phase = next(objects[p] for p in target['buildPhases'] if objects[p]['isa'] == 'PBXSourcesBuildPhase')
        build = identity(target['name'] + filename)
        objects[build] = {'isa': 'PBXBuildFile', 'fileRef': ref}
        if build not in phase['files']: phase['files'].append(build)

# Generated AppDelegate/handler are replaced only with project-owned source files.
shutil.copyfile(root / 'native/AppDelegate.swift', project / 'PaperChat/AppDelegate.swift')
shutil.copyfile(root / 'native/SafariWebExtensionHandler.swift', project / 'PaperChat Extension/SafariWebExtensionHandler.swift')
for target, directory in [(app, 'PaperChat'), (extension, 'PaperChat Extension')]:
    configurations = objects[target['buildConfigurationList']]['buildConfigurations']
    for config in configurations:
        settings = objects[config]['buildSettings']
        settings.update({'CODE_SIGN_STYLE': 'Manual', 'CODE_SIGN_IDENTITY': signing['identity'], 'DEVELOPMENT_TEAM': signing['team'], 'CODE_SIGN_ENTITLEMENTS': directory + '/PaperChat.entitlements', 'SWIFT_VERSION': '5.0', 'MACOSX_DEPLOYMENT_TARGET': '14.0', 'ENABLE_APP_SANDBOX': 'YES', 'PRODUCT_BUNDLE_IDENTIFIER': 'local.paperchat.PaperChat' + ('.Extension' if target is extension else ''), 'MARKETING_VERSION': '0.1.3', 'CURRENT_PROJECT_VERSION': '4'})
    entitlements = {'com.apple.security.app-sandbox': True, 'com.apple.security.network.client': True, 'com.apple.security.application-groups': [group]}
    if target is app:
        entitlements.update({'com.apple.security.network.server': True, 'com.apple.security.files.user-selected.read-write': True, 'com.apple.security.files.bookmarks.app-scope': True})
    with (project / directory / 'PaperChat.entitlements').open('wb') as f: plistlib.dump(entitlements, f)

info = project / 'PaperChat/Info.plist'
with info.open('rb') as f: host_info = plistlib.load(f)
host_info.pop('NSMainStoryboardFile', None)
host_info['CFBundleURLTypes'] = [{'CFBundleURLName': 'PaperChat setup', 'CFBundleURLSchemes': ['paperchat']}]
host_info['PaperChatAppGroup'] = group
host_info['LSUIElement'] = True
with info.open('wb') as f: plistlib.dump(host_info, f)
info = project / 'PaperChat Extension/Info.plist'
with info.open('rb') as f: extension_info = plistlib.load(f)
extension_info['PaperChatAppGroup'] = group
with info.open('wb') as f: plistlib.dump(extension_info, f)
with pbx.open('wb') as f: plistlib.dump(data, f, sort_keys=False)
print('Configured containing app, native bridge, sandbox and development signing.')
