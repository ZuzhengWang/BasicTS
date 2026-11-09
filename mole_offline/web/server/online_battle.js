// Online server: PvE battle engine.
// Protocol (from NewDLL BattleProgressManager + module/battle/battle.swf):
//   1304 BATTLE_TRIGGER(groupID, refreshID) / walk encounter -> 1305 BATTLE_START
//   client 1306 load progress..., 1317 BATTLE_INIT_STATE(1) -> 1307 BATTLE_BEGIN_NOTICE(flag=1)
//   per round: client 1308 BATTLE_ROUND_ACTION(petID, side, posIdx, actionID, level)
//              -> 1310 action list (animation) + 1311 sync (state after round)
//   end: 1318 BATTLE_OVER_DATA_PVE (rewards) + 1319 BATTLE_OVER_NOTICE
// Rules that are NOT in the client (damage formula, monster stats per level, exp per kill) are
// approximations, marked "APPROX" below.
(function (G) {
  'use strict';
  const M = G.Mole;
  const { ByteWriter, on, LOG, Data: D } = M;

  const ACT = { ESCAPE: 1, NONE: 8, ATTACK: 10, DEFEND: 701, PET_NONE: 5008, PET_ATTACK: 5010, PET_DEFEND: 5701 };
  const RESULT = { DRAW: 0, WIN: 1, LOSE: 2 };

  // ---------------------------------------------------------------- level table (embedded LevelExp xml in ClientCoreDLL)
  const LEVEL_EXP = [0, 0, 16, 65, 175, 369, 671, 1105, 1695, 2465, 3439, 4641, 6095, 7825, 9855, 12209, 14911, 17985, 21455, 25345];
  M.LEVEL_EXP = LEVEL_EXP;
  M.loadLevelTable = async () => {
    // Optional: full table shipped next to the server (extracted from ClientCoreDLL LevelExp_expXmlCls)
    try {
      const r = await fetch('server/data/level_exp.xml'); if (!r.ok) return;
      const doc = new DOMParser().parseFromString(await r.text(), 'text/xml');
      for (const it of doc.getElementsByTagName('item')) LEVEL_EXP[Number(it.getAttribute('level'))] = Number(it.getAttribute('exp'));
      LOG('level table:', LEVEL_EXP.length - 1, 'levels');
    } catch (e) { LOG('level table not loaded', e); }
  };
  M.Data.ready = M.Data.ready.then(async (d) => { await M.loadLevelTable(); return d; });

  // ---------------------------------------------------------------- avatars
  function roleAvatar(r) {
    return {
      userID: r.userID, petID: 0, petTypeID: 0, posIdx: r.battleInFront ? 0 : 5, nick: r.nick, vipLevel: 0,
      color: r.color, level: r.level, hp: Math.max(1, r.hp), hp_max: r.hp_max, mp: r.mp, mp_max: r.mp_max,
      race: 0, profession: r.professtion, earth: r.earth, water: r.water, fire: r.fire, wind: r.wind,
      clothes: (r.dressed || []).map(e => ({ instanceID: e.uid, itemID: e.goodID, level: e.levl || 0 })),
      atk: r.attackPower, def: r.defensePower, matk: r.mgaicAttackPower || 0, mdef: r.magicDefensePower, speed: r.speed,
      hit: r.hit_rate, dodge: r.avoid_rate, crit: r.bisha, side: 0, isRole: true,
    };
  }
  // APPROX: monster attributes = growth factor (x10 in Pet.xml) * (level + 1) / 10, then the client's factor matrix.
  function monsterAvatar(typeID, level, idx) {
    const t = D.petTypes[typeID] || { Name: '怪物' + typeID, PhysiFactor: 20, StrenFactor: 20, EndurFactor: 20, QuickFactor: 20, IntelFactor: 20, Race: 0 };
    const k = (level + 1) / 10;
    const s = { physique: +t.PhysiFactor * k, strength: +t.StrenFactor * k, endurance: +t.EndurFactor * k, quick: +t.QuickFactor * k, intelligen: +t.IntelFactor * k, injuredLevel: 0 };
    const tmp = Object.assign({ dressed: [] }, s); M.recalc(tmp);
    const hp = Math.max(30, Math.round(tmp.hp_max * 0.6));
    return {
      userID: idx + 1, petID: 0, petTypeID: Number(typeID), posIdx: idx, nick: t.Name, vipLevel: 0, color: 0, level,
      hp, hp_max: hp, mp: tmp.mp_max, mp_max: tmp.mp_max, race: +t.Race || 0, profession: 0,
      earth: +t.Earth || 0, water: +t.Water || 0, fire: +t.Fire || 0, wind: +t.Wind || 0, clothes: [],
      atk: Math.round(tmp.attackPower * 0.8), def: Math.round(tmp.defensePower * 0.8), matk: tmp.mgaicAttackPower, mdef: tmp.magicDefensePower,
      speed: Math.round(tmp.speed), hit: 90, dodge: 5, crit: 3, side: 1, isRole: false, style: +t.Style || 1,
    };
  }
  M.monsterAvatar = monsterAvatar;

  // BattleAvatarInfo (NewDLL)
  function writeAvatar(w, a) {
    const nick = new TextEncoder().encode(a.nick || '');
    w.u32(a.userID).u32(a.petID).u32(a.petTypeID).u32(a.posIdx).u8(nick.length).bytes(nick)
      .u32(a.vipLevel || 0).u32(a.color || 0).u32(a.level).u32(Math.max(0, a.hp)).u32(a.hp_max).u32(Math.max(0, a.mp)).u32(a.mp_max)
      .u32(0).u32(0).u32(0).u32(0)        // sheild, healthLevel, changeBodyID, autoBattleCount
      .u32(0)                             // invalid skills
      .u8(0).u8(a.race || 0).u16(0)       // petState, race, canCatch
      .u8(a.earth || 0).u8(a.water || 0).u8(a.fire || 0).u8(a.wind || 0).u8(a.profession || 0)
      .u8(a.clothes.length);
    a.clothes.forEach(c => w.u32(c.instanceID).u32(c.itemID).u16(c.level || 0));
    w.u8(0);                              // skills
    w.u32(0).u32(0).u32(0).u32(0).i32(-1); // state2, state1, state4, state3, beastgrpTypeRawIndex
  }

  function writeStart(b) {
    const w = new ByteWriter().u32(0).u32(0).u32(b.uid).u32(0);   // bgmID, isWatch, battle_userID, time_stamp
    w.u32(b.uid).u8(0).u8(0);                                     // challengeLeaderID, sneakFlag, isPK
    w.u32(b.players.length); b.players.forEach(a => writeAvatar(w, a));
    w.u32(b.monsters[0].userID).u32(b.monsters.length); b.monsters.forEach(a => writeAvatar(w, a));
    return w;
  }
  function writeSync(b) {
    const w = new ByteWriter().u32(0).u32(b.uid).u32(b.uid).u8(0).u8(0);
    w.u32(b.players.length); b.players.forEach(a => writeAvatar(w, a));
    w.u32(b.monsters[0].userID).u32(b.monsters.length); b.monsters.forEach(a => writeAvatar(w, a));
    w.u32(0);   // group AI state
    return w;
  }

  // ---------------------------------------------------------------- battle lifecycle
  function startBattle(c, monsterSpecs, info) {
    const st = c.conn.state;
    if (st.battle) { LOG('battle already running'); return; }
    const r = M.ensureRole(c.role());
    const b = {
      uid: c.uid, round: 0, info: info || {}, over: false, began: false,
      players: [roleAvatar(r)],
      monsters: monsterSpecs.slice(0, 10).map((m, i) => { const a = monsterAvatar(m.typeID, m.level, i); if (m.pos !== undefined) a.posIdx = m.pos; return a; }),
    };
    st.battle = b;
    LOG('battle start:', b.monsters.map(m => m.nick + ' Lv' + m.level).join(', '));
    c.push(1305, writeStart(b));
  }
  M.startBattle = startBattle;

  // 1306 BATTLE_RES_LOAD_PROGRESS(progress) -> notice 1316 (userID, progress) is only for other players
  on(1306, () => {});
  // 1317 BATTLE_INIT_STATE(flag)
  on(1317, (c, rd) => {
    const ok = rd.u32(); const b = c.conn.state.battle;
    if (!b) return;
    if (!ok) { c.conn.state.battle = null; return; }
    b.began = true;
    c.push(1307, new ByteWriter().u32(1));
  });
  // 1344 BATTLE_MODULE_EXIT_REPORT
  on(1344, (c) => { c.conn.state.battle = null; M.saveRole(); });

  const alive = (list) => list.filter(a => a.hp > 0);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // APPROX damage: physical = max(5% atk, atk - 0.6*def) * [0.9, 1.1], x1.5 on crit, x0.5 when defending.
  function damage(att, tgt, defending) {
    if (Math.random() * 100 > Math.max(30, att.hit - tgt.dodge)) return { miss: true, dmg: 0 };
    let d = Math.max(att.atk * 0.05, att.atk - tgt.def * 0.6) * rand(0.9, 1.1);
    const crit = Math.random() * 100 < att.crit;
    if (crit) d *= 1.5;
    if (defending) d *= 0.5;
    return { dmg: Math.max(1, Math.round(d)), crit };
  }

  // BattleActionInfo + BattleActionLoopInfo
  function writeAction(w, seq, actor, loops) {
    w.u32(seq).u32(actor.userID).u32(actor.petID).u32(0).u32(0).u32(0).u32(0)
      .i32(0).i32(0).i32(0).i32(0)        // talkId, hp_change, mp_change, sheild_change
      .u32(0).u32(0).u16(0)               // jisheng
      .u16(loops.length);
    loops.forEach(l => {
      w.u32(actor.userID).u32(actor.petID).u8(0).u32(l.atkType).u8(l.level || 1)
        .i32(0).i32(0).i32(0).u32(0)      // increase_hp, rebound_hp, rebound_mp, useItemID
        .u32(l.target.userID).u32(l.target.petID).u8(0)
        .u32(0).u32(0).u32(0).u32(0)
        .i32(l.change_hp || 0).i32(l.change_mp || 0).i32(0);
    });
  }

  // 1308 BATTLE_ROUND_ACTION: petID, side(0 own/1 enemy), posIdx, actionID, level
  on(1308, (c, rd) => {
    const petID = rd.u32(), side = rd.u32(), pos = rd.i32(), actionID = rd.i32(), level = rd.u32();
    const b = c.conn.state.battle;
    if (!b || b.over) return;
    if (petID !== 0) return;              // pets are not implemented yet (role only)
    c.push(1313, new ByteWriter().u32(c.uid).u32(0));   // "acted" notice
    resolveRound(c, b, { actionID, side, pos, level });
  });

  function resolveRound(c, b, cmd) {
    b.round++;
    const role = b.players[0];
    const acts = [];
    const defending = new Set();
    let escaped = false;
    // order: by speed (desc)
    const order = alive(b.players.concat(b.monsters)).sort((x, y) => (y.speed + Math.random() * 5) - (x.speed + Math.random() * 5));
    if (cmd.actionID === ACT.DEFEND) defending.add(role);
    for (const a of order) {
      if (a.hp <= 0) continue;
      if (a === role) {
        if (cmd.actionID === ACT.ESCAPE) {
          acts.push({ actor: a, loops: [{ atkType: ACT.ESCAPE, target: a }] });
          escaped = true; break;
        }
        if (cmd.actionID === ACT.DEFEND || cmd.actionID === ACT.NONE) {
          acts.push({ actor: a, loops: [{ atkType: cmd.actionID, target: a }] });
          continue;
        }
        // normal attack (skills are treated as normal attacks for now)
        let tgt = b.monsters.find(m => m.posIdx === cmd.pos && m.hp > 0) || pick(alive(b.monsters));
        if (!tgt) break;
        const r = damage(a, tgt, false);
        tgt.hp = Math.max(0, tgt.hp - r.dmg);
        acts.push({ actor: a, loops: [{ atkType: ACT.ATTACK, target: tgt, change_hp: -r.dmg }] });
      } else if (!a.isRole) {
        const targets = alive(b.players);
        if (!targets.length) break;
        const tgt = pick(targets);
        const r = damage(a, tgt, defending.has(tgt));
        tgt.hp = Math.max(0, tgt.hp - r.dmg);
        acts.push({ actor: a, loops: [{ atkType: ACT.PET_ATTACK, target: tgt, change_hp: -r.dmg }] });
      }
      if (!alive(b.monsters).length || !alive(b.players).length) break;
    }
    const w = new ByteWriter().u32(acts.length);
    acts.forEach((x, i) => writeAction(w, i + 1, x.actor, x.loops));
    c.push(1310, w);
    c.push(1311, writeSync(b));
    if (escaped) return finish(c, b, RESULT.DRAW);
    if (!alive(b.monsters).length) return finish(c, b, RESULT.WIN);
    if (!alive(b.players).length) return finish(c, b, RESULT.LOSE);
  }

  // level-up with the client's LevelExp table (cumulative exp). APPROX: 4 free attribute points per level.
  M.levelCheck = function (r) {
    const old = r.level;
    while (LEVEL_EXP[r.level + 1] !== undefined && r.experience >= LEVEL_EXP[r.level + 1]) { r.level++; r.attr_add += 4; }
    if (r.level > old) { M.recalc(r); r.hp = r.hp_max; r.mp = r.mp_max; }
    return r.level - old;
  };
  // APPROX experience per defeated monster
  const expFor = (lv) => Math.round(6 + 4 * Math.pow(lv, 1.5));

  function rollDrops(m) {
    const t = D.petTypes[m.petTypeID];
    if (!t || !t.el) return [];
    const beasts = Array.from(t.el.getElementsByTagName('Beast')).map(D.attrs).filter(x => +x.Lv <= m.level).sort((x, y) => +y.Lv - +x.Lv);
    const e = beasts[0]; if (!e || !e.ItemID) return [];
    const ids = String(e.ItemID).split(/\s+/), rates = String(e.Rate || '').split(/\s+/).map(Number);
    const out = [];
    ids.forEach((id, i) => { if (Math.random() * 1000 < (rates[i] || 0)) out.push(Number(id)); });
    return out;
  }

  function addItem(r, id, count) {
    if (D.equips[id]) { for (let i = 0; i < count; i++) r.equips.push(M.makeEquip(r, id)); return; }
    const g = r.goods.find(x => x.goodID === id);
    if (g) g.count += count; else r.goods.push({ goodID: id, gridID: 0, count });
  }
  M.addItem = addItem;

  function finish(c, b, result) {
    b.over = true;
    const r = M.ensureRole(c.role());
    const role = b.players[0];
    let gained = 0; const drops = {};
    if (result === RESULT.WIN) {
      b.monsters.forEach(m => { gained += expFor(m.level); rollDrops(m).forEach(id => { drops[id] = (drops[id] || 0) + 1; }); });
    }
    const oldLv = r.level;
    r.experience += gained;
    r.hp = Math.max(1, role.hp); r.mp = Math.max(0, role.mp);
    M.levelCheck(r);
    Object.keys(drops).forEach(id => addItem(r, Number(id), drops[id]));
    r.battles = (r.battles || 0) + 1;
    if (result === RESULT.WIN) r.wins = (r.wins || 0) + 1;
    M.saveRole();
    LOG('battle over result', result, 'exp +' + gained, 'level', oldLv, '->', r.level, 'drops', JSON.stringify(drops));

    // 1318 BattleResultPVEProtocol (role entry): petID, changeLevel, changeExp, protectExp, remaindExp u16,
    //      skills u8, bagFull u8, items u8 + (id, count)*
    const items = Object.keys(drops);
    const w = new ByteWriter().u32(0).u32(r.level - oldLv).i32(gained).u32(0).u16(0).u8(0).u8(0).u8(items.length);
    items.forEach(id => w.u32(Number(id)).u32(drops[id]));
    c.push(1318, w);
    // 1319 BattleOverNoticeProtocol
    const o = new ByteWriter().u32(1).u32(result).u32(0).u32(0).u32(0)
      .u32(0).i32(0).u32(0).i32(0).u32(0).i32(0).i32(0)       // VipMutilExpBuffInfo
      .u32(r.autoHP || 0).u32(r.autoMP || 0);
    c.push(1319, o);
    c.conn.state.battle = null;
    c.conn.state.walkSince = 0;
    if (r.level > oldLv) M.pushLevelUp && M.pushLevelUp(c, r);
  }

  // ---------------------------------------------------------------- triggers
  // Beastgrp.xml: <Type ID="<variant>*100000 + monsterType" Position="slots"/>; level is not in the group,
  // APPROX: use the lowest <Beast Lv> listed for that monster in Pet.xml (never below 1).
  function groupMonsters(groupID, roleLevel) {
    const g = D.beastGrps[groupID];
    if (!g) return null;
    const list = [];
    g.types.forEach(t => {
      const typeID = Number(t.ID) % 100000;
      const pt = D.petTypes[typeID];
      let lv = roleLevel || 1;
      if (pt && pt.el) { const b = pt.el.getElementsByTagName('Beast')[0]; if (b) lv = Math.max(1, Number(b.getAttribute('Lv'))); }
      const slots = String(t.Position || '-1').split(/\s+/).map(Number);
      slots.forEach(pos => list.push({ typeID, level: lv, pos: pos >= 0 ? pos : undefined }));
    });
    return list;
  }
  M.groupMonsters = groupMonsters;
  // 1304 BATTLE_TRIGGER(groupID, refreshID)
  on(1304, (c, rd) => {
    const groupID = rd.u32(), refreshID = rd.u32();
    const list = groupMonsters(groupID, c.role().level);
    if (!list || !list.length) { LOG('unknown beast group', groupID); return c.reply(null, 5001); }
    startBattle(c, list, { groupID, refreshID });
  });

  // Hidden encounters on maps with MonsterType1=1 (Map.xml BasicValue/RandomValue in 4.5px units)
  M.walkTick = function (c, cx, cy, ex, ey) {
    const st = c.conn.state, r = c.role();
    const map = D.maps[r.mapID];
    if (!map || map.MonsterType1 !== '1' || st.battle) return;
    const types = Array.from(map.el.getElementsByTagName('Type')).map(D.attrs);
    if (!types.length) return;
    const dist = Math.hypot(ex - cx, ey - cy);
    st.walked = (st.walked || 0) + dist;
    if (!st.encounterAt) st.encounterAt = (Number(map.BasicValue || 100) + Math.random() * Number(map.RandomValue || 20)) * 4.5;
    if (st.walked < st.encounterAt) return;
    st.walked = 0; st.encounterAt = 0;
    const n = Math.floor(rand(Number(map.MinBeastCnt || 1), Number(map.MaxBeastCnt || 1) + 0.999));
    const specs = [];
    for (let i = 0; i < n; i++) {
      const t = pick(types); const lvs = String(t.Lv).split(/\s+/).map(Number);
      specs.push({ typeID: Number(t.ID), level: pick(lvs) || 1 });
    }
    setTimeout(() => startBattle(c, specs, { mapID: r.mapID }), 200);
  };
})(window);
