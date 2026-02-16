/**
 * Key Management Route Handlers
 */

import type { Env } from '../types';
import { getSession } from '../utils/session';
import { json } from '../utils/response';
import { getKeyName, findKeyByName, createKey, deleteKey } from '../openrouter';

/**
 * GET /key - Get current user's key info (JSON API)
 */
export async function handleGetKey(request: Request, env: Env): Promise<Response> {
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
export async function handleCreateKey(request: Request, env: Env): Promise<Response> {
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
  
  return json({ success: true, key: newKeyData.key, hash: newKeyData.hash });
}

/**
 * DELETE /key - Revoke key (JSON API)
 */
export async function handleDeleteKey(request: Request, env: Env): Promise<Response> {
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
