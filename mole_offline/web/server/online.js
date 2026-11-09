// Online (game) server emulation for ClientCoreDLL / NewDLL (com.mole2.core.net.CommandID).
// Each handler documents the client-side parser it was written against.
(function (G) {
  'use strict';
  const M = G.Mole;
  const { LOG, ByteWriter, ByteReader, registerServer, Store } = M;

  const handlers = {};       // cmd -> fn(ctx, reader, pkt)
  M.onlineHandlers = handlers;
  function on(cmd, fn) { handlers[cmd] = fn; }
  M.on = on;
  const unhandled = {};
  M.unhandledLog = unhandled;

  // ------------------------------------------------------------ role model
  function now() { return Math.floor(Date.now() / 1000); }
  function newRole(uid) {
    return {
      userID: uid, nick: '', flag: 0, flag2: 0, created: false,
      vipLevel: 0, vipEnergy: 0, vipBegin: 0, vipEnd: 0, heroCupTeamID: 0, color: 0, reg_time: now(),
      race: 0, professtion: 0, professionPharse: 0, honor: 0, xiaomee: 2000, pkPoint: 0, energy: 100,
      level: 1, experience: 0,
      physique: 5, strength: 5, endurance: 5, quick: 5, intelligen: 5, attr_add: 0,
      hp: 120, mp: 60, earth: 0, water: 0, fire: 0, wind: 0, injuredLevel: 0, changeBodyID: 0,
      mapID: 11101, mapType: 0, posX: 351, posY: 335, baseAction: 0, advAction: 0, dir: 0, battleInFront: 1,
      autoHP: 0, autoMP: 0, hp_max: 120, mp_max: 60,
      attackPower: 20, defensePower: 10, magicDefensePower: 10, speed: 10, spirit: 10, restore: 10,
      hit_rate: 90, avoid_rate: 5, bisha: 5, attack_back: 0,
      anti_poison: 0, anti_stone: 0, anti_sleep: 0, anti_curse: 0, anti_confusion: 0, anti_forget: 0,
      continueLoginDays: 1, clothes: [],     // {clothID, clothType, clothLevel}
      petID: 0, petTypeID: 0, petRace: 0, petNick: '', petLevel: 0,
      items: {},                             // itemID -> count
      tasks: {},                             // taskID -> state
      pets: [],
      battles: 0,
    };
  }
  M.newRole = newRole;
  function getRole(uid) {
    const db = Store.load();
    if (!db.roles[uid]) { db.roles[uid] = newRole(uid); Store.save(); }
    return db.roles[uid];
  }
  M.getRole = getRole;
  M.saveRole = () => Store.save();

  // ProtocolAnalyzer.setForLoginInfo (NewDLL version: length-prefixed nick/petNick, mgaicAttackPower)
  function writeLoginInfo(w, r) {
    const nick = new TextEncoder().encode(r.nick || ''), pnick = new TextEncoder().encode(r.petNick || '');
    w.u32(r.userID).u8(nick.length).bytes(nick).u32(r.flag).u32(r.flag2)
      .u32(r.vipLevel).u32(r.vipEnergy).u32(r.vipBegin).u32(r.vipEnd)
      .u32(r.heroCupTeamID).u32(r.color).u32(r.reg_time)
      .u8(r.race).u8(r.professtion).u32(r.professionPharse).u32(r.honor).u32(r.xiaomee).u32(r.pkPoint)
      .u32(r.energy).u32(r.level).u32(r.experience)
      .u16(r.physique).u16(r.strength).u16(r.endurance).u16(r.quick).u16(r.intelligen).u16(r.attr_add)
      .u32(r.hp).u32(r.mp).u8(r.earth).u8(r.water).u8(r.fire).u8(r.wind)
      .u32(r.injuredLevel).u32(r.changeBodyID).u32(r.mapID).u32(r.mapType).u32(r.posX).u32(r.posY)
      .u32(r.baseAction).u32(r.advAction).u8(r.dir).u8(r.battleInFront)
      .u32(r.autoHP).u32(r.autoMP).u32(r.hp_max).u32(r.mp_max)
      .u16(r.attackPower).u16(r.defensePower).u16(r.magicDefensePower).u16(r.speed).u16(r.spirit).u16(r.restore)
      .u16(r.hit_rate).u16(r.avoid_rate).u16(r.bisha).u16(r.attack_back)
      .u16(r.anti_poison).u16(r.anti_stone).u16(r.anti_sleep).u16(r.anti_curse).u16(r.anti_confusion).u16(r.anti_forget)
      .u32(r.continueLoginDays).u16(r.mgaicAttackPower || 0).zeros(26);
    const cl = M.clothesOf(r);
    w.u8(cl.length);
    cl.forEach(c => w.u32(c.clothID).u32(c.clothType).u16(c.clothLevel));
    w.u32(r.petID).u32(r.petTypeID).u8(r.petRace).u8(pnick.length).bytes(pnick).u32(r.petLevel);
    return w;
  }
  M.writeLoginInfo = writeLoginInfo;
  // ClothInfo list of worn equipment (ClothInfo.clone: clothID = uniqueEquipID, clothType = goodID)
  M.clothesOf = (r) => (r.dressed || []).map(e => ({ clothID: e.uid, clothType: e.goodID, clothLevel: e.levl || 0 }));

  // ------------------------------------------------------------ server
  registerServer('online', {
    onOpen(conn) { LOG('online: client connected'); },
    onClose(conn) { if (conn.state.uid) Store.save(); },
    onPacket(conn, p) {
      const ctx = { conn, uid: conn.state.uid || p.userId, p };
      ctx.role = () => getRole(ctx.uid);
      ctx.reply = (body, result) => conn.send(p.cmd, ctx.uid, body, result);
      ctx.push = (cmd, body) => conn.send(cmd, ctx.uid, body, 0);
      const h = handlers[p.cmd];
      if (!h) {
        unhandled[p.cmd] = (unhandled[p.cmd] || 0) + 1;
        LOG('online: UNHANDLED cmd', p.cmd, 'len', p.body.length);
        return;
      }
      h(ctx, new ByteReader(p.body), p);
    },
  });

  // 1001 LOGIN_IN: serverID u32, session[16], gameType u32 x2, tad[128] -> LoginProtocol
  on(1001, (ctx, r) => {
    const serverID = r.u32(); const session = r.bytes(16);
    const hex = Array.from(session, b => b.toString(16).padStart(2, '0')).join('');
    const uid = (M.sessions && M.sessions[hex]) || ctx.p.userId;
    ctx.uid = uid; ctx.conn.state.uid = uid; ctx.conn.state.serverID = serverID;
    const role = ctx.role();
    if (M.ensureRole) M.ensureRole(role);
    if (M.recalc && role.professtion) M.recalc(role);
    LOG('online login: role', role.userID, role.nick || '(new)', 'Lv' + role.level, 'exp', role.experience, 'map', role.mapID, role.posX, role.posY, 'goods', JSON.stringify(role.goods || []));
    const w = writeLoginInfo(new ByteWriter(), role);
    w.u32(now());            // serverTimestamp
    w.u32(0).u32(0).i32(0);  // onLineExpireType, onLineTimeSpan, remaidDou_exp_time
    w.u32(0).i32(0).u32(0).i32(0).u32(0).i32(0).i32(0);   // VipMutilExpBuffInfo
    w.u32(0).u32(0).u32(0).u32(0).u32(0).u32(0).u32(0);   // GetRelationShipProtocol (uid known) + 0 relations
    ctx.reply(w);
  });
})(window);
