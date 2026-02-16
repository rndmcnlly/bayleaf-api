/**
 * API Proxy Route Handler
 * 
 * Proxies requests to OpenRouter with system prompt injection.
 * Supports Campus Pass for on-campus users.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { OPENROUTER_API } from '../constants';
import { isCampusPassEligible } from '../utils/ip';

export const proxyRoutes = new Hono<AppEnv>();

/**
 * /v1/* - Proxy to OpenRouter with system prompt injection
 * Supports Campus Pass: on-campus users can access without a personal API key
 *
 * Note: this sub-app is mounted at /v1, so c.req.path is relative to /v1.
 */
proxyRoutes.all('/*', async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname.replace('/v1', '');
  
  // Build the OpenRouter URL
  const openRouterUrl = `${OPENROUTER_API}${path}${url.search}`;
  
  // Clone headers, removing host
  const headers = new Headers(c.req.raw.headers);
  headers.delete('host');
  
  // Check for Campus Pass mode
  const authHeader = c.req.header('Authorization');
  const providedKey = authHeader?.replace(/^Bearer\s+/i, '').trim();
  
  let isCampusMode = false;
  
  // If no key, empty key, or "campus" token, check for campus access
  if (!providedKey || providedKey === '' || providedKey.toLowerCase() === 'campus') {
    if (isCampusPassEligible(c.req.raw, c.env)) {
      isCampusMode = true;
      headers.set('Authorization', `Bearer ${c.env.CAMPUS_POOL_KEY}`);
    } else {
      return c.json({
        error: 'Unauthorized',
        message: 'API key required. On-campus users can omit the key or use "campus". Visit https://api.bayleaf.chat/ for a free personal key.',
      }, 401);
    }
  }
  
  // For chat completions, inject system prompt prefix(es)
  if (path === '/chat/completions' && c.req.method === 'POST') {
    try {
      const body = await c.req.json() as { messages?: Array<{ role: string; content: string }> };
      
      if (body.messages && Array.isArray(body.messages)) {
        // Build the full system prefix
        let systemPrefix = c.env.SYSTEM_PROMPT_PREFIX;
        if (isCampusMode && c.env.CAMPUS_SYSTEM_PREFIX) {
          systemPrefix += '\n\n' + c.env.CAMPUS_SYSTEM_PREFIX;
        }
        
        // Find existing system message or create one
        const systemIndex = body.messages.findIndex(m => m.role === 'system');
        
        if (systemIndex >= 0) {
          // Prepend to existing system message
          body.messages[systemIndex].content = 
            systemPrefix + '\n\n' + body.messages[systemIndex].content;
        } else {
          // Insert system message at the beginning
          body.messages.unshift({
            role: 'system',
            content: systemPrefix,
          });
        }
      }
      
      // Make the proxied request with modified body
      const response = await fetch(openRouterUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      
      // Return response with CORS headers
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
