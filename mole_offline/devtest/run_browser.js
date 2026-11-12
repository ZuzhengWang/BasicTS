// usage: node run_browser.js URL seconds out.png [actions.json]
const { chromium } = require('playwright');
(async () => {
  const [url, secs, out, actions] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', ...(process.env.EXTRA_ARGS ? process.env.EXTRA_ARGS.split(' ') : [])] });
  const SC = parseFloat(process.env.SCALE || '1');
  const pg = await b.newPage({ viewport: { width: Math.round(990 * SC), height: Math.round(560 * SC) }, hasTouch: !!process.env.TOUCH, deviceScaleFactor: parseFloat(process.env.DPR || '1') });
  if (process.env.MEMLOG) { const { execSync } = require('child_process'); const t0 = Date.now();
    setInterval(() => { try { const out = execSync("ps -eo rss,args | grep -a [h]eadless_shell | awk '{t=\"browser\"; for(i=2;i<=NF;i++) if ($i ~ /^--type=/) t=substr($i,8); s[t]+=$1} END {for (k in s) printf \"%s=%dMB \", k, s[k]/1024}'").toString().trim();
      console.log('[mem] ' + ((Date.now() - t0) / 1000).toFixed(0) + 's ' + out); } catch (e) { } }, +(process.env.MEMLOG) * 1000 || 5000).unref(); }
  if (process.env.THROTTLE) { const cdp = await pg.context().newCDPSession(pg); await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) }); }
  const seen = [];
  const T0 = Date.now(); pg.on('console', m => { const t = m.text(); seen.push(t); console.log((process.env.TSLOG ? ((Date.now() - T0) / 1000).toFixed(1) + 's ' : '') + '[console]', t.slice(0, 600)); });
  const waitFor = async (txt, ms) => { const t0 = Date.now(); let from = 0;
    while (Date.now() - t0 < ms) { if (seen.some(x => x.includes(txt))) return true; await pg.waitForTimeout(250); }
    console.log('[runner] TIMEOUT waiting for', txt); return false; };
  if (process.env.PROFILE_ON) {   // CPU profile for PROFILE_SECS after a console line containing PROFILE_ON
    const cdp = await pg.context().newCDPSession(pg); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 2000 });
    let started = false;
    pg.on('console', async m => { if (started || !m.text().includes(process.env.PROFILE_ON)) return; started = true;
      await cdp.send('Profiler.start'); console.log('[runner] profile start');
      setTimeout(async () => { const { profile } = await cdp.send('Profiler.stop');
        const self = {}; const byId = {}; profile.nodes.forEach(n => byId[n.id] = n);
        const dt = profile.timeDeltas; profile.samples.forEach((id, i) => { const n = byId[id]; const k = n.callFrame.functionName || '(anon ' + n.callFrame.url.split('/').pop() + ')'; self[k] = (self[k] || 0) + (dt[i] || 0); });
        Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, v]) => console.log('[prof] ' + (v / 1000).toFixed(0) + 'ms ' + k.slice(0, 160)));
        require('fs').writeFileSync(process.env.PROFILE_OUT || '/tmp/prof.json', JSON.stringify(profile)); }, (+process.env.PROFILE_SECS || 15) * 1000); });
  }
  pg.on('pageerror', e => console.log('[pageerror]', e.message));
  if (process.env.SEED_FILE) {
    const seed = require('fs').readFileSync(process.env.SEED_FILE, 'utf8');
    await pg.addInitScript((txt) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('mole_offline_save', txt); sessionStorage.setItem('seeded', '1'); } } catch (e) {} }, seed);
  }
  if (process.env.GLLOG) {   // log large WebGL allocations / readbacks and running texture totals
    await pg.addInitScript(() => {
      const P = WebGL2RenderingContext.prototype; const st = { tex: 0, texDel: 0, rb: 0, px: 0, read: 0, readPx: 0, fb: 0 };
      window.__glst = st; const big = (w, h) => w * h >= 1000000;
      const wrap = (n, f) => { const o = P[n]; P[n] = function () { try { f.apply(this, arguments); } catch (e) { } return o.apply(this, arguments); }; };
      wrap('createTexture', () => st.tex++); wrap('deleteTexture', () => st.texDel++); wrap('createFramebuffer', () => st.fb++);
      wrap('texImage2D', function (t, l, f, w, h) { if (typeof h === 'number') { st.px += w * h; if (big(w, h)) console.log('[gl] texImage2D ' + w + 'x' + h); } });
      wrap('texStorage2D', function (t, lv, f, w, h) { st.px += w * h; if (big(w, h)) console.log('[gl] texStorage2D ' + w + 'x' + h + ' lv' + lv); });
      wrap('renderbufferStorage', function (t, f, w, h) { st.px += w * h; st.rb++; if (big(w, h)) console.log('[gl] renderbufferStorage ' + w + 'x' + h); });
      wrap('renderbufferStorageMultisample', function (t, s, f, w, h) { st.px += w * h * s; st.rb++; if (big(w, h)) console.log('[gl] rbMS x' + s + ' ' + w + 'x' + h); });
      wrap('readPixels', function (x, y, w, h) { st.read++; st.readPx += w * h; if (big(w, h)) console.log('[gl] readPixels ' + w + 'x' + h); });
      setInterval(() => console.log('[gl] totals ' + JSON.stringify(st)), 2000);
    });
  }
  if (process.env.SLOW_RE) {   // delay matching requests (phone asset loading is slower / differently ordered)
    const re = new RegExp(process.env.SLOW_RE), ms = +(process.env.SLOW_MS || 3000);
    await pg.route(u => re.test(u.toString()), async r => { await new Promise(z => setTimeout(z, ms * (0.5 + Math.random()))); r.continue(); });
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
    if (a.tap) await pg.touchscreen.tap(a.tap[0] * SC, a.tap[1] * SC);
    if (a.move) await pg.mouse.move(a.move[0] * SC, a.move[1] * SC, { steps: 5 });
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
