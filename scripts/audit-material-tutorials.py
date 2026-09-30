"""Read-only integrity audit of the isolated installed tutorial profile."""
import hashlib
import json
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
work = root / '.preshot-build-cache/material-tutorials-0.0.20'
profile = work / 'profile/.preshot'
library = profile / 'library'

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

with sqlite3.connect((library / 'library.db').as_uri() + '?mode=ro', uri=True) as db:
    assert db.execute('pragma integrity_check').fetchone()[0] == 'ok'
    materials = [json.loads(row[0]) for row in db.execute('select detail_json from materials')]
    locations = {row[0]: row[1] for row in db.execute('select storage_id,material_id from group_instance_locations')}
    version = db.execute('pragma user_version').fetchone()[0]
    purged = db.execute('select count(*) from purge_receipts').fetchone()[0]

owned = set()
checked = []
for material in materials:
    for image in material['images']:
        identity = image['storageId']
        assert identity not in owned, 'Two materials share an original instance'
        owned.add(identity)
        extension = '.jpg' if image['mimeType'] == 'image/jpeg' else '.png'
        if identity in locations:
            path = library / 'groups' / locations[identity] / 'originals' / (identity + extension)
        else:
            path = library / 'instances' / identity[:2] / (identity + extension)
        assert path.is_file(), path
        assert path.stat().st_size == image['byteLength'], path
        assert digest(path) == image['blobId'], path
        checked.append({'material': material['name'], 'storageId': identity,
                        'sha256': image['blobId'], 'bytes': image['byteLength']})

def references(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in ('file', 'url') and isinstance(item, str) and item.startswith(('media/', 'references/')):
                yield item
            else:
                yield from references(item)
    elif isinstance(value, list):
        for item in value:
            yield from references(item)

projects = []
for manifest in (profile / 'projects').glob('*/.preshotproj'):
    data = json.loads(manifest.read_text(encoding='utf-8'))
    images = []
    for filename in sorted(set(references(data['plan']))):
        path = (manifest.parent / filename).resolve()
        assert path.is_relative_to(manifest.parent.resolve()), path
        assert path.is_file(), path
        images.append({'file': filename, 'sha256': digest(path), 'bytes': path.stat().st_size})
    projects.append({'name': manifest.parent.name, 'images': images})

report = {'databaseVersion': version, 'databaseIntegrity': 'ok', 'materialCount': len(materials),
          'purgeReceipts': purged, 'distinctOriginalInstances': len(owned),
          'materials': [{'name': m['name'], 'kind': m['kind'], 'revision': m['revision'],
                         'metadataVersion': m['metadataVersion'], 'imageCount': m['imageCount']} for m in materials],
          'originals': checked, 'projects': projects}
destination = root / 'docs/test_reports/media/material-tutorials'
destination.mkdir(parents=True, exist_ok=True)
(destination / 'integrity.json').write_text(json.dumps(report, ensure_ascii=True, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: report[key] for key in ('databaseIntegrity', 'materialCount', 'distinctOriginalInstances', 'purgeReceipts')}))
