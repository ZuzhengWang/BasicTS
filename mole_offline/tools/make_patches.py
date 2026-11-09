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
label = 'com.mole2.module.battle.body::FighterBody/<init>'
body, abcs = S.load(os.path.join(client, rel))
for n, abc, p, h in abcs:
    for lb, mi in S.iter_methods(abc):
        if lb != label: continue
        ins = S.disasm(abc, abc.methods[mi]['body']['code'])
        # the four "_bmpFrameList.push(...)" statements: from the 2nd findpropstrict _bmpFrameList up to the
        # findproperty _bmpActionMap
        starts = [at for at, nm, a in ins if nm == 'findpropstrict' and str(a[0]).endswith('_bmpFrameList')]
        end = [at for at, nm, a in ins if nm == 'findproperty' and str(a[0]).endswith('_bmpActionMap')][0]
        # keep the first push (FRAME_FIGHTER_WAIT without the front/back offset: the player's own role always
        # uses the offset frames, so this bitmap is never shown for it) so the drawing step still runs and the
        # READY event comes after the battle module listens for it; drop the other three
        a = starts[1]
        P.patch_swf(os.path.join(client, rel), os.path.join(web, rel), label, [(a, end - a, b'\x02' * (end - a))])
        print('patched', rel, 'bytes', a, '-', end)
