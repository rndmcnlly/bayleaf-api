/**
 * Bayleaf Proxy Token Utilities
 */

import { BAYLEAF_TOKEN_PREFIX } from '../constants';

/**
 * Generate a random bayleaf proxy token: sk-bayleaf- + 32 hex chars.
 */
export function generateBayleafToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return BAYLEAF_TOKEN_PREFIX + hex;
}
