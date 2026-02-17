/**
 * OpenRouter API Helpers
 */

import type { Bindings, OpenRouterKey, OpenRouterKeyCreated } from './types';
import { OPENROUTER_API } from './constants';

/**
 * Generate the key name for a user based on their email
 */
export function getKeyName(email: string, template: string): string {
  return template.replace('$email', email);
}

/**
 * List all keys and find one by name.
 * Used during migration to adopt pre-existing OR keys.
 */
export async function findKeyByName(name: string, env: Bindings): Promise<OpenRouterKey | null> {
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
 * Look up a specific key by its hash.
 * Used for state reconciliation (checking if an OR key is still alive).
 */
export async function findKeyByHash(hash: string, env: Bindings): Promise<OpenRouterKey | null> {
  const response = await fetch(`${OPENROUTER_API}/keys/${hash}`, {
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_PROVISIONING_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;

  const result = await response.json() as { data: OpenRouterKey };
  return result.data ?? null;
}

/**
 * Create a new API key (no expiry -- the OR key lives forever).
 */
export async function createKey(name: string, env: Bindings): Promise<OpenRouterKeyCreated | null> {
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
 * Look up a model's display name from the OpenRouter public models list.
 * Returns null if the model isn't found or the request fails.
 */
export async function getModelName(modelId: string): Promise<string | null> {
  const response = await fetch(`${OPENROUTER_API}/models`);
  if (!response.ok) return null;

  const result = await response.json() as { data: { id: string; name: string }[] };
  const model = result.data.find((m) => m.id === modelId);
  return model?.name ?? null;
}

/**
 * Delete an API key by hash
 */
export async function deleteKey(hash: string, env: Bindings): Promise<boolean> {
  const response = await fetch(`${OPENROUTER_API}/keys/${hash}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_PROVISIONING_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  
  return response.ok;
}
