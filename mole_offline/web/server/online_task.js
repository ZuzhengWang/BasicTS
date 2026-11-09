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
      if (t.playing && t.curNodeID && isEndNode(t.taskID, t.curNodeID)) { t.playing = false; t.state = 1; t.finishCount = Math.max(1, t.finishCount || 0); if (!t.firstFinishTime) t.firstFinishTime = now(); }
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
        if (type === 1 && item === 1) r.xiaomee += cnt;
        else if (type === 1 && (item === 2 || item === 3)) { r.experience += cnt; M.levelCheck && M.levelCheck(r); }
        else if (type === 2 || type === 4) M.addItem(r, item, cnt);
        else { (r.unlocks = r.unlocks || []).push({ type, item, cnt }); }
        got.push({ type, item, cnt });
      }
    }
    return got;
  }

  // 1162 TASK_SUBMIT_BUFFER_AND_ACCEPT_TASK: taskID, buffer[128], dataID -> taskID, dataID, nodeID
  on(1162, (c, rd) => {
    const taskID = rd.u32(), buf = rd.bytes(128), dataID = rd.u32();
    const r = M.ensureRole(c.role()); const ts = tasks(r);
    const old = ts[taskID] || {};
    ts[taskID] = { taskID, playing: true, curNodeID: 0, finishCount: old.finishCount || 0, firstFinishTime: old.firstFinishTime || 0, optDate: now(), buffer: M.bytesToHex(buf) };
    M.saveRole(); LOG('task accepted', taskID);
    c.reply(new ByteWriter().u32(taskID).u32(dataID).u32(0));
  });
  // 1163 TASK_SUBMIT_BUFFER_AND_NODE: taskID, nodeID, outputSetID, buffer[128], dataID, u32
  //   -> taskID, dataID, nodeID, outputSetID, canAcceptAgain, isHalfOutput
  on(1163, (c, rd) => {
    const taskID = rd.u32(), nodeID = rd.u32(), setID = rd.u32(), buf = rd.bytes(128), dataID = rd.u32();
    const r = M.ensureRole(c.role()); const ts = tasks(r);
    const t = ts[taskID] || (ts[taskID] = { taskID, playing: true, finishCount: 0, firstFinishTime: 0 });
    const got = grantNodeOutput(r, taskID, nodeID, setID);
    t.curNodeID = nodeID; t.buffer = M.bytesToHex(buf); t.optDate = now();
    const s = summary && summary[taskID];
    const last = isEndNode(taskID, nodeID);
    if (last) { t.playing = false; t.state = 1; t.finishCount = (t.finishCount || 0) + 1; if (!t.firstFinishTime) t.firstFinishTime = now(); }
    M.saveRole(); LOG('task node', taskID, nodeID, 'set', setID, last ? '(task complete)' : '', 'rewards', JSON.stringify(got));
    c.reply(new ByteWriter().u32(taskID).u32(dataID).u32(nodeID).u32(setID).u32(0).u32(0));
    if (got.length) M.pushRoleRefresh && M.pushRoleRefresh(c);
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
    if (t && t.playing) { if (t.finishCount) { t.playing = false; } else delete tasks(r)[taskID]; M.saveRole(); }
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
