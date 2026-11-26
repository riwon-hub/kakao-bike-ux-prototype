"""Package the prototype's tracked static files for GitHub Pages."""
from pathlib import Path
import os
import re
import shutil
import subprocess
from urllib.parse import urlsplit

root = Path(__file__).resolve().parents[1]
output = root / '_site'
if output.exists():
    shutil.rmtree(output)
output.mkdir()
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
for name in filter(None, tracked):
    path = Path(name)
    if name.startswith('assets/') or (len(path.parts) == 1 and path.suffix in {'.html', '.css', '.js'}):
        target = output / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / path, target)

revision = os.environ.get('GITHUB_SHA') or subprocess.check_output(
    ['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
index = output / 'index.html'
html = index.read_text()

def version_asset(match):
    prefix, path, quote = match.groups()
    if urlsplit(path).scheme or path.startswith('//'):
        return match.group(0)
    return f'{prefix}{path}?v={revision[:12]}{quote}'

html = re.sub(r'''((?:src|href)=["'])([^"'?]+\.(?:css|js))(?:\?[^"']*)?(["'])''', version_asset, html)
index.write_text(html)
(output / '.nojekyll').write_text('')
for asset in re.findall(r'''(?:src|href)=["']([^"']+)["']''', html):
    parts = urlsplit(asset)
    if parts.scheme or parts.netloc or not parts.path or parts.path.startswith('#'):
        continue
    if not (output / parts.path).is_file():
        raise SystemExit(f'Missing static asset: {parts.path}')
print(f'Packaged prototype for revision {revision[:12]}: {output}')
