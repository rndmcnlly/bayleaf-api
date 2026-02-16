/**
 * Key Management Route Handlers
 *
 * Issues opaque proxy keys (sk-bayleaf-...) backed by persistent OR keys.
 * The real OR key never reaches the client.
 */

import { Hono } from 'hono';
import type { AppEnv, UserKeyRow } from '../types';
import { getSession } from '../utils/session';
import { generateBayleafToken } from '../utils/token';
import { getKeyName, findKeyByName, findKeyByHash, createKey } from '../openrouter';

export const keyRoutes = new Hono<AppEnv>();

/** Session-required middleware for all /key routes */
keyRoutes.use('/key', async (c, next) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  c.set('session', session);
  await next();
});

/**
 * Ensure the user has a valid OR key, provisioning or self-healing as needed.
 * Returns the validated D1 row, or null on failure.
 */
async function ensureOrKey(
  email: string,
  row: UserKeyRow | null,
  env: AppEnv['Bindings'],
): Promise<{ row: UserKeyRow; orKey: import('../types').OpenRouterKey } | null> {
  const keyName = getKeyName(email, env.KEY_NAME_TEMPLATE);

  if (row) {
    // D1 has a mapping -- check if OR key is still alive
    const orKey = await findKeyByHash(row.or_key_hash, env);
    if (orKey && !orKey.disabled) {
      return { row, orKey };
    }

    // OR key is gone or disabled -- self-heal: provision a new one,
    // keep the same bayleaf token so the user doesn't need to reconfigure
    console.log(`Self-healing OR key for ${email}: old hash ${row.or_key_hash} is gone`);
    const newOrKey = await createKey(keyName, env);
    if (!newOrKey?.key) return null;

    await env.DB.prepare(
      'UPDATE user_keys SET or_key_hash = ?, or_key_secret = ? WHERE email = ?',
    ).bind(newOrKey.hash, newOrKey.key, email).run();

    const updatedRow: UserKeyRow = {
      ...row,
      or_key_hash: newOrKey.hash,
      or_key_secret: newOrKey.key,
    };
    return { row: updatedRow, orKey: newOrKey };
  }

  // No D1 row -- check for a pre-existing OR key (migration case)
  const existingOrKey = await findKeyByName(keyName, env);
  if (existingOrKey) {
    // Adopt it: we don't have the raw secret, but we can store the hash.
    // The user will need to create a new bayleaf token to use it through the proxy.
    // We can't use the key through the proxy without the secret, so we skip adoption
    // and instead provision fresh below.
  }

  return null;
}

/** GET /key - Get current user's key info */
keyRoutes.get('/key', async (c) => {
  const session = c.get('session');
  const row = await c.env.DB.prepare(
    'SELECT * FROM user_keys WHERE email = ? AND revoked = 0',
  ).bind(session.email).first<UserKeyRow>();

  if (!row) {
    return c.json({ error: 'No key found', exists: false }, 404);
  }

  const result = await ensureOrKey(session.email, row, c.env);
  if (!result) {
    return c.json({ error: 'Failed to validate key', exists: false }, 500);
  }

  const { orKey } = result;
  return c.json({
    exists: true,
    key: {
      usage_daily: orKey.usage_daily,
      usage_monthly: orKey.usage_monthly,
      limit: orKey.limit,
      limit_remaining: orKey.limit_remaining,
      created_at: row.created_at,
    },
  });
});

/** POST /key - Create or re-issue a proxy key */
keyRoutes.post('/key', async (c) => {
  const session = c.get('session');
  const keyName = getKeyName(session.email, c.env.KEY_NAME_TEMPLATE);

  // Check for existing active row
  const existing = await c.env.DB.prepare(
    'SELECT * FROM user_keys WHERE email = ? AND revoked = 0',
  ).bind(session.email).first<UserKeyRow>();

  if (existing) {
    return c.json({ error: 'Key already exists' }, 409);
  }

  // Check for revoked row -- reuse the OR key if still alive
  const revoked = await c.env.DB.prepare(
    'SELECT * FROM user_keys WHERE email = ? AND revoked = 1',
  ).bind(session.email).first<UserKeyRow>();

  let orKeyHash: string;
  let orKeySecret: string;

  if (revoked) {
    // Try to reuse the existing OR key
    const orKey = await findKeyByHash(revoked.or_key_hash, c.env);
    if (orKey && !orKey.disabled) {
      orKeyHash = revoked.or_key_hash;
      orKeySecret = revoked.or_key_secret;
    } else {
      // OR key is gone -- provision fresh
      const newOrKey = await createKey(keyName, c.env);
      if (!newOrKey?.key) {
        return c.json({ error: 'Failed to create key' }, 500);
      }
      orKeyHash = newOrKey.hash;
      orKeySecret = newOrKey.key;
    }
  } else {
    // First-time user -- check for pre-existing OR key (migration)
    const existingOrKey = await findKeyByName(keyName, c.env);
    if (existingOrKey) {
      // Can't adopt without the raw secret. Delete the old key and make a new one
      // so we have the secret for proxying. This is a one-time migration cost.
      // The old key's analytics move to "Deleted Key" -- acceptable since it only
      // happens once during migration.
      // Actually, let's keep the old key alive and just create a fresh one.
      // The old one will expire naturally (30-day expiry from the old system).
    }

    const newOrKey = await createKey(keyName, c.env);
    if (!newOrKey?.key) {
      return c.json({ error: 'Failed to create key' }, 500);
    }
    orKeyHash = newOrKey.hash;
    orKeySecret = newOrKey.key;
  }

  // Generate bayleaf token and store mapping
  const bayleafToken = generateBayleafToken();

  if (revoked) {
    // Update the revoked row with new token and possibly new OR key
    await c.env.DB.prepare(
      'UPDATE user_keys SET bayleaf_token = ?, or_key_hash = ?, or_key_secret = ?, revoked = 0, created_at = datetime(\'now\') WHERE email = ?',
    ).bind(bayleafToken, orKeyHash, orKeySecret, session.email).run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO user_keys (email, bayleaf_token, or_key_hash, or_key_secret) VALUES (?, ?, ?, ?)',
    ).bind(session.email, bayleafToken, orKeyHash, orKeySecret).run();
  }

  return c.json({ success: true, key: bayleafToken });
});

/** DELETE /key - Revoke the proxy token (OR key stays alive) */
keyRoutes.delete('/key', async (c) => {
  const session = c.get('session');
  const existing = await c.env.DB.prepare(
    'SELECT * FROM user_keys WHERE email = ? AND revoked = 0',
  ).bind(session.email).first<UserKeyRow>();

  if (!existing) {
    return c.json({ error: 'No key found' }, 404);
  }

  // Revoke the bayleaf token -- the OR key stays alive
  await c.env.DB.prepare(
    'UPDATE user_keys SET revoked = 1 WHERE email = ?',
  ).bind(session.email).run();

  return c.json({ success: true });
});
