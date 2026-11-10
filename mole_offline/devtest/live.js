// Long-running browser for step-by-step manual testing.
// usage: node live.js URL DIR   then write DIR/cmd.json = [{click:[x,y]}|{type:"..."}|{key:"Enter"}|{wait:ms}|{shot:"name"}|{eval:"js"}]
// the runner executes it, renames it to cmd.done and appends console lines to DIR/console.log
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const [url, dir] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'] });
  const pg = await b.newPage({ viewport: { width: 990, height: 560 } });
  if (process.env.SEED_FILE) { const seed = fs.readFileSync(process.env.SEED_FILE, 'utf8'); await pg.addInitScript(s => { try { if (!localStorage.getItem('mole_offline_save')) localStorage.setItem('mole_offline_save', s); } catch (e) {} }, seed); }
  const log = fs.createWriteStream(path.join(dir, 'console.log'), { flags: 'a' });
  pg.on('console', m => { const t = m.text(); if (/\[mole\]|rror #|log_adapter.rs:18%c [^ -]/.test(t) && !/RECV|SEND|onLoaded|loadComplete|已加载|XML导入/.test(t)) log.write(t.replace(/%c/g, '').replace(/ color:.*/, '').slice(0, 400) + '\n'); });
  pg.on('pageerror', e => log.write('pageerror ' + e + '\n'));
  await pg.goto(url);
  const cmdf = path.join(dir, 'cmd.json');
  for (;;) {
    if (fs.existsSync(cmdf)) {
      let acts = []; try { acts = JSON.parse(fs.readFileSync(cmdf, 'utf8')); } catch (e) { log.write('bad cmd ' + e + '\n'); }
      fs.renameSync(cmdf, path.join(dir, 'cmd.running'));
      for (const a of acts) {
        try {
          if (a.click) await pg.mouse.click(a.click[0], a.click[1]);
          if (a.dblclick) await pg.mouse.dblclick(a.dblclick[0], a.dblclick[1]);
          if (a.type) await pg.keyboard.type(a.type, { delay: 40 });
          if (a.key) await pg.keyboard.press(a.key);
          if (a.clear) { for (let i = 0; i < a.clear; i++) await pg.keyboard.press('Backspace'); }
          if (a.wait) await pg.waitForTimeout(a.wait);
          if (a.eval) log.write('eval ' + JSON.stringify(await pg.evaluate(a.eval)) + '\n');
          if (a.shot) await pg.screenshot({ path: path.join(dir, a.shot + '.png') });
          if (a.quit) { await b.close(); process.exit(0); }
        } catch (e) { log.write('act error ' + e + '\n'); }
      }
      fs.renameSync(path.join(dir, 'cmd.running'), path.join(dir, 'cmd.done'));
    }
    await pg.waitForTimeout(250);
  }
})();
