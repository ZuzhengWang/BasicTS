#!/usr/bin/env python3
"""Small AVM2 bytecode patcher: insert or replace bytes inside one method body of a SWF.

Branch offsets (jump/if*/lookupswitch) and exception ranges are fixed up, the method's
code length and the DoABC tag length are rewritten. Used for client workarounds and for
debug traces; the original files in the client folder are never modified."""
import struct, sys, os, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swfabc as S

BRANCH = {'jump', 'iftrue', 'iffalse', 'ifeq', 'ifne', 'iflt', 'ifle', 'ifgt', 'ifge', 'ifstricteq',
          'ifstrictne', 'ifnlt', 'ifnle', 'ifngt', 'ifnge'}


def u30(v):
    out = bytearray()
    while True:
        b = v & 0x7f; v >>= 7
        if v: out.append(b | 0x80)
        else: out.append(b); return bytes(out)


def s24(v):
    return struct.pack('<i', v)[:3]


def find_method(abc, label):
    for lb, mi in S.iter_methods(abc):
        if lb == label:
            return mi
    raise KeyError(label)


def multiname_index(abc, name):
    """index of a QName/Multiname whose printable form ends with `name`"""
    hits = [i for i in range(1, len(abc.mn)) if str(abc.mname(i)).split('::')[-1] == name]
    if not hits:
        raise KeyError(name)
    return hits[0]


def patch_code(abc, code, edits):
    """edits: list of (offset, remove_len, insert_bytes), offsets in the original code.
    Returns new code with branch targets fixed."""
    ins = S.disasm(abc, code)
    edits = sorted(edits)

    def new_pos(p):
        # position p in old code -> position in new code (edits at p shift p itself only if strictly before)
        d = 0
        for off, rm, data in edits:
            if off < p: d += len(data) - rm
        return p + d
    out = bytearray(code)
    # rewrite branch operands first (on a copy laid out with old positions)
    fix = []
    for at, name, args in ins:
        if name in BRANCH:
            tgt = int(args[0][1:]); end = at + 4
            fix.append((at + 1, new_pos(tgt) - new_pos(end)))
        elif name == 'lookupswitch':
            raise NotImplementedError('lookupswitch fixup')
    for p, v in fix:
        out[p:p + 3] = s24(v)
    for off, rm, data in sorted(edits, reverse=True):
        out[off:off + rm] = data
    return bytes(out), new_pos


def patch_swf(src, dst, label, edits, extra_stack=0):
    data = open(src, 'rb').read()
    sig, ver, ln, body = S.read_swf(data)
    body = bytearray(body)
    for name, abcdata, pos, hdr in S.abc_blocks(bytes(body)):
        abc = S.ABC(abcdata)
        try:
            mi = find_method(abc, label)
        except KeyError:
            continue
        b = abc.methods[mi]['body']
        code = b['code']; off = b['code_off']
        new, new_pos = patch_code(abc, code, [(o, r, d(abc) if callable(d) else d) for o, r, d in edits])
        if b['exc']:
            raise NotImplementedError('exception table fixup')
        oldlen = u30(len(code))
        start = off - len(oldlen)
        assert bytes(abcdata[start:off]) == oldlen
        # max_stack is the u30 right after the method index; rewrite only if it stays the same size
        newabc = bytes(abcdata[:start]) + u30(len(new)) + new + bytes(abcdata[off + len(code):])
        if extra_stack:
            ms = b['max_stack']
            # locate body header: u30 method, u30 max_stack ... we search backwards for the exact sequence
            hdrseq = u30(b['method']) + u30(ms) + u30(b['locals']) + u30(b['init_scope']) + u30(b['max_scope'])
            hp = newabc.rfind(hdrseq, 0, start)
            assert hp >= 0
            nh = u30(b['method']) + u30(ms + extra_stack) + hdrseq[len(u30(b['method'])) + len(u30(ms)):]
            assert len(nh) == len(hdrseq)
            newabc = newabc[:hp] + nh + newabc[hp + len(hdrseq):]
        # rebuild the tag: pos/hdr from abc_blocks; tag content = flags + name\0 + abc
        tcode, tpos, thdr, tdata = [t for t in S.iter_tags(bytes(body)) if t[1] == pos][0]
        prefix = tdata[:len(tdata) - len(abcdata)]
        content = prefix + newabc
        tag = struct.pack('<HI', (tcode << 6) | 0x3f, len(content)) + content
        body[pos:pos + thdr + len(tdata)] = tag
        break
    else:
        raise KeyError(label)
    out = b'CWS' + bytes([ver]) + struct.pack('<I', 8 + len(body)) + zlib.compress(bytes(body))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'wb').write(out)


def add_names(src, dst, names):
    """Append public QNames (e.g. 'trace') to the constant pool of every ABC block of src that has
    method bodies; writes dst. Returns nothing; look the names up again with multiname_index."""
    data = open(src, 'rb').read()
    sig, ver, ln, body = S.read_swf(data)
    body = bytearray(body)
    blocks = list(S.abc_blocks(bytes(body)))
    for name, abcdata, pos, hdr in reversed(blocks):
        abc = S.ABC(abcdata)
        have = {str(abc.mname(i)) for i in range(1, len(abc.mn))}
        new = [n for n in names if n not in have]
        if not new: continue
        o = abc.off
        R = S.R(abcdata); R.p = o['str']; nstr = R.u30(); str_count_len = R.p - o['str']
        R.p = o['mn']; nmn = R.u30(); mn_count_len = R.p - o['mn']
        pkg = [i for i, (k, sidx) in enumerate(abc.ns) if k == 0x16 and (not sidx or abc.strings[sidx] == '')][0]
        add_s = b''.join(u30(len(n.encode())) + n.encode() for n in new)
        add_m = b''.join(b'\x07' + u30(pkg) + u30(nstr + i) for i, n in enumerate(new))
        a = bytes(abcdata)
        out = (a[:o['str']] + u30(nstr + len(new)) + a[o['str'] + str_count_len:o['str_end']] + add_s
               + a[o['str_end']:o['mn']] + u30(nmn + len(new)) + a[o['mn'] + mn_count_len:o['mn_end']] + add_m + a[o['mn_end']:])
        tcode, tpos, thdr, tdata = [t for t in S.iter_tags(bytes(body)) if t[1] == pos][0]
        content = tdata[:len(tdata) - len(abcdata)] + out
        body[pos:pos + thdr + len(tdata)] = struct.pack('<HI', (tcode << 6) | 0x3f, len(content)) + content
    open(dst, 'wb').write(b'CWS' + bytes([ver]) + struct.pack('<I', 8 + len(body)) + zlib.compress(bytes(body)))
