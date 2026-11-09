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
    w.u8(r.clothes.length);
    r.clothes.forEach(c => w.u32(c.clothID).u32(c.clothType || 0).u16(c.clothLevel || 0));
    w.u32(r.petID).u32(r.petTypeID).u8(r.petRace).u8(pnick.length).bytes(pnick).u32(r.petLevel);
    return w;
  }
  M.writeSimpleInfo = writeSimpleInfo;

  // 1004 ENTER_MAP: mapID, mapType, x, y, jumpType -> setForSimpleInfo(self)
  on(1004, (c, rd) => {
    const mapID = rd.u32(), mapType = rd.u32(), x = rd.u32(), y = rd.u32(), jump = rd.u32();
    const r = M.ensureRole(c.role());
    r.mapID = mapID; r.mapType = mapType; r.posX = x; r.posY = y;
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
})(window);
