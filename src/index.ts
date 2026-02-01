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

// =============================================================================
// Type Definitions
// =============================================================================

interface Env {
  // Public configuration
  SPENDING_LIMIT_DOLLARS: string;
  SPENDING_LIMIT_RESET: string;
  KEY_NAME_TEMPLATE: string;
  KEY_EXPIRY_DAYS: string;
  ALLOWED_EMAIL_DOMAIN: string;
  SYSTEM_PROMPT_PREFIX: string;
  
  // Campus Pass configuration
  CAMPUS_IP_RANGES: string;        // Comma-separated CIDR ranges (e.g., "128.114.0.0/16,169.233.0.0/16")
  CAMPUS_SYSTEM_PREFIX: string;    // Additional system prompt prefix for campus mode
  
  // Secrets (set via wrangler secret put)
  OPENROUTER_PROVISIONING_KEY: string;
  OIDC_CLIENT_ID: string;
  OIDC_CLIENT_SECRET: string;
  CAMPUS_POOL_KEY: string;         // Shared OpenRouter key for campus access
}

interface Session {
  email: string;
  name: string;
  picture?: string;
  exp: number;
}

interface OpenRouterKey {
  hash: string;
  name: string;
  label: string;
  disabled: boolean;
  limit: number | null;
  limit_remaining: number | null;
  limit_reset: string | null;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  created_at: string;
  updated_at: string | null;
  expires_at: string | null;
}

interface OpenRouterKeyCreated extends OpenRouterKey {
  key: string; // The actual API key, only available at creation time
}

// =============================================================================
// Constants
// =============================================================================

const GOOGLE_OIDC = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  userinfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
};

const OPENROUTER_API = 'https://openrouter.ai/api/v1';

const SESSION_COOKIE = 'bayleaf_session';
const SESSION_DURATION_HOURS = 24;

// =============================================================================
// IP Range Utilities (Campus Pass)
// =============================================================================

/**
 * Convert an IPv4 address to a BigInt
 */
function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  
  let result = 0n;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8n) | BigInt(num);
  }
  return result;
}

/**
 * Convert an IPv6 address to a BigInt
 * Handles full and compressed formats (e.g., 2607:F5F0::1)
 */
function ipv6ToBigInt(ip: string): bigint | null {
  // Expand :: notation
  let parts = ip.split(':');
  
  const doubleColonIndex = ip.indexOf('::');
  if (doubleColonIndex !== -1) {
    const before = ip.slice(0, doubleColonIndex).split(':').filter(p => p !== '');
    const after = ip.slice(doubleColonIndex + 2).split(':').filter(p => p !== '');
    const missing = 8 - before.length - after.length;
    parts = [...before, ...Array(missing).fill('0'), ...after];
  }
  
  if (parts.length !== 8) return null;
  
  let result = 0n;
  for (const part of parts) {
    const num = parseInt(part || '0', 16);
    if (isNaN(num) || num < 0 || num > 0xFFFF) return null;
    result = (result << 16n) | BigInt(num);
  }
  return result;
}

/**
 * Check if an IP address is within a CIDR range
 * Supports both IPv4 and IPv6
 */
function isIPInCIDR(ip: string, cidr: string): boolean {
  const [rangeIP, prefixLenStr] = cidr.split('/');
  const prefixLen = parseInt(prefixLenStr, 10);
  
  // Determine IP version
  const isV6 = ip.includes(':');
  const isRangeV6 = rangeIP.includes(':');
  
  // Must be same IP version
  if (isV6 !== isRangeV6) return false;
  
  if (isV6) {
    const ipVal = ipv6ToBigInt(ip);
    const rangeVal = ipv6ToBigInt(rangeIP);
    if (ipVal === null || rangeVal === null) return false;
    if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 128) return false;
    
    const mask = prefixLen === 0 ? 0n : (~0n << BigInt(128 - prefixLen)) & ((1n << 128n) - 1n);
    return (ipVal & mask) === (rangeVal & mask);
  } else {
    const ipVal = ipv4ToBigInt(ip);
    const rangeVal = ipv4ToBigInt(rangeIP);
    if (ipVal === null || rangeVal === null) return false;
    if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) return false;
    
    const mask = prefixLen === 0 ? 0n : (~0n << BigInt(32 - prefixLen)) & 0xFFFFFFFFn;
    return (ipVal & mask) === (rangeVal & mask);
  }
}

/**
 * Check if an IP address is on campus (matches any configured CIDR range)
 */
function isOnCampus(ip: string, rangesConfig: string): boolean {
  if (!rangesConfig || !ip) return false;
  
  const ranges = rangesConfig.split(',').map(r => r.trim()).filter(r => r);
  return ranges.some(range => isIPInCIDR(ip, range));
}

/**
 * Get client IP from request headers
 * CF-Connecting-IP is set by Cloudflare; falls back for local dev
 */
function getClientIP(request: Request): string {
  return request.headers.get('CF-Connecting-IP') 
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || '127.0.0.1';
}

/**
 * Check if request qualifies for Campus Pass
 */
function isCampusPassEligible(request: Request, env: Env): boolean {
  if (!env.CAMPUS_IP_RANGES || !env.CAMPUS_POOL_KEY) return false;
  return isOnCampus(getClientIP(request), env.CAMPUS_IP_RANGES);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate the key name for a user based on their email
 */
function getKeyName(email: string, template: string): string {
  return template.replace('$email', email);
}

/**
 * Create a signed session token (simple HMAC-based)
 */
async function createSessionToken(session: Session, secret: string): Promise<string> {
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
 * Get session from request cookies
 */
async function getSession(request: Request, env: Env): Promise<Session | null> {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  
  return verifySessionToken(match[1], env.OIDC_CLIENT_SECRET);
}

/**
 * Create a Set-Cookie header for the session
 */
function sessionCookie(token: string, hostname: string): string {
  const secure = hostname !== 'localhost';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_HOURS * 3600}${secure ? '; Secure' : ''}`;
}

/**
 * Create a logout cookie (expires immediately)
 */
function logoutCookie(hostname: string): string {
  const secure = hostname !== 'localhost';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

/**
 * HTML response helper
 */
function html(content: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(content, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...headers,
    },
  });
}

/**
 * JSON response helper
 */
function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Redirect response helper
 */
function redirect(url: string, headers: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      ...headers,
    },
  });
}

// =============================================================================
// OpenRouter API Helpers
// =============================================================================

/**
 * List all keys and find one by name
 */
async function findKeyByName(name: string, env: Env): Promise<OpenRouterKey | null> {
  let offset = 0;
  const limit = 100;
  
  while (true) {
    const response = await fetch(`${OPENROUTER_API}/keys?offset=${offset}&limit=${limit}`, {
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_PROVISIONING_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.error('Failed to list keys:', await response.text());
      return null;
    }
    
    const result = await response.json() as { data: OpenRouterKey[] };
    const key = result.data.find(k => k.name === name);
    if (key) return key;
    
    if (result.data.length < limit) break;
    offset += limit;
  }
  
  return null;
}

/**
 * Create a new API key
 */
async function createKey(name: string, env: Env): Promise<OpenRouterKeyCreated | null> {
  const expiryDays = parseInt(env.KEY_EXPIRY_DAYS) || 30;
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
  
  const response = await fetch(`${OPENROUTER_API}/keys`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_PROVISIONING_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      limit: parseFloat(env.SPENDING_LIMIT_DOLLARS) || 1.0,
      limit_reset: env.SPENDING_LIMIT_RESET || 'daily',
      expires_at: expiresAt,
    }),
  });
  
  const responseText = await response.text();
  console.log('OpenRouter create key response:', response.status, responseText);
  
  if (!response.ok) {
    return null;
  }
  
  const result = JSON.parse(responseText) as { data: OpenRouterKeyCreated; key?: string };
  // Key might be at top level or nested in data
  const keyData = result.data || result as unknown as OpenRouterKeyCreated;
  if (result.key) keyData.key = result.key;
  return keyData;
}

/**
 * Delete an API key by hash
 */
async function deleteKey(hash: string, env: Env): Promise<boolean> {
  const response = await fetch(`${OPENROUTER_API}/keys/${hash}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_PROVISIONING_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  
  return response.ok;
}

// =============================================================================
// HTML Templates
// =============================================================================

function baseLayout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - BayLeaf API</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.6;
      max-width: 700px;
      margin: 0 auto;
      padding: 2rem 1rem;
      background: #fafafa;
      color: #333;
    }
    h1, h2, h3 { color: #003c6c; } /* UCSC blue */
    a { color: #006aad; }
    .btn {
      display: inline-block;
      padding: 0.75rem 1.5rem;
      background: #003c6c;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-size: 1rem;
    }
    .btn:hover { background: #005a9e; }
    .btn-danger { background: #c41e3a; }
    .btn-danger:hover { background: #a01830; }
    .card {
      background: white;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 1.5rem;
      margin: 1rem 0;
    }
    .key-display {
      font-family: monospace;
      background: #1a1a1a;
      color: #0f0;
      padding: 1rem;
      border-radius: 4px;
      word-break: break-all;
      position: relative;
    }
    .key-display input {
      width: 100%;
      background: transparent;
      border: none;
      color: inherit;
      font: inherit;
      padding: 0;
    }
    .copy-btn {
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      padding: 0.25rem 0.5rem;
      font-size: 0.8rem;
    }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; }
    .stat { text-align: center; }
    .stat-value { font-size: 1.5rem; font-weight: bold; color: #003c6c; }
    .stat-label { font-size: 0.85rem; color: #666; }
    code {
      background: #f0f0f0;
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      font-size: 0.9em;
    }
    pre {
      background: #1a1a1a;
      color: #f0f0f0;
      padding: 1rem;
      border-radius: 4px;
      overflow-x: auto;
    }
    pre code { background: transparent; padding: 0; }
    .warning { background: #fff3cd; border-color: #ffc107; padding: 1rem; border-radius: 4px; }
    .success { background: #d4edda; border-color: #28a745; padding: 1rem; border-radius: 4px; }
    .error { background: #f8d7da; border-color: #dc3545; padding: 1rem; border-radius: 4px; }
    footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #ddd; font-size: 0.85rem; color: #666; }
  </style>
</head>
<body>
  <header>
    <h1>BayLeaf API</h1>
  </header>
  <main>
    ${content}
  </main>
  <footer>
    <p>A service of <a href="https://bayleaf.chat/about">BayLeaf Chat</a> for UC Santa Cruz.</p>
  </footer>
</body>
</html>`;
}

function landingPage(showCampusPass: boolean): string {
  const campusPassSection = showCampusPass ? `
    <div class="card" style="background: #e8f4e8; border-color: #28a745;">
      <h3>Campus Pass Available</h3>
      <p>You're on the UCSC network! You can use the API right now without signing in.</p>
      <p>Just point any OpenAI-compatible client at:</p>
      <pre><code>https://api.bayleaf.chat/api/v1</code></pre>
      <p style="margin-bottom: 0;">No API key needed, or use <code>campus</code> as your key.</p>
    </div>
  ` : '';

  return baseLayout('Welcome', `
    <div class="card">
      <h2>API Access for UCSC</h2>
      <p>Free LLM inference for UC Santa Cruz students, faculty, and staff.</p>
      <p><a href="/login" class="btn">Sign in with UCSC Google</a></p>
    </div>
    ${campusPassSection}
  `);
}

function dashboardPage(session: Session, key: OpenRouterKey | null): string {
  const greeting = `Welcome, ${session.name || session.email}`;
  
  let keySection: string;
  
  if (key) {
    // Has existing key
    const remaining = key.limit_remaining?.toFixed(4) ?? 'N/A';
    const expiresAt = key.expires_at ? new Date(key.expires_at).toLocaleDateString() : 'Never';
    
    keySection = `
      <div class="card" id="keyCard">
        <h3>Your API Key</h3>
        <p>Key ID: <code>${key.label}</code></p>
        <p>Expires: ${expiresAt}</p>
        <div class="stats">
          <div class="stat">
            <div class="stat-value">$${key.usage_daily.toFixed(4)}</div>
            <div class="stat-label">Today's Usage</div>
          </div>
          <div class="stat">
            <div class="stat-value">$${remaining}</div>
            <div class="stat-label">Remaining Today</div>
          </div>
          <div class="stat">
            <div class="stat-value">$${key.usage_monthly.toFixed(4)}</div>
            <div class="stat-label">This Month</div>
          </div>
        </div>
        <button class="btn btn-danger" style="margin-top: 1rem;" onclick="revokeKey()">Revoke Key</button>
      </div>
    `;
  } else {
    // No key yet
    keySection = `
      <div class="card" id="keySection">
        <h3>Get Your API Key</h3>
        <p>You don't have an API key yet. Create one to start using the BayLeaf API.</p>
        <button class="btn" onclick="createKey()">Create API Key</button>
      </div>
    `;
  }

  const usageGuide = key ? `
    <div class="card">
      <h3>Quick Start</h3>
      <pre><code>curl https://api.bayleaf.chat/api/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'</code></pre>
      <p>See <a href="https://openrouter.ai/models" target="_blank">available models</a> on OpenRouter.</p>
    </div>
  ` : '';

  const scripts = `
    <script>
      function copyKey() {
        const input = document.getElementById('apiKey');
        input.type = 'text';
        input.select();
        document.execCommand('copy');
        input.type = 'password';
        alert('Copied to clipboard!');
      }
      async function createKey() {
        const res = await fetch('/key', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.key) {
          // Store key temporarily, reload to get full view from OR
          sessionStorage.setItem('newKey', data.key);
          location.reload();
        } else {
          alert(data.error || 'Failed to create key');
        }
      }
      // Check for newly created key on page load
      (function() {
        const newKey = sessionStorage.getItem('newKey');
        if (newKey) {
          sessionStorage.removeItem('newKey');
          const keyCard = document.getElementById('keyCard');
          if (keyCard) {
            keyCard.insertAdjacentHTML('afterbegin', \`
              <div class="success" style="margin-bottom: 1rem;">
                <strong>Your new API key has been created!</strong>
                <p>Copy it now - you won't be able to see it again.</p>
              </div>
              <div class="key-display" style="margin-bottom: 1rem;">
                <input type="password" value="\${newKey}" id="apiKey" readonly>
                <button class="btn copy-btn" onclick="copyKey()">Copy</button>
              </div>
            \`);
          }
        }
      })();
      async function revokeKey() {
        if (!confirm('Are you sure? You will need to create a new key.')) return;
        const res = await fetch('/key', { method: 'DELETE' });
        if (res.ok) location.reload();
        else alert('Failed to revoke key');
      }
    </script>
  `;

  return baseLayout('Dashboard', `
    <p>${greeting} | <a href="/logout">Sign out</a></p>
    ${keySection}
    ${usageGuide}
    ${scripts}
  `);
}

function errorPage(title: string, message: string): string {
  return baseLayout(title, `
    <div class="error">
      <h2>${title}</h2>
      <p>${message}</p>
      <p><a href="/">Return to home</a></p>
    </div>
  `);
}

// =============================================================================
// Route Handlers
// =============================================================================

/**
 * GET / - Landing page
 */
async function handleLanding(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (session) {
    return redirect('/dashboard');
  }
  
  return html(landingPage(isCampusPassEligible(request, env)));
}

/**
 * GET /login - Start OIDC flow
 */
function handleLogin(request: Request, env: Env): Response {
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
async function handleCallback(request: Request, env: Env): Promise<Response> {
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
  const session: Session = {
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
function handleLogout(request: Request, env: Env): Response {
  const hostname = new URL(request.url).hostname;
  return redirect('/', {
    'Set-Cookie': logoutCookie(hostname),
  });
}

/**
 * GET /dashboard - Main user interface
 */
async function handleDashboard(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) {
    return redirect('/login');
  }
  
  const keyName = getKeyName(session.email, env.KEY_NAME_TEMPLATE);
  const key = await findKeyByName(keyName, env);
  
  return html(dashboardPage(session, key));
}

/**
 * GET /key - Get current user's key info (JSON API)
 */
async function handleGetKey(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }
  
  const keyName = getKeyName(session.email, env.KEY_NAME_TEMPLATE);
  const key = await findKeyByName(keyName, env);
  
  if (!key) {
    return json({ error: 'No key found', exists: false }, 404);
  }
  
  return json({ 
    exists: true,
    key: {
      label: key.label,
      usage_daily: key.usage_daily,
      usage_monthly: key.usage_monthly,
      limit: key.limit,
      limit_remaining: key.limit_remaining,
      expires_at: key.expires_at,
      created_at: key.created_at,
    }
  });
}

/**
 * POST /key - Create a new key
 */
async function handleCreateKey(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }
  
  const keyName = getKeyName(session.email, env.KEY_NAME_TEMPLATE);
  
  // Check if key already exists
  const existing = await findKeyByName(keyName, env);
  if (existing) {
    return json({ error: 'Key already exists' }, 409);
  }
  
  // Create new key
  const newKeyData = await createKey(keyName, env);
  if (!newKeyData || !newKeyData.key) {
    return json({ error: 'Failed to create key' }, 500);
  }
  
  return json({ success: true, key: newKeyData.key });
}

/**
 * DELETE /key - Revoke key (JSON API)
 */
async function handleDeleteKey(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }
  
  const keyName = getKeyName(session.email, env.KEY_NAME_TEMPLATE);
  const existing = await findKeyByName(keyName, env);
  
  if (!existing) {
    return json({ error: 'No key found' }, 404);
  }
  
  const deleted = await deleteKey(existing.hash, env);
  if (!deleted) {
    return json({ error: 'Failed to delete key' }, 500);
  }
  
  return json({ success: true });
}

/**
 * /api/v1/* - Proxy to OpenRouter with system prompt injection
 * Supports Campus Pass: on-campus users can access without a personal API key
 */
async function handleApiProxy(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/v1', '');
  
  // Build the OpenRouter URL
  const openRouterUrl = `${OPENROUTER_API}${path}${url.search}`;
  
  // Clone headers, removing host
  const headers = new Headers(request.headers);
  headers.delete('host');
  
  // Check for Campus Pass mode
  const authHeader = request.headers.get('Authorization');
  const providedKey = authHeader?.replace(/^Bearer\s+/i, '').trim();
  
  let isCampusMode = false;
  
  // If no key, empty key, or "campus" token, check for campus access
  if (!providedKey || providedKey === '' || providedKey.toLowerCase() === 'campus') {
    if (isCampusPassEligible(request, env)) {
      isCampusMode = true;
      headers.set('Authorization', `Bearer ${env.CAMPUS_POOL_KEY}`);
    } else {
      // Not on campus or Campus Pass not configured
      return json({
        error: 'Unauthorized',
        message: 'API key required. On-campus users can omit the key or use "campus". Visit https://api.bayleaf.chat/ for a free personal key.',
      }, 401);
    }
  }
  
  // For chat completions, inject system prompt prefix(es)
  if (path === '/chat/completions' && request.method === 'POST') {
    try {
      const body = await request.json() as { messages?: Array<{ role: string; content: string }> };
      
      if (body.messages && Array.isArray(body.messages)) {
        // Build the full system prefix
        let systemPrefix = env.SYSTEM_PROMPT_PREFIX;
        if (isCampusMode && env.CAMPUS_SYSTEM_PREFIX) {
          systemPrefix += '\n\n' + env.CAMPUS_SYSTEM_PREFIX;
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
    method: request.method,
    headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
  });
  
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('Access-Control-Allow-Origin', '*');
  
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

/**
 * Handle CORS preflight
 */
function handleCors(): Response {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// =============================================================================
// Main Router
// =============================================================================

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
      // API proxy routes
      if (path.startsWith('/api/v1/')) {
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
        return handleLogout(request, env);
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
