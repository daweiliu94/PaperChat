"""Select an existing development identity; inspect only public certificate metadata."""
import subprocess, re, hashlib, base64, json
listing = subprocess.check_output(['security', 'find-identity', '-v', '-p', 'codesigning'], text=True)
identities = re.findall(r'([0-9A-F]{40})\s+"([^"\n]+)"', listing)
for kind in ['Apple Development', 'Developer ID Application', 'Mac Developer']:
    candidates = [fingerprint for fingerprint, name in identities if name.startswith(kind + ':')]
    if not candidates: continue
    certs = subprocess.run(['security', 'find-certificate', '-a', '-c', kind, '-p'], capture_output=True, text=True).stdout
    for pem in re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', certs, re.S):
        der = base64.b64decode(''.join(pem.splitlines()[1:-1]))
        fingerprint = hashlib.sha1(der).hexdigest().upper()
        if fingerprint not in candidates: continue
        subject = subprocess.run(['/usr/bin/openssl', 'x509', '-noout', '-subject'], input=pem, capture_output=True, text=True).stdout
        team = re.search(r'OU\s*=\s*([A-Z0-9]{10})', subject)
        if team:
            print(json.dumps({'identity': fingerprint, 'team': team.group(1)}))
            raise SystemExit(0)
raise SystemExit('No development signing identity found. Add a free Personal Team in Xcode and create a development certificate before building.')
