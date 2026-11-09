#!/usr/bin/env python3
"""Turn AVM2 bytecode into readable goto-style pseudo code by symbolic stack
simulation. Not a full decompiler: control flow stays as labels/gotos."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swfabc as S

BIN = {'add': '+', 'subtract': '-', 'multiply': '*', 'divide': '/', 'modulo': '%', 'lshift': '<<',
       'rshift': '>>', 'urshift': '>>>', 'bitand': '&', 'bitor': '|', 'bitxor': '^', 'equals': '==',
       'strictequals': '===', 'lessthan': '<', 'lessequals': '<=', 'greaterthan': '>', 'greaterequals': '>=',
       'add_i': '+', 'subtract_i': '-', 'multiply_i': '*', 'instanceof': 'instanceof', 'in': 'in',
       'istypelate': 'is', 'astypelate': 'as'}
CJ = {'ifeq': '==', 'ifne': '!=', 'iflt': '<', 'ifle': '<=', 'ifgt': '>', 'ifge': '>=', 'ifstricteq': '===',
      'ifstrictne': '!==', 'ifnlt': '!<', 'ifnle': '!<=', 'ifngt': '!>', 'ifnge': '!>='}
PASS = {'convert_s', 'convert_i', 'convert_u', 'convert_d', 'convert_b', 'convert_o', 'coerce', 'coerce_a',
        'coerce_s', 'coerce_b', 'coerce_i', 'coerce_d', 'coerce_u', 'coerce_o', 'label', 'nop', 'debugline',
        'debugfile', 'debug', 'checkfilter', 'kill', 'pushscope', 'popscope', 'pushwith'}


def short(n):
    return str(n).split('::')[-1]


def pseudo(abc, mi, pnames=None):
    m = abc.methods[mi]
    b = m['body']
    if not b:
        return ['  (no body)']
    ins = S.disasm(abc, b['code'])
    targets = set()
    for at, name, args in ins:
        if name in CJ or name in ('jump', 'iftrue', 'iffalse', 'lookupswitch'):
            for a in args:
                if isinstance(a, str) and 'L' in a:
                    targets.add(int(a.split('L')[-1]))
    loc = {0: 'this'}
    for i in range(len(m['params'])):
        loc[i + 1] = 'arg%d' % (i + 1)

    def L(i):
        return loc.get(i, 'loc%d' % i)
    st = []
    out = []

    def pop():
        return st.pop() if st else '<?>'

    def popn(n):
        if n == 0:
            return []
        r = st[-n:] if len(st) >= n else ['<?>'] * n
        del st[-n:]
        return r

    def flush():
        # values left on stack at a join point
        if st:
            out.append('    // stack: ' + ' | '.join(st))
    for at, name, args in ins:
        if at in targets:
            flush()
            st.clear()
            out.append('  L%d:' % at)
        if name in PASS:
            continue
        a0 = args[0] if args else None
        if name.startswith('getlocal'):
            i = int(name[8:]) if name != 'getlocal' else a0
            st.append(L(i))
        elif name.startswith('setlocal'):
            i = int(name[8:]) if name != 'setlocal' else a0
            out.append('    %s = %s' % (L(i), pop()))
        elif name in ('pushbyte', 'pushshort', 'pushint', 'pushuint', 'pushdouble'):
            st.append(str(a0))
        elif name == 'pushstring':
            st.append(a0)
        elif name in ('pushtrue', 'pushfalse', 'pushnull', 'pushundefined', 'pushnan'):
            st.append(name[4:])
        elif name in ('findpropstrict', 'findproperty', 'getglobalscope', 'getscopeobject', 'finddef'):
            st.append('@')
        elif name == 'getlex':
            st.append(short(a0))
        elif name == 'getproperty':
            o = pop()
            nm = short(a0)
            if nm.startswith('<ML') or nm.startswith('<RTQL') or nm == '*' or a0 == '<ML>':
                k = o
                o = pop()
                st.append('%s[%s]' % (o, k))
            else:
                st.append(nm if o == '@' else '%s.%s' % (o, nm))
        elif name in ('setproperty', 'initproperty'):
            v = pop()
            nm = short(a0)
            if a0 == '<ML>' or nm.startswith('<'):
                k = pop(); o = pop()
                out.append('    %s[%s] = %s' % (o, k, v))
            else:
                o = pop()
                out.append('    %s = %s' % (nm if o == '@' else '%s.%s' % (o, nm), v))
        elif name in ('callproperty', 'callpropvoid', 'callproplex', 'constructprop', 'callsuper', 'callsupervoid'):
            a = popn(args[1])
            o = pop()
            nm = short(a0)
            if a0 == '<ML>':
                nm = '[' + pop() + ']'
                o2 = o
            call = '%s(%s)' % (nm if o == '@' else '%s.%s' % (o, nm), ', '.join(a))
            if name == 'constructprop':
                call = 'new ' + call
            if 'super' in name:
                call = 'super.' + call
            if name.endswith('void'):
                out.append('    ' + call)
            else:
                st.append(call)
        elif name == 'callmethod' or name == 'callstatic':
            a = popn(args[1]); o = pop(); st.append('%s.m%s(%s)' % (o, a0, ', '.join(a)))
        elif name == 'call':
            a = popn(a0); recv = pop(); f = pop(); st.append('%s(%s)' % (f, ', '.join(a)))
        elif name == 'construct':
            a = popn(a0); f = pop(); st.append('new %s(%s)' % (f, ', '.join(a)))
        elif name == 'constructsuper':
            a = popn(a0); pop(); out.append('    super(%s)' % ', '.join(a))
        elif name == 'newarray':
            st.append('[' + ', '.join(popn(a0)) + ']')
        elif name == 'newobject':
            kv = popn(a0 * 2)
            st.append('{' + ', '.join('%s:%s' % (kv[i], kv[i + 1]) for i in range(0, len(kv), 2)) + '}')
        elif name == 'newfunction':
            st.append('function_m%d' % a0)
        elif name == 'newclass':
            pop(); st.append('class%d' % a0)
        elif name == 'newactivation':
            st.append('activation')
        elif name == 'newcatch':
            st.append('catch%d' % a0)
        elif name in BIN:
            b2 = pop(); a1 = pop(); st.append('(%s %s %s)' % (a1, BIN[name], b2))
        elif name in ('istype', 'astype'):
            st.append('(%s %s %s)' % (pop(), 'is' if name == 'istype' else 'as', short(a0)))
        elif name == 'not':
            st.append('!' + pop())
        elif name in ('negate', 'negate_i'):
            st.append('-' + pop())
        elif name == 'bitnot':
            st.append('~' + pop())
        elif name in ('increment', 'increment_i'):
            st.append('(%s + 1)' % pop())
        elif name in ('decrement', 'decrement_i'):
            st.append('(%s - 1)' % pop())
        elif name in ('inclocal', 'inclocal_i'):
            out.append('    %s++' % L(a0))
        elif name in ('declocal', 'declocal_i'):
            out.append('    %s--' % L(a0))
        elif name == 'typeof':
            st.append('typeof ' + pop())
        elif name == 'dup':
            v = pop(); st += [v, v]
        elif name == 'swap':
            b2 = pop(); a1 = pop(); st += [b2, a1]
        elif name == 'pop':
            v = pop()
            if '(' in v:
                out.append('    ' + v)
        elif name == 'getslot':
            o = pop(); st.append('%s.slot%d' % (o, a0))
        elif name == 'setslot':
            v = pop(); o = pop(); out.append('    %s.slot%d = %s' % (o, a0, v))
        elif name == 'getsuper':
            st.append('super.' + short(pop() and a0))
        elif name == 'deleteproperty':
            o = pop(); st.append('delete %s.%s' % (o, short(a0)))
        elif name == 'getdescendants':
            o = pop(); st.append('%s..%s' % (o, short(a0)))
        elif name in ('hasnext2',):
            st.append('hasnext2(%s,%s)' % (L(args[0]), L(args[1])))
        elif name in ('nextname', 'nextvalue', 'hasnext'):
            i = pop(); o = pop(); st.append('%s(%s,%s)' % (name, o, i))
        elif name == 'returnvalue':
            out.append('    return ' + pop())
        elif name == 'returnvoid':
            out.append('    return')
        elif name == 'throw':
            out.append('    throw ' + pop())
        elif name == 'jump':
            flush(); st.clear()
            out.append('    goto %s' % a0)
        elif name in ('iftrue', 'iffalse'):
            v = pop(); out.append('    if (%s%s) goto %s' % ('' if name == 'iftrue' else '!', v, a0))
        elif name in CJ:
            b2 = pop(); a1 = pop(); out.append('    if (%s %s %s) goto %s' % (a1, CJ[name], b2, a0))
        elif name == 'lookupswitch':
            out.append('    switch(%s) %s' % (pop(), ' '.join(args)))
        else:
            out.append('    <%s %s>' % (name, ' '.join(map(str, args))))
    return out


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('swf')
    ap.add_argument('filter', nargs='?')
    a = ap.parse_args()
    body, abcs = S.load(a.swf)
    for n, abc, p, h in abcs:
        seen = set()
        for label, mi in S.iter_methods(abc):
            seen.add(mi)
            if a.filter is None or a.filter in label:
                m = abc.methods[mi]
                print('== %s(%s)' % (label, ', '.join(short(abc.mname(t)) for t in m['params'])))
                print('\n'.join(pseudo(abc, mi)))
        # anonymous functions (closures created with newfunction)
        for mi, m in enumerate(abc.methods):
            if mi in seen or not m['body']: continue
            label = 'anon/function_m%d' % mi
            if a.filter is None or a.filter in label:
                print('== %s(%s)' % (label, ', '.join(short(abc.mname(t)) for t in m['params'])))
                print('\n'.join(pseudo(abc, mi)))


if __name__ == '__main__':
    main()
