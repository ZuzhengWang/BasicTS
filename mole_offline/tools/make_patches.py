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


# 1+2 (default on; MOLE_LIVE_IDLE=0 keeps the original pre-drawn idle bitmaps). The role's idle poses stay live
# MovieClips. Tried going back to the bitmaps in v0.6.1 because live poses cost more CPU in battle (frame construction
# about 5 s vs 1.6 s per 20 s in a profile), but with the bitmaps some outfit parts were again drawn in a corner
# during actions (screenshots bi_08/bi_09), even with patch 7. Not solved; kept live.
import shutil as _sh
os.makedirs(os.path.dirname(dst), exist_ok=True); _sh.copy(src, dst)
if os.environ.get('MOLE_LIVE_IDLE', '1') != '0':
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

# 4. Case mismatches: the client was made for Windows (case-insensitive); Android assets are case-sensitive.
#    ClientConfig.getMinMapSwfPath asks for res/minMap/ but the folder is res/MinMap/ (区域地图 "资源MinMap-1加载失败").
import shutil
for src_rel, dst_rel in [('res/MinMap', 'res/minMap')]:
    s, d = os.path.join(client, src_rel), os.path.join(web, dst_rel)
    if os.path.isdir(s):
        shutil.rmtree(d, ignore_errors=True); shutil.copytree(s, d)
        print('alias', src_rel, '->', dst_rel)

# 5. MapModel.makeMapPathData: the walkable / safe area layers are drawn into BitmapData and then read with one
#    getPixel32 per grid cell. Under Ruffle (wgpu) each read of a GPU-drawn bitmap copies a small region back from the GPU,
#    and those copies pile up until the script ends: entering 勇士大厅 (11302) took 26 s and the GPU process grew by
#    about 8 GB (measured), which kills the game on a phone. One getColorBoundsRect() first syncs the whole bitmap to
#    the CPU once, so the per-cell reads no longer touch the GPU.
def u30at(c, p):
    v = sh = 0
    while True:
        b = c[p]; p += 1; v |= (b & 0x7f) << sh; sh += 7
        if not b & 0x80: return v
L5 = 'com.mole2.core.map::MapModel/makeMapPathData'
for dll in ('dll/NewDLL.swf', 'dll/ClientCoreDLL.swf'):
    path = os.path.join(web, dll)
    if not os.path.exists(path): shutil.copy(os.path.join(client, dll), path)
    try:
        ins = ins_of(path, L5)
    except KeyError:
        continue
    P.add_names(path, path, ['getColorBoundsRect'])
    at = [a for a, nm, x in ins if nm == 'pushscope'][0] + 1
    def sync(abc):
        mi = P.find_method(abc, L5); c = abc.methods[mi]['body']['code']
        idx = {}
        for a, nm, args in S.disasm(abc, c):
            if nm == 'getproperty' and str(args[0]).endswith(('_walkableMapBmd', '_safeMapBmd')):
                idx[str(args[0]).split('_')[-1]] = u30at(c, a + 1)
        g = P.multiname_index(abc, 'getColorBoundsRect')
        call = b'\x24\x00\x24\x00\x26' + b'\x4f' + P.u30(g) + b'\x03'      # (0, 0, true) -> discard
        w = b'\xd0\x66' + P.u30(idx['walkableMapBmd']) + call
        sget = b'\xd0\x66' + P.u30(idx['safeMapBmd'])
        sbody = sget + call
        return w + sget + b'\x12' + P.s24(len(sbody)) + sbody             # if (_safeMapBmd) sync it too
    P.patch_swf(path, path, L5, [(at, 0, sync)])
    print('patched', dll, 'MapModel.makeMapPathData (bitmap sync)')


# 6. Complex blend modes in maps and battle backgrounds -> cheap ones (see swfplace.py: GPU memory on the phone).
import glob, swfplace
tot = files = 0
for pat in ('res/map/*.swf', 'res/mapAll/*.swf', 'res/battle/bg/*.swf'):
    for f in sorted(glob.glob(os.path.join(client, pat))):
        r = os.path.relpath(f, client)
        try:
            n = swfplace.deblend(f, os.path.join(web, r))
        except Exception as e:
            print('deblend failed', r, e); continue
        if n: tot += n; files += 1
print('deblend: %d placements in %d files' % (tot, files))

# 7. battle.swf SuitPart.show: every outfit part (suitMC) holds one child clip per body action; SuitPart.frameHandle,
#    registered as the frame script of every suitMC frame, moves that child to (0,0) and to the current sub frame.
#    Under Ruffle the frame script does not always run when show() changes the frame (seen when the role returns to
#    the wait pose after an action), so the child kept its authored offset: the outfit was drawn in a corner of the
#    battle field and the role stood there bare ("装备和人物分离"). show() now calls frameHandle() itself after the
#    gotoAndStop, which is what the frame script would have done.
L7 = 'com.mole2.module.battle.body.part::SuitPart/show'
def u30at(c, p):
    v = sh = 0
    while True:
        b = c[p]; p += 1; v |= (b & 0x7f) << sh; sh += 7
        if not b & 0x80: return v
body_, abcs_ = S.load(dst)
for n_, abc_, p_, h_ in abcs_:
    try:
        mi_ = P.find_method(abc_, L7)
    except KeyError:
        continue
    ret = [a for a, nm, x in S.disasm(abc_, abc_.methods[mi_]['body']['code']) if nm == 'returnvoid'][-1]
    mi2 = P.find_method(abc_, 'com.mole2.module.battle.body.part::SuitPart/initFrame')
    c2 = abc_.methods[mi2]['body']['code']
    fh = [u30at(c2, a + 1) for a, nm, x in S.disasm(abc_, c2) if nm == 'getproperty' and str(x[0]).endswith('frameHandle')][0]
    P.patch_swf(dst, dst, L7, [(ret, 0, b'\xd0\x4f' + P.u30(fh) + b'\x00')], extra_stack=1)
    print('patched', rel, 'SuitPart.show (frameHandle call)')
    break

# 8. SystemFrameRateManager.onStageEnterFrame: when the measured frame rate is under 22 / 17 / 10 fps the client sets
#    spillFrames = 1 / 2 / 3, and battle animations (AvatarBody, effects, tweens) then skip that many frames per tick.
#    The rate is re-measured on every frame, so the skip count also jumps around. Under Ruffle on a phone the rate is
#    usually below those limits, so skills flashed by with most frames missing. The three constants become 0: every
#    frame is shown (a slow device plays the battle slower instead of dropping frames). _userAccelerate is untouched.
#    v0.6.5: with no skipping at all a slow phone played battles in slow motion, so a milder rule is used:
#    under 22 fps -> 0, under 17 fps -> 1, under 10 fps -> 2 (was 1 / 2 / 3).
SPILL = {'1': 0, '2': 1, '3': 2}
L8 = 'com.mole2.core.manager::SystemFrameRateManager/static onStageEnterFrame'
for dll in ('dll/NewDLL.swf', 'dll/ClientCoreDLL.swf'):
    path = os.path.join(web, dll)
    try:
        ins = ins_of(path, L8)
    except KeyError:
        continue
    edits = []
    for k, (at, nm, a) in enumerate(ins[:-1]):
        nx = ins[k + 1]
        if nm == 'pushbyte' and a in ('1', '2', '3') and nx[1] in ('setproperty', 'initproperty') and nx[2].endswith('spillFrames'):
            edits.append((at, 2, b'\x24' + bytes([SPILL[a]])))
    if not edits: print('skip', dll, '(no spillFrames constants; NewDLL overrides this class)'); continue
    assert len(edits) == 3, (dll, len(edits))
    P.patch_swf(path, path, L8, edits)
    print('patched', dll, 'SystemFrameRateManager (milder frame skipping)')
