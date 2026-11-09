#!/usr/bin/env python3
"""Decrypt Mole Hero config files (utils::DllLoader.doDec): XOR with the trailing 16-byte key, drop last 20 bytes.
usage: decxml.py in_dir out_dir"""
import os, sys
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
for f in sorted(os.listdir(src)):
    p = os.path.join(src, f)
    if not os.path.isfile(p): continue
    d = bytearray(open(p, 'rb').read())
    if d.lstrip()[:1] in (b'<', b'{') or d[:3] == b'\xef\xbb\xbf':
        out = bytes(d)
    else:
        key = d[-16:]
        out = bytes(b ^ key[i % 16] for i, b in enumerate(d))[:-20]
    open(os.path.join(dst, f), 'wb').write(out)
    print(f, len(out), out[:60])
