#!/usr/bin/env python3
"""Minimal SWF + ABC (AVM2 bytecode) reader / disassembler.

Written for analysing the Mole Hero client without third-party tools.
Supports: FWS/CWS/ZWS SWF, tag iteration, DoABC/DoABC2, full ABC parsing,
method body disassembly, and SymbolClass extraction.
"""
import struct
import sys
import zlib
import lzma


# ---------------------------------------------------------------- SWF level
def read_swf(data):
    sig = data[:3]
    ver = data[3]
    length = struct.unpack('<I', data[4:8])[0]
    if sig == b'FWS':
        body = data[8:]
    elif sig == b'CWS':
        body = zlib.decompress(data[8:])
    elif sig == b'ZWS':
        # ZWS: 4 bytes compressed len, 5 bytes lzma props, then raw lzma
        props = data[12:17]
        filt = lzma._decode_filter_properties(lzma.FILTER_LZMA1, props)
        body = lzma.LZMADecompressor(lzma.FORMAT_RAW, filters=[filt]).decompress(data[17:])
    else:
        raise ValueError('not a swf: %r' % sig)
    return sig, ver, length, body


def iter_tags(body):
    # skip RECT
    nbits = body[0] >> 3
    rect_bytes = (5 + nbits * 4 + 7) // 8
    pos = rect_bytes + 4  # frame rate + frame count
    while pos < len(body):
        code_len = struct.unpack('<H', body[pos:pos + 2])[0]
        code = code_len >> 6
        ln = code_len & 0x3f
        hdr = 2
        if ln == 0x3f:
            ln = struct.unpack('<I', body[pos + 2:pos + 6])[0]
            hdr = 6
        yield code, pos, hdr, body[pos + hdr:pos + hdr + ln]
        pos += hdr + ln
        if code == 0:
            break


def abc_blocks(body):
    for code, pos, hdr, data in iter_tags(body):
        if code == 82:  # DoABC2
            flags = struct.unpack('<I', data[:4])[0]
            end = data.index(b'\0', 4)
            name = data[4:end].decode('utf8', 'replace')
            yield name, data[end + 1:], pos, hdr
        elif code == 72:
            yield '', data, pos, hdr


def symbol_classes(body):
    out = {}
    for code, pos, hdr, data in iter_tags(body):
        if code == 76:
            n = struct.unpack('<H', data[:2])[0]
            p = 2
            for _ in range(n):
                cid = struct.unpack('<H', data[p:p + 2])[0]
                e = data.index(b'\0', p + 2)
                out[data[p + 2:e].decode('utf8', 'replace')] = cid
                p = e + 1
    return out


# ---------------------------------------------------------------- ABC level
class R:
    def __init__(self, b, p=0):
        self.b = b
        self.p = p

    def u8(self):
        v = self.b[self.p]
        self.p += 1
        return v

    def u16(self):
        v = struct.unpack('<H', self.b[self.p:self.p + 2])[0]
        self.p += 2
        return v

    def s24(self):
        v = self.b[self.p] | (self.b[self.p + 1] << 8) | (self.b[self.p + 2] << 16)
        if v & 0x800000:
            v -= 0x1000000
        self.p += 3
        return v

    def u30(self):
        r = 0
        for i in range(5):
            c = self.b[self.p]
            self.p += 1
            r |= (c & 0x7f) << (7 * i)
            if not c & 0x80:
                break
        return r & 0xffffffff

    def s32(self):
        v = self.u30()
        if v & 0x80000000:
            v -= 0x100000000
        return v

    def d64(self):
        v = struct.unpack('<d', self.b[self.p:self.p + 8])[0]
        self.p += 8
        return v

    def bytes(self, n):
        v = self.b[self.p:self.p + n]
        self.p += n
        return v


NS_KINDS = {0x08: 'ns', 0x16: 'pkg', 0x17: 'pkgint', 0x18: 'prot', 0x19: 'exp', 0x1a: 'sprot', 0x05: 'priv'}


class ABC:
    def __init__(self, data):
        r = R(data)
        self.minor, self.major = r.u16(), r.u16()
        n = r.u30(); self.ints = [0] + [r.s32() for _ in range(max(0, n - 1))]
        n = r.u30(); self.uints = [0] + [r.u30() for _ in range(max(0, n - 1))]
        n = r.u30(); self.doubles = [0.0] + [r.d64() for _ in range(max(0, n - 1))]
        self.off = {}
        self.off['str'] = r.p
        n = r.u30(); self.strings = [None]
        for _ in range(max(0, n - 1)):
            ln = r.u30()
            self.strings.append(r.bytes(ln).decode('utf8', 'replace'))
        self.off['str_end'] = r.p
        n = r.u30(); self.ns = [(0, None)]
        for _ in range(max(0, n - 1)):
            k = r.u8(); self.ns.append((k, r.u30()))
        n = r.u30(); self.nssets = [[]]
        for _ in range(max(0, n - 1)):
            c = r.u30(); self.nssets.append([r.u30() for _ in range(c)])
        self.off['mn'] = r.p
        n = r.u30(); self.mn = [None]
        for _ in range(max(0, n - 1)):
            k = r.u8()
            if k in (0x07, 0x0D):
                self.mn.append(('Q', r.u30(), r.u30()))
            elif k in (0x0F, 0x10):
                self.mn.append(('RTQ', r.u30()))
            elif k in (0x11, 0x12):
                self.mn.append(('RTQL',))
            elif k in (0x09, 0x0E):
                name = r.u30(); self.mn.append(('M', name, r.u30()))
            elif k in (0x1B, 0x1C):
                self.mn.append(('ML', r.u30()))
            elif k == 0x1D:
                base = r.u30(); c = r.u30(); self.mn.append(('G', base, [r.u30() for _ in range(c)]))
            else:
                raise ValueError('mn kind %x' % k)
        self.off['mn_end'] = r.p
        n = r.u30(); self.methods = []
        for _ in range(n):
            pc = r.u30(); ret = r.u30(); params = [r.u30() for _ in range(pc)]
            name = r.u30(); flags = r.u8()
            opts = []
            if flags & 0x08:
                oc = r.u30(); opts = [(r.u30(), r.u8()) for _ in range(oc)]
            pnames = []
            if flags & 0x80:
                pnames = [r.u30() for _ in range(pc)]
            self.methods.append(dict(params=params, ret=ret, name=name, flags=flags, opts=opts, pnames=pnames, body=None))
        n = r.u30(); self.metadata = []
        for _ in range(n):
            name = r.u30(); c = r.u30()
            keys = [r.u30() for _ in range(c)]; vals = [r.u30() for _ in range(c)]
            self.metadata.append((name, keys, vals))
        n = r.u30(); self.instances = []
        for _ in range(n):
            name = r.u30(); sup = r.u30(); flags = r.u8()
            pns = r.u30() if flags & 0x08 else 0
            ic = r.u30(); ifs = [r.u30() for _ in range(ic)]
            iinit = r.u30(); traits = self.read_traits(r)
            self.instances.append(dict(name=name, super=sup, flags=flags, pns=pns, ifs=ifs, iinit=iinit, traits=traits))
        self.classes = []
        for _ in range(n):
            cinit = r.u30(); self.classes.append(dict(cinit=cinit, traits=self.read_traits(r)))
        n = r.u30(); self.scripts = []
        for _ in range(n):
            init = r.u30(); self.scripts.append(dict(init=init, traits=self.read_traits(r)))
        n = r.u30(); self.bodies = []
        for _ in range(n):
            m = r.u30(); ms = r.u30(); lc = r.u30(); isd = r.u30(); msd = r.u30()
            cl = r.u30(); code_off = r.p; code = r.bytes(cl)
            ec = r.u30(); exc = [(r.u30(), r.u30(), r.u30(), r.u30(), r.u30()) for _ in range(ec)]
            traits = self.read_traits(r)
            b = dict(method=m, max_stack=ms, locals=lc, init_scope=isd, max_scope=msd, code=code, code_off=code_off, exc=exc, traits=traits)
            self.bodies.append(b)
            self.methods[m]['body'] = b
        self.end = r.p

    def read_traits(self, r):
        out = []
        for _ in range(r.u30()):
            name = r.u30(); kind = r.u8(); k = kind & 0x0f
            t = dict(name=name, kind=k, attr=kind >> 4)
            if k in (0, 6):
                t['slot'] = r.u30(); t['type'] = r.u30(); t['vindex'] = r.u30()
                if t['vindex']:
                    t['vkind'] = r.u8()
            elif k in (1, 2, 3):
                t['disp'] = r.u30(); t['method'] = r.u30()
            elif k == 4:
                t['slot'] = r.u30(); t['cls'] = r.u30()
            elif k == 5:
                t['slot'] = r.u30(); t['func'] = r.u30()
            if kind >> 4 & 0x04:
                t['meta'] = [r.u30() for _ in range(r.u30())]
            out.append(t)
        return out

    # ---- naming helpers
    def nsname(self, i):
        k, s = self.ns[i]
        return self.strings[s] if s else ''

    def mname(self, i):
        if i == 0:
            return '*'
        m = self.mn[i]
        if m[0] == 'Q':
            ns = self.nsname(m[1]) if m[1] else ''
            n = self.strings[m[2]] if m[2] else '*'
            return (ns + '::' + n) if ns else n
        if m[0] in ('RTQ', 'M'):
            return self.strings[m[1]] if m[1] else '*'
        if m[0] == 'G':
            return self.mname(m[1]) + '.<' + ','.join(self.mname(x) for x in m[2]) + '>'
        return '<%s>' % m[0]

    def short(self, i):
        n = self.mname(i)
        return n.split('::')[-1]

    def class_name(self, ci):
        return self.mname(self.instances[ci]['name'])


# ---------------------------------------------------------------- disassembler
# opcode: (name, operand spec)  spec letters: u=u30 mn, s=string, i=int, U=uint,
# d=double, b=s24 branch, B=byte, n=u30 plain, m=method, c=class, x=lookupswitch
OPS = {
    0x01: ('bkpt', ''), 0x02: ('nop', ''), 0x03: ('throw', ''), 0x04: ('getsuper', 'u'),
    0x05: ('setsuper', 'u'), 0x06: ('dxns', 's'), 0x07: ('dxnslate', ''), 0x08: ('kill', 'n'),
    0x09: ('label', ''), 0x0c: ('ifnlt', 'b'), 0x0d: ('ifnle', 'b'), 0x0e: ('ifngt', 'b'),
    0x0f: ('ifnge', 'b'), 0x10: ('jump', 'b'), 0x11: ('iftrue', 'b'), 0x12: ('iffalse', 'b'),
    0x13: ('ifeq', 'b'), 0x14: ('ifne', 'b'), 0x15: ('iflt', 'b'), 0x16: ('ifle', 'b'),
    0x17: ('ifgt', 'b'), 0x18: ('ifge', 'b'), 0x19: ('ifstricteq', 'b'), 0x1a: ('ifstrictne', 'b'),
    0x1b: ('lookupswitch', 'x'), 0x1c: ('pushwith', ''), 0x1d: ('popscope', ''), 0x1e: ('nextname', ''),
    0x1f: ('hasnext', ''), 0x20: ('pushnull', ''), 0x21: ('pushundefined', ''), 0x23: ('nextvalue', ''),
    0x24: ('pushbyte', 'B'), 0x25: ('pushshort', 'n'), 0x26: ('pushtrue', ''), 0x27: ('pushfalse', ''),
    0x28: ('pushnan', ''), 0x29: ('pop', ''), 0x2a: ('dup', ''), 0x2b: ('swap', ''),
    0x2c: ('pushstring', 's'), 0x2d: ('pushint', 'i'), 0x2e: ('pushuint', 'U'), 0x2f: ('pushdouble', 'd'),
    0x30: ('pushscope', ''), 0x31: ('pushnamespace', 'n'), 0x32: ('hasnext2', 'nn'),
    0x35: ('li8', ''), 0x36: ('li16', ''), 0x37: ('li32', ''), 0x38: ('lf32', ''), 0x39: ('lf64', ''),
    0x3a: ('si8', ''), 0x3b: ('si16', ''), 0x3c: ('si32', ''), 0x3d: ('sf32', ''), 0x3e: ('sf64', ''),
    0x40: ('newfunction', 'm'), 0x41: ('call', 'n'), 0x42: ('construct', 'n'), 0x43: ('callmethod', 'nn'),
    0x44: ('callstatic', 'mn'), 0x45: ('callsuper', 'un'), 0x46: ('callproperty', 'un'), 0x47: ('returnvoid', ''),
    0x48: ('returnvalue', ''), 0x49: ('constructsuper', 'n'), 0x4a: ('constructprop', 'un'),
    0x4c: ('callproplex', 'un'), 0x4e: ('callsupervoid', 'un'), 0x4f: ('callpropvoid', 'un'),
    0x50: ('sxi1', ''), 0x51: ('sxi8', ''), 0x52: ('sxi16', ''), 0x53: ('applytype', 'n'),
    0x55: ('newobject', 'n'), 0x56: ('newarray', 'n'), 0x57: ('newactivation', ''), 0x58: ('newclass', 'c'),
    0x59: ('getdescendants', 'u'), 0x5a: ('newcatch', 'n'), 0x5d: ('findpropstrict', 'u'), 0x5e: ('findproperty', 'u'),
    0x5f: ('finddef', 'u'), 0x60: ('getlex', 'u'), 0x61: ('setproperty', 'u'), 0x62: ('getlocal', 'n'),
    0x63: ('setlocal', 'n'), 0x64: ('getglobalscope', ''), 0x65: ('getscopeobject', 'B'), 0x66: ('getproperty', 'u'),
    0x67: ('getouterscope', 'n'), 0x68: ('initproperty', 'u'), 0x6a: ('deleteproperty', 'u'), 0x6c: ('getslot', 'n'),
    0x6d: ('setslot', 'n'), 0x6e: ('getglobalslot', 'n'), 0x6f: ('setglobalslot', 'n'), 0x70: ('convert_s', ''),
    0x71: ('esc_xelem', ''), 0x72: ('esc_xattr', ''), 0x73: ('convert_i', ''), 0x74: ('convert_u', ''),
    0x75: ('convert_d', ''), 0x76: ('convert_b', ''), 0x77: ('convert_o', ''), 0x78: ('checkfilter', ''),
    0x80: ('coerce', 'u'), 0x81: ('coerce_b', ''), 0x82: ('coerce_a', ''), 0x83: ('coerce_i', ''),
    0x84: ('coerce_d', ''), 0x85: ('coerce_s', ''), 0x86: ('astype', 'u'), 0x87: ('astypelate', ''),
    0x88: ('coerce_u', ''), 0x89: ('coerce_o', ''), 0x90: ('negate', ''), 0x91: ('increment', ''),
    0x92: ('inclocal', 'n'), 0x93: ('decrement', ''), 0x94: ('declocal', 'n'), 0x95: ('typeof', ''),
    0x96: ('not', ''), 0x97: ('bitnot', ''), 0xa0: ('add', ''), 0xa1: ('subtract', ''), 0xa2: ('multiply', ''),
    0xa3: ('divide', ''), 0xa4: ('modulo', ''), 0xa5: ('lshift', ''), 0xa6: ('rshift', ''), 0xa7: ('urshift', ''),
    0xa8: ('bitand', ''), 0xa9: ('bitor', ''), 0xaa: ('bitxor', ''), 0xab: ('equals', ''), 0xac: ('strictequals', ''),
    0xad: ('lessthan', ''), 0xae: ('lessequals', ''), 0xaf: ('greaterthan', ''), 0xb0: ('greaterequals', ''),
    0xb1: ('instanceof', ''), 0xb2: ('istype', 'u'), 0xb3: ('istypelate', ''), 0xb4: ('in', ''),
    0xc0: ('increment_i', ''), 0xc1: ('decrement_i', ''), 0xc2: ('inclocal_i', 'n'), 0xc3: ('declocal_i', 'n'),
    0xc4: ('negate_i', ''), 0xc5: ('add_i', ''), 0xc6: ('subtract_i', ''), 0xc7: ('multiply_i', ''),
    0xd0: ('getlocal0', ''), 0xd1: ('getlocal1', ''), 0xd2: ('getlocal2', ''), 0xd3: ('getlocal3', ''),
    0xd4: ('setlocal0', ''), 0xd5: ('setlocal1', ''), 0xd6: ('setlocal2', ''), 0xd7: ('setlocal3', ''),
    0xef: ('debug', 'BsBn'), 0xf0: ('debugline', 'n'), 0xf1: ('debugfile', 's'), 0xf2: ('bkptline', 'n'), 0xf3: ('timestamp', ''),
}


def disasm(abc, code):
    r = R(code)
    out = []
    while r.p < len(code):
        at = r.p
        op = r.u8()
        if op not in OPS:
            out.append((at, 'op_%02x' % op, []))
            continue
        name, spec = OPS[op]
        args = []
        for c in spec:
            if c == 'u':
                v = r.u30(); args.append(abc.mname(v))
            elif c == 's':
                v = r.u30(); args.append(repr(abc.strings[v]))
            elif c == 'i':
                args.append(abc.ints[r.u30()])
            elif c == 'U':
                args.append(abc.uints[r.u30()])
            elif c == 'd':
                args.append(abc.doubles[r.u30()])
            elif c == 'b':
                off = r.s24(); args.append('L%d' % (r.p + off))
            elif c == 'B':
                v = r.u8(); args.append(v - 256 if v > 127 else v)
            elif c in 'nmc':
                args.append(r.u30())
            elif c == 'x':
                base = at
                d = r.s24(); cc = r.u30()
                tg = [r.s24() for _ in range(cc + 1)]
                args.append('default:L%d' % (base + d))
                args += ['L%d' % (base + t) for t in tg]
        out.append((at, name, args))
    return out


def method_label(abc, owner, t):
    return '%s/%s' % (owner, abc.short(t['name']))


def iter_methods(abc):
    """yield (label, method_index)"""
    for ci, inst in enumerate(abc.instances):
        cn = abc.mname(inst['name'])
        yield cn + '/<init>', inst['iinit']
        yield cn + '/<cinit>', abc.classes[ci]['cinit']
        for t in inst['traits']:
            if t['kind'] in (1, 2, 3):
                yield cn + '/' + abc.short(t['name']) + ('' if t['kind'] == 1 else ('<get>' if t['kind'] == 2 else '<set>')), t['method']
        for t in abc.classes[ci]['traits']:
            if t['kind'] in (1, 2, 3):
                yield cn + '/static ' + abc.short(t['name']), t['method']
    for si, s in enumerate(abc.scripts):
        yield 'script%d/<init>' % si, s['init']


def dump_method(abc, mi, out=sys.stdout):
    m = abc.methods[mi]
    b = m['body']
    if not b:
        out.write('   (no body)\n')
        return
    for at, name, args in disasm(abc, b['code']):
        out.write('   %5d %s %s\n' % (at, name, ' '.join(str(a) for a in args)))


def load(path):
    data = open(path, 'rb').read()
    sig, ver, ln, body = read_swf(data)
    return body, [(n, ABC(d), p, h) for n, d, p, h in abc_blocks(body)]


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('swf')
    ap.add_argument('cmd', choices=['classes', 'strings', 'dump', 'tags', 'grep'])
    ap.add_argument('arg', nargs='?')
    a = ap.parse_args()
    body, abcs = load(a.swf)
    if a.cmd == 'tags':
        from collections import Counter
        print(Counter(c for c, *_ in iter_tags(body)))
        for n, abc, p, h in abcs:
            print('ABC', repr(n), len(abc.instances), 'classes')
    for n, abc, p, h in abcs:
        if a.cmd == 'classes':
            for inst in abc.instances:
                print(abc.mname(inst['name']), 'extends', abc.mname(inst['super']))
        elif a.cmd == 'strings':
            for s in abc.strings[1:]:
                print(repr(s))
        elif a.cmd == 'dump':
            for label, mi in iter_methods(abc):
                if a.arg is None or a.arg in label:
                    print('== %s (m%d)' % (label, mi))
                    dump_method(abc, mi)
        elif a.cmd == 'grep':
            # find methods referencing a string / name
            for label, mi in iter_methods(abc):
                b = abc.methods[mi]['body']
                if not b:
                    continue
                txt = ' '.join(' '.join(map(str, x[2])) for x in disasm(abc, b['code']))
                if a.arg in txt:
                    print(label)
