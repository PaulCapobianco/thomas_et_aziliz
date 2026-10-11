#!/usr/bin/env python3
"""Local preview with the same response headers as the static hosting artifact."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from fnmatch import fnmatch
from pathlib import Path
from urllib.parse import urlsplit
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=4173)
args = parser.parse_args()
rules = []
for line in Path('_headers').read_text().splitlines():
    if line.startswith('/'):
        rules.append((line, {}))
    elif line.strip() and rules:
        key, value = line.strip().split(':', 1)
        rules[-1][1][key] = value.strip()

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        headers = {}
        for pattern, values in rules:
            if fnmatch(urlsplit(self.path).path, pattern):
                headers.update(values)
        for key, value in headers.items():
            self.send_header(key, value)
        super().end_headers()

    def log_message(self, *_args):
        pass

print(f'Local: http://127.0.0.1:{args.port}', flush=True)
ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
