/**
 * BayLeaf API Server
 * 
 * A Cloudflare Worker that provides:
 * 1. OIDC authentication with UCSC Google accounts
 * 2. OpenRouter API key provisioning for authenticated users
 * 3. LLM inference proxy with campus-specific system prompt injection
 * 
 * @see https://bayleaf.chat/about
 */

import type { Env } from './types';
import { html } from './utils/response';
import { errorPage } from './templates/layout';
import { handleLogin, handleCallback, handleLogout } from './routes/auth';
import { handleLanding, handleDashboard } from './routes/dashboard';
import { handleGetKey, handleCreateKey, handleDeleteKey } from './routes/key';
import { handleApiProxy, handleCors } from './routes/proxy';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    
    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return handleCors();
    }
    
    try {
      // Redirect old /api/v1/* paths to /v1/* for backwards compatibility
      if (path.startsWith('/api/v1/')) {
        const newPath = path.replace('/api/v1', '/v1');
        const newUrl = new URL(newPath + url.search, url.origin);
        return new Response(null, {
          status: 301,
          headers: {
            'Location': newUrl.toString(),
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // API proxy routes
      if (path.startsWith('/v1/')) {
        return handleApiProxy(request, env);
      }
      
      // Auth routes
      if (path === '/login' && method === 'GET') {
        return handleLogin(request, env);
      }
      if (path === '/callback' && method === 'GET') {
        return handleCallback(request, env);
      }
      if (path === '/logout' && method === 'GET') {
        return handleLogout(request);
      }
      
      // Key management routes
      if (path === '/key') {
        if (method === 'GET') return handleGetKey(request, env);
        if (method === 'POST') return handleCreateKey(request, env);
        if (method === 'DELETE') return handleDeleteKey(request, env);
      }
      
      // Dashboard
      if (path === '/dashboard' && method === 'GET') {
        return handleDashboard(request, env);
      }
      
      // Landing page
      if (path === '/' && method === 'GET') {
        return handleLanding(request, env);
      }
      
      // 404
      return html(errorPage('Not Found', 'The page you requested does not exist.'), 404);
      
    } catch (e) {
      console.error('Unhandled error:', e);
      return html(errorPage('Server Error', 'An unexpected error occurred.'), 500);
    }
  },
};
