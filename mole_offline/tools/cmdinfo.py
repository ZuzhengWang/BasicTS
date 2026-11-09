#!/usr/bin/env python3
"""cmdinfo.py PSDIR cmd [cmd...]: show name, registered protocol parser, and listeners for a command
(works on pseudo-code dumps produced by pseudo.py: ps_Core.txt, ps_NewDLL.txt, ps_ClientAppDLL.txt...)."""
import re, sys, os
psdir = sys.argv[1]
files = {n: open(os.path.join(psdir, n), encoding='utf8').read().split('\n') for n in
         ['ps_NewDLL.txt', 'ps_Core.txt', 'ps_ClientAppDLL.txt', 'ps_TaomeeLibraryDLL.txt']}
core = files['ps_Core.txt']
names = {}
for src in (files['ps_NewDLL.txt'], core):
    starts = [i for i, l in enumerate(src) if l.startswith('== com.mole2.core.net::CommandID/<cinit>')]
    for start in starts:
        for l in src[start + 1:]:
            if l.startswith('== '): break
            m = re.match(r'\s+(\w+) = (\d+)$', l)
            if m and m.group(1) not in names.setdefault(int(m.group(2)), []): names[int(m.group(2))].append(m.group(1))
regs = {}
for l in files['ps_NewDLL.txt'] + core:
    m = re.search(r'registerClass\(CommandID\.(\w+), (\w+)\)', l)
    if m: regs[m.group(1)] = m.group(2)

def method(fname, lines, header_pat):
    out = []
    for i, l in enumerate(lines):
        if l.startswith('== ') and re.search(header_pat, l):
            j = i + 1
            out.append(l)
            while j < len(lines) and not lines[j].startswith('== '):
                out.append(lines[j]); j += 1
            break
    return out

for c in sys.argv[2:]:
    c = int(c)
    nm = names.get(c, ['?'])
    print('#' * 70); print('CMD', c, nm)
    for n in nm:
        if n in regs:
            for fn, lines in files.items():
                body = method(fn, lines, r'::%s/<init>' % regs[n])
                if body: print('-- parser', regs[n], 'in', fn); print('\n'.join(body[:80])); break
        for fn, lines in files.items():
            for i, l in enumerate(lines):
                m = re.search(r'addCmdListener\(CommandID\.%s, (?:this\.)?(\w+)\)' % n, l)
                if m:
                    # find enclosing class
                    k = i
                    while k > 0 and not lines[k].startswith('== '): k -= 1
                    cls = lines[k].split('/')[0][3:]
                    body = method(fn, lines, re.escape(cls) + r'/(?:static )?' + m.group(1) + r'\(')
                    print('-- listener %s.%s (%s)' % (cls, m.group(1), fn))
                    print('\n'.join(body[:60]))
            for i, l in enumerate(lines):
                if re.search(r'send\(CommandID\.%s\b' % n, l):
                    k = i
                    while k > 0 and not lines[k].startswith('== '): k -= 1
                    print('-- sent in', lines[k][3:], ':', l.strip()[:200])
