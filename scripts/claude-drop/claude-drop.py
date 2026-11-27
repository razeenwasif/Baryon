#!/usr/bin/env python3
"""Fairy's drop folder for claude.ai Docs and Designs (Fairy's desktop/claude-sync.mjs reads it).

The Claude desktop app's daily task downloads with its Artifact tool and calls this to file things away:
  known                                   what Fairy has: {url: {kind, title, version}} plus each Design's saved date
  set <url> <kind> <title> <updated>      record an artifact's kind and its claude.ai "updated" date (a Doc's version)
  refs <saved_folder>                     the uploads (/_blob/<id>) a Design's artboards use, one id per line
  design <saved_folder> <url> <version> <updated> <title> [assets_folder]
                                          file a downloaded Design: project/*, its runtime as project/support.js,
                                          its uploads as _blob/<id>; replaces the copy that was there
Docs need no download here: Fairy exports them herself when their date changes.
"""
import fcntl, json, os, re, shutil, sys, mimetypes

DROP = os.path.join(os.path.expanduser('~'), 'Library/Application Support/lyra-companion/face/claude-sync-drop')
LIST = os.path.join(DROP, '_typed.json')
URL = re.compile(r'^https://claude\.ai/(?:code/)?artifact/([A-Za-z0-9-]{8,64})$')
BLOB = re.compile(r'/_blob/([0-9a-f]{32})(?![0-9a-f])')

def key(url):
    m = URL.match(url.rstrip('/'))
    if not m: sys.exit(f'not a claude.ai artifact link: {url}')
    return m.group(1)

def load():
    try:
        with open(LIST) as f: return json.load(f)
    except Exception: return {'items': {}}

def save(data):
    os.makedirs(DROP, exist_ok=True)
    tmp = LIST + '.tmp'
    with open(tmp, 'w') as f: json.dump(data, f, indent=1)
    os.replace(tmp, LIST)

def known():
    data = load()
    for url, item in data.get('items', {}).items():
        meta = os.path.join(DROP, key(url), 'typed', 'meta.json')
        if os.path.exists(meta):
            with open(meta) as f: item['saved'] = json.load(f).get('updated', '')
    print(json.dumps(data.get('items', {}), indent=1))

def set_item(url, kind, title, updated):
    os.makedirs(DROP, exist_ok=True)
    # Several downloads may file things at once: one at a time through the list.
    with open(LIST + '.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = load()
        data.setdefault('items', {})[url.rstrip('/')] = {'kind': kind, 'title': title[:200], 'version': updated}
        save(data)
    print('ok')

def refs(saved):
    ids = set()
    for root, _, files in os.walk(os.path.join(saved, 'project')):
        for name in files:
            if name.endswith('.html'):
                with open(os.path.join(root, name), errors='ignore') as f: ids.update(BLOB.findall(f.read()))
    print('\n'.join(sorted(ids)))

def design(saved, url, version, updated, title, assets=None):
    k = key(url)
    project = os.path.join(saved, 'project')
    runtime = os.path.join(saved, 'artifact-type', 'dc-runtime.js')
    if not os.path.isdir(project) or not os.path.isfile(runtime): sys.exit('the saved folder needs project/ and artifact-type/dc-runtime.js')
    fresh = os.path.join(DROP, k, 'typed.new')
    shutil.rmtree(fresh, ignore_errors=True)
    shutil.copytree(project, os.path.join(fresh, 'files', 'project'))
    shutil.copyfile(runtime, os.path.join(fresh, 'files', 'project', 'support.js'))
    types = {}
    if assets and os.path.isdir(assets):
        os.makedirs(os.path.join(fresh, 'files', '_blob'), exist_ok=True)
        for name in os.listdir(assets):
            m = re.match(r'^([0-9a-f]{32})(\.[A-Za-z0-9]+)?$', name)
            if not m: continue
            shutil.copyfile(os.path.join(assets, name), os.path.join(fresh, 'files', '_blob', m.group(1)))
            kind = mimetypes.guess_type('x' + (m.group(2) or ''))[0]
            if kind: types[m.group(1)] = kind
    with open(os.path.join(fresh, 'meta.json'), 'w') as f:
        json.dump({'url': url.rstrip('/'), 'kind': 'design', 'title': title[:200], 'version': version, 'updated': updated, 'assets': types}, f)
    final = os.path.join(DROP, k, 'typed')
    shutil.rmtree(final, ignore_errors=True)
    os.replace(fresh, final)
    set_item(url, 'design', title, updated)

if __name__ == '__main__':
    a = sys.argv[1:]
    if not a: sys.exit(__doc__)
    if a[0] == 'known': known()
    elif a[0] == 'set' and len(a) == 5: set_item(*a[1:])
    elif a[0] == 'refs' and len(a) == 2: refs(a[1])
    elif a[0] == 'design' and len(a) in (6, 7): design(*a[1:])
    else: sys.exit(__doc__)
