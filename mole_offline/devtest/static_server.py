#!/usr/bin/env python3
"""Dev static server: serves overlay dir first, then the game client dir,
plus /ruffle/ from the Ruffle npm package. Logs every request (and 404s)."""
import http.server, os, sys, urllib.parse

CLIENT, OVERLAY, RUFFLE, PORT = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
LOG = open(os.path.join(OVERLAY, '..', 'http_requests.log'), 'a')

class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = urllib.parse.unquote(urllib.parse.urlparse(path).path).lstrip('/')
        if p.startswith('ruffle/'):
            return os.path.join(RUFFLE, p[7:])
        for base in (OVERLAY, CLIENT):
            f = os.path.join(base, p)
            if os.path.exists(f):
                return f
        return os.path.join(CLIENT, p)
    def log_message(self, fmt, *a):
        LOG.write((fmt % a) + '\n'); LOG.flush()
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
