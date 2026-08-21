/* Dev server. localhost is a secure context, so the service worker registers
 * here exactly as it will in production — which is the point of testing locally. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT) || 8747;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
                         'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 ' + p);
  }
}).listen(PORT, () => console.log(`serving ${ROOT} → http://localhost:${PORT}/docs/`));
