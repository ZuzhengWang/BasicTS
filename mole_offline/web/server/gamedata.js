// Game data tables for the local server, read from the client's own res/config/*.xml
// (decrypted exactly like utils::DllLoader.doDec: XOR with trailing 16-byte key, drop last 20 bytes).
(function (G) {
  'use strict';
  const M = G.Mole;
  const D = M.Data = M.Data || {};

  function decrypt(u8) {
    let i = 0; while (i < u8.length && (u8[i] === 0x20 || u8[i] === 0x0d || u8[i] === 0x0a || u8[i] === 0x09)) i++;
    if (u8[i] === 0x3c || (u8[0] === 0xef && u8[1] === 0xbb)) return u8;   // plain text already
    const key = u8.slice(u8.length - 16);
    const out = new Uint8Array(u8.length);
    for (let j = 0; j < u8.length; j++) out[j] = u8[j] ^ key[j % 16];
    return out.subarray(0, u8.length - 20);
  }
  async function loadXML(name) {
    const r = await fetch('res/config/' + name);
    if (!r.ok) throw new Error('config ' + name + ' ' + r.status);
    const txt = new TextDecoder('utf-8').decode(decrypt(new Uint8Array(await r.arrayBuffer()))).replace(/^﻿/, '');
    const doc = new DOMParser().parseFromString(txt, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) console.warn('[mole] xml parse issue in', name);
    return doc;
  }
  const attrs = (el) => { const o = {}; for (const a of el.attributes) o[a.name] = a.value; return o; };
  const num = (v, d) => (v === undefined || v === '' ? (d || 0) : Number(v));
  D.attrs = attrs; D.num = num;

  D.ready = (async () => {
    const t0 = Date.now();
    const [prof, equip, map, beast, pet, monsters, skill, items] = await Promise.all(
      ['professtion.xml', 'item_equip.xml', 'Map.xml', 'Beastgrp.xml', 'Pet.xml', 'monsters.xml', 'Skill.xml', 'itemInfo.xml'].map(n => loadXML(n).catch(e => { console.error('[mole]', e); return null; })));
    // professions
    D.profs = {};
    if (prof) for (const p of prof.getElementsByTagName('Prof')) { const a = attrs(p); D.profs[a.ID] = a; }
    // equipment: id -> {attrs, levels:[...]}
    D.equips = {};
    if (equip) for (const it of equip.querySelectorAll('Items > Item, Item')) {
      const a = attrs(it); if (!a.ID || D.equips[a.ID]) continue;
      a.levels = Array.from(it.getElementsByTagName('Level')).map(attrs);
      a.extents = Array.from(it.getElementsByTagName('Extent')).map(attrs);
      D.equips[a.ID] = a;
    }
    // maps
    D.maps = {};
    if (map) for (const m of map.getElementsByTagName('Map')) {
      const a = attrs(m); a.el = m; D.maps[a.ID] = a;
    }
    // normal items (itemInfo.xml): id -> attrs (+ kind attrs: Team/Max)
    D.items = {};
    if (items) for (const k of items.getElementsByTagName('Kind')) {
      const ka = attrs(k);
      for (const it of k.getElementsByTagName('Item')) { const a = attrs(it); a.kind = ka; D.items[a.ID] = a; }
    }
    D.beastDoc = beast; D.petDoc = pet; D.monsterDoc = monsters; D.skillDoc = skill;
    // pets / monsters (Pet.xml "Type" entries are monster/pet species)
    D.petTypes = {};
    if (pet) for (const t of pet.getElementsByTagName('Type')) { const a = attrs(t); if (a.ID) { a.el = t; D.petTypes[a.ID] = a; } }
    D.beastGrps = {};
    if (beast) for (const g of beast.getElementsByTagName('Grp')) { const a = attrs(g); a.types = Array.from(g.getElementsByTagName('Type')).map(attrs); D.beastGrps[a.ID] = a; }
    M.LOG('game data loaded in', Date.now() - t0, 'ms:', Object.keys(D.equips).length, 'equips,', Object.keys(D.items).length, 'items,', Object.keys(D.maps).length, 'maps,', Object.keys(D.petTypes).length, 'pet types,', Object.keys(D.beastGrps).length, 'beast groups');
    return D;
  })();
})(window);
