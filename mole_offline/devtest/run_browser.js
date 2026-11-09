// usage: node run_browser.js URL seconds out.png [actions.json]
const { chromium } = require('playwright');
(async () => {
  const [url, secs, out, actions] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'] });
  const SC = parseFloat(process.env.SCALE || '1');
  const pg = await b.newPage({ viewport: { width: Math.round(990 * SC), height: Math.round(560 * SC) } });
  const seen = [];
  pg.on('console', m => { const t = m.text(); seen.push(t); console.log('[console]', t.slice(0, 600)); });
  const waitFor = async (txt, ms) => { const t0 = Date.now(); let from = 0;
    while (Date.now() - t0 < ms) { if (seen.some(x => x.includes(txt))) return true; await pg.waitForTimeout(250); }
    console.log('[runner] TIMEOUT waiting for', txt); return false; };
  pg.on('pageerror', e => console.log('[pageerror]', e.message));
  if (process.env.SEED_FILE) {
    const seed = require('fs').readFileSync(process.env.SEED_FILE, 'utf8');
    await pg.addInitScript((txt) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('mole_offline_save', txt); sessionStorage.setItem('seeded', '1'); } } catch (e) {} }, seed);
  }
  if (process.env.FAKE_NATIVE) {
    await pg.addInitScript(() => {
      let store = null;
      window.MoleNative = { log: (s) => console.debug('[native] ' + s), save: (t) => { store = t; return true; }, load: () => store };
    });
    pg.on('console', m => { if (m.type() === 'debug') console.log('[nativelog]', m.text().slice(0, 300)); });
  }
  if (process.env.DUMP_SAVE) pg.on('close', () => {});
  await pg.goto(url);
  const acts = actions ? JSON.parse(require('fs').readFileSync(actions, 'utf8')) : [];
  let t = 0;
  for (const a of acts) {
    if (a.waitFor) { const ok = await waitFor(a.waitFor, a.timeout || 120000); if (!ok && a.required) break; }
    await pg.waitForTimeout(a.wait || 1000);
    if (a.log) console.log('[runner]', a.log);
    if (a.reload) { seen.length = 0; await pg.reload(); }
    if (a.evalLog) console.log('[runner] eval', JSON.stringify(await pg.evaluate(a.evalLog)));
    if (a.click) await pg.mouse.click(a.click[0] * SC, a.click[1] * SC);
    if (a.dblclick) await pg.mouse.dblclick(a.dblclick[0] * SC, a.dblclick[1] * SC);
    if (a.clear) { await pg.keyboard.press('End'); for (let i = 0; i < a.clear; i++) await pg.keyboard.press('Backspace'); }
    if (a.type) await pg.keyboard.type(a.type, { delay: 50 });
    if (a.key) await pg.keyboard.press(a.key);
    if (a.shot) await pg.screenshot({ path: a.shot });
  }
  await pg.waitForTimeout(parseInt(secs) * 1000);
  await pg.screenshot({ path: out });
  if (process.env.DUMP_SAVE) { const sv = await pg.evaluate(() => localStorage.getItem('mole_offline_save')); require('fs').writeFileSync(process.env.DUMP_SAVE, sv || ''); }
  await b.close();
})();
