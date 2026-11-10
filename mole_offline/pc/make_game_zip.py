#!/usr/bin/env python3
"""Pack web/ (overlay, wins on equal names) + the client folder into game.zip, split into raw 300 MiB
parts game.zip.001, .002... that the PC launcher reads in place. usage: make_game_zip.py web client outdir"""
import os, sys, zipfile
web, client, outdir = sys.argv[1:4]
ITEMS = ['Client.swf', 'crossdomain.xml', 'config', 'dll', 'login', 'module', 'res', 'staticRes', 'version']
STORE = {'.swf', '.png', '.jpg', '.jpeg', '.gif', '.mp3', '.zip', '.wasm', '.flv'}
os.makedirs(outdir, exist_ok=True)
zp = os.path.join(outdir, 'game.zip'); seen = set()
with zipfile.ZipFile(zp, 'w') as z:
    def add(fp, rel):
        if rel in seen or rel.endswith('.map'): return
        if rel.lower().startswith('res/minmap/') and rel.startswith('res/minMap/'): return  # Android-only alias
        seen.add(rel)
        ext = os.path.splitext(rel)[1].lower()
        z.write(fp, rel, zipfile.ZIP_STORED if ext in STORE else zipfile.ZIP_DEFLATED)
    def tree(base, items):
        for it in items:
            p = os.path.join(base, it)
            if os.path.isfile(p): add(p, it)
            elif os.path.isdir(p):
                for dp, dns, fns in os.walk(p, followlinks=True):
                    dns.sort()
                    for fn in sorted(fns):
                        fp = os.path.join(dp, fn); add(fp, os.path.relpath(fp, base).replace(os.sep, '/'))
    tree(web, sorted(os.listdir(web)))
    tree(client, [i for i in ITEMS if os.path.exists(os.path.join(client, i))])
PART = 300 * 1024 * 1024
with open(zp, 'rb') as f:
    i = 1
    while True:
        b = f.read(PART)
        if not b: break
        open(os.path.join(outdir, 'game.zip.%03d' % i), 'wb').write(b); i += 1
os.remove(zp)
print(len(seen), 'files,', i - 1, 'parts')
