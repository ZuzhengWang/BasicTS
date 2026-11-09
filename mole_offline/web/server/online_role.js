// Online server: role creation and attribute calculation.
(function (G) {
  'use strict';
  const M = G.Mole;
  const { ByteWriter, on, LOG, Data: D } = M;

  M.FLAG = { VIP: 0, CREATE: 1, NEWER_COMPLETE: 2, NORMAL: 3 };
  M.setFlag = (role, bit, v) => {
    if (bit < 32) role.flag = v ? (role.flag | (1 << bit)) >>> 0 : (role.flag & ~(1 << bit)) >>> 0;
    else role.flag2 = v ? (role.flag2 | (1 << (bit - 32))) >>> 0 : (role.flag2 & ~(1 << (bit - 32))) >>> 0;
  };
  M.START_MAP = { id: 11101, x: 351, y: 335 };

  // Attribute factor matrix taken from the client (UserInfoPanal1._attrFactorMatrix):
  // rows = physique, strength, endurance, quick, intelligence; cols = hp, atk, def, speed, mp, spirit, restore.
  // The client uses it to split "base" from "equipment" values, so base = sum(row*attr) (uninjured).
  const F = [40, 0.5, 0.5, 0.5, 1, -0.3, 0.8, 10, 10, 1, 1, 2, -0.1, -0.1, 20, 1, 10, 1, 2, 0.2, -0.1, 20, 2, 1, 10, 2, -0.1, 0.2, 5, 0.5, 0.5, 0.5, 10, 0.8, -0.3];
  const INJURY = [10, 9, 6, 2];
  function base(r, col) {
    const a = [r.physique, r.strength, r.endurance, r.quick, r.intelligen];
    let s = 0; for (let i = 0; i < 5; i++) s += F[i * 7 + col] * a[i];
    return Math.trunc(s * INJURY[r.injuredLevel || 0] / 10);
  }
  // Equipment bonus from item_equip.xml (Level Lv=0 entry of the worn items)
  function equipBonus(r) {
    const b = { HpMax: 0, MpMax: 0, Atk: 0, Matk: 0, Def: 0, Mdef: 0, Speed: 0, Spirit: 0, Resume: 0, Hit: 0, Dodge: 0, Crit: 0, FightBack: 0 };
    (r.dressed || []).forEach(e => { for (const k in b) b[k] += Number(e.cfg && e.cfg[k] || 0); });
    return b;
  }
  // NOTE: the server-side formula of the original game is unknown. This uses the client's own factor
  // matrix for the five base stats; magic attack, hit, dodge, crit, counter are approximations.
  function recalc(r) {
    const eb = equipBonus(r);
    r.hp_max = Math.max(1, base(r, 0) + eb.HpMax);
    r.attackPower = Math.max(1, base(r, 1) + eb.Atk);
    r.defensePower = Math.max(0, base(r, 2) + eb.Def);
    r.speed = Math.max(1, base(r, 3) + eb.Speed);
    r.mp_max = Math.max(1, base(r, 4) + eb.MpMax);
    r.spirit = Math.max(0, 100 + base(r, 5) + eb.Spirit);
    r.restore = Math.max(0, 100 + base(r, 6) + eb.Resume);
    r.mgaicAttackPower = Math.max(0, Math.trunc(r.intelligen * 10 + r.physique * 0.5) + eb.Matk);
    r.magicDefensePower = Math.max(0, Math.trunc(r.intelligen * 2 + r.endurance * 2) + eb.Mdef);
    r.hit_rate = 90 + eb.Hit; r.avoid_rate = 5 + eb.Dodge; r.bisha = 5 + eb.Crit; r.attack_back = eb.FightBack;
    r.hp = Math.min(r.hp == null ? r.hp_max : r.hp, r.hp_max);
    r.mp = Math.min(r.mp == null ? r.mp_max : r.mp, r.mp_max);
    return r;
  }
  M.recalc = recalc;

  function makeEquip(role, goodID) {
    const cfg = D.equips && D.equips[goodID];
    const lv = cfg && cfg.levels && cfg.levels[0] || {};
    const e = {
      uid: role.nextEquipUid++, goodID: Number(goodID), levl: 0, color: 0, validday: 0,
      durationMax: Number(lv.Duration || 100), duration: Number(lv.Duration || 100),
      hpMax: +lv.HpMax || 0, mpMax: +lv.MpMax || 0, attack: +lv.Atk || 0, mattact: +lv.Matk || 0, defense: +lv.Def || 0,
      mdefense: +lv.Mdef || 0, speed: +lv.Speed || 0, spirit: +lv.Spirit || 0, resume: +lv.Resume || 0, hit: +lv.Hit || 0,
      dodge: +lv.Dodge || 0, crit: +lv.Crit || 0, fightback: +lv.FightBack || 0,
      part: cfg ? Number(cfg.EquipPart) : 0, cfg: lv,
    };
    return e;
  }
  M.makeEquip = makeEquip;

  // 1018 CHECK_STRING: nick[64] -> empty body on success
  on(1018, (c) => c.reply(new ByteWriter()));

  // ProtocolAnalyzer.setForInitInfo
  function writeInitInfo(w, r) {
    const nick = new TextEncoder().encode(r.nick || '');
    w.u8(nick.length).bytes(nick).u32(r.flag).u32(r.professtion).u32(r.color).u32(r.reg_time)
      .u16(r.physique).u16(r.strength).u16(r.endurance).u16(r.quick).u16(r.intelligen).u16(r.attr_add)
      .u32(r.hp).u32(r.mp).u8(r.earth).u8(r.water).u8(r.fire).u8(r.wind).u32(r.injuredLevel).u32(r.changeBodyID)
      .u32(r.mapID).u32(r.mapType).u32(r.posX).u32(r.posY)
      .u32(r.hp_max).u32(r.mp_max)
      .u16(r.attackPower).u16(r.mgaicAttackPower || 0).u16(r.defensePower).u16(r.magicDefensePower).u16(r.speed)
      .u16(r.spirit).u16(r.restore).u16(r.hit_rate).u16(r.avoid_rate).u16(r.bisha).u16(r.attack_back)
      .u16(r.anti_poison).u16(r.anti_stone).u16(r.anti_sleep).u16(r.anti_curse).u16(r.anti_confusion).u16(r.anti_forget);
    return w;
  }
  M.writeInitInfo = writeInitInfo;

  // 1015 INIT_USER_INFO: color u32, stoneID u32, name[16], career u32 -> setForInitInfo
  on(1015, (c, rd) => {
    const color = rd.u32(), stone = rd.u32(), name = rd.str(16), career = rd.u32();
    const r = M.ensureRole(c.role());
    const p = D.profs[career] || D.profs[1];
    r.nick = name || ('勇士' + r.userID); r.color = color; r.stoneID = stone;
    r.professtion = Number(p.ID);
    r.physique = +p.Physique; r.strength = +p.Strength; r.endurance = +p.Endurance;
    r.quick = +p.Quick; r.intelligen = +p.Intelligence; r.attr_add = 0;
    // starting equipment of the profession, worn
    r.dressed = String(p.Clothes || '').split(/\s+/).filter(Boolean).map(id => makeEquip(r, id));
    r.clothes = r.dressed.map(e => ({ clothID: e.goodID, clothType: 0, clothLevel: 0 }));
    M.setFlag(r, M.FLAG.CREATE, true);
    r.mapID = M.START_MAP.id; r.posX = M.START_MAP.x; r.posY = M.START_MAP.y;
    r.hp = null; r.mp = null; recalc(r);
    M.saveRole();
    LOG('role created', r.userID, r.nick, 'prof', r.professtion);
    c.reply(writeInitInfo(new ByteWriter(), r));
  });
})(window);
