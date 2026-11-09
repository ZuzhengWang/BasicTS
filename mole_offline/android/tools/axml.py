#!/usr/bin/env python3
"""Android binary XML (AXML) reader and writer, enough for AndroidManifest.xml.

decode(bytes) -> list of events; dump(bytes) -> readable text
encode(tree) -> bytes, where tree = (tag, [(ns, name, resid, value)], [children]) and value is
  str (string), bool, int (int dec), ('ref', 0x7f...) resource reference, or ('hex', int).
"""
import struct

RES_STRING_POOL, RES_XML, RES_START_NS, RES_END_NS, RES_START_EL, RES_END_EL, RES_RES_MAP = 0x0001, 0x0003, 0x0100, 0x0101, 0x0102, 0x0103, 0x0180
T_REF, T_STRING, T_INT_DEC, T_INT_HEX, T_BOOL = 0x01, 0x03, 0x10, 0x11, 0x12
ANDROID_NS = 'http://schemas.android.com/apk/res/android'


def _read_pool(b, off):
    typ, hsz, sz, count, scount, flags, sstart, stystart = struct.unpack_from('<HHIIIIII', b, off)
    utf8 = flags & 0x100
    offs = struct.unpack_from('<%dI' % count, b, off + hsz)
    out = []
    for o in offs:
        p = off + sstart + o
        if utf8:
            n = b[p]; p += 1
            if n & 0x80: p += 1
            n = b[p]; p += 1
            if n & 0x80: n = ((n & 0x7f) << 8) | b[p]; p += 1
            out.append(b[p:p + n].decode('utf8', 'replace'))
        else:
            n = struct.unpack_from('<H', b, p)[0]; p += 2
            if n & 0x8000: n = ((n & 0x7fff) << 16) | struct.unpack_from('<H', b, p)[0]; p += 2
            out.append(b[p:p + 2 * n].decode('utf-16le', 'replace'))
    return out, sz


def dump(b):
    typ, hsz, total = struct.unpack_from('<HHI', b, 0)
    off = hsz
    strings, resmap, lines, depth = [], [], [], 0
    while off < total:
        t, h, sz = struct.unpack_from('<HHI', b, off)
        if t == RES_STRING_POOL:
            strings, _ = _read_pool(b, off)
        elif t == RES_RES_MAP:
            resmap = list(struct.unpack_from('<%dI' % ((sz - h) // 4), b, off + h))
        elif t == RES_START_EL:
            ns, name, aoff, asz, acount = struct.unpack_from('<IIHHH', b, off + 16)
            attrs = []
            for i in range(acount):
                ans, aname, araw, vsz, _, vtype, vdata = struct.unpack_from('<IIIHBBI', b, off + 16 + aoff + i * asz)
                nm = strings[aname]
                rid = resmap[aname] if aname < len(resmap) else 0
                if vtype == T_STRING: v = repr(strings[vdata])
                elif vtype == T_REF: v = '@0x%08x' % vdata
                elif vtype == T_BOOL: v = 'true' if vdata else 'false'
                elif vtype == T_INT_HEX: v = '0x%x' % vdata
                else: v = '%d(t%x)' % (vdata if vdata < 0x80000000 else vdata - 0x100000000, vtype)
                attrs.append('%s%s[0x%08x]=%s' % ('android:' if ans != 0xffffffff else '', nm, rid, v))
            lines.append('  ' * depth + '<' + strings[name] + ' ' + ' '.join(attrs) + '>')
            depth += 1
        elif t == RES_END_EL:
            depth -= 1
        off += sz
    return '\n'.join(lines)


# ------------------------------------------------------------------ writer
def _pool(strings):
    # UTF-16 pool (no styles)
    data = b''
    offs = []
    for s in strings:
        offs.append(len(data))
        e = s.encode('utf-16le')
        n = len(s.encode('utf-16le')) // 2
        data += struct.pack('<H', n) + e + b'\0\0'
    while len(data) % 4: data += b'\0'
    hsz = 28
    sstart = hsz + 4 * len(strings)
    body = struct.pack('<%dI' % len(strings), *offs) + data
    return struct.pack('<HHIIIIII', RES_STRING_POOL, hsz, hsz + len(body), len(strings), 0, 0, sstart, 0) + body


def encode(tree):
    # collect attribute names (with res ids first, in order), then other strings
    attr_names, others = [], []

    def walk(node):
        tag, attrs, kids = node
        for ns, name, rid, val in attrs:
            if rid and (name, rid) not in attr_names: attr_names.append((name, rid))
        for k in kids: walk(k)
    walk(tree)
    strings = [n for n, r in attr_names]

    def S(s):
        if s not in strings: strings.append(s)
        return strings.index(s)
    S('android'); S(ANDROID_NS)
    chunks = []
    ns_start = struct.pack('<HHIII', RES_START_NS, 16, 24, 1, 0xffffffff) + struct.pack('<II', S('android'), S(ANDROID_NS))

    def el(node):
        tag, attrs, kids = node
        out = []
        recs = []
        # attributes must be sorted by resource id
        def key(a):
            return (a[2] if a[2] else 0xffffffff, a[1])
        for ns, name, rid, val in sorted(attrs, key=key):
            nsi = S(ANDROID_NS) if ns else 0xffffffff
            ni = strings.index(name) if (name, rid) in attr_names else S(name)
            if isinstance(val, bool): raw, vt, vd = 0xffffffff, T_BOOL, 0xffffffff if val else 0
            elif isinstance(val, int): raw, vt, vd = 0xffffffff, T_INT_DEC, val & 0xffffffff
            elif isinstance(val, tuple) and val[0] == 'ref': raw, vt, vd = 0xffffffff, T_REF, val[1]
            elif isinstance(val, tuple) and val[0] == 'hex': raw, vt, vd = 0xffffffff, T_INT_HEX, val[1]
            else: si = S(val); raw, vt, vd = si, T_STRING, si
            recs.append(struct.pack('<IIIHBBI', nsi, ni, raw, 8, 0, vt, vd))
        start = struct.pack('<HHIII', RES_START_EL, 16, 36 + 20 * len(recs), 1, 0xffffffff)
        start += struct.pack('<IIHHHHHH', 0xffffffff, S(tag), 20, 20, len(recs), 0, 0, 0) + b''.join(recs)
        out.append(start)
        for k in kids: out += el(k)
        out.append(struct.pack('<HHIII', RES_END_EL, 16, 24, 1, 0xffffffff) + struct.pack('<II', 0xffffffff, S(tag)))
        return out
    body_chunks = el(tree)
    ns_end = struct.pack('<HHIII', RES_END_NS, 16, 24, 1, 0xffffffff) + struct.pack('<II', S('android'), S(ANDROID_NS))
    pool = _pool(strings)
    resmap = struct.pack('<HHI', RES_RES_MAP, 8, 8 + 4 * len(attr_names)) + struct.pack('<%dI' % len(attr_names), *[r for n, r in attr_names])
    body = pool + resmap + ns_start + b''.join(body_chunks) + ns_end
    return struct.pack('<HHI', RES_XML, 8, 8 + len(body)) + body


if __name__ == '__main__':
    import sys
    print(dump(open(sys.argv[1], 'rb').read()))
