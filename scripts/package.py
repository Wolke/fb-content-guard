"""Build a Chrome Web Store ZIP with manifest.json at the archive root."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parents[1]
extension = root / "extension"
manifest = json.loads((extension / "manifest.json").read_text())
files = {
    "manifest.json", "background.js", "net.js", "content.js", "content.css",
    "popup.html", "popup.js", "popup.css", *manifest["icons"].values(),
}
for name in files:
    if not (extension / name).is_file():
        raise SystemExit(f"Missing extension file: {name}")
output = root / "dist" / f"fb-content-guard-chrome-{manifest['version']}.zip"
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(files):
        archive.write(extension / name, name)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert "manifest.json" in archive.namelist()
    assert all(not name.endswith('.env') for name in archive.namelist())
print(output)
