import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const publicFiles = new Set(['dist/index.html', 'dist/play.html', 'styles.css', 'catalog.js', 'core.js', 'game.js', 'policy.js', 'symbols.js', 'board.js', 'app.js']);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const filename = pathname === '/' || pathname === '/index.html' ? 'dist/index.html' : pathname.slice(1);
    if (!publicFiles.has(filename)) throw new Error('Unknown asset');
    const content = await readFile(resolve(root, filename));
    res.writeHead(200, { 'Content-Type': types[extname(filename)] + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
let port = Number(process.env.PORT || 4173);
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && port < 4190) server.listen(++port, '127.0.0.1');
  else throw error;
});
server.on('listening', () => console.log('Local: http://127.0.0.1:' + server.address().port));
server.listen(port, '127.0.0.1');
