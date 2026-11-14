// Servidor local sin Netlify: sirve /public y la API con almacenamiento en memoria.
// Uso: npm run dev  ->  http://localhost:8888  (abre la misma URL desde teléfonos en tu red con tu IP local)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, memoryStore } from '../lib/api.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const store = memoryStore();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT) || 8888;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = await handle(request, store);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    return res.end(Buffer.from(await response.arrayBuffer()));
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  try {
    const data = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    const data = await readFile(join(root, 'index.html'));
    res.writeHead(200, { 'content-type': types['.html'] });
    res.end(data);
  }
}).listen(port, () => console.log(`Policías y ladrones en http://localhost:${port}`));
