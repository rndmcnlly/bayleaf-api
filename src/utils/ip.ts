/**
 * IP Range Utilities (Campus Pass)
 */

import type { Env } from '../types';

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
export function getClientIP(request: Request): string {
  return request.headers.get('CF-Connecting-IP') 
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || '127.0.0.1';
}

/**
 * Check if request qualifies for Campus Pass
 */
export function isCampusPassEligible(request: Request, env: Env): boolean {
  if (!env.CAMPUS_IP_RANGES || !env.CAMPUS_POOL_KEY) return false;
  return isOnCampus(getClientIP(request), env.CAMPUS_IP_RANGES);
}
