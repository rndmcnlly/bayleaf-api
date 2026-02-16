/**
 * Session Token Utilities
 * 
 * HMAC-SHA256 signed session tokens using Web Crypto API.
 */

import type { Env, Session } from '../types';
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
export async function verifySessionToken(token: string, secret: string): Promise<Session | null> {
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
 * Get session from request cookies
 */
export async function getSession(request: Request, env: Env): Promise<Session | null> {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  
  return verifySessionToken(match[1], env.OIDC_CLIENT_SECRET);
}

/**
 * Create a Set-Cookie header for the session
 */
export function sessionCookie(token: string, hostname: string): string {
  const secure = hostname !== 'localhost';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_HOURS * 3600}${secure ? '; Secure' : ''}`;
}

/**
 * Create a logout cookie (expires immediately)
 */
export function logoutCookie(hostname: string): string {
  const secure = hostname !== 'localhost';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
