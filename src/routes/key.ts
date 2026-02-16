/**
 * Key Management Route Handlers
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getSession } from '../utils/session';
import { getKeyName, findKeyByName, createKey, deleteKey } from '../openrouter';

export const keyRoutes = new Hono<AppEnv>();

/** Session-required middleware for all /key routes */
keyRoutes.use('/key', async (c, next) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  c.set('session', session);
  await next();
});

/** GET /key - Get current user's key info */
keyRoutes.get('/key', async (c) => {
  const session = c.get('session');
  const keyName = getKeyName(session.email, c.env.KEY_NAME_TEMPLATE);
  const key = await findKeyByName(keyName, c.env);
  
  if (!key) {
    return c.json({ error: 'No key found', exists: false }, 404);
  }
  
  return c.json({ 
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
});

/** POST /key - Create a new key */
keyRoutes.post('/key', async (c) => {
  const session = c.get('session');
  const keyName = getKeyName(session.email, c.env.KEY_NAME_TEMPLATE);
  
  const existing = await findKeyByName(keyName, c.env);
  if (existing) {
    return c.json({ error: 'Key already exists' }, 409);
  }
  
  const newKeyData = await createKey(keyName, c.env);
  if (!newKeyData || !newKeyData.key) {
    return c.json({ error: 'Failed to create key' }, 500);
  }
  
  return c.json({ success: true, key: newKeyData.key, hash: newKeyData.hash });
});

/** DELETE /key - Revoke key */
keyRoutes.delete('/key', async (c) => {
  const session = c.get('session');
  const keyName = getKeyName(session.email, c.env.KEY_NAME_TEMPLATE);
  const existing = await findKeyByName(keyName, c.env);
  
  if (!existing) {
    return c.json({ error: 'No key found' }, 404);
  }
  
  const deleted = await deleteKey(existing.hash, c.env);
  if (!deleted) {
    return c.json({ error: 'Failed to delete key' }, 500);
  }
  
  return c.json({ success: true });
});
