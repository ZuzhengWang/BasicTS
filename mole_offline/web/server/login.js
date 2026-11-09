// Login / directory server emulation (Login.swf protocol, CommandID in clientCore::CommandID)
(function (G) {
  'use strict';
  const { LOG, ByteWriter, ByteReader, registerServer, route, Store } = G.Mole;

  const CMD = { VERIFY: 1, REGISTER: 2, GET_AUTH_PIC: 101, MAIN_LOGIN_IN: 103, COMMEND_ONLINE: 105, RANGE_ONLINE: 106, CREATE_ROLE: 107, ACTIVATION: 108 };
  const ERR = { SYSTEM: 5001, PASSWORD: 5003, NOT_EXIST: 5005 };

  // Online server(s) offered in the server list. host/port must match the Ruffle socketProxy table.
  const ONLINE = G.MOLE_ONLINE_SERVERS || [{ id: 1, ip: '10.0.0.1', port: 1863 }];

  function hex(u8) { return Array.from(u8, b => b.toString(16).padStart(2, '0')).join(''); }
  function randomSession() { const s = new Uint8Array(16); crypto.getRandomValues(s); return s; }

  // ---- accounts
  function createAccount(pwdMd5x2) {
    const db = Store.load();
    const uid = db.nextUid++;
    db.accounts[uid] = { uid, pwd: pwdMd5x2, created: Date.now(), hasRole: false };
    Store.save();
    LOG('account created', uid);
    return uid;
  }
  G.Mole.createAccount = createAccount;

  const sessions = {};   // hex(session) -> uid
  G.Mole.sessions = sessions;

  registerServer('login', {
    onPacket(conn, p) {
      const r = new ByteReader(p.body);
      const db = Store.load();
      switch (p.cmd) {
        case CMD.MAIN_LOGIN_IN: {
          const pwd = r.str(32).toLowerCase();
          let acc = db.accounts[p.userId];
          // Offline: the revival build registered on a website. Here the first login with a new
          // numeric account creates it locally with the given password.
          if (!acc && p.userId > 0) {
            db.accounts[p.userId] = acc = { uid: p.userId, pwd, created: Date.now(), hasRole: false };
            if (db.nextUid <= p.userId) db.nextUid = p.userId + 1;
            Store.save();
            LOG('account auto-created', p.userId);
          }
          if (!acc) return conn.send(p.cmd, p.userId, null, ERR.NOT_EXIST);
          if (acc.pwd !== pwd) return conn.send(p.cmd, p.userId, null, ERR.PASSWORD);
          const s = randomSession();
          sessions[hex(s)] = p.userId;
          conn.state.uid = p.userId;
          const w = new ByteWriter().u32(0).bytes(s).u32(acc.hasRole ? 1 : 0);
          return conn.send(p.cmd, p.userId, w);
        }
        case CMD.COMMEND_ONLINE: {
          const s = r.bytes(16);
          const uid = sessions[hex(s)] || p.userId;
          const acc = db.accounts[uid];
          if (!acc) return conn.send(p.cmd, p.userId, null, ERR.SYSTEM);
          if (!acc.hasRole) return conn.send(p.cmd, p.userId, null, ERR.NOT_EXIST);   // -> client sends CREATE_ROLE
          return conn.send(p.cmd, p.userId, serverList(true));
        }
        case CMD.RANGE_ONLINE: {
          const w = new ByteWriter().u32(ONLINE.length);
          ONLINE.forEach(s => serverInfo(w, s));
          return conn.send(p.cmd, p.userId, w);
        }
        case CMD.CREATE_ROLE: {
          const s = r.bytes(16);
          const uid = sessions[hex(s)] || p.userId;
          const acc = db.accounts[uid];
          if (!acc) return conn.send(p.cmd, p.userId, null, ERR.SYSTEM);
          acc.hasRole = true; Store.save();
          return conn.send(p.cmd, p.userId, new ByteWriter());
        }
        case CMD.GET_AUTH_PIC:
          return conn.send(p.cmd, p.userId, new ByteWriter().u32(0));
        default:
          LOG('login: unhandled cmd', p.cmd);
          return conn.send(p.cmd, p.userId, null, ERR.SYSTEM);
      }
    },
  });

  function serverInfo(w, s) {
    w.u32(s.id).u32(1).str(s.ip, 16).u16(s.port).u32(0);
  }
  function serverList() {
    const w = new ByteWriter().u32(ONLINE.length).u32(0).u32(ONLINE.length);
    ONLINE.forEach(s => serverInfo(w, s));
    w.u32(0);  // friend data: count 0
    return w;
  }

  // ---- HTTP: registration (account-httpd.61.com) and captcha image
  const PNG1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAYCAIAAADF1mwTAAAARElEQVR4nO3PUQkAIBTAwNc/hcEMYQRD+HEIgwW4zdnr64YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEteOwCBpiI08i+BLQAAAAASUVORK5CYII='), c => c.charCodeAt(0));
  route(/account-httpd\.61\.com\/index\.php/, (url, init) => {
    if (/cmd=1101/.test(url)) return new Response(PNG1x1, { headers: { 'Content-Type': 'image/png' } });
    const params = new URLSearchParams(typeof init.body === 'string' ? init.body : '');
    const cmd = params.get('cmd');
    if (cmd === '1102') {
      let pwd = params.get('pwd') || '';
      // client sends plain password here; store md5(md5(pwd)) to match MAIN_LOGIN_IN
      const uid = createAccount(G.Mole.md5(G.Mole.md5(pwd)));
      return new Response(JSON.stringify({ result: 0, userid: uid }), { headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response(JSON.stringify({ result: 1001 }));
  });
  // "recommended line" lookup and misc telemetry
  route(/202\.189\.23\.31\/ip\.txt/, () => new Response('10.0.0.1:1800'));
  route(/misc\.taomee\.com|\/monitor\//, () => new Response(''));
})(window);
