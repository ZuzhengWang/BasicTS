// In-game modifier panel: a floating button over the game opens a panel to add items / equipment / pets
// and edit role, equipment and pet values with taps. It runs the same commands as the chat console
// (Mole.runConsole), on the local save.
(function () {
  'use strict';
  const M = window.Mole;
  const css = `
  #mp-btn{position:fixed;left:6px;top:42%;z-index:99998;background:rgba(200,120,20,.85);color:#fff;border:2px solid #fff3;
    border-radius:10px;padding:8px 10px;font:bold 14px sans-serif;opacity:.9}
  #mp{position:fixed;inset:4% 6%;z-index:99999;background:#fbf1dc;border:3px solid #a8692a;border-radius:12px;display:none;
    flex-direction:column;font:14px sans-serif;color:#4a2c10;box-shadow:0 4px 20px #0008}
  #mp header{display:flex;align-items:center;gap:4px;padding:6px;background:#e8c48a;border-radius:9px 9px 0 0;flex-wrap:wrap}
  #mp header b{margin-right:6px}
  #mp .tab{border:1px solid #a8692a;background:#fff8ea;border-radius:6px;padding:5px 9px;font-size:14px}
  #mp .tab.on{background:#a8692a;color:#fff}
  #mp .x{margin-left:auto;font-size:18px;padding:2px 10px;border:none;background:#c0392b;color:#fff;border-radius:6px}
  #mp main{flex:1;overflow:auto;padding:8px}
  #mp footer{padding:6px 8px;background:#f3dfb8;border-radius:0 0 9px 9px;max-height:22%;overflow:auto;white-space:pre-wrap;font-size:13px}
  #mp input,#mp select{font-size:14px;padding:4px;border:1px solid #c49a63;border-radius:5px;background:#fff;max-width:100%}
  #mp input.n{width:70px}
  #mp .row{display:flex;align-items:center;gap:6px;padding:5px 2px;border-bottom:1px dashed #e0c79a;flex-wrap:wrap}
  #mp .row .nm{flex:1;min-width:120px}
  #mp button.go{background:#3b8b3b;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:14px}
  #mp button.sm{background:#7a5a2a;color:#fff;border:none;border-radius:5px;padding:4px 8px;font-size:13px}
  #mp .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
  #mp .grid label{display:flex;align-items:center;gap:4px;justify-content:space-between}
  #mp .card{border:1px solid #d9b884;border-radius:8px;padding:6px;margin-bottom:8px;background:#fffaf0}
  #mp .muted{color:#9a7a55;font-size:12px}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const btn = document.createElement('button'); btn.id = 'mp-btn'; btn.textContent = '修改器'; document.body.appendChild(btn);
  const box = document.createElement('div'); box.id = 'mp';
  box.innerHTML = '<header><b>修改器</b></header><main></main><footer>点上面的分类开始。修改会立即保存到本地存档。</footer>';
  document.body.appendChild(box);
  const head = box.querySelector('header'), main = box.querySelector('main'), foot = box.querySelector('footer');
  const tabs = { item: '物品/装备', pet: '加宠物', mypet: '我的宠物', myequip: '我的装备', role: '角色', task: '任务', gfx: '画面' };
  let cur = 'item';
  Object.keys(tabs).forEach(k => { const b = document.createElement('button'); b.className = 'tab'; b.textContent = tabs[k]; b.dataset.k = k; b.onclick = () => show(k); head.appendChild(b); });
  const xb = document.createElement('button'); xb.className = 'x'; xb.textContent = '×'; xb.onclick = () => { box.style.display = 'none'; }; head.appendChild(xb);
  btn.onclick = () => { box.style.display = 'flex'; show(cur); };
  // Memory: Ruffle does not give back the memory of finished battles (about +50 MB each, measured), and on a
  // phone the system eventually kills the page. Reloading frees it; the save is written after every action.
  const relBtn = document.createElement('button'); relBtn.className = 'tab'; relBtn.textContent = '清理内存(重新载入)';
  relBtn.style.background = '#2c6fbb'; relBtn.style.color = '#fff';
  relBtn.onclick = () => { if (confirm('重新载入游戏来释放内存？进度已自动保存，需要重新登录。')) { if (M.saveRole) M.saveRole(); location.reload(); } };
  head.insertBefore(relBtn, xb);
  let battles = 0;
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:99999;background:#2c6fbb;color:#fff;padding:8px 12px;border-radius:8px;font:14px sans-serif;display:none';
  document.body.appendChild(toast);
  M.onBattleEnd = () => {
    battles++;
    if (battles % 5 === 0) {
      toast.innerHTML = '已连续战斗 ' + battles + ' 场，手机内存可能不足。<u>点这里重新载入释放内存</u>（进度已保存）';
      toast.style.display = 'block'; toast.onclick = () => { if (M.saveRole) M.saveRole(); location.reload(); };
      setTimeout(() => { toast.style.display = 'none'; }, 15000);
    }
  };
  // keep key presses inside the panel away from the game
  ['keydown', 'keyup', 'keypress', 'pointerdown', 'touchstart', 'wheel'].forEach(ev => box.addEventListener(ev, e => e.stopPropagation()));

  const D = () => M.Data;
  const role = () => { const c = M.activeCtx; return c ? M.ensureRole(c.role()) : null; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  function run(line) { const out = M.runConsole ? M.runConsole(line) : '未就绪'; foot.textContent = out || '完成'; return out; }
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; };

  function show(k) {
    cur = k; head.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    main.innerHTML = '';
    if (!role() && k !== 'item' && k !== 'pet' && k !== 'gfx') { main.innerHTML = '<p>请先登录并进入游戏地图。</p>'; return; }
    ({ item: itemTab, pet: petTab, mypet: myPetTab, myequip: myEquipTab, role: roleTab, task: taskTab, gfx: gfxTab })[k]();
  }

  // ---- search & add items / equipment
  function itemTab() {
    main.appendChild(el('<div class="row"><input id="mp-q" placeholder="输入名字搜索，例如 药剂、剑、胶片" style="flex:1">' +
      '<select id="mp-kind"><option value="all">全部</option><option value="item">物品</option><option value="equip">装备</option></select></div>'));
    const list = document.createElement('div'); main.appendChild(list);
    const q = main.querySelector('#mp-q'), kind = main.querySelector('#mp-kind');
    const render = () => {
      const s = q.value.trim(); list.innerHTML = '';
      const res = [];
      const add = (tbl, tag) => { for (const id in tbl) { const n = tbl[id].Name || ''; if (!s || n.includes(s) || id === s) res.push([id, n, tag, tbl[id]]); if (res.length > 120) break; } };
      if (kind.value !== 'equip') add(D().items, '物品');
      if (kind.value !== 'item') add(D().equips, '装备');
      if (!s) list.appendChild(el('<p class="muted">输入关键字后显示结果（最多显示 120 条）。</p>'));
      res.slice(0, 120).forEach(([id, n, tag, x]) => {
        const lv = tag === '装备' ? ' Lv' + (x.UseLv || 1) + (x.Prof && x.Prof !== '-1' ? ' 职业' + x.Prof : '') : '';
        const row = el(`<div class="row"><span class="nm">${esc(n)} <span class="muted">${tag} ${id}${lv}</span></span>` +
          `<input class="n" type="number" value="1" min="1" max="999"><button class="go">添加</button></div>`);
        row.querySelector('.go').onclick = () => run('/additem ' + id + ' ' + (row.querySelector('input').value || 1));
        list.appendChild(row);
      });
    };
    q.oninput = render; kind.onchange = render; render();
  }

  // ---- add pets
  function petTab() {
    main.appendChild(el('<div class="row"><input id="mp-pq" placeholder="宠物名字，例如 小石怪、法尔" style="flex:1">' +
      '等级 <input id="mp-plv" class="n" type="number" value="10"> 成长 <input id="mp-pg" class="n" type="number" value="100"></div>'));
    const list = document.createElement('div'); main.appendChild(list);
    const q = main.querySelector('#mp-pq');
    const render = () => {
      const s = q.value.trim(); list.innerHTML = ''; let n = 0;
      for (const id in D().petTypes) {
        const t = D().petTypes[id]; if (s && !(t.Name || '').includes(s) && id !== s) continue;
        if (++n > 150) break;
        const row = el(`<div class="row"><span class="nm">${esc(t.Name)} <span class="muted">类型 ${id}</span></span><button class="go">添加</button></div>`);
        row.querySelector('.go').onclick = () => run(`/addpet ${id} ${main.querySelector('#mp-plv').value || 1} ${main.querySelector('#mp-pg').value || 100}`);
        list.appendChild(row);
      }
    };
    q.oninput = render; render();
  }

  // ---- edit own pets
  const PET_F = [['level', '等级'], ['growth', '成长'], ['extra', '转生附加成长'], ['points', '剩余属性点'], ['physique', '体力'], ['strength', '力量'],
    ['endurance', '耐力'], ['quick', '敏捷'], ['intelligence', '智力'], ['hp', '生命上限'], ['mp', '魔力上限'], ['atk', '攻击'], ['def', '防御'],
    ['speed', '速度'], ['spirit', '精神'], ['resume', '恢复'], ['hit', '命中'], ['dodge', '闪避'], ['crit', '暴击'], ['fightback', '反击']];
  const PET_V = { level: 'level', growth: 'growValue', extra: 'additionalGrowth', points: 'attr_point_remaid', physique: 'physique', strength: 'strength',
    endurance: 'endurance', quick: 'quick', intelligence: 'intelligence', hp: 'hp_max', mp: 'mp_max', atk: 'attack_value', def: 'defense_value',
    speed: 'speed', spirit: 'spirit', resume: 'resume', hit: 'hit_rate', dodge: 'avoid_rate', crit: 'bisha', fightback: 'fight_back' };
  const ST = ['仓库', '空闲', '待命', '主战', '辅助'];
  function myPetTab() {
    const r = role(); const pets = M.petsOf(r);
    if (!pets.length) { main.innerHTML = '<p>还没有宠物。去“加宠物”添加。</p>'; return; }
    pets.forEach(p => {
      M.recalcPet(p);
      const card = el(`<div class="card"><div class="row"><b class="nm">[${p.petid}] ${esc(p.nick)}</b>` +
        `<select class="stt">${ST.map((n, i) => `<option value="${i}"${p.status === i ? ' selected' : ''}>${n}</option>`).join('')}</select>` +
        `<button class="sm del">删除</button></div><div class="grid"></div>` +
        `<div class="row"><input class="sk" placeholder="技能ID，例如 5106" style="width:130px"><button class="sm addsk">学技能</button>` +
        `<span class="muted">${(p.skills || []).map(k => k.id + ' ' + ((M.skillInfo(k.id) || {}).name || '') + ' Lv' + k.lv).join('，')}</span></div>` +
        `<div class="row"><button class="go save">保存修改</button></div></div>`);
      const g = card.querySelector('.grid');
      PET_F.forEach(([f, n]) => g.appendChild(el(`<label>${n}<input class="n" data-f="${f}" type="number" value="${p[PET_V[f]] || 0}"></label>`)));
      card.querySelector('.save').onclick = () => {
        const outs = [];
        card.querySelectorAll('input[data-f]').forEach(i => { const v = Number(i.value); if (v !== Number(i.defaultValue)) outs.push(run(`/setpet ${p.petid} ${i.dataset.f} ${v}`)); });
        const s = Number(card.querySelector('.stt').value); if (s !== p.status) outs.push(run(`/setpet ${p.petid} status ${s}`));
        foot.textContent = outs.join('\n') || '没有改动'; myPetTab2();
      };
      card.querySelector('.del').onclick = () => { if (confirm('删除 ' + p.nick + '？')) { run('/delpet ' + p.petid); myPetTab2(); } };
      card.querySelector('.addsk').onclick = () => { run(`/addskill ${p.petid} ${card.querySelector('.sk').value}`); myPetTab2(); };
      main.appendChild(card);
    });
    main.appendChild(el('<p class="muted">宠物状态改成“主战/辅助/待命”后在下一场战斗生效；精灵背包要重新打开才刷新。</p>'));
  }
  const myPetTab2 = () => { const keep = foot.textContent; show('mypet'); foot.textContent = keep; };

  // ---- edit own equipment
  const EQ_F = [['atk', '攻击', 'attack'], ['matk', '魔攻', 'mattact'], ['def', '防御', 'defense'], ['mdef', '魔防', 'mdefense'], ['hp', '生命', 'hpMax'],
    ['mp', '魔力', 'mpMax'], ['speed', '速度', 'speed'], ['spirit', '精神', 'spirit'], ['resume', '恢复', 'resume'], ['hit', '命中', 'hit'],
    ['dodge', '闪避', 'dodge'], ['crit', '暴击', 'crit'], ['fightback', '反击', 'fightback'], ['dur', '耐久', 'durationMax'], ['level', '等级', 'levl']];
  function myEquipTab() {
    const r = role();
    const all = (r.dressed || []).map(e => [e, true]).concat((r.equips || []).map(e => [e, false]));
    if (!all.length) { main.innerHTML = '<p>没有装备。去“物品/装备”添加。</p>'; return; }
    all.forEach(([e, worn]) => {
      const name = (D().equips[e.goodID] || {}).Name || e.goodID;
      const card = el(`<div class="card"><div class="row"><b class="nm">[${e.uid}] ${esc(name)} ${worn ? '<span class="muted">(穿着)</span>' : ''}</b>` +
        (worn ? '' : '<button class="sm wear">穿上</button><button class="sm del">删除</button>') + `</div><div class="grid"></div>` +
        `<div class="row"><button class="go save">保存修改</button></div></div>`);
      const g = card.querySelector('.grid');
      EQ_F.forEach(([f, n, k]) => g.appendChild(el(`<label>${n}<input class="n" data-f="${f}" data-k="${k}" type="number" value="${e[k] || 0}"></label>`)));
      card.querySelector('.save').onclick = () => {
        const outs = [];
        card.querySelectorAll('input[data-f]').forEach(i => { const v = Number(i.value); if (v !== Number(i.defaultValue)) outs.push(run(`/setequip ${e.uid} ${i.dataset.f} ${v}`)); });
        foot.textContent = outs.join('\n') || '没有改动';
      };
      const w = card.querySelector('.wear'); if (w) w.onclick = () => { run('/wear ' + e.uid); show('myequip'); };
      const d = card.querySelector('.del'); if (d) d.onclick = () => { if (confirm('删除 ' + name + '？')) { run('/delequip ' + e.uid); show('myequip'); } };
      main.appendChild(card);
    });
    main.appendChild(el('<p class="muted">穿着的装备改完后，重新打开个人秀或重新登录界面才完全刷新。</p>'));
  }

  // ---- tasks: finish a task without playing it (e.g. its map does not load on the phone)
  function taskTab() {
    const r = role();
    const finish = (id) => {
      const name = M.taskName(id) || id;
      if (!confirm('直接完成任务「' + name + '」并领取剩余奖励？完成后游戏会重新载入（进度已保存）。')) return;
      const msg = M.forceFinishTask(r, id); foot.textContent = msg; alert(msg);
      if (/^已完成/.test(msg)) location.reload();
    };
    const row = (t, state) => {
      const d = el('<div style="display:flex;align-items:center;gap:6px;margin:4px 0"><span style="flex:1">' + esc(t.id) + ' ' + esc(t.name) +
        (t.level ? ' <small>Lv' + esc(t.level) + '</small>' : '') + ' <small>[' + esc(state) + ']</small></span></div>');
      if (state !== '已完成') { const b = el('<button class="tab">直接完成</button>'); b.onclick = () => finish(t.id); d.appendChild(b); }
      return d;
    };
    main.appendChild(el('<p><b>进行中的任务</b>（进不去的地图、打不过的战斗，可以直接完成）</p>'));
    const cur = M.taskPlaying(r);
    if (!cur.length) main.appendChild(el('<p style="color:#888">没有进行中的任务。</p>'));
    cur.forEach(t => main.appendChild(row(t, '进行中')));
    main.appendChild(el('<p><b>搜索任务</b>（还没接的任务也可以完成，例如要在勇士大厅接的任务）</p>'));
    const box2 = el('<div><input placeholder="任务名或ID" style="width:60%;font-size:15px"> <button class="tab">搜索</button><div></div></div>');
    const inp = box2.querySelector('input'), res = box2.querySelector('div');
    const go = () => { res.innerHTML = ''; const list = M.taskSearch(inp.value);
      if (!list.length) res.appendChild(el('<p style="color:#888">没有找到。</p>'));
      list.forEach(t => res.appendChild(row(t, M.taskStateOf(r, t.id)))); };
    box2.querySelector('button').onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    main.appendChild(box2);
  }

  // ---- renderer (phones differ from desktop: Ruffle picks WebGPU / WebGL / canvas by itself)
  function gfxTab() {
    let saved = ''; try { saved = localStorage.getItem('mole_renderer') || ''; } catch (e) { }
    const opts = [['', '默认(wgpu-webgl，电脑上测试通过)'], ['webgl', 'webgl'], ['wgpu-webgpu', 'WebGPU'], ['canvas', 'canvas(不推荐，换装/动画会坏)']];
    main.appendChild(el('<div><p>当前渲染器：<b>' + esc(window.__moleRenderer || '未知') + '</b></p><p style="font-size:12px;color:#666">' +
      esc((window.__moleRendererInfo || '').slice(0, 300)) + '</p><p>如果怪物血条清空却不倒下、装备和人物分离、没有技能动画，试着换一个渲染器（会重新载入，进度已保存）：</p></div>'));
    let sd = '1'; try { const v = localStorage.getItem('mole_dpr'); if (v !== null) sd = v; } catch (e) { }
    main.appendChild(el('<p>画面清晰度（越低越省内存，手机闪退就选 1）：当前 ' + esc(window.__moleDpr) + '，屏幕原生 ' + esc(window.__moleRealDpr) + '</p>'));
    [['1', '1（默认，最省内存）'], ['1.5', '1.5'], ['2', '2（更清晰，更耗内存）'], ['0', '原生（最耗内存）']].forEach(([v, t]) => {
      const b = el('<button class="tab" style="margin:4px">' + (v === sd ? '✔ ' : '') + esc(t) + '</button>');
      b.onclick = () => { try { localStorage.setItem('mole_dpr', v); } catch (e) { } if (M.saveRole) M.saveRole(); location.reload(); };
      main.appendChild(b);
    });
    main.appendChild(el('<p>渲染器：</p>'));
    opts.forEach(([v, t]) => {
      const b = el('<button class="tab" style="display:block;margin:6px 0">' + (v === saved ? '✔ ' : '') + esc(t) + '</button>');
      b.onclick = () => { try { if (v) localStorage.setItem('mole_renderer', v); else localStorage.removeItem('mole_renderer'); } catch (e) { }
        if (M.saveRole) M.saveRole(); location.reload(); };
      main.appendChild(b);
    });
  }

  // ---- role
  const ROLE_F = [['xiaomee', '星豆'], ['level', '等级'], ['experience', '经验'], ['attr_add', '剩余属性点'], ['physique', '体力'], ['strength', '力量'],
    ['endurance', '耐力'], ['quick', '敏捷'], ['intelligen', '智力'], ['honor', '荣誉'], ['energy', '精力']];
  function roleTab() {
    const r = role();
    const card = el(`<div class="card"><div class="row"><b class="nm">${esc(r.nick)} Lv${r.level}</b><button class="sm heal">全部回满</button></div>` +
      `<div class="grid"></div><div class="row"><button class="go save">保存修改</button></div>` +
      `<div class="row">上场宠物数 <select class="bp"><option value="9">9 只（占满）</option><option value="3">3 只（原版）</option></select></div>` +
      `<div class="row">快速战斗：怪物ID <input class="n fid" value="3"> 等级 <input class="n flv" value="5"> 数量 <input class="n fn" value="2"><button class="sm fight">开战</button></div></div>`);
    const g = card.querySelector('.grid');
    ROLE_F.forEach(([f, n]) => g.appendChild(el(`<label>${n}<input class="n" data-f="${f}" type="number" value="${r[f] || 0}"></label>`)));
    card.querySelector('.bp').value = String(r.battlePets || 9);
    card.querySelector('.bp').onchange = (ev) => run('/battlepets ' + ev.target.value);
    card.querySelector('.save').onclick = () => {
      const outs = [];
      card.querySelectorAll('input[data-f]').forEach(i => {
        const v = Number(i.value), f = i.dataset.f; if (v === Number(i.defaultValue)) return;
        outs.push(f === 'xiaomee' ? run('/money ' + v) : f === 'level' ? run('/level ' + v) : run(`/role ${f} ${v}`));
      });
      foot.textContent = (outs.join('\n') || '没有改动') + '\n星豆、属性的界面数值重新登录后完全刷新。';
    };
    card.querySelector('.heal').onclick = () => run('/heal');
    card.querySelector('.fight').onclick = () => { run(`/fight ${card.querySelector('.fid').value} ${card.querySelector('.flv').value} ${card.querySelector('.fn').value}`); box.style.display = 'none'; };
    main.appendChild(card);
  }
})();
