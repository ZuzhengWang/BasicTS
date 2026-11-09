// Online server: login-time sync commands (bag, equipment, skills, titles, mail, counters...).
// Data comes from the saved role; empty lists mean the role really has nothing of that kind yet.
(function (G) {
  'use strict';
  const M = G.Mole;
  const { ByteWriter, on, LOG } = M;

  function ensure(role) {
    role.equips = role.equips || [];     // bag equipment
    role.dressed = role.dressed || [];   // worn equipment
    role.goods = role.goods || [];       // {goodID, count}
    role.skills = role.skills || [];     // {id, lv, exp}
    role.titles = role.titles || [];
    role.mails = role.mails || [];
    role.buffs = role.buffs || {};       // buffID -> hex(512 bytes)
    role.randCounts = role.randCounts || {}; // id -> count
    role.nextEquipUid = role.nextEquipUid || 1;
    return role;
  }
  M.ensureRole = ensure;

  // SingleItemInfo.setEquipInfo
  const EQ_SHORTS = ['attack', 'mattact', 'defense', 'mdefense', 'speed', 'spirit', 'resume', 'hit', 'dodge',
    'crit', 'fightback', 'rpoison', 'rlithification', 'rlethargy', 'rinebriation', 'rconfusion', 'roblivion'];
  function writeEquip(w, e) {
    w.u32(e.uid).u32(e.goodID).u32(e.gridID || 0).u16(e.levl || 0).u32(e.color || 0).u32(e.validday || 0)
      .u16(e.durationMax || 100).u16(e.duration == null ? (e.durationMax || 100) : e.duration)
      .i32(e.hpMax || 0).i32(e.mpMax || 0);
    EQ_SHORTS.forEach(k => w.u16((e[k] || 0) & 0xffff));
    w.u32(0).u32(0).u32(0).u32(0);              // crystal_attr, blessType, activated, addBlessValue
    w.u32(0);                                   // gems
    w.u32(0).u32(0).u32(0);                     // identify flag, equipKindIdentified, stones
  }
  M.writeEquip = writeEquip;
  function writeGood(w, g) { w.u32(g.goodID).u32(g.gridID || 0).i32(g.count); }
  M.writeGood = writeGood;

  // 2100 HERO_GETMAPCUT_SERVER -> GetCutMapServerProtocol: ip[16] port i16 session[16] (screenshot upload server, unused offline)
  on(2100, (c) => c.reply(new ByteWriter().str('', 16).u16(0).zeros(16)));
  // 1102 BAG_GETEQUIP -> count + equip*
  on(1102, (c) => { const r = ensure(c.role()); const w = new ByteWriter().u32(r.equips.length); r.equips.forEach(e => writeEquip(w, e)); c.reply(w); });
  // 1106 BAG_GETEDRESSEDCLOTH -> count + equip*
  on(1106, (c) => { const r = ensure(c.role()); const w = new ByteWriter().u32(r.dressed.length); r.dressed.forEach(e => writeEquip(w, e)); c.reply(w); });
  // 1109 BAG_GET_ITEMLIST -> count + good*
  on(1109, (c) => { const r = ensure(c.role()); const goods = r.goods.filter(g => g.count > 0); const w = new ByteWriter().u32(goods.length); goods.forEach(g => writeGood(w, g)); c.reply(w); });
  // 1564 GET_HOUSE_PET_COUNT -> u32
  on(1564, (c) => c.reply(new ByteWriter().u32(0)));
  // 1167 ACTIVITY_GET_BUFF (upper, lower) -> count + (buffID u32 + 512 bytes)*
  on(1167, (c, rd) => {
    const a = rd.u32(), b = rd.u32(); const lo = Math.min(a, b), hi = Math.max(a, b);
    const r = ensure(c.role());
    const ids = Object.keys(r.buffs).map(Number).filter(id => id >= lo && id <= hi);
    const w = new ByteWriter().u32(ids.length);
    ids.forEach(id => { w.u32(id); const hex = r.buffs[id]; const buf = new Uint8Array(512); for (let i = 0; i < Math.min(512, hex.length / 2); i++) buf[i] = parseInt(hex.substr(i * 2, 2), 16); w.bytes(buf); });
    c.reply(w);
  });
  // 1706 GET_RAND_RANGE (upper, lower) -> count + (id, count)*
  on(1706, (c, rd) => {
    const a = rd.u32(), b = rd.u32(); const lo = Math.min(a, b), hi = Math.max(a, b);
    const r = ensure(c.role());
    const ids = Object.keys(r.randCounts).map(Number).filter(id => id >= lo && id <= hi);
    const w = new ByteWriter().u32(ids.length); ids.forEach(id => w.u32(id).u32(r.randCounts[id])); c.reply(w);
  });
  // 1054 FRIEND_FORBIDDEN (op) -> i32 forbidden(0 = allowed)
  on(1054, (c) => c.reply(new ByteWriter().i32(0)));
  // 1016 SEEPLAYER_SEVERID -> serverID
  on(1016, (c) => c.reply(new ByteWriter().u32(c.conn.state.serverID || 1)));
  // 1200 TITLE_LIST_REQUEST -> count + HonorInfo*
  on(1200, (c) => c.reply(new ByteWriter().u32(0)));
  // 1602 SKILL_GETLIST -> totalExp, count, (id u32, lv u8, exp u32)*
  on(1602, (c) => {
    const r = ensure(c.role()); const w = new ByteWriter().u32(r.skillExp || 0).u32(r.skills.length);
    r.skills.forEach(s => w.u32(s.id).u8(s.lv || 1).u32(s.exp || 0)); c.reply(w);
  });
  // 1952 MAIL_GETLIST -> count + MailInfo*
  on(1952, (c) => c.reply(new ByteWriter().u32(0)));
  // 4600 PATH_OF_BRAVE_GET_INFO -> trunk[], daily[], claimed[], points
  on(4600, (c) => c.reply(new ByteWriter().i32(0).i32(0).i32(0).i32(0)));
})(window);
(function (G) {
  'use strict';
  const M = G.Mole;
  // 1554 PET_GETLIST -> count + PetInfo*  (pet encoding is added in online_pet.js once pets exist)
  M.on(1554, (c) => {
    const r = M.ensureRole(c.role()); const list = (r.pets || []).filter(p => p.status !== 0);   // not in depot
    const w = new M.ByteWriter().u32(list.length);
    list.forEach(p => M.writePet(w, p));
    c.reply(w);
  });
})(window);
(function (G) {
  'use strict';
  const M = G.Mole;
  // 1610 GET_XING heartbeat / lucky star: leftTime u32, count u32
  M.on(1610, (c) => c.reply(new M.ByteWriter().u32(0).u32(0)));
})(window);
(function (G) {
  'use strict';
  const M = G.Mole;
  const { ByteWriter, on } = M;
  // role.tasks: { [taskID]: {taskID, playing:bool, curNodeID, state, finishCount, firstFinishTime,
  //                            expendItemID, expendItemCount, optDate, buffer: hex(128 bytes)} }
  function hexToBytes(hex, n) { const b = new Uint8Array(n); if (hex) for (let i = 0; i < Math.min(n, hex.length / 2); i++) b[i] = parseInt(hex.substr(i * 2, 2), 16); return b; }
  M.hexToBytes = hexToBytes;
  M.bytesToHex = (u8) => Array.from(u8, x => x.toString(16).padStart(2, '0')).join('');
  function writeTask(w, t, playing) {
    w.u32(t.taskID);
    if (playing) w.u32(t.curNodeID || 0); else w.u32(t.state || 0);
    w.u32(t.finishCount || 0).u32(t.firstFinishTime || 0);
    if (playing) w.u32(t.expendItemID || 0).u32(t.expendItemCount || 0).u32(t.optDate || 0).bytes(hexToBytes(t.buffer, 128));
  }
  M.writeTask = writeTask;
  // 1161 TASK_GET_ALL_TASK_INFO -> playing count + TaskInfo(true)*, other count + TaskInfo(false)*
  on(1161, (c) => {
    const r = M.ensureRole(c.role()); r.tasks = r.tasks || {};
    const all = Object.values(r.tasks);
    const playing = all.filter(t => t.playing), other = all.filter(t => !t.playing);
    const w = new ByteWriter().u32(playing.length); playing.forEach(t => writeTask(w, t, true));
    w.u32(other.length); other.forEach(t => writeTask(w, t, false));
    c.reply(w);
  });
  // 1040 VIP_GET_SESSION (type, gameType) -> type u32, session[32] (web pages; unused offline)
  on(1040, (c, rd) => { const type = rd.u32(); c.reply(new ByteWriter().u32(type).str('00000000000000000000000000000000', 32)); });
  // 1974 GET_NEW_VIP_REWARD_STATUS -> u8
  on(1974, (c) => c.reply(new ByteWriter().u8(0)));
})(window);
(function (G) {
  'use strict';
  const M = G.Mole;
  // 1169 TASK_GET_LOOP_TASK -> count + (loopID+1000000, finishCount, curIndex, n, taskIDs[n])*
  M.on(1169, (c) => {
    const r = M.ensureRole(c.role()); r.loopTasks = r.loopTasks || [];
    const w = new M.ByteWriter().u32(r.loopTasks.length);
    r.loopTasks.forEach(l => { w.u32(l.loopID + 1000000).u32(l.finishCount || 0).u32(l.currentTaskIndex || 0).u32(l.tasks.length); l.tasks.forEach(t => w.u32(t)); });
    c.reply(w);
  });
})(window);
