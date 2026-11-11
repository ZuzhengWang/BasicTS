// Online server: maps, walking, map monsters. Single player: the only person on any map is yourself.
(function (G) {
  'use strict';
  const M = G.Mole;
  const { ByteWriter, on, LOG, Data: D } = M;

  // ProtocolAnalyzer.setForSimpleInfo (NewDLL)
  function writeSimpleInfo(w, r) {
    const nick = new TextEncoder().encode(r.nick || ''), pnick = new TextEncoder().encode(r.petNick || '');
    w.u32(r.userID).u8(nick.length).bytes(nick).u32(r.flag)
      .u32(r.vipLevel).u32(r.vipEnergy).u32(r.vipBegin).u32(r.vipEnd)
      .u32(r.heroCupTeamID).u32(r.color).u8(r.race).u8(r.professtion).u32(r.professionPharse).u32(r.honor)
      .u32(r.pkPoint).u32(r.level).u32(r.hp).u32(r.mp).u32(r.hp_max).u32(r.mp_max)
      .u32(r.injuredLevel).u32(r.changeBodyID).u32(r.mapID).u32(r.mapType).u32(r.posX).u32(r.posY)
      .u32(r.baseAction).u32(r.advAction).u8(r.dir)
      .u32(0).u32(0).u32(0)      // teamID, teamMemberIndex, isTeamRegistered
      .u8(0)                     // teamNick length
      .u8(0).u8(0).u8(0)         // teamStatus, pkStatus, status
      .zeros(32);
    const cl = M.clothesOf(r);
    w.u8(cl.length);
    cl.forEach(c => w.u32(c.clothID).u32(c.clothType).u16(c.clothLevel));
    w.u32(r.petID).u32(r.petTypeID).u8(r.petRace).u8(pnick.length).bytes(pnick).u32(r.petLevel);
    return w;
  }
  M.writeSimpleInfo = writeSimpleInfo;

  // 1004 ENTER_MAP: mapID, mapType, x, y, jumpType -> setForSimpleInfo(self)
  on(1004, (c, rd) => {
    const mapID = rd.u32(), mapType = rd.u32(), x = rd.u32(), y = rd.u32(), jump = rd.u32();
    const r = M.ensureRole(c.role());
    r.mapID = mapID; r.mapType = mapType; r.posX = x; r.posY = y;
    if (M.registerTrans) M.registerTrans(r, mapID);
    c.conn.state.mapID = mapID;
    M.saveRole();
    LOG('enter map', mapID, (D.maps[mapID] || {}).Name || '', x, y);
    c.reply(writeSimpleInfo(new ByteWriter(), r));
  });
  // 1003 LEAVE_MAP -> userID
  on(1003, (c) => c.reply(new ByteWriter().u32(c.uid)));
  // 1002 LIST_MAP_PLAYER (mapID, mapType) -> count + simpleInfo* (only yourself offline)
  on(1002, (c) => { const r = c.role(); c.reply(writeSimpleInfo(new ByteWriter().u32(1), r)); });
  // 1009 WALK: curX i16, curY i16, endX u32, endY u32, step i16, a u32, b u32, i16, time u32
  //  -> PlayerWalkProtocol: userID, posX, posY, step u16, direction u32, type u32
  on(1009, (c, rd) => {
    const cx = rd.u16(), cy = rd.u16(), ex = rd.u32(), ey = rd.u32(), step = rd.u16(), a = rd.u32(), b = rd.u32();
    const r = c.role();
    r.posX = ex; r.posY = ey;
    c.reply(new ByteWriter().u32(c.uid).u32(ex).u32(ey).u16(step).u32(a).u32(b));
    if (G.MOLE_TRACE) LOG('walk', cx, cy, '->', ex, ey, 'step', step, a, b);
    M.walkTick && M.walkTick(c, cx, cy, ex, ey);
  });
  // 1034 RESET_WALK_INFO -> echo nothing meaningful
  on(1034, (c) => c.reply(new ByteWriter()));

  // ---- visible map monsters (monsters.xml)
  function mapMonsterDefs(mapID) {
    if (!D.monsterDoc) return [];
    const m = Array.from(D.monsterDoc.getElementsByTagName('map')).find(e => e.getAttribute('mapID') == String(mapID));
    if (!m) return [];
    const pos = {}; for (const p of m.getElementsByTagName('pos')) { const a = D.attrs(p); pos[a.id] = a; }
    const list = [];
    let id = 1;
    for (const tag of ['monster', 'boss']) for (const e of m.getElementsByTagName(tag)) {
      const a = D.attrs(e); a.kind = tag; a.refreshID = id++;
      const pid = String(a.pos || '1').split(',')[0]; const p = pos[pid] || { point: '400,400', width: 100, height: 100 };
      const [px, py] = String(p.point).split(',').map(Number);
      a.x = px + Math.floor(Math.random() * Number(p.width || 1)); a.y = py + Math.floor(Math.random() * Number(p.height || 1));
      list.push(a);
    }
    return list;
  }
  M.mapMonsterDefs = mapMonsterDefs;
  // 1350 MAP_GET_MONSTERS -> count + (refreshID, groupID, typeID, x i16, y i16, count)*
  on(1350, (c) => {
    const r = c.role(); const defs = mapMonsterDefs(r.mapID);
    c.conn.state.mapMonsters = defs;
    const w = new ByteWriter().u32(defs.length);
    defs.forEach(d => w.u32(d.refreshID).u32(Number(d.groupID)).u32(Number(d.typeID)).u16(d.x).u16(d.y).u32(1));
    c.reply(w);
  });
  // 1367 MAP_GET_ELITE_BEAST -> mapID, count + (beastID, elite, boss)*
  on(1367, (c) => c.reply(new ByteWriter().u32(c.role().mapID).u32(0)));

  // 1136 MAP_GET_BOSS_INFO(first, last group id) -> count + (id, step u16, state u16, wins u32)*
  // Boss maps (CleanBossPod, Map_302xx) wait for this before showing the boss / challenge
  M.on(1136, (c, rd) => {
    const a = rd.u32(), b = rd.u32(); const r = c.role(); r.bossInfo = r.bossInfo || {};
    const ids = []; for (let i = Math.min(a, b); i <= Math.max(a, b) && ids.length < 20; i++) ids.push(i);
    const w = new M.ByteWriter().u32(ids.length);
    ids.forEach(id => { const x = r.bossInfo[id] || {}; w.u32(id).u16(x.step || 0).u16(x.state || 0).u32(x.count || 0); });
    c.reply(w);
  });
  // 1137 MAP_SET_BOSS_INFO(id, step...) -> stored, empty reply
  M.on(1137, (c, rd) => {
    const r = c.role(); r.bossInfo = r.bossInfo || {};
    if (rd.left >= 4) { const id = rd.u32(); const step = rd.left >= 2 ? rd.u16() : 0; r.bossInfo[id] = Object.assign(r.bossInfo[id] || {}, { step }); M.saveRole(); }
    c.reply(new M.ByteWriter());
  });

  // ---- 修炼之域 (竞技之塔, PracticePanelModule). The tower panel asks which entry floors are open:
  // 1811 MAP_GET_TRANS_LIST -> count, map IDs (the first one, 21601, is always open in the client).
  // A floor's crystal NPC registers it with 1810 MAP_REGISTER_TRANS(mapID) -> 1 if it was registered before.
  // Entry maps are 21601, 21606, 21611 ... (every 5th floor, PracticeAreaConfig embedded in ClientCoreDLL).
  // APPROX: reaching an entry map also registers it, in case the crystal NPC of that map is not clicked.
  const transOf = (r) => (r.transList = r.transList || []);
  const isEntry = (id) => id >= 21601 && id <= 21700 && (id - 21601) % 5 === 0;
  M.registerTrans = function (r, mapID) { const t = transOf(r); if (isEntry(mapID) && !t.includes(mapID)) { t.push(mapID); return true; } return false; };
  on(1811, (c) => { const t = transOf(M.ensureRole(c.role())); const w = new M.ByteWriter().u32(t.length); t.forEach(id => w.u32(id)); c.reply(w); });
  on(1810, (c, rd) => {
    const id = rd.left >= 4 ? rd.u32() : 0; const r = M.ensureRole(c.role()); const t = transOf(r);
    const had = t.includes(id); if (!had && id) { t.push(id); M.saveRole(); }
    LOG('trans registered', id, had ? '(already)' : ''); c.reply(new M.ByteWriter().u32(had ? 1 : 0));
  });
  // 1349 JUST_KILL_PRACTICEAREA_BOSS -> count, (userID, killedBossID): the floor NPC (action x6) asks whether this
  // floor's guard was just beaten. Guard of map 21601+i is beast group 3011+i (PracticeAreaManager.setup).
  // The battle engine stores the last beaten guard in r.practiceKill (M.onPracticeWin).
  M.onPracticeWin = function (r, groupID) { if (groupID >= 3011 && groupID <= 3100) r.practiceKill = groupID; };
  on(1349, (c) => {
    const r = M.ensureRole(c.role()); const boss = 3011 + ((r.mapID || 0) - 21601);
    c.reply(new M.ByteWriter().u32(1).u32(c.uid).u32(r.practiceKill === boss ? boss : 0));
  });
})(window);
