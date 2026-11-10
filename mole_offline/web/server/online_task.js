// Online server: tasks (client drives the task script; server stores state and grants node rewards
// defined in res/config/task_summary.xml <Node><OutItem ID=set><Item OutType ItemId Count/>).
(function (G) {
  'use strict';
  const M = G.Mole;
  const { ByteWriter, on, LOG, Data: D } = M;

  let summary = null;
  async function loadSummary() {
    try {
      const r = await fetch('res/config/task_summary.xml');
      const u8 = new Uint8Array(await r.arrayBuffer());
      const key = u8.slice(u8.length - 16); const out = new Uint8Array(u8.length);
      for (let i = 0; i < u8.length; i++) out[i] = u8[i] ^ key[i % 16];
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(out.subarray(0, u8.length - 20)), 'text/xml');
      summary = {};
      // the file holds several <Task> lists; keep the entries that contain nodes
      for (const t of doc.getElementsByTagName('Task')) {
        const id = t.getAttribute('ID'); const nodes = t.getElementsByTagName('Node');
        if (!nodes.length && summary[id]) continue;
        summary[id] = { el: t, nodes: Array.from(nodes) };
      }
      LOG('task summary:', Object.keys(summary).length, 'tasks');
    } catch (e) { LOG('task summary not loaded', e); }
  }
  M.Data.ready = M.Data.ready.then(async (d) => { await loadSummary(); return d; });

  const now = () => Math.floor(Date.now() / 1000);
  function tasks(r) { r.tasks = r.tasks || {}; return r.tasks; }
  // finished state for TaskInfo (client TaskInfoStateType): 2 finished for good, 3 finished but can be redone
  // (task_summary RepeatType > 0); 0 = cancelled
  function finishedState(taskID) {
    const s = summary && summary[taskID];
    const rep = s && s.el ? Number(s.el.getAttribute('RepeatType') || 0) : 0;
    return rep > 0 ? 3 : 2;
  }
  M.finishedState = finishedState;
  // the client ends a task at the node marked IsEnd (TaskUtils.readBoolean(node, 'IsEnd')); fall back to the last node
  function isEndNode(taskID, nodeID) {
    const s = summary && summary[taskID]; if (!s || !s.nodes.length) return false;
    const n = s.nodes.find(x => String(x.getAttribute('ID')) === String(nodeID));
    if (!n) return false;
    const v = String(n.getAttribute('IsEnd') || '').toLowerCase();
    if (s.nodes.some(x => x.hasAttribute('IsEnd'))) return v === '1' || v === 'true';
    return s.nodes[s.nodes.length - 1] === n;
  }
  // older saves: tasks whose last submitted node was an end node but were left "playing"
  M.repairTasks = function (r) {
    Object.values(tasks(r)).forEach(t => {
      // re-accepted by mistake (client did not see it as finished): non-repeatable, finished before, no progress
      if (t.playing && !t.curNodeID && t.finishCount > 0 && finishedState(t.taskID) === 2) t.playing = false;
      if (!t.playing && (t.finishCount > 0 || t.firstFinishTime) && t.state !== 2 && t.state !== 3) t.state = finishedState(t.taskID);   // saves before v0.4.6 used 1
      if (t.playing && t.curNodeID && isEndNode(t.taskID, t.curNodeID)) { t.playing = false; t.state = finishedState(t.taskID); t.finishCount = Math.max(1, t.finishCount || 0); if (!t.firstFinishTime) t.firstFinishTime = now(); }
    });
  };

  function learnSkill(r, id) {
    r.skills = r.skills || [];
    if (!r.skills.some(k => k.id === id)) { r.skills.push({ id, lv: 1, exp: 0 }); LOG('learned role skill', id); }
  }
  // finished tasks before v0.4.7 did not teach their skill rewards (OutType 5): add them
  M.repairTaskSkills = function (r) {
    if (!summary) return;
    Object.values(tasks(r)).filter(t => !t.playing && t.finishCount > 0).forEach(t => {
      const s = summary[t.taskID]; if (!s) return;
      s.nodes.forEach(n => { for (const it of n.getElementsByTagName('Item')) if (it.getAttribute('OutType') === '5') {
        // only the profession's own skills: OutItem sets can be per profession, so check the skill's Prof bit
        const id = Number(it.getAttribute('ItemId'));
        const info = M.skillInfo && M.skillInfo(id); const sk = D.skillDoc && Array.from(D.skillDoc.getElementsByTagName('Skill')).find(e => e.getAttribute('ID') === String(id));
        const prof = sk ? Number(sk.getAttribute('Prof') || -1) : -1;
        if (prof === -1 || (prof & (1 << (r.professtion || 1)))) learnSkill(r, id);
      } });
    });
  };
  // OutType: 1 role attribute (ItemId 1 xiaomee, 2/3 exp), 2 item, 4 equipment; others recorded only
  function grantNodeOutput(r, taskID, nodeID, setID) {
    const t = summary && summary[taskID]; if (!t) return [];
    const node = t.nodes.find(n => n.getAttribute('ID') == String(nodeID)); if (!node) return [];
    const got = [];
    for (const out of node.getElementsByTagName('OutItem')) {
      const id = Number(out.getAttribute('ID'));
      if (!(id === setID || id === 255 || (id === 0 && !(tasks(r)[taskID] || {}).finishCount))) continue;
      for (const it of out.getElementsByTagName('Item')) {
        const type = Number(it.getAttribute('OutType')), item = Number(it.getAttribute('ItemId')), cnt = Number(it.getAttribute('Count') || 1);
        // OutType (client TaskOutPutType): 1 role property (itemInfo 5000x: 50001 星豆, 50002 经验, 50006 精力,
        // 50007 荣誉; 1/2/3 in older data), 2 item, 3 pet (ItemId = pet type), 4 equipment, 5 skill, 7 application
        if (type === 1 && (item === 50001 || item === 1)) r.xiaomee += cnt;
        else if (type === 1 && (item === 50002 || item === 2 || item === 3)) { r.experience += cnt; M.levelCheck && M.levelCheck(r); }
        else if (type === 1 && item === 50006) r.energy = (r.energy || 0) + cnt;
        else if (type === 1 && item === 50007) r.honor = (r.honor || 0) + cnt;
        else if (type === 2 || type === 4) M.addItem(r, item, cnt);
        else if (type === 3 && M.newPet) M.newPet(r, item, 1);
        else if (type === 5) learnSkill(r, item);
        else { (r.unlocks = r.unlocks || []).push({ type, item, cnt }); }
        got.push({ type, item, cnt });
      }
    }
    return got;
  }

  // ---- modifier (修改器「任务」): finish a task without playing it, e.g. when its map cannot be entered on the phone.
  // Gives the rewards of every node not submitted yet (output set 1, the set nearly all tasks use), marks the task
  // finished like a normal end node. The client reads tasks at login, so the page reloads afterwards.
  const taskName = (id) => { const t = summary && summary[id]; return t ? (t.el.getAttribute('Name') || '') : ''; };
  M.taskName = taskName;
  M.taskStateOf = function (r, id) {
    const t = tasks(r)[id];
    if (!t) return '未接';
    if (t.playing) return '进行中';
    return t.finishCount > 0 ? '已完成' : '未接';
  };
  M.taskPlaying = (r) => Object.values(tasks(r)).filter(t => t.playing).map(t => ({ id: t.taskID, name: taskName(t.taskID), node: t.curNodeID || 0 }));
  M.taskSearch = function (q) {
    if (!summary) return [];
    q = String(q || '').trim(); if (!q) return [];
    return Object.keys(summary).filter(id => summary[id].nodes.length && (id === q || taskName(id).includes(q)))
      .slice(0, 40).map(id => ({ id: Number(id), name: taskName(id), level: Number(summary[id].el.getAttribute('Level') || 0) }));
  };
  // tasks the role could accept now (what 旅行记事 lists without a 进行中 entry): not playing, not finished (or
  // repeatable), level reached, profession allowed (Job -1/-2 = any; 1..5 = that profession; others skipped, APPROX),
  // ParentCost of the ParentList tasks finished. Main line (Kind 1) first.
  const KIND = { 1: '主线', 2: '支线', 3: '其他', 4: '运营', 5: '其他' };
  M.taskAvailable = function (r) {
    if (!summary) return [];
    const ts = tasks(r); const done = (id) => { const t = ts[id]; return !!(t && !t.playing && t.finishCount > 0); };
    const out = [];
    Object.keys(summary).forEach(id => {
      const s = summary[id]; if (!s.nodes.length) return;
      const e = s.el, t = ts[id];
      if (t && t.playing) return;
      if (done(id) && finishedState(id) === 2) return;
      if (Number(e.getAttribute('Level') || 0) > r.level) return;
      const job = Number(e.getAttribute('Job') || -1);
      if (job > 0 && job !== (r.professtion || 0)) return;
      const parents = String(e.getAttribute('ParentList') || '').split(/[ ,;|]+/).filter(x => x && x !== '0');
      const need = Math.min(parents.length, Number(e.getAttribute('ParentCost') || parents.length) || parents.length);
      if (parents.filter(done).length < need) return;
      const kind = Number(e.getAttribute('Kind') || 0);
      out.push({ id: Number(id), name: taskName(id), level: Number(e.getAttribute('Level') || 0), kind: KIND[kind] || '其他', k: kind === 1 ? 0 : kind === 2 ? 1 : 2 });
    });
    return out.sort((a, b) => a.k - b.k || a.level - b.level || a.id - b.id);
  };
  M.forceFinishTask = function (r, taskID) {
    const s = summary && summary[taskID]; if (!s || !s.nodes.length) return '找不到任务 ' + taskID;
    const ts = tasks(r);
    const t = ts[taskID] || (ts[taskID] = { taskID, playing: true, curNodeID: 0, finishCount: 0, firstFinishTime: 0, optDate: now() });
    if (!t.playing && t.finishCount > 0 && finishedState(taskID) === 2) return '任务已经完成过了';
    const ids = s.nodes.map(n => n.getAttribute('ID'));
    let from = t.curNodeID ? ids.indexOf(String(t.curNodeID)) + 1 : 0;
    const endAt = s.nodes.findIndex(n => isEndNode(taskID, n.getAttribute('ID')));
    const last = endAt >= 0 ? endAt : ids.length - 1;
    const lv0 = r.level; const got = [];
    for (let i = from; i <= last; i++) got.push(...grantNodeOutput(r, taskID, ids[i], 1));
    t.curNodeID = Number(ids[last]); t.playing = false; t.state = finishedState(taskID);
    t.finishCount = (t.finishCount || 0) + 1; if (!t.firstFinishTime) t.firstFinishTime = now(); t.optDate = now();
    M.saveRole(); LOG('task force-finished', taskID, 'rewards', JSON.stringify(got));
    const names = { 1: '属性', 2: '物品', 3: '宠物', 4: '装备', 5: '技能' };
    return '已完成「' + taskName(taskID) + '」，奖励：' + (got.map(g => (names[g.type] || '其他') + ' ' + g.item + '×' + g.cnt).join('，') || '无') + (r.level > lv0 ? '（升级了）' : '');
  };

  // ---- battle conditions (res/task/xml2/<task>.xml <Step><Condition><Battle ID=beast group Count/>)
  // The client checks a step with task.buffer monsterID == ID and monsterCount >= Count; the server fills those
  // in through the task list of 1319 BATTLE_OVER_NOTICE after a won battle (BattleResultTaskInfo).
  const conds = {};
  function loadConds(taskID) {
    if (conds[taskID]) return conds[taskID];
    return (conds[taskID] = D.fetchXML('res/task/xml2/' + taskID + '.xml').then(doc => {
      const list = Array.from(doc.getElementsByTagName('Battle')).map(e => ({ id: Number(e.getAttribute('ID')), count: Number(e.getAttribute('Count') || 1) })).filter(x => x.id > 0);
      conds[taskID] = list; return list;
    }).catch(() => (conds[taskID] = [])));
  }
  M.preloadTaskConds = (r) => Object.values(tasks(r)).filter(t => t.playing).forEach(t => loadConds(t.taskID));
  // called by the battle engine on a win against beast group groupID -> BattleResultTaskInfo list
  M.taskBattleWin = function (r, groupID) {
    const out = [];
    if (!groupID) return out;
    Object.values(tasks(r)).filter(t => t.playing).forEach(t => {
      const list = Array.isArray(conds[t.taskID]) ? conds[t.taskID] : (loadConds(t.taskID), []);
      const c = list.find(x => x.id === groupID); if (!c) return;
      t.battles = t.battles || {};
      t.battles[groupID] = Math.min(c.count, (t.battles[groupID] || 0) + 1);
      out.push({ taskID: t.taskID, nodeID: t.curNodeID || 0, monster: groupID, count: t.battles[groupID], target: c.count });
      LOG('task', t.taskID, 'battle condition', groupID, t.battles[groupID] + '/' + c.count);
    });
    return out;
  };

  // 1162 TASK_SUBMIT_BUFFER_AND_ACCEPT_TASK: taskID, buffer[128], dataID -> taskID, dataID, nodeID
  on(1162, (c, rd) => {
    const taskID = rd.u32(), buf = rd.bytes(128), dataID = rd.u32();
    const r = M.ensureRole(c.role()); const ts = tasks(r);
    const old = ts[taskID] || {};
    ts[taskID] = { taskID, playing: true, curNodeID: 0, finishCount: old.finishCount || 0, firstFinishTime: old.firstFinishTime || 0, optDate: now(), buffer: M.bytesToHex(buf) };
    M.saveRole(); LOG('task accepted', taskID); loadConds(taskID);
    c.reply(new ByteWriter().u32(taskID).u32(dataID).u32(0));
  });
  // 1163 TASK_SUBMIT_BUFFER_AND_NODE: taskID, nodeID, outputSetID, buffer[128], dataID, u32
  //   -> taskID, dataID, nodeID, outputSetID, canAcceptAgain, isHalfOutput
  on(1163, (c, rd) => {
    const taskID = rd.u32(), nodeID = rd.u32(), setID = rd.u32(), buf = rd.bytes(128), dataID = rd.u32();
    const r = M.ensureRole(c.role()); const ts = tasks(r);
    const t = ts[taskID] || (ts[taskID] = { taskID, playing: true, finishCount: 0, firstFinishTime: 0 });
    const lv0 = r.level;
    const got = grantNodeOutput(r, taskID, nodeID, setID);
    t.curNodeID = nodeID; t.buffer = M.bytesToHex(buf); t.optDate = now();
    const s = summary && summary[taskID];
    const last = isEndNode(taskID, nodeID);
    if (last) { t.playing = false; t.state = finishedState(taskID); t.finishCount = (t.finishCount || 0) + 1; if (!t.firstFinishTime) t.firstFinishTime = now(); }
    M.saveRole(); LOG('task node', taskID, nodeID, 'set', setID, last ? '(task complete)' : '', 'rewards', JSON.stringify(got));
    c.reply(new ByteWriter().u32(taskID).u32(dataID).u32(nodeID).u32(setID).u32(last && t.state === 3 ? 1 : 0).u32(0));
    if (r.level > lv0 && M.pushLevelUp) M.pushLevelUp(c, r);
  });
  // 1165 TASK_SUBMIT_BUFFER: taskID, buffer[128], dataID -> taskID, dataID
  on(1165, (c, rd) => {
    const taskID = rd.u32(), buf = rd.bytes(128), dataID = rd.u32();
    const r = M.ensureRole(c.role()); const t = tasks(r)[taskID];
    if (t) { t.buffer = M.bytesToHex(buf); M.saveRole(); }
    c.reply(new ByteWriter().u32(taskID).u32(dataID));
  });
  // 1164 TASK_ABANDON: taskID -> taskID
  on(1164, (c, rd) => {
    const taskID = rd.u32(); const r = M.ensureRole(c.role()); const t = tasks(r)[taskID];
    if (t && t.playing) { if (t.finishCount) { t.playing = false; t.state = finishedState(taskID); } else delete tasks(r)[taskID]; M.saveRole(); }
    c.reply(new ByteWriter().u32(taskID));
  });
  // 1170 TASK_GET_TASK_NODE_COUNT -> count
  on(1170, (c) => c.reply(new ByteWriter().u32(0)));
  // 1017 FINISH_FRESH_MAN_TASK
  on(1017, (c) => { const r = c.role(); M.setFlag(r, M.FLAG.NEWER_COMPLETE, true); M.saveRole(); c.reply(new ByteWriter()); });

  // ---- misc map systems
  on(1904, (c) => c.reply(new ByteWriter().u32(0)));            // TREASURE_GET_SERVER_TREASURES: none
  on(1909, (c) => c.reply(new ByteWriter().u32(0)));            // MAZE_GET_STATE: inactive
  // 1030 PERSON_STATUS_CHANGE(type, status) -> userID, type, status
  on(1030, (c, rd) => { const type = rd.u32(), status = rd.u32(); c.reply(new ByteWriter().u32(c.uid).u32(type).u32(status)); });
})(window);
