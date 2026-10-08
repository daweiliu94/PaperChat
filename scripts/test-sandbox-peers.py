"""Cross-process IPC check. Only synthetic socket messages; no account/history access."""
from pathlib import Path
import json, os, plistlib, selectors, subprocess, tempfile, uuid

root = Path(__file__).resolve().parent.parent
os.chdir(root)
signing = json.loads(subprocess.check_output(['python3', 'scripts/signing-info.py']))
with tempfile.TemporaryDirectory(prefix='PaperChatPeerTest-', dir='/Applications') as temporary:
    stage = Path(temporary)
    (stage / 'signing.json').write_text(json.dumps(signing))
    subprocess.run(['python3', 'scripts/configure-xcode.py', str(stage / 'signing.json')], check=True, stdout=subprocess.DEVNULL)
    executable = stage / 'Fixture'
    subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', '-parse-as-library', '-module-cache-path', str(stage / 'modules'), 'native/BuildSigning.swift', 'native/BridgeProtocol.swift', 'tests/SandboxPeerFixture.swift', '-o', str(executable)], check=True)
    entitlement = stage / 'fixture.entitlements'
    entitlement.write_bytes(plistlib.dumps({'com.apple.security.app-sandbox': True, 'com.apple.security.network.client': True, 'com.apple.security.network.server': True, 'com.apple.security.application-groups': [signing['team'] + '.paperchat.shared']}))

    def bundle(name, identifier, sandbox=True):
        app = stage / (name + '.app')
        binary = app / 'Contents/MacOS/Fixture'
        binary.parent.mkdir(parents=True)
        binary.write_bytes(executable.read_bytes())
        binary.chmod(0o755)
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleExecutable': 'Fixture', 'CFBundleIdentifier': identifier, 'CFBundleName': name, 'CFBundlePackageType': 'APPL', 'CFBundleInfoDictionaryVersion': '6.0', 'PaperChatAppGroup': signing['team'] + '.paperchat.shared'}))
        command = ['codesign', '--force', '--sign', signing['identity'] if sandbox else '-', '--timestamp=none']
        if sandbox: command += ['--entitlements', str(entitlement)]
        subprocess.run(command + [str(app)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return binary

    server_binary = bundle('Server', 'local.paperchat.PeerFixture.Server')
    client_binary = bundle('Client', 'local.paperchat.PeerFixture.Client')
    rogue_binary = bundle('Rogue', 'local.paperchat.PeerFixture.Rogue')
    impersonator_binary = bundle('Impersonator', 'local.paperchat.PeerFixture.Client', sandbox=False)
    server = subprocess.Popen([str(server_binary), 'server', 'fixture-' + uuid.uuid4().hex[:8] + '.sock'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    selector = selectors.DefaultSelector()
    selector.register(server.stdout, selectors.EVENT_READ)
    try:
        assert selector.select(15), 'Sandboxed server did not start.'
        ready = server.stdout.readline().strip()
        assert ready.startswith('READY '), 'Sandboxed server did not report its fixture endpoint.'
        socket = ready.removeprefix('READY ')
        valid = subprocess.run([str(client_binary), 'client', socket], capture_output=True, text=True, timeout=15)
        assert valid.returncode == 0 and 'CONNECTED\nROUNDTRIP' in valid.stdout, 'Sandboxed peers failed round trip.'
        assert selector.select(5) and server.stdout.readline().strip() == 'HANDLED', 'Valid peer did not reach the request handler.'
        for binary in [rogue_binary, impersonator_binary]:
            rejected = subprocess.run([str(binary), 'reject', socket], capture_output=True, text=True, timeout=15)
            assert rejected.returncode == 0 and 'CONNECTED\nREJECTED' in rejected.stdout, 'Untrusted peer was not rejected after connecting to the authenticated server.'
            assert not selector.select(0.2), 'An untrusted peer reached the request handler.'
        print('PASS: distinct sandboxed peers; wrong identifier and same-identifier ad hoc signer rejected before handling')
    finally:
        selector.close()
        server.terminate()
        server.wait(timeout=5)
