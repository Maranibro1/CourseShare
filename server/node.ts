import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { ClaudeChecker } from './claude';
import { createCore } from './core';
import { MemoryRepo, type Repo } from './repo';

/*
 * The Node server: the same API as the Supabase Edge Function (server/core.ts),
 * plus the built web app and live updates over Server-Sent Events.
 */

export interface NodeServerOptions {
  repo: Repo;
  /** Built web app to serve (the Vite `dist` folder). Optional for an API-only server. */
  staticDir?: string;
  /** Extra origins allowed to call the API, besides this site and the Android app. */
  allowedOrigins?: string[];
  defaultTimeZone?: string;
  passwordRounds?: number;
  /** Claude, for checking proof photos and answers. */
  claude?: ClaudeChecker | null;
}

// The Android app's web view runs at https://localhost (http://localhost on older setups).
const APP_ORIGINS = ['https://localhost', 'http://localhost', 'capacitor://localhost'];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive',
};

/** A MemoryRepo saved to DATA_DIR/state.json, with photos as files. */
export async function fileRepo(dir: string): Promise<MemoryRepo> {
  const file = join(dir, 'state.json');
  const photos = join(dir, 'photos');
  await mkdir(photos, { recursive: true });
  let initial = {};
  try {
    initial = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const safe = (id: string) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('bad id');
    return join(photos, id);
  };
  let writing: Promise<void> = Promise.resolve();
  return new MemoryRepo(
    initial,
    (snapshot) => {
      // One write at a time; a temporary file renamed over the old one never leaves half a file.
      const text = JSON.stringify(snapshot);
      writing = writing.then(async () => {
        await writeFile(`${file}.tmp`, text);
        await rename(`${file}.tmp`, file);
      });
      return writing;
    },
    {
      get: async (id) => {
        try {
          return new Uint8Array(await readFile(safe(id)));
        } catch {
          return null;
        }
      },
      put: async (id, bytes) => {
        await writeFile(`${safe(id)}.tmp`, bytes);
        await rename(`${safe(id)}.tmp`, safe(id));
      },
      delete: async (id) => {
        await unlink(safe(id)).catch(() => undefined);
      },
    },
  );
}

export function createKaziServer(options: NodeServerOptions) {
  const allowedOrigins = new Set([...APP_ORIGINS, ...(options.allowedOrigins ?? [])]);
  const staticRoot = options.staticDir ? resolve(options.staticDir) : null;
  const listeners = new Map<string, Set<ServerResponse>>();

  const core = createCore({
    repo: options.repo,
    defaultTimeZone: options.defaultTimeZone,
    passwordRounds: options.passwordRounds,
    claude: options.claude,
    notify: (ids) => {
      for (const id of ids) for (const res of listeners.get(id) ?? []) res.write('event: change\ndata: {}\n\n');
    },
  });

  function toRequest(req: IncomingMessage): Request {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v !== undefined) headers.set(k, v);
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, {
      method: req.method,
      headers,
      body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
      // Needed by Node when a request has a streaming body.
      ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit);
  }

  async function send(res: ServerResponse, response: Response) {
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => (headers[k] = v));
    res.writeHead(response.status, headers);
    if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
    res.end();
  }

  async function events(req: IncomingMessage, res: ServerResponse) {
    const me = await core.authenticate(toRequest(req)).catch(() => null);
    if (!me) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Please sign in again.' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      // Stop proxies such as nginx from holding the stream back.
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    const set = listeners.get(me) ?? new Set();
    set.add(res);
    listeners.set(me, set);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      set.delete(res);
      if (set.size === 0) listeners.delete(me);
    });
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
    const notFound = () => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    };
    if (!staticRoot) return notFound();
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return notFound();
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(staticRoot, rel));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) return notFound();
    const info = await stat(file).catch(() => null);
    // The app uses #/ routes, so anything that isn't a file is a wrong link.
    if (!info || !info.isFile()) return notFound();
    const ext = extname(file).toLowerCase();
    const headers: Record<string, string | number> = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    if (ext === '.apk') headers['Content-Disposition'] = 'attachment; filename="kazikwanza.apk"';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  }

  function cors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    if (!origin) return;
    const host = req.headers.host;
    const sameSite = host && (origin === `https://${host}` || origin === `http://${host}`);
    if (sameSite || allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-None-Match, X-Kazi-Token, apikey');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'ETag');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const path = new URL(req.url ?? '/', 'http://local').pathname;
    const method = req.method ?? 'GET';
    if (path.startsWith('/api/')) {
      cors(req, res);
      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (path === '/api/events' && method === 'GET') return events(req, res);
      return send(res, await core.handle(toRequest(req), req.socket.remoteAddress ?? 'unknown'));
    }
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    return serveStatic(req, res, path);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      console.error(e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Something went wrong on our side. Please try again.' }));
      } else res.end();
    });
  });
  return { server };
}
