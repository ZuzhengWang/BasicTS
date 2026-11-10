#!/usr/bin/env python3
"""PlaceObject3 parser for SWF files (nested sprites included) and the blend-mode rewrite used by make_patches.py.

Why: Ruffle's wgpu renderer implements the "complex" blend modes (multiply, lighten, darken, overlay, hardlight)
by copying the whole render target for every such object. The maps bake their background into one 3200x2240 bitmap,
so 勇士大厅 (11302, 161 hardlight layers) allocated about 305 textures of that size = 8.6 GB in the GPU process
(measured with a WebGL hook) and killed the phone. Rewriting those blend modes to normal brought the peak down to 288 MB. The blend byte is changed in place; nothing else moves."""
import sys, struct, collections
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swfabc as S
class Bits:
    def __init__(s, b, p): s.b=b; s.p=p; s.bit=0
    def u(s, n):
        v=0
        for _ in range(n):
            v=(v<<1)|((s.b[s.p]>>(7-s.bit))&1); s.bit+=1
            if s.bit==8: s.bit=0; s.p+=1
        return v
    def align(s):
        if s.bit: s.bit=0; s.p+=1
        return s.p
def skip_matrix(b,p):
    r=Bits(b,p)
    if r.u(1): n=r.u(5); r.u(n); r.u(n)
    if r.u(1): n=r.u(5); r.u(n); r.u(n)
    n=r.u(5); r.u(n); r.u(n); return r.align()
def skip_cx(b,p):
    r=Bits(b,p); a=r.u(1); m=r.u(1); n=r.u(4)
    if m: r.u(n*4)
    if a: r.u(n*4)
    return r.align()
def skip_filters(b,p):
    n=b[p]; p+=1; kinds=[]
    for _ in range(n):
        f=b[p]; p+=1; kinds.append(f)
        if f==0: p+=23
        elif f==1: p+=9
        elif f==2: p+=15
        elif f==3: p+=27
        elif f in(4,7):
            nc=b[p]; p+=1+nc*5+ (19 if f==4 else 19)
        elif f==5:
            mx,my=b[p],b[p+1]; p+=2+4*2+4*mx*my+4+1
        elif f==6: p+=80
    return p,kinds
def parse_po3(b,d):
    """returns dict with offsets: blend byte offset, filter range, cid"""
    f1,f2=b[d],b[d+1]; q=d+4; o={'f1':f1,'f2':f2}
    if (f2&8) or ((f2&16) and (f1&2)):
        while b[q]: q+=1
        q+=1
    if f1&2: o['cid']=struct.unpack_from('<H',b,q)[0]; q+=2
    if f1&4: q=skip_matrix(b,q)
    if f1&8: q=skip_cx(b,q)
    if f1&16: q+=2
    if f1&32:
        s=q
        while b[q]: q+=1
        o['name']=bytes(b[s:q]).decode('latin1'); q+=1
    if f1&64: q+=2
    if f2&1: o['fs']=q; q,o['kinds']=skip_filters(b,q); o['fe']=q
    if f2&2: o['blend_at']=q; o['blend']=b[q]; q+=1
    if f2&4: o['cache_at']=q; o['cache']=b[q]; q+=1
    o['end']=q
    return o
def tags(buf,p,end):
    while p<end:
        h=struct.unpack_from('<H',buf,p)[0]; code=h>>6; ln=h&0x3f; hp=2
        if ln==0x3f: ln=struct.unpack_from('<I',buf,p+2)[0]; hp=6
        yield code,p,hp,ln; p+=hp+ln
def walk(body,p,end,owner,cb):
    for code,tp,hp,ln in tags(body,p,end):
        d=tp+hp
        if code==39: walk(body,d+4,d+ln,struct.unpack_from('<H',body,d)[0],cb)
        elif code==70: cb(owner,parse_po3(body,d),d,ln)

# Blend modes rewritten to normal. Measured on map 21302: screen and add also copy the full target under Ruffle,
# only normal is free. Alpha/erase (11, 12) and layer (2) are left alone (they are masks, not colour effects);
# subtract/difference/invert (7, 9, 10) are left alone too (rare, and normal would look wrong).
BLEND_MAP = {3: 1, 4: 1, 5: 1, 6: 1, 8: 1, 13: 1, 14: 1}


def deblend(src, dst):
    """write dst with cheap blend modes; returns the number of placements changed (0 = dst not written)"""
    import zlib, os
    data = open(src, 'rb').read(); sig, ver, ln, body = S.read_swf(data); body = bytearray(body)
    first = next(iter(S.iter_tags(bytes(body))))[1]; n = [0]
    def cb(owner, o, d, l):
        if o.get('blend') in BLEND_MAP and o['end'] <= d + l:
            body[o['blend_at']] = BLEND_MAP[o['blend']]; n[0] += 1
    walk(bytes(body), first, len(body), 0, cb)
    if n[0]:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'wb').write(b'CWS' + bytes([ver]) + struct.pack('<I', 8 + len(body)) + zlib.compress(bytes(body)))
    return n[0]
