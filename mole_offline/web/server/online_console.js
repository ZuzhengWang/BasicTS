// Chat box console: type a message starting with "/" in the in-game chat box.
// Everything edits the local save; answers appear in the chat box as 【控制台】.
// Other chat messages are echoed back so the chat box works offline.
(function (G) {
  'use strict';
  const M = G.Mole;
  const { ByteWriter, on, LOG, Data: D } = M;

  function chat(c, senderID, nick, toID, msg) {
    const n = new TextEncoder().encode(nick || ''), m = new TextEncoder().encode(msg);
    c.push(1010, new ByteWriter().u32(senderID).u8(n.length).bytes(n).u32(toID).u32(m.length).bytes(m));
  }
  const say = (c, msg) => String(msg).split('\n').forEach(line => chat(c, 50000, '控制台', 0, line));
  M.consoleSay = say;

  // refresh the client after an edit (bag/equipment listeners are permanent in ItemsManager)
  function refreshBag(c) { M.onlineHandlers[1109] && M.onlineHandlers[1109](mk(c, 1109)); M.onlineHandlers[1102] && M.onlineHandlers[1102](mk(c, 1102)); }
  function mk(c, cmd) { return Object.assign({}, c, { reply: (body, res) => c.conn.send(cmd, c.uid, body, res) }); }
  function refreshRole(c, r) { M.recalc(r); M.pushLevelUp && M.pushLevelUp(c, r); M.pushClothes && M.pushClothes(c, r); }

  const EQ_ATTR = { hp: 'hpMax', mp: 'mpMax', atk: 'attack', matk: 'mattact', def: 'defense', mdef: 'mdefense', speed: 'speed',
    spirit: 'spirit', resume: 'resume', hit: 'hit', dodge: 'dodge', crit: 'crit', fightback: 'fightback', dur: 'durationMax', level: 'levl' };
  const EQ_CFG = { hp: 'HpMax', mp: 'MpMax', atk: 'Atk', matk: 'Matk', def: 'Def', mdef: 'Mdef', speed: 'Speed', spirit: 'Spirit',
    resume: 'Resume', hit: 'Hit', dodge: 'Dodge', crit: 'Crit', fightback: 'FightBack' };
  const PET_ATTR = { hp: 'hp_max', mp: 'mp_max', atk: 'attack_value', def: 'defense_value', speed: 'speed', spirit: 'spirit',
    resume: 'resume', hit: 'hit_rate', dodge: 'avoid_rate', crit: 'bisha', fightback: 'fight_back' };
  const PET_BASE = { physique: 'physique', strength: 'strength', endurance: 'endurance', quick: 'quick', intelligence: 'intelligence',
    tili: 'physique', liliang: 'strength', naili: 'endurance', minjie: 'quick', zhili: 'intelligence' };
  const ROLE_FIELDS = ['physique', 'strength', 'endurance', 'quick', 'intelligen', 'attr_add', 'xiaomee', 'level', 'experience', 'hp', 'mp', 'honor', 'energy'];

  // equipment number, or "last" for the newest one
  const eqUid = (r, a) => a === 'last' ? Math.max(0, ...(r.equips || []).concat(r.dressed || []).map(e => e.uid)) : parseInt(a);
  const petArg = (r, v) => M.findPet(r, v === 'last' ? Math.max(0, ...M.petsOf(r).map(x => x.petid)) : parseInt(v));
  const itemName = (id) => ((D.items[id] || D.equips[id] || {}).Name) || ('#' + id);
  const HELP = [
    '可用命令（存档立即保存，部分界面需重新打开或重新登录后刷新）:',
    '/help  本说明',
    '/info  角色信息',
    '/money 数量 | /level 等级 | /exp 增加经验 | /heal 回满',
    '/role 属性 数值  属性: ' + ROLE_FIELDS.join(' '),
    '/additem 物品ID [数量]  （装备ID也可以）',
    '/find 名字关键字  查物品/装备/宠物ID',
    '/items  背包物品 | /equips  背包和身上的装备',
    '/setequip 装备编号 属性 数值（编号可写 last 表示最新的装备）  属性: ' + Object.keys(EQ_ATTR).join(' '),
    '/delequip 装备编号 | /wear 装备编号 | /upequip 装备编号 等级（按 item_equip.xml 的等级属性强化）',
    '/addpet 宠物类型ID [等级] | /pets  宠物列表 | /delpet 宠物编号',
    '/setpet 宠物编号 属性 数值  属性: level exp growth nick status points ' + Object.keys(PET_BASE).slice(0, 5).join(' ') + ' ' + Object.keys(PET_ATTR).join(' '),
    '/fightgrp 组ID  按怪物组开战（任务战斗，例如 19）',
    '/battlepets 3|9  上场宠物数量（3 原版，9 = 占满己方10个位置）',
    '/fight 怪物类型ID [等级] [数量]  立即开始一场战斗（方便测试捕捉）',
    '/petskills 宠物编号 | /addskill 宠物编号 技能ID [等级] | /delskill 宠物编号 技能ID',
    '捕捉：战斗中点“捕捉”，需要闪灵胶片（例如 /additem 270011 10 万用闪灵胶片I）',
    '/goto 地图ID  （下次进入地图生效，建议之后重新登录）',
  ].join('\n');

  const cmds = {
    help: (c) => say(c, HELP),
    info: (c, a, r) => say(c, `${r.nick} 职业${r.professtion} Lv${r.level} 经验${r.experience} 星豆${r.xiaomee}\nHP ${r.hp}/${r.hp_max} MP ${r.mp}/${r.mp_max} 攻${r.attackPower} 防${r.defensePower} 速${r.speed}\n体${r.physique} 力${r.strength} 耐${r.endurance} 敏${r.quick} 智${r.intelligen} 剩余点${r.attr_add} 地图${r.mapID}`),
    money: (c, a, r) => { r.xiaomee = Math.max(0, parseInt(a[0]) || 0); say(c, '星豆 = ' + r.xiaomee + '（重新登录后界面更新）'); },
    level: (c, a, r) => { const lv = Math.max(1, Math.min(200, parseInt(a[0]) || 1)); r.level = lv; r.experience = M.LEVEL_EXP[lv] || r.experience; refreshRole(c, r); say(c, '等级 = ' + lv); },
    exp: (c, a, r) => { r.experience += Math.max(0, parseInt(a[0]) || 0); const up = M.levelCheck(r); refreshRole(c, r); say(c, '经验 = ' + r.experience + (up ? '，升了 ' + up + ' 级' : '')); },
    heal: (c, a, r) => { M.recalc(r); r.hp = r.hp_max; r.mp = r.mp_max; M.petsOf(r).forEach(p => { M.recalcPet(p); p.hp = p.hp_max; p.mp = p.mp_max; }); say(c, '已回满（界面数值在下次刷新时更新）'); },
    role: (c, a, r) => {
      const f = a[0], v = parseInt(a[1]);
      if (!ROLE_FIELDS.includes(f) || isNaN(v)) return say(c, '用法: /role 属性 数值  属性: ' + ROLE_FIELDS.join(' '));
      r[f] = v; refreshRole(c, r); say(c, f + ' = ' + v);
    },
    additem: (c, a, r) => {
      const id = parseInt(a[0]), n = Math.max(1, Math.min(999, parseInt(a[1]) || 1));
      if (!D.items[id] && !D.equips[id]) return say(c, '没有这个物品ID: ' + a[0] + '（可用 /find 名字 查询）');
      M.addItem(r, id, n); refreshBag(c); say(c, '获得 ' + itemName(id) + ' x' + n);
    },
    find: (c, a) => {
      const k = a.join(' '); if (!k) return say(c, '用法: /find 名字关键字');
      const out = [];
      for (const [tbl, tag] of [[D.items, '物品'], [D.equips, '装备'], [D.petTypes, '宠物']]) {
        for (const id in tbl) { if ((tbl[id].Name || '').includes(k)) out.push(tag + ' ' + id + ' ' + tbl[id].Name); if (out.length >= 15) break; }
      }
      say(c, out.length ? out.join('\n') : '没找到: ' + k);
    },
    items: (c, a, r) => say(c, (r.goods || []).filter(g => g.count > 0).map(g => g.goodID + ' ' + itemName(g.goodID) + ' x' + g.count).join('\n') || '背包没有物品'),
    equips: (c, a, r) => {
      const line = (e, w) => `[${e.uid}] ${w ? '(穿着)' : ''}${itemName(e.goodID)} 攻${e.attack || 0} 防${e.defense || 0} HP${e.hpMax || 0} 速${e.speed || 0}`;
      say(c, (r.dressed || []).map(e => line(e, true)).concat((r.equips || []).map(e => line(e, false))).join('\n') || '没有装备');
    },
    setequip: (c, a, r) => {
      const uid = eqUid(r, a[0]), f = a[1], v = parseInt(a[2]);
      const e = (r.dressed || []).concat(r.equips || []).find(x => x.uid === uid);
      if (!e || !EQ_ATTR[f] || isNaN(v)) return say(c, '用法: /setequip 装备编号 属性 数值（编号用 /equips 查看）');
      e[EQ_ATTR[f]] = v; if (EQ_CFG[f]) { e.cfg = Object.assign({}, e.cfg || {}); e.cfg[EQ_CFG[f]] = v; }
      if (f === 'dur') e.duration = v;
      M.recalc(r); refreshBag(c); say(c, itemName(e.goodID) + ' 的 ' + f + ' = ' + v + '（穿着的装备重新登录后完全刷新）');
    },
    upequip: (c, a, r) => {
      const uid = eqUid(r, a[0]), lv = parseInt(a[1]);
      const e = (r.dressed || []).concat(r.equips || []).find(x => x.uid === uid);
      const lvs = e && (D.equips[e.goodID] || {}).levels || [];
      if (!e || isNaN(lv)) return say(c, '用法: /upequip 装备编号 等级（这件可用等级: ' + (lvs.map(x => x.Lv).join(' ') || '?') + '）');
      if (!M.setEquipLevel(e, lv)) return say(c, '这件装备没有等级 ' + lv + '，可用: ' + lvs.map(x => x.Lv).join(' '));
      M.recalc(r); refreshBag(c); say(c, itemName(e.goodID) + ' 强化到 ' + lv + ' 级：攻' + e.attack + ' 防' + e.defense + ' HP' + e.hpMax);
    },
    delequip: (c, a, r) => {
      const uid = eqUid(r, a[0]); const n0 = (r.equips || []).length;
      r.equips = (r.equips || []).filter(x => x.uid !== uid); refreshBag(c);
      say(c, r.equips.length < n0 ? '已删除装备 ' + uid : '背包里没有编号 ' + uid + '（身上的装备请先脱下）');
    },
    wear: (c, a, r) => {
      const uid = eqUid(r, a[0]); const e = (r.equips || []).find(x => x.uid === uid);
      if (!e) return say(c, '背包里没有编号 ' + uid);
      const part = e.part || Number((D.equips[e.goodID] || {}).EquipPart || 0);
      const old = r.dressed.filter(x => (x.part || Number((D.equips[x.goodID] || {}).EquipPart || 0)) === part);
      r.dressed = r.dressed.filter(x => !old.includes(x)).concat([e]);
      r.equips = r.equips.filter(x => x !== e).concat(old);
      refreshRole(c, r); refreshBag(c); say(c, '已穿上 ' + itemName(e.goodID));
    },
    addpet: (c, a, r) => {
      const t = parseInt(a[0]), lv = Math.max(1, Math.min(200, parseInt(a[1]) || 1));
      const p = M.newPet(r, t, lv);
      if (!p) return say(c, '没有这个宠物类型: ' + a[0] + '（可用 /find 名字 查询）');
      say(c, '获得宠物 [' + p.petid + '] ' + p.nick + ' Lv' + p.level + (p.status === 3 ? '（出战）' : '') + '，打开宠物面板查看');
    },
    pets: (c, a, r) => say(c, M.petsOf(r).map(p => { M.recalcPet(p); return `[${p.petid}] ${p.nick}(类型${p.typeID}) Lv${p.level} 成长${p.growValue} 状态${p.status} HP${p.hp}/${p.hp_max} 攻${p.attack_value} 防${p.defense_value} 速${p.speed}`; }).join('\n') || '没有宠物'),
    delpet: (c, a, r) => { const id = parseInt(a[0]); r.pets = M.petsOf(r).filter(p => p.petid !== id); if (r.petID === id) M.setFollow(r, null); say(c, '已删除宠物 ' + id); },
    setpet: (c, a, r) => {
      const p = M.findPet(r, a[0] === 'last' ? Math.max(0, ...M.petsOf(r).map(x => x.petid)) : parseInt(a[0])), f = a[1], raw = a.slice(2).join(' '), v = parseInt(raw);
      if (!p || !f) return say(c, '用法: /setpet 宠物编号 属性 数值（编号用 /pets 查看）');
      if (f === 'nick') p.nick = raw;
      else if (isNaN(v)) return say(c, '数值不对: ' + raw);
      else if (f === 'level') { p.level = Math.max(1, Math.min(200, v)); p.experience = M.LEVEL_EXP[p.level] || p.experience; }
      else if (f === 'exp') { p.experience = v; M.petLevelCheck(p); }
      else if (f === 'growth') p.growValue = v;
      else if (f === 'status') p.status = v;
      else if (f === 'points') p.attr_point_remaid = v;
      else if (PET_BASE[f]) { p.fixed = p.fixed || {}; p.fixed[PET_BASE[f]] = v; }
      else if (PET_ATTR[f]) { p.override = p.override || {}; p.override[PET_ATTR[f]] = v; }
      else return say(c, '不认识的属性: ' + f);
      p.hp = null; p.mp = null; M.recalcPet(p);
      if (r.petID === p.petid) M.setFollow(r, p);
      say(c, `[${p.petid}] ${p.nick} Lv${p.level} 成长${p.growValue} HP${p.hp_max} 攻${p.attack_value} 防${p.defense_value} 速${p.speed}`);
    },
    fight: (c, a, r) => {
      const t = parseInt(a[0]), lv = Math.max(1, Math.min(200, parseInt(a[1]) || 1)), n = Math.max(1, Math.min(5, parseInt(a[2]) || 1));
      if (!D.petTypes[t]) return say(c, '用法: /fight 怪物类型ID [等级] [数量]（ID 用 /find 名字 查，例如 /fight 3 1 = 1级小石怪）');
      if (c.conn.state.battle) return say(c, '已经在战斗中');
      say(c, '开始战斗：' + D.petTypes[t].Name + ' Lv' + lv + ' x' + n);
      setTimeout(() => M.startBattle(c, Array.from({ length: n }, () => ({ typeID: t, level: lv })), { console: true }), 300);
    },
    fightgrp: (c, a, r) => {
      const g = parseInt(a[0]);
      if (c.conn.state.battle) return say(c, '已经在战斗中');
      if (!g || !M.startGroupBattle(c, g)) return say(c, '用法: /fightgrp 怪物组ID（Beastgrp.xml，任务战斗用的组，例如 19）');
      say(c, '开始战斗：怪物组 ' + g);
    },
    battlepets: (c, a, r) => {
      const n = parseInt(a[0]);
      if (n !== 3 && n !== 9) return say(c, '用法: /battlepets 3（原版：主战+2辅助）或 /battlepets 9（背包宠物最多9只同时上场）。当前: ' + (r.battlePets || 9));
      r.battlePets = n; say(c, n === 9 ? '下次战斗起：主战宠物听指挥，其余最多8只背包宠物作为辅助自动战斗' : '已恢复原版：主战 + 2只辅助');
    },
    petskills: (c, a, r) => {
      const p = petArg(r, a[0]); if (!p) return say(c, '用法: /petskills 宠物编号（last = 最新）');
      M.initPetSkills(p); M.syncPetSkills(p);
      say(c, `[${p.petid}] ${p.nick} 技能: ` + (p.skills.map(k => `${k.id} ${(M.skillInfo(k.id) || {}).name || ''} Lv${k.lv}`).join('，') || '无'));
    },
    addskill: (c, a, r) => {
      const p = petArg(r, a[0]), id = parseInt(a[1]), lv = parseInt(a[2]) || 0;
      if (!p || !M.skillInfo(id)) return say(c, '用法: /addskill 宠物编号 技能ID [等级]（技能ID见 Skill.xml，例如 5106 狂击、7003 流火术）');
      M.initPetSkills(p); let k = p.skills.find(x => x.id === id);
      if (!k) { k = { id, lv: 1, exp: 0 }; p.skills.push(k); }
      if (lv) k.fixedLv = lv; M.syncPetSkills(p);
      say(c, `[${p.petid}] ${p.nick} 学会 ${M.skillInfo(id).name} Lv${k.lv}（重新打开精灵背包查看）`);
    },
    delskill: (c, a, r) => {
      const p = petArg(r, a[0]), id = parseInt(a[1]);
      if (!p) return say(c, '用法: /delskill 宠物编号 技能ID');
      M.initPetSkills(p); const n = p.skills.length; p.skills = p.skills.filter(x => x.id !== id);
      say(c, p.skills.length < n ? '已删除技能 ' + id : '这只宠物没有技能 ' + id);
    },
    goto: (c, a, r) => { const id = parseInt(a[0]); if (!D.maps[id]) return say(c, '没有这个地图: ' + a[0]); r.mapID = id; r.posX = 400; r.posY = 400; say(c, '下次登录将出现在 ' + id + ' ' + (D.maps[id].Name || '')); },
  };

  // 1010 CHAT: toID u32, len u32, msg bytes
  on(1010, (c, rd) => {
    const toID = rd.u32(), len = rd.u32(); const msg = new TextDecoder().decode(rd.bytes(len)).replace(/\0+$/, '').replace(/0$/, '');   // ChatBehavior appends a literal "0"
    const r = M.ensureRole(c.role());
    const t = msg.trim();
    if (/^[/／]/.test(t)) {
      const parts = t.slice(1).trim().split(/\s+/); const name = (parts.shift() || '').toLowerCase();
      LOG('console:', t);
      const fn = cmds[name];
      if (!fn) return say(c, '未知命令 /' + name + '，输入 /help 查看');
      try { fn(c, parts, r); M.saveRole(); } catch (e) { console.error(e); say(c, '命令出错: ' + e.message); }
      return;
    }
    chat(c, r.userID, r.nick, toID, msg);   // normal chat: echo
  });
})(window);
