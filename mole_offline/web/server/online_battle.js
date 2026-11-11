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

  const ACT = { ESCAPE: 1, NONE: 8, ATTACK: 10, DEFEND: 701, PET_NONE: 5008, PET_ATTACK: 5010, PET_DEFEND: 5701,
    ITEM: 4, CAPTURE: 6, CALL_PET: 7, CALL_AIDE: 12, AUTO: 1000000 };
  const RESULT = { DRAW: 0, WIN: 1, LOSE: 2 };
  // BattleAvatarInfo.petState (module battle.swf PetStateType)
  const PS = { NOT_A_PET: 0, OUT_BATTLE: 2, IN_BATTLE: 3, AIDE_PET: 4, BEATING_PET: 5 };
  const CAPTURE_SUCCESS = 0x8000;
  // state2 bits for the hit that kills (module AvatarState): 2 knocked down (lies there), 4 knocked off the field.
  // Monsters and pets are knocked off (the client plays no fall for pets with bit 2), the role is knocked down.
  const ST2_KNOCK_DOWN = 2, ST2_RANGE_OUT = 4;
  // other state2 bits of a hit (module AvatarState): 16 defending, 32 dodged, 1024 critical (暴击)
  const ST2_DEFENSE = 16, ST2_AVOID = 32, ST2_BISHA = 1024;
  function hitBits(r, t, defending) {
    let v = 0;
    if (r.miss) v |= ST2_AVOID;
    if (r.crit) v |= ST2_BISHA;
    if (defending && defending.has(t)) v |= ST2_DEFENSE;
    return v;
  }
  // a kill: knocked off the field (击飞) only by a critical hit, otherwise knocked down (倒地) and it stays on the
  // field (APPROX rule, as in the original game: a knocked-down avatar can still be revived)
  // The client plays the fall (phase 3) / knock-off (phase 5) from the attacking action's phases
  // (BattleActionListConfig); 46 attack skills (e.g. 破魂 5501) have neither, so a kill by them left the target
  // standing with an empty HP bar. Such a killing hit is shown as the actor's normal attack.
  const hasPhase = (id, ph) => { const a = D.actions[id]; return !a || !a.phases || a.phases.includes(ph); };
  function markKills(loops, actor) {
    loops.forEach(l => {
      const t = l.target;
      if (t && t.side !== undefined) l.state1 = stBits(t);
      if (t && (l.change_hp || 0) < 0 && t.hp <= 0 && !t.downShown) {
        t.downShown = true;
        const off = (l.state2 & ST2_BISHA) !== 0;
        if (!hasPhase(l.atkType, off ? 5 : 3)) l.atkType = actor && actor.isRole ? ACT.ATTACK : ACT.PET_ATTACK;
        if (off) t.knockedOff = true;
        l.state2 = (l.state2 || 0) | (off ? ST2_RANGE_OUT : ST2_KNOCK_DOWN);
      }
    });
    return loops;
  }
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
      hit: r.hit_rate, dodge: r.avoid_rate, crit: r.bisha, side: 0, isRole: true, petState: PS.NOT_A_PET,
      skills: (r.skills || []).map(k => ({ id: k.id, lv: k.lv || 1 })),
      // weapon type (item_equip Weapon: 0 none, 1 sword/axe, 2 bow, 3 staff, 4 dart, 5 spear, 6 gloves) and shield, for skill requirements
      weaponType: (r.dressed || []).reduce((w, e) => { const c = D.equips[e.goodID] || {}; return Number(c.EquipPart) === 5 ? Number(c.Weapon || 0) : w; }, 0),
      hasShield: (r.dressed || []).some(e => Number((D.equips[e.goodID] || {}).EquipPart) === 6),
    };
  }
  function petAvatar(r, p, state, pos) {
    M.recalcPet(p); M.initPetSkills(p); M.syncPetSkills(p);
    return {
      userID: r.userID, petID: p.petid, petTypeID: p.typeID, posIdx: pos !== undefined ? pos : (r.battleInFront ? 5 : 0), nick: p.nick, vipLevel: 0,
      color: 0, level: p.level, hp: Math.max(1, p.hp), hp_max: p.hp_max, mp: p.mp, mp_max: p.mp_max, race: p.race, profession: 0,
      earth: p.earth, water: p.water, fire: p.fire, wind: p.wind, clothes: [],
      atk: p.attack_value, def: p.defense_value, matk: p.matk || 0, mdef: p.mdef || 0, speed: p.speed, hit: p.hit_rate, dodge: p.avoid_rate, crit: p.bisha,
      side: 0, isRole: false, isPet: true, pet: p, petState: state || PS.IN_BATTLE,
      skills: (p.skills || []).map(k => ({ id: k.id, lv: k.lv || 1 })),
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
      petState: PS.NOT_A_PET, skills: [], catchRate: catchRate(t, level), specCatch: String(t.SpecCatch || '').split(/\s+/).map(Number),
      spec: specSkills(t),
    };
  }
  M.monsterAvatar = monsterAvatar;
  // Pet.xml <Beast Lv Catch>: capture rate (out of 10000) of a wild monster at that level; 0/absent = cannot be caught
  function catchRate(t, level) {
    if (!t || !t.el) return 0;
    const bs = Array.from(t.el.getElementsByTagName('Beast')).map(D.attrs).filter(x => +x.Lv <= level).sort((x, y) => +y.Lv - +x.Lv);
    return bs.length ? Number(bs[0].Catch || 0) : 0;
  }
  // Pet.xml <SpecSkill ID Percent>: skills a wild monster may use
  function specSkills(t) {
    const e = t && t.el && t.el.getElementsByTagName('SpecSkill')[0];
    if (!e) return [];
    const idl = String(e.getAttribute('ID') || '').split(/\s+/).map(Number), pc = String(e.getAttribute('Percent') || '').split(/\s+/).map(Number);
    return idl.map((id, i) => ({ id, w: pc[i] || 0 })).filter(x => x.id && x.w > 0);
  }

  // BattleAvatarInfo (NewDLL)
  function writeAvatar(w, a) {
    const nick = new TextEncoder().encode(a.nick || '');
    w.u32(a.userID).u32(a.petID).u32(a.petTypeID).u32(a.posIdx).u8(nick.length).bytes(nick)
      .u32(a.vipLevel || 0).u32(a.color || 0).u32(a.level).u32(Math.max(0, a.hp)).u32(a.hp_max).u32(Math.max(0, a.mp)).u32(a.mp_max)
      .u32(0).u32(0).u32(0).u32(0)        // sheild, healthLevel, changeBodyID, autoBattleCount
      .u32(0)                             // invalid skills
      .u8(a.petState || 0).u8(a.race || 0).u16(a.catchRate > 0 && !a.boss ? 1 : 0)   // petState, race, canCatch
      .u8(a.earth || 0).u8(a.water || 0).u8(a.fire || 0).u8(a.wind || 0).u8(a.profession || 0)
      .u8(a.clothes.length);
    a.clothes.forEach(c => w.u32(c.instanceID).u32(c.itemID).u16(c.level || 0));
    const sk = (a.skills || []).filter(k => k.id !== ACT.PET_ATTACK);
    w.u8(sk.length);                      // skills: id, maxLevel, currentLevel, disabled rounds
    sk.forEach(k => w.u32(k.id).u8(Math.max(k.lv || 1, (M.skillInfo(k.id) || { lv: [1] }).lv.length)).u8(k.lv || 1).u8(0));
    w.u32(0).u32(stBits(a)).u32(0).u32(0).i32(-1); // state2, state1 (status), state4, state3, beastgrpTypeRawIndex
  }

  function writeStart(b) {
    // battle_time_stamp must be a real time: the client also stores it as BattleStartProtocol.replayTotalRounds and
    // its replay panel (BattleWatchRoundsPanel.playRound) only stays idle when that is > 500; with 0 it re-applied
    // the start HP of every avatar after each round (full HP bars, nobody ever fell)
    b.ts = b.ts || Math.floor(Date.now() / 1000);
    const w = new ByteWriter().u32(0).u32(0).u32(b.uid).u32(b.ts);   // bgmID, isWatch, battle_userID, time_stamp
    w.u32(b.uid).u8(0).u8(0);                                     // challengeLeaderID, sneakFlag, isPK
    const own = b.players.concat(b.backup);
    w.u32(own.length); own.forEach(a => writeAvatar(w, a));
    w.u32(b.monsters[0].userID).u32(b.monsters.length); b.monsters.forEach(a => writeAvatar(w, a));
    return w;
  }
  function writeSync(b) {
    const w = new ByteWriter().u32(b.ts || Math.floor(Date.now() / 1000)).u32(b.uid).u32(b.uid).u8(0).u8(0);
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
    // Pets: the main pet (主战) fights, assist pets (辅助) start on the field and act on their own,
    // standby pets (待命) are sent as backup avatars that the role can call in (召唤, 1339).
    const ps = (M.petsOf ? M.petsOf(r) : []).filter(p => { M.recalcPet(p); return p.hp > 0; });
    const front = !!r.battleInFront;
    const main = ps.find(p => p.status === 3);
    // own side has 10 slots (posIdx 0-9). Default = original layout: role + main pet + 2 assist pets.
    // r.battlePets = 9 (console /battlepets 9): up to 8 more bag pets join as assist pets and fill every slot.
    const mainPos = front ? 5 : 0, rolePos = front ? 0 : 5;
    const aidePos = [rolePos + 1, rolePos + 2, rolePos + 3, rolePos + 4, mainPos + 1, mainPos + 2, mainPos + 3, mainPos + 4]
      .sort((x, y) => (Math.floor(x / 5) === Math.floor(mainPos / 5) ? 0 : 1) - (Math.floor(y / 5) === Math.floor(mainPos / 5) ? 0 : 1));
    const maxAides = (r.battlePets || 9) >= 9 ? 8 : 2;   // default: full field (9 pets); /battlepets 3 = original layout
    const aides = ps.filter(p => p.status === 4).concat(maxAides > 2 ? ps.filter(p => p.status === 1 || p.status === 2) : []).slice(0, maxAides);
    const b = {
      uid: c.uid, round: 0, info: info || {}, over: false, began: false,
      players: [roleAvatar(r)]
        .concat(main ? [petAvatar(r, main, PS.IN_BATTLE)] : [])
        .concat(aides.map((p, i) => petAvatar(r, p, PS.AIDE_PET, aidePos[i]))),
      // posIdx 10 = off the field (client BattleAvatarManager.removeAvatarPet); a lower posIdx makes the client swap it in
      backup: ps.filter(p => p.status === 2 && !aides.includes(p)).slice(0, 2).map(p => petAvatar(r, p, PS.OUT_BATTLE, 10)),
      fought: new Set(), captured: [],
      cmds: {},
      monsters: monsterSpecs.slice(0, 10).map((m, i) => { const a = monsterAvatar(m.typeID, m.level, i); if (m.pos !== undefined) a.posIdx = m.pos; return a; }),
    };
    b.players.filter(a => a.isPet).forEach(a => b.fought.add(a.pet));
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
  function writeAction(w, seq, actor, loops, mp) {
    const th = actor._tickHp || 0, tm = actor._tickMp || 0; actor._tickHp = 0; actor._tickMp = 0;
    w.u32(seq).u32(actor.userID).u32(actor.petID).u32(0).u32(stBits(actor)).u32(0).u32(0)   // state2, state1, state4, state3
      .i32(0).i32(th).i32(tm - (mp || 0)).i32(0)   // talkId, hp_change, mp_change (actor's skill cost), sheild_change
      .u32(0).u32(0).u16(0)               // jisheng
      .u16(loops.length);
    loops.forEach(l => {
      w.u32(actor.userID).u32(actor.petID).u8(0).u32(l.atkType).u8(l.level || 1)
        .i32(0).i32(0).i32(0).u32(l.useItemID || 0)   // increase_hp, rebound_hp, rebound_mp, useItemID
        .u32(l.target.userID).u32(l.target.petID).u8(0)
        .u32(l.state2 || 0).u32(l.state1 || 0).u32(0).u32(0)        // state2, state1 (status bits), state4, state3
        .i32(l.change_hp || 0).i32(l.change_mp || 0).i32(0);
    });
  }

  // avatars the player gives commands to each round: the role and the main pet (assist pets act on their own)
  const controlled = (b) => alive(b.players).filter(a => a.isRole || a.petState === PS.IN_BATTLE);
  function tryResolve(c, b) {
    if (controlled(b).every(a => b.cmds[a.petID])) { const cmds = b.cmds; b.cmds = {}; resolveRound(c, b, cmds); }
  }
  function roleCmd(c, b, cmd) {
    flushSync(c, b, 'command');
    c.push(1313, new ByteWriter().u32(c.uid).u32(0));
    b.cmds[0] = cmd; tryResolve(c, b);
  }
  // pending full sync (1315) after a pet was called in: sent after the round's playback, or at the latest
  // when the first command of the next round arrives
  function flushSync(c, b, why) {
    if (!b.syncPending || c.conn.state.battle !== b || b.over) return;
    b.syncPending = false; LOG('full sync after call (' + why + ')'); c.push(1315, writeSync(b));
  }
  const current = (c) => { const b = c.conn.state.battle; return b && !b.over ? b : null; };

  // 1308 BATTLE_ROUND_ACTION: petID, side(0 own/1 enemy), posIdx, actionID (plain action/skill id), level
  on(1308, (c, rd) => {
    const petID = rd.u32(), side = rd.u32(), pos = rd.i32(), actionID = rd.i32(), level = rd.u32();
    const b = current(c); if (!b) return;
    flushSync(c, b, 'command');
    c.push(1313, new ByteWriter().u32(c.uid).u32(petID));   // "acted" notice
    let cmd = { actionID, side, pos, level };
    // AUTO_BATTLE_COMMAND (client auto-battle, on by default): pets use their auto-battle skill (精灵背包 setting)
    if (actionID === ACT.AUTO) {
      const a = b.players.find(x => x.petID === petID);
      const p = a && a.pet;
      // a pet with an auto-battle skill chosen in the pet bag keeps using it; everyone else lets the AI pick each round
      cmd = p && p.skillID_autoBattle ? { actionID: p.skillID_autoBattle, level: p.skillLevel_autoBattle || 1, side: 1, pos: -1 }
        : { auto: true, actionID: petID ? ACT.PET_ATTACK : ACT.ATTACK, side: 1, pos: -1 };
    }
    LOG('round cmd', petID ? 'pet ' + petID : 'role', actionID, 'side', side, 'pos', pos, 'lv', level);
    b.cmds[petID] = cmd;
    tryResolve(c, b);
  });
  // 1309 BATTLE_ROUND_USE_ITEM: side, posIdx, itemID
  on(1309, (c, rd) => {
    const side = rd.u32(), pos = rd.i32(), itemID = rd.u32();
    const b = current(c); if (b) roleCmd(c, b, { actionID: ACT.ITEM, itemID, side, pos });
  });
  // 1338 BATTLE_ROUND_USE_CAPTURE_ITEM: side, posIdx, itemID (闪灵胶片)
  on(1338, (c, rd) => {
    const side = rd.u32(), pos = rd.i32(), itemID = rd.u32();
    const b = current(c); if (b) roleCmd(c, b, { actionID: ACT.CAPTURE, itemID, side, pos });
  });
  // 1339 BATTLE_ROUND_CALL_PET: petID of a standby pet (0 = call the pet back)
  on(1339, (c, rd) => {
    const petID = rd.u32();
    LOG('1339 call pet', petID);
    const b = current(c); if (b) roleCmd(c, b, { actionID: ACT.CALL_PET, petID });
  });

  // ---------------------------------------------------------------- status effects (异常状态)
  // Effects as described in Skill.xml: 中毒 -10% current HP and 诅咒 -10% current MP before each action,
  // 昏睡/睡眠 cannot act and wakes when hit, 石化 damage and healing taken halved, 遗忘 skills fail (normal attack
  // only), 混乱 acts on a random target of either side. Client display: state1 bits (module AvatarState).
  const STATUS = [
    { k: 'stone', bit: 1, re: /石化/ }, { k: 'forget', bit: 2, re: /遗忘/ }, { k: 'confusion', bit: 4, re: /混乱/ },
    { k: 'curse', bit: 8, re: /诅咒/ }, { k: 'poison', bit: 16, re: /毒/ }, { k: 'sleep', bit: 32, re: /睡眠|昏睡/ },
  ];
  const stBits = (a) => a && a.status ? STATUS.reduce((v, x) => v | (a.status[x.k] > 0 ? x.bit : 0), 0) : 0;
  const has = (a, k) => !!(a && a.status && a.status[k] > 0);
  // resistance: own skills named "X抵抗" (Skill.xml "抗性增加N%")
  function resist(t, st) {
    let v = 0;
    (t.skills || []).forEach(k => { const info = M.skillInfo(k.id); if (!info || !/抵抗/.test(info.name) || !st.re.test(info.name)) return;
      const L = info.lv.find(x => x.lv === k.lv) || info.lv[0]; const m = L && L.desc.match(/(\d+)%/); if (m) v += Number(m[1]); });
    return v;
  }
  function tryStatus(t, sk) {
    if (!sk.status || !t || t.hp <= 0) return false;
    const st = STATUS.find(x => x.k === sk.status);
    const p = Math.max(5, sk.statusChance - resist(t, st));
    if (Math.random() * 100 >= p) return false;
    t.status = t.status || {}; t.status[st.k] = Math.max(t.status[st.k] || 0, sk.statusRounds);
    LOG('status', t.nick, st.k, sk.statusRounds + ' rounds');
    return true;
  }
  // before an avatar acts: poison/curse damage, durations; returns true if it cannot act (sleep)
  function statusTick(a) {
    a._tickHp = 0; a._tickMp = 0; a._confused = has(a, 'confusion'); a._forget = has(a, 'forget');
    if (!a.status) return false;
    if (has(a, 'poison')) { const d = Math.floor(a.hp * 0.1); a.hp -= d; a._tickHp = -d; }
    if (has(a, 'curse')) { const d = Math.floor(a.mp * 0.1); a.mp -= d; a._tickMp = -d; }
    const asleep = has(a, 'sleep');
    Object.keys(a.status).forEach(k => { a.status[k]--; if (a.status[k] <= 0) delete a.status[k]; });
    return asleep;
  }
  // damage / healing taken, with 石化 halving and 昏睡 waking up
  function hurt(t, dmg) {
    if (has(t, 'stone')) dmg = Math.ceil(dmg / 2);
    if (dmg > 0 && has(t, 'sleep')) delete t.status.sleep;
    t.hp = Math.max(0, t.hp - dmg);
    return dmg;
  }
  const healAmt = (t, h) => has(t, 'stone') ? Math.floor(h / 2) : h;

  // ---------------------------------------------------------------- skills
  // Skill effects follow BattleActionListConfig.xml Type/TargetAmount and the numbers written in Skill.xml
  // level descriptions ("1.3倍物理攻击", "基础伤害123"). APPROX: the exact formulas are server side.
  function skillOf(id, lv, raw) {
    const act = D.actions[id]; const info = M.skillInfo(id);
    if (!act || !info || id === ACT.PET_ATTACK || id === ACT.ATTACK) return null;
    const L = info.lv.find(x => x.lv === lv) || info.lv[info.lv.length - 1];
    const desc = (L && L.desc) || '';
    const pct = desc.match(/提升(\d+)%物理攻击/);
    const mult = desc.match(/(\d+(?:\.\d+)?)倍/), base = desc.match(/基础伤害(\d+)/), heal = desc.match(/回复(\d+)/);
    const nm = info.name || '';
    const st = /抵抗/.test(nm) ? null : STATUS.find(x => x.re.test(nm));
    const chance = desc.match(/有(\d+)%概率/), rounds = desc.match(/(\d+)回合/);
    const sk = {
      status: st ? st.k : null, statusChance: chance ? Number(chance[1]) : Math.min(90, 40 + 8 * lv), statusRounds: rounds ? Number(rounds[1]) : 2,
      id, lv, desc, type: +act.Type || 1, amount: +act.TargetAmount || 0, target: +act.ApplyTarget || 2,
      mp: info.mpA + info.mpB * Math.max(0, lv - 1),
      revive: /复活/.test(desc + ((M.skillInfo(id) || {}).name || '')), revivePct: (desc.match(/(\d+)%/) ? Number(desc.match(/(\d+)%/)[1]) / 100 : 0.3),
      mult: mult ? Number(mult[1]) : pct ? 1 + Number(pct[1]) / 100 : 1 + 0.1 * lv, base: base ? Number(base[1]) : 40 + 20 * lv, heal: heal ? Number(heal[1]) : 60 + 40 * lv,
    };
    // 修改器「技能」页: per-skill overrides stored in the save (all levels, everyone who uses the skill)
    const o = !raw && ((M.Store.load().skillMods || {})[id]);
    if (o && o.status && STATUS.some(x => x.k === o.status)) sk.status = o.status;   // extra status effect chosen in the modifier
    if (o) ['mult', 'base', 'heal', 'mp', 'statusChance', 'statusRounds'].forEach(k => { if (o[k] !== undefined && o[k] !== null && o[k] !== '' && !isNaN(o[k])) sk[k] = Number(o[k]); });
    return sk;
  }
  M.skillOf = skillOf;
  function magicDamage(att, tgt, sk) {
    if (Math.random() * 100 > Math.max(40, att.hit - tgt.dodge / 2)) return { miss: true, dmg: 0 };
    const d = (sk.base + att.matk * 0.4 - tgt.mdef * 0.3) * rand(0.9, 1.1);
    return { dmg: Math.max(1, Math.round(d)) };
  }
  // targets: single (0), T/column/row (1-3: APPROX up to 3), all (4)
  function targetsFor(list, first, amount) {
    const live = alive(list); if (!live.length) return [];
    const t0 = (first && first.hp > 0) ? first : pick(live);
    if (amount === 0) return [t0];
    if (amount === 4) return live;
    return [t0].concat(live.filter(x => x !== t0).slice(0, 2));
  }
  // one avatar's attack or skill: returns the action loops
  function doAttack(a, cmd, foes, friends, defending) {
    const lv = cmd.level || 1;
    let sk = skillOf(cmd.actionID, lv);
    if (a._forget) sk = null;                                   // 遗忘: skills fail
    if (a._confused) {                                          // 混乱: normal attack on a random avatar of either side
      sk = null; const all = alive(foes.concat(friends)).filter(x => x !== a);
      const t = pick(all); if (!t) return [];
      const r = damage(a, t, defending.has(t)); r.dmg = hurt(t, r.dmg);
      return [{ atkType: a.isRole ? ACT.ATTACK : ACT.PET_ATTACK, target: t, change_hp: -r.dmg, state2: hitBits(r, t, defending) }];
    }
    const first = cmd.side === (a.side === 0 ? 1 : 0) ? foes.find(m => m.posIdx === cmd.pos) : (cmd.side === a.side ? friends.find(m => m.posIdx === cmd.pos) : null);
    if (sk && a.mp >= sk.mp) {
      a.mp -= sk.mp; a._mpCost = sk.mp;
      LOG('skill', a.nick, (M.skillInfo(sk.id) || {}).name, 'Lv' + lv, 'type', sk.type, 'mp -' + sk.mp);
      if (sk.revive) {      // revive (复活) a knocked-down ally that was not knocked off the field
        const down = friends.filter(f => f.hp <= 0 && !f.knockedOff && !f.captured);
        const t = (first && down.includes(first)) ? first : down[0];
        if (t) { t.hp = Math.max(1, Math.round(t.hp_max * sk.revivePct)); t.downShown = false;
          return [{ atkType: sk.id, level: lv, target: t, change_hp: t.hp, state2: 4096 }]; }
      }
      if (sk.type === 4) {   // HP recovery on own side
        const tgts = targetsFor(friends, first && first.side === a.side ? first : a, sk.amount);
        return tgts.map((t, i) => { const h = Math.max(0, Math.min(healAmt(t, sk.heal), t.hp_max - t.hp)); t.hp += h;
          return { atkType: sk.id, level: lv, target: t, change_hp: h }; });
      }
      if ([3, 5, 9, 17].includes(sk.type)) {   // defensive skills: treated as defending this round
        defending.add(a);
        return [{ atkType: sk.id, level: lv, target: a }];
      }
      const tgts = targetsFor(foes, first && first.side !== a.side ? first : null, sk.amount);
      if (sk.type === 2) {   // Mp攻击 (e.g. 破魂): drains the target's MP, no HP damage (percentage from Skill.xml text)
        const pc = (sk.desc.match(/(\d+)%/) ? Number(sk.desc.match(/(\d+)%/)[1]) : 4 + 2 * lv) / 100;
        return tgts.map(t => { const d = Math.min(t.mp, Math.max(1, Math.round(t.mp * pc + a.atk * 0.05)));
          t.mp -= d; return { atkType: sk.id, level: lv, target: t, change_mp: -d }; });
      }
      if (sk.type === 8) {   // 异常状态魔法: no HP damage, applies the status (chance from level, minus the target's 抵抗)
        return tgts.map(t => { const ok = tryStatus(t, sk); return { atkType: sk.id, level: lv, target: t, state2: ok ? 0 : 32 }; });
      }
      return tgts.map((t, i) => {
        const r = (sk.type === 7 || sk.type === 6) ? magicDamage(a, t, sk)
          : (() => { const x = damage(a, t, defending.has(t)); x.dmg = Math.round(x.dmg * sk.mult); return x; })();
        r.dmg = hurt(t, r.dmg);
        if (!r.miss) tryStatus(t, sk);
        if (sk.type === 15 || sk.type === 6) { const h = Math.round(r.dmg * 0.3); a.hp = Math.min(a.hp_max, a.hp + h); }
        return { atkType: sk.id, level: lv, target: t, change_hp: -r.dmg, state2: hitBits(r, t, defending) };
      });
    }
    const tgt = (first && first.side !== a.side && first.hp > 0) ? first : pick(alive(foes));
    if (!tgt) return [];
    const r = damage(a, tgt, defending.has(tgt));
    r.dmg = hurt(tgt, r.dmg);
    return [{ atkType: a.isRole ? ACT.ATTACK : ACT.PET_ATTACK, target: tgt, change_hp: -r.dmg, state2: hitBits(r, tgt, defending) }];
  }
  // ---- skill catalogue for the modifier (修改器): every Skill.xml skill that has a battle action.
  // kind 'pet': usable by pets (BattleActionListConfig User 1 or 3), 'role': person skills (User empty), else all.
  const TYPE_NAME = { 1: '物理攻击', 2: 'MP攻击', 3: '防御', 4: '回复', 5: '状态防御', 6: '吸血魔法', 7: '魔法攻击', 8: '异常状态', 9: '防御状态', 15: '吸血攻击', 17: '护卫' };
  M.skillList = function (kind) {
    if (!D.skillDoc) return [];
    D._skillList = D._skillList || Array.from(D.skillDoc.getElementsByTagName('Skill')).map(e => {
      const id = Number(e.getAttribute('ID')); const act = D.actions[id]; const info = M.skillInfo(id);
      if (!act || !info || act.Property === '1') return null;
      return { id, name: info.name || String(id), type: +act.Type || 0, typeName: TYPE_NAME[+act.Type] || ('类型' + act.Type), user: act.User || '', maxLv: info.lv.length || 1 };
    }).filter(Boolean).sort((a, b) => a.id - b.id);
    return D._skillList.filter(k => kind === 'pet' ? (k.user === '1' || k.user === '3') : kind === 'role' ? !k.user : true);
  };
  M.skillMods = () => { const d = M.Store.load(); d.skillMods = d.skillMods || {}; return d.skillMods; };
  M.setSkillMod = function (id, mod) { const m = M.skillMods(); if (mod && Object.keys(mod).length) m[id] = mod; else delete m[id]; M.Store.save(); };

  // ---------------------------------------------------------------- auto battle AI (APPROX, the original is server side)
  // Used for the role and pets in auto battle (1308 AUTO without an auto-battle skill set) and for assist pets.
  // A skill is usable when the avatar has the MP and, for the role, the weapon/shield the action asks for
  // (BattleActionListConfig Weapon/Shield). Choice: revive a fallen ally > heal an ally under 40% HP > status magic on a foe
  // that does not have that status yet (20%, or always when it is the only kind left) > a random attack skill >
  // normal attack only when no skill is usable.
  function usableSkill(a, s) {
    const act = D.actions[s.id]; const sk = skillOf(s.id, s.lv || 1);
    if (!act || !sk || act.Property === '1' || a.mp < sk.mp) return null;
    if (a.isRole) {
      const w = Number(act.Weapon); if (!isNaN(w) && w !== -1 && w !== (a.weaponType || 0)) return null;
      const sh = Number(act.Shield || 0); if ((sh === 1 && !a.hasShield) || (sh === 2 && a.hasShield)) return null;
    }
    return sk;
  }
  function autoCmd(a, foes, friends) {
    const foeSide = a.side === 0 ? 1 : 0;
    const dflt = { actionID: a.isRole ? ACT.ATTACK : ACT.PET_ATTACK, side: foeSide, pos: -1 };
    const sks = (a.skills || []).map(s => usableSkill(a, s)).filter(Boolean);
    if (!sks.length) return dflt;
    const mk = (sk, t) => ({ actionID: sk.id, level: sk.lv, side: t ? t.side : foeSide, pos: t ? t.posIdx : -1 });
    const down = friends.filter(f => f.hp <= 0 && !f.knockedOff && !f.captured);
    const rev = sks.find(k => k.revive); if (rev && down.length) return mk(rev, down[0]);
    const weak = alive(friends).filter(f => f.hp < f.hp_max * 0.4).sort((x, y) => x.hp / x.hp_max - y.hp / y.hp_max)[0];
    const heal = sks.filter(k => k.type === 4 && !k.revive);
    if (weak && heal.length) return mk(pick(heal), weak);
    const st = sks.filter(k => k.type === 8 && k.status && alive(foes).some(f => !has(f, k.status)));
    const atk = sks.filter(k => [1, 6, 7, 15].includes(k.type) && !k.revive);
    const useSt = () => { const k = pick(st); return mk(k, pick(alive(foes).filter(f => !has(f, k.status)))); };
    if (st.length && (!atk.length || Math.random() < 0.2)) return useSt();
    if (atk.length) return mk(pick(atk), null);        // a usable skill is always preferred to the normal attack
    return dflt;
  }

  // monster AI: SpecSkill by weight (APPROX 35% of turns), otherwise a normal attack on a random player
  function monsterCmd(m) {
    // SpecSkill by weight whenever one is usable (APPROX). A kill by a skill without knock-down/knock-off phases is turned
    // into a normal attack by markKills, so every usable skill is allowed here.
    if (m.spec.length) {
      const ok = m.spec.filter(x => { const act = D.actions[x.id]; return act && (!act.User || act.User === '1' || act.User === '2') && act.Property !== '1' && ![3, 5, 9, 17].includes(+act.Type) && skillOf(x.id, 1); });
      if (ok.length) {
        const tot = ok.reduce((x, y) => x + y.w, 0); let k = Math.random() * tot;
        const sp = ok.find(x => (k -= x.w) < 0) || ok[0];
        const t = +D.actions[sp.id].Type;
        if (t !== 4 || alive(m.side === 1 ? [m] : []).some(f => f.hp < f.hp_max * 0.6))
          return { actionID: sp.id, level: Math.max(1, Math.min(10, Math.ceil(m.level / 10))), side: 0, pos: -1 };
      }
    }
    return { actionID: ACT.PET_ATTACK, side: 0, pos: -1 };
  }

  // ---------------------------------------------------------------- capture
  // Rate = Pet.xml <Beast Catch> (per 10000) + SpecCatch[film grade I..IV], film Race must match.
  // APPROX: x(1.5 - remaining hp ratio), clamped to 5%..95%.
  function tryCapture(c, b, role, cmd) {
    const r = c.role();
    const m = b.monsters.find(x => x.posIdx === cmd.pos && x.hp > 0);
    const it = D.items[cmd.itemID] || {};
    const races = String(it.Race || '').split(/\s+/).filter(x => x !== '').map(Number);
    if (!m || !M.takeGood(r, cmd.itemID, 1)) return [{ atkType: ACT.NONE, target: role }];
    let ok = false;
    if (m.catchRate > 0 && (!races.length || races.includes(m.race))) {
      const grade = Math.max(1, Number(it.CardLV || 1));
      const base = (m.catchRate + (m.specCatch[grade - 1] || 0)) / 10000;
      const p = Math.max(0.05, Math.min(0.95, base * (1.5 - m.hp / m.hp_max)));
      ok = Math.random() < p;
      LOG('capture', m.nick, 'Lv' + m.level, 'chance', p.toFixed(2), ok ? 'OK' : 'failed');
    }
    if (ok) { m.hp = 0; m.captured = true; b.captured.push({ typeID: m.petTypeID, level: m.level }); }
    return [{ atkType: ACT.CAPTURE, target: m, useItemID: cmd.itemID, state2: ok ? CAPTURE_SUCCESS : 0 }];
  }

  // ---------------------------------------------------------------- call pet in / back
  function callPet(c, b, role, petID) {
    const r = c.role();
    const cur = b.players.find(a => a.petState === PS.IN_BATTLE);
    const nb = petID ? b.backup.find(a => a.petID === petID && a.hp > 0) : null;
    if (petID && !nb) return [{ atkType: ACT.NONE, target: role }];
    // the client places a called pet at master posIdx +/- 5 (BattleAvatarManager.addAvatarPet)
    const pos = role.posIdx < 5 ? role.posIdx + 5 : role.posIdx - 5;
    if (cur) { b.players = b.players.filter(a => a !== cur); cur.petState = PS.OUT_BATTLE; cur.posIdx = 10; b.backup.push(cur); }
    if (nb) {
      b.backup = b.backup.filter(a => a !== nb); nb.petState = PS.IN_BATTLE; nb.posIdx = pos;
      b.players.push(nb); b.fought.add(nb.pet);
      // the old pet's command for this round is dropped; the called pet acts from next round
    }
    b.rosterChanged = true;
    LOG('call pet', petID, '-> field', b.players.map(a => a.nick + '#' + a.petID + '@' + a.posIdx).join(','), 'backup', b.backup.map(a => a.nick + '#' + a.petID).join(','));
    return [{ atkType: ACT.CALL_PET, target: { userID: role.userID, petID: nb ? nb.petID : 0 } }];
  }

  // cmds: { [petID]: {actionID, side, pos, level, itemID?, petID?} } for the role (0) and the main pet
  function resolveRound(c, b, cmds) {
    b.round++;
    const role = b.players[0];
    const acts = [];
    const defending = new Set();
    let escaped = false;
    // calling a pet in happens first so the new pet is on the field for the rest of the round
    const rc = cmds[0];
    if (rc && rc.actionID === ACT.CALL_PET && role.hp > 0) { acts.push({ actor: role, loops: callPet(c, b, role, rc.petID) }); rc.done = true; }
    const order = alive(b.players.concat(b.monsters)).sort((x, y) => (y.speed + Math.random() * 5) - (x.speed + Math.random() * 5));
    b.players.forEach(a => { const k = cmds[a.petID]; if (k && (k.actionID === ACT.DEFEND || k.actionID === ACT.PET_DEFEND)) defending.add(a); });
    for (const a of order) {
      if (a.hp <= 0 || (a.side === 0 && !b.players.includes(a))) continue;
      if (a.petState === PS.AIDE_PET && b.aidesAway) continue;
      if (statusTick(a)) {   // asleep: no action this round (the poison/curse loss is still shown)
        acts.push({ actor: a, loops: [{ atkType: a.isRole ? ACT.NONE : ACT.PET_NONE, target: a }] });
        continue;
      }
      if (a.side === 0) {
        if (a.petState === PS.AIDE_PET && b.aidesAway) continue;
        let cmd = a.petState === PS.AIDE_PET ? autoCmd(a, b.monsters, b.players) : cmds[a.petID];
        if (cmd && cmd.auto) cmd = autoCmd(a, b.monsters, b.players);
        if (a.isPet && a.petState === PS.IN_BATTLE && !cmd) continue;      // newly called pet waits a round
        cmd = cmd || { actionID: a.isPet ? ACT.PET_ATTACK : ACT.ATTACK, pos: -1 };
        if (cmd.done) continue;
        if (a === role && cmd.actionID === ACT.ESCAPE) {
          acts.push({ actor: a, loops: [{ atkType: ACT.ESCAPE, target: a }] });
          escaped = true; break;
        }
        if (a === role && cmd.actionID === ACT.CALL_AIDE) {
          // 召唤辅助 toggles the assist pets off / back on the field (the client animates it from its own state)
          b.aidesAway = !b.aidesAway;
          acts.push({ actor: a, loops: [{ atkType: ACT.CALL_AIDE, target: a }] });
        } else if (a === role && cmd.actionID === ACT.CAPTURE) { acts.push({ actor: a, loops: tryCapture(c, b, a, cmd) }); }
        else if (cmd.itemID) {
          // recovery item (itemInfo.xml HpUp/MpUp) on an own-side avatar
          const tgt = b.players.find(p => p.posIdx === cmd.pos) || a;
          const it = D.items[cmd.itemID] || {};
          if (M.takeGood(c.role(), cmd.itemID, 1)) {
            const hp = Math.max(0, Math.min(Number(it.HpUp || 0), tgt.hp_max - tgt.hp));
            const mp = Math.max(0, Math.min(Number(it.MpUp || 0), tgt.mp_max - tgt.mp));
            tgt.hp += hp; tgt.mp += mp;
            acts.push({ actor: a, loops: [{ atkType: ACT.ITEM, target: tgt, change_hp: hp, change_mp: mp, useItemID: cmd.itemID }] });
          } else acts.push({ actor: a, loops: [{ atkType: ACT.NONE, target: a }] });
        } else if ([ACT.DEFEND, ACT.PET_DEFEND, ACT.NONE, ACT.PET_NONE].includes(cmd.actionID)) {
          acts.push({ actor: a, loops: [{ atkType: cmd.actionID, target: a }] });
        } else {
          const loops = markKills(doAttack(a, cmd, b.monsters, b.players, defending), a);
          if (!loops.length) break;
          acts.push({ actor: a, loops, mp: a._mpCost || 0 }); a._mpCost = 0;
        }
      } else {
        if (!alive(b.players).length) break;
        const loops = markKills(doAttack(a, monsterCmd(a), b.players.filter(x => !(x.petState === PS.AIDE_PET && b.aidesAway)), b.monsters, defending), a);
        if (loops.length) acts.push({ actor: a, loops, mp: a._mpCost || 0 }); a._mpCost = 0;
      }
      if (!alive(b.monsters).length || !alive(b.players).length) break;
    }
    const w = new ByteWriter().u32(acts.length);
    acts.forEach((x, i) => writeAction(w, i + 1, x.actor, x.loops, x.mp));
    c.push(1310, w);
    c.push(1311, writeSync(b));
    LOG('round', b.round, 'hp', b.players.concat(b.monsters).map(a => a.nick + ':' + a.hp + '/' + a.hp_max).join(' '));
    // 1315 BATTLE_ROUND_START_INFO_RETURN: full sync (same body as 1311); the client adds avatars that are
    // missing and removes the ones not listed, so a pet that was called in really changes places
    // full sync once the round has been played back (the client gives no signal; sending it during the
    // playback breaks the animation). APPROX timing: ~1.2 s per action + 1.5 s.
    if (b.rosterChanged) {
      b.rosterChanged = false; b.syncPending = true;
      setTimeout(() => flushSync(c, b, 'timer'), Math.min(15000, 2500 + acts.length * 1500));
    }
    if (escaped) return finish(c, b, RESULT.DRAW);
    if (!alive(b.monsters).length) return finish(c, b, RESULT.WIN);
    if (!role || role.hp <= 0) return finish(c, b, RESULT.LOSE);   // the role fell: battle lost
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
      b.monsters.forEach(m => { if (m.captured) return; gained += expFor(m.level); rollDrops(m).forEach(id => { drops[id] = (drops[id] || 0) + 1; }); });
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

    // pets that fought: keep hp/mp, share the experience (APPROX: same amount as the role)
    const petEntries = [];
    b.players.concat(b.backup).filter(a => a.isPet).forEach(a => {
      const p = a.pet; p.hp = Math.max(0, a.hp); p.mp = Math.max(0, a.mp);
      if (!b.fought.has(p)) return;          // pets that never came out get no experience
      p.experience += gained; const up = M.petLevelCheck(p);
      petEntries.push({ petid: p.petid, up, gained });
    });
    // captured monsters become pets (pet bag first, depot when the bag is full)
    const caught = b.captured.map(x => M.newPet(r, x.typeID, x.level)).filter(Boolean);
    caught.forEach(p => { if (p.status === 3 && M.petsOf(r).some(q => q !== p && q.status === 3)) p.status = 1; });
    M.saveRole();
    if (caught.length && M.consoleSay) setTimeout(() => M.consoleSay(c, '捕捉成功：' + caught.map(p => p.nick + ' Lv' + p.level + (p.status === 0 ? '（已放入精灵仓库）' : '')).join('、')), 1500);
    petEntries.forEach(e => c.push(1318, new ByteWriter().u32(e.petid).u32(e.up).i32(e.gained).u32(0).u16(0)));
    // 1318 BattleResultPVEProtocol (role entry): petID, changeLevel, changeExp, protectExp, remaindExp u16,
    //      skills u8, bagFull u8, items u8 + (id, count)*
    const items = Object.keys(drops);
    const w = new ByteWriter().u32(0).u32(r.level - oldLv).i32(gained).u32(0).u16(0).u8(0).u8(0).u8(items.length);
    items.forEach(id => w.u32(Number(id)).u32(drops[id]));
    c.push(1318, w);
    // 1319 BattleOverNoticeProtocol
    // task battle conditions (beast group won) for tasks in progress
    const tinfo = result === RESULT.WIN && M.taskBattleWin ? M.taskBattleWin(r, (b.info || {}).groupID) : [];
    if (result === RESULT.WIN && (b.info || {}).groupID && M.onPracticeWin) M.onPracticeWin(r, b.info.groupID);
    if (result === RESULT.WIN && (b.info || {}).groupID) { const g = b.info.groupID; r.bossInfo = r.bossInfo || {}; r.bossInfo[g] = r.bossInfo[g] || {}; r.bossInfo[g].count = (r.bossInfo[g].count || 0) + 1; }
    if (M.onBattleEnd) setTimeout(() => M.onBattleEnd(), 3000);
    if (tinfo.length) M.saveRole();
    const o = new ByteWriter().u32(1).u32(result).u32(0).u32(0).u32(tinfo.length);
    tinfo.forEach(t => o.u32(t.taskID).u32(t.nodeID).u32(t.monster).u16(t.count).u16(t.target).u16(0).u16(0).u16(0));
    o
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
      // APPROX: some task groups list only high-level entries (group 19 of the 3rd main task: 迷唇爱丝 Lv16+);
      // the original level rule is unknown, so a group monster is at most 2 levels above the role
      lv = Math.min(lv, Math.max(1, (roleLevel || 1) + 2));
      // 修炼之域 guards (groups 3011-3100): always level 100, by request (the panel text also says 怪物等级 100 for most floors)
      if (groupID >= 3011 && groupID <= 3100) lv = 100;
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

  // 1300 BATTLE_INVITE(battleID, 0, 0): visible map monsters (monsters.xml <monster groupID>) send their beast group
  on(1300, (c, rd) => {
    const id = rd.u32();
    const list = groupMonsters(id, c.role().level);
    if (!list || !list.length) { LOG('1300 not a beast group', id); return c.reply(null, 5001); }
    startBattle(c, list, { groupID: id });
  });
  M.startGroupBattle = (c, id) => { const list = groupMonsters(id, c.role().level); if (list && list.length) startBattle(c, list, { groupID: id }); return !!(list && list.length); };

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
