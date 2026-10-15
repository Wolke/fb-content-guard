"""Operator-only: verify a deployed endpoint before adding the narrow host permission."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

parser = argparse.ArgumentParser()
parser.add_argument('origin', help='Deployed HTTPS origin, with no trailing slash or path')
args = parser.parse_args()
u = urlparse(args.origin)
if u.scheme != 'https' or not u.hostname or u.hostname in ('localhost', '127.0.0.1', '::1') or u.hostname.endswith('.invalid') or u.username or u.password or u.port or u.path or u.query or u.fragment or u.params:
    raise SystemExit('A public HTTPS origin is required.')
with build_opener(NoRedirect()).open(Request(args.origin + '/v1/health',
        headers={'User-Agent': 'fb-content-guard-configure/0.2.0'}), timeout=20) as response:
    health = json.loads(response.read(4096))
if health.get('version') != '0.2.0' or health.get('consentVersion') != 'cloud-v1' or health.get('ok') is not True:
    raise SystemExit('Deployed endpoint version/consent check failed.')
root = Path(__file__).resolve().parents[1]
manifest_path = root / 'extension/manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['host_permissions'] = ['https://www.facebook.com/*', 'https://*.fbcdn.net/*', args.origin + '/*']
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
(root / 'extension/cloud-config.json').write_text(json.dumps({'serviceOrigin': args.origin, 'consentVersion': 'cloud-v1'}, indent=2) + '\n')
print('Cloud origin configured. Real browser/classification acceptance testing is still required before upload.')
