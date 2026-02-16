/**
 * Session Token Utilities
 * 
 * HMAC-SHA256 signed session tokens using Web Crypto API.
 * Uses hono/cookie for cookie get/set.
 */

import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Session } from '../types';
import { SESSION_COOKIE, SESSION_DURATION_HOURS } from '../constants';

/**
 * Create a signed session token (simple HMAC-based)
 */
export async function createSessionToken(session: Session, secret: string): Promise<string> {
  const payload = JSON.stringify(session);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return btoa(payload) + '.' + sigBase64;
}

/**
 * Verify and decode a session token
 */
async function verifySessionToken(token: string, secret: string): Promise<Session | null> {
  try {
    const [payloadB64, sigB64] = token.split('.');
    if (!payloadB64 || !sigB64) return null;
    
    const payload = atob(payloadB64);
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signature = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(payload));
    
    if (!valid) return null;
    
    const session = JSON.parse(payload) as Session;
    if (session.exp < Date.now()) return null;
    
    return session;
  } catch {
    return null;
  }
}

/**
 * Get session from request cookie
 */
export async function getSession(c: Context<AppEnv>): Promise<Session | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  return verifySessionToken(token, c.env.OIDC_CLIENT_SECRET);
}

/**
 * Set the session cookie on a response
 */
export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  const secure = new URL(c.req.url).hostname !== 'localhost';
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: SESSION_DURATION_HOURS * 3600,
    secure,
  });
}

/**
 * Clear the session cookie (logout)
 */
export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}
