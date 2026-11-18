/**
 * Supabase Edge Function "kazi". Bundled into supabase/functions/kazi/index.ts
 * by `npm run build:supabase`; edit this file and server/core.ts, not the bundle.
 *
 * Supabase provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to every function.
 * Optional secrets: KAZI_SERVICE_KEY (a secret key to use instead of the service
 * role key) and KAZI_DEFAULT_TIME_ZONE (default Africa/Nairobi).
 */
import { createCore } from './core';
import { SupabaseRepo } from './supabase-repo';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const url = Deno.env.get('SUPABASE_URL') ?? '';
const key = Deno.env.get('KAZI_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const repo = new SupabaseRepo(url, key);

const core = createCore({
  repo,
  defaultTimeZone: Deno.env.get('KAZI_DEFAULT_TIME_ZONE'),
  // Each account listens on its own channel, named after a secret only that account receives.
  notify: (ids, accounts) =>
    repo.broadcast(
      ids
        .map((id) => accounts[id]?.notifyKey)
        .filter((k): k is string => !!k)
        .map((k) => `kazi-${k}`),
    ),
});

// The app signs in with its own token (X-Kazi-Token), never cookies, so any origin may call.
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kazi-token, if-none-match',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Expose-Headers': 'ETag',
  'Access-Control-Max-Age': '600',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!url || !key) {
    return new Response(JSON.stringify({ error: 'The kazi function is missing SUPABASE_URL or its service key.' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const res = await core.handle(request, ip);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});
