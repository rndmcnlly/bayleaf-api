/**
 * API Proxy Route Handlers
 * 
 * Proxies requests to OpenRouter with system prompt injection.
 * Handles both Chat Completions (/v1/chat/completions) and
 * Responses API (/v1/responses) with format-appropriate injection.
 * Resolves sk-bayleaf- proxy tokens to real OR keys via D1.
 * Supports Campus Pass for on-campus users.
 *
 * Note: this sub-app is mounted at /v1, so paths are relative to /v1.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { OPENROUTER_API } from '../constants';
import { resolveAuth, type AuthResult } from '../utils/auth';

export const proxyRoutes = new Hono<AppEnv>();

/** Build the system prompt prefix, adding campus suffix when applicable. */
function buildSystemPrefix(env: AppEnv['Bindings'], isCampusMode: boolean): string {
  let prefix = env.SYSTEM_PROMPT_PREFIX;
  if (isCampusMode && env.CAMPUS_SYSTEM_PREFIX) {
    prefix += '\n\n' + env.CAMPUS_SYSTEM_PREFIX;
  }
  return prefix;
}

/** Inject the `user` field for OR per-user analytics. */
function injectUser(body: { user?: string }, auth: AuthResult): void {
  if (body.user) return;
  if (auth.userEmail) {
    body.user = auth.userEmail;
  } else if (auth.isCampusMode) {
    body.user = 'campus-anonymous';
  }
}

/** Forward a modified JSON body to OpenRouter and return the response. */
async function forwardJson(
  url: string,
  authorization: string,
  body: unknown,
): Promise<Response> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('Access-Control-Allow-Origin', '*');

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

/**
 * POST /responses — Responses API proxy
 * Injects system prompt via the `instructions` field.
 */
proxyRoutes.post('/responses', async (c) => {
  const auth = await resolveAuth(c);
  if (auth instanceof Response) return auth;

  let body: { instructions?: string; user?: string; [k: string]: unknown };
  try {
    body = await c.req.json() as typeof body;
  } catch {
    return c.json({ error: { message: 'Invalid JSON in request body.', code: 400 } }, 400);
  }

  // Inject system prompt via `instructions`
  const systemPrefix = buildSystemPrefix(c.env, auth.isCampusMode);
  body.instructions = body.instructions
    ? systemPrefix + '\n\n' + body.instructions
    : systemPrefix;

  injectUser(body, auth);

  return forwardJson(`${OPENROUTER_API}/responses`, auth.authorization, body);
});

/**
 * /* catch-all — Chat Completions & general proxy
 * Injects system prompt via a system message for /chat/completions.
 * All other paths are forwarded unmodified.
 */
proxyRoutes.all('/*', async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname.replace('/v1', '');
  const openRouterUrl = `${OPENROUTER_API}${path}${url.search}`;

  // Clone headers, removing host
  const headers = new Headers(c.req.raw.headers);
  headers.delete('host');

  const auth = await resolveAuth(c);
  if (auth instanceof Response) return auth;

  headers.set('Authorization', auth.authorization);

  // For chat completions, inject system prompt and user field
  if (path === '/chat/completions' && c.req.method === 'POST') {
    try {
      const body = await c.req.json() as {
        messages?: Array<{ role: string; content: string }>;
        user?: string;
      };

      if (body.messages && Array.isArray(body.messages)) {
        const systemPrefix = buildSystemPrefix(c.env, auth.isCampusMode);
        const systemIndex = body.messages.findIndex(m => m.role === 'system');

        if (systemIndex >= 0) {
          body.messages[systemIndex].content =
            systemPrefix + '\n\n' + body.messages[systemIndex].content;
        } else {
          body.messages.unshift({ role: 'system', content: systemPrefix });
        }
      }

      injectUser(body, auth);

      const response = await fetch(openRouterUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');

      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    } catch (e) {
      // If JSON parsing fails, pass through as-is
      console.error('Failed to parse request body:', e);
    }
  }

  // For all other requests, simple proxy
  const response = await fetch(openRouterUrl, {
    method: c.req.method,
    headers,
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('Access-Control-Allow-Origin', '*');

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
});
