#!/usr/bin/env python3
"""Losslessly re-compress a CWS (zlib) SWF as ZWS (LZMA). Returns None if not smaller / not CWS."""
import lzma, struct, sys, zlib

def to_zws(data):
    if data[:3] != b'CWS':
        return None
    body = zlib.decompress(data[8:])
    ver = data[3]
    filt = [{'id': lzma.FILTER_LZMA1, 'preset': 9 | lzma.PRESET_EXTREME, 'dict_size': 1 << 23}]
    comp = lzma.compress(body, format=lzma.FORMAT_RAW, filters=filt)
    props = lzma._encode_filter_properties(filt[0])
    out = b'ZWS' + bytes([max(ver, 13)]) + struct.pack('<I', len(body) + 8) + struct.pack('<I', len(comp)) + props + comp
    return out if len(out) < len(data) else None

if __name__ == '__main__':
    tot = new = 0
    for p in sys.argv[1:]:
        d = open(p, 'rb').read(); z = to_zws(d)
        tot += len(d); new += len(z) if z else len(d)
    print('%.1fMB -> %.1fMB (%.0f%%)' % (tot / 1e6, new / 1e6, 100 * new / max(tot, 1)))
