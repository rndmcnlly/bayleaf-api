/**
 * Authentication Route Handlers
 * 
 * Google OIDC sign-in, callback, and logout.
 */

import type { Env } from '../types';
import { GOOGLE_OIDC, SESSION_DURATION_HOURS } from '../constants';
import { createSessionToken, getSession, sessionCookie, logoutCookie } from '../utils/session';
import { html, redirect } from '../utils/response';
import { errorPage } from '../templates/layout';

/**
 * GET /login - Start OIDC flow
 */
export function handleLogin(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/callback`;
  
  // Generate state for CSRF protection
  const state = crypto.randomUUID();
  
  const authUrl = new URL(GOOGLE_OIDC.authorizationEndpoint);
  authUrl.searchParams.set('client_id', env.OIDC_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('hd', env.ALLOWED_EMAIL_DOMAIN); // Restrict to UCSC domain
  
  // Store state in cookie for verification
  return redirect(authUrl.toString(), {
    'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
  });
}

/**
 * GET /callback - OIDC callback
 */
export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  
  if (error) {
    return html(errorPage('Login Failed', `Google returned an error: ${error}`), 400);
  }
  
  if (!code || !state) {
    return html(errorPage('Login Failed', 'Missing authorization code or state.'), 400);
  }
  
  // Verify state
  const cookie = request.headers.get('Cookie');
  const savedState = cookie?.match(/oauth_state=([^;]+)/)?.[1];
  if (state !== savedState) {
    return html(errorPage('Login Failed', 'Invalid state parameter. Please try again.'), 400);
  }
  
  // Exchange code for tokens
  const tokenResponse = await fetch(GOOGLE_OIDC.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.OIDC_CLIENT_ID,
      client_secret: env.OIDC_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${url.origin}/callback`,
    }),
  });
  
  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    console.error('Token exchange failed:', err);
    return html(errorPage('Login Failed', 'Failed to exchange authorization code.'), 500);
  }
  
  const tokens = await tokenResponse.json() as { access_token: string };
  
  // Get user info
  const userResponse = await fetch(GOOGLE_OIDC.userinfoEndpoint, {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` },
  });
  
  if (!userResponse.ok) {
    return html(errorPage('Login Failed', 'Failed to get user information.'), 500);
  }
  
  const user = await userResponse.json() as { email: string; name: string; picture?: string };
  
  // Verify email domain
  if (!user.email.endsWith(`@${env.ALLOWED_EMAIL_DOMAIN}`)) {
    return html(errorPage('Access Denied', `Only @${env.ALLOWED_EMAIL_DOMAIN} accounts are allowed.`), 403);
  }
  
  // Create session
  const session = {
    email: user.email,
    name: user.name,
    picture: user.picture,
    exp: Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000,
  };
  
  const token = await createSessionToken(session, env.OIDC_CLIENT_SECRET);
  const hostname = new URL(request.url).hostname;
  
  return redirect('/dashboard', {
    'Set-Cookie': sessionCookie(token, hostname),
  });
}

/**
 * GET /logout - Clear session
 */
export function handleLogout(request: Request): Response {
  const hostname = new URL(request.url).hostname;
  return redirect('/', {
    'Set-Cookie': logoutCookie(hostname),
  });
}
