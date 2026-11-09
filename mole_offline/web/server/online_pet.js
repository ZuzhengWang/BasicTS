// Online server: pets. PetInfo layout from NewDLL com.mole2.core.info::PetInfo.
// Pet base stats are APPROX (growth factor * (level+1) * growValue/1000 + added points, then the
// client factor matrix) because the original server formula is not in the client.
(function (G) {
  'use strict';
  const M = G.Mole;
  const { ByteWriter, on, LOG, Data: D } = M;
  const ST = { DEPOT: 0, IDLE: 1, WAIT: 2, BATTLE: 3, ASSIST: 4 };
  M.PET_STATUS = ST;

  function pets(r) {
    r.pets = r.pets || []; r.nextPetId = r.nextPetId || 1;
    r.pets.forEach(p => { if (!(p.petid > 0)) p.petid = r.nextPetId++; });   // repair older saves
    r.nextPetId = Math.max(r.nextPetId, ...r.pets.map(p => p.petid + 1));
    return r.pets;
  }
  M.petsOf = pets;
  const KEYS = ['physique', 'strength', 'endurance', 'quick', 'intelligence'];
  const FACT = ['PhysiFactor', 'StrenFactor', 'EndurFactor', 'QuickFactor', 'IntelFactor'];

  function recalcPet(p) {
    const t = D.petTypes[p.typeID] || {};
    p.added = p.added || [0, 0, 0, 0, 0];
    KEYS.forEach((k, i) => {
      if (p.fixed && p.fixed[k] != null) { p[k] = p.fixed[k]; return; }   // set by the console
      p[k] = Math.round(Number(t[FACT[i]] || 20) * (p.level + 1) * (p.growValue || 100) / 2500) + 2 + p.added[i];
    });
    const tmp = { physique: p.physique, strength: p.strength, endurance: p.endurance, quick: p.quick, intelligen: p.intelligence, injuredLevel: p.injury_lv || 0, dressed: [] };
    M.recalc(tmp);
    const o = p.override || {};
    p.hp_max = o.hp_max || tmp.hp_max; p.mp_max = o.mp_max || tmp.mp_max;
    p.attack_value = o.attack_value || tmp.attackPower; p.defense_value = o.defense_value || tmp.defensePower;
    p.speed = o.speed || tmp.speed; p.spirit = o.spirit || tmp.spirit; p.resume = o.resume || tmp.restore;
    p.matk = o.matk || tmp.mgaicAttackPower; p.mdef = o.mdef || tmp.magicDefensePower;
    p.hit_rate = o.hit_rate || 90; p.avoid_rate = o.avoid_rate || 5; p.bisha = o.bisha || 3; p.fight_back = o.fight_back || 0;
    if (p.hp == null || p.hp > p.hp_max) p.hp = p.hp_max;
    if (p.mp == null || p.mp > p.mp_max) p.mp = p.mp_max;
    return p;
  }
  M.recalcPet = recalcPet;

  // ---- pet skills (Pet.xml <BaseSkill>/<TalentSkill>, Skill.xml levels)
  // APPROX: a new pet gets its BaseSkill plus each TalentSkill with chance Percent/1000 (at most 3 talents);
  // a skill's level follows the pet level (highest <Lv PetLevel> the pet has reached). The original server
  // rolled talents and charged for skill levels in the skill shop; those rules are not in the client.
  const ids = (el, tag) => { const e = el && el.getElementsByTagName(tag)[0]; return e ? { id: String(e.getAttribute('ID') || '').split(/\s+/).filter(Boolean).map(Number), pc: String(e.getAttribute('Percent') || '').split(/\s+/).map(Number) } : { id: [], pc: [] }; };
  M.skillInfo = function (id) {
    D.skillCache = D.skillCache || {};
    if (D.skillCache[id] !== undefined) return D.skillCache[id];
    let info = null;
    if (D.skillDoc) {
      const el = Array.from(D.skillDoc.getElementsByTagName('Skill')).find(e => e.getAttribute('ID') === String(id));
      if (el) {
        const job = el.getElementsByTagName('Job')[0];
        info = { id, name: el.getAttribute('Name'), mpA: +(job && job.getAttribute('MpA') || 0), mpB: +(job && job.getAttribute('MpB') || 0),
          lv: Array.from(el.getElementsByTagName('Lv')).map(l => ({ lv: +l.getAttribute('SkillLevel'), petLevel: +(l.getAttribute('PetLevel') || 0), desc: l.getAttribute('Desc') || '' })) };
        if (!info.lv.length) info.lv = [{ lv: 1, petLevel: 1, desc: '' }];
      }
    }
    return (D.skillCache[id] = info);
  };
  function syncSkillLevels(p) {
    (p.skills || []).forEach(k => {
      const info = M.skillInfo(k.id); if (!info) return;
      const reach = info.lv.filter(l => !l.petLevel || l.petLevel <= p.level).map(l => l.lv);
      k.lv = Math.max(k.fixedLv || 0, reach.length ? Math.max(...reach) : 1);
    });
  }
  M.syncPetSkills = syncSkillLevels;
  function initSkills(p) {
    if (p.skills) return;
    const t = D.petTypes[p.typeID]; const el = t && t.el;
    const base = ids(el, 'BaseSkill'), tal = ids(el, 'TalentSkill');
    const list = base.id.slice();
    let n = 0;
    tal.id.forEach((id, i) => { if (n < 3 && !list.includes(id) && Math.random() * 1000 < (tal.pc[i] || 0)) { list.push(id); n++; } });
    p.skills = list.filter(id => M.skillInfo(id)).map(id => ({ id, lv: 1, exp: 0 }));
    syncSkillLevels(p);
  }
  M.initPetSkills = initSkills;

  function newPet(r, typeID, level) {
    const t = D.petTypes[typeID];
    if (!t) return null;
    pets(r);
    const p = {
      petid: r.nextPetId++, typeID: Number(typeID), race: Number(t.Race || 0), flag: 0, nick: t.Name || ('宠物' + typeID),
      level: Math.max(1, level || 1), experience: (M.LEVEL_EXP && M.LEVEL_EXP[Math.max(1, level || 1)]) || 0, attr_point_remaid: 0, attr_point_applied: 0, added: [0, 0, 0, 0, 0],
      skillID_autoBattle: 0, skillLevel_autoBattle: 0, hp: null, mp: null,
      earth: Number(t.Earth || 0), water: Number(t.Water || 0), fire: Number(t.Fire || 0), wind: Number(t.Wind || 0),
      injury_lv: 0, status: pets(r).some(x => x.status === ST.BATTLE) ? ST.IDLE : ST.BATTLE, growValue: 100,
      reincarnationDegree: 0, additionalGrowth: 0,
    };
    // pet bag: 1 main + 2 assist + 2 standby + 6 others; further pets go to the depot (精灵仓库)
    if (pets(r).filter(x => x.status !== ST.DEPOT).length >= 11) p.status = ST.DEPOT;
    initSkills(p); recalcPet(p); pets(r).push(p);
    return p;
  }
  M.newPet = newPet;

  function writePet(w, p) {
    recalcPet(p); initSkills(p); syncSkillLevels(p);
    const nick = new TextEncoder().encode(p.nick || '');
    w.u32(p.petid).u32(p.typeID).u8(p.race).u32(p.flag || 0).u8(nick.length).bytes(nick)
      .u32(p.level).u32(p.experience)
      .u16(p.physique).u16(p.strength).u16(p.endurance).u16(p.quick).u16(p.intelligence)
      .u16(p.attr_point_remaid || 0).u16(p.attr_point_applied || 0);
    p.added.forEach(v => w.u16(v));
    w.u16(p.skillID_autoBattle || 0).u16(p.skillLevel_autoBattle || 0)
      .u32(p.hp).u32(p.mp).u8(p.earth).u8(p.water).u8(p.fire).u8(p.wind)
      .u32(p.injury_lv || 0).u8(p.status).u32(p.hp_max).u32(p.mp_max)
      .u16(p.attack_value).u16(p.defense_value).u16(p.speed).u16(p.spirit & 0xffff).u16(p.resume & 0xffff)
      .u16(p.hit_rate).u16(p.avoid_rate).u16(p.bisha).u16(p.fight_back).u16(p.growValue || 0)
      .u32(p.skills.length);
    p.skills.forEach(k => w.u32(k.id).u8(k.lv || 1).u32(k.exp || 0));
    w.u8(0).u8(p.reincarnationDegree || 0).u32(p.additionalGrowth || 0);
  }
  M.writePet = writePet;

  const findPet = (r, id) => pets(r).find(p => p.petid === id);
  M.findPet = findPet;

  // following pet shown on the map and in login/simple info
  function setFollow(r, p) {
    r.petID = p ? p.petid : 0; r.petTypeID = p ? p.typeID : 0; r.petRace = p ? p.race : 0;
    r.petNick = p ? p.nick : ''; r.petLevel = p ? p.level : 0;
  }
  M.setFollow = setFollow;
  function writeFollow(w, r) {
    const nick = new TextEncoder().encode(r.petNick || '');
    return w.u32(r.userID).u32(r.petID || 0).u32(r.petTypeID || 0).u8(r.petRace || 0).u8(nick.length).bytes(nick).u32(r.petLevel || 0);
  }

  // 1553 PET_GETINFO(petID) -> PetInfo
  on(1553, (c, rd) => {
    const id = rd.u32(); const p = findPet(c.role(), id);
    if (!p) return c.reply(null, 200001);
    const w = new ByteWriter(); writePet(w, p); c.reply(w);
  });
  // 1551 PET_CHANGE_FLAG(petID, status) -> currentPetID, waitStatusPetID
  on(1551, (c, rd) => {
    const id = rd.u32(), status = rd.u32(); const r = c.role(); const p = findPet(r, id);
    if (!p) return c.reply(null, 200001);
    let other = 0;
    if (status === ST.BATTLE) {
      const cur = pets(r).find(x => x.status === ST.BATTLE && x !== p);
      if (cur) { cur.status = ST.WAIT; other = cur.petid; }
    }
    p.status = status;
    M.saveRole();
    c.reply(new ByteWriter().u32(id).u32(other));
  });
  // 1558 PET_FOLLOW(petID|0) -> PetFollowProtocol
  on(1558, (c, rd) => {
    const id = rd.u32(); const r = c.role();
    setFollow(r, id ? findPet(r, id) : null); M.saveRole();
    c.reply(writeFollow(new ByteWriter(), r));
  });
  // 1552 PET_CHANGE_NICK(petID, nick[16]) -> userID, petID, nickLen+nick
  on(1552, (c, rd) => {
    const id = rd.u32(); const nick = rd.str(16); const r = c.role(); const p = findPet(r, id);
    if (p && nick) { p.nick = nick; if (r.petID === id) r.petNick = nick; M.saveRole(); }
    const n = new TextEncoder().encode(p ? p.nick : '');
    c.reply(new ByteWriter().u32(c.uid).u32(id).u8(n.length).bytes(n));
  });
  // 1603 AUTO_PET_ALLOCATE_ATTRPOINTS(petID) -> PetInfo ; 1606 PET_ALLOCATE_ATTRPOINTS(petID, 5 x u16) -> PetInfo
  on(1603, (c, rd) => {
    const p = findPet(c.role(), rd.u32()); if (!p) return c.reply(null, 200001);
    const t = D.petTypes[p.typeID] || {};
    const w0 = FACT.map(f => Number(t[f] || 1)); const sum = w0.reduce((a, b) => a + b, 0);
    let left = p.attr_point_remaid || 0;
    const add = w0.map(x => Math.floor((p.attr_point_remaid || 0) * x / sum)); left -= add.reduce((a, b) => a + b, 0);
    for (let i = 0; left > 0; i = (i + 1) % 5) { add[i]++; left--; }
    add.forEach((v, i) => { p.added[i] += v; }); p.attr_point_applied = (p.attr_point_applied || 0) + (p.attr_point_remaid || 0); p.attr_point_remaid = 0;
    M.saveRole(); const w = new ByteWriter(); writePet(w, p); c.reply(w);
  });
  on(1606, (c, rd) => {
    const p = findPet(c.role(), rd.u32()); if (!p) return c.reply(null, 200001);
    const add = [rd.u16(), rd.u16(), rd.u16(), rd.u16(), rd.u16()]; const tot = add.reduce((a, b) => a + b, 0);
    if (tot <= (p.attr_point_remaid || 0)) { add.forEach((v, i) => { p.added[i] += v; }); p.attr_point_remaid -= tot; p.attr_point_applied = (p.attr_point_applied || 0) + tot; M.saveRole(); }
    const w = new ByteWriter(); writePet(w, p); c.reply(w);
  });
  // 1555 TREAT_PET_RESUMEHP(petID) -> reuse role treat answer shape (xiaomee, cost, count, target*)
  on(1555, (c, rd) => {
    const r = c.role(); const p = findPet(r, rd.u32()); if (!p) return c.reply(null, 200001);
    recalcPet(p); p.hp = p.hp_max; p.mp = p.mp_max; M.saveRole();
    c.reply(new ByteWriter().u32(r.xiaomee).u32(0).u32(1).u32(p.petid).u32(p.hp).u32(p.hp_max).u32(p.mp).u32(p.mp_max).u32(p.injury_lv || 0));
  });

  // 1550 PET_SET_AUTOBATTLE_SKILL(petID, skillID u16, level u16) -> no listener in the client
  on(1550, (c, rd) => {
    const p = findPet(c.role(), rd.u32()); const id = rd.u16(), lv = rd.u16();
    if (p) { p.skillID_autoBattle = id; p.skillLevel_autoBattle = lv; M.saveRole(); }
    c.reply(new ByteWriter());
  });

  // pet level-up (APPROX: role exp table, 4 free points per level)
  M.petLevelCheck = function (p) {
    const T = M.LEVEL_EXP; const old = p.level;
    while (T[p.level + 1] !== undefined && p.experience >= T[p.level + 1]) { p.level++; p.attr_point_remaid = (p.attr_point_remaid || 0) + 4; }
    if (p.level > old) { p.hp = null; p.mp = null; recalcPet(p); syncSkillLevels(p); }
    return p.level - old;
  };
})(window);
