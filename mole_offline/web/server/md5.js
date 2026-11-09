// Small MD5 (RFC 1321) over UTF-8 strings, returns lowercase hex. Matches com.adobe.crypto.MD5.hash.
(function (G) {
  'use strict';
  const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  function md5(str) {
    const msg = new TextEncoder().encode(String(str));
    const n = ((msg.length + 8) >>> 6) + 1, words = new Uint32Array(n * 16);
    for (let i = 0; i < msg.length; i++) words[i >> 2] |= msg[i] << ((i % 4) * 8);
    words[msg.length >> 2] |= 0x80 << ((msg.length % 4) * 8);
    words[n * 16 - 2] = (msg.length * 8) >>> 0;
    words[n * 16 - 1] = Math.floor(msg.length / 536870912) >>> 0;
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let j = 0; j < words.length; j += 16) {
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * i) % 16; }
        const s = S[(i >> 4) * 4 + (i % 4)];
        const t = d; d = c; c = b;
        const x = (a + f + K[i] + words[j + g]) >>> 0;
        b = (b + ((x << s) | (x >>> (32 - s)))) >>> 0; a = t;
      }
      a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
    }
    return [a0, b0, c0, d0].map(v => [0, 8, 16, 24].map(s => ((v >>> s) & 255).toString(16).padStart(2, '0')).join('')).join('');
  }
  G.Mole = G.Mole || {};
  G.Mole.md5 = md5;
})(window);
