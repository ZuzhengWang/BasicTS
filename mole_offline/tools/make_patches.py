#!/usr/bin/env python3
"""Client workarounds for Ruffle, written as patched copies under web/ (web files override client files).
The original client files are never modified.  usage: make_patches.py CLIENT_DIR WEB_DIR

1. module/com/mole2/module/battle/battle.swf  FighterBody constructor:
   the role's idle poses are pre-drawn into bitmaps (AvatarBody BmpAction). Under Ruffle the outfit parts are
   attached by a frame script after that drawing, so the idle role showed a bare mole and the outfit layer was
   drawn on its own in a corner. Only one unused pose is still pre-drawn, so the role's idle poses use the live MovieClip
   (with its outfit), like the attack animations already do.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import abcpatch as P, swfabc as S

client, web = sys.argv[1], sys.argv[2]
rel = 'module/com/mole2/module/battle/battle.swf'
src, dst = os.path.join(client, rel), os.path.join(web, rel)


def ins_of(path, label):
    body, abcs = S.load(path)
    for n, abc, p, h in abcs:
        for lb, mi in S.iter_methods(abc):
            if lb == label:
                return [(at, nm, str(a[0]) if a else '') for at, nm, a in S.disasm(abc, abc.methods[mi]['body']['code'])]
    raise KeyError(label)


def nop(path_in, label, a, b):
    P.patch_swf(path_in, dst, label, [(a, b - a, b'\x02' * (b - a))])
    print('patched', rel, label.split('::')[-1], 'bytes', a, '-', b)


# 1. FighterBody: no pre-drawn poses for the role (all four _bmpFrameList.push statements)
L1 = 'com.mole2.module.battle.body::FighterBody/<init>'
ins = ins_of(src, L1)
starts = [at for at, nm, a in ins if nm == 'findpropstrict' and a.endswith('_bmpFrameList')]
end = [at for at, nm, a in ins if nm == 'findproperty' and a.endswith('_bmpActionMap')][0]
nop(src, L1, starts[0], end)
# 2. BattleAvatarManager.addAvatar: the role's READY event now fires inside its constructor, before the
#    listener exists, so do not put the role into _prepareBmpActionAvatarList (battle loading would wait forever)
L2 = 'com.mole2.module.battle.manager.avatar::BattleAvatarManager/static addAvatar'
ins = ins_of(dst, L2)
i = [k for k, x in enumerate(ins) if x[1] == 'findpropstrict' and x[2].endswith('_prepareBmpActionAvatarList')][0]
j = next(k for k in range(i, len(ins)) if ins[k][1] == 'pop')
nop(dst, L2, ins[i][0], ins[j + 1][0])


# 3. NewDLL ItemTipsController.onMouseDown: touch screens have no hover, so item tooltips never opened on the phone,
#    and a tap (mouse down) removed them. Now a tap opens the tooltip; it closes on mouse out (tapping elsewhere).
for dll in ('dll/NewDLL.swf', 'dll/ClientCoreDLL.swf'):
    L3 = 'com.mole2.core.ui.tips::ItemTipsController/static onMouseDown'
    try:
        ins = ins_of(os.path.join(client, dll), L3)
    except KeyError:
        continue
    # findpropstrict removeTips; callproperty removeTips 0; pop
    k = [i for i, x in enumerate(ins) if x[1] in ('callproperty', 'callpropvoid') and x[2].endswith('removeTips')][0]
    a = ins[k - 1][0]; b = ins[k + 2][0] if ins[k + 1][1] == 'pop' else ins[k + 1][0]
    # replace removeTips() with onMouseRollOver(event): a tap opens the tooltip of the tapped item
    def show(abc):
        m = [i for i in range(1, len(abc.mn)) if str(abc.mname(i)).split('::')[-1] == 'onMouseRollOver'
             and 'ItemTipsController' in str(abc.mname(i))] or [P.multiname_index(abc, 'onMouseRollOver')]
        return b'\x5d' + P.u30(m[0]) + b'\xd1' + b'\x4f' + P.u30(m[0]) + b'\x01'
    P.patch_swf(os.path.join(client, dll), os.path.join(web, dll), L3, [(a, b - a, show)], extra_stack=1)
    print('patched', dll, 'ItemTipsController.onMouseDown')
