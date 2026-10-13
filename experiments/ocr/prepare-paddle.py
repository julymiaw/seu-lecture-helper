"""Optional experiment dependency: onnx. Download existing weights; no training."""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path
import onnx

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.cache/ocr-candidates')
root.mkdir(parents=True, exist_ok=True)
models = json.loads(Path(__file__).with_name('paddle-models.json').read_text())
for model in models:
    path = root / (model['name'] + '.onnx')
    if not path.exists():
        temporary = path.with_suffix('.tmp')
        urllib.request.urlretrieve(model['url'], temporary)
        temporary.rename(path)
    data = path.read_bytes()
    if len(data) != model['bytes'] or hashlib.sha256(data).hexdigest() != model['sha256']:
        raise ValueError('Model integrity mismatch: ' + model['name'])
    metadata = {item.key: item.value for item in onnx.load(str(path)).metadata_props}
    characters = [''] + metadata['character'].splitlines() + [' ']
    (root / (model['name'] + '.json')).write_text(json.dumps(characters, ensure_ascii=False))
    model['file'] = str(path)
(root / 'manifest.json').write_text(json.dumps(models, indent=2) + '\n')
print('Verified pretrained models and dictionaries:', len(models))
