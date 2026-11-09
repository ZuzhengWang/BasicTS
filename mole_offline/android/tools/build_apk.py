#!/usr/bin/env python3
"""Pack the offline APK (unsigned). Stored entries are 4-byte aligned and resources.arsc is stored
uncompressed (Android 11+ rejects compressed/unaligned resources.arsc with
INSTALL_PARSE_FAILED_RESOURCES_ARSC_COMPRESSED = -124).

usage: build_apk.py out.apk classes.dex AndroidManifest.xml original.apk web_dir client_dir
"""
import os, struct, sys, zlib, zipfile, time

out, dex, manifest, orig, web, client = sys.argv[1:7]

# client folders/files that are shipped (web pages, Windows launchers etc. are not)
CLIENT_ITEMS = ['Client.swf', 'crossdomain.xml', 'config', 'dll', 'login', 'module', 'res', 'staticRes', 'version']
STORE_EXT = {'.swf', '.png', '.jpg', '.jpeg', '.gif', '.mp3', '.wasm', '.ttf', '.arsc', '.zip'}


class Zip:
    def __init__(self, path):
        self.f = open(path, 'wb'); self.cd = []; self.names = set()

    def add(self, name, data, compress=None, raw=None):
        if name in self.names: return
        self.names.add(name)
        if compress is None: compress = os.path.splitext(name)[1].lower() not in STORE_EXT
        crc = zlib.crc32(data) & 0xffffffff if raw is None else raw[1]
        if raw is not None:            # pre-compressed (method, crc, csize, usize, bytes)
            method, crc, comp, usize = raw[0], raw[1], raw[4], raw[3]
        elif compress:
            c = zlib.compressobj(9, zlib.DEFLATED, -15); comp = c.compress(data) + c.flush(); method = 8; usize = len(data)
            if len(comp) >= len(data): comp, method = data, 0
        else:
            comp, method, usize = data, 0, len(data)
        fname = name.encode('utf8')
        off = self.f.tell()
        extra = b''
        if method == 0:
            pad = (4 - (off + 30 + len(fname)) % 4) % 4
            extra = b'\0' * pad
        dostime, dosdate = 0, (1981 - 1980) << 9 | 1 << 5 | 1
        flags = 0x800  # utf-8 names
        self.f.write(struct.pack('<IHHHHHIIIHH', 0x04034b50, 20 if method == 0 else 20, flags, method, dostime, dosdate,
                                 crc, len(comp), usize, len(fname), len(extra)) + fname + extra)
        self.f.write(comp)
        self.cd.append((fname, method, crc, len(comp), usize, off, flags, dostime, dosdate))

    def close(self):
        start = self.f.tell()
        for fname, method, crc, csz, usz, off, flags, t, d in self.cd:
            self.f.write(struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 20, 20, flags, method, t, d, crc, csz, usz,
                                     len(fname), 0, 0, 0, 0, 0, off) + fname)
        end = self.f.tell()
        n = len(self.cd)
        self.f.write(struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, n, n, end - start, start, 0))
        self.f.close()


z = Zip(out)
z.add('AndroidManifest.xml', open(manifest, 'rb').read(), compress=True)
z.add('classes.dex', open(dex, 'rb').read(), compress=True)
with zipfile.ZipFile(orig) as oz:
    z.add('resources.arsc', oz.read('resources.arsc'), compress=False)
    for info in oz.infolist():
        if info.filename.startswith('res/'):
            z.add(info.filename, oz.read(info.filename), compress=info.compress_type == 8)

count = 0; total = 0
def add_tree(base, rel_prefix, items=None):
    global count, total
    roots = items if items else sorted(os.listdir(base))
    for item in roots:
        p = os.path.join(base, item)
        if os.path.isdir(p):
            for dp, dns, fns in os.walk(p, followlinks=True):
                dns.sort()
                for fn in sorted(fns):
                    fp = os.path.join(dp, fn)
                    rel = os.path.relpath(fp, base).replace(os.sep, '/')
                    if fn.endswith('.map'): continue
                    data = open(fp, 'rb').read(); z.add('assets/game/' + rel_prefix + rel, data); count += 1; total += len(data)
        elif os.path.isfile(p):
            data = open(p, 'rb').read(); z.add('assets/game/' + rel_prefix + item, data); count += 1; total += len(data)

add_tree(web, '')                      # index.html, server/*.js, ruffle/* (web overrides client files of same name)
add_tree(client, '', [i for i in CLIENT_ITEMS if os.path.exists(os.path.join(client, i))])
z.close()
print('assets: %d files, %.1f MB; apk %.1f MB' % (count, total / 1e6, os.path.getsize(out) / 1e6))
