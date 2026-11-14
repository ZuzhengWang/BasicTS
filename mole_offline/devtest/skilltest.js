// Skill animation test: logs in, sets the server's test hooks, starts a battle and takes screenshots at a fixed
// interval while the round is played back.
// usage: node skilltest.js CONFIG.json
// CONFIG: { seed: "seed.json", patch: {role fields...}, petPatch: [{...}, ...], hooks: "js expression run in the page",
//           fight: "/fight 3 5 2", shots: 120, interval: 400, out: "/path/prefix", crop: [x,y,w,h], cols: 10, thumb: [w,h],
//           url: "http://127.0.0.1:8090/index.html?trace=1&r=wgpu-webgl&q=low", viewport: [990,560], dpr: 1, initLS: {k:v} }
const { chromium } = require('playwright');
const fs = require('fs');
const { execFileSync } = require('child_process');
(async () => {
  const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const vp = cfg.viewport || [990, 560];
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'] });
  const pg = await b.newPage({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: cfg.dpr || 1 });
  const T0 = Date.now(); const seen = []; const log = [];
  const stamp = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
  pg.on('console', m => { const t = m.text(); seen.push(t);
    if (/\[mole\] (skill|round |battle over|status|round cmd)|pageerror|Error #|TypeError|ReferenceError|MMT_/.test(t) && !/getClass/.test(t)) log.push(stamp() + ' ' + t.replace(/%c|color: [^;]+;?|background: [^;]+;?|font-style: [^;]+;?/g, '').slice(0, 220)); });
  pg.on('pageerror', e => log.push(stamp() + ' pageerror ' + e.message));
  const seed = JSON.parse(fs.readFileSync(cfg.seed, 'utf8'));
  for (const r of Object.values(seed.roles)) {
    Object.assign(r, cfg.patch || {});
    (cfg.petPatch || []).forEach((pp, i) => { if (r.pets && r.pets[i]) Object.assign(r.pets[i], pp); });
  }
  if (cfg.skillMods) seed.skillMods = cfg.skillMods;
  await pg.addInitScript(({ txt, ls }) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('mole_offline_save', txt); sessionStorage.setItem('seeded', '1'); }
    Object.keys(ls || {}).forEach(k => localStorage.setItem(k, ls[k])); } catch (e) { } }, { txt: JSON.stringify(seed), ls: cfg.initLS });
  const wait = async (txt, ms = 300000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (seen.some(x => x.includes(txt))) return true; await pg.waitForTimeout(250); } throw new Error('timeout waiting for ' + txt); };
  const SC = vp[0] / 990; const click = (x, y) => pg.mouse.click(x * SC, y * SC);
  await pg.goto(cfg.url || 'http://127.0.0.1:8090/index.html?trace=1&r=wgpu-webgl&q=low');
  await wait('加载登录面板成功'); await pg.waitForTimeout(8000);
  await click(20, 300); await pg.waitForTimeout(1500); await click(495, 465); await pg.waitForTimeout(4000);
  await click(530, 122); await pg.keyboard.type('100001', { delay: 40 }); await click(530, 158); await pg.keyboard.type('123456', { delay: 40 });
  await click(562, 282); await wait('S->C login cmd 105'); await pg.waitForTimeout(4000); await click(320, 138);
  await wait('C->S online cmd 1350'); await pg.waitForTimeout(cfg.mapWait || 12000);
  if (cfg.hooks) console.log('hooks ->', JSON.stringify(await pg.evaluate(cfg.hooks)));
  seen.length = 0;
  console.log('fight ->', await pg.evaluate((line) => window.Mole.runConsole(line), cfg.fight || '/fight 3 5 2'));
  await wait('S->C online cmd 1307'); console.log(stamp(), 'battle ready');
  await pg.waitForTimeout(cfg.preWait || 0);
  if (cfg.waitRounds) {   // no screenshots: wait until that many rounds are resolved and played (or the battle ends)
    const t0 = Date.now(); const lim = (cfg.timeout || 900) * 1000;
    while (Date.now() - t0 < lim && !seen.some(x => x.includes('[mole] round ' + cfg.waitRounds + ' hp')) && !seen.some(x => x.includes('battle over'))) await pg.waitForTimeout(500);
    await pg.waitForTimeout(cfg.tailWait || 15000);
    fs.writeFileSync(cfg.out + '_log.txt', log.join('\n')); await b.close();
    console.log('rounds done; log lines', log.length); return;
  }
  const n = cfg.shots || 60, iv = cfg.interval || 400; const files = [];
  for (let i = 0; i < n; i++) {
    const f = cfg.out + '_' + String(i).padStart(3, '0') + '.png'; const t = Date.now();
    await pg.screenshot({ path: f }); files.push(f); log.push(stamp() + ' shot ' + i);
    if (cfg.stopOn && seen.some(x => x.includes(cfg.stopOn))) { await pg.waitForTimeout(1500); break; }
    await pg.waitForTimeout(Math.max(0, iv - (Date.now() - t)));
  }
  fs.writeFileSync(cfg.out + '_log.txt', log.join('\n'));
  await b.close();
  // contact sheets: cols per row, rowsPerSheet rows per image
  const crop = cfg.crop || [0, 0, 800, 560], th = cfg.thumb || [240, 168], cols = cfg.cols || 10, rps = cfg.rowsPerSheet || 5;
  execFileSync('python3', ['-c', `
import sys, json
from PIL import Image, ImageDraw
files=json.loads(sys.argv[1]); crop=json.loads(sys.argv[2]); th=json.loads(sys.argv[3]); cols=int(sys.argv[4]); rps=int(sys.argv[5]); out=sys.argv[6]; sc=float(sys.argv[7])
per=cols*rps
for s in range(0, len(files), per):
    part=files[s:s+per]; rows=(len(part)+cols-1)//cols
    c=Image.new('RGB',(cols*th[0], rows*th[1]))
    for k,f in enumerate(part):
        im=Image.open(f); im=im.crop((int(crop[0]*sc),int(crop[1]*sc),int((crop[0]+crop[2])*sc),int((crop[1]+crop[3])*sc))).resize(tuple(th))
        ImageDraw.Draw(im).text((3,2), str(s+k), fill=(255,255,0))
        c.paste(im,((k%cols)*th[0],(k//cols)*th[1]))
    c.save('%s_sheet%d.png'%(out, s//per))
print('sheets', (len(files)+per-1)//per)
`, JSON.stringify(files), JSON.stringify(crop), JSON.stringify(th), String(cols), String(rps), cfg.out, String(SC * (cfg.dpr || 1))], { stdio: 'inherit' });
  console.log(log.filter(l => !/ shot /.test(l)).slice(0, 60).join('\n'));
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
