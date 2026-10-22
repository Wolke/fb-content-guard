"""Package a configured cloud extension; unconfigured builds are development-only."""
from pathlib import Path
import argparse
import json
from urllib.parse import urlparse
import zipfile

args = argparse.ArgumentParser()
args.add_argument('--development', action='store_true')
options = args.parse_args()
root = Path(__file__).resolve().parents[1]
extension = root / 'extension'
manifest = json.loads((extension / 'manifest.json').read_text())
config = json.loads((extension / 'cloud-config.json').read_text())
origin = config.get('serviceOrigin', '')
url = urlparse(origin)
valid = url.scheme == 'https' and bool(url.hostname) and url.hostname not in ('localhost', '127.0.0.1', '::1') and not url.hostname.endswith('.invalid') and not url.username and not url.password and not url.port and not url.path and not url.params and not url.query and not url.fragment
if not options.development and manifest.get('version_name', '').endswith('-development'):
    raise SystemExit('Release blocked: development UI must not be enabled in a production package.')
if any('127.0.0.1' in p or 'localhost' in p for p in manifest['host_permissions']):
    raise SystemExit('Cloud package must not request localhost permissions.')
if not options.development and (not valid or origin + '/*' not in manifest['host_permissions']):
    raise SystemExit('Release blocked: configure the deployed HTTPS service with scripts/configure_cloud.py first. Use npm run package:dev only for local development.')
if config.get('consentVersion') != 'cloud-v1':
    raise SystemExit('Cloud consent version is missing.')
files = {'manifest.json', 'background.js', 'net.js', 'service-client.js', 'cloud-config.json',
         'content.js', 'content.css', 'popup.html', 'popup.js', 'popup.css', *manifest['icons'].values()}
for name in files:
    if not (extension / name).is_file():
        raise SystemExit(f'Missing extension file: {name}')
suffix = '-development' if options.development else ''
output = root / 'dist' / f"fb-content-guard-chrome-{manifest['version']}{suffix}.zip"
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(files):
        if name == 'manifest.json' and options.development:
            dev_manifest = {**manifest, 'name': manifest['name'] + '（開發測試，勿上架）',
                            'version_name': manifest['version'] + '-development'}
            archive.writestr(name, json.dumps(dev_manifest, ensure_ascii=False, indent=2))
        else:
            archive.write(extension / name, name)
with zipfile.ZipFile(output) as archive:
    packaged_manifest = json.loads(archive.read('manifest.json'))
    assert packaged_manifest.get('version_name', '').endswith('-development') == options.development
    assert archive.testzip() is None
    assert 'manifest.json' in archive.namelist()
    assert all(not name.endswith('.env') for name in archive.namelist())
print(output)
