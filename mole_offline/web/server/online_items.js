// Online server: treatment, item use, buying/selling, changing equipment.
// Prices and potion values come from itemInfo.xml / item_equip.xml (client data).
(function (G) {
  'use strict';
  const M = G.Mole;
  const { ByteWriter, on, LOG, Data: D } = M;

  const good = (r, id) => (r.goods || []).find(g => g.goodID === id && g.count > 0);
  function takeGood(r, id, n) {
    const g = good(r, id); if (!g || g.count < n) return false;
    g.count -= n; if (g.count <= 0) r.goods = r.goods.filter(x => x !== g); return true;
  }
  M.takeGood = takeGood;

  // ---- 1105 CHANGE_CLOTH push (PlayerChangeClothProtocol): userID, flag, honorID, count, ClothInfo*
  const clothList = (r) => M.clothesOf(r);
  function pushClothes(c, r) {
    r.clothes = clothList(r);
    const w = new ByteWriter().u32(r.userID).u32(r.flag).u32(0).u32(r.clothes.length);
    r.clothes.forEach(x => w.u32(x.clothID).u32(x.clothType).u16(x.clothLevel));
    c.push(1105, w);
  }
  M.pushClothes = pushClothes;
  // after role creation the client keeps showing the bare mole until it gets the cloth list
  const create = M.onlineHandlers[1015];
  if (create) on(1015, (c, rd, p) => {
    create(c, rd, p);
    // the creation module resets the preview a few times; re-send after it has closed as well
    [500, 4000, 15000].forEach(ms => setTimeout(() => pushClothes(c, M.ensureRole(c.role())), ms));
  });
  // whenever the client (re)loads the players of a map, re-send our own outfit
  const listPlayers = M.onlineHandlers[1002];
  if (listPlayers) on(1002, (c, rd, p) => { listPlayers(c, rd, p); const r = M.ensureRole(c.role()); if ((r.dressed || []).length) setTimeout(() => pushClothes(c, r), 300); });

  // 1105 CHANGE_CLOTH request: count + (clothID u32, clothType u32, clothLevel u16)* = the full set to wear
  on(1105, (c, rd) => {
    const r = M.ensureRole(c.role());
    const n = rd.u32(); const want = [];
    for (let i = 0; i < n && rd.left >= 10; i++) { const uid = rd.u32(), goodID = rd.u32(); rd.u16(); want.push({ uid, goodID }); }
    const pool = r.dressed.concat(r.equips);
    const dressed = [];
    want.forEach(w0 => {
      const id = w0.goodID;
      const e = pool.find(x => x.uid === w0.uid && !dressed.includes(x)) || pool.find(x => x.goodID === id && !dressed.includes(x));
      if (!e) return;
      const part = e.part || Number((D.equips[id] || {}).EquipPart || 0);
      // one item per equipment part
      const clash = dressed.findIndex(x => (x.part || Number((D.equips[x.goodID] || {}).EquipPart || 0)) === part);
      if (clash >= 0) dressed.splice(clash, 1);
      dressed.push(e);
    });
    r.equips = pool.filter(x => !dressed.includes(x));
    r.dressed = dressed;
    M.recalc(r); M.saveRole();
    LOG('change cloth', dressed.map(x => x.goodID).join(','));
    pushClothes(c, r);
  });

  // ---- 1025 TREAT_ROLE_RESUME(type: 1 hp, 2 mp, 3 injury, 5 all) -> xiaomee, cost, count, TreatTragetInfo*
  // Prices follow the client's own TreatManager formulas (TreatmentModule.swf): free below level 10,
  // HP (max-hp)/2 (priest x0.5), MP (max-mp) (magician x0.5), injury level*4/6/10 for white/yellow/red.
  const PROF_PRIEST = 4, PROF_MAGE = 3;
  on(1025, (c, rd) => {
    const type = rd.u32(); const r = M.ensureRole(c.role());
    M.recalc(r);
    const doHp = type === 1 || type === 5, doMp = type === 2 || type === 5, doInj = type === 3 || type === 5;
    const needHp = doHp && r.hp < r.hp_max, needMp = doMp && r.mp < r.mp_max, needInj = doInj && (r.injuredLevel || 0) > 0;
    if (!needHp && !needMp && !needInj) return c.reply(null, 200203);   // SocketError.xml: 十分健康，无需治疗
    let cost = 0;
    if (r.level >= 10) {
      if (needHp) cost += Math.floor(Math.max(0, (r.hp_max - r.hp) / 2) * (r.professtion === PROF_PRIEST ? 0.5 : 1));
      if (needMp) cost += Math.floor((r.mp_max - r.mp) * (r.professtion === PROF_MAGE ? 0.5 : 1));
      if (needInj) cost += r.level * [0, 4, 6, 10][r.injuredLevel] ;
    }
    if (cost > r.xiaomee) return c.reply(null, 200200);   // 星豆不足
    r.xiaomee -= cost;
    if (needInj) { r.injuredLevel = 0; M.recalc(r); }
    if (doHp) r.hp = r.hp_max;
    if (doMp) r.mp = r.mp_max;
    M.saveRole();
    LOG('treat type', type, 'cost', cost, 'hp', r.hp, 'mp', r.mp);
    c.reply(new ByteWriter().u32(r.xiaomee).u32(cost).u32(1).u32(0).u32(r.hp).u32(r.hp_max).u32(r.mp).u32(r.mp_max).u32(r.injuredLevel || 0));
  });

  // ---- 1114 BAG_USEITEM(targetUserID, targetPetID, itemID) -> userID, target, pet, nickLen+nick, itemID, hp_up, mp_up
  on(1114, (c, rd) => {
    const target = rd.u32(), pet = rd.u32(), itemID = rd.u32();
    const r = M.ensureRole(c.role()); const it = D.items[itemID] || {};
    if (!takeGood(r, itemID, 1)) return c.reply(null, 200159);   // 没有该物品
    let hp = 0, mp = 0;
    if (!pet) {
      hp = Math.max(0, Math.min(Number(it.HpUp || 0), r.hp_max - r.hp)); mp = Math.max(0, Math.min(Number(it.MpUp || 0), r.mp_max - r.mp));
      r.hp += hp; r.mp += mp;
    }
    M.saveRole();
    c.reply(new ByteWriter().u32(c.uid).u32(target).u32(pet).u8(0).u32(itemID).u32(hp).u32(mp));
  });

  // ---- 1108 BAG_BUYITEM(npcID, itemID, count) -> itemID, count, xiaomee, cost
  on(1108, (c, rd) => {
    const npc = rd.u32(), itemID = rd.u32(), count = Math.max(1, rd.u32());
    const r = M.ensureRole(c.role()); const it = D.items[itemID];
    const price = it ? Number(it.Price || 0) : 0;
    if (!it || price <= 0 || price >= 1000000) return c.reply(null, 200153);   // 无法购买该物品
    const cost = price * count;
    if (cost > r.xiaomee) return c.reply(null, 200200);
    r.xiaomee -= cost; M.addItem(r, itemID, count); M.saveRole();
    c.reply(new ByteWriter().u32(itemID).u32(count).u32(r.xiaomee).u32(cost));
  });
  // ---- 1101 BAG_BUYEQUIOP(npcID, itemID, level) -> SingleItemInfo(equip), xiaomee, cost
  on(1101, (c, rd) => {
    const npc = rd.u32(), itemID = rd.u32(), lv = rd.u32();
    const r = M.ensureRole(c.role()); const cfg = D.equips[itemID];
    const L = cfg && cfg.levels && (cfg.levels[lv] || cfg.levels[0]);
    const price = L ? Number(L.Price || 0) : 0;
    if (!cfg || price <= 0 || price >= 1000000) return c.reply(null, 200153);
    if (price > r.xiaomee) return c.reply(null, 200200);
    r.xiaomee -= price;
    const e = M.makeEquip(r, itemID); r.equips.push(e); M.saveRole();
    const w = new ByteWriter(); M.writeEquip(w, e); w.u32(r.xiaomee).u32(price);
    c.reply(w);
  });
  // ---- 1112 BAG_SELLITEMS(count, (itemID, count)*) -> xiaomee, gain
  on(1112, (c, rd) => {
    const n = rd.u32(); const r = M.ensureRole(c.role()); let gain = 0;
    for (let i = 0; i < n; i++) {
      const id = rd.u32(), cnt = rd.u32(); const it = D.items[id] || {};
      if (takeGood(r, id, cnt)) gain += Number(it.SalePrice || it.SellPrice || 0) * cnt;
    }
    r.xiaomee += gain; M.saveRole();
    c.reply(new ByteWriter().u32(r.xiaomee).u32(gain));
  });
  // ---- 1111 BAG_SELLEQUIP(count, uniqueID*) -> xiaomee, gain
  on(1111, (c, rd) => {
    const n = rd.u32(); const r = M.ensureRole(c.role()); let gain = 0;
    for (let i = 0; i < n; i++) {
      const uid = rd.u32(); const e = r.equips.find(x => x.uid === uid);
      if (!e) continue;
      const L = (D.equips[e.goodID] || {}).levels; gain += Number((L && L[0] && L[0].SellPrice) || 0);
      r.equips = r.equips.filter(x => x !== e);
    }
    r.xiaomee += gain; M.saveRole();
    c.reply(new ByteWriter().u32(r.xiaomee).u32(gain));
  });
})(window);
(function (G) {
  'use strict';
  const M = G.Mole;
  // 1113 BAG_DELETEITEM(itemID, count) -> itemID, count
  M.on(1113, (c, rd) => {
    const id = rd.u32(), cnt = rd.u32(); const r = M.ensureRole(c.role());
    M.takeGood(r, id, Math.min(cnt, ((r.goods || []).find(g => g.goodID === id) || { count: 0 }).count)); M.saveRole();
    c.reply(new M.ByteWriter().u32(id).u32(cnt));
  });
})(window);
